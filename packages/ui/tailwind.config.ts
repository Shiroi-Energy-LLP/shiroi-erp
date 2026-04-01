import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // V2 Shiroi brand
        shiroi: {
          green: '#00B050',
          'green-hover': '#009945',
          'green-dark': '#007A38',
          'green-deep': '#004D22',
          solar: '#F0B429',
          'solar-light': '#F7D070',
          'solar-bg': '#FEF8E7',
        },
        // V2 neutral scale (desaturated warm-gray)
        n: {
          '950': '#111318',
          '900': '#1A1D24',
          '800': '#2D3039',
          '700': '#3F424D',
          '600': '#5A5E6B',
          '500': '#7C818E',
          '400': '#9CA0AB',
          '300': '#BFC3CC',
          '200': '#DFE2E8',
          '150': '#EBEDF2',
          '100': '#F2F4F7',
          '050': '#F8F9FB',
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
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        heading: ['var(--font-dm-sans)', 'DM Sans', 'system-ui', 'sans-serif'],
        brand: ['var(--font-rajdhani)', 'Rajdhani', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains-mono)', 'JetBrains Mono', 'monospace'],
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
  plugins: [require('tailwindcss-animate')],
};

export default config;
