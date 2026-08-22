import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Eye,
  History as HistoryIcon,
  Loader2,
  LogIn,
  Send,
  Sparkles,
  SquarePen,
} from 'lucide-react'
import * as repo from '@/data/repository'
import { useAuth } from '@/auth/AuthContext'
import { isBackendConfigured } from '@/backend/supabaseClient'
import { useToast } from '@/components/Toast'
import { mockCoachProvider } from './mockProvider'
import { geminiCoachProvider } from './geminiProvider'
import { buildCoachContext, type CoachContext } from './context'
import {
  conversationTitleFrom,
  deleteConversation,
  listConversations,
  loadConversation,
  mostRecentConversationId,
  saveConversation,
  type StoredMessage,
} from './history'
import {
  ActionCard,
  ContextDisclosure,
  HistorySheet,
  MessageBubble,
} from './chat/ChatCards'
import type { CoachAction, GeminiContent } from './types'

// The display item and the persisted StoredMessage are the same shape; the id is a
// render-only key added on top.
type ChatItemInput = StoredMessage
type ChatItem = ChatItemInput & { id: number }

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

  const [items, setItems] = useState<ChatItem[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [showData, setShowData] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  // The persisted conversation this chat is writing to (null until the first message).
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [title, setTitle] = useState('')

  // The Gemini conversation, kept in a ref so the loop never reads a stale copy.
  const contentsRef = useRef<GeminiContent[]>([])
  // Building context scans a lot of history, so cache it: the full-screen chat
  // builds once and reuses it across follow-ups; the in-workout chat rebuilds each
  // send since the live session changes as sets are logged.
  const contextRef = useRef<CoachContext | null>(null)
  const idRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const pushItem = (item: ChatItemInput) =>
    setItems((prev) => [...prev, { ...item, id: (idRef.current += 1) }])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [items, pending, toolStatus])

  // Resume the most recent conversation on open (ChatGPT-style); "New chat" starts fresh.
  useEffect(() => {
    if (!persist) return
    void (async () => {
      const recent = await mostRecentConversationId()
      if (!recent) return
      const convo = await loadConversation(recent)
      if (!convo || convo.items.length === 0) return
      contentsRef.current = convo.contents
      idRef.current = convo.items.length
      setTitle(convo.title)
      setItems(convo.items.map((m, i) => ({ ...m, id: i + 1 })))
      setConversationId(recent)
    })()
    // Load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persist])

  // Persist after every change once a conversation exists. Local Dexie writes are
  // cheap, and contentsRef is updated before setItems, so it's current here.
  useEffect(() => {
    if (!persist || conversationId === null || items.length === 0) return
    void saveConversation({
      id: conversationId,
      title: title || 'New chat',
      contents: contentsRef.current,
      items: items.map(({ id: _id, ...rest }) => rest),
    })
  }, [persist, conversationId, items, title])

  const conversations = useLiveQuery(
    () => (persist ? listConversations() : Promise.resolve([])),
    [persist],
  )

  function startConversationIfNeeded(firstText: string) {
    if (!persist || conversationId !== null) return
    setConversationId(crypto.randomUUID())
    setTitle(conversationTitleFrom(firstText))
  }

  function newChat() {
    // The current one is already saved by the persist effect; just reset in place.
    setItems([])
    contentsRef.current = []
    idRef.current = 0
    setTitle('')
    setConversationId(null)
    setInput('')
  }

  async function openConversation(id: string) {
    const convo = await loadConversation(id)
    if (!convo) return
    contentsRef.current = convo.contents
    idRef.current = convo.items.length
    setTitle(convo.title)
    setItems(convo.items.map((m, i) => ({ ...m, id: i + 1 })))
    setConversationId(id)
    setShowHistory(false)
  }

  async function removeConversation(id: string) {
    await deleteConversation(id)
    if (id === conversationId) newChat()
  }

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || pending) return
    setInput('')
    startConversationIfNeeded(trimmed)

    const nextContents: GeminiContent[] = [
      ...contentsRef.current,
      { role: 'user', parts: [{ text: trimmed }] },
    ]
    contentsRef.current = nextContents
    pushItem({ role: 'user', text: trimmed })
    setPending(true)
    setToolStatus(null)

    // Reuse the cached context for the full-screen chat; the in-workout chat must
    // see the current live session, so it rebuilds each turn.
    let context = contextRef.current
    if (variant === 'sheet' || context === null) {
      context = await buildCoachContext({ includeActiveWorkout: variant === 'sheet' })
      contextRef.current = context
    }
    const useLive = canUseLiveCoach && (await geminiCoachProvider.isAvailable())

    try {
      const provider = useLive ? geminiCoachProvider : mockCoachProvider
      const result = await provider.chat!(nextContents, context, { onTool: setToolStatus })
      applyResult(result.contents, result.text, result.action)
    } catch (liveError) {
      // Live path failed — fall back to the offline coach rather than nothing.
      const detail = liveError instanceof Error ? liveError.message : String(liveError)
      console.error('[coach] live chat failed:', detail)
      try {
        const result = await mockCoachProvider.chat!(nextContents, context)
        applyResult(result.contents, result.text, result.action)
        if (useLive) toast.show(`Live coach unavailable — ${detail}`)
      } catch {
        pushItem({ role: 'assistant', text: 'The coach could not respond — try again.' })
      }
    } finally {
      setPending(false)
      setToolStatus(null)
    }
  }

  function applyResult(contents: GeminiContent[], text: string, action?: CoachAction) {
    contentsRef.current = contents
    if (text) pushItem({ role: 'assistant', text })
    if (action) pushItem({ role: 'assistant', action })
    if (!text && !action) {
      pushItem({ role: 'assistant', text: "I'm not sure how to help with that — try rephrasing?" })
    }
  }

  const showStarters = items.length === 0 && !pending

  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      {persist && (
        <div className="flex items-center gap-1 border-b border-line bg-surface px-2 py-1.5">
          <button
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] font-medium text-ink-secondary active:bg-sunken"
          >
            <HistoryIcon size={15} /> History
          </button>
          <span className="flex-1 truncate px-1 text-center text-[12px] text-ink-muted">
            {items.length > 0 ? title : ''}
          </span>
          <button
            onClick={newChat}
            disabled={items.length === 0}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] font-medium text-accent active:bg-sunken disabled:opacity-40"
          >
            <SquarePen size={15} /> New
          </button>
        </div>
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

        {toolStatus && (
          <div className="flex items-center gap-2 px-1 text-[12.5px] text-ink-muted">
            <Loader2 size={13} className="animate-spin" />
            {toolStatus}…
          </div>
        )}
        {pending && !toolStatus && (
          <div className="flex items-center gap-2 px-1 text-[12.5px] text-ink-muted">
            <Loader2 size={13} className="animate-spin" />
            Thinking…
          </div>
        )}

        {showStarters && (
          <div className="flex flex-wrap gap-1.5 px-1 pt-1">
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => void send(s)}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink-secondary active:bg-accent-wash"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-line bg-surface px-3 py-2.5 pb-safe">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send(input)
            }
          }}
          rows={1}
          placeholder="Ask your coach…"
          className="max-h-28 min-h-[44px] min-w-0 flex-1 resize-none rounded-xl border border-line bg-sunken px-3.5 py-2.5 text-[16px] outline-none focus:border-accent focus:bg-surface"
        />
        <button
          onClick={() => void send(input)}
          disabled={pending || input.trim() === ''}
          aria-label="Send"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-contrast disabled:opacity-40"
        >
          <Send size={18} />
        </button>
      </div>

      {showData && <ContextDisclosure variant={variant} onDismiss={() => setShowData(false)} />}

      {showHistory && (
        <HistorySheet
          conversations={conversations ?? []}
          activeId={conversationId}
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
