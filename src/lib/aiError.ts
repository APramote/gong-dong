import { AiError } from './aiCommon'
import { t } from '../th'

/** ซ่อนข้อความที่หน้าตาเหมือน API key ก่อนแสดงให้ผู้ใช้เห็น */
export const redactKeys = (text: string) =>
  text.replace(/AIza[0-9A-Za-z_-]{10,}/g, 'AIza•••').replace(/sk-ant-[0-9A-Za-z_-]{6,}/g, 'sk-ant-•••')

/** ข้อความภาษาไทยสำหรับข้อผิดพลาดของ AI พร้อมรายละเอียดจากผู้ให้บริการถ้ามี */
export function aiErrorText(e: unknown): string {
  if (!(e instanceof AiError)) return t.ai.other
  if (e.kind === 'other')
    return e.message && e.message !== 'other' ? `${t.ai.other}\n${t.ai.detail(redactKeys(e.message))}` : t.ai.other
  if (e.kind !== 'quota' || !e.quota) return t.ai[e.kind]
  const q = e.quota
  const what = q.search ? t.ai.whatSearch : t.ai.whatModel
  const main =
    q.limit === '0'
      ? t.ai.quotaNone(what, q.model)
      : q.period === 'day'
        ? t.ai.quotaDay(what, q.model, q.limit)
        : q.period === 'minute'
          ? t.ai.quotaMinute(what, q.retrySeconds)
          : t.ai.quota
  const detail = [q.id, q.message].filter(Boolean).join(' — ')
  return detail ? `${main}\n${t.ai.detail(redactKeys(detail))}` : main
}
