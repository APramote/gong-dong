/** อ่านค่าความกว้างจากช่องกรอก: ตัวเลขบวกไม่เกิน 1,000 ซม. นอกนั้นถือว่าไม่ระบุ */
export const readWidth = (text: string): number | null => {
  // รับเลขไทยและจุลภาคแทนจุดทศนิยม ข้อความที่ไม่ใช่ตัวเลขล้วนถือว่าไม่ถูกต้อง
  const plain = text.trim().replace(/[๐-๙]/g, (d) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d))).replace(',', '.')
  const n = /^\d+(\.\d+)?$/.test(plain) ? parseFloat(plain) : NaN
  return Number.isFinite(n) && n > 0 && n <= 1000 ? Math.round(n * 10) / 10 : null
}
