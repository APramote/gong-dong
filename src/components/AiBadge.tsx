import { t } from '../th'

/** ป้ายเล็ก ๆ กำกับสิ่งที่ AI สร้างขึ้นเอง (ไม่ใช่ข้อมูลที่ค้นเจอ) */
export function AiBadge() {
  return (
    <span className="ai-badge" title={t.book.aiBadgeHint}>
      {t.book.aiBadge}
    </span>
  )
}
