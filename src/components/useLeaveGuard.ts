import { useEffect, useRef } from 'react'
import { useBlocker } from 'react-router-dom'

/**
 * ถามก่อนออกจากหน้าเมื่อมีงานที่ยังไม่ได้บันทึก (เปลี่ยนหน้าในแอป และปิด/รีเฟรชแท็บ)
 * คืน allowLeave() ให้เรียกก่อนเปลี่ยนหน้าหลังบันทึกเสร็จ
 */
export function useLeaveGuard(active: boolean, message: string) {
  const leaving = useRef(false)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      active && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
  )
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (confirm(message)) blocker.proceed()
    else blocker.reset()
  }, [blocker, message])
  useEffect(() => {
    if (!active) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [active])
  return () => {
    leaving.current = true
  }
}
