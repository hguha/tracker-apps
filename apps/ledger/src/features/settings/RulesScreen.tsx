// Auto-categorization rules: "categorize merchants matching X as category Y". Rules
// run after every sync and when edited (repo.applyRules), so they retroactively clean
// up existing transactions too.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Sparkles, Trash2 } from 'lucide-react'
import { Button, useToast } from '@tracker-engine/ui'
import { SubScreen } from '@/components/SubScreen'
import { CategoryBadge } from '@/components/CategoryBadge'
import { CategoryPickerSheet } from '@/components/CategoryPickerSheet'
import { EmptyState } from '@/components/EmptyState'
import * as repo from '@/data/repository'
import { autoCategorize } from './aiCategorize'
import { cn } from '@/lib/cn'

export function RulesScreen({ onBack }: { onBack: () => void }) {
  const rules = useLiveQuery(() => repo.listRules(), []) ?? []
  const categories = useLiveQuery(() => repo.listCategories(), []) ?? []
  const catMap = new Map(categories.map((c) => [c.id, c]))
  const [adding, setAdding] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const toast = useToast()

  async function runAi() {
    setAiBusy(true)
    try {
      const { created, considered } = await autoCategorize()
      toast.show(
        considered === 0
          ? 'Nothing left to categorize'
          : `AI created ${created} rule${created === 1 ? '' : 's'} from ${considered} merchants`,
      )
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'AI categorization failed')
    } finally {
      setAiBusy(false)
    }
  }

  return (
    <SubScreen title="Rules" onBack={onBack}>
      <p className="px-4 pb-3 text-sm text-ink-muted">
        Automatically categorize transactions by merchant. Rules apply to new activity
        and clean up existing transactions.
      </p>

      <div className="px-4 pb-3">
        <Button variant="secondary" className="w-full" onClick={runAi} disabled={aiBusy}>
          <Sparkles size={16} className="mr-1" /> {aiBusy ? 'Categorizing…' : 'Auto-categorize with AI'}
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="px-4">
          <EmptyState title="No rules yet" hint="Add one to auto-categorize by merchant." />
        </div>
      ) : (
        <div className="mx-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">
                  <span className="text-ink-muted">{r.matchType === 'equals' ? 'is' : 'contains'}</span>{' '}
                  <b>{r.merchantMatch}</b>
                </div>
                <div className="mt-0.5">
                  <CategoryBadge category={catMap.get(r.categoryId)} />
                </div>
              </div>
              <button
                onClick={() => void repo.updateRule(r.id, { enabled: !r.enabled })}
                className={cn(
                  'rounded-full px-2 py-1 text-xs',
                  r.enabled ? 'bg-accent-wash text-accent' : 'bg-sunken text-ink-muted',
                )}
              >
                {r.enabled ? 'on' : 'off'}
              </button>
              <button onClick={() => void repo.deleteRule(r.id)} aria-label="Delete rule" className="text-critical">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 px-4">
        {adding ? (
          <AddRule categories={categories} onDone={() => setAdding(false)} />
        ) : (
          <Button variant="secondary" className="w-full" onClick={() => setAdding(true)}>
            <Plus size={16} className="mr-1" /> New rule
          </Button>
        )}
      </div>
    </SubScreen>
  )
}

function AddRule({
  categories,
  onDone,
}: {
  categories: import('@/domain/types').Category[]
  onDone: () => void
}) {
  const [merchant, setMerchant] = useState('')
  const [matchType, setMatchType] = useState<'contains' | 'equals'>('contains')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  async function create() {
    if (!merchant.trim() || !categoryId) return
    await repo.addRule({ merchantMatch: merchant, matchType, categoryId })
    onDone()
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <input
        autoFocus
        value={merchant}
        onChange={(e) => setMerchant(e.target.value)}
        placeholder="Merchant text, e.g. Starbucks"
        className="mb-3 h-11 w-full rounded-xl border border-line bg-page px-3 text-ink outline-none focus:border-accent"
      />
      <div className="mb-3 flex gap-2">
        {(['contains', 'equals'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setMatchType(t)}
            className={cn(
              'flex-1 rounded-xl py-2 text-sm',
              matchType === t ? 'bg-accent text-accent-contrast' : 'bg-sunken text-ink-secondary',
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <button
        className="mb-4 flex w-full items-center justify-between rounded-xl border border-line bg-page px-4 py-3"
        onClick={() => setPicking(true)}
      >
        <span className="text-sm text-ink-muted">Category</span>
        <CategoryBadge category={categoryId ? categories.find((c) => c.id === categoryId) : undefined} />
      </button>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={create} disabled={!merchant.trim() || !categoryId}>
          Add rule
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>

      {picking && (
        <CategoryPickerSheet
          categories={categories}
          currentId={categoryId}
          onPick={(id) => {
            setCategoryId(id)
            setPicking(false)
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  )
}
