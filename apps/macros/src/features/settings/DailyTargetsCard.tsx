import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Minus, Plus } from 'lucide-react'
import { Button, Card, SegmentedTabs } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { macroShareOfTargets, mgToGrams, withCalories, withMacro } from '@/lib/nutrition'
import { NumberInput } from '@/features/shared/NumberInput'
import type { MacroTargets } from '@/domain/types'

type Mode = 'auto' | 'custom'

const MACROS = [
  { key: 'proteinMg', label: 'Protein', color: 'var(--macro-protein)' },
  { key: 'carbsMg', label: 'Carbs', color: 'var(--macro-carbs)' },
  { key: 'fatMg', label: 'Fat', color: 'var(--macro-fat)' },
] as const

const FALLBACK: MacroTargets = { kcal: 2000, proteinMg: 150_000, carbsMg: 200_000, fatMg: 67_000 }

export function DailyTargetsCard() {
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  const measured = useLiveQuery(() => repo.currentTargets(), [], undefined)
  const manual = profile?.manualTargets ?? null
  const [mode, setMode] = useState<Mode>('auto')
  const [draft, setDraft] = useState<MacroTargets | null>(null)

  const hasManual = profile === undefined ? null : manual !== null
  useEffect(() => {
    if (hasManual !== null) setMode(hasManual ? 'custom' : 'auto')
  }, [hasManual])

  if (!profile) return null

  const saved = manual ?? measured ?? null
  const editing = draft ?? manual ?? measured ?? FALLBACK
  const isDirty =
    draft !== null &&
    (manual === null ||
      draft.kcal !== manual.kcal ||
      MACROS.some(({ key }) => draft[key] !== manual[key]))

  const choose = (next: Mode) => {
    setMode(next)
    setDraft(null)
    if (next === 'auto' && manual) void repo.setManualTargets(null)
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">Daily targets</h2>
        <div className="w-40">
          <SegmentedTabs
            tabs={[
              { key: 'auto', label: 'Auto' },
              { key: 'custom', label: 'Custom' },
            ]}
            active={mode}
            onSelect={choose}
          />
        </div>
      </div>

      {mode === 'auto' ? (
        saved ? (
          <>
            <Summary targets={saved} />
            <p className="mt-2 text-[12px] text-ink-muted">Adjusts each week from your weigh-ins.</p>
          </>
        ) : (
          <p className="mt-3 text-[12.5px] text-ink-muted">
            Needs your height, age, sex and a weigh-in.
          </p>
        )
      ) : (
        <div className="mt-3 space-y-2">
          <Row
            label="Calories"
            unit="kcal"
            value={editing.kcal}
            step={50}
            onChange={(kcal) => setDraft(withCalories(editing, kcal))}
          />
          {MACROS.map(({ key, label, color }) => (
            <Row
              key={key}
              label={label}
              unit="g"
              color={color}
              share={macroShareOfTargets(editing)[key]}
              value={Math.round(mgToGrams(editing[key]))}
              step={5}
              onChange={(grams) => setDraft(withMacro(editing, key, grams))}
            />
          ))}
          <SplitBar targets={editing} />
          {(isDirty || manual === null) && (
            <Button
              className="w-full"
              onClick={() => void repo.setManualTargets(editing).then(() => setDraft(null))}
            >
              Save targets
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}

function Summary({ targets }: { targets: MacroTargets }) {
  return (
    <div className="mt-3">
      <p className="tabular text-[26px] font-bold leading-none">
        {targets.kcal}
        <span className="text-[13px] font-medium text-ink-muted"> kcal</span>
      </p>
      <p className="tabular mt-2 flex gap-3 text-[13px]">
        {MACROS.map(({ key, label, color }) => (
          <span key={key} className="flex items-baseline gap-1">
            <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
            <span className="font-semibold">{Math.round(mgToGrams(targets[key]))}g</span>
            <span className="text-ink-muted">{label.toLowerCase()}</span>
          </span>
        ))}
      </p>
      <SplitBar targets={targets} />
    </div>
  )
}

function SplitBar({ targets }: { targets: MacroTargets }) {
  const share = macroShareOfTargets(targets)
  return (
    <div className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-sunken" aria-hidden>
      {MACROS.map(({ key, color }) => (
        <span key={key} style={{ width: `${share[key]}%`, background: color }} />
      ))}
    </div>
  )
}

function Row({
  label,
  unit,
  value,
  step,
  onChange,
  color,
  share,
}: {
  label: string
  unit: string
  value: number
  step: number
  onChange: (value: number) => void
  color?: string
  share?: number
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13.5px]">
        {color && <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />}
        <span className="font-medium">{label}</span>
        {share !== undefined && <span className="tabular text-[12px] text-ink-muted">{share}%</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1 rounded-xl bg-sunken p-0.5">
        <StepButton label={`Less ${label}`} onClick={() => onChange(Math.max(0, value - step))}>
          <Minus size={15} />
        </StepButton>
        <NumberInput
          inputMode="numeric"
          value={value}
          onValue={(next) => onChange(Math.round(next))}
          aria-label={label}
          className="tabular w-14 bg-transparent text-center text-[15px] font-semibold outline-none"
        />
        <span className="w-7 text-[12px] text-ink-muted">{unit}</span>
        <StepButton label={`More ${label}`} onClick={() => onChange(value + step)}>
          <Plus size={15} />
        </StepButton>
      </span>
    </div>
  )
}

function StepButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex size-8 items-center justify-center rounded-lg text-ink-secondary active:bg-surface"
    >
      {children}
    </button>
  )
}
