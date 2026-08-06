/**
 * The template editor (§7).
 *
 * This screen edits **the plan**, never a workout. That distinction is the whole
 * point of the design the user asked for, so it's stated in the header ("Editing
 * template") and the save note, and the surface looks deliberately unlike the
 * active-workout screen — targets and ranges, not logged sets, so there's no way
 * to confuse "I'm editing my program" with "I'm logging today's session".
 *
 * Reuse: it shares `ExercisePicker` and `DragList` with the workout screen. What
 * differs is the row model — a template row holds target *ranges* (3×8–10 @ RPE 8),
 * a workout row holds actual performed numbers — so the row editors are distinct
 * on purpose rather than a forked mega-component.
 */

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
import type { TemplateExercise, WeightUnit } from '@/domain/types'

export function TemplateEditorScreen({
  templateId,
  onExit,
}: {
  templateId: string
  onExit: () => void
}) {
  const toast = useToast()
  const [isPickerOpen, setIsPickerOpen] = useState(false)

  const data = useLiveQuery(async () => {
    const template = await repo.getTemplate(templateId)
    if (!template) return null
    const profile = await repo.getProfile()
    const rows = await repo.listTemplateExercises(templateId)
    const withMeta = await Promise.all(
      rows.map(async (te) => {
        const exercise = await db.exercises.get(te.exerciseId)
        const muscle = exercise
          ? await db.muscles.get(exercise.primaryMuscleId)
          : undefined
        return { te, exercise, muscle }
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

  async function addExercise(exerciseId: string) {
    await repo.addExerciseToTemplate(templateId, exerciseId)
    setIsPickerOpen(false)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-1 border-b border-line bg-surface px-2 py-2 pt-safe">
        <button
          onClick={onExit}
          aria-label="Done"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken"
        >
          <ChevronLeft size={22} />
        </button>
        <div className="min-w-0 flex-1">
          {/* The mode is stated, not implied — this is the plan, not a session. */}
          <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">
            Editing template
          </p>
          {/* A local draft, so a keystroke isn't clobbered by the liveQuery
              refetch that its own write triggers — the reason typing felt broken. */}
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
            {rows.map(({ te, exercise, muscle }, index) => (
              <DragItem key={te.id} id={te.id} index={index}>
                <TemplateExerciseRow
                  te={te}
                  name={exercise?.name ?? 'Unknown exercise'}
                  regionSwatch={muscle ? regionVar(muscle.region) : undefined}
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
        <Button size="lg" className="w-full" onClick={onExit}>
          Done
        </Button>
      </div>

      {isPickerOpen && (
        <ExercisePicker
          onPick={(exerciseId) => void addExercise(exerciseId)}
          onDismiss={() => setIsPickerOpen(false)}
        />
      )}
    </div>
  )
}

/**
 * The template's name. Holds a local draft and writes on every change, but does
 * not adopt the external value while focused — otherwise the liveQuery refetch
 * that each keystroke triggers would race the input and drop characters.
 */
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

/**
 * One template exercise: name plus its target ranges. Deliberately shows target
 * *fields* (sets, rep range, weight, RPE) rather than a logged-set table, so it
 * never reads like a live session.
 */
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
          label="Reps"
          value={te.targetRepsLow}
          onCommit={(n) => onChange({ targetRepsLow: n })}
        />
        <TargetField
          label="to"
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
    </div>
  )
}

/** A single labelled numeric target. Blank means "no target", which is valid. */
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
