import { expect, test } from 'vitest'
import { GeminiError, parseBooks, pickDefaultModel } from './gemini'
import { normalizeIsbn } from './isbn'

test('เลือกรุ่น Flash ตัวเสถียรที่เลขรุ่นสูงสุด', () => {
  const ids = ['gemini-2.5-flash', 'gemini-3.6-flash', 'gemini-3.6-flash-lite', 'gemini-3.10-pro', 'gemini-3-flash-preview']
  expect(pickDefaultModel(ids)).toBe('gemini-3.6-flash')
  expect(pickDefaultModel(['gemini-3-flash-preview'])).toBe('gemini-3-flash-preview')
  expect(pickDefaultModel([])).toBe('')
})

const reply = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] })

test('แปลงคำตอบของ Gemini เป็นรายการหนังสือ และทิ้งรายการที่ไม่มีชื่อ', () => {
  const data = reply(
    JSON.stringify([
      { title: ' คำพิพากษา ', authors: 'ชาติ กอบจิตติ', publisher: '' },
      { title: '', authors: 'ไม่มีชื่อเรื่อง', publisher: '' },
      { title: 'Sapiens', authors: null, publisher: 'Harvill' },
    ]),
  )
  expect(parseBooks(data)).toEqual([
    { title: 'คำพิพากษา', authors: 'ชาติ กอบจิตติ', publisher: '' },
    { title: 'Sapiens', authors: '', publisher: 'Harvill' },
  ])
})

test('คำตอบที่ไม่ใช่ JSON ถือเป็นข้อผิดพลาด ไม่ใช่รายการว่าง', () => {
  expect(() => parseBooks(reply('ขออภัย'))).toThrow(GeminiError)
  expect(() => parseBooks({})).toThrow(GeminiError)
})

test('ตรวจรูปแบบ ISBN', () => {
  expect(normalizeIsbn('978-616-04-1234-5')).toBe('9786160412345')
  expect(normalizeIsbn('0-306-40615-x')).toBe('030640615X')
  expect(normalizeIsbn('12345')).toBeNull()
})
