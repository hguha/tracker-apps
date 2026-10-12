import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Eye, LogIn, Sparkles } from 'lucide-react'
import type { CoachBackends } from '@tracker-engine/ai-coach'
import {
  CoachWorking,
  Composer,
  ConversationBar,
  ConversationsSheet,
  MessageBubble,
  useCoachChat,
} from '@tracker-engine/ai-coach/react'
import * as repo from '@/data/repository'
import { useAuth } from '@/auth/AuthContext'
import { isBackendConfigured } from '@/backend/supabaseClient'
import { useToast } from '@/components/Toast'
import { mockCoachProvider } from './mockProvider'
import { geminiCoachProvider } from './geminiProvider'
import { buildCoachContext, type CoachContext } from './context'
import { conversations } from './history'
import { ActionCard, ContextDisclosure } from './chat/ChatCards'
import type { CoachAction } from './types'

const STARTERS = [
  'What should I focus on next?',
  'Build me a plan for my goal',
  'How is my bench trending?',
  'When should I train this week?',
]

export function CoachChat({
  variant,
  persist = false,
  onOpenTemplates,
  onSignIn,
}: {
  // 'screen' = full-screen coach; 'sheet' = opened over an active workout (live session in context).
  variant: 'screen' | 'sheet'
  // Persist this chat to IndexedDB (full-screen coach only; the in-workout sheet stays ephemeral).
  persist?: boolean
  onOpenTemplates?: () => void
  onSignIn?: () => void
}) {
  const toast = useToast()
  const { session } = useAuth()
  const unit = useLiveQuery(() => repo.getProfile().then((p) => p.unitWeight), []) ?? 'lb'
  const canUseLiveCoach = isBackendConfigured() && session != null && !session.isLocal

  const [input, setInput] = useState('')
  const [showData, setShowData] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  // Context is expensive to build, so the full-screen chat caches it across turns;
  // the in-workout chat rebuilds each send since the live session changes.
  const contextRef = useRef<CoachContext | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  async function contextForTurn(): Promise<CoachContext> {
    if (variant === 'sheet' || contextRef.current === null) {
      contextRef.current = await buildCoachContext({ includeActiveWorkout: variant === 'sheet' })
    }
    return contextRef.current
  }

  const backends: CoachBackends<CoachAction> = {
    isLiveAvailable: async () => canUseLiveCoach && (await geminiCoachProvider.isAvailable()),
    live: async (contents, onTool) =>
      geminiCoachProvider.chat!(contents, await contextForTurn(), { onTool }),
    offline: async (contents) => mockCoachProvider.chat!(contents, await contextForTurn()),
    onLiveError: (detail) => toast.show(`Live coach unavailable — ${detail}`),
  }
  const chat = useCoachChat({ backends, store: persist ? conversations : undefined })
  const { items } = chat

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [items, chat.isPending, chat.toolStatus])

  const saved = useLiveQuery(() => (persist ? conversations.list() : Promise.resolve([])), [persist])

  function newChat() {
    chat.newChat()
    setInput('')
  }

  async function openConversation(id: string) {
    const conversation = await conversations.load(id)
    if (!conversation) return
    chat.open(conversation)
    setShowHistory(false)
  }

  async function removeConversation(id: string) {
    await conversations.remove(id)
    if (id === chat.conversationId) newChat()
  }

  function send(text: string) {
    if (!text.trim() || chat.isPending) return
    setInput('')
    void chat.send(text)
  }

  const showStarters = items.length === 0 && !chat.isPending

  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      {persist && (
        <ConversationBar
          title={items.length > 0 ? chat.title : ''}
          canStartNew={items.length > 0}
          onHistory={() => setShowHistory(true)}
          onNew={newChat}
        />
      )}

      {variant === 'sheet' && (
        <div className="flex items-center gap-2 px-4 pb-1 pt-1">
          <Sparkles size={15} className="text-accent" />
          <span className="flex-1 text-[14px] font-semibold">Coach · this workout</span>
          <button
            onClick={() => setShowData(true)}
            className="flex items-center gap-1 text-[12px] text-ink-muted active:opacity-60"
          >
            <Eye size={13} /> What's sent
          </button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {variant === 'screen' && (
          <p className="px-1 text-[12px] text-ink-muted">
            The coach sees your training history, templates, and — mid-workout — your live
            session. Always a starting point, never medical advice.{' '}
            <button onClick={() => setShowData(true)} className="font-medium text-accent">
              See what's sent
            </button>
            .
          </p>
        )}

        {isBackendConfigured() && !canUseLiveCoach && (
          <button
            onClick={onSignIn}
            className="flex w-full items-start gap-3 rounded-2xl border border-accent/30 bg-accent-wash p-3.5 text-left active:opacity-80"
          >
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-contrast">
              <LogIn size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold text-ink">
                Sign in for the full coach
              </span>
              <span className="mt-0.5 block text-[12.5px] text-ink-secondary">
                You're on the offline coach — it drafts plans from your history, but the
                back-and-forth chat needs a connection.
              </span>
            </span>
          </button>
        )}

        {items.map((item) =>
          'action' in item ? (
            <ActionCard
              key={item.id}
              action={item.action}
              weightUnit={unit}
              variant={variant}
              onOpenTemplates={onOpenTemplates}
            />
          ) : (
            <MessageBubble key={item.id} role={item.role} text={item.text} />
          ),
        )}

        <CoachWorking toolStatus={chat.toolStatus} pendingSince={chat.pendingSince} />

        {showStarters && (
          <div className="flex flex-wrap gap-1.5 px-1 pt-1">
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink-secondary active:bg-accent-wash"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <Composer
        value={input}
        onChange={setInput}
        onSend={() => send(input)}
        isDisabled={chat.isPending}
        placeholder="Ask your coach…"
      />

      {showData && <ContextDisclosure variant={variant} onDismiss={() => setShowData(false)} />}

      {showHistory && (
        <ConversationsSheet
          conversations={saved ?? []}
          activeId={chat.conversationId}
          onOpen={(id) => void openConversation(id)}
          onDelete={(id) => void removeConversation(id)}
          onNew={() => {
            newChat()
            setShowHistory(false)
          }}
          onDismiss={() => setShowHistory(false)}
        />
      )}
    </div>
  )
}
