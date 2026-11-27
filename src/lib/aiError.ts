import { GeminiError } from './gemini'
import { t } from '../th'

/** ข้อความภาษาไทยสำหรับข้อผิดพลาดของ Gemini พร้อมรายละเอียดโควตาถ้ามี */
export function aiErrorText(e: unknown): string {
  if (!(e instanceof GeminiError)) return t.ai.other
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
  return detail ? `${main}\n${t.ai.quotaId(detail)}` : main
}
