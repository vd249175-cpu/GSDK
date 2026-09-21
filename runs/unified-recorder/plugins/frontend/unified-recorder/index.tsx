import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './frontend/app'

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

export { App }
