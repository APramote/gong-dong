/** ดาวน์โหลดไฟล์ที่แอปสร้างขึ้น (รูปสรุปปี ไฟล์สำรอง) */
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
