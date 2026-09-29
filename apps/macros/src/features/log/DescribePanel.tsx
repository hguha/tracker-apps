import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@tracker-engine/ui'
import { EstimateReview } from './EstimateReview'
import type { LogTarget } from '@/features/shared/target'
import { ProductReview } from './ProductReview'
import { Working } from './Working'
import { describeMeal, type FoodDraft } from './estimate'
import { useEstimate } from './useEstimate'

/**
 * "Turkey sandwich" instead of four separate lookups.
 *
 * The result is a draft, never a log: every row shows what it matched, and the grams are editable
 * before anything is written.
 *
 * **The model's reading appears before the lookups finish.** See `useEstimate` — the two phases used
 * to be one await behind one spinner, which meant half a minute of a screen that might have hung.
 */
export function DescribePanel({
  target,
  initialText = '',
  onDone,
  onEdit,
}: {
  target: LogTarget
  /** Carried over from the search box, so describing a meal never means retyping it. */
  initialText?: string
  onDone: () => void
  /** "Change the numbers" on a named product: the same draft, in the create-a-food form. */
  onEdit: (product: FoodDraft) => void
}) {
  const [text, setText] = useState(initialText)
  const { estimate, setEstimate, phase, elapsed, error, run } = useEstimate()
  const isBusy = phase === 'reading' || phase === 'matching'
  const ask = (extra = '') => void run(() => describeMeal(text, extra))

  return (
    <div className="flex max-h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <textarea
          rows={2}
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              ask()
            }
          }}
          placeholder="A Costco chicken bake, or 3 steak tacos and a beer"
          className="w-full resize-none rounded-xl bg-sunken px-3 py-2.5 text-[15px] outline-none"
        />

        <Button
          className="w-full"
          disabled={text.trim().length < 3 || isBusy}
          onClick={() => ask()}
        >
          <Sparkles size={16} />
          {isBusy ? 'Working…' : 'Work it out'}
        </Button>

        {isBusy && <Working phase={phase === 'reading' ? 'reading' : 'matching'} elapsed={elapsed} />}

        {error && (
          <p
            role="alert"
            className="rounded-xl px-3.5 py-2.5 text-[13px]"
            style={{
              background: 'color-mix(in srgb, var(--status-critical) 10%, transparent)',
              color: 'var(--status-critical)',
            }}
          >
            {error}
          </p>
        )}

        {estimate?.product ? (
          <ProductReview
            product={estimate.product}
            target={target}
            onDone={onDone}
            onEdit={() => onEdit(estimate.product!)}
            onRefine={(extra) => ask(extra)}
            isRefining={isBusy}
          />
        ) : estimate ? (
          <EstimateReview
            estimate={estimate}
            target={target}
            source="describe"
            onChange={setEstimate}
            onDone={onDone}
            // Re-asks with the correction appended, rather than making the user retype the meal.
            onRefine={(extra) => ask(extra)}
            isRefining={isBusy}
          />
        ) : null}
      </div>
    </div>
  )
}
