// Presentational pieces of the coach chat, split out of CoachChat.tsx: message
// bubbles, the interactive action cards (plan / template-update / accessories),
// the conversation-history sheet, and the "what's sent" disclosure. CoachChat owns
// the conversation state and loop; these just render and fire their own actions.

import { useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, SquarePen, Trash2 } from 'lucide-react'
import * as repo from '@/data/repository'
import { buildExerciseResolver } from '@/data/resolveExerciseName'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { BottomSheet } from '@/components/BottomSheet'
import { useToast } from '@/components/Toast'
import { cn } from '@/lib/cn'
import type { WeightUnit } from '@/domain/types'
import { buildCoachContext, type CoachContext } from '../context'
import { describePlanExerciseLoad } from '../tools'
import type { CoachAction, CoachPlan } from '../types'

export function MessageBubble({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  const isUser = role === 'user'
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[14px] leading-snug',
          isUser
            ? 'bg-accent text-accent-contrast'
            : 'border border-line bg-surface text-ink',
        )}
      >
        {text}
      </div>
    </div>
  )
}

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
            <div className="divide-y divide-line">
              {session.exercises.map((e, ei) => (
                <ExerciseRow
                  key={ei}
                  name={e.name}
                  load={describePlanExerciseLoad(e, weightUnit)}
                  note={e.note}
                  autoProgress={e.autoProgress}
                />
              ))}
            </div>
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
        <div className="divide-y divide-line">
          {action.session.exercises.map((e, ei) => (
            <ExerciseRow
              key={ei}
              name={e.name}
              load={describePlanExerciseLoad(e, weightUnit)}
              note={e.note}
              autoProgress={e.autoProgress}
            />
          ))}
        </div>
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

  async function add(index: number, name: string, equipment: string | null) {
    const library = await repo.listExercises()
    const hit = buildExerciseResolver(library)(name, (equipment as never) ?? null)
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

export function HistorySheet({
  conversations,
  activeId,
  onOpen,
  onDelete,
  onNew,
  onDismiss,
}: {
  conversations: { id: string; title: string; updatedAt: number }[]
  activeId: string | null
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onNew: () => void
  onDismiss: () => void
}) {
  return (
    <BottomSheet onDismiss={onDismiss} panelClassName="max-h-[80%] overflow-y-auto">
      <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-5 py-3.5">
        <h2 className="text-[17px] font-bold tracking-tight">Conversations</h2>
        <button
          onClick={onNew}
          className="flex items-center gap-1 text-[13px] font-semibold text-accent active:opacity-60"
        >
          <SquarePen size={15} /> New
        </button>
      </div>
      {conversations.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13.5px] text-ink-muted">
          No saved conversations yet.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {conversations.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-4 py-2.5">
              <button
                onClick={() => onOpen(c.id)}
                className="min-w-0 flex-1 text-left active:opacity-70"
              >
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[14px] font-medium">{c.title}</span>
                  {c.id === activeId && (
                    <span className="shrink-0 rounded-full bg-accent-wash px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                      Current
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[12px] text-ink-muted">
                  {new Date(c.updatedAt).toLocaleDateString()}
                </span>
              </button>
              <button
                onClick={() => onDelete(c.id)}
                aria-label={`Delete "${c.title}"`}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="h-4" />
    </BottomSheet>
  )
}

// The exact bundle that would leave the device — the §13 consent disclosure, now
// showing the full context (dated history, templates, live session) the chat sends.
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

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
      {children}
    </p>
  )
}
