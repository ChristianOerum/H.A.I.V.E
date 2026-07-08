import type { Config } from 'tailwindcss'

export default {
  darkMode: 'class',
  content: [
    './components/**/*.{vue,js,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './app.vue',
    './adapters/**/*.{vue,ts}',
  ],
  theme: {
    extend: {
      // Color tokens resolve to CSS variables so light/dark can be toggled
      // by switching a single `dark` class on <html>.
      colors: {
        bg: {
          DEFAULT: 'rgb(var(--bg) / <alpha-value>)',
          panel: 'rgb(var(--bg-panel) / <alpha-value>)',
          elevated: 'rgb(var(--bg-elevated) / <alpha-value>)',
        },
        fg: {
          DEFAULT: 'rgb(var(--fg) / <alpha-value>)',
          muted: 'rgb(var(--fg-muted) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          dim: 'rgb(var(--accent-dim) / <alpha-value>)',
        },
      },
      minHeight: { touch: '44px' },
      minWidth: { touch: '44px' },
      // Fixed px radii so corner rounding stays constant regardless of the
      // UI scale (which scales the rem base). Values mirror Tailwind defaults
      // at a 16px root, so appearance is unchanged at 100%.
      borderRadius: {
        none: '0px',
        sm: '2px',
        DEFAULT: '4px',
        md: '6px',
        lg: '8px',
        xl: '12px',
        '2xl': '16px',
        '3xl': '24px',
        full: '9999px',
      },
      fontFamily: {
        sans: ['Axiforma', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config
