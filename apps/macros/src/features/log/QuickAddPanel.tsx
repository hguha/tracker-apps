import { useState } from 'react'
import { Button, useToast } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { gramsToMg, mgToGrams } from '@/lib/nutrition'
import { EMPTY_NUTRIENTS, type Nutrients } from '@/domain/types'
import type { LogTarget } from '@/features/shared/target'
import { EditActions } from './EditActions'

interface QuickEdit {
  label: string
  nutrients: Nutrients
  copyLabel: string
  onSave: (label: string, nutrients: Nutrients) => Promise<void>
  onCopy: (label: string, nutrients: Nutrients) => Promise<void>
  onDelete: () => Promise<void>
}

const asField = (mg: number) => String(Math.round(mgToGrams(mg)))

/** For a label in your hand and no database row — the escape hatch that stops someone
 *  abandoning the log entirely. */
export function QuickAddPanel({
  target,
  onDone,
  edit,
}: {
  target: LogTarget
  onDone: () => void
  edit?: QuickEdit
}) {
  const toast = useToast()
  const [label, setLabel] = useState(edit?.label ?? '')
  const [fields, setFields] = useState(
    edit
      ? {
          kcal: String(edit.nutrients.kcal),
          protein: asField(edit.nutrients.proteinMg),
          carbs: asField(edit.nutrients.carbsMg),
          fat: asField(edit.nutrients.fatMg),
        }
      : { kcal: '', protein: '', carbs: '', fat: '' },
  )
  const [isSaving, setIsSaving] = useState(false)

  const numbers = {
    kcal: Number(fields.kcal) || 0,
    proteinMg: gramsToMg(Number(fields.protein) || 0),
    carbsMg: gramsToMg(Number(fields.carbs) || 0),
    fatMg: gramsToMg(Number(fields.fat) || 0),
  }

  const whole = (): Nutrients => ({ ...(edit?.nutrients ?? EMPTY_NUTRIENTS), ...numbers })

  async function run(action: () => Promise<void>) {
    if (isSaving) return
    setIsSaving(true)
    try {
      await action()
    } finally {
      setIsSaving(false)
    }
  }

  async function log() {
    if (isSaving || numbers.kcal <= 0) return
    setIsSaving(true)
    try {
      await repo.logQuickAdd(
        { ...EMPTY_NUTRIENTS, ...numbers },
        target.meal,
        label.trim() || 'Calories only',
        target.at,
        target.venue,
      )
      toast.show('Logged')
      onDone()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-3 px-4 py-3">
      <h2 className="text-[16px] font-semibold tracking-tight">Calories only</h2>

      <label className="block">
        <span className="text-[11px] text-ink-muted">What was it?</span>
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Cafeteria stir fry"
          className="mt-0.5 w-full rounded-xl bg-sunken px-3 py-2 text-[15px] outline-none"
        />
      </label>

      <div className="grid grid-cols-4 gap-2">
        {(['kcal', 'protein', 'carbs', 'fat'] as const).map((field) => (
          <label key={field}>
            <span className="text-[11px] text-ink-muted">{field}</span>
            <input
              type="number"
              inputMode="numeric"
              value={fields[field]}
              onChange={(event) => setFields({ ...fields, [field]: event.target.value })}
              className="tabular mt-0.5 w-full rounded-xl bg-sunken px-2 py-2 text-[14px] outline-none"
            />
          </label>
        ))}
      </div>

      {edit ? (
        <EditActions
          kcal={numbers.kcal}
          canSave={numbers.kcal > 0}
          isBusy={isSaving}
          copyLabel={edit.copyLabel}
          onSave={() => void run(() => edit.onSave(label.trim() || 'Calories only', whole()))}
          onCopy={() => void run(() => edit.onCopy(label.trim() || 'Calories only', whole()))}
          onDelete={() => void run(edit.onDelete)}
        />
      ) : (
        <Button className="w-full" disabled={numbers.kcal <= 0 || isSaving} onClick={() => void log()}>
          {isSaving ? 'Logging…' : 'Add'}
        </Button>
      )}
    </div>
  )
}
