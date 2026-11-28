import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import type { Book, Bookcase, Place } from '../db/types'
import type { BookcaseModel } from '../three/scene'
import { rowOf, rowsOf } from '../lib/capacity'
import { t } from '../th'
import { useBlobUrl } from './Cover'

const as3D = (b: Book) => ({ id: b.id, title: b.title, pages: b.pages, spineColor: b.spineColor })

/** รูปตู้จาก 3D (วาดครั้งเดียวเป็นรูปนิ่ง) — โหลดโมดูล 3D เฉพาะเมื่อจำเป็น */
function Snapshot({ model, alt }: { model: BookcaseModel; alt: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const key = JSON.stringify(model)
  useEffect(() => {
    let stale = false
    import('../three/snapshot')
      .then((m) => m.snapshot(model))
      .then((u) => !stale && setUrl(u))
      // เครื่องนี้วาด 3D ไม่ได้ ใช้พื้นเรียบแทน
      .catch(() => !stale && setFailed(true))
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return url ? <img className="place-art snap" src={url} alt={alt} /> : <span className={`place-art${failed ? '' : ' loading'}`} aria-hidden />
}

/** การ์ดตู้หนังสือ: รูปที่ถ่ายไว้ ถ้าไม่มีใช้รูปจาก 3D แตะแล้วเปิดหน้า 3D */
export function BookcaseCard({ bookcase, places, books }: { bookcase: Bookcase; places: Place[]; books: Book[] }) {
  const photo = useLiveQuery(async () => (await repo.getCover(bookcase.id)) ?? null, [bookcase.id])
  const photoUrl = useBlobUrl(photo)
  const shelves = places.filter((p) => p.kind === 'shelf' && p.bookcaseId === bookcase.id)
  const drawers = places.filter((p) => p.kind === 'drawer' && p.bookcaseId === bookcase.id)
  const inPlace = (id: string) => books.filter((b) => b.placeId === id && !b.takenAt).sort((a, b) => a.position - b.position)
  const count = [...shelves, ...drawers].reduce((n, p) => n + inPlace(p.id).length, 0)
  const model: BookcaseModel = {
    shelves: shelves.map((s) => inPlace(s.id).filter((b) => rowsOf(s) === 1 || rowOf(b) === 0).map(as3D)),
    back: shelves.map((s) => (rowsOf(s) === 2 ? inPlace(s.id).filter((b) => rowOf(b) === 1).map(as3D) : [])),
    shelfWidth: bookcase.shelfWidth ?? null,
    drawers: drawers.map((d) => ({ id: d.id, books: inPlace(d.id).map(as3D) })),
    look: bookcase.look,
  }
  return (
    <Link to={`/view/bookcase/${bookcase.id}`} className="place-card" aria-label={`${bookcase.name} ${t.places.open3d}`}>
      {photo === undefined ? (
        <span className="place-art loading" aria-hidden />
      ) : photoUrl ? (
        <img className="place-art" src={photoUrl} alt="" />
      ) : (
        <Snapshot model={model} alt="" />
      )}
      <span className="place-name">{bookcase.name}</span>
      <span className="row-sub">
        {[bookcase.room, t.common.books(count)].filter(Boolean).join(' · ')}
      </span>
      <span className="place-badge">3D</span>
    </Link>
  )
}

/** ภาพวาดเรียบ ๆ ของกองหรือกล่องเมื่อยังไม่มีรูป */
function Drawing({ kind, color }: { kind: 'pile' | 'box'; color?: string }) {
  const c = color || (kind === 'box' ? '#b08a5a' : '#8c3b2e')
  return (
    <svg className="place-art drawing" viewBox="0 0 120 100" aria-hidden>
      {kind === 'box' ? (
        <>
          <path d="M20 38 L60 26 L100 38 L60 50 Z" fill={c} opacity="0.75" />
          <path d="M20 38 L60 50 L60 88 L20 76 Z" fill={c} />
          <path d="M60 50 L100 38 L100 76 L60 88 Z" fill={c} opacity="0.85" />
          <path d="M40 44 L80 32" stroke="#000" strokeOpacity="0.15" strokeWidth="3" />
        </>
      ) : (
        [0, 1, 2, 3, 4].map((i) => (
          <rect
            key={i}
            x={26 + ((i * 7) % 11) - 4}
            y={78 - i * 12}
            width={68 - ((i * 5) % 9)}
            height="10"
            rx="1.5"
            fill={['#8c3b2e', '#2f5d62', '#c9a227', '#4a4e8c', '#6b8e4e'][i]}
          />
        ))
      )}
    </svg>
  )
}

/** การ์ดกองหรือกล่อง: รูปที่ถ่ายไว้ หรือภาพวาด */
export function PlaceCard({ place, count }: { place: Place; count: number }) {
  const photo = useLiveQuery(async () => (await repo.getCover(place.id)) ?? null, [place.id])
  const url = useBlobUrl(photo)
  const sub = [place.kind === 'box' ? place.label : '', place.location, t.common.books(count)].filter(Boolean).join(' · ')
  return (
    <Link to={`/place/${place.id}`} className="place-card">
      {photo === undefined ? (
        <span className="place-art loading" aria-hidden />
      ) : url ? (
        <img className="place-art" src={url} alt="" />
      ) : (
        <Drawing kind={place.kind === 'box' ? 'box' : 'pile'} color={place.look?.color} />
      )}
      <span className="place-name">{place.name}</span>
      <span className="row-sub">{sub}</span>
    </Link>
  )
}
