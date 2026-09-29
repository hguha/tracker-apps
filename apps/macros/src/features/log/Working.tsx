import { Loader2 } from 'lucide-react'

/**
 * What the AI is doing, and for how long.
 *
 * The two stages were only ever a button label, which said the same thing at 2 seconds and at 40 —
 * and the model is 2s when warm and 12s when its faster siblings have spent the day's allowance. With
 * nothing counting, a slow request and a hung one look identical, so people wait for minutes or give
 * up on a request that was about to land. The seconds are the whole point; the reassurance below only
 * appears once the wait is long enough to need it.
 */
const PATIENCE_SECONDS = 8

export function Working({ phase, elapsed }: { phase: 'reading' | 'matching'; elapsed: number }) {
  return (
    <div className="rounded-xl bg-sunken px-3.5 py-2.5">
      <p className="flex items-center gap-2 text-[13px]">
        <Loader2 size={14} className="shrink-0 animate-spin text-accent" />
        <span className="min-w-0 flex-1">
          {phase === 'reading' ? 'Reading what you wrote' : 'Finding the foods'}
        </span>
        <span className="tabular shrink-0 text-ink-muted">{elapsed}s</span>
      </p>
      {elapsed >= PATIENCE_SECONDS && (
        <p className="mt-1 text-[12px] text-ink-secondary">
          Still going — the AI is slower when it is busy. Nothing is logged until you confirm.
        </p>
      )}
    </div>
  )
}
