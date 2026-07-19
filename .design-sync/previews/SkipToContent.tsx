import { SkipToContent } from '@repo/ui';

// SkipToContent is a keyboard-accessibility link: visually hidden (sr-only)
// until it receives focus via Tab, then it appears top-left as a gold pill.
// The card shows the focused appearance (a static replica of the component's
// own focus styles) plus the live component, so the design is visible.
export function SkipLink() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontFamily: 'var(--font-ibm-plex-sans)' }}>
      <span style={{ fontSize: 12, color: '#7C818E' }}>Appears on <kbd>Tab</kbd> focus, top-left:</span>
      <span
        style={{
          alignSelf: 'flex-start',
          background: '#E08A00',
          color: '#1F1709',
          padding: '8px 16px',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 600,
          boxShadow: '0 10px 15px -3px rgba(0,0,0,.07)',
        }}
      >
        Skip to content
      </span>
      <SkipToContent />
    </div>
  );
}
