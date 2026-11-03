import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
// Inter se sirve desde la propia app (no desde Google Fonts): así la IP de quien
// visita no se envía a un tercero solo por cargar la tipografía.
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import './index.css'
import { iniciarCapturaDeErrores } from './lib/uso'

iniciarCapturaDeErrores()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
