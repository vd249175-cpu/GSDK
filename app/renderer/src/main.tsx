import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './studio/app/App'
import { ApplicationErrorBoundary } from './studio/app/ApplicationErrorBoundary'
import { AppProvider } from './studio/app/AppContext'
import '@graphvideo/sdk/workbench/styles.css'
import './studio/styles/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApplicationErrorBoundary>
      <AppProvider>
        <App />
      </AppProvider>
    </ApplicationErrorBoundary>
  </StrictMode>,
)
