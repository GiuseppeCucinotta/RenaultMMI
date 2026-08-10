import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { JukeboxProvider } from './context/JukeboxProvider'
import { BluetoothProvider } from './context/BluetoothProvider'
import { I18nProvider } from './i18n'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <BluetoothProvider>
        <JukeboxProvider>
          <App />
        </JukeboxProvider>
      </BluetoothProvider>
    </I18nProvider>
  </React.StrictMode>,
)

// Use contextBridge
window.ipcRenderer?.on('main-process-message', (_event, message) => {
  console.log(message)
})
