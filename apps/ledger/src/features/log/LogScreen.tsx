// Log (or edit) a manual transaction — the finance analogue of REPutation's active
// workout screen, reached from the center tab action. Amount is parsed to integer
// minor units at the edge (parseMoney); expense/income is a sign toggle so the user
// never types a minus.

import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { Button } from '@tracker-engine/ui'
import { parseMoney } from '@tracker-engine/core'
import * as repo from '@/data/repository'
import { CategoryBadge } from '@/components/CategoryBadge'
import { CategoryPickerSheet } from '@/components/CategoryPickerSheet'
import { cn } from '@/lib/cn'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function LogScreen({ entryId, onClose }: { entryId?: string; onClose: () => void }) {
  const isEdit = entryId !== undefined
  const categories = useLiveQuery(() => repo.listCategories(), []) ?? []

  const [flow, setFlow] = useState<'expense' | 'income'>('expense')
  const [amount, setAmount] = useState('')
  const [merchant, setMerchant] = useState('')
  const [date, setDate] = useState(todayIso())
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [picking, setPicking] = useState(false)
  const [loaded, setLoaded] = useState(!isEdit)

  useEffect(() => {
    if (!entryId) return
    void repo.getEntry(entryId).then((e) => {
      if (!e) {
        onClose()
        return
      }
      setFlow(e.amountMinor >= 0 ? 'income' : 'expense')
      setAmount((Math.abs(e.amountMinor) / 100).toString())
      setMerchant(e.merchant)
      setDate(e.date)
      setCategoryId(e.categoryId)
      setNote(e.note)
      setLoaded(true)
    })
  }, [entryId, onClose])

  const parsed = parseMoney(amount)
  const canSave = parsed !== null && parsed.minor > 0 && merchant.trim().length > 0

  async function save() {
    if (!parsed) return
    const signed = flow === 'expense' ? -Math.abs(parsed.minor) : Math.abs(parsed.minor)
    const fields = { amountMinor: signed, merchant, date, categoryId, note }
    if (isEdit && entryId) await repo.updateEntry(entryId, fields)
    else await repo.addEntry(fields)
    onClose()
  }

  async function remove() {
    if (isEdit && entryId) await repo.deleteEntry(entryId)
    onClose()
  }

  if (!loaded) return null

  const selectedCategory = categoryId
    ? categories.find((c) => c.id === categoryId)
    : undefined

  return (
    <div className="flex h-full flex-col bg-page">
      <header className="flex items-center justify-between px-4 pb-2 pt-3">
        <button onClick={onClose} aria-label="Cancel" className="text-ink-secondary">
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-base font-semibold text-ink">{isEdit ? 'Edit' : 'New'} transaction</h1>
        {isEdit ? (
          <button onClick={remove} aria-label="Delete" className="text-critical">
            <Trash2 size={20} />
          </button>
        ) : (
          <span className="w-5" />
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4">
        <div className="mb-4 flex gap-2">
          <FlowToggle label="Expense" active={flow === 'expense'} onClick={() => setFlow('expense')} />
          <FlowToggle label="Income" active={flow === 'income'} onClick={() => setFlow('income')} />
        </div>

        <label className="block text-center">
          <span className="text-xs uppercase tracking-wide text-ink-muted">Amount</span>
          <div className="mt-1 flex items-center justify-center">
            <span className="text-3xl font-bold text-ink-muted">$</span>
            <input
              inputMode="decimal"
              autoFocus={!isEdit}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-40 bg-transparent text-center text-4xl font-bold tabular-nums text-ink outline-none placeholder:text-ink-muted"
            />
          </div>
        </label>

        <div className="mt-6 space-y-3">
          <Field label="Merchant">
            <input
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              placeholder="e.g. Whole Foods"
              className="w-full bg-transparent text-right text-ink outline-none placeholder:text-ink-muted"
            />
          </Field>
          <button
            className="flex w-full items-center justify-between rounded-xl border border-line bg-surface px-4 py-3"
            onClick={() => setPicking(true)}
          >
            <span className="text-sm text-ink-muted">Category</span>
            <CategoryBadge category={selectedCategory} />
          </button>
          <Field label="Date">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-transparent text-right text-ink outline-none"
            />
          </Field>
          <Field label="Note">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
              className="w-full bg-transparent text-right text-ink outline-none placeholder:text-ink-muted"
            />
          </Field>
        </div>
      </div>

      <div className="border-t border-line p-4 pb-safe">
        <Button className="w-full" size="lg" onClick={save} disabled={!canSave}>
          {isEdit ? 'Save changes' : 'Add transaction'}
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

function FlowToggle({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 rounded-xl py-2.5 text-sm font-medium',
        active ? 'bg-accent text-accent-contrast' : 'bg-sunken text-ink-secondary',
      )}
    >
      {label}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
      <span className="shrink-0 text-sm text-ink-muted">{label}</span>
      {children}
    </div>
  )
}
