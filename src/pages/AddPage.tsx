import { useRef, useState, type ChangeEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { emptyBook, repo } from '../db/repo'
import { PlaceSelect } from '../components/PlaceSelect'
import { BookRowsEditor, chosen as chosenRows, toRows, type EditRow } from '../components/BookRowsEditor'
import { Scanner } from '../components/Scanner'
import { useLeaveGuard } from '../components/useLeaveGuard'
import { aiOn, aiReady, covers, recognize } from '../lib/ai'
import { aiErrorText } from '../lib/aiError'
import { blobToBase64, cropImage, resizeImage } from '../lib/image'
import { lookupIsbnStatus } from '../lib/isbn'
import { t } from '../th'

type Mode = 'cover' | 'spine'

export function AddPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const existing = useLiveQuery(() => repo.listBooks(), []) ?? []
  const [placeId, setPlaceId] = useState<string | null>(params.get('place'))
  const [step, setStep] = useState<'menu' | 'busy' | 'review' | 'scan'>('menu')
  const [busyText, setBusyText] = useState('')
  const [error, setError] = useState('')
  const [rows, setRows] = useState<EditRow[]>([])
  const [mode, setMode] = useState<Mode>('cover')
  const inputs = {
    camera: { cover: useRef<HTMLInputElement>(null), spine: useRef<HTMLInputElement>(null) },
    pick: { cover: useRef<HTMLInputElement>(null), spine: useRef<HTMLInputElement>(null) },
  }

  // ผลอ่านรูปจาก AI ยังไม่ได้บันทึก ออกจากหน้าแล้วต้องถ่าย (และเสียค่า AI) ใหม่
  const allowLeave = useLeaveGuard(step === 'review' && rows.length > 0, t.add.unsavedLeave)
  const hasKey = aiReady()
  const useAi = aiOn()

  /** อ่านปกทุกเล่มในรูป และตัดรูปปกของแต่ละเล่มออกมา */
  async function readCovers(file: Blob): Promise<EditRow[]> {
    const image = await resizeImage(file, 2048)
    const found = await covers(await blobToBase64(image))
    const titles = [...existing.map((b) => b.title), ...rows.map((r) => r.title)]
    const result = toRows(found, titles)
    for (let i = 0; i < found.length; i++) {
      const box = found[i].box
      // ไม่รู้กรอบแต่มีเล่มเดียว ใช้ทั้งรูปเป็นปก
      if (box) result[i].cover = await cropImage(image, box, 480)
      else if (found.length === 1) result[i].cover = await resizeImage(image, 480)
    }
    return result
  }

  /**
   * รับรูปจากกล้องหรือคลังรูป (เลือกได้หลายรูป)
   * ถ้าอยู่ในหน้าตรวจสอบแล้ว เพิ่มต่อท้ายรายการเดิม ไม่ล้างของเก่า
   */
  async function onPhoto(m: Mode, e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    e.target.value = '' // ให้เลือกรูปเดิมซ้ำได้
    if (files.length === 0) return
    const appending = step === 'review' && m === mode
    setMode(m)
    setError('')
    setStep('busy')
    let added: EditRow[] = []
    try {
      for (let i = 0; i < files.length; i++) {
        setBusyText(files.length > 1 ? t.add.readingN(i + 1, files.length) : t.add.reading)
        if (m === 'cover') {
          added = [...added, ...(await readCovers(files[i]))]
        } else {
          // สันปกต้องการความละเอียดสูงเพื่ออ่านตัวหนังสือเล็ก
          const image = await resizeImage(files[i], 2048)
          const found = await recognize(await blobToBase64(image), m)
          added = [...added, ...toRows(found, existing.map((b) => b.title))]
        }
      }
    } catch (err) {
      setError(aiErrorText(err))
    }
    const next = appending ? [...rows, ...added] : added
    if (next.length === 0) {
      setError((e) => e || t.add.none)
      return setStep(appending ? 'review' : 'menu')
    }
    if (added.length === 0 && appending) setError((e) => e || t.add.none)
    setRows(next)
    setStep('review')
  }

  async function onIsbn(isbn: string) {
    setBusyText(t.book.searching)
    setStep('busy')
    const { hit, failed } = await lookupIsbnStatus(isbn)
    navigate('/book/new', {
      state: { prefill: { ...(hit ?? { isbn }), placeId }, isbnFound: hit ? true : failed ? 'offline' : false },
    })
  }

  const chosen = chosenRows(rows)

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
    for (let i = 0; i < ids.length; i++) {
      const cover = ordered[i].cover
      if (cover) await repo.setCover(ids[i], cover)
    }
    allowLeave()
    navigate(placeId ? `/place/${placeId}` : '/', { replace: true })
  }

  // ปุ่มหลักเปิดกล้องทันที ส่วน input ชุด pick ใช้เลือกรูปที่ถ่ายไว้แล้ว (เลือกได้หลายรูป)
  const photoInputs = (['cover', 'spine'] as const).flatMap((m) =>
    (['camera', 'pick'] as const).map((src) => (
      <input
        key={m + src}
        ref={inputs[src][m]}
        type="file"
        accept="image/*"
        capture={src === 'camera' ? 'environment' : undefined}
        multiple={src === 'pick'}
        hidden
        data-mode={m}
        data-src={src}
        onChange={(e) => onPhoto(m, e)}
      />
    )),
  )

  if (step === 'busy') return <p className="empty">{busyText}</p>

  if (step === 'scan')
    return <Scanner onDetect={onIsbn} onClose={() => setStep('menu')} />

  if (step === 'review')
    return (
      <div className="form">
        <h1>{t.add.reviewTitle}</h1>
        <p className="muted">{t.add.reviewHint(rows.length)}</p>
        {error && <p className="error">{error}</p>}
        <PlaceSelect label={t.add.dest} value={placeId} onChange={setPlaceId} />
        <BookRowsEditor rows={rows} onChange={setRows} />
        {photoInputs}
        <div className="actions">
          <button className="btn" onClick={() => inputs.camera[mode].current?.click()}>
            {t.add.takeMore}
          </button>
          <button className="btn" onClick={() => inputs.pick[mode].current?.click()}>
            {t.add.pickMore}
          </button>
        </div>
        <div className="actions">
          <button className="btn primary" disabled={chosen.length === 0} onClick={saveAll}>
            {t.add.saveN(chosen.length)}
          </button>
          <button
            className="btn"
            onClick={() => {
              if (rows.length && !confirm(t.add.confirmRetake)) return
              setRows([])
              setError('')
              setStep('menu')
            }}
          >
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
      {!useAi && <p className="muted">{t.add.aiOffHint}</p>}
      {useAi && !hasKey && (
        <p className="muted">
          {t.add.needKey} <Link to="/settings" className="link">{t.add.goSettings}</Link>
        </p>
      )}
      {photoInputs}
      {/* ถ่ายรูปปก/สันปกต้องใช้ AI อ่าน ซ่อนไว้เมื่อปิด AI */}
      {useAi && option(t.add.photoCover, t.add.photoCoverHint, () => inputs.camera.cover.current?.click(), !hasKey)}
      {useAi && option(t.add.photoSpine, t.add.photoSpineHint, () => inputs.camera.spine.current?.click(), !hasKey)}
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
