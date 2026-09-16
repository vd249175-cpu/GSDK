import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { VisualizerApp } from './VisualizerApp'
import './visualizer.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VisualizerApp />
  </StrictMode>,
)
