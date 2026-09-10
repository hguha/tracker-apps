import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey, formatVolume } from '@tracker-engine/core'
import { Card } from '@tracker-engine/ui'
import { Minus, Plus } from 'lucide-react'
import { haptic } from '@tracker-engine/platform'
import * as repo from '@/data/repository'
import { useUnits } from '@/features/shared/useUnits'
import { WATER_STEPS } from '@/domain/types'

/**
 * Water, as a glass that fills.
 *
 * It was the most conspicuous gap in the app: water is the second-most-logged thing in every tracker
 * and there was nowhere to put it, on a home screen that had room for a badge strip. It is stored in
 * its own table rather than as a `LogEntry` — see `WaterRow` for why a zero-calorie non-food would
 * otherwise have to be excluded from every aggregate over the diary, one of which would forget.
 *
 * The glass is not decoration. A number alone gives no sense of how much of the day is left to drink,
 * and the fill is the one part of this screen where a picture beats a figure — so the figure is there
 * too, and the fill animates because watching it move is the reason anyone taps the button twice.
 */
export function WaterCard() {
  const units = useUnits()
  const today = dayKey(Date.now())
  const row = useLiveQuery(() => repo.waterForDay(today), [today], undefined)
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)

  const ml = row?.ml ?? 0
  const targetMl = profile?.waterTargetMl ?? null
  // Three sizes, not one. A single "+ glass" made a litre bottle four taps of a number that was never
  // what the user drank; the values are round in their own system rather than converted.
  const steps = units.volume === 'floz' ? WATER_STEPS.imperial : WATER_STEPS.metric
  const smallest = steps[0]!.ml
  // Without a target the glass fills against a two-litre day, which is a scale rather than a goal:
  // an empty-looking glass at 1.8 L would be a lie, and a full one at 200 ml would be worse.
  const scaleMl = targetMl ?? 2000
  const fraction = Math.min(1, ml / Math.max(1, scaleMl))

  const add = (delta: number) => {
    void repo.addWater(today, delta)
    haptic(8)
  }

  return (
    <Card className="flex items-start gap-3 p-4">
      <Glass fraction={fraction} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="tabular text-[20px] font-bold leading-none">
            {formatVolume(ml, units.volume)}
          </span>
          {targetMl !== null && (
            <span className="tabular text-[12px] text-ink-muted">
              of {formatVolume(targetMl, units.volume)}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[12px] text-ink-muted">
          {ml === 0
            ? 'Water — tap an amount to start.'
            : targetMl === null
              ? `${formatVolume(ml, units.volume)} so far today`
              : ml >= targetMl
                ? 'Target reached.'
                : `${formatVolume(targetMl - ml, units.volume)} to go.`}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {steps.map((option) => (
            <button
              key={option.ml}
              onClick={() => add(option.ml)}
              aria-label={`Add ${option.label} of water`}
              className="flex h-8 items-center gap-0.5 rounded-lg bg-accent px-2.5 text-[12.5px] font-semibold text-accent-contrast active:brightness-90"
            >
              <Plus size={13} />
              {option.label}
            </button>
          ))}
          <button
            onClick={() => add(-smallest)}
            disabled={ml === 0}
            aria-label={`Remove ${steps[0]!.label} of water`}
            className="flex size-8 items-center justify-center rounded-lg bg-sunken text-ink-secondary disabled:opacity-30 active:opacity-60"
          >
            <Minus size={15} />
          </button>
        </div>
      </div>
    </Card>
  )
}

/**
 * A glass with a water line, drawn rather than imaged so it takes the theme's colours.
 *
 * The fill is a rectangle inside a clip path, so the water follows the tapered shape instead of
 * being a straight bar over a picture, and the surface is a wave that shifts as the level moves.
 * `transition` is on the transform rather than the height because animating a height inside an SVG
 * clip repaints the whole shape on every frame.
 */
function Glass({ fraction }: { fraction: number }) {
  // 0 at the brim, 1 at the base, in the 0–48 drawing space.
  const y = 6 + (1 - fraction) * 42

  return (
    <svg
      width="40"
      height="54"
      viewBox="0 0 36 54"
      aria-hidden
      className="shrink-0 overflow-visible"
    >
      <defs>
        <clipPath id="water-glass">
          {/* A tumbler: slightly narrower at the base, rounded bottom corners. */}
          <path d="M5 5 H31 L28 48 Q28 51 25 51 H11 Q8 51 8 48 Z" />
        </clipPath>
      </defs>

      <g clipPath="url(#water-glass)">
        <rect x="0" y="0" width="36" height="54" fill="var(--surface-sunken)" />
        <g
          style={{
            transform: `translateY(${y}px)`,
            transition: 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          {/* The wave sits above the block, so the two move as one surface. */}
          <path
            d="M-4 4 Q5 0 14 4 T32 4 T50 4 V54 H-4 Z"
            fill="var(--macro-carbs)"
            opacity="0.55"
          />
        </g>
      </g>

      <path
        d="M5 5 H31 L28 48 Q28 51 25 51 H11 Q8 51 8 48 Z"
        fill="none"
        stroke="var(--border-strong)"
        strokeWidth="1.5"
      />
    </svg>
  )
}
