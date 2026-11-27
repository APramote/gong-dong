import { useEffect, useRef, useState } from 'react'
import { normalizeIsbn } from '../lib/isbn'
import { t } from '../th'

/**
 * สแกนบาร์โค้ด ISBN ด้วยกล้องหลัง
 * ใช้ BarcodeDetector ของเบราว์เซอร์ถ้ามี (Android) ไม่มีก็ใช้ ZXing (iOS Safari)
 */
export function Scanner({ onDetect, onClose }: { onDetect: (isbn: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  const onDetectRef = useRef(onDetect)
  onDetectRef.current = onDetect

  useEffect(() => {
    let stopped = false
    let stop = () => {}
    const found = (raw: string) => {
      const isbn = normalizeIsbn(raw)
      // ISBN-13 ของหนังสือขึ้นต้นด้วย 978/979 กันการอ่านบาร์โค้ดราคาหรือสินค้าอื่น
      if (!isbn || stopped || (isbn.length === 13 && !/^97[89]/.test(isbn))) return
      stopped = true
      stop()
      onDetectRef.current(isbn)
    }

    async function start() {
      const video = videoRef.current!
      const Detector = (window as any).BarcodeDetector
      if (Detector) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        stop = () => stream.getTracks().forEach((tr) => tr.stop())
        if (stopped) return stop()
        video.srcObject = stream
        await video.play()
        const detector = new Detector({ formats: ['ean_13'] })
        const tick = async () => {
          if (stopped) return
          try {
            const codes = await detector.detect(video)
            if (codes[0]) found(codes[0].rawValue)
          } catch {
            // เฟรมนี้อ่านไม่ได้ ลองเฟรมถัดไป
          }
          setTimeout(tick, 250)
        }
        tick()
      } else {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const controls = await new BrowserMultiFormatReader().decodeFromConstraints(
          { video: { facingMode: 'environment' } },
          video,
          (result) => result && found(result.getText()),
        )
        stop = () => controls.stop()
        if (stopped) stop()
      }
    }

    start().catch(() => setFailed(true))
    return () => {
      stopped = true
      stop()
    }
  }, [])

  return (
    <div className="scanner">
      {failed ? (
        <p className="error">{t.add.cameraError}</p>
      ) : (
        <>
          <video ref={videoRef} playsInline muted />
          <p className="muted">{t.add.scanHint}</p>
        </>
      )}
      <button className="btn" onClick={onClose}>
        {t.add.stopScan}
      </button>
    </div>
  )
}
