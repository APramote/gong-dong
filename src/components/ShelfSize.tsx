import type { Book, Bookcase, Place } from '../db/types'
import { repo } from '../db/repo'
import { rowsOf, usage } from '../lib/capacity'
import { t } from '../th'
import { Meter } from './charts'

const cm = (n: number) => Math.round(n)
/** อ่านค่าความกว้างจากช่องกรอก: ตัวเลขบวกไม่เกิน 1,000 ซม. นอกนั้นถือว่าไม่ระบุ */
export const readWidth = (text: string): number | null => {
  const n = parseFloat(text.replace(',', '.'))
  return Number.isFinite(n) && n > 0 && n <= 1000 ? Math.round(n * 10) / 10 : null
}

/** ที่ว่างบนชั้น: แถบบอกว่าใช้ไปเท่าไร ตั้งความกว้างเฉพาะชั้น และเปิดการวางซ้อนสองแถว */
export function ShelfSize({ place, bookcase, books }: { place: Place; bookcase: Bookcase | undefined; books: Book[] }) {
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
      <div className="cols">
        <label>
          {t.shelf.width}
          <input
            key={place.width ?? 'none'}
            inputMode="decimal"
            defaultValue={place.width ?? ''}
            placeholder={bookcase?.shelfWidth ? t.shelf.fromCase(bookcase.shelfWidth) : t.shelf.notSet}
            onBlur={(e) => {
              const width = readWidth(e.target.value)
              if (width !== (place.width ?? null)) repo.setShelfShape(place.id, { width })
            }}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={rows === 2}
            onChange={(e) => {
              // กลับเป็นแถวเดียว: หนังสือแถวหลังจะมารวมกับแถวหน้า ถามก่อนถ้ามีเล่มอยู่แถวหลัง
              if (!e.target.checked && books.some((b) => b.row === 1) && !confirm(t.shelf.confirmOneRow)) return
              repo.setShelfShape(place.id, { rows: e.target.checked ? 2 : 1 })
            }}
          />
          {t.shelf.twoRows}
        </label>
      </div>
      {u.width !== null && <p className="muted">{t.shelf.note}</p>}
    </section>
  )
}
