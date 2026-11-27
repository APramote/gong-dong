/** สร้างไฟล์ปฏิทิน (.ics) สำหรับนัดเวลาอ่านซ้ำทุกสัปดาห์ ให้แอปปฏิทินในเครื่องเป็นคนเตือน */

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const pad = (n: number) => String(n).padStart(2, '0')

/** เวลาท้องถิ่นแบบไม่ระบุเขตเวลา (floating) ปฏิทินจะใช้เขตเวลาของเครื่อง */
const local = (d: Date) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const escape = (s: string) => s.replace(/[\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n')

export interface ReminderPlan {
  /** วันในสัปดาห์ 0 = อาทิตย์ */
  days: number[]
  /** เวลาเริ่ม HH:MM */
  time: string
  minutes: number
  title: string
  description: string
}

/** ครั้งแรกของนัด: วันที่ตรงกับวันที่เลือก ตั้งแต่วันนี้เป็นต้นไป (ถ้าวันนี้เลยเวลาแล้วก็ยังใช้วันนี้ได้ ปฏิทินจัดการเอง) */
export function firstStart(plan: Pick<ReminderPlan, 'days' | 'time'>, now = new Date()): Date {
  const [h, m] = plan.time.split(':').map((x) => parseInt(x, 10))
  for (let k = 0; k < 7; k++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k, h || 0, m || 0)
    if (plan.days.includes(d.getDay())) return d
  }
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h || 0, m || 0)
}

export function buildIcs(plan: ReminderPlan, now = new Date(), uid: string = crypto.randomUUID()): string {
  const days = [...new Set(plan.days)].sort()
  const start = firstStart({ ...plan, days }, now)
  const end = new Date(start.getTime() + Math.max(5, plan.minutes) * 60000)
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gong-Dong//TH',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}@gong-dong`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${local(start)}`,
    `DTEND:${local(end)}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d]).join(',')}`,
    `SUMMARY:${escape(plan.title)}`,
    `DESCRIPTION:${escape(plan.description)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escape(plan.title)}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}

/** ดาวน์โหลดไฟล์ (มือถือจะถามว่าจะเพิ่มลงปฏิทินไหม) */
export function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
