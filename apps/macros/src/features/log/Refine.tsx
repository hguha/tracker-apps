import { useState } from 'react'
import { Sparkles } from 'lucide-react'

/**
 * Asking again with the missing detail.
 *
 * "Zucchini muffins" coming back as a plain muffin is the model missing a word, and the only recourse
 * was retyping the whole meal and hoping. This appends the correction to the original description —
 * one short box, because the correction is always short.
 */
export function Refine({
  onRefine,
  isBusy,
  placeholder = 'Missed something? e.g. zucchini, not plain',
}: {
  onRefine: (extra: string) => void
  isBusy: boolean
  placeholder?: string
}) {
  const [extra, setExtra] = useState('')

  return (
    <div className="flex items-center gap-2">
      <input
        value={extra}
        onChange={(event) => setExtra(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && extra.trim()) onRefine(extra)
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-xl bg-sunken px-3 py-2 text-[13.5px] outline-none"
      />
      <button
        onClick={() => extra.trim() && onRefine(extra)}
        disabled={isBusy || extra.trim().length === 0}
        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-wash text-accent disabled:opacity-40 active:opacity-60"
        aria-label="Ask again with this detail"
      >
        <Sparkles size={16} />
      </button>
    </div>
  )
}
