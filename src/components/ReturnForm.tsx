import { useState, type FormEvent } from 'react'
import { repo } from '../db/repo'
import type { Book, ReadingSession } from '../db/types'
import { t } from '../th'
import { PlaceSelect } from './PlaceSelect'

const toNumber = (v: string) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** ฟอร์มวางคืน: วางที่ไหน คั่นไว้หน้าไหน และอ่านจบหรือยัง (เวลาอ่านบันทึกตอนคั่นหน้า) */
export function ReturnForm({
  book,
  placeExists,
  onDone,
  onCancel,
}: {
  book: Book
  /** ไม่ใช้แล้ว คงไว้ให้ผู้เรียกเดิมส่งมาได้ */
  session?: ReadingSession
  placeExists: (id: string) => boolean
  onDone: () => void
  onCancel: () => void
}) {
  const [page, setPage] = useState(book.currentPage?.toString() ?? '')
  // ที่เดิมถูกลบไปแล้ว ให้เริ่มที่ "ยังไม่ระบุที่เก็บ"
  const [placeId, setPlaceId] = useState<string | null>(
    book.takenFrom && placeExists(book.takenFrom) ? book.takenFrom : null,
  )
  // เล่มที่อ่านจบอยู่แล้ว หรือคั่นไว้ถึงหน้าสุดท้าย ถือว่าอ่านจบ (แก้ได้) — หยิบเล่มที่จบแล้วมาเปิดดู วางคืนต้องไม่กลายเป็น "กำลังอ่าน"
  const [finished, setFinished] = useState(
    book.status === 'done' || Boolean(book.pages && book.currentPage && book.currentPage >= book.pages),
  )

  function onPage(v: string) {
    setPage(v)
    const n = toNumber(v)
    if (book.pages && n !== null) setFinished(n >= book.pages)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const n = toNumber(page)
    await repo.returnBook(book.id, {
      placeId,
      // เลขหน้าเกินจำนวนหน้าของเล่ม ใช้หน้าสุดท้าย
      page: n !== null && book.pages ? Math.min(n, book.pages) : n,
      minutes: null,
      finished,
    })
    onDone()
  }

  return (
    <form className="form inline-form" onSubmit={submit}>
      <PlaceSelect label={t.reading.returnTo} value={placeId} onChange={setPlaceId} />
      <label className="narrow">
        {t.reading.page}
        <input inputMode="numeric" value={page} onChange={(e) => onPage(e.target.value)} />
        {book.pages && <span className="muted">{t.reading.ofPages(book.pages)}</span>}
      </label>
      <label className="check">
        <input type="checkbox" checked={finished} onChange={(e) => setFinished(e.target.checked)} />
        {t.reading.finished}
      </label>
      <div className="actions">
        <button type="submit" className="btn primary">
          {t.reading.save}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t.common.cancel}
        </button>
      </div>
    </form>
  )
}
