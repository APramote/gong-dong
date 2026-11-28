import * as THREE from 'three'
import type { Book, Look } from '../db/types'
import { GAP, thickness } from '../lib/capacity'

/** ข้อมูลหนังสือที่ใช้วาด (ใช้ได้ทั้งหนังสือจริงและรายการตัวอย่างก่อนบันทึก) */
export type Book3D = Pick<Book, 'id' | 'title' | 'pages' | 'spineColor'>

/** ตู้หนังสือ: ชั้นจากล่างขึ้นบน (ชั้นที่ 1 = ล่างสุด) หนังสือในชั้นเรียงซ้ายไปขวา */
export interface BookcaseModel {
  shelves: Book3D[][]
  /** แถวหลังของแต่ละชั้น (ชั้นที่วางซ้อนสองแถว) ลำดับชั้นเดียวกับ shelves */
  back?: Book3D[][]
  /** ป้ายข้อความของแต่ละชั้น (เช่น หมวดของหนังสือบนชั้น) ลำดับชั้นเดียวกับ shelves — บรรทัดละรายการ, ว่าง = ไม่แสดง */
  labels?: string[][]
  /** ดูแถวหลัง: หนังสือแถวหน้าของชั้นที่วางซ้อนสองแถวจางลงและแตะไม่ได้ จะได้เห็นและเลือกเล่มแถวหลัง */
  backView?: boolean
  /** ความกว้างด้านในของชั้น (ซม.) ถ้ารู้ ใช้เป็นความกว้างของตู้จริง */
  shelfWidth?: number | null
  /** ลิ้นชักที่เป็นที่เก็บจริง เรียงจากแถวล่างสุด ซ้ายไปขวา (ไม่มี id = ตัวอย่าง แตะไม่ได้) */
  drawers?: { id: string; books: Book3D[] }[]
  look?: Look
  doorsOpen?: boolean
}

/** กองหนังสือ: วางนอนซ้อนกัน เล่มแรกอยู่ล่างสุด */
export interface PileModel {
  pile: Book3D[]
  /** ป้ายข้อความเหนือกอง (เช่น หมวดของหนังสือในกอง) บรรทัดละรายการ */
  label?: string[]
}

/** สิ่งที่แตะเลือกได้ในตู้ */
export type Pick3D = { kind: 'book' | 'drawer'; id: string }

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
  const thick = thickness(b)
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
  /** mesh ที่แตะเลือกได้ (userData.bookId หรือ userData.drawerId) */
  pickable: THREE.Mesh[]
  /** ลิ้นชักที่เลื่อนเปิดได้ (userData.drawerId, userData.home) */
  drawerGroups: THREE.Group[]
}

/** ความสูงของตัวอักษรบนป้าย (ซม.) */
const SIGN_LINE = 3.6
/** ป้ายยาวสุด (ซม.) ข้อความที่ยาวกว่านี้ตัดท้าย */
const SIGN_MAX_W = 30
/** ป้ายสูงสุดกี่บรรทัด (ชั้นหนึ่งสูง 30 ซม. ป้ายต้องไม่ล้นความสูงชั้น) */
const SIGN_LINES = 4

/**
 * ป้ายลอย: แผ่นป้ายบาง ๆ มีความหนา ข้อความอยู่ด้านหน้า (มองจากด้านหลังเห็นแผ่นเปล่า)
 * จุดอ้างอิงคือขอบขวากลางแผ่น (anchor = 'right') หรือกึ่งกลางล่าง (anchor = 'bottom')
 */
function sign(lines: string[], anchor: 'right' | 'bottom'): { group: THREE.Group; width: number; height: number } {
  const px = 64 // พิกเซลต่อบรรทัด
  const scale = SIGN_LINE / px / 0.62 // ตัวอักษรสูงราว 62% ของบรรทัด
  const pad = 22
  const font = `600 ${Math.round(px * 0.62)}px system-ui, "Noto Sans Thai", sans-serif`
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = font
  const maxPx = SIGN_MAX_W / scale - pad * 2
  const fits = (s: string) => measure.measureText(s).width <= maxPx
  // ข้อความยาวตัดขึ้นบรรทัดใหม่ตามคำ (ภาษาไทยไม่มีเว้นวรรค ใช้ตัวตัดคำของเบราว์เซอร์) ไม่เกิน 4 บรรทัด
  const words = (s: string): string[] => {
    try {
      return [...new Intl.Segmenter('th', { granularity: 'word' }).segment(s)].map((x) => x.segment)
    } catch {
      return [...s]
    }
  }
  const wrapped: string[] = []
  for (const l of lines) {
    let cur = ''
    for (const w of words(l)) {
      if (cur && !fits(cur + w)) {
        wrapped.push(cur.trim())
        cur = w.trimStart()
      } else cur += w
    }
    if (cur.trim()) wrapped.push(cur.trim())
  }
  const shown = wrapped.slice(0, SIGN_LINES).map((l, i) => {
    let s = l + (i === SIGN_LINES - 1 && wrapped.length > SIGN_LINES ? '…' : '')
    while (!fits(s) && s.length > 1) s = s.slice(0, -2) + '…'
    return s
  })
  const textW = Math.max(...shown.map((l) => measure.measureText(l).width))
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(textW + pad * 2)
  canvas.height = Math.ceil(shown.length * px + pad)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#faf6ee'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#2a241d'
  ctx.font = font
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  shown.forEach((l, i) => ctx.fillText(l, pad, pad / 2 + px * i + px / 2 + 2))
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  const width = canvas.width * scale
  const height = canvas.height * scale
  const edge = new THREE.MeshStandardMaterial({ color: '#d9cfbd', roughness: 0.7 })
  // ด้านหน้าไม่รับแสง ตัวอักษรจึงคมและอ่านง่ายทุกมุม
  const face = new THREE.MeshBasicMaterial({ map: tex })
  const plate = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.8), [edge, edge, edge, edge, face, edge])
  plate.position.set(anchor === 'right' ? -width / 2 : 0, anchor === 'right' ? 0 : height / 2, 0)
  const group = new THREE.Group()
  group.add(plate)
  return { group, width, height }
}

const BOARD = 2
const SHELF_SPACE = 30
const DRAWER_H = 16
const LEG_H = 10
/** ระยะระหว่างป้ายกับข้างตู้ (ซม.) */
const SIGN_GAP = 4

function buildBookcase(model: BookcaseModel): Built {
  const { shelves, look, doorsOpen = false, back = [] } = model
  const root = new THREE.Group()
  const pickable: THREE.Mesh[] = []
  const drawerGroups: THREE.Group[] = []
  const wood = look?.color || '#8b6a4e'
  const darker = new THREE.Color(wood).multiplyScalar(0.7).getStyle()
  const lighter = new THREE.Color(wood).offsetHSL(0, 0, 0.05).getStyle()
  const drawerRows = look?.drawerRows ?? 0
  const perRow = Math.max(1, look?.drawersPerRow ?? 2)
  const doors = Math.min(2, look?.doors ?? 0)
  const legH = look?.legs ? LEG_H : 0

  const levels = Math.max(1, shelves.length)
  const drawerZone = drawerRows ? drawerRows * DRAWER_H + BOARD : 0
  const shelfZone = levels * SHELF_SPACE + (levels - 1) * BOARD
  const innerH = drawerZone + shelfZone
  const outerH = innerH + 2 * BOARD
  const booksWidth = Math.max(0, ...[...shelves, ...back].map((s) => s.reduce((n, b) => n + bookSize(b).thick + GAP, 0)))
  const fromRatio = look?.ratio ? (outerH + legH) * look.ratio - 2 * BOARD : 0
  // รู้ความกว้างจริงของชั้นก็ใช้ค่านั้น (หนังสือที่เกินจะไม่ถูกวาด เห็นได้ว่าชั้นเต็ม) ไม่รู้จึงเดาจากหนังสือและสัดส่วนในรูป
  const innerW = model.shelfWidth && model.shelfWidth > 0 ? Math.max(30, model.shelfWidth) : Math.max(50, booksWidth + 6, fromRatio)
  const depth = 30
  const outerW = innerW + 2 * BOARD
  /** ความกว้างของป้ายที่ลอยข้างตู้ (รวมช่องว่าง) ใช้จัดกล้องให้เห็นทั้งตู้และป้าย */
  let signSpan = 0
  const y0 = legH // พื้นล่างของตัวตู้

  const part = (w: number, h: number, d: number, x: number, y: number, z: number, color = wood) => {
    const m = boxMesh(w, h, d, color)
    m.position.set(x, y, z)
    root.add(m)
    return m
  }
  part(BOARD, outerH, depth, -outerW / 2 + BOARD / 2, y0 + outerH / 2, 0)
  part(BOARD, outerH, depth, outerW / 2 - BOARD / 2, y0 + outerH / 2, 0)
  part(innerW, BOARD, depth, 0, y0 + BOARD / 2, 0)
  part(innerW, BOARD, depth, 0, y0 + outerH - BOARD / 2, 0)
  part(innerW, innerH, 0.8, 0, y0 + outerH / 2, -depth / 2 + 0.4, darker)

  // ขาตู้สี่มุม
  if (legH) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        part(3, legH, 3, sx * (outerW / 2 - 3), legH / 2, sz * (depth / 2 - 3), darker)
      }
    }
  }

  // ลิ้นชัก: แถว 0 อยู่ล่างสุด แต่ละช่องเป็นกลุ่มที่เลื่อนออกมาได้ พร้อมถาดและหนังสือข้างใน
  const fronts = y0 + BOARD
  const brass = new THREE.MeshStandardMaterial({ color: '#c9b37a', metalness: 0.6, roughness: 0.35 })
  for (let r = 0; r < drawerRows; r++) {
    const w = innerW / perRow
    for (let c = 0; c < perRow; c++) {
      const slot = model.drawers?.[r * perRow + c]
      const g = new THREE.Group()
      g.position.set(-innerW / 2 + w * c + w / 2, fronts + r * DRAWER_H + DRAWER_H / 2, depth / 2 - 0.8)
      const front = boxMesh(w - 0.6, DRAWER_H - 0.6, 1.6, lighter)
      g.add(front)
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), brass)
      knob.position.z = 1.4
      g.add(knob)
      // ถาดด้านใน: พื้นและผนังข้าง
      const trayD = depth - 4
      const trayW = w - 2
      const inner = new THREE.Color(wood).multiplyScalar(0.85).getStyle()
      const tray = (tw: number, th: number, td: number, x: number, y: number, z: number) => {
        const m = boxMesh(tw, th, td, inner)
        m.position.set(x, y, z)
        g.add(m)
      }
      const floorY = -DRAWER_H / 2 + 1.5
      tray(trayW, 0.8, trayD, 0, floorY, -trayD / 2 - 0.8)
      tray(0.8, DRAWER_H - 4, trayD, -trayW / 2, floorY + (DRAWER_H - 4) / 2, -trayD / 2 - 0.8)
      tray(0.8, DRAWER_H - 4, trayD, trayW / 2, floorY + (DRAWER_H - 4) / 2, -trayD / 2 - 0.8)
      tray(trayW, DRAWER_H - 4, 0.8, 0, floorY + (DRAWER_H - 4) / 2, -trayD - 0.8)
      // หนังสือนอนซ้อนในลิ้นชัก (แสดงไม่เกินที่ใส่ได้)
      let y = floorY + 0.4
      for (const b of slot?.books ?? []) {
        const s2 = bookSize(b)
        if (y + s2.thick > DRAWER_H / 2 - 1.5) break
        const color = bookColor(b)
        const bw = Math.min(s2.height, trayW - 2)
        const book = boxMesh(bw, s2.thick, Math.min(s2.depth, trayD - 2), color, textTexture(b.title, color, false))
        // ชิดด้านในของถาด มองเห็นได้ง่ายกว่าตอนดึงลิ้นชักออก
        book.position.set(0, y + s2.thick / 2, -trayD + Math.min(s2.depth, trayD - 2) / 2)
        g.add(book)
        y += s2.thick
      }
      if (slot) {
        front.userData = { drawerId: slot.id }
        pickable.push(front)
        g.userData = { drawerId: slot.id, home: g.position.clone() }
        drawerGroups.push(g)
      }
      root.add(g)
    }
  }
  if (drawerRows) part(innerW, BOARD, depth, 0, fronts + drawerRows * DRAWER_H + BOARD / 2, 0)

  // ชั้นวาง: ชั้น 0 อยู่ล่างสุด
  const shelfBase = y0 + BOARD + drawerZone
  for (let i = 0; i < levels; i++) {
    const floor = shelfBase + i * (SHELF_SPACE + BOARD)
    if (i < levels - 1) part(innerW, BOARD, depth, 0, floor + SHELF_SPACE + BOARD / 2, 0)
    // ป้ายของชั้น: ลอยอยู่ข้างตู้ทางซ้าย ระดับเดียวกับชั้น มีเส้นโยงเข้าหาชั้น ไม่บังหนังสือ
    const lines = model.labels?.[i]?.filter(Boolean) ?? []
    if (lines.length) {
      const s = sign(lines, 'right')
      s.group.position.set(-outerW / 2 - SIGN_GAP, floor + SHELF_SPACE / 2, depth / 2 - 2)
      const link = new THREE.Mesh(new THREE.BoxGeometry(SIGN_GAP, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: '#b9ab94' }))
      link.position.set(-outerW / 2 - SIGN_GAP / 2, floor + SHELF_SPACE / 2, depth / 2 - 2)
      // เปิดบานตู้อยู่: บานที่กางออกจะชนป้าย ซ่อนป้ายไว้ก่อน (ยังกันที่ไว้ ตู้จะได้ไม่ขยับ)
      s.group.visible = link.visible = !(doors && doorsOpen)
      root.add(s.group, link)
      signSpan = Math.max(signSpan, s.width + SIGN_GAP)
    }
    // ดูแถวหลัง: แถวหน้าของชั้นนี้จางลง (เฉพาะชั้นที่มีหนังสือแถวหลัง)
    const ghostFront = Boolean(model.backView && (back[i]?.length ?? 0) > 0)
    // แถวหน้าชิดขอบหน้าชั้น แถวหลัง (ถ้ามี) ชิดผนังหลัง
    for (const [row, list] of [[0, shelves[i] ?? []], [1, back[i] ?? []]] as const) {
      let x = -innerW / 2 + 1
      for (const b of list) {
        const s = bookSize(b)
        if (x + s.thick > innerW / 2 - 0.5) break // ล้นชั้น ไม่วาดต่อ
        const color = bookColor(b)
        const mesh = boxMesh(s.thick, s.height, s.depth, color, textTexture(b.title, color, true))
        const z = row === 0 ? depth / 2 - s.depth / 2 - 1.5 : -depth / 2 + s.depth / 2 + 1
        mesh.position.set(x + s.thick / 2, floor + s.height / 2, z)
        if (row === 0 && ghostFront) {
          // จางและแตะไม่ได้ แตะทะลุไปถึงเล่มแถวหลัง
          for (const m of new Set(mesh.material as THREE.MeshStandardMaterial[])) {
            m.transparent = true
            m.opacity = 0.12
            m.depthWrite = false
          }
          root.add(mesh)
          x += s.thick + GAP
          continue
        }
        mesh.userData = { bookId: b.id, home: mesh.position.clone() }
        root.add(mesh)
        pickable.push(mesh)
        x += s.thick + GAP
      }
    }
  }

  // บานกระจกปิดเฉพาะส่วนชั้นวาง หมุนรอบบานพับด้านข้าง
  if (doors) {
    const w = innerW / doors
    const glass = new THREE.MeshStandardMaterial({
      color: '#d8ecf2',
      transparent: true,
      opacity: 0.16,
      roughness: 0.05,
      depthWrite: false,
    })
    for (let d = 0; d < doors; d++) {
      const left = d === 0
      const hinge = new THREE.Group()
      hinge.position.set(left ? -innerW / 2 : innerW / 2, shelfBase, depth / 2 + 0.6)
      const sign = left ? 1 : -1
      const frame = (fw: number, fh: number, x: number, y: number) => {
        const m = boxMesh(fw, fh, 1.2, wood)
        m.position.set(x, y, 0)
        hinge.add(m)
      }
      frame(2, shelfZone, sign * 1, shelfZone / 2)
      frame(2, shelfZone, sign * (w - 1), shelfZone / 2)
      frame(w, 2, (sign * w) / 2, 1)
      frame(w, 2, (sign * w) / 2, shelfZone - 1)
      const pane = new THREE.Mesh(new THREE.BoxGeometry(w - 4, shelfZone - 4, 0.4), glass)
      pane.position.set((sign * w) / 2, shelfZone / 2, 0)
      hinge.add(pane)
      const handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 8, 12),
        new THREE.MeshStandardMaterial({ color: '#c9b37a', metalness: 0.6, roughness: 0.35 }),
      )
      handle.position.set(sign * (w - 3.5), shelfZone / 2, 1.2)
      hinge.add(handle)
      hinge.rotation.y = doorsOpen ? -sign * 1.9 : 0
      root.add(hinge)
    }
  }

  const totalH = legH + outerH
  // จัดให้ตู้กับป้ายรวมกันอยู่กลางภาพ (ป้ายอยู่ทางซ้าย จึงเลื่อนทั้งหมดไปทางขวาครึ่งหนึ่งของความกว้างป้าย)
  root.position.set(signSpan / 2, -totalH / 2, 0)
  return { root, size: new THREE.Vector3(outerW + signSpan, totalH, depth), pickable, drawerGroups }
}

/** กองหนังสือ: แต่ละเล่มวางนอน หันสันออกด้านหน้า เหลื่อมและเอียงเล็กน้อยให้เหมือนกองจริง */
function buildPile(model: PileModel): Built {
  const root = new THREE.Group()
  const pickable: THREE.Mesh[] = []
  let y = 0
  let widest = 20
  for (const b of model.pile) {
    const s = bookSize(b)
    const h = hash(b.id)
    const color = bookColor(b)
    // วางนอน: ด้านยาวของเล่มไปตามแนวนอน ความหนาเป็นความสูงของชั้นในกอง
    const mesh = boxMesh(s.height, s.thick, s.depth, color, textTexture(b.title, color, false))
    mesh.position.set(((h % 9) - 4) * 0.25, y + s.thick / 2, (((h >> 4) % 7) - 3) * 0.2)
    mesh.rotation.y = (((h >> 8) % 9) - 4) * 0.012
    mesh.userData = { bookId: b.id, home: mesh.position.clone() }
    root.add(mesh)
    pickable.push(mesh)
    y += s.thick + 0.05
    widest = Math.max(widest, s.height)
  }
  const total = Math.max(y, 4)
  // ป้ายหมวดลอยเหนือกอง
  let top = total
  const lines = model.label?.filter(Boolean) ?? []
  if (lines.length) {
    const s = sign(lines, 'bottom')
    s.group.position.set(0, total + 3, 0)
    root.add(s.group)
    top = total + 3 + s.height
    widest = Math.max(widest, s.width)
  }
  root.position.y = -top / 2
  return { root, size: new THREE.Vector3(widest + 4, top + 4, 16), pickable, drawerGroups: [] }
}

export type Model3D = BookcaseModel | PileModel

export function build(model: Model3D): Built {
  return 'pile' in model ? buildPile(model) : buildBookcase(model)
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
