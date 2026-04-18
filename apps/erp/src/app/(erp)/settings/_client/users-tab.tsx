'use client';
import type { Database } from '@repo/types/database';

type User = Pick<
  Database['public']['Tables']['profiles']['Row'],
  'id' | 'full_name' | 'email' | 'role' | 'is_active'
>;

interface Props {
  users: User[];
  currentUserId: string;
}

export function UsersTab({ users, currentUserId }: Props) {
  return (
    <div className="text-sm text-n-600">
      Users tab — {users.length} users (current: {currentUserId})
    </div>
  );
}
