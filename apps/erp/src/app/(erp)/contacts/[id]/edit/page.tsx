import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getContact } from '@/lib/contacts-queries';
import { ContactForm } from '@/components/contacts/contact-form';

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const contact = await getContact(id);
  if (!contact) notFound();

  return (
    <div className="space-y-6">
      <Link href={`/contacts/${id}`} className="text-sm text-[#00B050] hover:underline">&larr; Back to Contact</Link>
      <ContactForm contact={contact as any} />
    </div>
  );
}
