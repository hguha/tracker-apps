import { useEffect, useState } from 'react'
import { plural } from '@tracker-engine/core'
import { ScreenHeader } from '@tracker-engine/ui'
import { FileText, MoreHorizontal, Sparkles } from 'lucide-react'
import { formatDuration } from '@/lib/units'

export function ActiveWorkoutHeader({
  title,
  templateName,
  startedAt,
  loggedSetCount,
  isEditMode,
  onBack,
  onOpenCoach,
  onOpenMenu,
}: {
  title: string
  templateName: string | null
  startedAt: number
  loggedSetCount: number
  isEditMode: boolean
  onBack: () => void
  onOpenCoach: () => void
  onOpenMenu: () => void
}) {
  return (
    <ScreenHeader
      onBack={onBack}
      title={
        <>
          <h1 className="truncate text-[16px] font-semibold tracking-tight">{title}</h1>
          <p className="flex items-center gap-1.5 text-[12px] text-ink-muted">
            {templateName && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent-wash px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-accent">
                <FileText size={10} />
                {templateName}
              </span>
            )}
            <span className="truncate">
              {isEditMode ? (
                `${plural(loggedSetCount, 'set')} · editing`
              ) : (
                <>
                  <ElapsedLabel startedAt={startedAt} /> · {plural(loggedSetCount, 'set')}
                </>
              )}
            </span>
          </p>
        </>
      }
      action={
        <>
          {!isEditMode && (
            <button
              onClick={onOpenCoach}
              aria-label="Ask the coach"
              className="flex size-10 shrink-0 items-center justify-center rounded-lg text-accent active:bg-sunken"
            >
              <Sparkles size={19} />
            </button>
          )}
          <button
            onClick={onOpenMenu}
            aria-label="Workout options"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken"
          >
            <MoreHorizontal size={20} />
          </button>
        </>
      }
    />
  )
}

function ElapsedLabel({ startedAt }: { startedAt: number }) {
  const [label, setLabel] = useState('')
  useEffect(() => {
    const tick = () => setLabel(formatDuration((Date.now() - startedAt) / 1000))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt])
  return <>{label}</>
}
