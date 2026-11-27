import type { Bookcase, Place } from './db/types'
import { t } from './th'

/** ชื่อเต็มของที่เก็บ เช่น "ตู้ห้องนั่งเล่น › ชั้นที่ 2" */
export function placeLabel(place: Place, bookcases: Bookcase[]): string {
  if (place.kind === 'shelf') {
    const bc = bookcases.find((b) => b.id === place.bookcaseId)
    return bc ? `${bc.name} › ${place.name}` : place.name
  }
  return place.name
}

export interface PlaceOption {
  id: string
  label: string
}

/** ตัวเลือกที่เก็บ จัดกลุ่มตามประเภท สำหรับ <select> */
export function placeGroups(
  places: Place[],
  bookcases: Bookcase[],
): { title: string; options: PlaceOption[] }[] {
  const of = (kind: Place['kind']) =>
    places.filter((p) => p.kind === kind).map((p) => ({ id: p.id, label: placeLabel(p, bookcases) }))
  const shelves = bookcases.flatMap((bc) =>
    places
      .filter((p) => p.kind === 'shelf' && p.bookcaseId === bc.id)
      .map((p) => ({ id: p.id, label: placeLabel(p, bookcases) })),
  )
  return [
    { title: t.kind.shelf, options: shelves },
    { title: t.kind.pile, options: of('pile') },
    { title: t.kind.box, options: of('box') },
  ].filter((g) => g.options.length > 0)
}
