import type { Field } from './components/FieldsForm'
import type { PlaceKind } from './db/types'
import { t } from './th'

export const bookcaseFields: Field[] = [
  { key: 'name', label: t.places.bookcaseName, required: true },
  { key: 'room', label: t.places.room },
]

/** ขนาดชั้นของตู้: ความกว้างใช้กับทุกชั้น และวางซ้อนสองแถวทุกชั้น */
export const bookcaseSizeFields: Field[] = [
  { key: 'width', label: t.shelf.widthCase, decimal: true, hint: t.shelf.widthCaseHint },
  { key: 'twoRows', label: t.shelf.twoRowsAll, check: true },
]

export const placeFields: Record<PlaceKind, Field[]> = {
  shelf: [
    { key: 'name', label: t.places.shelfName, required: true },
    { key: 'width', label: t.shelf.width, decimal: true, hint: t.shelf.widthHint },
    { key: 'twoRows', label: t.shelf.twoRows, check: true },
  ],
  drawer: [{ key: 'name', label: t.places.drawerName, required: true }],
  pile: [
    { key: 'name', label: t.places.pileName, required: true },
    { key: 'location', label: t.places.pileLocation },
  ],
  box: [
    { key: 'name', label: t.places.boxName, required: true },
    { key: 'label', label: t.places.boxLabel },
    { key: 'location', label: t.places.boxLocation },
  ],
}
