import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { ScreenHeader } from '@tracker-engine/ui'
import { cn } from '@/lib/cn'
import { CoachChat } from './CoachChat'
import { CoachNotesCard } from './CoachNotesCard'

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
  const [isEditingNotes, setIsEditingNotes] = useState(false)

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title="Coach"
        onBack={onBack}
        action={
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
        }
      />

      {isEditingNotes && (
        <div className="border-b border-line bg-page px-3 py-3">
          <CoachNotesCard />
        </div>
      )}

      <div className="min-h-0 flex-1">
        <CoachChat
          variant="screen"
          onOpenTemplates={onOpenTemplates}
          onSignIn={onSignIn}
        />
      </div>
    </div>
  )
}
