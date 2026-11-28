import type { Book, Bookcase, Place } from '../db/types'
import { rowsOf, usage } from '../lib/capacity'
import { t } from '../th'
import { Meter } from './charts'

const cm = (n: number) => Math.round(n)
/** ที่ว่างบนชั้น: แถบบอกว่าใช้ไปเท่าไร และปุ่มเปิดฟอร์มตั้งความกว้างกับการวางซ้อน */
export function ShelfSize({ place, bookcase, books, onEdit }: { place: Place; bookcase: Bookcase | undefined; books: Book[]; onEdit: () => void }) {
  const u = usage(place, bookcase, books)
  const rows = rowsOf(place)
  const names = rows === 2 ? [t.shelf.front, t.shelf.back] : [t.shelf.space]
  return (
    <section className="shelf-size">
      {u.width === null ? (
        books.length > 0 && <p className="muted">{t.shelf.usedUnknown(cm(u.used.reduce((n, x) => n + x, 0)))}</p>
      ) : (
        u.used.map((used, i) => (
          <Meter
            key={i}
            label={names[i]}
            value={Math.min(used, u.width!)}
            max={u.width!}
            text={used > u.width! ? t.shelf.over(cm(used - u.width!)) : t.shelf.used(cm(used), cm(u.width!))}
          />
        ))
      )}
      <div className="section-head">
        <p className="muted">
          {[
            place.width ? t.shelf.widthIs(place.width) : bookcase?.shelfWidth ? t.shelf.fromCase(bookcase.shelfWidth) : t.shelf.widthNone,
            rows === 2 ? t.shelf.twoRows : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <button className="btn small" onClick={onEdit}>
          {t.shelf.setSize}
        </button>
      </div>
      {u.width !== null && <p className="muted">{t.shelf.note}</p>}
    </section>
  )
}
