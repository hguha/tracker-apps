import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@tracker-engine/ui'
import { EstimateReview } from './EstimateReview'
import type { LogTarget } from './target'
import { estimateMeal, type MealEstimate } from './estimate'

/**
 * "Turkey sandwich" instead of four separate lookups.
 *
 * The result is a draft, never a log: every row shows what it matched and how confident the
 * breakdown was, and the grams are editable before anything is written.
 */
export function DescribePanel({
  target,
  initialText = '',
  onDone,
}: {
  target: LogTarget
  /** Carried over from the search box, so describing a meal never means retyping it. */
  initialText?: string
  onDone: () => void
}) {
  const [text, setText] = useState(initialText)
  const [estimate, setEstimate] = useState<MealEstimate | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (text.trim().length < 3) return
    setIsBusy(true)
    setError(null)
    try {
      setEstimate(await estimateMeal(text))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not work that out.')
    } finally {
      setIsBusy(false)
    }
  }

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
              void run()
            }
          }}
          placeholder="Turkey sandwich and an apple"
          className="w-full resize-none rounded-xl bg-sunken px-3 py-2.5 text-[15px] outline-none"
        />

        <Button
          className="w-full"
          disabled={text.trim().length < 3 || isBusy}
          onClick={() => void run()}
        >
          <Sparkles size={16} />
          {isBusy ? 'Working it out…' : 'Break it down'}
        </Button>

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

        {estimate && (
          <EstimateReview
            estimate={estimate}
            target={target}
            source="describe"
            onChange={setEstimate}
            onDone={onDone}
          />
        )}
      </div>
    </div>
  )
}
