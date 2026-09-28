import { useState } from 'react'
import { Button, useToast } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { gramsToMg } from '@/lib/nutrition'
import { EMPTY_NUTRIENTS } from '@/domain/types'
import type { LogTarget } from '@/features/shared/target'

/** For a label in your hand and no database row — the escape hatch that stops someone
 *  abandoning the log entirely. */
export function QuickAddPanel({
  target,
  onDone,
}: {
  target: LogTarget
  onDone: () => void
}) {
  const toast = useToast()
  const [label, setLabel] = useState('')
  const [fields, setFields] = useState({ kcal: '', protein: '', carbs: '', fat: '' })
  const [isSaving, setIsSaving] = useState(false)

  const numbers = {
    kcal: Number(fields.kcal) || 0,
    proteinMg: gramsToMg(Number(fields.protein) || 0),
    carbsMg: gramsToMg(Number(fields.carbs) || 0),
    fatMg: gramsToMg(Number(fields.fat) || 0),
  }

  async function log() {
    if (isSaving || numbers.kcal <= 0) return
    setIsSaving(true)
    try {
      await repo.logQuickAdd(
        { ...EMPTY_NUTRIENTS, ...numbers },
        target.meal,
        label.trim() || 'Quick add',
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
      <div>
        <h2 className="text-[16px] font-semibold tracking-tight">Quick add</h2>
        <p className="text-[12.5px] text-ink-muted">
          Straight from a label. No micronutrients, so these days count for calories and macros
          only.
        </p>
      </div>

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

      <Button className="w-full" disabled={numbers.kcal <= 0 || isSaving} onClick={() => void log()}>
        {isSaving ? 'Logging…' : 'Add'}
      </Button>
    </div>
  )
}
