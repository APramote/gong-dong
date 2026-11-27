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
import { ReadingPage } from './pages/ReadingPage'
import { ScanStoragePage } from './pages/ScanStoragePage'
import { BookcaseViewPage } from './pages/BookcaseViewPage'
import { OrganizePage } from './pages/OrganizePage'
import { DashboardPage } from './pages/DashboardPage'
import { CategoriesPage } from './pages/CategoriesPage'

function App() {
  return (
    <HashRouter>
      <header className="topbar">
        <span className="brand">{t.appName}</span>
        <nav>
          <NavLink to="/" end>
            {t.nav.library}
          </NavLink>
          <NavLink to="/reading">{t.nav.reading}</NavLink>
          <NavLink to="/stats">{t.nav.stats}</NavLink>
          <NavLink to="/places">{t.nav.places}</NavLink>
          <NavLink to="/settings" aria-label={t.nav.settings} title={t.nav.settings}>
            ⚙
          </NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/add" element={<AddPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/reading" element={<ReadingPage />} />
          <Route path="/scan" element={<ScanStoragePage />} />
          <Route path="/organize" element={<OrganizePage />} />
          <Route path="/stats" element={<DashboardPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/view/bookcase/:id" element={<BookcaseViewPage />} />
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
