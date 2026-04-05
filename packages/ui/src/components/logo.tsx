import * as React from 'react';
import { cn } from '../lib/utils';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'mark' | 'full' | 'wordmark';
  className?: string;
}

const SIZES = {
  sm: { mark: 24, text: 'text-xs' },
  md: { mark: 28, text: 'text-sm' },
  lg: { mark: 36, text: 'text-base' },
  xl: { mark: 48, text: 'text-xl' },
};

function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Rounded square background */}
      <rect width="48" height="48" rx="10" fill="#00B050" />
      {/* Stylized S with solar ray accent */}
      <path
        d="M30.5 16.5C30.5 16.5 28.5 13 24 13C19.5 13 16 15.5 16 19C16 22.5 19 23.5 22.5 24.5C26 25.5 28.5 26 28.5 28.5C28.5 31 26 33 23 33C20 33 17.5 31 17.5 31"
        stroke="white"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Solar ray dot accent */}
      <circle cx="33" cy="14" r="2.5" fill="#F0B429" />
    </svg>
  );
}

function Logo({ size = 'md', variant = 'full', className }: LogoProps) {
  const sizeConfig = SIZES[size];

  if (variant === 'mark') {
    return <LogoMark size={sizeConfig.mark} className={className} />;
  }

  if (variant === 'wordmark') {
    return (
      <span
        className={cn(
          'font-brand font-bold uppercase tracking-wider',
          sizeConfig.text,
          className
        )}
      >
        Shiroi Energy
      </span>
    );
  }

  // Full logo: mark + wordmark
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMark size={sizeConfig.mark} />
      <span
        className={cn(
          'font-brand font-bold uppercase tracking-wider',
          sizeConfig.text
        )}
      >
        Shiroi Energy
      </span>
    </div>
  );
}

export { Logo, LogoMark };
export type { LogoProps };
