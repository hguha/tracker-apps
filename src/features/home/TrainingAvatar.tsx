import type { Region } from '@/domain/types'
import { regionVar } from '@/lib/palette'
import type { RegionFitness } from './avatar'

interface Slot {
  cx: number
  cy: number
  maxHalfW: number
  h: number
  paired: boolean
  minHalfW: number
  rx: number
}

// Front-facing figure in a 100×140 viewBox; values tuned by eye.
const SLOTS: Record<Exclude<Region, 'cardio'>, Slot> = {
  shoulders: { cx: 50, cy: 34, maxHalfW: 26, minHalfW: 12, h: 12, rx: 6, paired: false },
  chest: { cx: 50, cy: 48, maxHalfW: 20, minHalfW: 10, h: 14, rx: 5, paired: false },
  back: { cx: 50, cy: 48, maxHalfW: 23, minHalfW: 11, h: 14, rx: 6, paired: false },
  biceps: { cx: 26, cy: 52, maxHalfW: 7, minHalfW: 3, h: 22, rx: 4, paired: true },
  triceps: { cx: 26, cy: 52, maxHalfW: 8, minHalfW: 3, h: 22, rx: 4, paired: true },
  core: { cx: 50, cy: 66, maxHalfW: 16, minHalfW: 9, h: 16, rx: 4, paired: false },
  legs: { cx: 38, cy: 100, maxHalfW: 11, minHalfW: 6, h: 40, rx: 6, paired: true },
}

const LEVEL_OPACITY = [0.16, 0.4, 0.68, 1]

export function TrainingAvatar({
  fitnesses,
  size = 150,
}: {
  fitnesses: RegionFitness[]
  size?: number
}) {
  const byRegion = new Map(fitnesses.map((f) => [f.region, f]))
  const cardio = byRegion.get('cardio')
  const auraOpacity = 0.12 + (cardio?.fitness ?? 0) * 0.4

  return (
    <svg
      viewBox="0 0 100 140"
      width={size}
      height={size * 1.4}
      role="img"
      aria-label="Your training avatar"
    >
      <ellipse
        cx={50}
        cy={70}
        rx={46}
        ry={64}
        fill={regionVar('cardio')}
        opacity={auraOpacity}
      />

      <circle cx={50} cy={16} r={9} fill="var(--text-muted)" opacity={0.5} />

      {/* Back first so chest layers over it. */}
      {(['back', 'shoulders', 'chest', 'core', 'biceps', 'triceps', 'legs'] as const).map(
        (region) => {
          const f = byRegion.get(region)
          if (!f) return null
          return <RegionShape key={region} region={region} fitness={f} />
        },
      )}
    </svg>
  )
}

function RegionShape({
  region,
  fitness,
}: {
  region: Exclude<Region, 'cardio'>
  fitness: RegionFitness
}) {
  const slot = SLOTS[region]
  const halfW = slot.minHalfW + (slot.maxHalfW - slot.minHalfW) * fitness.fitness
  const fill = regionVar(region)
  const opacity = LEVEL_OPACITY[fitness.level]

  const block = (cx: number) => (
    <rect
      key={cx}
      x={cx - halfW}
      y={slot.cy - slot.h / 2}
      width={halfW * 2}
      height={slot.h}
      rx={slot.rx}
      fill={fill}
      opacity={opacity}
      className="transition-all duration-500 ease-out"
    />
  )

  if (!slot.paired) return block(slot.cx)
  return (
    <>
      {block(slot.cx)}
      {block(100 - slot.cx)}
    </>
  )
}
