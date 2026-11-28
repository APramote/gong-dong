import { repo } from '../db/repo'
import type { Book } from '../db/types'
import { t } from '../th'

/** ข้อความสั้นของคะแนน ใช้ต่อท้ายบรรทัดย่อยในรายการ ('' = ยังไม่ให้คะแนน) */
export const ratingText = (b: Pick<Book, 'rating'>) => {
  const r = b.rating ?? 0
  return r > 0 ? `★ ${r}` : r < 0 ? `🍆 ${-r}` : ''
}

/**
 * ให้คะแนนหนังสือ: ดาว 1–5 = ชอบ · มะเขือ 1–5 = ไม่ชอบ (เลือกได้อย่างใดอย่างหนึ่ง)
 * แตะระดับเดิมซ้ำ = ล้างคะแนน บันทึกทันที ไม่ต้องกดบันทึกฟอร์ม
 */
export function Rating({ book }: { book: Pick<Book, 'id' | 'rating'> }) {
  const value = book.rating ?? 0
  const row = (sign: 1 | -1) => {
    const level = sign * value > 0 ? Math.abs(value) : 0
    return (
      <div className={`rating-row ${sign > 0 ? 'stars' : 'eggs'}`} role="group" aria-label={sign > 0 ? t.rating.stars : t.rating.eggs}>
        <span className="rating-name">{sign > 0 ? t.rating.like : t.rating.dislike}</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={n <= level ? 'on' : ''}
            aria-pressed={n === level}
            aria-label={sign > 0 ? t.rating.starN(n) : t.rating.eggN(n)}
            onClick={() => repo.setRating(book.id, n === level ? 0 : sign * n)}
          >
            {sign > 0 ? '★' : '🍆'}
          </button>
        ))}
      </div>
    )
  }
  return (
    <div className="rating">
      {row(1)}
      {row(-1)}
      <p className="muted" role="status">
        {value > 0 ? t.rating.starN(value) : value < 0 ? t.rating.eggN(-value) : t.rating.none}
      </p>
    </div>
  )
}
