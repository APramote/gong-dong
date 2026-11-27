import { memo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Book } from '../db/types'
import { t } from '../th'
import { CoverThumb } from './Cover'

/** แถวหนังสือ (memo: แถวที่ข้อมูลไม่เปลี่ยนไม่ต้องวาดใหม่ตอนพิมพ์ค้นหา) */
export const BookRow = memo(function BookRow({
  book,
  sub,
  actions,
  selected,
  onSelect,
}: {
  book: Book
  sub?: string
  actions?: ReactNode
  /** โหมดเลือกหลายเล่ม: ส่ง onSelect มาเพื่อแสดงช่องติ๊กหน้าแถว (ต้องเป็นฟังก์ชันเดิมทุกครั้ง แถวจะไม่วาดใหม่เกินจำเป็น) */
  selected?: boolean
  onSelect?: (id: string) => void
}) {
  return (
    <li className={`row${selected ? ' is-picked' : ''}`}>
      {onSelect && (
        <input type="checkbox" className="pick" aria-label={book.title} checked={Boolean(selected)} onChange={() => onSelect(book.id)} />
      )}
      <CoverThumb bookId={book.id} title={book.title} color={book.spineColor} />
      <Link to={`/book/${book.id}`} className="row-main">
        <span className="row-title">{book.title}</span>
        <span className="row-sub">{[book.authors, sub].filter(Boolean).join(' · ')}</span>
      </Link>
      <span className={`status status-${book.status}`}>{t.status[book.status]}</span>
      {actions}
    </li>
  )
})
