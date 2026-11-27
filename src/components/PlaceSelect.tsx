import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import { placeGroups } from '../placeLabel'
import { t } from '../th'

/** ตัวเลือกที่เก็บ จัดกลุ่มตามประเภท — ค่าว่างคือยังไม่ระบุที่เก็บ */
export function PlaceSelect({
  value,
  onChange,
  label,
}: {
  value: string | null
  onChange: (placeId: string | null) => void
  label: string
}) {
  const places = useLiveQuery(() => repo.listPlaces(), []) ?? []
  const bookcases = useLiveQuery(() => repo.listBookcases(), []) ?? []
  return (
    <label>
      {label}
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{t.library.noPlace}</option>
        {placeGroups(places, bookcases).map((g) => (
          <optgroup key={g.title} label={g.title}>
            {g.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
}
