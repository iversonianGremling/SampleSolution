/** @type {import('tailwindcss').Config} */
const colorWithOpacity = (cssVariable) => `rgb(var(${cssVariable}) / <alpha-value>)`

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'surface-base': colorWithOpacity('--color-surface-base-rgb'),
        'surface-raised': colorWithOpacity('--color-surface-raised-rgb'),
        'surface-overlay': colorWithOpacity('--color-surface-overlay-rgb'),
        'surface-border': colorWithOpacity('--color-surface-border-rgb'),
        'accent-primary': colorWithOpacity('--color-accent-primary-rgb'),
        'accent-secondary': colorWithOpacity('--color-accent-secondary-rgb'),
        'accent-muted': colorWithOpacity('--color-text-muted-rgb'),
        'accent-warm': colorWithOpacity('--color-accent-warm-rgb'),
        'accent-warm-dim': colorWithOpacity('--color-accent-warm-dim-rgb'),
        'text-primary': colorWithOpacity('--color-text-primary-rgb'),
        'text-secondary': colorWithOpacity('--color-text-secondary-rgb'),
        'text-muted': colorWithOpacity('--color-text-muted-rgb'),
      },
      fontFamily: {
        sans: ['var(--app-font-family-sans)', 'Outfit', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'fade-in': 'fadeIn 300ms ease-out',
        'slide-down': 'slideDown 300ms ease-out',
        'slide-up': 'slideUp 300ms ease-out',
        'slide-left': 'slideLeft 300ms ease-out',
        'slide-right': 'slideRight 300ms ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideLeft: {
          '0%': { opacity: '0', transform: 'translateX(8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideRight: {
          '0%': { opacity: '0', transform: 'translateX(-8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [],
}
