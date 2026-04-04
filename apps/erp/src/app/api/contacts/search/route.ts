import { NextRequest, NextResponse } from 'next/server';
import { searchContacts } from '@/lib/contacts-queries';

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q');
  if (!q) return NextResponse.json([]);

  try {
    const results = await searchContacts(q);
    return NextResponse.json(results);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}
