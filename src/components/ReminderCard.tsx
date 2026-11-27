import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { WEEKDAYS, WEEKDAYS_SHORT } from '../lib/dashboard'
import { buildIcs, download } from '../lib/ics'
import { loadSettings, saveSettings } from '../lib/settings'
import { t } from '../th'

/** ตั้งเวลาอ่านประจำ แล้วส่งออกเป็นไฟล์ปฏิทิน (แอปไม่มีเซิร์ฟเวอร์ส่งแจ้งเตือนเอง) */
export function ReminderCard() {
  const [s, setS] = useState(loadSettings)
  const [done, setDone] = useState(false)
  const { hash } = useLocation()
  const ref = useRef<HTMLElement>(null)
  // เปิดจากลิงก์ "ตั้งเวลาอ่านประจำ" ให้เลื่อนมาที่การ์ดนี้
  useEffect(() => {
    if (hash === '#remind') ref.current?.scrollIntoView({ block: 'start' })
  }, [hash])
  const update = (patch: Partial<typeof s>) => {
    const next = { ...loadSettings(), ...patch }
    saveSettings(next)
    setS(next)
    setDone(false)
  }
  const toggle = (d: number) =>
    update({ reminderDays: s.reminderDays.includes(d) ? s.reminderDays.filter((x) => x !== d) : [...s.reminderDays, d] })
  // เริ่มสัปดาห์ที่วันจันทร์ตามความเคยชิน
  const order = [1, 2, 3, 4, 5, 6, 0]

  return (
    <section className="form card" id="remind" ref={ref}>
      <h2>{t.remind.title}</h2>
      <p className="muted">{t.remind.lead}</p>
      <div className="chips" role="group" aria-label={t.remind.days}>
        {order.map((d) => (
          <button
            type="button"
            key={d}
            aria-label={WEEKDAYS[d]}
            aria-pressed={s.reminderDays.includes(d)}
            className={s.reminderDays.includes(d) ? 'on' : ''}
            onClick={() => toggle(d)}
          >
            {WEEKDAYS_SHORT[d]}
          </button>
        ))}
      </div>
      <label className="narrow">
        {t.remind.time}
        <input type="time" value={s.reminderTime} onChange={(e) => e.target.value && update({ reminderTime: e.target.value })} />
      </label>
      <p className="muted">{t.remind.minutes(s.dailyGoalMinutes)}</p>
      <div className="actions">
        <button
          type="button"
          className="btn primary"
          disabled={s.reminderDays.length === 0}
          onClick={() => {
            const ics = buildIcs({
              days: s.reminderDays,
              time: s.reminderTime,
              minutes: s.dailyGoalMinutes,
              title: t.remind.event,
              description: t.remind.eventBody,
            })
            download(t.remind.file, new Blob([ics], { type: 'text/calendar' }))
            setDone(true)
          }}
        >
          {t.remind.add}
        </button>
        {s.reminderDays.length === 0 && <span className="muted">{t.remind.needDay}</span>}
      </div>
      {done && (
        <p className="ok" role="status">
          {t.remind.added}
        </p>
      )}
    </section>
  )
}
