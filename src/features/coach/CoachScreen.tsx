/**
 * The AI coach screen (§13).
 *
 * Three things the user can ask for — a critique, a next-week plan, or a
 * freeform question — answered from the de-identified summary (§2). A plan is
 * never auto-applied: it's shown as editable-in-preview and only becomes
 * templates on an explicit "Save as templates". The "view the data sent"
 * disclosure shows exactly what left the device, because opt-in without
 * visibility isn't meaningful consent.
 *
 * The provider is injected (mock today, LLM later) so this screen never changes
 * when the real one lands.
 */

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ChevronLeft,
  Eye,
  Lightbulb,
  ListChecks,
  MessageCircle,
  Sparkles,
} from 'lucide-react'
import * as repo from '@/data/repository'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { BottomSheet } from '@/components/BottomSheet'
import { useToast } from '@/components/Toast'
import { mockCoachProvider } from './mockProvider'
import type { CoachPlan, CoachProvider, CoachResponse } from './types'
import type { CoachSummary } from './summary'

export function CoachScreen({
  onBack,
  onOpenTemplates,
  provider = mockCoachProvider,
}: {
  onBack: () => void
  onOpenTemplates: () => void
  /** Injected so the real LLM provider drops in without touching this screen. */
  provider?: CoachProvider
}) {
  const toast = useToast()
  const summary = useLiveQuery(() => repo.getCoachSummary(), [])
  const [response, setResponse] = useState<CoachResponse | null>(null)
  const [pending, setPending] = useState<'critique' | 'plan' | 'question' | null>(null)
  const [showData, setShowData] = useState(false)
  const [saving, setSaving] = useState(false)

  async function ask(request: Parameters<CoachProvider['respond']>[1]) {
    if (!summary) return
    setPending(request.kind)
    setResponse(null)
    try {
      setResponse(await provider.respond(summary, request))
    } catch {
      toast.show('The coach could not respond — try again')
    } finally {
      setPending(null)
    }
  }

  async function savePlan(plan: CoachPlan) {
    if (!summary) return
    setSaving(true)
    try {
      const { templateIds, unmatched } = await repo.createTemplatesFromPlan({
        sessions: plan.sessions,
        unitWeight: summary.unitWeight,
      })
      toast.show(
        unmatched.length > 0
          ? `Saved ${templateIds.length} templates · skipped ${unmatched.length} unknown`
          : `Saved ${templateIds.length} templates`,
      )
      onOpenTemplates()
    } finally {
      setSaving(false)
    }
  }

  const empty = summary && summary.totalWorkouts === 0

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-line bg-surface px-2 py-2 pt-safe">
        <button
          onClick={onBack}
          aria-label="Back"
          className="flex size-10 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken"
        >
          <ChevronLeft size={22} />
        </button>
        <h1 className="flex-1 text-[16px] font-semibold tracking-tight">Coach</h1>
        {summary && (
          <button
            onClick={() => setShowData(true)}
            className="flex items-center gap-1 pr-2 text-[12.5px] font-medium text-ink-muted active:opacity-60"
          >
            <Eye size={14} />
            Data sent
          </button>
        )}
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {/* Provenance + the standing caveat (§13: always a suggestion). */}
        <p className="px-1 text-[12px] text-ink-muted">
          Suggestions from {provider.name}, based on a de-identified summary of your
          training. Always a starting point — never medical advice, never auto-applied.
        </p>

        <div className="grid grid-cols-3 gap-2">
          <ActionButton
            icon={<Lightbulb size={18} />}
            label="Critique"
            busy={pending === 'critique'}
            disabled={!summary || pending !== null}
            onClick={() => void ask({ kind: 'critique' })}
          />
          <ActionButton
            icon={<ListChecks size={18} />}
            label="Plan week"
            busy={pending === 'plan'}
            disabled={!summary || pending !== null}
            onClick={() => void ask({ kind: 'plan' })}
          />
          <ActionButton
            icon={<MessageCircle size={18} />}
            label="Ask"
            busy={pending === 'question'}
            disabled={!summary || pending !== null}
            onClick={() => setResponse({ kind: 'answer', text: '' })}
          />
        </div>

        {empty && (
          <Card className="p-5 text-center">
            <Sparkles size={24} className="mx-auto text-ink-muted" />
            <p className="mt-2 text-[15px] font-semibold">Nothing to coach yet</p>
            <p className="mt-1 text-[13.5px] text-ink-secondary">
              Log a few workouts and the coach can critique your balance and draft a plan
              from your history.
            </p>
          </Card>
        )}

        {response?.kind === 'critique' && (
          <Card className="p-4">
            <SectionLabel>What stands out</SectionLabel>
            <ul className="mt-2 space-y-1.5">
              {response.critique.observations.map((o, i) => (
                <li key={i} className="text-[14px] leading-snug">
                  {o}
                </li>
              ))}
            </ul>
            <SectionLabel className="mt-4">Suggestions</SectionLabel>
            <ul className="mt-2 space-y-1.5">
              {response.critique.suggestions.map((s, i) => (
                <li key={i} className="flex gap-2 text-[14px] leading-snug">
                  <span className="text-accent">→</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {response?.kind === 'plan' && (
          <PlanView
            plan={response.plan}
            saving={saving}
            onSave={() => void savePlan(response.plan)}
          />
        )}

        {response?.kind === 'answer' && (
          <AskCard
            answer={response.text}
            busy={pending === 'question'}
            onAsk={(question) => void ask({ kind: 'question', question })}
          />
        )}
      </div>

      {showData && summary && (
        <DataDisclosure summary={summary} onDismiss={() => setShowData(false)} />
      )}
    </div>
  )
}

function ActionButton({
  icon,
  label,
  busy,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1 rounded-xl border border-line bg-surface py-3 text-[12.5px] font-semibold active:bg-accent-wash disabled:opacity-40"
    >
      <span className="text-accent">{icon}</span>
      {busy ? 'Thinking…' : label}
    </button>
  )
}

function PlanView({
  plan,
  saving,
  onSave,
}: {
  plan: CoachPlan
  saving: boolean
  onSave: () => void
}) {
  return (
    <Card className="p-4">
      <SectionLabel>Proposed week</SectionLabel>
      <p className="mt-1 text-[13.5px] text-ink-secondary">{plan.overview}</p>

      <div className="mt-3 space-y-3">
        {plan.sessions.map((session, si) => (
          <div key={si} className="rounded-xl border border-line">
            <p className="border-b border-line px-3 py-2 text-[14px] font-semibold">
              {session.name}
            </p>
            <div className="divide-y divide-line">
              {session.exercises.map((e, ei) => (
                <div key={ei} className="px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[14px] font-medium">{e.name}</span>
                    <span className="tabular shrink-0 text-[12.5px] text-ink-muted">
                      {e.sets} ×{' '}
                      {e.repLow === e.repHigh ? e.repLow : `${e.repLow}-${e.repHigh}`}
                      {e.weight !== null && ` · ${e.weight}`}
                    </span>
                  </div>
                  {e.note && (
                    <p className="mt-0.5 text-[12px] text-ink-muted">{e.note}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[12px] text-ink-muted">
        Saving creates one editable template per session. Tweak anything afterward in
        Templates.
      </p>
      <Button className="mt-2 w-full" disabled={saving} onClick={onSave}>
        {saving ? 'Saving…' : 'Save as templates'}
      </Button>
    </Card>
  )
}

function AskCard({
  answer,
  busy,
  onAsk,
}: {
  answer: string
  busy: boolean
  onAsk: (question: string) => void
}) {
  const [draft, setDraft] = useState('')
  return (
    <Card className="p-4">
      <SectionLabel>Ask about your training</SectionLabel>
      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="e.g. what's my weakest area?"
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-[15px] outline-none focus:border-accent"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim()) onAsk(draft.trim())
          }}
        />
        <Button
          variant="secondary"
          disabled={busy || draft.trim() === ''}
          onClick={() => draft.trim() && onAsk(draft.trim())}
        >
          Ask
        </Button>
      </div>
      {answer && <p className="mt-3 text-[14px] leading-snug">{answer}</p>}
    </Card>
  )
}

/** The exact payload that would leave the device — the §13 consent disclosure. */
function DataDisclosure({
  summary,
  onDismiss,
}: {
  summary: CoachSummary
  onDismiss: () => void
}) {
  return (
    <BottomSheet onDismiss={onDismiss} panelClassName="max-h-[85%] overflow-y-auto">
      <div className="sticky top-0 border-b border-line bg-surface px-5 py-3.5">
        <h2 className="text-[17px] font-bold tracking-tight">Exactly what's sent</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-secondary">
          No name, no dates, no notes — just these aggregates. Nothing else leaves your
          device.
        </p>
      </div>
      <pre className="overflow-x-auto px-5 py-4 text-[11.5px] leading-relaxed text-ink-secondary">
        {JSON.stringify(summary, null, 2)}
      </pre>
    </BottomSheet>
  )
}

function SectionLabel({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <p
      className={
        'text-[12px] font-semibold uppercase tracking-wide text-ink-muted ' + className
      }
    >
      {children}
    </p>
  )
}
