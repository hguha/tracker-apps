import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { SlidersHorizontal, Sparkles } from 'lucide-react'
import type { CoachBackends } from '@tracker-engine/ai-coach'
import {
  CoachWorking,
  Composer,
  ConversationBar,
  ConversationsSheet,
  MessageBubble,
  useCoachChat,
} from '@tracker-engine/ai-coach/react'
import { Button, Card, ScreenHeader, useToast } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { coachHistory } from '@/data/coachHistory'
import { cn, formatGrams } from '@tracker-engine/core'
import { macroLine } from '@/features/shared/format'
import { buildCoachContext, geminiCoachProvider } from './geminiProvider'
import { mockCoachProvider } from './mockProvider'
import { DietNotesCard } from './DietNotesCard'
import type { CoachAction } from './types'

const SUGGESTIONS = [
  "What's left for today?",
  'How is my weight trending?',
  'Suggest a high-protein dinner',
  'Why did my target change?',
]

const history = coachHistory<CoachAction>()

export function CoachScreen({ onBack }: { onBack: () => void }) {
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [isEditingNotes, setIsEditingNotes] = useState(false)
  const [isShowingHistory, setIsShowingHistory] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const backends: CoachBackends<CoachAction> = {
    isLiveAvailable: () => geminiCoachProvider.isAvailable(),
    live: async (contents, onTool) =>
      geminiCoachProvider.chat(contents, await buildCoachContext(), { onTool }),
    offline: async (contents) => mockCoachProvider.chat(contents, await buildCoachContext()),
    onLiveError: (detail) => toast.show(`Live coach unavailable — ${detail}`),
  }
  const chat = useCoachChat({ backends, store: history })
  const { items } = chat
  const saved = useLiveQuery(() => history.list(), [], [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [items, chat.isPending, chat.toolStatus])

  function send(text: string) {
    if (!text.trim() || chat.isPending) return
    setDraft('')
    void chat.send(text)
  }

  function newChat() {
    chat.newChat()
    setDraft('')
  }

  async function openConversation(id: string) {
    const conversation = await history.load(id)
    if (!conversation) return
    chat.open(conversation)
    setIsShowingHistory(false)
  }

  async function removeConversation(id: string) {
    await history.remove(id)
    if (id === chat.conversationId) newChat()
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title="Coach"
        onBack={onBack}
        action={
          <>
            {chat.isOffline && (
              <span className="rounded-full bg-sunken px-2 py-1 text-[11px] font-semibold text-ink-muted">
                offline
              </span>
            )}
            <button
              onClick={() => setIsEditingNotes((current) => !current)}
              aria-label="What the coach should know"
              aria-expanded={isEditingNotes}
              className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-lg active:bg-sunken',
                isEditingNotes ? 'text-accent' : 'text-ink-secondary',
              )}
            >
              <SlidersHorizontal size={19} />
            </button>
          </>
        }
      />
      <ConversationBar
        title={items.length > 0 ? chat.title : ''}
        canStartNew={items.length > 0}
        onHistory={() => setIsShowingHistory(true)}
        onNew={newChat}
      />

      <div className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {isEditingNotes && <DietNotesCard />}
        {items.length === 0 && (
          <Card className="p-4">
            <span className="flex size-10 items-center justify-center rounded-xl bg-accent-wash text-accent">
              <Sparkles size={20} />
            </span>
            <h2 className="mt-2.5 text-[15px] font-semibold tracking-tight">
              Ask about your own numbers
            </h2>
            <p className="mt-1 text-[13px] text-ink-secondary">
              Answers from your logs and weigh-ins. Nothing is logged until you confirm.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => send(suggestion)}
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
            <MessageBubble key={item.id} role={item.role} text={item.text} />
          ),
        )}

        <CoachWorking toolStatus={chat.toolStatus} pendingSince={chat.pendingSince} />
        <div ref={bottomRef} />
      </div>

      <Composer
        value={draft}
        onChange={setDraft}
        onSend={() => send(draft)}
        isDisabled={chat.isPending}
        placeholder="Ask the coach"
      />

      {isShowingHistory && (
        <ConversationsSheet
          conversations={saved}
          activeId={chat.conversationId}
          onOpen={(id) => void openConversation(id)}
          onDelete={(id) => void removeConversation(id)}
          onNew={() => {
            newChat()
            setIsShowingHistory(false)
          }}
          onDismiss={() => setIsShowingHistory(false)}
        />
      )}
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
          {formatGrams(action.grams)} · {action.nutrients.kcal} kcal · {macroLine(action.nutrients)}
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
          {action.nutrients.kcal} kcal · {macroLine(action.nutrients)}
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
        {action.nutrients.kcal} kcal · {macroLine(action.nutrients)}
      </p>
      <ul className="mt-2 divide-y divide-line">
        {action.items.map((item) => (
          <li key={item.foodId} className="flex justify-between gap-3 py-1.5 text-[13.5px]">
            <span className="min-w-0 truncate">{item.description}</span>
            <span className="tabular shrink-0 text-ink-muted">{formatGrams(item.grams)}</span>
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
