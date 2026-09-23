import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Las rutas públicas (login, invitaciones, encuestas de postventa) y los
      // archivos estáticos deben quedar fuera del service worker: si se
      // interceptan, cualquier página que no sea la app queda rota.
      workbox: {
        navigateFallbackDenylist: [/^\/publico/, /^\/encuesta/, /^\/api/],
      },
      includeAssets: ['icono-vpai.png'],
      manifest: {
        name: 'VPAI CRM',
        short_name: 'VPAI',
        description: 'Plataforma de gestión para talleres automotrices — demo',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [
          { src: '/icono-vpai.png', sizes: '192x192', type: 'image/png' },
          { src: '/icono-vpai.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
})
