import * as THREE from 'three'
import { build, dispose, type BookcaseModel } from './scene'

/**
 * วาดตู้ 3D เป็นรูปนิ่งสำหรับหน้ารวมที่เก็บ
 * ใช้ renderer ตัวเดียวร่วมกันแล้ววาดทีละตู้ เพื่อไม่ให้มี WebGL context หลายอันพร้อมกัน
 * เก็บผลไว้ในหน่วยความจำ (ไม่ลงฐานข้อมูล) ตู้ที่ไม่เปลี่ยนไม่ต้องวาดซ้ำ
 */

const cache = new Map<string, string>()
let renderer: THREE.WebGLRenderer | null = null
let idle: ReturnType<typeof setTimeout> | undefined
let queue: Promise<unknown> = Promise.resolve()

function getRenderer(): THREE.WebGLRenderer {
  clearTimeout(idle)
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    renderer.outputColorSpace = THREE.SRGBColorSpace
  }
  return renderer
}

/** ว่างแล้วคืน WebGL context ไม่ค้างไว้ */
function releaseSoon() {
  clearTimeout(idle)
  idle = setTimeout(() => {
    renderer?.forceContextLoss()
    renderer?.dispose()
    renderer = null
  }, 3000)
}

async function draw(model: BookcaseModel, width: number, height: number): Promise<string> {
  const r = getRenderer()
  r.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  r.setSize(width, height, false)
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.6))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6)
  sun.position.set(40, 80, 90)
  scene.add(sun)
  const built = build(model)
  scene.add(built.root)
  const camera = new THREE.PerspectiveCamera(32, width / height, 1, 2000)
  const fov = (camera.fov * Math.PI) / 180
  const fitH = built.size.y / 2 / Math.tan(fov / 2)
  const fitW = built.size.x / 2 / Math.tan(fov / 2) / camera.aspect
  const dist = Math.max(fitH, fitW) * 1.12 + built.size.z / 2
  camera.position.set(dist * 0.28, dist * 0.18, dist)
  camera.lookAt(0, 0, 0)
  r.render(scene, camera)
  const blob = await new Promise<Blob | null>((res) => r.domElement.toBlob(res, 'image/png'))
  dispose(built.root)
  if (!blob) throw new Error('snapshot failed')
  return URL.createObjectURL(blob)
}

/** URL รูปของตู้ (blob:) — ข้อมูลตู้เหมือนเดิมได้รูปเดิมจากแคช */
export function snapshot(model: BookcaseModel, width = 320, height = 360): Promise<string> {
  const key = `${width}x${height}:${JSON.stringify(model)}`
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)
  const job = queue.then(async () => {
    const again = cache.get(key)
    if (again) return again
    try {
      const url = await draw(model, width, height)
      cache.set(key, url)
      // เก็บไว้ไม่เกิน 40 รูป ทิ้งรูปเก่าสุด
      if (cache.size > 40) {
        const [oldKey, oldUrl] = cache.entries().next().value!
        cache.delete(oldKey)
        URL.revokeObjectURL(oldUrl)
      }
      return url
    } finally {
      releaseSoon()
    }
  })
  queue = job.catch(() => undefined)
  return job
}
