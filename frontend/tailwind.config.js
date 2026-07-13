/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#3b82f6',
        secondary: '#6366f1',
        dark: {
          DEFAULT: '#0f172a',
          panel: '#1e293b',
          hover: '#334155',
        },
      },
      keyframes: {
        fadeInDown: {
          '0%': { opacity: '0', transform: 'translateX(-50%) translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateX(-50%) translateY(0)' },
        },
        timerToastGlow: {
          '0%, 100%': {
            boxShadow: '0 0 0 1px rgba(245,158,11,0.30), 0 8px 32px rgba(0,0,0,0.55)',
          },
          '50%': {
            boxShadow: '0 0 0 2px rgba(251,191,36,0.75), 0 0 18px rgba(245,158,11,0.25), 0 8px 32px rgba(0,0,0,0.55)',
          },
        },
        timerControlHint: {
          '0%, 100%': {
            borderColor: 'rgba(249,115,22,0.4)',
            boxShadow: '0 0 0 0px rgba(249,115,22,0), 0 0 4px rgba(249,115,22,0.15)',
          },
          '50%': {
            borderColor: 'rgba(251,146,60,1)',
            boxShadow: '0 0 0 3px rgba(249,115,22,0.3), 0 0 14px rgba(249,115,22,0.45), 0 0 28px rgba(249,115,22,0.15)',
          },
        },
      },
      animation: {
        'fadeInDown': 'fadeInDown 0.25s ease-out',
        'timerToastGlow': 'timerToastGlow 2.2s ease-in-out infinite',
        'timerControlHint': 'timerControlHint 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
