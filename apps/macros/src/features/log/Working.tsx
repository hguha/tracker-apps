import { Loader2 } from 'lucide-react'

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
