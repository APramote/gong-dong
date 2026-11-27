import { t } from '../th'

export interface EditRow {
  key: number
  include: boolean
  duplicate: boolean
  title: string
  authors: string
  publisher: string
  color?: string
}

let nextKey = 0
export const newRowKey = () => nextKey++

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')

/** สร้างแถวจากผลที่ AI อ่านได้ เล่มที่ชื่อซ้ำกับคลังจะถูกทำเครื่องหมายและไม่ติ๊กไว้ */
export function toRows(
  found: { title: string; authors: string; publisher: string; color?: string }[],
  existingTitles: string[],
): EditRow[] {
  const have = new Set(existingTitles.map(norm))
  return found.map((b) => {
    const duplicate = have.has(norm(b.title))
    return { key: newRowKey(), include: !duplicate, duplicate, ...b }
  })
}

export const blankRow = (): EditRow => ({
  key: newRowKey(),
  include: true,
  duplicate: false,
  title: '',
  authors: '',
  publisher: '',
})

/** รายการหนังสือที่แก้ไขได้ก่อนบันทึก (ติ๊กเลือก แก้ชื่อ ผู้แต่ง สำนักพิมพ์) */
export function BookRowsEditor({ rows, onChange }: { rows: EditRow[]; onChange: (rows: EditRow[]) => void }) {
  const patch = (key: number, change: Partial<EditRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...change } : r)))
  return (
    <>
      {rows.length > 0 && (
        <ol className="list">
          {rows.map((r) => (
            <li className="row review-row" key={r.key}>
              <input
                type="checkbox"
                aria-label={t.add.include}
                checked={r.include}
                onChange={(e) => patch(r.key, { include: e.target.checked })}
              />
              {r.color && <span className="swatch" style={{ background: r.color }} aria-hidden />}
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
      )}
      <button type="button" className="btn" onClick={() => onChange([...rows, blankRow()])}>
        {t.add.addRow}
      </button>
    </>
  )
}

export const chosen = (rows: EditRow[]) => rows.filter((r) => r.include && r.title.trim())
