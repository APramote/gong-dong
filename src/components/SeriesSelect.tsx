import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { normName, repo } from '../db/repo'
import { t } from '../th'

const NEW = '__new__'

/** เลือกชุดหนังสือจากรายการ หรือตั้งชุดใหม่ */
export function SeriesSelect({ value, onChange }: { value: string | null; onChange: (seriesId: string | null) => void }) {
  const series = useLiveQuery(() => repo.listSeries(), []) ?? []
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  async function add() {
    if (!normName(name)) return
    onChange(await repo.ensureSeries(name))
    setAdding(false)
    setName('')
  }

  return (
    <label>
      {t.book.series}
      {adding ? (
        <span className="cat-add">
          <input
            autoFocus
            placeholder={t.book.seriesName}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
          />
          <button type="button" className="btn small primary" onClick={add}>
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
          <option value="">{t.book.seriesNone}</option>
          {series.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <option value={NEW}>{t.book.seriesNew}</option>
        </select>
      )}
    </label>
  )
}
