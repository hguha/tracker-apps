// Manage categories and their monthly budgets. Budgets feed the Insights budget bars
// through the canonical metrics, so a cap set here shows up there immediately.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus } from 'lucide-react'
import { Button } from '@tracker-engine/ui'
import { parseMoney } from '@tracker-engine/core'
import { SubScreen } from '@/components/SubScreen'
import * as repo from '@/data/repository'
import { CATEGORY_ICONS, CATEGORY_PALETTE } from '@/domain/categories'
import { cn } from '@/lib/cn'

export function CategoriesScreen({ onBack }: { onBack: () => void }) {
  const categories = useLiveQuery(() => repo.listCategories(), []) ?? []
  const budgets = useLiveQuery(() => repo.listBudgets(), []) ?? []
  const budgetOf = new Map(budgets.map((b) => [b.categoryId, b.limitMinor]))
  const [adding, setAdding] = useState(false)

  return (
    <SubScreen title="Categories & budgets" onBack={onBack}>
      <div className="mx-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {categories.map((c) => (
          <div key={c.id} className="flex items-center gap-3 px-4 py-3">
            <span className="size-8 shrink-0 rounded-full text-center text-lg leading-8" style={{ backgroundColor: c.color }}>
              {c.icon}
            </span>
            <span className="flex-1 truncate text-ink">{c.name}</span>
            {!c.isIncome && (
              <BudgetInput
                initial={budgetOf.get(c.id)}
                onCommit={(minor) => void repo.setBudget(c.id, minor)}
              />
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 px-4">
        {adding ? (
          <AddCategory onDone={() => setAdding(false)} />
        ) : (
          <Button variant="secondary" className="w-full" onClick={() => setAdding(true)}>
            <Plus size={16} className="mr-1" /> New category
          </Button>
        )}
      </div>
    </SubScreen>
  )
}

function BudgetInput({
  initial,
  onCommit,
}: {
  initial: number | undefined
  onCommit: (minor: number) => void
}) {
  const [value, setValue] = useState(initial ? (initial / 100).toString() : '')
  return (
    <div className="flex items-center gap-1 text-sm text-ink-muted">
      <span>$</span>
      <input
        inputMode="decimal"
        value={value}
        placeholder="—"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const parsed = parseMoney(value)
          onCommit(parsed ? parsed.minor : 0)
        }}
        className="w-16 rounded-lg border border-line bg-page px-2 py-1 text-right tabular-nums text-ink outline-none focus:border-accent"
        aria-label="Monthly budget"
      />
      <span className="text-xs">/mo</span>
    </div>
  )
}

function AddCategory({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState(CATEGORY_ICONS[0]!)
  const [color, setColor] = useState(CATEGORY_PALETTE[0]!)

  async function create() {
    if (!name.trim()) return
    await repo.addCategory({ name, icon, color })
    onDone()
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Category name"
        className="mb-3 h-11 w-full rounded-xl border border-line bg-page px-3 text-ink outline-none focus:border-accent"
      />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {CATEGORY_ICONS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => setIcon(emoji)}
            className={cn('size-9 rounded-lg text-lg', icon === emoji ? 'bg-accent-wash ring-2 ring-accent' : 'bg-sunken')}
          >
            {emoji}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {CATEGORY_PALETTE.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            aria-label="color"
            className={cn('size-7 rounded-full', color === c && 'ring-2 ring-ink ring-offset-2 ring-offset-surface')}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={create} disabled={!name.trim()}>
          Add
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
