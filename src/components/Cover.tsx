import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'

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

/** รูปปกขนาดเล็กในรายการ — ไม่มีรูปก็แสดงช่องว่างขนาดเท่ากัน */
export function CoverThumb({ bookId }: { bookId: string }) {
  const blob = useLiveQuery(() => repo.getCover(bookId), [bookId])
  const url = useBlobUrl(blob)
  return url ? <img className="thumb" src={url} alt="" /> : <span className="thumb" aria-hidden />
}
