import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../db/repo'
import { resizeImage } from '../lib/image'
import { t } from '../th'
import { useBlobUrl } from './Cover'

/** รูปที่ถ่ายจำไว้ของตู้ กอง หรือกล่อง พร้อมปุ่มถ่ายใหม่ เลือกรูป และลบ */
export function StoragePhoto({ id }: { id: string }) {
  const blob = useLiveQuery(() => repo.getCover(id), [id])
  const url = useBlobUrl(blob)
  const input = useRef<HTMLInputElement>(null)
  const [zoom, setZoom] = useState(false)

  const choose = (camera: boolean) => {
    const el = input.current
    if (!el) return
    if (camera) el.setAttribute('capture', 'environment')
    else el.removeAttribute('capture')
    el.click()
  }

  return (
    <div className="storage-photo-box">
      {url && (
        <button type="button" className="photo-btn" onClick={() => setZoom((z) => !z)}>
          <img className={`storage-photo ${zoom ? 'zoom' : ''}`} src={url} alt={t.view.photo} />
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        data-storage-photo
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) await repo.setCover(id, await resizeImage(file, 1024, 0.8))
        }}
      />
      <div className="actions">
        <button type="button" className="btn small" onClick={() => choose(true)}>
          {url ? t.view.changePhoto : t.view.takePhoto}
        </button>
        <button type="button" className="btn small" onClick={() => choose(false)}>
          {t.view.pickPhoto}
        </button>
        {url && (
          <button type="button" className="btn small danger" onClick={() => repo.setCover(id, null)}>
            {t.view.removePhoto}
          </button>
        )}
      </div>
    </div>
  )
}
