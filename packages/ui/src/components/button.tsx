import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-[13px] font-semibold ring-offset-background transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:bg-n-100 disabled:text-n-400 disabled:border-n-200 active:scale-[0.97]',
  {
    variants: {
      variant: {
        default: 'bg-shiroi-green text-white hover:bg-shiroi-green-hover',
        destructive: 'bg-status-error-bg text-status-error-text border border-status-error-border hover:bg-status-error-hover',
        outline: 'border border-shiroi-green border-[1.5px] bg-white text-shiroi-green hover:bg-status-success-bg',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'border border-n-200 bg-white text-n-700 hover:bg-n-050 hover:border-n-300',
        link: 'text-shiroi-green-dark underline-offset-4 hover:underline',
        solar: 'bg-shiroi-solar text-n-950 hover:bg-[#E5A825]',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-2.5 text-xs',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
