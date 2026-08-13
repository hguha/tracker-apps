import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, GripVertical, MoreVertical, Plus, Trash2 } from 'lucide-react'
import { db } from '@/db/database'
import * as repo from '@/data/repository'
import { Button } from '@/components/Button'
import { useToast } from '@/components/Toast'
import { DragItem, DragList } from '@/components/DragList'
import { ExercisePicker } from '@/features/workout/ExercisePicker'
import { regionVar } from '@/lib/palette'
import { parseNumber, weightFromKg, weightToKg } from '@/lib/units'
import { useDraftInput } from '@/lib/useDraftInput'
import type { Equipment, TemplateExercise, WeightUnit } from '@/domain/types'

export function TemplateEditorScreen({
  templateId,
  onExit,
}: {
  templateId: string
  onExit: () => void
}) {
  const toast = useToast()
  const [isPickerOpen, setIsPickerOpen] = useState(false)

  // Leaving without adding anything discards the scratch row the + button made,
  // so it can't linger as an unstartable "New template".
  function exit() {
    void repo.discardUntouchedTemplate(templateId).then(onExit)
  }

  const data = useLiveQuery(async () => {
    const template = await repo.getTemplate(templateId)
    if (!template) return null
    const profile = await repo.getProfile()
    const rows = await repo.listTemplateExercises(templateId)
    const withMeta = await Promise.all(
      rows.map(async (te) => {
        const exercise = await db.exercises.get(te.exerciseId)
        return { te, exercise }
      }),
    )
    return { template, profile, rows: withMeta }
  }, [templateId])

  if (data === undefined) return <div className="p-6 text-ink-muted">Loading…</div>
  if (data === null) {
    return (
      <div className="p-6">
        <p className="text-ink-secondary">This template no longer exists.</p>
        <Button className="mt-4" onClick={onExit}>
          Go back
        </Button>
      </div>
    )
  }

  const { template, profile, rows } = data
  const orderedIds = rows.map((r) => r.te.id)

  async function addExercise(exerciseId: string, equipment: Equipment) {
    await repo.addExerciseToTemplate(templateId, exerciseId, equipment)
    setIsPickerOpen(false)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-1 border-b border-line bg-surface px-2 py-2 pt-safe">
        <button
          onClick={exit}
          aria-label="Back"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken"
        >
          <ChevronLeft size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">
            Editing template
          </p>
          <NameField
            value={template.name}
            onCommit={(name) => void repo.updateTemplate(templateId, { name })}
          />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-2.5 py-2.5">
        {rows.length === 0 && (
          <div className="mt-12 text-center">
            <p className="text-[15px] text-ink-secondary">No exercises yet.</p>
            <p className="mt-1 text-[13px] text-ink-muted">
              Add exercises and set targets — reps, weight, RPE.
            </p>
          </div>
        )}

        <DragList
          itemIds={orderedIds}
          onReorder={(ids) => void repo.reorderTemplateExercises(ids)}
        >
          <div className="space-y-2.5">
            {rows.map(({ te, exercise }, index) => (
              <DragItem key={te.id} id={te.id} index={index}>
                <TemplateExerciseRow
                  te={te}
                  name={exercise?.name ?? 'Unknown exercise'}
                  regionSwatch={exercise ? regionVar(exercise.region) : undefined}
                  weightUnit={profile.unitWeight}
                  onChange={(patch) => void repo.updateTemplateExercise(te.id, patch)}
                  onRemove={() => {
                    void repo.removeTemplateExercise(te.id)
                    toast.show('Removed from template')
                  }}
                />
              </DragItem>
            ))}
          </div>
        </DragList>

        <button
          onClick={() => setIsPickerOpen(true)}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line-strong py-3.5 text-[15px] font-semibold text-accent active:bg-accent-wash"
        >
          <Plus size={18} />
          Add exercise
        </button>
        <div className="h-2" />
      </div>

      <div className="border-t border-line bg-surface px-3 py-2.5 pb-safe">
        <p className="mb-2 px-1 text-center text-[12px] text-ink-muted">
          Changes save as you go. This edits the plan — your logged workouts are
          untouched.
        </p>
        <Button size="lg" className="w-full" onClick={exit}>
          Done
        </Button>
      </div>

      {isPickerOpen && (
        <ExercisePicker
          onPick={(exerciseId, equipment) => void addExercise(exerciseId, equipment)}
          onDismiss={() => setIsPickerOpen(false)}
        />
      )}
    </div>
  )
}

// Local draft that ignores the external value while focused, so the liveQuery refetch each keystroke triggers can't drop characters.
function NameField({
  value,
  onCommit,
}: {
  value: string
  onCommit: (name: string) => void
}) {
  const { inputProps } = useDraftInput({
    value,
    onCommit,
    commitOnChange: true,
  })

  return (
    <input
      {...inputProps}
      placeholder="Template name"
      aria-label="Template name"
      className="w-full truncate bg-transparent text-[16px] font-semibold tracking-tight outline-none"
    />
  )
}

function TemplateExerciseRow({
  te,
  name,
  regionSwatch,
  weightUnit,
  onChange,
  onRemove,
}: {
  te: TemplateExercise
  name: string
  regionSwatch: string | undefined
  weightUnit: WeightUnit
  onChange: (patch: Partial<TemplateExercise>) => void
  onRemove: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className="shrink-0 text-ink-muted/60" aria-hidden>
          <GripVertical size={16} />
        </span>
        {regionSwatch && (
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: regionSwatch }}
            aria-hidden
          />
        )}
        <h3 className="min-w-0 flex-1 truncate text-[15.5px] font-semibold tracking-tight">
          {name}
        </h3>
        <button
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={`${name} options`}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
        >
          <MoreVertical size={17} />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <button
              onClick={onRemove}
              className="absolute right-2 top-11 z-50 flex items-center gap-2 rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-[13.5px] font-medium text-critical shadow-xl"
            >
              <Trash2 size={15} />
              Remove
            </button>
          </>
        )}
      </div>

      <div className="grid grid-cols-4 gap-1.5 px-3 pb-3">
        <TargetField
          label="Sets"
          value={te.targetSets}
          onCommit={(n) => onChange({ targetSets: n })}
        />
        <TargetField
          label="Reps min"
          value={te.targetRepsLow}
          onCommit={(n) => onChange({ targetRepsLow: n })}
        />
        <TargetField
          label="Reps max"
          value={te.targetRepsHigh}
          onCommit={(n) => onChange({ targetRepsHigh: n })}
        />
        <TargetField
          label={weightUnit}
          value={
            te.targetWeightKg === null
              ? null
              : weightFromKg(te.targetWeightKg, weightUnit)
          }
          onCommit={(n) =>
            onChange({
              targetWeightKg: n === null ? null : weightToKg(n, weightUnit),
            })
          }
        />
      </div>

      <ProgressionControl te={te} weightUnit={weightUnit} onChange={onChange} />
    </div>
  )
}

// Double progression: clearing the rep range at RPE <= 8 seeds +increment next instantiation.
function ProgressionControl({
  te,
  weightUnit,
  onChange,
}: {
  te: TemplateExercise
  weightUnit: WeightUnit
  onChange: (patch: Partial<TemplateExercise>) => void
}) {
  const on = te.progression !== null
  const defaultIncrementKg = weightUnit === 'kg' ? 2.5 : weightToKg(5, 'lb')
  const incrementDisplay = te.progression
    ? weightFromKg(te.progression.incrementKg, weightUnit)
    : weightFromKg(defaultIncrementKg, weightUnit)

  return (
    <div className="border-t border-line px-3 py-2.5">
      <label className="flex items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-[13px] font-medium">Auto-progress</span>
          <span className="block text-[11.5px] text-ink-muted">
            {on
              ? `+${incrementDisplay} ${weightUnit} when you clear the rep range`
              : 'Add weight automatically as you hit the top of the range'}
          </span>
        </span>
        <input
          type="checkbox"
          checked={on}
          onChange={(event) =>
            onChange({
              progression: event.target.checked
                ? { kind: 'double', incrementKg: defaultIncrementKg, maxRpe: 8 }
                : null,
            })
          }
          className="size-5 shrink-0 accent-[var(--accent)]"
        />
      </label>

      {on && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[12px] text-ink-muted">Increment</span>
          <div className="w-20">
            <TargetField
              label={weightUnit}
              value={incrementDisplay}
              onCommit={(n) =>
                onChange({
                  progression: {
                    kind: 'double',
                    incrementKg:
                      n === null || n <= 0
                        ? defaultIncrementKg
                        : weightToKg(n, weightUnit),
                    maxRpe: te.progression?.maxRpe ?? 8,
                  },
                })
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}

// Blank means "no target", which is valid.
function TargetField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: number | null
  onCommit: (value: number | null) => void
}) {
  const display = value === null ? '' : String(value)
  const { inputProps } = useDraftInput({
    value: display,
    onCommit: (draft) => onCommit(parseNumber(draft)),
  })

  return (
    <label className="block">
      <span className="mb-0.5 block text-center text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      <input
        {...inputProps}
        inputMode="decimal"
        placeholder="—"
        aria-label={label}
        className="h-10 w-full rounded-lg border border-line bg-sunken text-center tabular text-[15px] font-semibold outline-none focus:border-accent focus:bg-surface"
      />
    </label>
  )
}
