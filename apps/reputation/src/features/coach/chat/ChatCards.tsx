import { useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus } from 'lucide-react'
import * as repo from '@/data/repository'
import { buildExerciseResolver } from '@/data/resolveExerciseName'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { BottomSheet } from '@/components/BottomSheet'
import { useToast } from '@/components/Toast'
import { SectionLabel } from '@tracker-engine/ui'
import type { Equipment, WeightUnit } from '@/domain/types'
import { buildCoachContext, type CoachContext } from '../context'
import { describePlanExerciseLoad } from '../tools'
import type { CoachAction, CoachPlan, PlanExercise } from '../types'

export function ActionCard({
  action,
  weightUnit,
  variant,
  onOpenTemplates,
}: {
  action: CoachAction
  weightUnit: WeightUnit
  variant: 'screen' | 'sheet'
  onOpenTemplates?: () => void
}) {
  if (action.kind === 'plan') {
    return <PlanCard plan={action.plan} weightUnit={weightUnit} onOpenTemplates={onOpenTemplates} />
  }
  if (action.kind === 'templateUpdate') {
    return <TemplateUpdateCard action={action} weightUnit={weightUnit} />
  }
  return <AccessoryCard action={action} weightUnit={weightUnit} inWorkout={variant === 'sheet'} />
}

function ExerciseRow({
  name,
  load,
  note,
  autoProgress,
  trailing,
}: {
  name: string
  load: string
  note?: string
  autoProgress?: boolean
  trailing?: ReactNode
}) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[14px] font-medium">{name}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-ink-muted">
          {load}
          {trailing}
        </span>
      </div>
      {note && (
        <p className="mt-0.5 text-[12px] text-ink-muted">
          {autoProgress && <span className="mr-1 font-semibold text-accent">↑ auto</span>}
          {note}
        </p>
      )}
    </div>
  )
}

function PlanExerciseRows({
  exercises,
  weightUnit,
}: {
  exercises: PlanExercise[]
  weightUnit: WeightUnit
}) {
  return (
    <div className="divide-y divide-line">
      {exercises.map((e, ei) => (
        <ExerciseRow
          key={ei}
          name={e.name}
          load={describePlanExerciseLoad(e, weightUnit)}
          note={e.note}
          autoProgress={e.autoProgress}
        />
      ))}
    </div>
  )
}

function PlanCard({
  plan,
  weightUnit,
  onOpenTemplates,
}: {
  plan: CoachPlan
  weightUnit: WeightUnit
  onOpenTemplates?: () => void
}) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const isProgram = plan.programName !== null && plan.durationWeeks !== null

  async function save() {
    setSaving(true)
    try {
      const { templateIds, unmatched } = await repo.createTemplatesFromPlan({
        sessions: plan.sessions,
        unitWeight: weightUnit,
        folder: plan.programName,
      })
      setSaved(true)
      toast.show(
        unmatched.length > 0
          ? `Saved ${templateIds.length} templates · couldn't match ${unmatched.slice(0, 2).join(', ')}${unmatched.length > 2 ? ` +${unmatched.length - 2}` : ''}`
          : `Saved ${templateIds.length} ${templateIds.length === 1 ? 'template' : 'templates'}`,
      )
      onOpenTemplates?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-4">
      <SectionLabel>{isProgram ? 'Proposed program' : 'Proposed plan'}</SectionLabel>
      {isProgram && (
        <p className="mt-1 text-[15px] font-bold tracking-tight">
          {plan.programName}
          <span className="ml-1.5 text-[12.5px] font-medium text-ink-muted">
            {plan.durationWeeks} weeks · {plan.sessions.length} sessions/week
          </span>
        </p>
      )}
      {plan.overview && <p className="mt-1 text-[13.5px] text-ink-secondary">{plan.overview}</p>}

      <div className="mt-3 space-y-3">
        {plan.sessions.map((session, si) => (
          <div key={si} className="rounded-xl border border-line">
            <p className="border-b border-line px-3 py-2 text-[14px] font-semibold">
              {session.name}
            </p>
            <PlanExerciseRows exercises={session.exercises} weightUnit={weightUnit} />
          </div>
        ))}
      </div>

      <Button className="mt-3 w-full" disabled={saving || saved} onClick={() => void save()}>
        {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save as templates'}
      </Button>
    </Card>
  )
}

function TemplateUpdateCard({
  action,
  weightUnit,
}: {
  action: Extract<CoachAction, { kind: 'templateUpdate' }>
  weightUnit: WeightUnit
}) {
  const toast = useToast()
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)

  async function apply() {
    setApplying(true)
    try {
      const { unmatched } = await repo.applyPlanSessionToTemplate(
        action.templateId,
        action.session,
        weightUnit,
      )
      setApplied(true)
      toast.show(
        unmatched.length > 0
          ? `Updated "${action.templateName}" · skipped ${unmatched.slice(0, 2).join(', ')}`
          : `Updated "${action.templateName}"`,
      )
    } finally {
      setApplying(false)
    }
  }

  return (
    <Card className="p-4">
      <SectionLabel>Update “{action.templateName}”</SectionLabel>
      {action.note && <p className="mt-1 text-[13.5px] text-ink-secondary">{action.note}</p>}
      <div className="mt-3 rounded-xl border border-line">
        <PlanExerciseRows exercises={action.session.exercises} weightUnit={weightUnit} />
      </div>
      <p className="mt-2 text-[12px] text-ink-muted">
        This replaces the template's exercises. Nothing is applied until you tap below.
      </p>
      <Button className="mt-2 w-full" disabled={applying || applied} onClick={() => void apply()}>
        {applied ? 'Updated ✓' : applying ? 'Updating…' : `Update ${action.templateName}`}
      </Button>
    </Card>
  )
}

function AccessoryCard({
  action,
  weightUnit,
  inWorkout,
}: {
  action: Extract<CoachAction, { kind: 'accessories' }>
  weightUnit: WeightUnit
  inWorkout: boolean
}) {
  const toast = useToast()
  const [added, setAdded] = useState<Set<number>>(new Set())

  async function add(index: number, name: string, equipment: Equipment | null) {
    const library = await repo.listExercises()
    const hit = buildExerciseResolver(library)(name, equipment)
    if (!hit) return void toast.show(`Couldn't find "${name}" in your library`)
    const active = await repo.getActiveWorkout()
    if (!active) return void toast.show('Start a workout to add this')
    await repo.addExerciseToWorkout(active.id, hit.exerciseId, hit.equipment)
    setAdded((prev) => new Set(prev).add(index))
    toast.show(`Added ${name}`)
  }

  return (
    <Card className="p-4">
      <SectionLabel>Accessory ideas</SectionLabel>
      {action.note && <p className="mt-1 text-[13.5px] text-ink-secondary">{action.note}</p>}
      <div className="mt-3 rounded-xl border border-line">
        <div className="divide-y divide-line">
          {action.exercises.map((e, ei) => (
            <ExerciseRow
              key={ei}
              name={e.name}
              load={describePlanExerciseLoad(e, weightUnit)}
              note={e.note}
              trailing={
                inWorkout && (
                  <button
                    onClick={() => void add(ei, e.name, e.equipment ?? null)}
                    disabled={added.has(ei)}
                    className="flex items-center gap-0.5 rounded-full bg-accent-wash px-2 py-0.5 text-[11.5px] font-semibold text-accent disabled:opacity-50"
                  >
                    {added.has(ei) ? 'Added' : <><Plus size={12} /> Add</>}
                  </button>
                )
              }
            />
          ))}
        </div>
      </div>
    </Card>
  )
}

// The exact bundle that leaves the device — the §13 consent disclosure.
export function ContextDisclosure({
  variant,
  onDismiss,
}: {
  variant: 'screen' | 'sheet'
  onDismiss: () => void
}) {
  const context = useLiveQuery<CoachContext | undefined>(
    () => buildCoachContext({ includeActiveWorkout: variant === 'sheet' }),
    [variant],
  )
  return (
    <BottomSheet onDismiss={onDismiss} panelClassName="max-h-[85%] overflow-y-auto">
      <div className="sticky top-0 border-b border-line bg-surface px-5 py-3.5">
        <h2 className="text-[17px] font-bold tracking-tight">Exactly what's sent</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-secondary">
          This is the context the coach receives. It can also look up specific past workouts
          on request. Nothing else leaves your device.
        </p>
      </div>
      <pre className="overflow-x-auto px-5 py-4 text-[11.5px] leading-relaxed text-ink-secondary">
        {context ? JSON.stringify(context, null, 2) : 'Building…'}
      </pre>
    </BottomSheet>
  )
}
