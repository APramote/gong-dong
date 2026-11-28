import { useState, type FormEvent } from 'react'
import { t } from '../th'
import { readWidth } from '../lib/readWidth'

export interface Field {
  key: string
  label: string
  numeric?: boolean
  /** ตัวเลขมีทศนิยมได้ (เช่น เซนติเมตร) */
  decimal?: boolean
  /** ช่องติ๊ก: ค่าเป็น '1' เมื่อติ๊ก และ '' เมื่อไม่ติ๊ก */
  check?: boolean
  hint?: string
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
    // ช่องขนาด: ค่าที่อ่านไม่ออกต้องบอกผู้ใช้ ไม่บันทึกเป็น "ไม่ระบุ" เงียบ ๆ
    if (fields.some((f) => f.decimal && trimmed[f.key] && readWidth(trimmed[f.key]) === null)) return setError(t.shelf.widthBad)
    setError('')
    await onSubmit(trimmed)
  }

  return (
    <form className="form inline-form" onSubmit={submit}>
      {fields.map((f, i) =>
        f.check ? (
          <label key={f.key} className="check">
            <input
              type="checkbox"
              checked={values[f.key] === '1'}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.checked ? '1' : '' }))}
            />
            {f.label}
          </label>
        ) : (
          <div key={f.key} className="field">
            <label>
              {f.label}
              <input
                autoFocus={i === 0}
                inputMode={f.decimal ? 'decimal' : f.numeric ? 'numeric' : undefined}
                aria-describedby={f.hint ? `hint-${f.key}` : undefined}
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            </label>
            {f.hint && (
              <span className="muted" id={`hint-${f.key}`}>
                {f.hint}
              </span>
            )}
          </div>
        ),
      )}
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
