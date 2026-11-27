import { useState, type FormEvent } from 'react'
import { t } from '../th'

export interface Field {
  key: string
  label: string
  numeric?: boolean
  required?: boolean
}

/** ฟอร์มสั้น ๆ แบบฝังในหน้า ใช้เพิ่ม/แก้ไข ตู้ กอง กล่อง */
export function FieldsForm({
  fields,
  initial = {},
  onSubmit,
  onCancel,
}: {
  fields: Field[]
  initial?: Record<string, string>
  onSubmit: (values: Record<string, string>) => void | Promise<void>
  onCancel: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, initial[f.key] ?? ''])),
  )
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    const trimmed = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]))
    if (fields.some((f) => f.required && !trimmed[f.key])) return setError(t.places.nameRequired)
    await onSubmit(trimmed)
  }

  return (
    <form className="form inline-form" onSubmit={submit}>
      {fields.map((f, i) => (
        <label key={f.key}>
          {f.label}
          <input
            autoFocus={i === 0}
            inputMode={f.numeric ? 'numeric' : undefined}
            value={values[f.key]}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
          />
        </label>
      ))}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit" className="btn primary">
          {t.common.save}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t.common.cancel}
        </button>
      </div>
    </form>
  )
}
