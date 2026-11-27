import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { build, dispose, type BookcaseModel, type Built } from './scene'

/**
 * วาดตู้หนังสือแบบ 3D หมุน/ซูมได้ แตะหนังสือเพื่อเลือก
 * วาดเฉพาะเมื่อมีการเปลี่ยนแปลง ไม่วนวาดตลอดเวลา เพื่อประหยัดแบตเตอรี่
 */
export default function Storage3D({
  model,
  selectedId,
  onSelect,
}: {
  model: BookcaseModel
  selectedId?: string | null
  onSelect?: (bookId: string | null) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const state = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    built: Built | null
    render: () => void
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
    const render = () => renderer.render(scene, camera)
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
      const hit = ray.intersectObjects(s.built.pickable, false)[0]
      onSelectRef.current?.((hit?.object.userData.bookId as string) ?? null)
    }
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)

    state.current = { renderer, scene, camera, controls, built: null, render }
    resize()
    return () => {
      ro.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      controls.dispose()
      if (state.current?.built) dispose(state.current.built.root)
      renderer.dispose()
      renderer.domElement.remove()
      state.current = null
    }
  }, [])

  // สร้างฉากใหม่เมื่อข้อมูลเปลี่ยน
  const key = JSON.stringify(model)
  const firstBuild = useRef(true)
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
    // ตั้งกล้องให้เห็นทั้งหมดเฉพาะครั้งแรก ครั้งต่อไปคงมุมที่ผู้ใช้หมุนไว้
    if (firstBuild.current) {
      firstBuild.current = false
      const fov = (s.camera.fov * Math.PI) / 180
      const fitH = built.size.y / 2 / Math.tan(fov / 2)
      const fitW = built.size.x / 2 / Math.tan(fov / 2) / s.camera.aspect
      const dist = Math.max(fitH, fitW) * 1.15 + built.size.z / 2
      s.camera.position.set(dist * 0.25, dist * 0.15, dist)
      s.controls.target.set(0, 0, 0)
      s.controls.minDistance = dist * 0.35
      s.controls.maxDistance = dist * 2.5
      s.controls.update()
    }
    s.render()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // ดึงเล่มที่เลือกออกมาจากชั้นเล็กน้อย
  useEffect(() => {
    const s = state.current
    if (!s?.built) return
    for (const m of s.built.pickable) {
      const home = m.userData.home as THREE.Vector3
      const picked = m.userData.bookId === selectedId
      m.position.copy(home)
      if (picked) m.position.z += 5
      const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]
      for (const mat of new Set(mats)) mat.emissive.setHex(picked ? 0x332200 : 0x000000)
    }
    s.render()
  }, [selectedId, key])

  return <div ref={host} className="view3d" />
}
