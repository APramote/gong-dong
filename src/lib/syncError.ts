import { t } from '../th'

/** ข้อความภาษาไทยของข้อผิดพลาดตอนซิงก์ */
export function syncErrorText(e: unknown): string {
  const message = (e as Error)?.message ?? ''
  const kind = (e as { kind?: string })?.kind ?? (message === 'bad-file' || message === 'newer-file' ? message : 'other')
  if (kind === 'wrong-account') return t.sync.wrongAccount(message)
  const text = t.sync.errors[kind as keyof typeof t.sync.errors] ?? t.sync.errors.other
  // สาเหตุที่ไม่รู้จัก: แนบรายละเอียดจาก Google ไว้ให้ส่งมาถามได้ (ไม่มีโทเคนหรือข้อมูลส่วนตัวในข้อความนี้)
  return kind === 'other' && message && message !== 'other' ? `${text} (${message})` : text
}
