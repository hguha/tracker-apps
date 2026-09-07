import { useLiveQuery } from 'dexie-react-hooks'
import { BadgeTile, Card } from '@tracker-engine/ui'
import { ChevronRight } from 'lucide-react'
import { nutritionStats } from '@/data/stats'
import { evaluateBadges, homeBadges } from './catalog'

/** A row of what's earned and what's close, on the screen people actually open. */
export function BadgeStrip({ onOpen }: { onOpen: () => void }) {
  const stats = useLiveQuery(() => nutritionStats(), [], undefined)
  if (!stats) return null

  const inPlay = homeBadges(evaluateBadges(stats)).slice(0, 8)
  if (inPlay.length === 0) return null

  return (
    <Card className="p-0">
      <button
        onClick={onOpen}
        className="flex w-full items-baseline gap-2 px-4 pb-1 pt-3 text-left"
      >
        <h2 className="flex-1 text-[15px] font-semibold tracking-tight">Badges</h2>
        <ChevronRight size={16} className="text-ink-muted" />
      </button>
      <div className="flex gap-4 overflow-x-auto px-4 pb-3 pt-1">
        {inPlay.map((badge) => (
          <div key={badge.key} className="w-[70px] shrink-0">
            <BadgeTile badge={badge} showProgress={false} onClick={onOpen} />
          </div>
        ))}
      </div>
    </Card>
  )
}
