import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey } from '@tracker-engine/core'
import { ScreenHeader, useToast } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { sum } from '@/lib/nutrition'
import { mealForHour } from '@/lib/meals'
import { entryName } from '@/features/shared/entryName'
import {
  amountFields,
  describeLoggable,
  startingAmount,
  type Loggable,
} from '@/features/shared/loggable'
import type { BorrowedPortions } from '@/data/repository'
import type { Food, LogEntry, MealSlot } from '@/domain/types'
import { AddPanel } from './AddPanel'
import { QuickAddPanel } from './QuickAddPanel'
import { WhenLine } from './WhenLine'

export type EditSubject = { kind: 'entry'; id: string } | { kind: 'dish'; dishId: string }

interface Loaded {
  rows: LogEntry[]
  foods: Map<string, Food>
  borrowed: BorrowedPortions | null
}

export function EditEntryScreen({
  subject,
  onClose,
}: {
  subject: EditSubject
  onClose: () => void
}) {
  const [part, setPart] = useState<string | null>(null)
  const loaded = useLiveQuery(async (): Promise<Loaded> => {
    const rows =
      subject.kind === 'entry'
        ? [await repo.getEntry(subject.id)].filter((row): row is LogEntry => row !== null)
        : await repo.dishEntries(subject.dishId)
    const foods = await repo.foodsByIds(
      rows.map((row) => row.foodId).filter((id): id is string => id !== null),
    )
    const only = rows.length === 1 ? rows[0]! : null
    const food = only?.foodId ? foods.get(only.foodId) : undefined
    return { rows, foods, borrowed: food ? await repo.borrowedPortions(food) : null }
  }, [subject.kind === 'entry' ? subject.id : subject.dishId])

  if (part !== null) {
    return (
      <EditEntryScreen
        subject={{ kind: 'entry', id: part }}
        onClose={() => setPart(null)}
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Edit" onBack={onClose} />
      <div className="flex-1 overflow-y-auto pb-8">
        {loaded && loaded.rows.length > 0 && (
          <Editor
            key={loaded.rows.map((row) => row.id).join(',')}
            loaded={loaded}
            isDish={subject.kind === 'dish'}
            onClose={onClose}
            onOpenPart={(id) => setPart(id)}
          />
        )}
      </div>
    </div>
  )
}

function Editor({
  loaded,
  isDish,
  onClose,
  onOpenPart,
}: {
  loaded: Loaded
  isDish: boolean
  onClose: () => void
  onOpenPart: (id: string) => void
}) {
  const toast = useToast()
  const { rows, foods, borrowed } = loaded
  const first = rows[0]!
  const [meal, setMeal] = useState<MealSlot>(first.meal)
  const [at, setAt] = useState(first.eatenAt)
  const isPart = !isDish && first.dishId !== null
  const copyLabel = first.day === dayKey(Date.now()) ? 'Log again' : 'Log again today'
  const now = () => {
    const at_ = Date.now()
    return { at: at_, meal: mealForHour(new Date(at_).getHours()), venue: first.venue }
  }
  const finish = (message: string) => {
    toast.show(message)
    onClose()
  }
  const remove = async () => {
    for (const row of rows) await repo.deleteEntry(row.id)
    finish('Deleted')
  }
  const copied = first.day === dayKey(Date.now()) ? 'Logged again' : 'Added to today'

  const when = isPart ? null : <WhenLine meal={meal} at={at} onMeal={setMeal} onAt={setAt} />

  if (rows.length === 1 && first.quickAdd !== null) {
    return (
      <div className="space-y-3 pt-3">
        <div className="px-3">{when}</div>
        <QuickAddPanel
          target={{ meal, at, venue: first.venue }}
          onDone={onClose}
          edit={{
            label: first.note || 'Calories only',
            nutrients: first.quickAdd,
            copyLabel,
            onSave: async (label, nutrients) => {
              await repo.updateQuickAdd(first.id, nutrients, label)
              await repo.editEntries([first.id], { multiple: 1, meal, shiftMs: at - first.eatenAt })
              finish('Saved')
            },
            onCopy: async (label, nutrients) => {
              const target = now()
              await repo.logQuickAdd(nutrients, target.meal, label, target.at, target.venue)
              finish(copied)
            },
            onDelete: remove,
          }}
        />
      </div>
    )
  }

  const food = rows.length === 1 && first.foodId ? foods.get(first.foodId) : undefined

  if (food) {
    const loggable: Loggable = { kind: 'food', food }
    const units = describeLoggable(loggable, borrowed).units
    return (
      <div className="space-y-3 pt-3">
        {when && <div className="px-3">{when}</div>}
        <AddPanel
          loggable={loggable}
          target={{ meal, at, venue: first.venue }}
          onDone={onClose}
          edit={{
            start: startingAmount(units, first),
            excludeIds: [first.id],
            copyLabel,
            onSave: async (unit, count) => {
              await repo.updateFoodEntry(first.id, {
                amount: amountFields(food, unit, count),
                meal: isPart ? first.meal : meal,
                eatenAt: isPart ? first.eatenAt : at,
              })
              finish('Saved')
            },
            onCopy: async (unit, count) => {
              await describeLoggable(loggable, borrowed).log(unit, count, now())
              finish(copied)
            },
            onDelete: remove,
          }}
        />
      </div>
    )
  }

  const loggable: Loggable = {
    kind: 'dish',
    dish: {
      kind: 'dish',
      dishId: first.dishId ?? first.id,
      name: first.dishName ?? entryName(first, foods),
      lastAt: first.eatenAt,
      times: 1,
      nutrients: sum(rows.map((row) => row.nutrients)),
      parts: rows.map((row) => entryName(row, foods)),
    },
  }

  return (
    <div className="space-y-3 pt-3">
      {when && <div className="px-3">{when}</div>}
      <AddPanel
        loggable={loggable}
        target={{ meal, at, venue: first.venue }}
        onDone={onClose}
        onOpenPart={
          first.dishId === null
            ? undefined
            : (index) => {
                const row = rows[index]
                if (row) onOpenPart(row.id)
              }
        }
        edit={{
          start: { unitId: 'copy', amount: 1 },
          excludeIds: rows.map((row) => row.id),
          copyLabel,
          onSave: async (_unit, count) => {
            await repo.editEntries(
              rows.map((row) => row.id),
              { multiple: count, meal, shiftMs: at - first.eatenAt },
            )
            finish('Saved')
          },
          onCopy: async (_unit, count) => {
            const target = now()
            await repo.relogEntries(rows, { at: target.at, meal: target.meal, multiple: count })
            finish(copied)
          },
          onDelete: remove,
        }}
      />
    </div>
  )
}
