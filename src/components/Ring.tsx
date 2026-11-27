/**
 * วงแหวนบอกความคืบหน้าขนาดเล็ก
 * value = 0–1 แสดงสัดส่วนที่เสร็จ ไม่ส่ง value = หมุนไปเรื่อย ๆ (ยังไม่รู้ว่าเหลือเท่าไร)
 */
export function Ring({ value, size = 22 }: { value?: number; size?: number }) {
  const r = 9
  const length = 2 * Math.PI * r
  const known = value !== undefined
  const shown = known ? Math.min(1, Math.max(0.04, value)) : 0.28
  return (
    <svg
      className={`ring${known ? '' : ' spin'}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={known ? 'progressbar' : undefined}
      aria-valuemin={known ? 0 : undefined}
      aria-valuemax={known ? 100 : undefined}
      aria-valuenow={known ? Math.round(value * 100) : undefined}
      aria-hidden={known ? undefined : true}
    >
      <circle className="ring-track" cx="12" cy="12" r={r} />
      <circle
        className="ring-fill"
        cx="12"
        cy="12"
        r={r}
        strokeDasharray={`${length * shown} ${length}`}
        transform="rotate(-90 12 12)"
      />
    </svg>
  )
}
