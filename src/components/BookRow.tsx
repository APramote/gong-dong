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
}: {
  book: Book
  sub?: string
  actions?: ReactNode
}) {
  return (
    <li className="row">
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
