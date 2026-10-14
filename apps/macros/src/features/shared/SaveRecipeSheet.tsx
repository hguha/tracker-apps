import { useState } from 'react'
import { plural } from '@tracker-engine/core'
import { BottomSheet, Button, useBusy, useToast } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { macroLine } from '@/features/shared/format'
import { dayTotals } from '@/lib/nutrition'
import type { LogEntry } from '@/domain/types'

export function SaveRecipeSheet({
  entries,
  defaultName,
  onDismiss,
}: {
  entries: LogEntry[]
  defaultName: string
  onDismiss: () => void
}) {
  const toast = useToast()
  const [name, setName] = useState(defaultName)
  const [isSaving, run] = useBusy()
  const totals = dayTotals(entries)

  return (
    <BottomSheet onDismiss={onDismiss} panelClassName="p-4">
      <h2 className="text-[16px] font-semibold tracking-tight">Save as a recipe</h2>
      <p className="tabular mt-0.5 text-[12.5px] text-ink-muted">
        {plural(entries.length, 'item')} · {totals.kcal} kcal · {macroLine(totals)}
      </p>

      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Usual breakfast"
        className="mt-3 w-full rounded-xl bg-sunken px-3 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-accent/40"
      />

      <Button
        className="mt-3 w-full"
        disabled={isSaving || name.trim().length === 0}
        onClick={() =>
          void run(async () => {
            await repo.saveRecipeFromEntries(name, entries)
            toast.show('Saved to your library')
            onDismiss()
          })
        }
      >
        {isSaving ? 'Saving…' : 'Save recipe'}
      </Button>
    </BottomSheet>
  )
}
