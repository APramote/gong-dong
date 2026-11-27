import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { t } from '../th'

let update: ((reload?: boolean) => Promise<void>) | null = null
let notify: (() => void) | null = null
let pending = false

// ลงทะเบียน service worker ครั้งเดียว: มีเวอร์ชันใหม่ให้ผู้ใช้กดอัปเดตเอง
// (ไม่โหลดหน้าใหม่อัตโนมัติ กันข้อมูลที่กำลังกรอกหาย)
update = registerSW({
  onNeedRefresh() {
    pending = true
    notify?.()
  },
})

export function UpdateBanner() {
  const [show, setShow] = useState(pending)
  useEffect(() => {
    notify = () => setShow(true)
    return () => {
      notify = null
    }
  }, [])
  if (!show) return null
  return (
    <div className="update-banner" role="status">
      <span>{t.common.updateReady}</span>
      <button className="btn small primary" onClick={() => update?.(true)}>
        {t.common.update}
      </button>
      <button className="btn small" onClick={() => setShow(false)}>
        {t.common.later}
      </button>
    </div>
  )
}
