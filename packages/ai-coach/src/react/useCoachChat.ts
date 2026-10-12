import { useEffect, useRef, useState } from 'react'
import {
  coachTurn,
  conversationTitleFrom,
  type CoachBackends,
  type CoachMessage,
  type ConversationStore,
  type StoredConversation,
} from '../chat'
import type { GeminiContent } from '../types'

export type CoachItem<TAction> = CoachMessage<TAction> & { id: number }

export function useCoachChat<TAction>({
  backends,
  store,
}: {
  backends: CoachBackends<TAction>
  store?: ConversationStore<TAction>
}) {
  const [items, setItems] = useState<CoachItem<TAction>[]>([])
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [pendingSince, setPendingSince] = useState<number | null>(null)
  const [isOffline, setIsOffline] = useState(false)
  const [conversation, setConversation] = useState<{ id: string; title: string } | null>(null)
  const contentsRef = useRef<GeminiContent[]>([])
  const idRef = useRef(0)

  const withIds = (messages: CoachMessage<TAction>[]): CoachItem<TAction>[] =>
    messages.map((message) => ({ ...message, id: (idRef.current += 1) }))

  function open(stored: StoredConversation<TAction>) {
    contentsRef.current = stored.contents
    idRef.current = 0
    setItems(withIds(stored.items))
    setConversation({ id: stored.id, title: stored.title })
  }

  useEffect(() => {
    if (!store) return
    let isCancelled = false
    store
      .mostRecent()
      .then((stored) => {
        if (!isCancelled && contentsRef.current.length === 0 && stored && stored.items.length > 0) {
          open(stored)
        }
      })
      .catch((error) => console.error('[coach] could not load the last conversation', error))
    return () => {
      isCancelled = true
    }
  }, [store])

  useEffect(() => {
    if (!store || conversation === null || items.length === 0) return
    store
      .save({
        ...conversation,
        contents: contentsRef.current,
        items: items.map(({ id: _id, ...message }) => message as CoachMessage<TAction>),
      })
      .catch((error) => console.error('[coach] could not save the conversation', error))
  }, [store, conversation, items])

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || pendingSince !== null) return
    if (store && conversation === null) {
      setConversation({ id: crypto.randomUUID(), title: conversationTitleFrom(trimmed) })
    }

    const contents: GeminiContent[] = [
      ...contentsRef.current,
      { role: 'user', parts: [{ text: trimmed }] },
    ]
    contentsRef.current = contents
    setItems((current) => [...current, ...withIds([{ role: 'user', text: trimmed }])])
    setPendingSince(Date.now())
    setToolStatus(null)

    try {
      const turn = await coachTurn(backends, contents, setToolStatus)
      contentsRef.current = turn.contents
      setIsOffline(turn.isOffline)
      setItems((current) => [...current, ...withIds(turn.messages)])
    } finally {
      setPendingSince(null)
      setToolStatus(null)
    }
  }

  function newChat() {
    contentsRef.current = []
    idRef.current = 0
    setItems([])
    setConversation(null)
  }

  return {
    items,
    isPending: pendingSince !== null,
    pendingSince,
    toolStatus,
    isOffline,
    conversationId: conversation?.id ?? null,
    title: conversation?.title ?? '',
    send,
    newChat,
    open,
  }
}
