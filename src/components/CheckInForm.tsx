import { useState, type FormEvent } from 'react'
import { repo } from '../db/repo'
import type { Book } from '../db/types'
import { formatMinutes } from '../lib/stats'
import { t } from '../th'

const QUICK = [15, 30, 60]

/**
 * คั่นหน้า: อ่านถึงหน้าไหน และ (ถ้าอยากบอก) อ่านไปนานแค่ไหน
 * ไม่ใส่เวลา แอปใช้เวลาที่จับไว้ หรือประมาณจากจำนวนหน้า
 */
export function CheckInForm({
  book,
  timerMinutes,
  onDone,
  onCancel,
}: {
  book: Book
  /** เวลาที่จับไว้ (นาที) — 0 คือไม่ได้จับ */
  timerMinutes: number
  onDone: () => void
  onCancel: () => void
}) {
  const [page, setPage] = useState(book.currentPage?.toString() ?? '')
  /** null = ให้แอปคิดให้ (เวลาที่จับไว้ หรือประมาณ) */
  const [minutes, setMinutes] = useState<number | null>(null)
  const [custom, setCustom] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const blank = page.trim() === ''
  const n = parseInt(page, 10)
  const tooFar = Boolean(book.pages && Number.isFinite(n) && n > book.pages)
  const pageOk = blank || (Number.isFinite(n) && n >= 0 && !tooFar)
  const typed = parseInt(custom, 10)
  const chosen = Number.isFinite(typed) && typed > 0 ? Math.min(typed, 1440) : minutes
  // ต้องมีอะไรให้บันทึก: หน้าเปลี่ยน ใส่เวลา หรือมีเวลาที่จับไว้
  const changed = (!blank && n !== book.currentPage) || chosen !== null || timerMinutes > 0
  const valid = pageOk && changed

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || saving) return
    setSaving(true)
    setError('')
    try {
      await repo.checkIn(book.id, { page: blank ? null : n, minutes: chosen })
      onDone()
    } catch {
      setError(t.reading.saveFailed)
      setSaving(false)
    }
  }

  const chip = (value: number | null, label: string) => (
    <button
      type="button"
      key={value ?? 'auto'}
      className={minutes === value && !custom ? 'on' : ''}
      aria-pressed={minutes === value && !custom}
      onClick={() => {
        setMinutes(value)
        setCustom('')
      }}
    >
      {label}
    </button>
  )

  return (
    <form className="form inline-form" onSubmit={submit}>
      <label className="narrow">
        {t.reading.checkInPage}
        <input
          inputMode="numeric"
          autoFocus
          aria-invalid={tooFar}
          value={page}
          onChange={(e) => setPage(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
        {tooFar ? (
          <span className="error" role="alert">
            {t.reading.pageTooFar(book.pages!)}
          </span>
        ) : (
          book.pages && <span className="muted">{t.reading.ofPages(book.pages)}</span>
        )}
      </label>
      <div>
        <span className="muted">{t.reading.howLong}</span>
        <div className="chips" role="group" aria-label={t.reading.howLong}>
          {chip(null, timerMinutes > 0 ? t.reading.timed(formatMinutes(timerMinutes)) : t.reading.autoTime)}
          {QUICK.map((m) => chip(m, t.reading.minutesN(m)))}
          <input
            className="chip-input"
            inputMode="numeric"
            placeholder={t.reading.otherMinutes}
            aria-label={t.reading.otherMinutes}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={!valid || saving}>
          {t.reading.saveCheckIn}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t.common.cancel}
        </button>
      </div>
    </form>
  )
}
