import { useDeferredValue, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import { BookRow } from '../components/BookRow'
import { Scanner } from '../components/Scanner'
import { aiOn, aiReady, covers } from '../lib/ai'
import { aiErrorText } from '../lib/aiError'
import { blobToBase64, resizeImage } from '../lib/image'
import { lookupIsbn, normalizeIsbn } from '../lib/isbn'
import { findMatches } from '../lib/picks'
import { placeLabel } from '../placeLabel'
import { t } from '../th'

/** เล่มที่กำลังเช็ก: ชื่อเรื่องที่พิมพ์ หรือได้จากบาร์โค้ด/ปก */
interface Target {
  title: string
  authors: string
  isbn: string
}

export function CheckPage() {
  const navigate = useNavigate()
  const books = useLiveQuery(() => repo.listBooks(), [])
  const wishes = useLiveQuery(() => repo.listWishes(), []) ?? []
  const places = useLiveQuery(() => repo.listPlaces(), []) ?? []
  const bookcases = useLiveQuery(() => repo.listBookcases(), []) ?? []
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  // ข้อมูลเพิ่มจากบาร์โค้ดหรือปก (ผู้แต่ง ISBN) ใช้ตอนเพิ่มลงรายการอยากได้
  const [extra, setExtra] = useState<Omit<Target, 'title'>>({ authors: '', isbn: '' })
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [added, setAdded] = useState(false)
  const camera = useRef<HTMLInputElement>(null)

  const target: Target = useMemo(() => {
    const isbn = normalizeIsbn(deferred)
    return isbn ? { title: '', authors: '', isbn } : { title: deferred.trim(), ...extra }
  }, [deferred, extra])
  const result = useMemo(
    () => (target.title || target.isbn ? findMatches(target, books ?? [], wishes) : null),
    [target, books, wishes],
  )
  if (!books) return <p className="empty">{t.common.loading}</p>

  const fill = (next: Target) => {
    setQuery(next.title || next.isbn)
    setExtra({ authors: next.authors, isbn: next.isbn })
    setAdded(false)
  }

  async function onIsbn(isbn: string) {
    setScanning(false)
    setBusy(t.check.lookingUp)
    const hit = await lookupIsbn(isbn)
    setBusy('')
    // เช็กทั้ง ISBN และชื่อ เล่มในคลังอาจยังไม่ได้ใส่ ISBN
    fill({ title: hit?.title ?? '', authors: hit?.authors ?? '', isbn })
  }

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    setBusy(t.check.reading)
    try {
      const found = await covers(await blobToBase64(await resizeImage(file, 1280)))
      if (found[0]) fill({ title: found[0].title, authors: found[0].authors, isbn: '' })
      else setError(t.check.noRead)
    } catch (err) {
      setError(aiErrorText(err))
    }
    setBusy('')
  }

  const where = (placeId: string | null, takenAt: number | null) => {
    if (takenAt) return t.library.inHand
    const p = placeId && places.find((x) => x.id === placeId)
    return p ? placeLabel(p, bookcases) : t.library.noPlace
  }

  if (scanning) return <Scanner onDetect={onIsbn} onClose={() => setScanning(false)} />

  const canWish = Boolean(target.title || target.isbn)

  return (
    <div className="form">
      <div>
        <h1>{t.check.title}</h1>
        <p className="muted">{t.check.lead}</p>
      </div>
      <input
        type="search"
        placeholder={t.check.search}
        aria-label={t.check.search}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setExtra({ authors: '', isbn: '' })
          setAdded(false)
        }}
      />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
      <div className="actions">
        <button className="btn" onClick={() => setScanning(true)}>
          {t.check.scan}
        </button>
        {aiOn() && aiReady() && (
          <button className="btn" onClick={() => camera.current?.click()}>
            {t.check.photo}
          </button>
        )}
      </div>
      {busy && <p className="muted">{busy}</p>}
      {error && <p className="error">{error}</p>}

      {result && !busy && (
        <>
          {result.owned.length > 0 ? (
            <div className="verdict owned" role="status">
              <strong>{t.check.owned}</strong>
              <span>{t.check.ownedHint}</span>
            </div>
          ) : result.wished.length > 0 ? (
            <div className="verdict wished" role="status">
              <strong>{t.check.wished}</strong>
              <span>{t.check.wishedHint}</span>
            </div>
          ) : (
            <div className="verdict fresh" role="status">
              <strong>{t.check.fresh}</strong>
              <span>{t.check.freshHint}</span>
            </div>
          )}

          {result.owned.length > 0 && (
            <ul className="list">
              {result.owned.slice(0, 5).map((b) => (
                <BookRow key={b.id} book={b} sub={where(b.placeId, b.takenAt)} />
              ))}
            </ul>
          )}

          {result.owned.length === 0 &&
            result.wished.map((w) => (
              <div className="actions" key={w.id}>
                <span className="row-sub">{w.title}</span>
                <button
                  className="btn primary small"
                  onClick={async () => {
                    const id = await repo.wishToBook(w.id)
                    if (id) navigate(`/book/${id}`)
                  }}
                >
                  {t.check.bought}
                </button>
              </div>
            ))}

          {result.owned.length === 0 && result.wished.length === 0 && canWish && (
            <p className="actions">
              {added ? (
                <span className="muted">
                  {t.check.wishAdded} · <Link to="/wishlist" className="link">{t.wish.title}</Link>
                </span>
              ) : (
                <button
                  className="btn"
                  onClick={async () => {
                    await repo.addWish({ title: target.title || target.isbn, authors: target.authors, isbn: target.isbn, note: '' })
                    setAdded(true)
                  }}
                >
                  {t.check.addWish}
                </button>
              )}
            </p>
          )}
        </>
      )}
    </div>
  )
}
