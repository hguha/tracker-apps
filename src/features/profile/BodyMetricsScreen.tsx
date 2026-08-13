// Body measurements (§5.2 /body). Storage is canonical (kg, cm); conversion to
// the user's units happens only here (§4.12).

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, ChevronLeft } from 'lucide-react'
import { db } from '@/db/database'
import * as repo from '@/data/repository'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { useToast } from '@/components/Toast'
import { formatRelativeDay } from '@/lib/dates'
import { bodyWeightFromKg, lengthFromCm, lengthToCm, weightToKg } from '@/lib/units'

const QUICK_METRIC_KEYS = ['bodyweight', 'body_fat_pct', 'waist', 'resting_hr']

export function BodyMetricsScreen({ onBack }: { onBack: () => void }) {
  const toast = useToast()
  const [draftValues, setDraftValues] = useState<Record<string, string>>({})

  const data = useLiveQuery(async () => {
    const profile = await repo.getProfile()
    const definitions = await db.metricDefinitions.toArray()

    const quick = await Promise.all(
      QUICK_METRIC_KEYS.map(async (key) => {
        const definition = definitions.find((d) => d.key === key)
        if (!definition) return null
        const entries = await repo.listMetricEntries(definition.id, 5)
        return { definition, latest: entries[0], entries }
      }),
    )

    return {
      profile,
      quick: quick.filter((q): q is NonNullable<typeof q> => q !== null),
    }
  }, [])

  if (!data) return <div className="p-6 text-ink-muted">Loading…</div>
  const { profile, quick } = data

  function toCanonical(unitType: string, raw: number): number {
    if (unitType === 'mass') return weightToKg(raw, profile.unitWeight)
    if (unitType === 'length') return lengthToCm(raw, profile.unitLength)
    return raw
  }

  function toDisplay(unitType: string, value: number): number {
    if (unitType === 'mass') return bodyWeightFromKg(value, profile.unitWeight)
    if (unitType === 'length') return lengthFromCm(value, profile.unitLength)
    return value
  }

  function unitSuffix(unitType: string): string {
    if (unitType === 'mass') return profile.unitWeight
    if (unitType === 'length') return profile.unitLength
    if (unitType === 'percent') return '%'
    return ''
  }

  async function saveMetric(definitionId: string, unitType: string) {
    const raw = draftValues[definitionId]
    if (!raw || raw.trim() === '') return
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.show('Enter a positive number')
      return
    }

    await repo.addMetricEntry({
      definitionId,
      value: toCanonical(unitType, parsed),
    })
    setDraftValues((current) => ({ ...current, [definitionId]: '' }))
    toast.show('Logged')
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-1 border-b border-line bg-surface px-2 py-2 pt-safe">
        <button
          onClick={onBack}
          aria-label="Back"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken"
        >
          <ChevronLeft size={22} />
        </button>
        <h1 className="flex-1 text-[16px] font-semibold tracking-tight">Body</h1>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <Card className="p-4">
          <h2 className="text-[15px] font-semibold tracking-tight">Measurements</h2>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            Each entry is kept with its date, so the trend charts have something to plot.
          </p>
          <div className="mt-3 space-y-3">
            {quick.map(({ definition, latest }) => (
              <div key={definition.id}>
                <div className="flex items-baseline justify-between">
                  <label className="text-[13.5px] font-medium">{definition.label}</label>
                  {latest && (
                    <span className="text-[12px] text-ink-muted">
                      {toDisplay(definition.unitType, latest.value)}
                      {unitSuffix(definition.unitType)} ·{' '}
                      {formatRelativeDay(latest.measuredAt)}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex gap-2">
                  <input
                    value={draftValues[definition.id] ?? ''}
                    onChange={(event) =>
                      setDraftValues((current) => ({
                        ...current,
                        [definition.id]: event.target.value,
                      }))
                    }
                    inputMode="decimal"
                    placeholder="Log a new value"
                    className="tabular h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
                  />
                  <span className="self-center text-[13px] text-ink-muted">
                    {unitSuffix(definition.unitType) || '—'}
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() => void saveMetric(definition.id, definition.unitType)}
                    disabled={!draftValues[definition.id]?.trim()}
                    aria-label={`Log ${definition.label}`}
                  >
                    <Check size={17} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="h-4" />
      </div>
    </div>
  )
}
