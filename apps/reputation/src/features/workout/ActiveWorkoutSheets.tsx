import { BottomSheet } from '@/components/BottomSheet'
import { Button } from '@/components/Button'

export function DetachedNotice({
  templateName,
  onDismiss,
}: {
  templateName: string
  onDismiss: () => void
}) {
  return (
    <BottomSheet onDismiss={onDismiss} panelClassName="p-5" labelledBy="detached-title">
      <h2 id="detached-title" className="text-[19px] font-bold tracking-tight">
        No longer following {templateName}
      </h2>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-secondary">
        You've changed which exercises this session has, so it won't count as a run of
        that template. Everything you log still saves normally — and you can save this
        version as its own template from the workout menu when you finish.
      </p>
      <Button size="lg" className="mt-5 w-full" onClick={onDismiss}>
        Got it
      </Button>
    </BottomSheet>
  )
}

export function LeaveEditConfirm({
  onKeepEditing,
  onDiscard,
  onSave,
}: {
  onKeepEditing: () => void
  onDiscard: () => void
  onSave: () => void
}) {
  return (
    <BottomSheet
      onDismiss={onKeepEditing}
      dismissOnBackdrop={false}
      panelClassName="p-5"
      labelledBy="leave-edit-title"
    >
      <h2 id="leave-edit-title" className="text-[19px] font-bold tracking-tight">
        Discard your changes?
      </h2>
      <p className="mt-2 text-[14px] text-ink-secondary">
        Your edits to this workout haven't been saved yet. Leaving now puts it back the
        way it was.
      </p>
      <div className="mt-5 flex gap-2">
        <Button variant="secondary" size="lg" className="flex-1" onClick={onKeepEditing}>
          Keep editing
        </Button>
        <Button variant="danger" size="lg" className="flex-1" onClick={onDiscard}>
          Discard
        </Button>
      </div>
      <button
        onClick={onSave}
        className="mt-2 w-full py-2 text-[13.5px] font-semibold text-accent active:opacity-60"
      >
        Save changes instead
      </button>
    </BottomSheet>
  )
}
