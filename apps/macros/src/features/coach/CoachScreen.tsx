import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Send, Sparkles } from 'lucide-react'
import { Button, Card, useToast } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { cn } from '@/lib/cn'
import { grams } from '@/features/shared/format'
import { buildCoachContext, geminiCoachProvider } from './geminiProvider'
import { mockCoachProvider } from './mockProvider'
import type { CoachAction, CoachProvider, GeminiContent } from './types'

type Item =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; text: string }
  | { id: string; role: 'assistant'; action: CoachAction }

const SUGGESTIONS = [
  "What's left for today?",
  'How is my weight trending?',
  'Suggest a high-protein dinner',
  'Why did my target change?',
]

export function CoachScreen({ onBack }: { onBack: () => void }) {
  const toast = useToast()
  const [items, setItems] = useState<Item[]>([])
  const [contents, setContents] = useState<GeminiContent[]>([])
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [isOffline, setIsOffline] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [items, status])

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || status !== null) return

    const nextContents: GeminiContent[] = [
      ...contents,
      { role: 'user', parts: [{ text: trimmed }] },
    ]
    setItems((current) => [...current, { id: crypto.randomUUID(), role: 'user', text: trimmed }])
    setContents(nextContents)
    setDraft('')
    setStatus('Thinking')

    // Live first, offline as the fallback — a rate-limited free tier is an expected state,
    // so the user should get an answer rather than an error.
    let provider: CoachProvider = mockCoachProvider
    try {
      if (await geminiCoachProvider.isAvailable()) provider = geminiCoachProvider
    } catch {
      provider = mockCoachProvider
    }

    try {
      const context = await buildCoachContext()
      const result = await provider.chat(nextContents, context, {
        onTool: (label) => setStatus(label),
      })
      setIsOffline(provider === mockCoachProvider)
      setContents((current) => [
        ...current,
        { role: 'model', parts: [{ text: result.text }] },
      ])
      setItems((current) => [
        ...current,
        ...(result.text
          ? [{ id: crypto.randomUUID(), role: 'assistant' as const, text: result.text }]
          : []),
        ...(result.action
          ? [{ id: crypto.randomUUID(), role: 'assistant' as const, action: result.action }]
          : []),
      ])
    } catch {
      const fallback = await mockCoachProvider.chat(nextContents, await buildCoachContext())
      setIsOffline(true)
      setItems((current) => [
        ...current,
        { id: crypto.randomUUID(), role: 'assistant', text: fallback.text },
      ])
    } finally {
      setStatus(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-line bg-surface px-2 py-2 pt-safe">
        <button
          onClick={onBack}
          aria-label="Back"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken"
        >
          <ChevronLeft size={22} />
        </button>
        <h1 className="flex-1 text-[16px] font-semibold tracking-tight">Coach</h1>
        {isOffline && (
          <span className="rounded-full bg-sunken px-2 py-1 text-[11px] font-semibold text-ink-muted">
            offline
          </span>
        )}
      </header>

      <div className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {items.length === 0 && (
          <Card className="p-4">
            <span className="flex size-10 items-center justify-center rounded-xl bg-accent-wash text-accent">
              <Sparkles size={20} />
            </span>
            <h2 className="mt-2.5 text-[15px] font-semibold tracking-tight">
              Ask about your own numbers
            </h2>
            <p className="mt-1 text-[13px] text-ink-secondary">
              The coach reads your logs and weigh-ins to answer. Anything it suggests logging
              comes back as a card you confirm — it never writes to your diary on its own.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => void send(suggestion)}
                  className="rounded-full bg-sunken px-3 py-1.5 text-left text-[12.5px] text-ink-secondary active:opacity-60"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </Card>
        )}

        {items.map((item) =>
          'action' in item ? (
            <ActionCard
              key={item.id}
              action={item.action}
              onLogged={(message) => toast.show(message)}
            />
          ) : (
            <Bubble key={item.id} role={item.role} text={item.text} />
          ),
        )}

        {status && (
          <p className="px-1 text-[12.5px] text-ink-muted">
            {status}
            <span className="animate-pulse">…</span>
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-end gap-2 border-t border-line bg-surface px-3 py-2.5 pb-safe">
        <textarea
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send(draft)
            }
          }}
          placeholder="Ask the coach"
          className="max-h-28 min-w-0 flex-1 resize-none rounded-xl bg-sunken px-3 py-2.5 text-[15px] outline-none"
        />
        <button
          onClick={() => void send(draft)}
          disabled={draft.trim() === '' || status !== null}
          aria-label="Send"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-contrast disabled:opacity-40"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  )
}

function Bubble({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  return (
    <div className={cn('flex', role === 'user' ? 'justify-end' : 'justify-start')}>
      <p
        className={cn(
          'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[14.5px] leading-relaxed',
          role === 'user'
            ? 'bg-accent text-accent-contrast'
            : 'bg-surface text-ink ring-1 ring-line',
        )}
      >
        {text}
      </p>
    </div>
  )
}

/** Nothing the coach proposes is applied until this is tapped. */
function ActionCard({
  action,
  onLogged,
}: {
  action: CoachAction
  onLogged: (message: string) => void
}) {
  const [isDone, setIsDone] = useState(false)

  if (action.kind === 'log-food') {
    return (
      <Card className="p-4">
        <h3 className="text-[14.5px] font-semibold tracking-tight">{action.description}</h3>
        <p className="tabular mt-0.5 text-[12.5px] text-ink-muted">
          {Math.round(action.grams)}g · {action.nutrients.kcal} kcal ·{' '}
          {grams(action.nutrients.proteinMg)}P {grams(action.nutrients.carbsMg)}C{' '}
          {grams(action.nutrients.fatMg)}F
        </p>
        <Button
          className="mt-3 w-full"
          disabled={isDone}
          onClick={() => {
            void repo.getFood(action.foodId).then(async (food) => {
              if (!food) return
              await repo.logFood({
                food,
                grams: action.grams,
                meal: action.meal,
                source: 'search',
              })
              setIsDone(true)
              onLogged(`Logged ${action.description}`)
            })
          }}
        >
          {isDone ? 'Logged' : `Log to ${action.meal}`}
        </Button>
      </Card>
    )
  }

  if (action.kind === 'log-recipe') {
    return (
      <Card className="p-4">
        <h3 className="text-[14.5px] font-semibold tracking-tight">{action.name}</h3>
        <p className="tabular mt-0.5 text-[12.5px] text-ink-muted">
          {action.servings === 1 ? 'One serving' : `${action.servings} servings`} ·{' '}
          {action.nutrients.kcal} kcal · {grams(action.nutrients.proteinMg)}P{' '}
          {grams(action.nutrients.carbsMg)}C {grams(action.nutrients.fatMg)}F
        </p>
        <Button
          className="mt-3 w-full"
          disabled={isDone}
          onClick={() => {
            void repo.getRecipe(action.recipeId).then(async (recipe) => {
              if (!recipe) return
              // The same shape as every other path — one dish line over its ingredients.
              await repo.logRecipeIngredients(recipe, action.servings, action.meal)
              setIsDone(true)
              onLogged(`Logged ${action.name}`)
            })
          }}
        >
          {isDone ? 'Logged' : `Log to ${action.meal}`}
        </Button>
      </Card>
    )
  }

  return (
    <Card className="p-4">
      <h3 className="text-[14.5px] font-semibold tracking-tight">{action.title}</h3>
      <p className="tabular mt-0.5 text-[12.5px] text-ink-muted">
        {action.nutrients.kcal} kcal · {grams(action.nutrients.proteinMg)}P{' '}
        {grams(action.nutrients.carbsMg)}C {grams(action.nutrients.fatMg)}F
      </p>
      <ul className="mt-2 divide-y divide-line">
        {action.items.map((item) => (
          <li key={item.foodId} className="flex justify-between gap-3 py-1.5 text-[13.5px]">
            <span className="min-w-0 truncate">{item.description}</span>
            <span className="tabular shrink-0 text-ink-muted">{Math.round(item.grams)}g</span>
          </li>
        ))}
      </ul>
      {action.note && <p className="mt-2 text-[12.5px] text-ink-secondary">{action.note}</p>}
      <Button
        variant="secondary"
        className="mt-3 w-full"
        disabled={isDone}
        onClick={() => {
          void (async () => {
            for (const item of action.items) {
              const food = await repo.getFood(item.foodId)
              if (food) {
                await repo.logFood({ food, grams: item.grams, meal: 'dinner', source: 'search' })
              }
            }
            setIsDone(true)
            onLogged(`Logged ${action.items.length} items`)
          })()
        }}
      >
        {isDone ? 'Logged' : 'Log this meal'}
      </Button>
    </Card>
  )
}
