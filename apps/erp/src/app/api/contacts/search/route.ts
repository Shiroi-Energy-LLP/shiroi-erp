import { NextRequest, NextResponse } from 'next/server';
import { searchContacts } from '@/lib/contacts-queries';
import { getUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
  // Auth gate (security review 2026-05-30 #4): defense-in-depth — searchContacts
  // already relies on RLS via the cookie-bound server client, but if a contacts
  // policy ever regresses to permissive this becomes contact-data exfil.
  const user = await getUser();
  if (!user) return NextResponse.json([], { status: 401 });

  const q = request.nextUrl.searchParams.get('q');
  if (!q) return NextResponse.json([]);

  try {
    const results = await searchContacts(q);
    return NextResponse.json(results);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}
