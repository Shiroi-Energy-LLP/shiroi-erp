import * as React from 'react';

function SkipToContent({ targetId = 'main-content' }: { targetId?: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[9999] focus:bg-shiroi-green focus:text-white focus:px-4 focus:py-2 focus:rounded-md focus:text-sm focus:font-semibold focus:shadow-lg focus:outline-none"
    >
      Skip to content
    </a>
  );
}

export { SkipToContent };
