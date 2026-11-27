import { lazy, StrictMode, Suspense, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, NavLink, Outlet, RouterProvider, useRouteError } from 'react-router-dom'
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

function Layout() {
  return (
    <>
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
      <UpdateBanner />
      <main>
        <Suspense fallback={<p className="empty">{t.common.loading}</p>}>
          <Outlet />
        </Suspense>
      </main>
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
