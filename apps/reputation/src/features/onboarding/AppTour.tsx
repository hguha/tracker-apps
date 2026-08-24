// A quick, skippable tour of the core flow. Shown once right after onboarding and
// re-openable from Settings. Deliberately tiny: four beats, one line each.

import { useState } from 'react'
import { ArrowRight, Dumbbell, Repeat2, Layers, LineChart } from 'lucide-react'
import { BottomSheet } from '@/components/BottomSheet'
import { Button } from '@/components/Button'
import { cn } from '@/lib/cn'

const SLIDES = [
  {
    icon: <Dumbbell size={26} />,
    title: 'Log a workout',
    body: 'Tap the + tab to start, add exercises, then type weight × reps in a set — that logs it. No save button.',
  },
  {
    icon: <Repeat2 size={26} />,
    title: 'Reuse last time',
    body: "Faded numbers are last session's. Swipe a set right to reuse them, or left to delete it.",
  },
  {
    icon: <Layers size={26} />,
    title: 'Reorder & superset',
    body: 'Hold and drag an exercise card to reorder it, or drop it onto another to superset them. A rest timer runs between sets.',
  },
  {
    icon: <LineChart size={26} />,
    title: 'See your progress',
    body: 'Insights charts your strength and volume over time, and the Coach reviews your balance and can draft a plan.',
  },
]

export function AppTour({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0)
  const slide = SLIDES[index]!
  const isLast = index === SLIDES.length - 1

  return (
    <BottomSheet onDismiss={onClose} panelClassName="px-5 pb-8" labelledBy="tour-title">
      <div className="flex items-center justify-between pt-4">
        <div className="flex gap-1.5" aria-hidden>
          {SLIDES.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === index ? 'w-5 bg-accent' : 'w-1.5 bg-line-strong',
              )}
            />
          ))}
        </div>
        <button
          onClick={onClose}
          className="text-[13px] font-semibold text-ink-muted active:opacity-60"
        >
          Skip
        </button>
      </div>

      <div className="flex flex-col items-center pt-6 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-accent-wash text-accent">
          {slide.icon}
        </div>
        <h2 id="tour-title" className="mt-4 text-[20px] font-bold tracking-tight">
          {slide.title}
        </h2>
        <p className="mt-2 max-w-xs text-[14.5px] leading-relaxed text-ink-secondary">
          {slide.body}
        </p>
      </div>

      <Button
        size="lg"
        className="mt-7 w-full"
        onClick={() => (isLast ? onClose() : setIndex((i) => i + 1))}
      >
        {isLast ? 'Start logging' : 'Next'}
        {!isLast && <ArrowRight size={17} />}
      </Button>
    </BottomSheet>
  )
}
