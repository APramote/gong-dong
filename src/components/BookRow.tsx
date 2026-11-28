import { memo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Book } from '../db/types'
import { t } from '../th'
import { CoverThumb } from './Cover'
import { ratingText } from './Rating'
import { AiBadge } from './AiBadge'

/** แถวหนังสือ (memo: แถวที่ข้อมูลไม่เปลี่ยนไม่ต้องวาดใหม่ตอนพิมพ์ค้นหา) */
export const BookRow = memo(function BookRow({
  book,
  sub,
  place,
  actions,
  selected,
  onSelect,
  detail,
  highlight,
}: {
  book: Book
  sub?: string
  /** ที่เก็บ: แสดงเป็นบรรทัดของตัวเอง มีหมุดนำ ให้เห็นแยกจากผู้แต่งและหมวด */
  place?: string
  actions?: ReactNode
  /** โหมดเลือกหลายเล่ม: ส่ง onSelect มาเพื่อแสดงช่องติ๊กหน้าแถว (ต้องเป็นฟังก์ชันเดิมทุกครั้ง แถวจะไม่วาดใหม่เกินจำเป็น) */
  selected?: boolean
  onSelect?: (id: string) => void
  /** แบบละเอียด: ปกใหญ่ขึ้น มีสำนักพิมพ์ ปี จำนวนหน้า และคำโปรย (ไม่มีคำโปรยใช้เรื่องย่อ) */
  detail?: boolean
  /** เน้นแถวนี้ (เช่น เล่มที่แตะเลือกในภาพ 3D) */
  highlight?: boolean
}) {
  const facts = detail ? [book.publisher, book.year, book.pages ? t.common.pages(book.pages) : ''].filter(Boolean).join(' · ') : ''
  const blurb = detail ? book.blurb || book.synopsis : ''
  const where = place && (
    <span className="row-place">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          d="M12 21s-6.5-6.1-6.5-11A6.5 6.5 0 0 1 12 3.5 6.5 6.5 0 0 1 18.5 10c0 4.9-6.5 11-6.5 11z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="10" r="2.2" fill="currentColor" />
      </svg>
      {place}
    </span>
  )
  const more = detail && (
    <>
      {facts && <span className="row-sub">{facts}</span>}
      {blurb && (
        <span className="row-blurb">
          {book.blurb && book.aiFields?.includes('blurb') && <AiBadge />}
          {blurb}
        </span>
      )}
    </>
  )
  // โหมดเลือกหลายเล่ม: ทั้งแถวเป็นช่องติ๊ก แตะตรงไหนก็เลือก (ไม่พาไปหน้าหนังสือ การเลือกจะได้ไม่หาย)
  if (onSelect)
    return (
      <li>
        <label className={`row pick-row${selected ? ' is-picked' : ''}${detail ? ' detailed' : ''}`}>
          <input type="checkbox" className="pick" checked={Boolean(selected)} onChange={() => onSelect(book.id)} />
          <CoverThumb bookId={book.id} title={book.title} color={book.spineColor} />
          <span className="row-main">
            <span className="row-title">{book.title}</span>
            <span className="row-sub">{[book.authors, sub, ratingText(book)].filter(Boolean).join(' · ')}</span>
            {where}
            {more}
          </span>
          <span className={`status status-${book.status}`}>{t.status[book.status]}</span>
        </label>
      </li>
    )
  return (
    <li className={`row${detail ? ' detailed' : ''}${highlight ? ' is-picked' : ''}`}>
      <CoverThumb bookId={book.id} title={book.title} color={book.spineColor} />
      <Link to={`/book/${book.id}`} className="row-main">
        <span className="row-title">{book.title}</span>
        <span className="row-sub">{[book.authors, sub, ratingText(book)].filter(Boolean).join(' · ')}</span>
        {where}
        {more}
      </Link>
      <span className={`status status-${book.status}`}>{t.status[book.status]}</span>
      {actions}
    </li>
  )
})
