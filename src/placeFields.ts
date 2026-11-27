import type { Field } from './components/FieldsForm'
import type { PlaceKind } from './db/types'
import { t } from './th'

export const bookcaseFields: Field[] = [
  { key: 'name', label: t.places.bookcaseName, required: true },
  { key: 'room', label: t.places.room },
]

export const placeFields: Record<PlaceKind, Field[]> = {
  shelf: [{ key: 'name', label: t.places.shelfName, required: true }],
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
