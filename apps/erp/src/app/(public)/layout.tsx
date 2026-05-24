/**
 * (public) layout — no authentication, no sidebar.
 * Wraps customer-facing public pages: /p/[token] (proposal portal).
 */
import { ToastProvider } from '@repo/ui';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      {children}
    </ToastProvider>
  );
}
