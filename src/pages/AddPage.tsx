import { useRef, useState, type ChangeEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { emptyBook, repo } from '../db/repo'
import { PlaceSelect } from '../components/PlaceSelect'
import { Scanner } from '../components/Scanner'
import { GeminiError, recognizeBooks } from '../lib/gemini'
import { blobToBase64, resizeImage } from '../lib/image'
import { lookupIsbn } from '../lib/isbn'
import { loadSettings } from '../lib/settings'
import { t } from '../th'

type Mode = 'cover' | 'spine'
interface Row {
  key: number
  include: boolean
  duplicate: boolean
  title: string
  authors: string
  publisher: string
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
let rowKey = 0

export function AddPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const existing = useLiveQuery(() => repo.listBooks(), []) ?? []
  const [placeId, setPlaceId] = useState<string | null>(params.get('place'))
  const [step, setStep] = useState<'menu' | 'busy' | 'review' | 'scan'>('menu')
  const [busyText, setBusyText] = useState('')
  const [error, setError] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [mode, setMode] = useState<Mode>('cover')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const inputs = {
    camera: { cover: useRef<HTMLInputElement>(null), spine: useRef<HTMLInputElement>(null) },
    pick: { cover: useRef<HTMLInputElement>(null), spine: useRef<HTMLInputElement>(null) },
  }

  const hasKey = Boolean(loadSettings().geminiKey && loadSettings().geminiModel)

  async function onPhoto(m: Mode, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // ให้เลือกรูปเดิมซ้ำได้
    if (!file) return
    setMode(m)
    setError('')
    setBusyText(t.add.reading)
    setStep('busy')
    try {
      const { geminiKey, geminiModel } = loadSettings()
      // สันปกต้องการความละเอียดสูงกว่าเพื่ออ่านตัวหนังสือเล็ก
      const image = await resizeImage(file, m === 'spine' ? 2048 : 1280)
      const found = await recognizeBooks(geminiKey, geminiModel, await blobToBase64(image), m)
      if (found.length === 0) {
        setError(t.add.none)
        return setStep('menu')
      }
      const have = new Set(existing.map((b) => norm(b.title)))
      setPhoto(image)
      setRows(
        found.map((b) => {
          const duplicate = have.has(norm(b.title))
          return { key: rowKey++, include: !duplicate, duplicate, ...b }
        }),
      )
      setStep('review')
    } catch (err) {
      setError(t.ai[err instanceof GeminiError ? err.kind : 'other'])
      setStep('menu')
    }
  }

  async function onIsbn(isbn: string) {
    setBusyText(t.book.searching)
    setStep('busy')
    const hit = await lookupIsbn(isbn)
    navigate('/book/new', {
      state: { prefill: { ...(hit ?? { isbn }), placeId }, isbnFound: Boolean(hit) },
    })
  }

  const patch = (key: number, change: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)))

  const chosen = rows.filter((r) => r.include && r.title.trim())

  async function saveAll() {
    const place = placeId ? await repo.getPlace(placeId) : undefined
    // AI อ่านกองจากบนลงล่าง แต่กองเก็บลำดับจากล่างขึ้นบน
    const ordered = mode === 'spine' && place?.kind === 'pile' ? [...chosen].reverse() : chosen
    const ids = await repo.addBooks(
      ordered.map((r) => ({
        ...emptyBook,
        title: r.title.trim(),
        authors: r.authors.trim(),
        publisher: r.publisher.trim(),
        placeId,
      })),
    )
    if (mode === 'cover' && ids.length === 1 && photo) {
      await repo.setCover(ids[0], await resizeImage(photo, 480))
    }
    navigate(placeId ? `/place/${placeId}` : '/', { replace: true })
  }

  if (step === 'busy') return <p className="empty">{busyText}</p>

  if (step === 'scan')
    return <Scanner onDetect={onIsbn} onClose={() => setStep('menu')} />

  if (step === 'review')
    return (
      <div className="form">
        <h1>{t.add.reviewTitle}</h1>
        <p className="muted">{t.add.reviewHint(rows.length)}</p>
        <PlaceSelect label={t.add.dest} value={placeId} onChange={setPlaceId} />
        <ol className="list">
          {rows.map((r) => (
            <li className="row review-row" key={r.key}>
              <input
                type="checkbox"
                aria-label={t.add.include}
                checked={r.include}
                onChange={(e) => patch(r.key, { include: e.target.checked })}
              />
              <div className="review-fields">
                <input
                  aria-label={t.book.title}
                  placeholder={t.book.title}
                  value={r.title}
                  onChange={(e) => patch(r.key, { title: e.target.value })}
                />
                <input
                  aria-label={t.book.authors}
                  placeholder={t.book.authors}
                  value={r.authors}
                  onChange={(e) => patch(r.key, { authors: e.target.value })}
                />
                <input
                  aria-label={t.book.publisher}
                  placeholder={t.book.publisher}
                  value={r.publisher}
                  onChange={(e) => patch(r.key, { publisher: e.target.value })}
                />
                {r.duplicate && <span className="badge badge-reading">{t.add.duplicate}</span>}
              </div>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="btn"
          onClick={() =>
            setRows((rs) => [
              ...rs,
              { key: rowKey++, include: true, duplicate: false, title: '', authors: '', publisher: '' },
            ])
          }
        >
          {t.add.addRow}
        </button>
        <div className="actions">
          <button className="btn primary" disabled={chosen.length === 0} onClick={saveAll}>
            {t.add.saveN(chosen.length)}
          </button>
          <button className="btn" onClick={() => setStep('menu')}>
            {t.add.retake}
          </button>
        </div>
      </div>
    )

  const option = (title: string, hint: string, onClick: () => void, disabled = false) => (
    <button className="option" onClick={onClick} disabled={disabled}>
      <span className="row-title">{title}</span>
      <span className="row-sub">{hint}</span>
    </button>
  )

  return (
    <div className="form">
      <h1>{t.add.title}</h1>
      <PlaceSelect label={t.add.dest} value={placeId} onChange={setPlaceId} />
      {error && <p className="error">{error}</p>}
      {!hasKey && (
        <p className="muted">
          {t.add.needKey} <Link to="/settings" className="link">{t.add.goSettings}</Link>
        </p>
      )}
      {/* ปุ่มหลักเปิดกล้องทันที ส่วน input ชุด pick ใช้เลือกรูปที่ถ่ายไว้แล้ว */}
      {(['cover', 'spine'] as const).flatMap((m) =>
        (['camera', 'pick'] as const).map((src) => (
          <input
            key={m + src}
            ref={inputs[src][m]}
            type="file"
            accept="image/*"
            capture={src === 'camera' ? 'environment' : undefined}
            hidden
            data-mode={m}
            data-src={src}
            onChange={(e) => onPhoto(m, e)}
          />
        )),
      )}
      {option(t.add.photoCover, t.add.photoCoverHint, () => inputs.camera.cover.current?.click(), !hasKey)}
      {option(t.add.photoSpine, t.add.photoSpineHint, () => inputs.camera.spine.current?.click(), !hasKey)}
      {hasKey && (
        <p className="muted">
          {t.add.pickInstead}{' '}
          <button type="button" className="link-btn" onClick={() => inputs.pick.cover.current?.click()}>
            {t.add.pickCover}
          </button>
          {' · '}
          <button type="button" className="link-btn" onClick={() => inputs.pick.spine.current?.click()}>
            {t.add.pickSpine}
          </button>
        </p>
      )}
      {option(t.add.scanIsbn, t.add.scanIsbnHint, () => setStep('scan'))}
      {option(t.add.manual, t.add.manualHint, () =>
        navigate(placeId ? `/book/new?place=${placeId}` : '/book/new'),
      )}
    </div>
  )
}
