import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { build, dispose, type Built, type Model3D, type Pick3D } from './scene'

export type { Pick3D }

/**
 * วาดตู้หนังสือแบบ 3D หมุน/ซูมได้ แตะหนังสือเพื่อเลือก
 * วาดเฉพาะเมื่อมีการเปลี่ยนแปลง ไม่วนวาดตลอดเวลา เพื่อประหยัดแบตเตอรี่
 */
export default function Storage3D({
  model,
  selected,
  onSelect,
  label,
}: {
  model: Model3D
  /** คำอธิบายสำหรับโปรแกรมอ่านหน้าจอ */
  label?: string
  selected?: Pick3D | null
  onSelect?: (target: Pick3D | null) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const state = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    built: Built | null
    render: () => void
    overlay: HTMLDivElement
  } | null>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  // สร้าง renderer ครั้งเดียว
  useEffect(() => {
    const el = host.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(40, 80, 90)
    scene.add(sun)
    const camera = new THREE.PerspectiveCamera(38, 1, 1, 2000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enablePan = false
    controls.minPolarAngle = 0.2
    controls.maxPolarAngle = Math.PI / 2 + 0.15
    // ป้ายของชั้นเป็นข้อความ HTML ทับบนภาพ ย้ายตามมุมกล้องทุกครั้งที่วาด
    const overlay = document.createElement('div')
    overlay.className = 'view3d-labels'
    overlay.setAttribute('aria-hidden', 'true')
    el.appendChild(overlay)
    const p = new THREE.Vector3()
    const q = new THREE.Vector3()
    const placeLabels = () => {
      const built = state.current?.built
      if (!built) return
      const w = el.clientWidth
      const h = el.clientHeight
      // มองจากด้านหลังตู้ ไม่เห็นหน้าชั้น ซ่อนป้าย
      const front = built.allAround || camera.position.z > built.size.z / 2
      built.anchors.forEach((a, i) => {
        const tag = overlay.children[i] as HTMLElement | undefined
        if (!tag) return
        built.root.localToWorld(p.copy(a.at)).project(camera)
        built.root.localToWorld(q.copy(a.at).setX(a.half)).project(camera)
        const x = (p.x * 0.5 + 0.5) * w
        const y = (-p.y * 0.5 + 0.5) * h
        const room = Math.abs(q.x - p.x) * w
        const show = front && p.z < 1 && room > 34
        tag.style.display = show ? '' : 'none'
        if (!show) return
        tag.style.maxWidth = `${Math.round(room - 6)}px`
        tag.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`
      })
    }
    const render = () => {
      renderer.render(scene, camera)
      placeLabels()
    }
    controls.addEventListener('change', render)

    const resize = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      render()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    // แตะ (ไม่ใช่ลาก) เพื่อเลือกหนังสือ
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY })
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return
      const s = state.current
      if (!s?.built) return
      const rect = renderer.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      const ray = new THREE.Raycaster()
      ray.setFromCamera(ndc, camera)
      const data = ray.intersectObjects(s.built.pickable, false)[0]?.object.userData
      onSelectRef.current?.(
        data?.bookId ? { kind: 'book', id: data.bookId } : data?.drawerId ? { kind: 'drawer', id: data.drawerId } : null,
      )
    }
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)

    state.current = { renderer, scene, camera, controls, built: null, render, overlay }
    resize()
    return () => {
      ro.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      controls.dispose()
      if (state.current?.built) dispose(state.current.built.root)
      // คืน WebGL context ทันที ไม่อย่างนั้นเปิดหน้านี้หลายครั้งจะเกินจำนวนที่เบราว์เซอร์ยอม
      renderer.forceContextLoss()
      renderer.dispose()
      renderer.domElement.remove()
      overlay.remove()
      state.current = null
    }
  }, [])

  // สร้างฉากใหม่เมื่อข้อมูลเปลี่ยน
  const key = JSON.stringify(model)
  const firstBuild = useRef(true)
  const lastHeight = useRef(0)
  useEffect(() => {
    const s = state.current
    if (!s) return
    if (s.built) {
      s.scene.remove(s.built.root)
      dispose(s.built.root)
    }
    const built = build(model)
    s.scene.add(built.root)
    s.built = built
    s.overlay.replaceChildren(
      ...built.anchors.map((a) => {
        const tag = document.createElement('span')
        tag.textContent = a.text
        return tag
      }),
    )
    // ตั้งกล้องให้เห็นทั้งหมดเฉพาะครั้งแรก ครั้งต่อไปคงมุมที่ผู้ใช้หมุนไว้
    // (กองหนังสือ: ขนาดเปลี่ยนมากเมื่อเพิ่มหรือนำเล่มออก จัดกล้องใหม่เมื่อความสูงเปลี่ยน)
    const grew = 'pile' in model && Math.abs(built.size.y - lastHeight.current) > 1
    lastHeight.current = built.size.y
    if (firstBuild.current || grew) {
      firstBuild.current = false
      const fov = (s.camera.fov * Math.PI) / 180
      const fitH = built.size.y / 2 / Math.tan(fov / 2)
      const fitW = built.size.x / 2 / Math.tan(fov / 2) / s.camera.aspect
      const dist = Math.max(fitH, fitW) * 1.15 + built.size.z / 2
      s.camera.position.set(dist * 0.25, dist * 0.32, dist)
      s.controls.target.set(0, 0, 0)
      s.controls.minDistance = dist * 0.35
      s.controls.maxDistance = dist * 2.5
      // กองสูงมากกล้องต้องถอยไกล ระยะมองเห็นต้องตามให้ทัน
      s.camera.far = Math.max(2000, dist * 4)
      s.camera.updateProjectionMatrix()
      s.controls.update()
    }
    s.render()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // ดึงเล่มที่เลือกออกมาจากชั้นเล็กน้อย / เลื่อนลิ้นชักที่เลือกออกมา
  const selectedBook = selected?.kind === 'book' ? selected.id : null
  const selectedDrawer = selected?.kind === 'drawer' ? selected.id : null
  useEffect(() => {
    const s = state.current
    if (!s?.built) return
    for (const g of s.built.drawerGroups) {
      g.position.copy(g.userData.home as THREE.Vector3)
      if (g.userData.drawerId === selectedDrawer) g.position.z += 26
    }
    // เปิดลิ้นชักแล้วเอียงกล้องลงให้มองเห็นของในลิ้นชัก (ถ้ามุมยังต่ำเกินไป)
    if (selectedDrawer) {
      const offset = s.camera.position.clone().sub(s.controls.target)
      const sph = new THREE.Spherical().setFromVector3(offset)
      if (sph.phi > 0.95) {
        sph.phi = 0.95
        s.camera.position.copy(s.controls.target).add(new THREE.Vector3().setFromSpherical(sph))
        s.controls.update()
      }
    }
    // เล่มที่เลือก: ดึงออกมาจากชั้น (ในกองดึงออกมาน้อยกว่า กองจะได้ไม่ดูล้ม)
    const pull = 'pile' in model ? 3 : 5
    for (const m of s.built.pickable) {
      if (!m.userData.bookId) continue
      const home = m.userData.home as THREE.Vector3
      const picked = m.userData.bookId === selectedBook
      m.position.copy(home)
      if (picked) m.position.z += pull
      const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]
      for (const mat of new Set(mats)) mat.emissive.setHex(picked ? 0x332200 : 0x000000)
    }
    s.render()
  }, [selectedBook, selectedDrawer, key])

  return <div ref={host} className="view3d" role="img" aria-label={label} />
}
