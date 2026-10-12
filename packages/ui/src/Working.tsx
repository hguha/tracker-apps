import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { SECOND_MS } from '@tracker-engine/core'

const PATIENCE_SECONDS = 8

export function Working({
  label,
  startedAt,
  slowNote,
}: {
  label: string
  startedAt: number
  slowNote: string
}) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), SECOND_MS)
    return () => window.clearInterval(id)
  }, [])
  const elapsed = Math.max(0, Math.round((now - startedAt) / SECOND_MS))

  return (
    <div className="rounded-xl bg-sunken px-3.5 py-2.5">
      <p className="flex items-center gap-2 text-[13px]">
        <Loader2 size={14} className="shrink-0 animate-spin text-accent" />
        <span className="min-w-0 flex-1">{label}</span>
        <span className="tabular shrink-0 text-ink-muted">{elapsed}s</span>
      </p>
      {elapsed >= PATIENCE_SECONDS && (
        <p className="mt-1 text-[12px] text-ink-secondary">{slowNote}</p>
      )}
    </div>
  )
}
