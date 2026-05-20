/**
 * Privacy Policy — public route, no auth required.
 *
 * Required for Meta App publishing (WhatsApp Business Cloud API).
 * Linked from https://developers.facebook.com/apps/1522204192832180 → Settings → Basic → Privacy Policy URL.
 *
 * Public access enabled via middleware matcher exclusion in `apps/erp/src/middleware.ts`.
 */
export const metadata = {
  title: 'Privacy Policy — Shiroi Energy',
  description: 'How Shiroi Energy LLP handles personal data collected through our ERP and WhatsApp Business communications.',
};

export default function PrivacyPolicyPage() {
  const lastUpdated = '20 May 2026';

  return (
    <main style={{ maxWidth: '760px', margin: '0 auto', padding: '48px 24px', fontFamily: 'system-ui, -apple-system, sans-serif', lineHeight: '1.6', color: '#1f2937' }}>
      <header style={{ marginBottom: '48px', borderBottom: '1px solid #e5e7eb', paddingBottom: '24px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: 600, margin: '0 0 8px 0' }}>Privacy Policy</h1>
        <p style={{ color: '#6b7280', margin: 0 }}>Shiroi Energy LLP · Last updated: {lastUpdated}</p>
      </header>

      <section>
        <h2 style={{ fontSize: '20px', fontWeight: 600, marginTop: '32px' }}>1. Who we are</h2>
        <p>
          Shiroi Energy LLP (&quot;Shiroi&quot;, &quot;we&quot;, &quot;us&quot;) is a solar EPC company headquartered in Chennai, Tamil Nadu, India.
          We design, install and maintain rooftop solar power systems for residential, commercial and industrial customers.
          This Privacy Policy explains what personal data we collect, how we use it, and the choices you have.
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: '20px', fontWeight: 600, marginTop: '32px' }}>2. What we collect</h2>
        <p>We collect only what is necessary to deliver a solar project end-to-end:</p>
        <ul>
          <li><strong>Identity &amp; contact</strong> — name, mobile phone number, email address, installation site address.</li>
          <li><strong>Project information</strong> — proposed system size, expected energy output, site photographs, electrical service details.</li>
          <li><strong>Payment records</strong> — invoices issued, payments received, payment-method type (bank account numbers and similar instruments are not retained in plain text; tokenised references only).</li>
          <li><strong>Statutory documents</strong> — copies of identity proof, address proof, GSTIN (where applicable), CEIG / electrical inspectorate approvals, net-metering applications. Required to complete government-mandated approvals for grid-tied solar installations.</li>
        </ul>
        <p>We do not collect data we do not need. We do not buy contact lists from third parties.</p>
      </section>

      <section>
        <h2 style={{ fontSize: '20px', fontWeight: 600, marginTop: '32px' }}>3. How we use it</h2>
        <ul>
          <li>To send proposals, project status updates, payment reminders, installation schedules and service alerts.</li>
          <li>To submit statutory paperwork to the Tamil Nadu Electricity Board, the Chief Electrical Inspector General (CEIG) and other licensing authorities.</li>
          <li>To provide warranty and operations &amp; maintenance services after commissioning.</li>
          <li>To comply with applicable Indian tax and accounting law (GST, income tax, MSME 45-day payment rules).</li>
        </ul>
      </section>

      <section>
        <h2 style={{ fontSize: '20px', fontWeight: 600, marginTop: '32px' }}>4. WhatsApp Business Platform</h2>
        <p>
          We use the Meta WhatsApp Business Platform (operated by Meta Platforms, Inc.) to send proposals, project
          milestones, payment reminders and service notifications to our customers and internal team.
          When we send you a message, your mobile phone number is transmitted to Meta as part of standard
          WhatsApp message-delivery routing.
        </p>
        <p>
          Meta&apos;s use of your phone number is governed by Meta&apos;s Privacy Policy at{' '}
          <a href="https://www.whatsapp.com/legal/privacy-policy" style={{ color: '#0e7490' }}>whatsapp.com/legal/privacy-policy</a>.
          We do not share your phone number with Meta for advertising purposes.
        </p>
        <p>
          You may opt out of WhatsApp communications at any time by replying STOP to any of our messages, or by
          writing to <a href="mailto:svivek.88@gmail.com" style={{ color: '#0e7490' }}>svivek.88@gmail.com</a>.
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: '20px', fontWeight: 600, marginTop: '32px' }}>5. Who we share it with</h2>
        <p>We share only the minimum necessary data, only with the parties listed below:</p>
        <ul>
          <li>
            <strong>Service providers we use to run the business</strong> — Meta (WhatsApp delivery), Supabase
            (database hosting), Vercel (web hosting), Google (Workspace email and Drive storage of design files).
            These providers process data on our behalf under contract and are not permitted to use it for any other purpose.
          </li>
          <li>
            <strong>Government and statutory authorities</strong> — the Tamil Nadu Electricity Board (TNEB), CEIG,
            and other licensing bodies, only insofar as required to complete net-metering, electrical approvals and
            grid synchronisation paperwork for your installation.
          </li>
          <li>
            <strong>Equipment partners</strong> — solar panel, inverter and monitoring-system manufacturers when
            warranty registration in your name is required. Only your name and installation address are shared
            for this purpose.
          </li>
        </ul>
        <p>
          We do not sell your personal data. We do not share it with marketers, advertisers, or data brokers.
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: '20px', fontWeight: 600, marginTop: '32px' }}>6. How long we keep it</h2>
        <p>
          Project records (proposals, invoices, statutory submissions) are retained for the longer of (a) the warranty
          period of your installation, typically 25 years, or (b) the period required by Indian tax law, currently 8 years.
          Personal contact details associated with leads that did not convert are deleted on request, otherwise within
          24 months of the last interaction.
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: '20px', fontWeight: 600, marginTop: '32px' }}>7. Your rights</h2>
        <p>
          You have the right to ask us what personal data we hold about you, to correct anything that is wrong,
          and to request deletion of data we are not legally required to keep. Send any such request to{' '}
          <a href="mailto:svivek.88@gmail.com" style={{ color: '#0e7490' }}>svivek.88@gmail.com</a> and we will respond within 30 days.
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: '20px', fontWeight: 600, marginTop: '32px' }}>8. Security</h2>
        <p>
          Personal data is stored on encrypted-at-rest databases (Supabase / PostgreSQL) and transmitted over HTTPS.
          Salary, banking and statutory-ID fields are protected by row-level security and are accessible only to staff
          whose role explicitly requires them. Access logs are retained for security auditing.
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: '20px', fontWeight: 600, marginTop: '32px' }}>9. Changes to this policy</h2>
        <p>
          We may update this policy as our business, our regulatory environment, or the services we use change.
          The &quot;Last updated&quot; date at the top of this page reflects the most recent revision. Material changes
          will be communicated to existing customers via WhatsApp or email at least 14 days before they take effect.
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: '20px', fontWeight: 600, marginTop: '32px' }}>10. Contact</h2>
        <p>
          Shiroi Energy LLP<br />
          Chennai, Tamil Nadu, India<br />
          Email: <a href="mailto:svivek.88@gmail.com" style={{ color: '#0e7490' }}>svivek.88@gmail.com</a>
        </p>
      </section>

      <footer style={{ marginTop: '64px', paddingTop: '24px', borderTop: '1px solid #e5e7eb', color: '#6b7280', fontSize: '14px' }}>
        &copy; {new Date().getFullYear()} Shiroi Energy LLP. All rights reserved.
      </footer>
    </main>
  );
}
