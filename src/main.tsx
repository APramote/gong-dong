import { lazy, StrictMode, Suspense, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, NavLink, Outlet, RouterProvider, useRouteError } from 'react-router-dom'
import '@fontsource-variable/noto-serif-thai/wght.css'
import './styles.css'
import { t } from './th'
import { UpdateBanner } from './components/UpdateBanner'
import { LibraryPage } from './pages/LibraryPage'
import { BookFormPage } from './pages/BookFormPage'
import { PlacesPage } from './pages/PlacesPage'
import { PlacePage } from './pages/PlacePage'
import { AddPage } from './pages/AddPage'
import { ReadingPage } from './pages/ReadingPage'

/** หน้าที่ใช้ไม่บ่อยโหลดเมื่อเปิดครั้งแรก ทำให้แอปเปิดเร็วขึ้น */
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })))
const SettingsPage = page(() => import('./pages/SettingsPage'), 'SettingsPage')
const ScanStoragePage = page(() => import('./pages/ScanStoragePage'), 'ScanStoragePage')
const BookcaseViewPage = page(() => import('./pages/BookcaseViewPage'), 'BookcaseViewPage')
const OrganizePage = page(() => import('./pages/OrganizePage'), 'OrganizePage')
const DashboardPage = page(() => import('./pages/DashboardPage'), 'DashboardPage')
const CategoriesPage = page(() => import('./pages/CategoriesPage'), 'CategoriesPage')
const RandomPage = page(() => import('./pages/RandomPage'), 'RandomPage')
const CheckPage = page(() => import('./pages/CheckPage'), 'CheckPage')
const WishlistPage = page(() => import('./pages/WishlistPage'), 'WishlistPage')

/** ไฟล์ของเวอร์ชันเก่าถูกลบไปแล้ว (แอปอัปเดตระหว่างเปิดอยู่) — โหลดหน้าใหม่ครั้งเดียว */
const RELOADED = 'gong-dong.reloaded-for-update'
function reloadOnce(): boolean {
  try {
    if (sessionStorage.getItem(RELOADED)) return false
    sessionStorage.setItem(RELOADED, '1')
  } catch {
    // เก็บค่าไม่ได้ ก็ยังลองโหลดใหม่ได้
  }
  location.reload()
  return true
}
window.addEventListener('vite:preloadError', (e) => {
  if (reloadOnce()) e.preventDefault()
})
window.addEventListener('load', () => {
  // โหลดสำเร็จแล้ว ล้างเครื่องหมาย ให้ครั้งหน้าโหลดใหม่ได้อีก
  setTimeout(() => {
    try {
      sessionStorage.removeItem(RELOADED)
    } catch {
      // ไม่เป็นไร
    }
  }, 5000)
})

// ขอให้เบราว์เซอร์เก็บข้อมูลแบบถาวร ไม่ลบทิ้งเองเมื่อพื้นที่เหลือน้อย (สำคัญบน iOS)
navigator.storage?.persist?.().catch(() => {
  // ไม่อนุญาตก็ใช้งานได้ตามปกติ
})

/** ไอคอนเส้นบางของแถบเมนูล่าง */
const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
)
const ICONS = {
  library: 'M5 4v16M9 4v16M13 5l4 15M19 4v16',
  reading: 'M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5m0-13c2-1.5 5-2 8-1.5v13c-3-.5-6 0-8 1.5m0-13v13',
  stats: 'M5 20V12M10 20V6M15 20v-5M20 20V9',
  places: 'M4 4h16v16H4zM4 9.5h16M4 15h16',
  settings:
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4.4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4.4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
}

function Layout() {
  const tab = (to: string, label: string, icon: string, end = false) => (
    <NavLink to={to} end={end}>
      <Icon d={icon} />
      <span>{label}</span>
    </NavLink>
  )
  return (
    <>
      <header className="topbar">
        <NavLink to="/" className="brand" end>
          {t.appName}
        </NavLink>
        <NavLink to="/settings" className="icon-link" aria-label={t.nav.settings} title={t.nav.settings}>
          <Icon d={ICONS.settings} />
        </NavLink>
      </header>
      <UpdateBanner />
      <main>
        <Suspense fallback={<p className="empty">{t.common.loading}</p>}>
          <Outlet />
        </Suspense>
      </main>
      <nav className="tabbar" aria-label={t.nav.menu}>
        {tab('/', t.nav.library, ICONS.library, true)}
        {tab('/reading', t.nav.reading, ICONS.reading)}
        {tab('/stats', t.nav.stats, ICONS.stats)}
        {tab('/places', t.nav.places, ICONS.places)}
      </nav>
    </>
  )
}

/** เกิดข้อผิดพลาดที่ไม่คาดคิด: แสดงข้อความแทนหน้าว่าง พร้อมปุ่มโหลดใหม่ */
function ErrorPage() {
  const error = useRouteError()
  const chunk = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(String(error))
  if (chunk && reloadOnce()) return null
  return (
    <main>
      <div className="empty">
        <h1>{t.common.errorTitle}</h1>
        <p>{chunk ? t.common.errorUpdate : t.common.errorBody}</p>
        <p>
          <button className="btn primary" onClick={() => location.reload()}>
            {t.common.reload}
          </button>
        </p>
      </div>
    </main>
  )
}

const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <LibraryPage /> },
      { path: 'add', element: <AddPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'reading', element: <ReadingPage /> },
      { path: 'scan', element: <ScanStoragePage /> },
      { path: 'organize', element: <OrganizePage /> },
      { path: 'stats', element: <DashboardPage /> },
      { path: 'categories', element: <CategoriesPage /> },
      { path: 'random', element: <RandomPage /> },
      { path: 'check', element: <CheckPage /> },
      { path: 'wishlist', element: <WishlistPage /> },
      { path: 'view/bookcase/:id', element: <BookcaseViewPage /> },
      { path: 'book/new', element: <BookFormPage /> },
      { path: 'book/:id', element: <BookFormPage /> },
      { path: 'places', element: <PlacesPage /> },
      { path: 'place/:id', element: <PlacePage /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
