import { useEffect, useRef, useState } from 'react'
import { repo } from '../db/repo'
import type { Book } from '../db/types'
import { enrich } from '../lib/ai'
import { aiErrorText } from '../lib/aiError'
import { AiError } from '../lib/aiCommon'
import { normalizeIsbn } from '../lib/isbn'
import { makeCover } from '../lib/aiCover'
import { t } from '../th'
import { Ring } from './Ring'

/** เล่มที่ยังขาดข้อมูลสำคัญ (เล่มที่ครบแล้วข้ามไป ไม่เปลืองโควตา AI) */
export const needsInfo = (b: Book) => !b.authors || !b.publisher || !b.year || !b.pages || !b.synopsis

/**
 * เล่มที่หาไปแล้วเมื่อไม่นาน (จำไว้ในเครื่องนี้ 30 วัน): AI หาได้ไม่ครบทุกช่องก็ไม่ถามซ้ำทุกรอบ
 * ถ้าผู้ใช้แก้เล่มนั้นหลังจากหา (updatedAt ใหม่กว่า) ถือว่าหาใหม่ได้
 */
const CHECKED_KEY = 'gong-dong.infoChecked'
const CHECK_DAYS = 30
function loadChecked(): Record<string, number> {
  try {
    const o = JSON.parse(localStorage.getItem(CHECKED_KEY) ?? '{}')
    return o && typeof o === 'object' ? o : {}
  } catch {
    return {}
  }
}
function markChecked(id: string) {
  try {
    const all = loadChecked()
    const cutoff = Date.now() - CHECK_DAYS * 86400000
    for (const k of Object.keys(all)) if (all[k] < cutoff) delete all[k]
    all[id] = Date.now()
    localStorage.setItem(CHECKED_KEY, JSON.stringify(all))
  } catch {
    // จำไม่ได้ก็แค่หาซ้ำได้
  }
}
const recentlyChecked = (b: Book, checked: Record<string, number>) => {
  const at = checked[b.id]
  return Boolean(at && at > Date.now() - CHECK_DAYS * 86400000 && b.updatedAt <= at + 5000)
}

/** สัญญาณภายใน: ผู้ใช้กดหยุดระหว่างรอโควตา (ไม่นับว่าพลาด) */
const STOPPED = Symbol('stopped')

/**
 * หาข้อมูลจากอินเทอร์เน็ตให้หลายเล่ม ทีละเล่ม แล้วบันทึกเองทันที (เติมเฉพาะช่องที่ว่าง)
 * หยุดได้ทุกเมื่อ เล่มที่ทำไปแล้วบันทึกไว้แล้ว ออกจากหน้านี้ก็หยุด
 */
export function BulkInfo({
  books,
  onDone,
  onRunning,
}: {
  books: Book[]
  onDone: (message: string) => void
  onRunning?: (running: boolean) => void
}) {
  const checked = loadChecked()
  const lacking = books.filter(needsInfo)
  const todo = lacking.filter((b) => !recentlyChecked(b, checked))
  const recent = lacking.length - todo.length
  const [run, setRun] = useState<{ done: number; total: number; current: string; wait?: number } | null>(null)
  const stop = useRef(false)
  /** ยังแสดงอยู่ (ออกจากหน้าแล้วไม่สรุปผล ไม่ไปแตะหน้าที่ปิดไปแล้ว) */
  const alive = useRef(true)
  useEffect(
    () => {
      alive.current = true
      return () => {
        stop.current = true
        alive.current = false
        onRunning?.(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  async function start() {
    if (!todo.length || !confirm(t.info.confirm(todo.length, books.length - todo.length))) return
    stop.current = false
    onRunning?.(true)
    // ทำตามรายการตอนกดเริ่ม (ระหว่างทำ การเลือกถูกล็อกไว้)
    const list = [...todo]
    let filled = 0
    let nothing = 0
    let missing = 0
    let failed = 0
    let errorsInRow = 0
    let lastError: unknown = null
    let done = 0
    /** รอแบบหยุดได้ นับถอยหลังให้เห็น */
    const pause = async (seconds: number, b: Book) => {
      for (let s = seconds; s > 0 && !stop.current; s--) {
        if (alive.current) setRun({ done, total: list.length, current: b.title, wait: s })
        await new Promise((z) => setTimeout(z, 1000))
      }
    }
    /** ถามทีละเล่ม: ติดโควตารายนาที รอจนครบเวลาแล้วลองเล่มเดิมใหม่ (สูงสุด 3 ครั้ง) ไม่นับว่าพลาด */
    const ask = async (b: Book) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await enrich(b)
        } catch (e) {
          const perMinute = e instanceof AiError && e.kind === 'quota' && e.quota?.period === 'minute'
          if (stop.current) return STOPPED
          if (!perMinute || attempt >= 2) throw e
          await pause(Math.min(90, Math.max(10, Math.ceil(e.quota?.retrySeconds ?? 30))), b)
          if (stop.current) return STOPPED
          if (alive.current) setRun({ done, total: list.length, current: b.title })
        }
      }
    }
    for (const b of list) {
      if (stop.current) break
      if (alive.current) setRun({ done, total: list.length, current: b.title })
      try {
        const r = await ask(b)
        if (r === STOPPED) break
        if (!r.found) missing++
        else {
          const { found: _f, isbn, ...rest } = r
          // เล่มที่ยังไม่มีรูปปก: สร้างปกจำลอง (มีแถบกำกับ AI ในรูป)
          let coverAi = false
          if (!(await repo.getCover(b.id))) {
            try {
              await repo.setCover(b.id, await makeCover(b.title, b.authors || rest.authors, rest.coverColor))
              coverAi = true
            } catch {
              // วาดปกไม่ได้ ข้ามไป ข้อมูลอื่นยังเติมได้
            }
          }
          const n = await repo.fillBook(b.id, { ...rest, isbn: normalizeIsbn(isbn) ?? '', coverAi })
          if (n) filled++
          else nothing++
        }
        // จำว่าหาเล่มนี้แล้วหลังบันทึกสำเร็จเท่านั้น (บันทึกพลาดจะได้ลองใหม่รอบหน้า)
        markChecked(b.id)
        errorsInRow = 0
      } catch (e) {
        failed++
        lastError = e
        // พลาดติดกันสองเล่ม (เช่น โควตาหมด ไม่มีเน็ต key ใช้ไม่ได้) หยุดก่อน ไม่ลองต่อทั้งกอง
        if (++errorsInRow >= 2) {
          done++
          break
        }
      }
      // นับว่าทำเล่มนี้แล้ว (สำเร็จ ไม่พบ หรือพลาด) — เล่มที่กดหยุดกลางทางไม่นับ
      done++
    }
    const left = list.length - done
    if (!alive.current) return
    setRun(null)
    onRunning?.(false)
    onDone(
      [t.info.result(filled, nothing, missing, failed), left ? t.info.left(left) : '', lastError && failed ? aiErrorText(lastError) : '']
        .filter(Boolean)
        .join('\n'),
    )
  }

  if (run)
    return (
      <div className="bulk-info" role="status">
        <Ring value={run.total ? run.done / run.total : undefined} />
        <span className="bulk-info-text">
          {t.info.progress(run.done + 1, run.total)}
          <span className="muted">{run.wait ? t.info.waiting(run.wait) : run.current}</span>
        </span>
        <button className="btn" onClick={() => (stop.current = true)}>
          {t.info.stop}
        </button>
      </div>
    )
  return (
    <div className="bulk-info">
      <span className="muted bulk-info-text">{todo.length ? t.info.hint(books.length - lacking.length, recent) : recent ? t.info.allRecent : t.info.allDone}</span>
      <button className="btn primary" disabled={!todo.length} onClick={start}>
        {t.info.start(todo.length)}
      </button>
    </div>
  )
}
