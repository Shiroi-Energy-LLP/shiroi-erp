'use server';

import { createClient } from '@repo/supabase/server';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import { revalidatePath } from 'next/cache';
import type { Database } from '@repo/types/database';

type PpsUpdate = Database['public']['Tables']['proposal_payment_schedule']['Update'];

export interface PaymentFollowUpInput {
  followUpDate?: string | null;      // ISO date string, e.g. '2026-05-24'
  expectedPaymentDate?: string | null; // ISO date string
  note?: string | null;
}

/**
 * Mark a follow-up on a proposal_payment_schedule milestone.
 *
 * Sets follow_up_date = today (if not explicitly provided), increments
 * follow_up_count by 1, and optionally records expected_payment_date and note.
 * Returns ActionResult<void> — never throws across the RSC boundary.
 */
export async function updatePaymentFollowUp(
  paymentScheduleId: string,
  input: PaymentFollowUpInput,
): Promise<ActionResult<void>> {
  const op = '[updatePaymentFollowUp]';

  try {
    const supabase = await createClient();

    // Fetch current count first so we can increment atomically in the update.
    const { data: current, error: fetchErr } = await supabase
      .from('proposal_payment_schedule')
      .select('follow_up_count')
      .eq('id', paymentScheduleId)
      .single();

    if (fetchErr) {
      console.error(`${op} fetch failed`, {
        paymentScheduleId,
        code: fetchErr.code,
        message: fetchErr.message,
        timestamp: new Date().toISOString(),
      });
      return err(fetchErr.message, fetchErr.code);
    }

    if (!current) {
      return err('Payment schedule row not found');
    }

    // follow_up_date defaults to today (IST date) if not explicitly provided
    const todayIST = new Date()
      .toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // 'YYYY-MM-DD'

    const patch: PpsUpdate = {
      follow_up_date: input.followUpDate ?? todayIST,
      follow_up_count: (current.follow_up_count ?? 0) + 1,
      ...(input.expectedPaymentDate !== undefined && {
        expected_payment_date: input.expectedPaymentDate,
      }),
      ...(input.note !== undefined && {
        follow_up_note: input.note,
      }),
    };

    const { error: updateErr } = await supabase
      .from('proposal_payment_schedule')
      .update(patch)
      .eq('id', paymentScheduleId);

    if (updateErr) {
      console.error(`${op} update failed`, {
        paymentScheduleId,
        patch,
        code: updateErr.code,
        message: updateErr.message,
        timestamp: new Date().toISOString(),
      });
      return err(updateErr.message, updateErr.code);
    }

    // Invalidate pages that show tracker data
    revalidatePath('/payments/tracker');
    revalidatePath('/payments');
    revalidatePath('/dashboard');

    return ok(undefined);
  } catch (e) {
    console.error(`${op} threw`, {
      paymentScheduleId,
      error: e,
      timestamp: new Date().toISOString(),
    });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}
