// The coach chat. A tool-using agent (Gemini) or the offline mock; either way the
// conversation is driven through the provider. Budget suggestions come back as cards
// the user can apply, which write straight through the repository.

import { useRef, useState } from 'react'
import { ArrowLeft, Send, Sparkles } from 'lucide-react'
import { Button, useToast } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { fmtAbs } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useCoach } from './useCoach'
import type { CoachAction, GeminiContent } from './types'

interface Turn {
  role: 'user' | 'assistant'
  text: string
  action?: CoachAction
}

const PROMPTS = [
  "Where's my money going?",
  'Any subscriptions I forgot about?',
  'Help me set a budget',
  "How's my saving this month?",
]

export function CoachScreen({ onClose }: { onClose: () => void }) {
  const { provider } = useCoach()
  const toast = useToast()
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const contents = useRef<GeminiContent[]>([])

  async function send(text: string) {
    const message = text.trim()
    if (!message || busy || !provider) return
    setInput('')
    setTurns((t) => [...t, { role: 'user', text: message }])
    setBusy(true)
    setStatus(null)

    const next: GeminiContent[] = [
      ...contents.current,
      { role: 'user', parts: [{ text: message }] },
    ]
    try {
      const result = await provider.chat(next, { month: null, currency: 'USD' }, {
        onTool: (label) => setStatus(label),
      })
      contents.current = result.contents
      setTurns((t) => [...t, { role: 'assistant', text: result.text, action: result.action }])
    } catch (error) {
      setTurns((t) => [
        ...t,
        { role: 'assistant', text: 'Something went wrong reaching the coach. Try again in a moment.' },
      ])
      console.warn('[coach]', error)
    } finally {
      setBusy(false)
      setStatus(null)
    }
  }

  async function applyBudget(action: CoachAction) {
    await repo.setBudget(action.categoryId, action.limitMinor)
    toast.show(`Budget set for ${action.categoryName}`)
  }

  return (
    <div className="flex h-full flex-col bg-page">
      <header className="flex items-center gap-3 px-4 pb-2 pt-3">
        <button onClick={onClose} aria-label="Back" className="text-ink-secondary">
          <ArrowLeft size={22} />
        </button>
        <h1 className="flex items-center gap-1.5 text-lg font-bold text-ink">
          <Sparkles size={18} className="text-accent" /> Coach
        </h1>
        {provider && (
          <span className="ml-auto text-xs text-ink-muted">
            {provider.name.includes('offline') ? 'offline' : 'live'}
          </span>
        )}
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {turns.length === 0 && (
          <div className="flex flex-col items-center gap-4 pt-8 text-center">
            <div className="text-4xl">💬</div>
            <p className="max-w-xs text-sm text-ink-muted">
              Ask about your spending, subscriptions, or budgets. Your numbers never
              leave the analysis — the coach sees aggregates, not account details.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => void send(p)}
                  className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-ink-secondary active:bg-sunken"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className={cn('flex', turn.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[15px]',
                turn.role === 'user'
                  ? 'bg-accent text-accent-contrast'
                  : 'bg-surface text-ink',
              )}
            >
              {turn.text}
              {turn.action && (
                <BudgetCard action={turn.action} onApply={() => void applyBudget(turn.action!)} />
              )}
            </div>
          </div>
        ))}

        {status && <div className="text-sm text-ink-muted">{status}</div>}
      </div>

      <div className="border-t border-line p-3 pb-safe">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void send(input)}
            placeholder={provider ? 'Ask the coach…' : 'Loading…'}
            disabled={!provider || busy}
            className="h-11 flex-1 rounded-xl border border-line bg-surface px-4 text-ink outline-none focus:border-accent"
          />
          <button
            onClick={() => void send(input)}
            disabled={!input.trim() || busy}
            aria-label="Send"
            className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-contrast disabled:opacity-40"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}

function BudgetCard({ action, onApply }: { action: CoachAction; onApply: () => void }) {
  const [applied, setApplied] = useState(false)
  return (
    <div className="mt-2 rounded-xl border border-line bg-page p-3">
      <div className="text-sm font-semibold text-ink">
        Budget · {action.categoryName}
      </div>
      <div className="mt-0.5 text-lg font-bold tabular-nums text-ink">
        {fmtAbs(action.limitMinor)}/mo
      </div>
      {action.note && <div className="mt-1 text-xs text-ink-muted">{action.note}</div>}
      <Button
        size="sm"
        className="mt-2 w-full"
        disabled={applied}
        onClick={() => {
          onApply()
          setApplied(true)
        }}
      >
        {applied ? 'Applied ✓' : 'Set this budget'}
      </Button>
    </div>
  )
}
