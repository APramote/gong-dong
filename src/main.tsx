import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom'
import './styles.css'
import { t } from './th'
import { LibraryPage } from './pages/LibraryPage'
import { BookFormPage } from './pages/BookFormPage'
import { PlacesPage } from './pages/PlacesPage'
import { PlacePage } from './pages/PlacePage'
import { AddPage } from './pages/AddPage'
import { SettingsPage } from './pages/SettingsPage'

function App() {
  return (
    <HashRouter>
      <header className="topbar">
        <span className="brand">{t.appName}</span>
        <nav>
          <NavLink to="/" end>
            {t.nav.library}
          </NavLink>
          <NavLink to="/places">{t.nav.places}</NavLink>
          <NavLink to="/settings">{t.nav.settings}</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/add" element={<AddPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/book/new" element={<BookFormPage />} />
          <Route path="/book/:id" element={<BookFormPage />} />
          <Route path="/places" element={<PlacesPage />} />
          <Route path="/place/:id" element={<PlacePage />} />
        </Routes>
      </main>
    </HashRouter>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
