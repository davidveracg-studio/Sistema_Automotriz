/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        deep: 'rgb(var(--c-deep) / <alpha-value>)',
        steel: 'rgb(var(--c-steel) / <alpha-value>)',
        sky: 'rgb(var(--c-sky) / <alpha-value>)',
        mist: 'rgb(var(--c-mist) / <alpha-value>)',
        paper: 'rgb(var(--c-paper) / <alpha-value>)',
        brand: {
          accent: 'rgb(var(--c-accent) / <alpha-value>)',
          accentSoft: 'rgb(var(--c-accent-soft) / <alpha-value>)',
          dark: 'rgb(var(--c-dark) / <alpha-value>)',
          carbon: 'rgb(var(--c-carbon) / <alpha-value>)',
        },
        vpai: {
          navy: 'rgb(var(--c-vpai-navy) / <alpha-value>)',
          black: 'rgb(var(--c-vpai-black) / <alpha-value>)',
          silver: 'rgb(var(--c-vpai-silver) / <alpha-value>)',
          skyblue: 'rgb(var(--c-vpai-skyblue) / <alpha-value>)',
          blue: 'rgb(var(--c-vpai-blue) / <alpha-value>)',
        },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
}
