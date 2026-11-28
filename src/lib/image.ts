/** ด้านยาวของรูปปกที่เก็บ (พิกเซล) — พอให้ขยายดูเต็มจอแล้วยังชัด */
export const COVER_SIDE = 1200

/** ย่อรูปให้ด้านยาวไม่เกิน maxSide แล้วแปลงเป็น JPEG */
export async function resizeImage(file: Blob, maxSide: number, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality),
  )
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/**
 * ตัดส่วนของรูปตามกรอบ [ymin, xmin, ymax, xmax] สเกล 0–1000 เผื่อขอบเล็กน้อย
 * แล้วย่อให้ด้านยาวไม่เกิน maxSide
 */
export async function cropImage(
  file: Blob,
  box: [number, number, number, number],
  maxSide: number,
  quality = 0.85,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const pad = 15
  const [y0, x0, y1, x1] = [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad].map((v) =>
    Math.min(1000, Math.max(0, v)),
  )
  const sx = (x0 / 1000) * bitmap.width
  const sy = (y0 / 1000) * bitmap.height
  const sw = ((x1 - x0) / 1000) * bitmap.width
  const sh = ((y1 - y0) / 1000) * bitmap.height
  const scale = Math.min(1, maxSide / Math.max(sw, sh))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sw * scale))
  canvas.height = Math.max(1, Math.round(sh * scale))
  canvas.getContext('2d')!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality),
  )
}
