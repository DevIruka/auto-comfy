import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { WorkspaceProvider } from './context/WorkspaceContext.tsx'
import { LoraListProvider } from './context/LoraListContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkspaceProvider>
      <LoraListProvider>
        <App />
      </LoraListProvider>
    </WorkspaceProvider>
  </StrictMode>,
)
