import { useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '../th'

/** ความกว้างจริงของกล่อง ใช้วาด SVG ให้พอดีจอโดยไม่บิดตัวอักษร */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

interface Tip {
  x: number
  y: number
  title: string
  rows: { value: string; name?: string; color?: string }[]
}

/** กล่องข้อความลอยของกราฟ: ค่าเด่น ชื่อรอง มีเส้นสีบอกชุดข้อมูล */
function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="status">
      <div className="chart-tip-title">{tip.title}</div>
      {tip.rows.map((r, i) => (
        <div className="chart-tip-row" key={i}>
          {r.color && <span className="line-key" style={{ background: r.color }} />}
          <strong>{r.value}</strong>
          {r.name && <span className="muted">{r.name}</span>}
        </div>
      ))}
    </div>
  )
}

/** ตัวเลขแกนที่อ่านง่าย: 0, ครึ่ง, สูงสุดแบบปัดเศษ */
function niceMax(max: number): number {
  if (max <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(max))
  // ค่ากลางของแกน (ครึ่งหนึ่ง) ต้องเป็นตัวเลขสวยด้วย จึงข้าม 2.5 ที่ให้ 1.25
  for (const m of [1, 2, 4, 5, 10]) if (m * pow >= max) return m * pow
  return 10 * pow
}

/** แท่งที่มนเฉพาะปลาย (ฐานเหลี่ยม) */
const barPath = (x: number, y: number, w: number, h: number) => {
  if (h <= 0) return ''
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

export interface Series {
  name: string
  color: string
  values: number[]
}

/**
 * กราฟแท่งแนวตั้ง หนึ่งหรือหลายชุดข้อมูล (แท่งเรียงข้างกัน)
 * แตะหรือชี้แต่ละช่วงเพื่อดูค่า และใช้คีย์บอร์ดโฟกัสได้
 */
export function ColumnChart({
  labels,
  series,
  format,
  tipFormat = format,
  tickLabel,
  height = 150,
  label,
}: {
  labels: string[]
  series: Series[]
  /** ตัวเลขบนแกน */
  format: (v: number) => string
  /** ค่าในกล่องลอยและป้ายสำหรับโปรแกรมอ่านหน้าจอ (ค่าเริ่มต้นใช้แบบเดียวกับแกน) */
  tipFormat?: (v: number) => string
  /** ป้ายใต้แกน x: คืนค่าว่างเพื่อข้าม */
  tickLabel: (i: number) => string
  height?: number
  label: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  const [active, setActive] = useState<number | null>(null)
  const left = 52
  const bottom = 20
  const top = 8
  const plotW = Math.max(0, width - left - 4)
  const plotH = height - top - bottom
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)))
  const band = labels.length ? plotW / labels.length : 0
  const gap = 2
  const barW = Math.max(2, Math.min(24, (band * 0.7 - gap * (series.length - 1)) / series.length))
  const groupW = barW * series.length + gap * (series.length - 1)
  const y = (v: number) => top + plotH - (v / max) * plotH

  const show = (i: number, el: Element) => {
    const box = el.getBoundingClientRect()
    const host = ref.current!.getBoundingClientRect()
    setActive(i)
    setTip({
      x: Math.min(Math.max(box.left - host.left + box.width / 2, 70), host.width - 70),
      y: top,
      title: labels[i],
      rows: series.map((s) => ({ value: tipFormat(s.values[i]), name: series.length > 1 ? s.name : undefined, color: s.color })),
    })
  }
  const hide = () => {
    setActive(null)
    setTip(null)
  }

  return (
    <div className="chart" ref={ref} onPointerLeave={hide}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          {[0, max / 2, max].map((v) => (
            <g key={v}>
              <line x1={left} x2={width - 4} y1={y(v)} y2={y(v)} className="grid" />
              <text x={left - 6} y={y(v)} className="axis" textAnchor="end" dominantBaseline="middle">
                {format(v)}
              </text>
            </g>
          ))}
          {labels.map((l, i) => {
            const x0 = left + band * i + (band - groupW) / 2
            return (
              <g key={l + i}>
                {series.map((s, k) => {
                  const v = s.values[i]
                  return (
                    <path
                      key={s.name}
                      d={barPath(x0 + k * (barW + gap), y(v), barW, y(0) - y(v))}
                      style={{ fill: s.color }}
                      opacity={active === null || active === i ? 1 : 0.55}
                    />
                  )
                })}
                {tickLabel(i) && (
                  <text x={left + band * i + band / 2} y={height - 5} className="axis" textAnchor="middle">
                    {tickLabel(i)}
                  </text>
                )}
                {/* พื้นที่แตะกว้างทั้งช่วง ใหญ่กว่าตัวแท่ง */}
                <rect
                  x={left + band * i}
                  y={top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  role="img"
                  tabIndex={0}
                  aria-label={`${l}: ${series.map((s) => `${series.length > 1 ? s.name + ' ' : ''}${tipFormat(s.values[i])}`).join(', ')}`}
                  onPointerEnter={(e) => show(i, e.currentTarget)}
                  onPointerDown={(e) => show(i, e.currentTarget)}
                  onFocus={(e) => show(i, e.currentTarget)}
                  onBlur={hide}
                />
              </g>
            )
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  )
}

/** คำอธิบายสีสำหรับกราฟหลายชุดข้อมูล */
export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.name} className="legend-item">
          <span className="swatch-key" style={{ background: it.color }} />
          {it.name}
        </span>
      ))}
    </div>
  )
}

/** ตารางสำรองของกราฟ ให้อ่านค่าได้ครบโดยไม่ต้องชี้ */
export function TableView({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="table-view">
      <summary>{t.charts.table}</summary>
      <table>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

/** ตัวเลขเดี่ยวพร้อมป้ายกำกับ */
export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <span className="muted">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="muted">{sub}</span>}
    </div>
  )
}

/** แถบความคืบหน้าเทียบเป้า: ราวเป็นสีเดียวกันที่อ่อนกว่า */
export function Meter({ label, value, max, text }: { label: string; value: number; max: number; text: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <strong>{text}</strong>
      </div>
      <div className="meter-track" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
        <div className="meter-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/** แท่งแนวนอนเรียงจากมากไปน้อย สีเดียว พร้อมชื่อและค่า */
export function RankedBars({ items, format }: { items: { name: string; value: number }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <ul className="ranked">
      {items.map((it) => (
        <li key={it.name}>
          <span className="ranked-name">{it.name}</span>
          <span className="ranked-track">
            <span className="ranked-bar" style={{ width: `${(it.value / max) * 100}%` }} />
          </span>
          <span className="ranked-value">{format(it.value)}</span>
        </li>
      ))}
    </ul>
  )
}

/** แท่งแบ่งส่วน (ทั้งหมดหนึ่งก้อน) พิมพ์สัดส่วนในช่องที่กว้างพอ พร้อมคำอธิบายสี */
export function SegmentedBar({
  parts,
  label,
}: {
  parts: { name: string; value: number; color: string }[]
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const total = parts.reduce((n, p) => n + p.value, 0)
  const shown = parts.filter((p) => p.value > 0)
  return (
    <div className="chart" ref={ref} onPointerLeave={() => setTip(null)}>
      <div className="segbar" role="img" aria-label={`${label}: ${shown.map((p) => `${p.name} ${p.value}`).join(', ')}`}>
        {shown.map((p) => {
          const share = total ? p.value / total : 0
          const pct = `${Math.round(share * 100)}%`
          const show = (el: HTMLElement) => {
            const box = el.getBoundingClientRect()
            const host = ref.current!.getBoundingClientRect()
            setTip({
              x: Math.min(Math.max(box.left - host.left + box.width / 2, 70), host.width - 70),
              y: 36,
              title: p.name,
              rows: [{ value: t.common.books(p.value), name: pct, color: p.color }],
            })
          }
          return (
            <span
              key={p.name}
              className="seg"
              tabIndex={0}
              aria-label={`${p.name} ${t.common.books(p.value)} (${pct})`}
              style={{ flexGrow: p.value, background: p.color }}
              onPointerEnter={(e) => show(e.currentTarget)}
              onPointerDown={(e) => show(e.currentTarget)}
              onFocus={(e) => show(e.currentTarget)}
              onBlur={() => setTip(null)}
            >
            </span>
          )
        })}
      </div>
      <Tooltip tip={tip} />
      {/* สัดส่วนอยู่ในคำอธิบายสี (ตัวหนังสือบนแท่งสีอ่านยากเกินเกณฑ์) */}
      <Legend
        items={parts.map((p) => ({
          name: `${p.name} ${p.value}${total ? ` (${Math.round((p.value / total) * 100)}%)` : ''}`,
          color: p.color,
        }))}
      />
    </div>
  )
}

/** การ์ดหัวข้อกราฟ */
export function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card chart-card">
      <h3>{title}</h3>
      {children}
    </div>
  )
}
