'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui';
import { ChevronDown, LogOut, Settings as SettingsIcon } from 'lucide-react';
import { getRoleLabel, type AppRole } from '@/lib/roles';
import { signOut } from '@/lib/settings-actions';

interface ProfileMenuProps {
  fullName: string;
  role: AppRole;
}

export function ProfileMenu({ fullName, role }: ProfileMenuProps) {
  const [pending, startTransition] = useTransition();

  function handleSignOut() {
    startTransition(() => {
      signOut();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-n-100 transition-colors"
          aria-label="Open profile menu"
        >
          <span className="text-sm text-n-600">{fullName}</span>
          <Badge variant="success">{getRoleLabel(role)}</Badge>
          <ChevronDown className="h-3.5 w-3.5 text-n-500" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem asChild>
          <Link href="/settings" className="flex items-center gap-2 cursor-pointer">
            <SettingsIcon className="h-4 w-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleSignOut}
          disabled={pending}
          className="flex items-center gap-2 cursor-pointer text-status-error-text"
        >
          <LogOut className="h-4 w-4" />
          {pending ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
