import { useState, useSyncExternalStore } from 'react'
import { getState, subscribe, syncNow } from '../lib/autosync'
import { syncErrorText } from '../lib/syncError'
import { t } from '../th'

/** สถานะซิงก์อัตโนมัติ ใช้ได้จากทุกหน้า */
export const useAutoSync = () => useSyncExternalStore(subscribe, getState)

/**
 * แถบเตือนเมื่อมีการแก้ไขที่ยังไม่ได้ซิงก์และแอปซิงก์เองไม่ได้ (สิทธิ์จาก Google หมดอายุ)
 * กดครั้งเดียวเพื่อซิงก์ หลังจากนั้นแอปกลับมาซิงก์เองได้อีกราวหนึ่งชั่วโมง
 */
export function SyncBanner() {
  const state = useAutoSync()
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!state.needsTap || hidden) return null
  return (
    <div className="update-banner" role="status">
      <span>{error || t.sync.pendingBanner}</span>
      <button
        className="btn small primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            await syncNow(true)
          } catch (e) {
            setError(syncErrorText(e))
          }
          setBusy(false)
        }}
      >
        {busy ? t.sync.syncing : t.sync.syncNow}
      </button>
      <button className="btn small" onClick={() => setHidden(true)}>
        {t.common.later}
      </button>
    </div>
  )
}
