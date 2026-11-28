import { useEffect, useRef, useState } from 'react'
import { repo } from '../db/repo'
import type { Book } from '../db/types'
import { enrich } from '../lib/ai'
import { aiErrorText } from '../lib/aiError'
import { AiError } from '../lib/aiCommon'
import { normalizeIsbn } from '../lib/isbn'
import { t } from '../th'
import { Ring } from './Ring'

/** เล่มที่ยังขาดข้อมูลสำคัญ (เล่มที่ครบแล้วข้ามไป ไม่เปลืองโควตา AI) */
export const needsInfo = (b: Book) => !b.authors || !b.publisher || !b.year || !b.pages || !b.synopsis

/**
 * หาข้อมูลจากอินเทอร์เน็ตให้หลายเล่ม ทีละเล่ม แล้วบันทึกเองทันที (เติมเฉพาะช่องที่ว่าง)
 * หยุดได้ทุกเมื่อ เล่มที่ทำไปแล้วบันทึกไว้แล้ว ออกจากหน้านี้ก็หยุด
 */
export function BulkInfo({ books, onDone }: { books: Book[]; onDone: (message: string) => void }) {
  const todo = books.filter(needsInfo)
  const [run, setRun] = useState<{ done: number; total: number; current: string; wait?: number } | null>(null)
  const stop = useRef(false)
  useEffect(
    () => () => {
      stop.current = true
    },
    [],
  )

  async function start() {
    if (!todo.length || !confirm(t.info.confirm(todo.length, books.length - todo.length))) return
    stop.current = false
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
        setRun({ done, total: todo.length, current: b.title, wait: s })
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
          if (!perMinute || attempt >= 2 || stop.current) throw e
          await pause(Math.min(90, Math.max(10, Math.ceil(e.quota?.retrySeconds ?? 30))), b)
          if (stop.current) throw e
          setRun({ done, total: todo.length, current: b.title })
        }
      }
    }
    for (const b of todo) {
      if (stop.current) break
      setRun({ done, total: todo.length, current: b.title })
      try {
        const r = await ask(b)
        if (!r.found) missing++
        else {
          const { found: _f, isbn, ...rest } = r
          const n = await repo.fillBook(b.id, { ...rest, isbn: normalizeIsbn(isbn) ?? '' })
          if (n) filled++
          else nothing++
        }
        errorsInRow = 0
      } catch (e) {
        failed++
        lastError = e
        // พลาดติดกันสองเล่ม (เช่น โควตาหมด ไม่มีเน็ต key ใช้ไม่ได้) หยุดก่อน ไม่ลองต่อทั้งกอง
        if (++errorsInRow >= 2) break
      } finally {
        // นับว่าทำเล่มนี้แล้ว (ทั้งสำเร็จ ไม่พบ และพลาด รวมเล่มที่ทำให้หยุด)
        done++
      }
    }
    const left = todo.length - done
    setRun(null)
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
      <span className="muted bulk-info-text">{todo.length ? t.info.hint(books.length - todo.length) : t.info.allDone}</span>
      <button className="btn primary" disabled={!todo.length} onClick={start}>
        {t.info.start(todo.length)}
      </button>
    </div>
  )
}
