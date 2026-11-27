import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Book } from '../db/types'
import { t } from '../th'

export function BookRow({
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
      <Link to={`/book/${book.id}`} className="row-main">
        <span className="row-title">{book.title}</span>
        <span className="row-sub">{[book.authors, sub].filter(Boolean).join(' · ')}</span>
      </Link>
      <span className={`badge badge-${book.status}`}>{t.status[book.status]}</span>
      {actions}
    </li>
  )
}
