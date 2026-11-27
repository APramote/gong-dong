import type { Look } from '../db/types'
import { t } from '../th'

/** แก้รูปทรงตู้: สี ลิ้นชัก บานกระจก ขาตู้ */
export function ShapeFields({ look, onChange }: { look: Look; onChange: (look: Look) => void }) {
  const set = (patch: Partial<Look>) => onChange({ ...look, ...patch })
  const rows = look.drawerRows ?? 0
  return (
    <div className="shape-fields">
      <label className="color-field">
        {t.shape.color}
        <input type="color" value={look.color || '#8b6a4e'} onChange={(e) => set({ color: e.target.value })} />
      </label>
      <label>
        {t.shape.drawerRows}
        <select
          value={rows}
          onChange={(e) => {
            const n = Number(e.target.value)
            set({ drawerRows: n, drawersPerRow: n ? look.drawersPerRow || 2 : 0 })
          }}
        >
          {[0, 1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n === 0 ? t.shape.doorsNone : n}
            </option>
          ))}
        </select>
      </label>
      {rows > 0 && (
        <label>
          {t.shape.drawersPerRow}
          <select value={look.drawersPerRow || 2} onChange={(e) => set({ drawersPerRow: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        {t.shape.doors}
        <select value={look.doors ?? 0} onChange={(e) => set({ doors: Number(e.target.value) })}>
          <option value={0}>{t.shape.doorsNone}</option>
          <option value={1}>{t.shape.doorsN(1)}</option>
          <option value={2}>{t.shape.doorsN(2)}</option>
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={look.legs ?? false} onChange={(e) => set({ legs: e.target.checked })} />
        {t.shape.legs}
      </label>
    </div>
  )
}
