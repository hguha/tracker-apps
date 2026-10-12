import { History, Send, SquarePen, Trash2 } from 'lucide-react'
import { cn } from '@tracker-engine/core'
import { BottomSheet, Working } from '@tracker-engine/ui'

export function MessageBubble({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  return (
    <div className={cn('flex', role === 'user' ? 'justify-end' : 'justify-start')}>
      <p
        className={cn(
          'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[14.5px] leading-snug',
          role === 'user' ? 'bg-accent text-accent-contrast' : 'bg-surface text-ink ring-1 ring-line',
        )}
      >
        {text}
      </p>
    </div>
  )
}

export function CoachWorking({
  toolStatus,
  pendingSince,
}: {
  toolStatus: string | null
  pendingSince: number | null
}) {
  if (pendingSince === null) return null
  return (
    <Working
      label={toolStatus ?? 'Thinking'}
      startedAt={pendingSince}
      slowNote="Still going — the coach is slower when it is busy."
    />
  )
}

export function Composer({
  value,
  onChange,
  onSend,
  isDisabled,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  isDisabled: boolean
  placeholder: string
}) {
  return (
    <div className="flex items-end gap-2 border-t border-line bg-surface px-3 py-2.5 pb-safe">
      <textarea
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            onSend()
          }
        }}
        placeholder={placeholder}
        className="max-h-28 min-h-[44px] min-w-0 flex-1 resize-none rounded-xl bg-sunken px-3.5 py-2.5 text-[16px] outline-none"
      />
      <button
        onClick={onSend}
        disabled={isDisabled || value.trim() === ''}
        aria-label="Send"
        className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-contrast disabled:opacity-40"
      >
        <Send size={18} />
      </button>
    </div>
  )
}

export function ConversationBar({
  title,
  canStartNew,
  onHistory,
  onNew,
}: {
  title: string
  canStartNew: boolean
  onHistory: () => void
  onNew: () => void
}) {
  return (
    <div className="flex items-center gap-1 border-b border-line bg-surface px-2 py-1.5">
      <button
        onClick={onHistory}
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] font-medium text-ink-secondary active:bg-sunken"
      >
        <History size={15} /> History
      </button>
      <span className="flex-1 truncate px-1 text-center text-[12px] text-ink-muted">{title}</span>
      <button
        onClick={onNew}
        disabled={!canStartNew}
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] font-medium text-accent active:bg-sunken disabled:opacity-40"
      >
        <SquarePen size={15} /> New
      </button>
    </div>
  )
}

export function ConversationsSheet({
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
          {conversations.map((conversation) => (
            <li key={conversation.id} className="flex items-center gap-2 px-4 py-2.5">
              <button
                onClick={() => onOpen(conversation.id)}
                className="min-w-0 flex-1 text-left active:opacity-70"
              >
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[14px] font-medium">{conversation.title}</span>
                  {conversation.id === activeId && (
                    <span className="shrink-0 rounded-full bg-accent-wash px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                      Current
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[12px] text-ink-muted">
                  {new Date(conversation.updatedAt).toLocaleDateString()}
                </span>
              </button>
              <button
                onClick={() => onDelete(conversation.id)}
                aria-label={`Delete "${conversation.title}"`}
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
