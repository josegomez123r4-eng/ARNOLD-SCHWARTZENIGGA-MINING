import { Buffer } from 'buffer'

// Some TON/browser dependencies expect Node's Buffer global.
// Install it before importing the React application bundle.
;(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer

void import('./app-entry').catch((error: unknown) => {
  const root = document.getElementById('root')
  if (!root) return
  const detail = error instanceof Error ? error.stack || error.message : String(error)
  root.innerHTML = ''
  const panel = document.createElement('main')
  panel.style.cssText = 'min-height:100vh;padding:32px 20px;background:#090909;color:#f4f0e7;font:15px/1.5 Arial,sans-serif'
  const heading = document.createElement('h1')
  heading.textContent = 'ARNOLD no pudo iniciar'
  heading.style.color = '#f0b64b'
  const message = document.createElement('p')
  message.textContent = 'Falló la carga de la aplicación.'
  const pre = document.createElement('pre')
  pre.textContent = detail
  pre.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;padding:14px;background:#1b1711;border:1px solid #8a642e;border-radius:10px'
  panel.append(heading, message, pre)
  root.append(panel)
})
