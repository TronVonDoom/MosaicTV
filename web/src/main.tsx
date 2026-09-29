import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// Self-hosted type: an instance on a LAN with no route to a font CDN still
// renders in its own face. Inter's optical-size axis sharpens the big headings.
import '@fontsource-variable/inter/opsz.css'
import '@fontsource-variable/jetbrains-mono'
// The broadcast face: titles as a network's lower-thirds set them.
import '@fontsource/barlow-condensed/500.css'
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/700.css'
import '@fontsource/barlow-condensed/800.css'
import '@fontsource/barlow-condensed/600-italic.css'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
