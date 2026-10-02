import { useState } from 'react'
import { PencilLine } from 'lucide-react'
import { Button, useToast } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { per100FromPanel } from '@/lib/nutrition'
import { MacroNumbers } from '@/features/shared/MacroNumbers'
import { describeLoggable } from '@/features/shared/loggable'
import type { LogTarget } from '@/features/shared/target'
import type { FoodDraft } from './estimate'
import { Refine } from './Refine'

export function ProductReview({
  product,
  target,
  onDone,
  onEdit,
  onRefine,
  isRefining = false,
}: {
  product: FoodDraft
  target: LogTarget
  onDone: () => void
  onEdit: () => void
  onRefine: (extra: string) => void
  isRefining?: boolean
}) {
  const toast = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const nutrients = per100FromPanel(product, product.servingGrams)

  async function log() {
    if (isSaving) return
    setIsSaving(true)
    try {
      const id = await repo.saveCustomFood(asFood(product))
      const food = await repo.getFood(id)
      if (!food) return
      const subject = describeLoggable({ kind: 'food', food })
      const unit = subject.units.find((row) => row.id === subject.initialUnitId) ?? subject.units[0]!
      await subject.log(unit, 1, target)
      toast.show(`${product.name} logged, and saved to your foods`)
      onDone()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-sunken px-3.5 py-3">
        <p className="text-[15px] font-semibold tracking-tight">
          {product.brand && <span className="text-ink-secondary">{product.brand} · </span>}
          {product.name}
        </p>
        <p className="tabular mt-1 flex items-baseline gap-2">
          <span className="shrink-0 text-[13.5px] font-semibold">{product.kcal} kcal</span>
          <MacroNumbers nutrients={nutrients} />
        </p>
        <p className="tabular mt-0.5 text-[12px] text-ink-muted">
          for {product.servingLabel} · {product.servingGrams} g
        </p>
        {product.note && (
          <p className="mt-2 border-t border-line pt-2 text-[12.5px] text-ink-secondary">
            {product.note}
          </p>
        )}
      </div>

      <Button className="w-full" disabled={isSaving} onClick={() => void log()}>
        {isSaving ? 'Logging…' : `Log it · ${product.kcal} kcal`}
      </Button>

      <button
        onClick={onEdit}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-sunken py-2.5 text-[13.5px] font-semibold text-accent active:opacity-60"
      >
        <PencilLine size={15} />
        Change the numbers
      </button>

      <Refine onRefine={onRefine} isBusy={isRefining} placeholder="Not that one? e.g. the large size" />
    </div>
  )
}

const asFood = (product: FoodDraft): repo.CustomFoodInput => ({
  description: product.name,
  brand: product.brand,
  barcode: null,
  servingGrams: product.servingGrams,
  servingLabel: product.servingLabel,
  per100: per100FromPanel(product, product.servingGrams),
})
