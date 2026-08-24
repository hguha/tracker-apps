import { ChevronLeft } from 'lucide-react'
import { CoachChat } from './CoachChat'

// The full-screen coach: a header over the shared conversational chat. The chat
// itself (message history, tools, plan/template cards) lives in CoachChat, reused
// by the in-workout coach sheet.
export function CoachScreen({
  onBack,
  onOpenTemplates,
  onSignIn,
}: {
  onBack: () => void
  onOpenTemplates: () => void
  onSignIn: () => void
}) {
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
      </header>

      <div className="min-h-0 flex-1">
        <CoachChat
          variant="screen"
          persist
          onOpenTemplates={onOpenTemplates}
          onSignIn={onSignIn}
        />
      </div>
    </div>
  )
}
