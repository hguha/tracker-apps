import { useState } from 'react'
import { Button, SegmentedTabs, useToast, type SegmentedTab } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { gramsToMg } from '@/lib/nutrition'
import { EMPTY_NUTRIENTS, type Food } from '@/domain/types'

/**
 * Creating a food the databases don't have.
 *
 * **Numbers can be entered the way the label states them.** Storage is per 100 g, because that's the
 * basis everything else scales from — but a wrapper in your hand usually states a *serving*, and the
 * first version made the user divide by 0.63 in their head before they could type anything. Now the
 * basis is a choice and the conversion happens here, where it can't be got wrong.
 *
 * A quick add would be faster still, and it's the wrong tool: it can't be logged again tomorrow,
 * can't be searched, and carries no micronutrients.
 */
type Basis = 'serving' | 'hundred'

const BASES: SegmentedTab<Basis>[] = [
  { key: 'serving', label: 'Per serving' },
  { key: 'hundred', label: 'Per 100 g' },
]

const MACROS = [
  ['kcal', 'kcal'],
  ['protein', 'Protein'],
  ['carbs', 'Carbs'],
  ['fat', 'Fat'],
] as const

export function CustomFoodPanel({
  initialName = '',
  initialBarcode = null,
  onSaved,
}: {
  initialName?: string
  initialBarcode?: string | null
  /** Handed the saved food so the caller can go straight to the amount step. */
  onSaved: (food: Food) => void
}) {
  const toast = useToast()
  const [name, setName] = useState(initialName)
  const [brand, setBrand] = useState('')
  const [basis, setBasis] = useState<Basis>('serving')
  const [serving, setServing] = useState('')
  const [servingLabel, setServingLabel] = useState('')
  const [fields, setFields] = useState({
    kcal: '',
    protein: '',
    carbs: '',
    fat: '',
    fiber: '',
    sodium: '',
  })
  const [isSaving, setIsSaving] = useState(false)

  const servingGrams = Number(serving) || 0
  const kcal = Number(fields.kcal) || 0
  // Per-serving entry needs the serving's weight to convert; per-100 g entry doesn't need it at all.
  const needsServing = basis === 'serving'
  const canSave = name.trim().length > 1 && kcal > 0 && (!needsServing || servingGrams > 0)

  /** Everything typed, scaled to the 100 g basis the app stores. */
  const per100 = (value: string): number => {
    const typed = Number(value) || 0
    return basis === 'hundred' ? typed : (typed * 100) / Math.max(1, servingGrams)
  }

  async function save() {
    if (isSaving || !canSave) return
    setIsSaving(true)
    try {
      const id = await repo.saveCustomFood({
        description: name,
        brand,
        barcode: initialBarcode,
        servingGrams: servingGrams > 0 ? servingGrams : null,
        servingLabel,
        per100: {
          ...EMPTY_NUTRIENTS,
          kcal: Math.round(per100(fields.kcal)),
          proteinMg: gramsToMg(per100(fields.protein)),
          carbsMg: gramsToMg(per100(fields.carbs)),
          fatMg: gramsToMg(per100(fields.fat)),
          // Optional: left null rather than zero, so "unknown" stays distinguishable.
          fiberMg: fields.fiber ? gramsToMg(per100(fields.fiber)) : null,
          sodiumMg: fields.sodium ? Math.round(per100(fields.sodium)) : null,
        },
      })
      const saved = await repo.getFood(id)
      toast.show(`Saved ${name.trim()}`)
      if (saved) onSaved(saved)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-3 px-4 py-3">
      <h2 className="text-[16px] font-semibold tracking-tight">Create a food</h2>

      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Name"
        className="w-full rounded-xl bg-sunken px-3 py-2.5 text-[15px] outline-none"
      />
      <input
        value={brand}
        onChange={(event) => setBrand(event.target.value)}
        placeholder="Brand"
        className="w-full rounded-xl bg-sunken px-3 py-2.5 text-[15px] outline-none"
      />

      <SegmentedTabs tabs={BASES} active={basis} onSelect={setBasis} />

      {needsServing && (
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="A serving is"
            suffix="g"
            value={serving}
            onChange={setServing}
            isRequired={servingGrams <= 0}
          />
          <label className="block">
            <span className="text-[11px] text-ink-muted">Called</span>
            <input
              value={servingLabel}
              onChange={(event) => setServingLabel(event.target.value)}
              placeholder="1 wrap"
              className="mt-0.5 w-full rounded-xl bg-sunken px-2.5 py-2 text-[14px] outline-none"
            />
          </label>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2">
        {MACROS.map(([field, label]) => (
          <Field
            key={field}
            label={label}
            suffix={field === 'kcal' ? '' : 'g'}
            value={fields[field]}
            onChange={(value) => setFields({ ...fields, [field]: value })}
            isRequired={field === 'kcal' && kcal <= 0}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field
          label="Fibre"
          suffix="g"
          value={fields.fiber}
          onChange={(value) => setFields({ ...fields, fiber: value })}
        />
        <Field
          label="Sodium"
          suffix="mg"
          value={fields.sodium}
          onChange={(value) => setFields({ ...fields, sodium: value })}
        />
      </div>

      {/* The converted figure, so per-serving entry isn't a leap of faith. It also catches the
          commonest mistake — a serving weight left at zero or off by a factor of ten. */}
      {basis === 'serving' && servingGrams > 0 && kcal > 0 && (
        <p className="tabular text-[12px] text-ink-muted">
          {Math.round(per100(fields.kcal))} kcal per 100 g
        </p>
      )}

      <Button className="w-full" disabled={!canSave || isSaving} onClick={() => void save()}>
        {isSaving ? 'Saving…' : 'Save and log it'}
      </Button>
    </div>
  )
}

/** A number with its unit in the label, so the box holds only the number. */
function Field({
  label,
  suffix,
  value,
  onChange,
  isRequired = false,
}: {
  label: string
  suffix: string
  value: string
  onChange: (value: string) => void
  /** Marks the two fields nothing can be saved without, instead of a disabled button with no reason. */
  isRequired?: boolean
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-ink-muted">
        {label}
        {suffix && ` (${suffix})`}
      </span>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={`${label}${suffix ? ` in ${suffix}` : ''}`}
        className={`tabular mt-0.5 w-full rounded-xl bg-sunken px-2.5 py-2 text-[14px] outline-none ${
          isRequired ? 'ring-1 ring-accent' : ''
        }`}
      />
    </label>
  )
}
