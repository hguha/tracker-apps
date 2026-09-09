import { useState } from 'react'
import { Button, useToast } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { gramsToMg } from '@/lib/nutrition'
import { EMPTY_NUTRIENTS, type Food } from '@/domain/types'

/**
 * Entering a food from its label.
 *
 * Per 100 g, not per serving, because that's the basis everything else in the app scales from —
 * and the label's own serving size is captured separately as a portion, so logging "1 serving"
 * still works. A quick-add would have been quicker, but it can't be logged again tomorrow and
 * carries no micronutrients; this is the fix for a food the databases genuinely don't have.
 */
export function CustomFoodPanel({
  initialName = '',
  initialBarcode = null,
  onSaved,
}: {
  initialName?: string
  initialBarcode?: string | null
  /** Handed the saved food so the caller can go straight to the portion step. */
  onSaved: (food: Food) => void
}) {
  const toast = useToast()
  const [name, setName] = useState(initialName)
  const [brand, setBrand] = useState('')
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

  const kcal = Number(fields.kcal) || 0
  const canSave = name.trim().length > 1 && kcal > 0

  async function save() {
    if (isSaving || !canSave) return
    setIsSaving(true)
    try {
      const id = await repo.saveCustomFood({
        description: name,
        brand,
        barcode: initialBarcode,
        servingGrams: Number(serving) || null,
        servingLabel,
        per100: {
          ...EMPTY_NUTRIENTS,
          kcal: Math.round(kcal),
          proteinMg: gramsToMg(Number(fields.protein) || 0),
          carbsMg: gramsToMg(Number(fields.carbs) || 0),
          fatMg: gramsToMg(Number(fields.fat) || 0),
          // Optional: left null rather than zero, so "unknown" stays distinguishable.
          fiberMg: fields.fiber ? gramsToMg(Number(fields.fiber)) : null,
          sodiumMg: fields.sodium ? Number(fields.sodium) : null,
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
      <div>
        <h2 className="text-[16px] font-semibold tracking-tight">Add your own food</h2>
        <p className="text-[12.5px] text-ink-muted">
          Everything per 100 g, from the label. It syncs, it&rsquo;s searchable, and you can log it
          again tomorrow.
        </p>
      </div>

      <label className="block">
        <span className="text-[11px] text-ink-muted">Name</span>
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Corner shop chicken wrap"
          className="mt-0.5 w-full rounded-xl bg-sunken px-3 py-2 text-[15px] outline-none"
        />
      </label>

      <label className="block">
        <span className="text-[11px] text-ink-muted">Brand (optional)</span>
        <input
          value={brand}
          onChange={(event) => setBrand(event.target.value)}
          className="mt-0.5 w-full rounded-xl bg-sunken px-3 py-2 text-[15px] outline-none"
        />
      </label>

      <div className="grid grid-cols-4 gap-2">
        {(
          [
            ['kcal', 'kcal'],
            ['protein', 'protein g'],
            ['carbs', 'carbs g'],
            ['fat', 'fat g'],
          ] as const
        ).map(([field, label]) => (
          <label key={field}>
            <span className="text-[11px] text-ink-muted">{label}</span>
            <input
              type="number"
              inputMode="decimal"
              value={fields[field]}
              onChange={(event) => setFields({ ...fields, [field]: event.target.value })}
              className="tabular mt-0.5 w-full rounded-xl bg-sunken px-2 py-2 text-[14px] outline-none"
            />
          </label>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="text-[11px] text-ink-muted">fibre g (optional)</span>
          <input
            type="number"
            inputMode="decimal"
            value={fields.fiber}
            onChange={(event) => setFields({ ...fields, fiber: event.target.value })}
            className="tabular mt-0.5 w-full rounded-xl bg-sunken px-2 py-2 text-[14px] outline-none"
          />
        </label>
        <label>
          <span className="text-[11px] text-ink-muted">sodium mg (optional)</span>
          <input
            type="number"
            inputMode="decimal"
            value={fields.sodium}
            onChange={(event) => setFields({ ...fields, sodium: event.target.value })}
            className="tabular mt-0.5 w-full rounded-xl bg-sunken px-2 py-2 text-[14px] outline-none"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="text-[11px] text-ink-muted">1 serving is (g)</span>
          <input
            type="number"
            inputMode="decimal"
            value={serving}
            onChange={(event) => setServing(event.target.value)}
            className="tabular mt-0.5 w-full rounded-xl bg-sunken px-2 py-2 text-[14px] outline-none"
          />
        </label>
        <label>
          <span className="text-[11px] text-ink-muted">Called (optional)</span>
          <input
            value={servingLabel}
            onChange={(event) => setServingLabel(event.target.value)}
            placeholder="1 wrap"
            className="mt-0.5 w-full rounded-xl bg-sunken px-2 py-2 text-[14px] outline-none"
          />
        </label>
      </div>

      <Button className="w-full" disabled={!canSave || isSaving} onClick={() => void save()}>
        {isSaving ? 'Saving…' : 'Save and log it'}
      </Button>
    </div>
  )
}
