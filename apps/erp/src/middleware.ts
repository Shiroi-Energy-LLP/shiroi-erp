import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@repo/supabase/middleware';

/**
 * Legacy URL redirects (Marketing + Design revamp, migration 051-053).
 *
 * The sidebar now points to /sales (list) and /partners (consultants).
 * Any existing bookmark or inbox link to /leads or /proposals is 307'd
 * to the new equivalent so historical links keep working.
 *
 *   /leads          -> /sales
 *   /leads/new      -> /sales/new
 *   /leads/[id]/... -> /sales/[id]/...  (preserves sub-tab path)
 *   /proposals      -> /sales            (list view folded into sales)
 *   /proposals/[id] -> kept alive for now (historical detail pages)
 */
function legacyRedirect(request: NextRequest): NextResponse | null {
  const { pathname, search } = request.nextUrl;

  if (pathname === '/leads' || pathname.startsWith('/leads/')) {
    const newPath = '/sales' + pathname.slice('/leads'.length);
    const target = new URL(newPath + search, request.url);
    return NextResponse.redirect(target, 307);
  }

  if (pathname === '/proposals') {
    return NextResponse.redirect(new URL('/sales' + search, request.url), 307);
  }

  return null;
}

export async function middleware(request: NextRequest) {
  const redirect = legacyRedirect(request);
  if (redirect) return redirect;
  return await updateSession(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|login|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
