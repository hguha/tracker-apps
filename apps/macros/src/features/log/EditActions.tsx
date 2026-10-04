import { Button } from '@tracker-engine/ui'
import { Copy, Trash2 } from 'lucide-react'

export function EditActions({
  kcal,
  canSave,
  isBusy,
  copyLabel,
  onSave,
  onCopy,
  onDelete,
}: {
  kcal: number
  canSave: boolean
  isBusy: boolean
  copyLabel: string
  onSave: () => void
  onCopy: () => void
  onDelete: () => void
}) {
  return (
    <>
      <Button className="w-full" disabled={!canSave || isBusy} onClick={onSave}>
        {`Save · ${kcal} kcal`}
      </Button>
      <div className="flex gap-2">
        <button
          onClick={onCopy}
          disabled={!canSave || isBusy}
          className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-sunken py-2.5 text-[13.5px] font-semibold text-accent disabled:opacity-40 active:opacity-60"
        >
          <Copy size={15} />
          {copyLabel}
        </button>
        <button
          onClick={onDelete}
          disabled={isBusy}
          className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-sunken py-2.5 text-[13.5px] font-semibold disabled:opacity-40 active:opacity-60"
          style={{ color: 'var(--status-critical)' }}
        >
          <Trash2 size={15} />
          Delete
        </button>
      </div>
    </>
  )
}
