import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Ctrl+스크롤(트랙패드 핀치 포함) 브라우저 줌 전역 차단
document.addEventListener('wheel', (e: WheelEvent) => {
  if (e.ctrlKey) e.preventDefault();
}, { passive: false });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
