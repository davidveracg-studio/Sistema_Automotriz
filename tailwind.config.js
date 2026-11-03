/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // El modo nocturno es la clase "dark" en la envoltura del panel (Layout de
  // App.jsx), no la preferencia del sistema: así funcionan las variantes dark:.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Paleta del panel con el estilo MaterialM (menú, barra superior,
        // tarjetas). El color primario sigue siendo el azul VPAI (brand.accent).
        mm: {
          link: '#2a3547',
          darklink: '#7b8893',
          lightgray: '#f8fafd',
          dark: '#111c2d',
          darkcard: '#1a2537',
          border: '#e0e6eb',
          darkborder: '#333f55',
          success: '#00ceb6',
          warning: '#ffb900',
          error: '#ff6692',
          info: '#46caeb',
          secondary: '#16cdc7',
        },
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
      boxShadow: { mm: '0px 1px 4px 0px rgba(133, 146, 173, 0.2)' },
    },
  },
  plugins: [],
}
