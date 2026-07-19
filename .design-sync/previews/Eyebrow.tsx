import { Eyebrow } from '@repo/ui';

export function Sections() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Eyebrow>Project overview</Eyebrow>
      <Eyebrow>Procurement &amp; BOM</Eyebrow>
      <Eyebrow>Plant monitoring</Eyebrow>
    </div>
  );
}

export function AboveHeading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Eyebrow>Cash flow</Eyebrow>
      <h2 style={{ margin: 0, fontFamily: 'var(--font-archivo)', fontSize: 20, fontWeight: 700, color: '#221C12' }}>
        ₹42.8 L outstanding
      </h2>
    </div>
  );
}
