import { lazy, Suspense, useRef, useState, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { emptyBook, repo, type BookInput } from '../db/repo'
import type { Look } from '../db/types'
import { BookRowsEditor, chosen, toRows, type EditRow } from '../components/BookRowsEditor'
import { aiReady, scan } from '../lib/ai'
import { useBlobUrl } from '../components/Cover'
import type { StorageKind } from '../lib/aiCommon'
import { aiErrorText } from '../lib/aiError'
import { blobToBase64, resizeImage } from '../lib/image'
import { t } from '../th'

const Storage3D = lazy(() => import('../three/Storage3D'))

const DEFAULT_COLOR: Record<StorageKind, string> = { bookcase: '#8b6a4e', pile: '#a58a6a', box: '#b8895a' }

/** ถ่ายรูปตู้ กอง หรือกล่อง ให้ AI อ่านโครงสร้างและหนังสือ แล้วตรวจสอบก่อนสร้าง */
export function ScanStoragePage() {
  const navigate = useNavigate()
  const existing = useLiveQuery(() => repo.listBooks(), []) ?? []
  const [step, setStep] = useState<'menu' | 'busy' | 'review'>('menu')
  const [error, setError] = useState('')
  const [kind, setKind] = useState<StorageKind>('bookcase')
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [label, setLabel] = useState('')
  const [look, setLook] = useState<Look>({ color: '', ratio: 0 })
  /** ตู้: หลายชั้นบนลงล่าง / กอง: ชั้นเดียวบนลงล่าง / กล่อง: ชั้นเดียว */
  const [shelves, setShelves] = useState<EditRow[][]>([])
  const [photo, setPhoto] = useState<Blob | null>(null)
  const camera = useRef<Record<StorageKind, HTMLInputElement | null>>({ bookcase: null, pile: null, box: null })
  const gallery = useRef<HTMLInputElement>(null)
  const ready = aiReady()
  const photoUrl = useBlobUrl(photo)

  async function onPhoto(k: StorageKind, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setKind(k)
    setError('')
    setStep('busy')
    try {
      // ตู้ทั้งตู้มีตัวหนังสือเล็กมาก ใช้ความละเอียดสูงสุด
      const image = await resizeImage(file, 2400)
      const result = await scan(await blobToBase64(image), k)
      const titles = existing.map((b) => b.title)
      setPhoto(image)
      setLook({ color: result.color || DEFAULT_COLOR[k], ratio: result.ratio })
      setName(k === 'box' && result.label ? result.label : t.scan.defaultName[k])
      setLabel(result.label)
      setLocation('')
      const rows = result.shelves.map((s) => toRows(s.books, titles))
      setShelves(k === 'bookcase' ? (rows.length ? rows : [[]]) : [rows.flat()])
      setStep('review')
    } catch (err) {
      setError(aiErrorText(err))
      setStep('menu')
    }
  }

  const total = shelves.reduce((n, rows) => n + chosen(rows).length, 0)
  const toBook = (r: EditRow): BookInput => ({
    ...emptyBook,
    title: r.title.trim(),
    authors: r.authors.trim(),
    publisher: r.publisher.trim(),
    spineColor: r.color ?? '',
  })

  async function create() {
    const finalName = name.trim() || t.scan.defaultName[kind]
    let id: string
    let to: string
    if (kind === 'bookcase') {
      id = await repo.addBookcaseWithBooks(
        { name: finalName, room: location.trim() },
        look,
        shelves.map((rows) => chosen(rows).map(toBook)),
      )
      to = `/view/bookcase/${id}`
    } else {
      // AI อ่านกองจากบนลงล่าง แต่กองเก็บลำดับจากล่างขึ้นบน
      const books = chosen(shelves[0] ?? []).map(toBook)
      id = await repo.addPlaceWithBooks(
        kind,
        { name: finalName, location: location.trim(), label: kind === 'box' ? label.trim() : '' },
        look,
        kind === 'pile' ? books.reverse() : books,
      )
      to = `/place/${id}`
    }
    if (photo) await repo.setCover(id, await resizeImage(photo, 1024, 0.8))
    navigate(to, { replace: true })
  }

  if (step === 'busy') return <p className="empty">{t.scan.reading}</p>

  if (step === 'review') {
    const preview = (rows: EditRow[]) =>
      chosen(rows).map((r) => ({ id: `p${r.key}`, title: r.title, pages: null, spineColor: r.color ?? '' }))
    const setRows = (i: number, rows: EditRow[]) => setShelves((all) => all.map((r, j) => (j === i ? rows : r)))
    return (
      <div className="form">
        <h1>{t.scan.review}</h1>
        {kind === 'bookcase' ? (
          <div className="view3d-wrap small">
            <Suspense fallback={null}>
              <Storage3D model={{ shelves: shelves.map(preview), look }} />
            </Suspense>
          </div>
        ) : (
          photoUrl && <img className="storage-photo" src={photoUrl} alt={t.view.photo} />
        )}
        <label>
          {kind === 'bookcase' ? t.places.bookcaseName : kind === 'pile' ? t.places.pileName : t.places.boxName}
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {kind === 'box' && (
          <label>
            {t.places.boxLabel}
            <input value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
        )}
        <label>
          {kind === 'bookcase' ? t.places.room : kind === 'pile' ? t.places.pileLocation : t.places.boxLocation}
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        {kind === 'bookcase' && (
          <label className="color-field">
            {t.scan.color}
            <input
              type="color"
              value={look.color}
              onChange={(e) => setLook((l) => ({ ...l, color: e.target.value }))}
            />
          </label>
        )}

        {total === 0 && shelves.every((r) => r.length === 0) && <p className="muted">{t.scan.noBooks}</p>}
        {kind === 'bookcase' ? (
          <>
            {shelves.map((rows, i) => (
              <section key={i} className="shelf-edit">
                <h2>{t.scan.shelf(i + 1, i === shelves.length - 1 && shelves.length > 1)}</h2>
                <BookRowsEditor rows={rows} onChange={(r) => setRows(i, r)} />
              </section>
            ))}
            <div className="actions">
              <button type="button" className="btn" onClick={() => setShelves((s) => [...s, []])}>
                {t.scan.addShelf}
              </button>
              {shelves.length > 1 && (
                <button type="button" className="btn danger" onClick={() => setShelves((s) => s.slice(0, -1))}>
                  {t.scan.removeShelf}
                </button>
              )}
            </div>
          </>
        ) : (
          <section className="shelf-edit">
            {kind === 'pile' && <p className="muted">{t.scan.pileOrder}</p>}
            <BookRowsEditor rows={shelves[0] ?? []} onChange={(r) => setRows(0, r)} />
          </section>
        )}

        <div className="actions">
          <button className="btn primary" onClick={create}>
            {total ? t.scan.create(total) : t.scan.createEmpty}
          </button>
          <button className="btn" onClick={() => setStep('menu')}>
            {t.add.retake}
          </button>
        </div>
      </div>
    )
  }

  const option = (k: StorageKind, title: string, hint: string) => (
    <button className="option" disabled={!ready} onClick={() => camera.current[k]?.click()}>
      <span className="row-title">{title}</span>
      <span className="row-sub">{hint}</span>
    </button>
  )

  return (
    <div className="form">
      <h1>{t.scan.title}</h1>
      <p className="muted">{t.scan.hint}</p>
      {error && <p className="error">{error}</p>}
      {!ready && (
        <p className="muted">
          {t.add.needKey}{' '}
          <Link to="/settings" className="link">
            {t.add.goSettings}
          </Link>
        </p>
      )}
      {(['bookcase', 'pile', 'box'] as const).map((k) => (
        <input
          key={k}
          ref={(el) => {
            camera.current[k] = el
          }}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          data-scan={k}
          onChange={(e) => onPhoto(k, e)}
        />
      ))}
      <input
        ref={gallery}
        type="file"
        accept="image/*"
        hidden
        data-scan-gallery
        onChange={(e) => onPhoto(kind, e)}
      />
      {option('bookcase', t.scan.bookcase, t.scan.bookcaseHint)}
      {option('pile', t.scan.pile, t.scan.pileHint)}
      {option('box', t.scan.box, t.scan.boxHint)}
      {ready && (
        <p className="muted">
          {t.scan.pickInstead}:{' '}
          {(['bookcase', 'pile', 'box'] as const).map((k, i) => (
            <span key={k}>
              {i > 0 && ' · '}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setKind(k)
                  gallery.current?.click()
                }}
              >
                {t.scan.defaultName[k].replace('ใหม่', '')}
              </button>
            </span>
          ))}
        </p>
      )}
    </div>
  )
}
