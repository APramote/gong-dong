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
export function CoverThumb({ bookId }: { bookId: string }) {
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
    <span className="thumb" aria-hidden />
  )
}
