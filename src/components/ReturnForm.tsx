import { useState, type FormEvent } from 'react'
import { repo } from '../db/repo'
import type { Book, ReadingSession } from '../db/types'
import { defaultMinutes } from '../lib/stats'
import { t } from '../th'
import { PlaceSelect } from './PlaceSelect'

const toNumber = (v: string) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** ฟอร์มวางคืน: หน้าที่คั่น ที่วางคืน เวลาอ่าน และอ่านจบหรือยัง */
export function ReturnForm({
  book,
  session,
  placeExists,
  onDone,
  onCancel,
}: {
  book: Book
  session: ReadingSession | undefined
  placeExists: (id: string) => boolean
  onDone: () => void
  onCancel: () => void
}) {
  const [page, setPage] = useState(book.currentPage?.toString() ?? '')
  // ที่เดิมถูกลบไปแล้ว ให้เริ่มที่ "ยังไม่ระบุที่เก็บ"
  const [placeId, setPlaceId] = useState<string | null>(
    book.takenFrom && placeExists(book.takenFrom) ? book.takenFrom : null,
  )
  const [minutes, setMinutes] = useState(() => {
    const m = session ? defaultMinutes(session) : null
    return m === null ? '' : String(m)
  })
  const [finished, setFinished] = useState(false)

  function onPage(v: string) {
    setPage(v)
    const n = toNumber(v)
    if (book.pages && n !== null) setFinished(n >= book.pages)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    await repo.returnBook(book.id, {
      placeId,
      page: toNumber(page),
      minutes: toNumber(minutes),
      finished,
    })
    onDone()
  }

  return (
    <form className="form inline-form" onSubmit={submit}>
      <div className="cols">
        <label>
          {t.reading.page}
          <input inputMode="numeric" autoFocus value={page} onChange={(e) => onPage(e.target.value)} />
          {book.pages && <span className="muted">{t.reading.ofPages(book.pages)}</span>}
        </label>
        <label>
          {t.reading.minutes}
          <input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </label>
      </div>
      <p className="muted">{t.reading.minutesHint}</p>
      <PlaceSelect label={t.reading.returnTo} value={placeId} onChange={setPlaceId} />
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
