import { ContactForm } from '@/components/contacts/contact-form';

export default function NewContactPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#1A1D24]">New Contact</h1>
      <ContactForm />
    </div>
  );
}
