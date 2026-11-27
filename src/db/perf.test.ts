import 'fake-indexeddb/auto'
import { expect, test } from 'vitest'
import { GongDongDB } from './db'
import { createRepo, emptyBook } from './repo'

// วัดเวลาคร่าว ๆ กับคลังใหญ่ (fake-indexeddb ช้ากว่าเบราว์เซอร์จริง จึงใช้เกณฑ์หลวม ๆ)
test('คลัง 2,000 เล่ม: เพิ่ม 20 เล่มและดูหนังสือในที่เก็บได้เร็ว', async () => {
  const repo = createRepo(new GongDongDB('perf'))
  const places = await Promise.all(
    Array.from({ length: 40 }, (_, i) => repo.addPlace('pile', { name: `กอง ${i}`, location: '', label: '' })),
  )
  await repo.addBooks(Array.from({ length: 2000 }, (_, i) => ({ ...emptyBook, title: `เล่ม ${i}`, placeId: places[i % 40] })))
  let t = performance.now()
  await repo.addBooks(Array.from({ length: 20 }, (_, i) => ({ ...emptyBook, title: `ใหม่ ${i}`, placeId: places[0] })))
  const add = performance.now() - t
  t = performance.now()
  const rows = await repo.booksIn(places[0])
  const read = performance.now() - t
  expect(rows).toHaveLength(70)
  expect(rows.slice(-20).map((b) => b.position)).toEqual(Array.from({ length: 20 }, (_, i) => 50 + i))
  console.log(`add 20: ${add.toFixed(0)} ms, booksIn: ${read.toFixed(0)} ms`)
  expect(add).toBeLessThan(500)
  expect(read).toBeLessThan(100)
}, 60000)
