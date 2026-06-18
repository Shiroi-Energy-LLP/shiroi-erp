import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Solar Gold brand — gold replaces green as the brand/action hue
        shiroi: {
          gold: '#E08A00',
          'gold-hover': '#C77606',
          'gold-dark': '#B45309', // links / text on light (AA on white)
          'gold-deep': '#7A3D06',
          ink: '#1F1709', // dark ink text on gold fills
          solar: '#F0B429',
          'solar-light': '#F7D070',
          'solar-bg': '#FCF3E2',
          // Deprecated brand-green aliases → repointed to a true STATUS green.
          // Brand-action usages have been swept to `shiroi-gold`; any remaining
          // `shiroi-green*` class is a status signal (won / paid / success).
          green: '#16A34A',
          'green-hover': '#15803D',
          'green-dark': '#15803D',
          'green-deep': '#065F46',
        },
        // Solar Gold neutral scale (warm sand/stone light end, warm near-black darks)
        n: {
          '950': '#16130D',
          '900': '#221C12',
          '800': '#2D3039',
          '700': '#3F424D',
          '600': '#5A5E6B',
          '500': '#7C818E',
          '400': '#9CA0AB',
          '300': '#C2BBAE',
          '200': '#E5DFD3',
          '150': '#EDE8DD',
          '100': '#F4F0E7',
          '050': '#FBF8F2',
        },
        // V2 status semantic colors
        status: {
          'success-bg': '#ECFDF5',
          'success-text': '#065F46',
          'success-border': '#A7F3D0',
          'warning-bg': '#FFFBEB',
          'warning-text': '#92400E',
          'warning-border': '#FDE68A',
          'error-bg': '#FEF2F2',
          'error-text': '#991B1B',
          'error-border': '#FECACA',
          'error-hover': '#FEE2E2',
          'info-bg': '#EFF6FF',
          'info-text': '#1E40AF',
          'info-border': '#BFDBFE',
          'progress-bg': '#FFF7ED',
          'progress-text': '#9A3412',
          'progress-border': '#FED7AA',
          'neutral-bg': '#F3F4F6',
          'neutral-text': '#4B5563',
          'neutral-border': '#D1D5DB',
        },
        // shadcn CSS-var tokens
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
      },
      borderRadius: {
        xl: '16px',
        lg: '12px',
        md: '8px',
        sm: '6px',
        xs: '4px',
      },
      fontFamily: {
        sans: ['var(--font-ibm-plex-sans)', 'IBM Plex Sans', 'system-ui', 'sans-serif'],
        heading: ['var(--font-archivo)', 'Archivo', 'system-ui', 'sans-serif'],
        brand: ['var(--font-rajdhani)', 'Rajdhani', 'system-ui', 'sans-serif'],
        // mono repointed to IBM Plex Sans w/ tabular figures — plain round zero
        // replaces the old JetBrains Mono dotted zero the client disliked.
        mono: ['var(--font-ibm-plex-sans)', 'IBM Plex Sans', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        xs: '0 1px 2px rgba(0,0,0,.05)',
        sm: '0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.04)',
        md: '0 4px 6px -1px rgba(0,0,0,.07), 0 2px 4px -1px rgba(0,0,0,.04)',
        lg: '0 10px 15px -3px rgba(0,0,0,.07), 0 4px 6px -2px rgba(0,0,0,.03)',
      },
      spacing: {
        'sidebar': '240px',
        'sidebar-collapsed': '60px',
        'header': '56px',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
