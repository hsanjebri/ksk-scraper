import { useTheme } from '@/store/useTheme'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Stamp the persisted theme before first paint so there's no light flash on
// load for anyone who picked dark.
useTheme.getState().syncResolved()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
