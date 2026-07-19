import { Logo } from '@repo/ui';

export function FullLockup() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Logo variant="full" size="lg" />
      <Logo variant="full" size="md" />
      <Logo variant="full" size="sm" />
    </div>
  );
}

export function MarkAndWordmark() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
      <Logo variant="mark" size="xl" />
      <Logo variant="wordmark" size="lg" />
    </div>
  );
}

export function OnDark() {
  return (
    <div style={{ background: '#16130D', padding: 24, borderRadius: 12, display: 'inline-block' }}>
      <div style={{ color: 'rgba(255,255,255,0.95)' }}>
        <Logo variant="full" size="lg" />
      </div>
    </div>
  );
}
