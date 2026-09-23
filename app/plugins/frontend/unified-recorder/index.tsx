import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './frontend/app'
import { RendererErrorBoundary } from './frontend/rendererErrorBoundary'

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(
    <StrictMode>
      <RendererErrorBoundary><App /></RendererErrorBoundary>
    </StrictMode>,
  )
}

export { App }
