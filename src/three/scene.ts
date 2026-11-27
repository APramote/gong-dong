import * as THREE from 'three'
import type { Book, Look } from '../db/types'

/** ข้อมูลหนังสือที่ใช้วาด (ใช้ได้ทั้งหนังสือจริงและรายการตัวอย่างก่อนบันทึก) */
export type Book3D = Pick<Book, 'id' | 'title' | 'pages' | 'spineColor'>

/** ตู้หนังสือ: ชั้นจากบนลงล่าง หนังสือในชั้นเรียงซ้ายไปขวา */
export interface BookcaseModel {
  shelves: Book3D[][]
  look?: Look
}

/** สีเริ่มต้นเมื่อหนังสือไม่มีสีจากรูป เลือกตาม id เพื่อให้สีคงที่ */
const PALETTE = ['#8c3b2e', '#2f5d62', '#c9a227', '#4a4e8c', '#6b8e4e', '#a0522d', '#3d3d3d', '#b5654a', '#5b7fa6', '#7a5c99']

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** ขนาดหนังสือ (ซม.): ความหนาตามจำนวนหน้า ความสูง/ลึกต่างกันเล็กน้อยให้ดูเป็นธรรมชาติ */
export function bookSize(b: Book3D) {
  const h = hash(b.id)
  const thick = Math.min(7, Math.max(1, (b.pages ?? 250) * 0.0065 + 0.6))
  return { thick, height: 18 + (h % 7), depth: 12 + ((h >> 3) % 4) }
}

export const bookColor = (b: Book3D) => b.spineColor || PALETTE[hash(b.id) % PALETTE.length]

function luminance(color: string): number {
  const c = new THREE.Color(color)
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

/** ข้อความบนสัน: แนวตั้งสำหรับหนังสือที่ตั้ง แนวนอนสำหรับหนังสือที่วางนอน */
function textTexture(text: string, bg: string, vertical: boolean, fg?: string): THREE.CanvasTexture {
  const long = 512
  const short = 72
  const canvas = document.createElement('canvas')
  canvas.width = vertical ? short : long
  canvas.height = vertical ? long : short
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = fg ?? (luminance(bg) > 0.55 ? '#1d1a16' : '#f7f2e8')
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.translate(canvas.width / 2, canvas.height / 2)
  if (vertical) ctx.rotate(Math.PI / 2)
  let size = 38
  ctx.font = `600 ${size}px system-ui, "Noto Sans Thai", sans-serif`
  let label = text
  // ย่อตัวอักษรก่อน ถ้ายังยาวเกินก็ตัดท้าย
  while (ctx.measureText(label).width > long - 40 && size > 24) {
    size -= 2
    ctx.font = `600 ${size}px system-ui, "Noto Sans Thai", sans-serif`
  }
  while (ctx.measureText(label).width > long - 40 && label.length > 1) label = label.slice(0, -2) + '…'
  ctx.fillText(label, 0, 2)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** กล่องหกด้าน: ด้านหน้า (+z) ใช้ texture ที่เหลือสีพื้น */
function boxMesh(w: number, h: number, d: number, color: string, front?: THREE.Texture): THREE.Mesh {
  const plain = new THREE.MeshStandardMaterial({ color, roughness: 0.85 })
  const materials = [plain, plain, plain, plain, front ? new THREE.MeshStandardMaterial({ map: front, roughness: 0.8 }) : plain, plain]
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials)
}

export interface Built {
  root: THREE.Group
  /** ขนาดรวม ใช้จัดมุมกล้อง */
  size: THREE.Vector3
  /** mesh ของหนังสือที่แตะเลือกได้ (userData.bookId) */
  pickable: THREE.Mesh[]
}

const BOARD = 2
const SHELF_SPACE = 30

function buildBookcase(shelves: Book3D[][], look?: Look): Built {
  const root = new THREE.Group()
  const pickable: THREE.Mesh[] = []
  const wood = look?.color || '#8b6a4e'
  const levels = Math.max(1, shelves.length)
  const innerH = levels * SHELF_SPACE + (levels - 1) * BOARD
  const booksWidth = Math.max(0, ...shelves.map((s) => s.reduce((n, b) => n + bookSize(b).thick + 0.15, 0)))
  const fromRatio = look?.ratio ? (innerH + 2 * BOARD) * look.ratio - 2 * BOARD : 0
  const innerW = Math.max(50, booksWidth + 6, fromRatio)
  const depth = 30
  const outerW = innerW + 2 * BOARD
  const outerH = innerH + 2 * BOARD

  const panel = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = boxMesh(w, h, d, wood)
    m.position.set(x, y, z)
    root.add(m)
  }
  panel(BOARD, outerH, depth, -outerW / 2 + BOARD / 2, outerH / 2, 0)
  panel(BOARD, outerH, depth, outerW / 2 - BOARD / 2, outerH / 2, 0)
  panel(innerW, BOARD, depth, 0, BOARD / 2, 0)
  panel(innerW, BOARD, depth, 0, outerH - BOARD / 2, 0)
  // แผ่นหลังสีเข้มกว่าเล็กน้อย
  const back = boxMesh(innerW, innerH, 0.8, new THREE.Color(wood).multiplyScalar(0.7).getStyle())
  back.position.set(0, outerH / 2, -depth / 2 + 0.4)
  root.add(back)

  // ชั้นที่ 0 อยู่บนสุด
  for (let i = 0; i < levels; i++) {
    const floor = outerH - BOARD - (i + 1) * SHELF_SPACE - i * BOARD
    if (i < levels - 1) panel(innerW, BOARD, depth, 0, floor - BOARD / 2, 0)
    let x = -innerW / 2 + 1
    for (const b of shelves[i] ?? []) {
      const s = bookSize(b)
      const color = bookColor(b)
      const mesh = boxMesh(s.thick, s.height, s.depth, color, textTexture(b.title, color, true))
      mesh.position.set(x + s.thick / 2, floor + s.height / 2, depth / 2 - s.depth / 2 - 1)
      mesh.userData = { bookId: b.id, home: mesh.position.clone() }
      root.add(mesh)
      pickable.push(mesh)
      x += s.thick + 0.15
      if (x > innerW / 2 - 1) break // ล้นชั้น ไม่วาดต่อ
    }
  }
  root.position.y = -outerH / 2
  return { root, size: new THREE.Vector3(outerW, outerH, depth), pickable }
}

export function build(model: BookcaseModel): Built {
  return buildBookcase(model.shelves, model.look)
}

/** คืนหน่วยความจำ GPU ของทุก mesh ในกลุ่ม */
export function dispose(group: THREE.Object3D) {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of new Set(mats)) {
      ;(m as THREE.MeshStandardMaterial).map?.dispose()
      m.dispose()
    }
  })
}
