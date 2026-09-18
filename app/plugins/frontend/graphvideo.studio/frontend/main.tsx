import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { ApplicationErrorBoundary } from './app/ApplicationErrorBoundary'
import { AppProvider } from './app/AppContext'
import '@graphvideo/workbench/styles/index.css'
import './styles/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApplicationErrorBoundary>
      <AppProvider>
        <App />
      </AppProvider>
    </ApplicationErrorBoundary>
  </StrictMode>,
)
