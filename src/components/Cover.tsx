import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import { resizeImage } from '../lib/image'

/** URL ชั่วคราวของ Blob — คืน null เมื่อไม่มีรูป และล้าง URL เมื่อเลิกใช้ */
export function useBlobUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) return setUrl(null)
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

/**
 * รูปปกขนาดเล็กในรายการ — ใช้รูปย่อ (ประมาณ 100px) ไม่ถอดรหัสรูปเต็มทุกแถว
 * ยังไม่มีรูปย่อก็สร้างจากรูปเต็มครั้งเดียวแล้วเก็บไว้
 */
export function CoverThumb({ bookId, title = '', color }: { bookId: string; title?: string; color?: string }) {
  const data = useLiveQuery(() => repo.getThumb(bookId), [bookId])
  useEffect(() => {
    if (!data?.blob || data.thumb) return
    let stale = false
    resizeImage(data.blob, 120, 0.75)
      .then((thumb) => {
        if (!stale) return repo.saveThumb(bookId, thumb)
      })
      .catch(() => {
        // สร้างรูปย่อไม่ได้ ใช้รูปเต็มแทนไปก่อน
      })
    return () => {
      stale = true
    }
  }, [bookId, data])
  const url = useBlobUrl(data?.thumb ?? data?.blob)
  return url ? (
    <img className="thumb" src={url} alt="" loading="lazy" decoding="async" />
  ) : (
    // ไม่มีรูปปก: วาดเป็นปกผ้าสีเรียบพร้อมอักษรตัวแรกของชื่อเรื่อง
    <span className="thumb cloth" style={{ background: color || clothColor(bookId) }} aria-hidden>
      {initial(title)}
    </span>
  )
}

/** สีปกผ้าโทนหม่น เลือกตาม id ให้เล่มเดิมได้สีเดิมเสมอ */
const CLOTH = ['#7d5a4a', '#4f6457', '#5b6478', '#8a6f3c', '#6f5672', '#4d6b73', '#8a5450', '#5d5d52']
function clothColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return CLOTH[h % CLOTH.length]
}

/** อักษรตัวแรกของชื่อเรื่อง (ภาษาไทย: รวมสระหน้าเข้ากับพยัญชนะ เช่น "เล") */
export function initial(title: string): string {
  const t = title.trim()
  if (!t) return ''
  const parts =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(t)].map((x) => x.segment)
      : [...t]
  const first = parts[0] ?? ''
  return /^[เแโใไ]$/.test(first) ? first + (parts[1] ?? '') : first.toUpperCase()
}
