import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import './styles/geist-mono.css'
import './styles/globals.css'
import './styles/scrollbar-overlay.css'
import { hydrateIconThemeFromSettings } from './components/icons'
import { hydrateLanguageFromSettings } from './lib/i18n'
import './lib/startup-toast-guard'
import { ensureExtensionUIChannel } from './lib/extension-ui-channel'

ensureExtensionUIChannel()

const App = React.lazy(() => import('./app/app'))

async function bootstrapRenderer(): Promise<void> {
  const [languageHydration, iconThemeHydration] = await Promise.allSettled([
    hydrateLanguageFromSettings(),
    hydrateIconThemeFromSettings(),
  ])
  if (languageHydration.status === 'rejected') {
    console.warn('[i18n] Unable to restore the saved startup language')
  }
  if (iconThemeHydration.status === 'rejected') {
    console.warn('[icons] Unable to restore the saved startup icon theme')
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </React.StrictMode>,
  )
}

void bootstrapRenderer()
