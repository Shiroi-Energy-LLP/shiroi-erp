// apps/erp/src/lib/notifications-queries.ts
import { createClient } from '@repo/supabase/server';
import { createAdminClient } from '@repo/supabase/admin';

export interface Notification {
  id: string;
  recipient_employee_id: string;
  title: string;
  body: string | null;
  notification_type: string;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

/**
 * Get unread notifications for the current user.
 */
export async function getUnreadNotifications(limit = 20): Promise<Notification[]> {
  const op = '[getUnreadNotifications]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('is_read', false)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to fetch notifications: ${error.message}`);
  }

  return (data ?? []) as Notification[];
}

/**
 * Get recent notifications (read + unread) for the current user.
 */
export async function getRecentNotifications(limit = 50): Promise<Notification[]> {
  const op = '[getRecentNotifications]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to fetch notifications: ${error.message}`);
  }

  return (data ?? []) as Notification[];
}

/**
 * Mark a notification as read.
 */
export async function markNotificationRead(notificationId: string): Promise<void> {
  const op = '[markNotificationRead]';
  const supabase = await createClient();

  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', notificationId);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message, notificationId });
    throw new Error(`Failed to mark notification read: ${error.message}`);
  }
}

/**
 * Mark all notifications as read for the current user.
 */
export async function markAllNotificationsRead(): Promise<void> {
  const op = '[markAllNotificationsRead]';
  const supabase = await createClient();

  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('is_read', false);

  if (error) {
    console.error(`${op} Update failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to mark all notifications read: ${error.message}`);
  }
}

/**
 * Create a notification (admin/system use — bypasses RLS).
 * Used by n8n webhooks and server-side automation.
 */
export async function createNotification(params: {
  recipientEmployeeId: string;
  title: string;
  body?: string;
  notificationType: 'alert' | 'reminder' | 'report' | 'approval_required' | 'info';
  entityType?: 'proposal' | 'project' | 'lead' | 'purchase_order' | 'daily_report' | 'employee' | 'override_report';
  entityId?: string;
}): Promise<string> {
  const op = '[createNotification]';
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('notifications')
    .insert({
      recipient_employee_id: params.recipientEmployeeId,
      title: params.title,
      body: params.body ?? null,
      notification_type: params.notificationType,
      entity_type: params.entityType ?? null,
      entity_id: params.entityId ?? null,
    })
    .select('id')
    .single();

  if (error) {
    console.error(`${op} Insert failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to create notification: ${error.message}`);
  }

  return data.id;
}
