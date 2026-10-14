import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './state.css'
import './experience.css'
document.documentElement.classList.add('js-enabled')
createRoot(document.getElementById('root')!).render(<App/>)
