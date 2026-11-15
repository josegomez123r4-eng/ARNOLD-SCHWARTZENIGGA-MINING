import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

class StartupErrorBoundary extends React.Component<React.PropsWithChildren, { error: string | null }> {
  state = { error: null as string | null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ARNOLD app render failed:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return <main style={{ minHeight: '100vh', padding: '32px 20px', background: '#090909', color: '#f4f0e7', fontFamily: 'sans-serif' }}>
        <h1 style={{ color: '#f0b64b' }}>ARNOLD no pudo iniciar</h1>
        <p>Se produjo un error al cargar la interfaz. El detalle aparece abajo para poder corregirlo.</p>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: 14, background: '#1b1711', border: '1px solid #8a642e', borderRadius: 10 }}>{this.state.error}</pre>
        <button onClick={() => window.location.reload()} style={{ padding: '12px 18px', border: 0, borderRadius: 8, background: '#e7b34e', color: '#171108', fontWeight: 700 }}>RECARGAR</button>
      </main>
    }
    return this.props.children
  }
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  document.body.textContent = 'ARNOLD: no se encontró el contenedor principal (#root).'
} else {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <StartupErrorBoundary><App /></StartupErrorBoundary>
    </React.StrictMode>
  )
}
