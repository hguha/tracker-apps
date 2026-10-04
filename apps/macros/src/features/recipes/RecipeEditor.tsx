import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { plural } from '@tracker-engine/core'
import { BottomSheet, Button, Card, Screen, useToast } from '@tracker-engine/ui'
import { Minus, Plus } from 'lucide-react'
import * as repo from '@/data/repository'
import { nutrientsFor, recipeNutrients, scale } from '@/lib/nutrition'
import { CUISINE_LABELS } from '@/lib/cuisine'
import { parseQuantity } from '@/lib/parseQuantity'
import { grams } from '@/features/shared/format'
import { NumberInput } from '@/features/shared/NumberInput'
import { FoodSearchPicker } from '@/features/shared/FoodSearchPicker'
import { AmountRow } from '@/features/shared/AmountRow'
import { Working } from '@/features/log/Working'
import {
  describeComponents,
  describeMeal,
  describePhoto,
  matchDraft,
  SECOND_MS,
  withoutProduct,
  type FoodDraft,
  type MealEstimate,
} from '@/features/log/estimate'
import type { LogTarget } from '@/features/shared/target'
import type { ImportedRecipe } from '@/data/recipeImport'
import { CUISINES, type CuisineKey, type EntrySource, type Food, type Recipe } from '@/domain/types'
import { AddIngredient } from './AddIngredient'
import { ImportLines } from './ImportLines'
import {
  recipeGrams,
  repointRow,
  rowForPick,
  rowKey,
  rowsFromRecipe,
  rowsFromSaved,
  type Row,
} from './rows'

export interface LogMode {
  target: LogTarget
  title: string
  when?: React.ReactNode
  onLogged: (count: number) => void
  onProduct?: (product: FoodDraft, text: string) => void
}

export type ComposeStart =
  | { kind: 'ask'; text: string }
  | { kind: 'photo'; base64: string; note: string; preview: string }

type Asking = { phase: 'reading' | 'matching'; startedAt: number }

export function RecipeEditor({
  recipeId,
  onBack,
  log,
  start,
}: {
  recipeId: string | null
  onBack: () => void
  log?: LogMode
  start?: ComposeStart
}) {
  const toast = useToast()
  const existing = useLiveQuery(
    () => (recipeId ? repo.getRecipe(recipeId) : Promise.resolve(undefined)),
    [recipeId],
    undefined,
  )
  const recipes = useLiveQuery(() => repo.recipes(), [], [])

  const [name, setName] = useState('')
  const [servings, setServings] = useState(log ? 1 : 4)
  const [eaten, setEaten] = useState(1)
  const [cuisine, setCuisine] = useState<CuisineKey | ''>('')
  const [rows, setRows] = useState<Row[]>([])
  const [steps, setSteps] = useState('')
  const [totalMinutes, setTotalMinutes] = useState<number | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [source, setSource] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [swapping, setSwapping] = useState<string | null>(null)
  const [asking, setAsking] = useState<Asking | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [aiSource, setAiSource] = useState<EntrySource | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [pastMeals, setPastMeals] = useState<{ count: number; before: Recipe } | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (!existing) return
    setName(existing.name)
    setServings(existing.servings)
    setCuisine(existing.cuisine ?? '')
    setSteps(existing.steps.join('\n'))
    setTotalMinutes(existing.totalMinutes)
    setTags(existing.tags)
    setSource(existing.sourceUrl)
    setRows(rowsFromSaved(existing))
  }, [existing?.id])

  useEffect(() => {
    if (!asking) return
    const id = window.setInterval(
      () => setElapsed(Math.round((Date.now() - asking.startedAt) / SECOND_MS)),
      SECOND_MS,
    )
    return () => window.clearInterval(id)
  }, [asking?.startedAt])

  useEffect(() => {
    if (!start || started.current) return
    started.current = true
    if (start.kind === 'ask') void ask(start.text, () => describeMeal(start.text), 'describe')
    else {
      setPreview(start.preview)
      void ask(start.note, () => describePhoto(start.base64, 'image/jpeg', start.note), 'photo')
    }
  }, [])

  const foods = useLiveQuery(
    () => repo.foodsByIds(rows.map((row) => row.foodId).filter(isPresent)),
    [rows.map((row) => row.foodId).join(',')],
    new Map<string, Food>(),
  )

  const total = recipeNutrients(
    {
      ingredients: rows.map((row) => ({
        id: row.key,
        foodId: row.foodId,
        label: row.label,
        grams: row.grams,
        optional: false,
        amount: row.amount ?? null,
      })),
    },
    foods ?? new Map(),
  )
  const each = scale(total, 1 / Math.max(1, servings))
  const unmatched = rows.filter((row) => row.foodId === null && !row.isMatching).length
  const counted = rows.filter((row) => row.foodId !== null && row.grams > 0)
  const fallbackName = rows
    .slice(0, 2)
    .map((row) => row.label.split(',')[0])
    .join(' & ')
  const finalName = name.trim() || fallbackName

  async function ask(text: string, read: () => Promise<MealEstimate>, kind: EntrySource) {
    if (asking) return
    setAsking({ phase: 'reading', startedAt: Date.now() })
    setElapsed(0)
    setError(null)
    const isFresh = name.trim() === '' && rows.length === 0
    if (isFresh && text.trim()) {
      const quantity = parseQuantity(text.trim())
      setName(capitalise(quantity?.unit ?? text.trim()))
      if (quantity && log) {
        setServings(quantity.count)
        setEaten(quantity.count)
      }
    }
    try {
      let draft = await read()
      if (draft.product) {
        if (log?.onProduct && rows.length === 0) {
          log.onProduct(draft.product, text)
          return
        }
        draft = withoutProduct(draft)
      }
      setAiSource((current) => current ?? kind)
      if (draft.assumptions) setNotes(draft.assumptions)
      if (isFresh && !text.trim() && draft.label) setName(capitalise(draft.label))

      const byName = new Map(recipes.map((recipe) => [recipe.name.trim().toLowerCase(), recipe]))
      const keys = new Map<string, string>()
      const added: Row[] = []
      const toMatch = draft.items.filter((item) => {
        const recipe = byName.get(item.query.trim().toLowerCase())
        if (!recipe) return true
        const whole = recipeGrams(recipe)
        added.push(...rowsFromRecipe(recipe, whole > 0 && item.grams > 0 ? item.grams / whole : undefined))
        return false
      })
      for (const item of toMatch) {
        const key = rowKey()
        keys.set(item.id, key)
        added.push({
          key,
          foodId: null,
          label: item.query,
          query: item.query,
          grams: item.grams,
          isMatching: true,
        })
      }
      setRows((current) => [...current, ...added])
      if (draft.items.length === 0) setError('Nothing came back. Search for the foods instead.')

      setAsking((current) => current && { ...current, phase: 'matching' })
      await matchDraft({ ...draft, items: toMatch }, (item) =>
        setRows((current) =>
          current.map((row) =>
            row.key === keys.get(item.id)
              ? {
                  ...row,
                  foodId: item.food?.id ?? null,
                  label: item.food?.description ?? item.query,
                  isMatching: false,
                }
              : row,
          ),
        ),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not work that out.')
      setRows((current) => current.map((row) => (row.isMatching ? { ...row, isMatching: false } : row)))
    } finally {
      setAsking(null)
    }
  }

  function applyImported(imported: ImportedRecipe) {
    setName((current) => current || imported.name)
    if (imported.servings) setServings(imported.servings)
    if (imported.cuisine) setCuisine(imported.cuisine)
    if (imported.steps.length > 0) setSteps(imported.steps.join('\n'))
    setTotalMinutes(imported.totalMinutes)
    setTags(imported.tags)
    setSource(imported.sourceUrl)
  }

  const input = () => ({
    name: finalName,
    servings,
    ingredients: rows.map((row) => ({
      foodId: row.foodId,
      label: row.label,
      grams: row.grams,
      amount: row.amount ?? null,
    })),
    steps: steps
      .split('\n')
      .map((step) => step.trim())
      .filter(Boolean),
    cuisine: cuisine === '' ? null : cuisine,
    totalMinutes,
    tags,
    sourceUrl: source,
  })

  async function busy(work: () => Promise<void>) {
    if (isSaving) return
    setIsSaving(true)
    try {
      await work()
    } finally {
      setIsSaving(false)
    }
  }

  async function persist(updatePast: boolean) {
    const before = pastMeals?.before ?? existing
    const id = await repo.saveRecipe(input(), recipeId ?? undefined)
    const after = await repo.getRecipe(id)
    const updated = updatePast && before && after ? await repo.relogRecipe(before, after) : 0
    setPastMeals(null)
    toast.show(
      updated > 0
        ? `Recipe and ${plural(updated, 'meal')} updated`
        : recipeId
          ? 'Recipe updated'
          : 'Saved to your recipes',
    )
    onBack()
  }

  const save = (updatePast: boolean) => busy(() => persist(updatePast))

  const requestSave = () =>
    busy(async () => {
      const sittings = recipeId && existing ? await repo.recipeSittings(recipeId) : []
      if (sittings.length > 0 && existing) setPastMeals({ count: sittings.length, before: existing })
      else await persist(false)
    })

  const logIt = () =>
    busy(async () => {
      if (!log) return
      const { meal, at, venue } = log.target
      const kind = aiSource ?? 'recipe'
      if (rows.length === 1 && counted.length === 1) {
        const food = foods?.get(counted[0]!.foodId!)
        if (!food) return
        await repo.logFood({
          food,
          grams: (counted[0]!.grams * eaten) / Math.max(1, servings),
          meal,
          eatenAt: at,
          venue,
          source: kind,
          note: counted[0]!.query,
        })
        toast.show('Logged')
        log.onLogged(1)
        return
      }
      const id = await repo.saveRecipe(input(), recipeId ?? undefined)
      const recipe = await repo.getRecipe(id)
      if (!recipe) return
      const written = await repo.logRecipeIngredients(recipe, eaten, meal, at, venue, {
        source: kind,
      })
      toast.show(`${recipe.name} logged · saved to recipes`)
      log.onLogged(written)
    })

  const canSave = rows.length > 0 && finalName.length > 0 && !asking
  const canLog = counted.length > 0 && !asking
  const isFirst = rows.length === 0 && !asking

  return (
    <Screen
      title={log?.title ?? (recipeId ? 'Edit recipe' : 'New recipe')}
      onBack={onBack}
      action={
        log ? undefined : (
          <button
            disabled={!canSave || isSaving}
            onClick={() => void requestSave()}
            className="h-9 shrink-0 rounded-lg px-2.5 text-[14px] font-semibold text-accent disabled:opacity-40 active:bg-sunken"
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        )
      }
    >
      {log?.when}

      {preview && (
        <div className="overflow-hidden rounded-xl bg-black">
          <img src={preview} alt="Your photo" className="max-h-40 w-full object-cover" />
        </div>
      )}

      <Card className="space-y-2 p-4">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={fallbackName || 'Name'}
          aria-label="Name"
          className="w-full rounded-xl bg-sunken px-3 py-2 text-[15px] font-medium outline-none"
        />
        <label className="flex items-center gap-2 text-[13px] text-ink-secondary">
          Makes
          <NumberInput
            value={servings}
            onValue={(value) => setServings(Math.max(1, Math.round(value)))}
            aria-label="Servings it makes"
            className="tabular w-14 rounded-lg bg-sunken px-2 py-1 text-center text-[14px] outline-none"
          />
          {servings === 1 ? 'serving' : 'servings'}
        </label>
      </Card>

      <Card className="p-0">
        <div className="flex items-baseline justify-between px-4 pb-1 pt-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
            Ingredients
          </h2>
          {unmatched > 0 && (
            <span className="text-[11.5px]" style={{ color: 'var(--status-serious)' }}>
              {unmatched} without macros
            </span>
          )}
        </div>

        {rows.length > 0 && (
          <ul className="divide-y divide-line px-4">
            {rows.map((row) => {
              const food = row.foodId === null ? undefined : foods?.get(row.foodId)
              const isSwapping = swapping === row.key || (row.foodId === null && !row.isMatching)
              return (
                <AmountRow
                  key={row.key}
                  food={food}
                  title={food?.description ?? row.label}
                  subtitle={
                    <RowNote
                      row={row}
                      food={food}
                      isSwapping={swapping === row.key}
                      onSwap={() => setSwapping(swapping === row.key ? null : row.key)}
                    />
                  }
                  grams={row.grams}
                  onGrams={(value) =>
                    setRows((current) =>
                      current.map((r) => (r.key === row.key ? { ...r, grams: value } : r)),
                    )
                  }
                  onRemove={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                  after={
                    isSwapping && row.parsed?.isToTaste !== true ? (
                      <FoodSearchPicker
                        placeholder={`Which “${row.query}”?`}
                        initialQuery={row.query}
                        branded={false}
                        limit={5}
                        onPick={(picked) => {
                          setRows((current) =>
                            current.map((r) => (r.key === row.key ? repointRow(r, picked) : r)),
                          )
                          setSwapping(null)
                        }}
                      />
                    ) : undefined
                  }
                />
              )
            })}
          </ul>
        )}

        <div className="space-y-2 border-t border-line px-4 py-3">
          {asking && <Working phase={asking.phase} elapsed={elapsed} />}
          <AddIngredient
            recipes={recipes}
            isFirst={isFirst}
            autoFocus={!!log && !start}
            isAsking={asking !== null}
            onFood={(food) => setRows((current) => [...current, rowForPick(food)])}
            onRecipe={(recipe) => setRows((current) => [...current, ...rowsFromRecipe(recipe)])}
            onAsk={(text) => void ask(text, () => describeComponents(text), 'describe')}
          />
          <ImportLines onImported={applyImported} setRows={setRows} onNotes={setNotes} />
          {error && (
            <p role="alert" className="text-[12.5px]" style={{ color: 'var(--status-critical)' }}>
              {error}
            </p>
          )}
        </div>
      </Card>

      {rows.length > 0 && (
        <Card className="p-4">
          <p className="tabular text-[13.5px] font-semibold">
            {servings > 1
              ? `${each.kcal} kcal a serving · ${total.kcal} total`
              : `${total.kcal} kcal`}
          </p>
          <p className="tabular mt-0.5 text-[12.5px] text-ink-muted">
            {servings > 1 ? 'Each: ' : ''}
            {grams(each.proteinMg)}P {grams(each.carbsMg)}C {grams(each.fatMg)}F
          </p>
          {notes && <p className="mt-1.5 text-[12px] text-ink-muted">{notes}</p>}
        </Card>
      )}

      {!log && (
        <details className="rounded-2xl bg-surface px-4 py-3">
          <summary className="cursor-pointer text-[13px] font-semibold text-ink-secondary">
            Method & details
          </summary>
          <div className="mt-2.5 space-y-2.5">
            <select
              value={cuisine}
              onChange={(event) => setCuisine(event.target.value as CuisineKey | '')}
              aria-label="Cuisine"
              className="w-full rounded-xl bg-sunken px-3 py-2 text-[14px] outline-none"
            >
              <option value="">Cuisine not set</option>
              {CUISINES.map((key) => (
                <option key={key} value={key}>
                  {CUISINE_LABELS[key]}
                </option>
              ))}
            </select>
            <textarea
              rows={Math.min(12, Math.max(3, steps.split('\n').length))}
              value={steps}
              onChange={(event) => setSteps(event.target.value)}
              placeholder="One step per line"
              aria-label="Method"
              className="w-full resize-none rounded-xl bg-sunken px-3 py-2.5 text-[13.5px] leading-relaxed outline-none"
            />
            {totalMinutes !== null && (
              <p className="text-[12px] text-ink-muted">Takes about {totalMinutes} minutes.</p>
            )}
            {source && <p className="truncate text-[12px] text-ink-muted">From {hostOf(source)}</p>}
          </div>
        </details>
      )}

      {log ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-2.5">
            <span className="text-[13.5px] text-ink-secondary">You had</span>
            <div className="flex items-center gap-2">
              <Stepper label="Fewer" onClick={() => setEaten(fewer(eaten))}>
                <Minus size={15} />
              </Stepper>
              <NumberInput
                value={eaten}
                onValue={(value) => setEaten(Math.max(0.25, value))}
                aria-label="Servings eaten"
                className="tabular w-12 rounded-lg bg-sunken px-1 py-1 text-center text-[14px] outline-none"
              />
              <Stepper label="More" onClick={() => setEaten(more(eaten))}>
                <Plus size={15} />
              </Stepper>
              <span className="w-14 text-[13px] text-ink-muted">
                {eaten === 1 ? 'serving' : 'servings'}
              </span>
            </div>
          </div>
          <Button className="w-full" disabled={!canLog || isSaving} onClick={() => void logIt()}>
            {isSaving ? 'Logging…' : `Log ${Math.round(each.kcal * eaten)} kcal`}
          </Button>
          {rows.length > 0 && (
            <button
              disabled={!canSave || isSaving}
              onClick={() => void save(false)}
              className="w-full py-1.5 text-[12.5px] font-semibold text-ink-muted disabled:opacity-40 active:opacity-60"
            >
              Save without logging
            </button>
          )}
        </div>
      ) : (
        <Button className="w-full" disabled={!canSave || isSaving} onClick={() => void requestSave()}>
          {isSaving ? 'Saving…' : recipeId ? 'Save changes' : 'Save recipe'}
        </Button>
      )}

      {pastMeals && (
        <BottomSheet onDismiss={() => setPastMeals(null)} panelClassName="space-y-2 p-4">
          <h2 className="text-[16px] font-semibold tracking-tight">
            Update the {plural(pastMeals.count, 'meal')} you logged?
          </h2>
          <Button className="w-full" disabled={isSaving} onClick={() => void save(true)}>
            Update past meals too
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            disabled={isSaving}
            onClick={() => void save(false)}
          >
            Only from now on
          </Button>
        </BottomSheet>
      )}
    </Screen>
  )
}

function RowNote({
  row,
  food,
  isSwapping,
  onSwap,
}: {
  row: Row
  food: Food | undefined
  isSwapping: boolean
  onSwap: () => void
}) {
  if (row.isMatching) return <span className="text-ink-muted">looking it up…</span>
  if (row.foodId === null) {
    return row.parsed?.isToTaste ? (
      <span className="text-ink-muted">{row.amount ?? 'to taste'} · not counted</span>
    ) : (
      <span style={{ color: 'var(--status-serious)' }}>no match — pick one</span>
    )
  }
  return (
    <span className="tabular text-ink-muted">
      {food ? `${Math.round(nutrientsFor(food, row.grams).kcal)} kcal` : '…'}
      {' · '}
      <button onClick={onSwap} className="font-semibold text-accent active:opacity-60">
        {isSwapping ? 'cancel' : 'change'}
      </button>
    </span>
  )
}

function Stepper({
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
      className="flex size-8 items-center justify-center rounded-lg bg-sunken text-ink-secondary active:opacity-60"
    >
      {children}
    </button>
  )
}

const fewer = (value: number): number =>
  value > 1 ? Math.max(1, Math.ceil(value) - 1) : Math.max(0.25, value - 0.25)

const more = (value: number): number => (value < 1 ? Math.min(1, value + 0.25) : Math.floor(value) + 1)

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

const isPresent = (value: string | null): value is string => value !== null

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
