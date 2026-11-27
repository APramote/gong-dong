import { lazy, Suspense, useRef, useState, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { repo } from '../db/repo'
import type { Look } from '../db/types'
import { useBlobUrl } from '../components/Cover'
import { ShapeFields } from '../components/ShapeFields'
import { useLeaveGuard } from '../components/useLeaveGuard'
import { aiOn, aiReady, scanShape } from '../lib/ai'
import type { StorageKind } from '../lib/aiCommon'
import { aiErrorText } from '../lib/aiError'
import { blobToBase64, resizeImage } from '../lib/image'
import { Ring } from '../components/Ring'
import { t } from '../th'

const Storage3D = lazy(() => import('../three/Storage3D'))

const DEFAULT_LOOK: Look = { color: '#8b6a4e', ratio: 0 }

/**
 * ถ่ายรูปเพื่อสร้างที่เก็บ
 * - ตู้: AI ดูโครงสร้าง (ชั้น ลิ้นชัก บาน ขา สี) แล้วสร้างแบบ 3D — ไม่รับหนังสือจากรูป
 * - กอง/กล่อง: ไม่ใช้ AI แค่จำรูปไว้ — หนังสือเพิ่มภายหลัง
 */
export function ScanStoragePage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<'menu' | 'busy' | 'review'>('menu')
  const [error, setError] = useState('')
  const [kind, setKind] = useState<StorageKind>('bookcase')
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [label, setLabel] = useState('')
  const [look, setLook] = useState<Look>(DEFAULT_LOOK)
  const [shelfCount, setShelfCount] = useState(1)
  const [photo, setPhoto] = useState<Blob | null>(null)
  const photoUrl = useBlobUrl(photo)
  const camera = useRef<Record<StorageKind, HTMLInputElement | null>>({ bookcase: null, pile: null, box: null })
  const gallery = useRef<HTMLInputElement>(null)
  const ready = aiReady()
  const allowLeave = useLeaveGuard(step === 'review', t.scan.unsavedLeave)
  const useAi = aiOn()

  async function onPhoto(k: StorageKind, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setKind(k)
    setError('')
    setName(t.scan.defaultName[k])
    setLocation('')
    setLabel('')
    setLook(DEFAULT_LOOK)
    if (k !== 'bookcase') {
      setPhoto(await resizeImage(file, 1024, 0.8))
      return setStep('review')
    }
    setStep('busy')
    try {
      // ดูแค่โครงสร้าง ไม่ต้องอ่านตัวหนังสือ จึงไม่ต้องละเอียดมาก
      const image = await resizeImage(file, 1600)
      const result = await scanShape(await blobToBase64(image))
      setPhoto(image)
      setLook({
        color: result.color || DEFAULT_LOOK.color,
        ratio: result.ratio,
        drawerRows: result.drawerRows,
        drawersPerRow: result.drawersPerRow,
        doors: result.doors,
        legs: result.legs,
      })
      setShelfCount(Math.max(1, result.shelfCount))
      setStep('review')
    } catch (err) {
      setError(aiErrorText(err))
      setStep('menu')
    }
  }

  async function create() {
    const finalName = name.trim() || t.scan.defaultName[kind]
    let id: string
    let to: string
    if (kind === 'bookcase') {
      id = await repo.addBookcaseWithBooks(
        { name: finalName, room: location.trim() },
        look,
        Array.from({ length: shelfCount }, () => []),
      )
      to = `/view/bookcase/${id}`
    } else {
      id = await repo.addPlace(kind, {
        name: finalName,
        location: location.trim(),
        label: kind === 'box' ? label.trim() : '',
      })
      to = `/place/${id}`
    }
    if (photo) await repo.setCover(id, await resizeImage(photo, 1024, 0.8))
    allowLeave()
    navigate(to, { replace: true })
  }

  if (step === 'busy')
    return (
      <p className="empty working" role="status">
        <Ring />
        {t.scan.reading}
      </p>
    )

  if (step === 'review')
    return (
      <div className="form">
        <h1>{t.scan.review}</h1>
        {kind === 'bookcase' ? (
          <div className="view3d-wrap small">
            <Suspense fallback={null}>
              <Storage3D model={{ shelves: Array.from({ length: shelfCount }, () => []), look }} />
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
          <>
            <ShapeFields look={look} onChange={setLook} />
            <label>
              {t.scan.shelfCount}
              <select value={shelfCount} onChange={(e) => setShelfCount(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <p className="muted">{kind === 'bookcase' ? t.scan.booksLater : t.scan.photoOnly}</p>
        <div className="actions">
          <button className="btn primary" onClick={create}>
            {t.scan.createEmpty}
          </button>
          <button className="btn" onClick={() => confirm(t.add.confirmRetake) && setStep('menu')}>
            {t.add.retake}
          </button>
        </div>
      </div>
    )

  const option = (k: StorageKind, title: string, hint: string) => (
    <button
      className="option"
      // กอง/กล่องไม่ใช้ AI ถ่ายได้แม้ยังไม่ได้ใส่ key
      disabled={k === 'bookcase' && !ready}
      onClick={() => camera.current[k]?.click()}
    >
      <span className="row-title">{title}</span>
      <span className="row-sub">{hint}</span>
    </button>
  )

  return (
    <div className="form">
      <h1>{t.scan.title}</h1>
      <p className="muted">{t.scan.hint}</p>
      {error && <p className="error">{error}</p>}
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
      <input ref={gallery} type="file" accept="image/*" hidden data-scan-gallery onChange={(e) => onPhoto(kind, e)} />
      {useAi && option('bookcase', t.scan.bookcase, t.scan.bookcaseHint)}
      {!useAi && <p className="muted">{t.scan.aiOffBookcase}</p>}
      {useAi && !ready && (
        <p className="muted">
          {t.scan.needKeyBookcase}{' '}
          <Link to="/settings" className="link">
            {t.add.goSettings}
          </Link>
        </p>
      )}
      {option('pile', t.scan.pile, t.scan.pileHint)}
      {option('box', t.scan.box, t.scan.boxHint)}
      <p className="muted">
        {t.scan.pickInstead}:{' '}
        {(['bookcase', 'pile', 'box'] as const)
          .filter((k) => k !== 'bookcase' || ready)
          .map((k, i) => (
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
    </div>
  )
}
