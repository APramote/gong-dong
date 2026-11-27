import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { normName, repo } from '../db/repo'
import { t } from '../th'

const NEW = '__new__'

/**
 * เลือกหมวดจากรายการ หรือเพิ่มหมวดใหม่
 * suggestion = ชื่อหมวดที่ได้จาก ISBN หรือ AI แสดงเป็นปุ่มให้กดใช้ ไม่สร้างหมวดเอง
 */
export function CategorySelect({
  value,
  onChange,
  suggestion,
}: {
  value: string | null
  onChange: (categoryId: string | null) => void
  suggestion?: string
}) {
  const categories = useLiveQuery(() => repo.listCategories(), []) ?? []
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const current = categories.find((c) => c.id === value)
  const suggest = suggestion && normName(suggestion)
  const showSuggest = suggest && current?.name.toLowerCase() !== suggest.toLowerCase()

  async function add(n: string) {
    if (!normName(n)) return
    onChange(await repo.ensureCategory(n))
    setAdding(false)
    setName('')
  }

  return (
    <label>
      {t.book.category}
      {adding ? (
        <span className="cat-add">
          <input
            autoFocus
            placeholder={t.categories.newName}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add(name)
              }
            }}
          />
          <button type="button" className="btn small primary" onClick={() => add(name)}>
            {t.common.add}
          </button>
          <button type="button" className="btn small" onClick={() => setAdding(false)}>
            {t.common.cancel}
          </button>
        </span>
      ) : (
        <select
          value={value ?? ''}
          onChange={(e) => {
            if (e.target.value === NEW) setAdding(true)
            else onChange(e.target.value || null)
          }}
        >
          <option value="">{t.categories.none}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value={NEW}>{t.categories.addNew}</option>
        </select>
      )}
      {showSuggest && !adding && (
        <span className="suggest">
          {t.categories.suggested(suggest)}{' '}
          <button type="button" className="link-btn" onClick={() => add(suggest)}>
            {t.categories.use}
          </button>
        </span>
      )}
    </label>
  )
}
