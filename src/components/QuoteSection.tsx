import { useRef, useState, type ChangeEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import type { Quote } from '../db/types'
import { aiOn, aiReady, readPage } from '../lib/ai'
import { aiErrorText } from '../lib/aiError'
import { blobToBase64, resizeImage } from '../lib/image'
import { t } from '../th'

/** การ์ดประโยคหนึ่งอัน ใช้ทั้งในหน้าหนังสือและหน้ารวมประโยค */
export function QuoteCard({ quote, source }: { quote: Quote; source?: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  return (
    <figure className="quote">
      <blockquote>{quote.text}</blockquote>
      <figcaption>
        <span className="row-sub">
          {source}
          {source && quote.page ? ' · ' : ''}
          {quote.page ? t.quotes.onPage(quote.page) : ''}
          {quote.note && <span className="quote-note"> — {quote.note}</span>}
        </span>
        <span className="quote-actions">
          <button
            type="button"
            className="link-btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(quote.text)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              } catch {
                // คัดลอกไม่ได้ (เบราว์เซอร์ไม่อนุญาต) ไม่ต้องทำอะไร
              }
            }}
          >
            {copied ? t.quotes.copied : t.quotes.copy}
          </button>
          <button
            type="button"
            className="link-btn danger-text"
            onClick={() => confirm(t.quotes.confirmDelete) && repo.deleteQuote(quote.id)}
          >
            {t.common.delete}
          </button>
        </span>
      </figcaption>
    </figure>
  )
}

/** ประโยคที่ชอบของหนังสือหนึ่งเล่ม: พิมพ์เอง หรือถ่ายหน้าหนังสือให้ AI อ่าน */
export function QuoteSection({ bookId }: { bookId: string }) {
  const quotes = useLiveQuery(() => repo.listQuotes(bookId), [bookId]) ?? []
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [page, setPage] = useState('')
  const [paragraphs, setParagraphs] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const camera = useRef<HTMLInputElement>(null)
  const canPhoto = aiOn() && aiReady()

  const reset = () => {
    setText('')
    setPage('')
    setParagraphs([])
    setError('')
    setOpen(false)
  }

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setOpen(true)
    setBusy(true)
    setError('')
    try {
      // ตัวหนังสือบนหน้ากระดาษเล็ก ต้องใช้รูปละเอียด
      const res = await readPage(await blobToBase64(await resizeImage(file, 2048)))
      if (res.paragraphs.length === 0) setError(t.quotes.noText)
      setParagraphs(res.paragraphs)
      if (res.page && !page) setPage(String(res.page))
      if (res.paragraphs.length === 1 && !text) setText(res.paragraphs[0])
    } catch (err) {
      setError(aiErrorText(err))
    }
    setBusy(false)
  }

  async function save() {
    if (!text.trim()) return
    const n = parseInt(page, 10)
    await repo.addQuote({ bookId, text, page: Number.isFinite(n) && n > 0 ? n : null, note: '' })
    reset()
  }

  return (
    <section className="quotes">
      <h2>{t.quotes.title}</h2>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
      {quotes.length === 0 && !open && <p className="muted">{t.quotes.bookEmpty}</p>}
      {quotes.map((q) => (
        <QuoteCard key={q.id} quote={q} />
      ))}

      {open ? (
        <div className="form card">
          {busy && <p className="muted">{t.quotes.reading}</p>}
          {error && <p className="error">{error}</p>}
          {paragraphs.length > 1 && (
            <>
              <p className="muted">{t.quotes.pickHint}</p>
              <div className="para-pick">
                {paragraphs.map((p, i) => (
                  <button
                    type="button"
                    key={i}
                    className={text.includes(p) ? 'on' : ''}
                    onClick={() => setText((cur) => (cur.includes(p) ? cur : cur ? `${cur}\n${p}` : p))}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </>
          )}
          <label>
            {t.quotes.text}
            <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <label className="narrow">
            {t.quotes.page}
            <input inputMode="numeric" value={page} onChange={(e) => setPage(e.target.value)} />
          </label>
          <div className="actions">
            <button type="button" className="btn primary" disabled={!text.trim()} onClick={save}>
              {t.common.save}
            </button>
            {canPhoto && (
              <button type="button" className="btn" disabled={busy} onClick={() => camera.current?.click()}>
                {t.quotes.photo}
              </button>
            )}
            <button type="button" className="btn" onClick={reset}>
              {t.common.cancel}
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button type="button" className="btn" onClick={() => setOpen(true)}>
            {t.quotes.add}
          </button>
          {canPhoto && (
            <button type="button" className="btn" onClick={() => camera.current?.click()}>
              {t.quotes.photo}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
