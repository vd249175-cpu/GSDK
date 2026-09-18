import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { ApplicationErrorBoundary } from './app/ApplicationErrorBoundary'
import { AppProvider } from './app/AppContext'
import { disposeApplicationServices } from './app/services'
import '@graphvideo/workbench/styles/index.css'
import '@graphvideo/theme/index.css'
import './styles/index.css'

const root = createRoot(document.getElementById('root')!)
// Detach React subscribers before the service cleanup releases UI runtimes.
window.addEventListener('beforeunload', () => { root.unmount(); disposeApplicationServices() }, { once: true })
root.render(
  <StrictMode>
    <ApplicationErrorBoundary>
      <AppProvider>
        <App />
      </AppProvider>
    </ApplicationErrorBoundary>
  </StrictMode>,
)
