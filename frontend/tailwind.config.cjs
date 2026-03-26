/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        olea: {
          50: '#fff7f2',
          100: '#ffe9dc',
          200: '#ffd1b4',
          300: '#ffb080',
          400: '#ff8447',
          500: '#faa139', // accent gold
          600: '#c85a2a',
          700: '#b4482b',
          800: '#9c3d25', // primary burnt orange
          900: '#7b2e1a',
        },
      },
      boxShadow: {
        soft: '0 18px 50px rgba(15,23,42,.08)',
        glow: '0 0 0 6px rgba(250,161,57,.22)',
      },
      borderRadius: {
        xl2: '1.25rem',
      },
      keyframes: {
        floaty: {
          '0%,100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
      animation: {
        floaty: 'floaty 6s ease-in-out infinite',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
