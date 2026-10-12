import { ScreenHeader } from '@tracker-engine/ui'
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
      <ScreenHeader title="Coach" onBack={onBack} />

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
