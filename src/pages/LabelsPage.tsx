import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import QRCode from 'qrcode'
import { repo } from '../db/repo'
import type { Book, Place } from '../db/types'
import { t } from '../th'

/** ลิงก์ที่เปิดหน้าที่เก็บนี้ในแอป (แอปใช้ hash router) */
export const placeUrl = (id: string) => `${location.origin}${location.pathname}#/place/${id}`

const MAX_TITLES = 8

function Label({ place, books, titles }: { place: Place; books: Book[]; titles: boolean }) {
  const [qr, setQr] = useState('')
  useEffect(() => {
    let stale = false
    QRCode.toDataURL(placeUrl(place.id), { margin: 1, width: 240, errorCorrectionLevel: 'M' }).then((url) => {
      if (!stale) setQr(url)
    })
    return () => {
      stale = true
    }
  }, [place.id])
  const sub = [place.label, place.location].filter(Boolean).join(' · ')
  return (
    <article className="label-card">
      <div className="label-head">
        <div>
          <span className="label-kind">
            {t.kind[place.kind]} · {t.labels.count(books.length)}
          </span>
          <h2>{place.name}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {qr && <img src={qr} alt={t.labels.scan} className="label-qr" />}
      </div>
      {titles && books.length > 0 && (
        <ol className="label-titles">
          {books.slice(0, MAX_TITLES).map((b) => (
            <li key={b.id}>{b.title}</li>
          ))}
          {books.length > MAX_TITLES && <li className="label-more">{t.labels.more(books.length - MAX_TITLES)}</li>}
        </ol>
      )}
      <p className="label-foot">{t.labels.scan}</p>
    </article>
  )
}

/** เลือกกล่อง/กองแล้วพิมพ์ป้ายพร้อม QR — เปิดจากหน้าที่เก็บด้วย ?ids=… ได้ */
export function LabelsPage() {
  const [params] = useSearchParams()
  const places = useLiveQuery(() => repo.listPlaces(), [])
  const books = useLiveQuery(() => repo.listBooks(), []) ?? []
  const targets = useMemo(
    () => (places ?? []).filter((p) => p.kind === 'box' || p.kind === 'pile').sort((a, b) => a.name.localeCompare(b.name, 'th')),
    [places],
  )
  const [chosen, setChosen] = useState<Set<string> | null>(null)
  const [titles, setTitles] = useState(true)
  const byPlace = useMemo(() => {
    const m = new Map<string, Book[]>()
    for (const b of [...books].sort((a, b) => a.position - b.position))
      if (b.placeId && !b.takenAt) m.set(b.placeId, [...(m.get(b.placeId) ?? []), b])
    return m
  }, [books])

  if (!places) return <p className="empty">{t.common.loading}</p>
  // ค่าเริ่มต้น: ที่ส่งมาทาง ?ids= หรือทุกกล่อง
  const preset = params.get('ids')?.split(',').filter(Boolean)
  const picked = chosen ?? new Set(preset?.length ? preset : targets.filter((p) => p.kind === 'box').map((p) => p.id))
  const toggle = (id: string) => {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChosen(next)
  }
  const selected = targets.filter((p) => picked.has(p.id))

  return (
    <>
      <div className="no-print form">
        <div>
          <h1>{t.labels.title}</h1>
          <p className="muted">{t.labels.lead}</p>
        </div>
        {targets.length === 0 ? (
          <p className="empty">{t.labels.empty}</p>
        ) : (
          <>
            <div className="chips" role="group" aria-label={t.labels.title}>
              {targets.map((p) => (
                <button key={p.id} className={picked.has(p.id) ? 'on' : ''} aria-pressed={picked.has(p.id)} onClick={() => toggle(p.id)}>
                  {p.name}
                </button>
              ))}
            </div>
            <p className="actions">
              <button className="link-btn" onClick={() => setChosen(new Set(targets.map((p) => p.id)))}>
                {t.labels.all}
              </button>
              <button className="link-btn" onClick={() => setChosen(new Set())}>
                {t.labels.none}
              </button>
            </p>
            <label className="check">
              <input type="checkbox" checked={titles} onChange={(e) => setTitles(e.target.checked)} />
              {t.labels.showTitles}
            </label>
            <div className="actions">
              <button className="btn primary" disabled={selected.length === 0} onClick={() => window.print()}>
                {t.labels.print(selected.length)}
              </button>
              {selected.length === 0 && <span className="muted">{t.labels.pick}</span>}
            </div>
          </>
        )}
      </div>
      <div className="label-sheet">
        {selected.map((p) => (
          <Label key={p.id} place={p} books={byPlace.get(p.id) ?? []} titles={titles} />
        ))}
      </div>
    </>
  )
}
