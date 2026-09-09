import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Button, Card, Screen, SegmentedTabs, useToast } from '@tracker-engine/ui'
import { ClipboardList, Link as LinkIcon, Sparkles, Wand2 } from 'lucide-react'
import * as repo from '@/data/repository'
import { nutrientsFor, recipeNutrients, scale } from '@/lib/nutrition'
import { CUISINE_LABELS } from '@/lib/cuisine'
import { grams } from '@/features/shared/format'
import { FoodSearchPicker } from '@/features/shared/FoodSearchPicker'
import { GramsRow } from '@/features/shared/GramsRow'
import { estimateIngredients, estimateMeal } from '@/features/log/estimate'
import { importRecipeFromUrl, type ImportedRecipe } from '@/data/recipeImport'
import { CUISINES, type CuisineKey, type Food } from '@/domain/types'

interface Draft {
  foodId: string | null
  label: string
  grams: number
}

/**
 * Lines read from somewhere but not yet turned into weights.
 *
 * They exist as their own state, rather than being converted in the same breath they're read,
 * because converting nineteen ingredient lines takes most of a minute and can fail on its own. Held
 * here, a failed conversion costs a retry instead of the whole import.
 */
interface Pending {
  lines: string[]
  from: string
}

type StartMode = 'link' | 'paste' | 'describe'

const START_TABS = [
  { key: 'link' as const, label: 'From a link' },
  { key: 'paste' as const, label: 'Paste it' },
  { key: 'describe' as const, label: 'Describe it' },
]

/**
 * Building or editing a recipe.
 *
 * Three ways in, because entering fifteen ingredients by hand is why nobody uses recipe features:
 * import a link, paste an ingredient list, or describe the dish. All three land in the same place —
 * verbatim lines, then weights, then an editable list — so there's one path to understand and one
 * to fix when a line converts wrongly. Every number comes from a matched food row; nothing
 * nutritional is ever read off a web page.
 */
export function RecipeEditor({
  recipeId,
  onBack,
}: {
  recipeId: string | null
  onBack: () => void
}) {
  const toast = useToast()
  const existing = useLiveQuery(
    () => (recipeId ? repo.getRecipe(recipeId) : Promise.resolve(undefined)),
    [recipeId],
    undefined,
  )

  const [name, setName] = useState('')
  const [servings, setServings] = useState('4')
  const [cuisine, setCuisine] = useState<CuisineKey | ''>('')
  const [items, setItems] = useState<Draft[]>([])
  const [steps, setSteps] = useState('')
  const [totalMinutes, setTotalMinutes] = useState<number | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [source, setSource] = useState<string | null>(null)

  const [mode, setMode] = useState<StartMode>('link')
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [isReading, setIsReading] = useState(false)
  const [isConverting, setIsConverting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load once, when the row arrives; later edits are local until saved.
  useEffect(() => {
    if (!existing) return
    setName(existing.name)
    setServings(String(existing.servings))
    setCuisine(existing.cuisine ?? '')
    setSteps(existing.steps.join('\n'))
    setTotalMinutes(existing.totalMinutes)
    setTags(existing.tags)
    setSource(existing.sourceUrl)
    setItems(
      existing.ingredients.map((ingredient) => ({
        foodId: ingredient.foodId,
        label: ingredient.label,
        grams: ingredient.grams,
      })),
    )
  }, [existing?.id])

  const foods = useLiveQuery(
    () => repo.foodsByIds(items.map((item) => item.foodId).filter(isPresent)),
    [items],
    new Map<string, Food>(),
  )

  const total = recipeNutrients(
    { ingredients: items.map((item, index) => ({ ...item, id: String(index), optional: false })) },
    foods ?? new Map(),
  )
  const each = scale(total, 1 / Math.max(1, Number(servings) || 1))
  const unmatched = items.filter((item) => item.foodId === null).length

  /** Stage one: read the page. Fast, and everything it found is kept even if stage two fails. */
  async function read() {
    const url = input.trim()
    if (url.length < 8) return
    setIsReading(true)
    setError(null)
    try {
      const imported = await importRecipeFromUrl(url)
      applyImported(imported)
      setPending({ lines: imported.ingredients, from: hostOf(imported.sourceUrl) })
      setInput('')
      // Straight into the conversion, so the common case is still one tap — but from a state
      // where a failure leaves the lines on screen instead of discarding the whole import.
      await convert(imported.ingredients)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that link.')
    } finally {
      setIsReading(false)
    }
  }

  function applyImported(imported: ImportedRecipe) {
    setName((current) => current || imported.name)
    if (imported.servings) setServings(String(imported.servings))
    if (imported.cuisine) setCuisine(imported.cuisine)
    if (imported.steps.length > 0) setSteps(imported.steps.join('\n'))
    setTotalMinutes(imported.totalMinutes)
    setTags(imported.tags)
    setSource(imported.sourceUrl)
  }

  /** Stage two: the amounts each line states, at the amounts it states them. */
  async function convert(lines: readonly string[]) {
    if (lines.length === 0 || isConverting) return
    setIsConverting(true)
    setError(null)
    try {
      const estimate = await estimateIngredients(lines)
      setItems((current) => [...current, ...estimate.items.map(toDraft)])
      setPending(null)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `${cause.message} The ingredient list is still here — try converting it again.`
          : 'Could not convert those amounts.',
      )
    } finally {
      setIsConverting(false)
    }
  }

  /** Pasted text: one ingredient per line, converted by the same path as an import. */
  async function fromPaste() {
    const lines = input
      .split('\n')
      .map((line) => line.replace(/^[-*•\s]+/, '').trim())
      .filter((line) => line.length > 1)
    if (lines.length === 0) return
    setPending({ lines, from: 'what you pasted' })
    setInput('')
    await convert(lines)
  }

  /** A described dish, where nobody stated an amount and ordinary portions are the right guess. */
  async function fromDescription() {
    const text = input.trim()
    if (text.length < 3) return
    setIsConverting(true)
    setError(null)
    try {
      const estimate = await estimateMeal(text)
      setItems((current) => [...current, ...estimate.items.map(toDraft)])
      setName((current) => current || text)
      setInput('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not work that out.')
    } finally {
      setIsConverting(false)
    }
  }

  const isBusy = isReading || isConverting
  const canSave = items.length > 0 && name.trim().length > 0

  function save() {
    if (isSaving || !canSave) return
    setIsSaving(true)
    return repo
      .saveRecipe(
        {
          name,
          servings: Number(servings) || 1,
          ingredients: items,
          steps: steps.split('\n').map((step) => step.trim()).filter(Boolean),
          cuisine: cuisine === '' ? null : cuisine,
          totalMinutes,
          tags,
          sourceUrl: source,
        },
        recipeId ?? undefined,
      )
      .then(() => {
        toast.show(recipeId ? 'Recipe updated' : 'Recipe saved')
        onBack()
      })
      .finally(() => setIsSaving(false))
  }

  return (
    <Screen
      title={recipeId ? 'Edit recipe' : 'New recipe'}
      onBack={onBack}
      action={
        <button
          disabled={!canSave || isSaving}
          onClick={() => void save()}
          className="h-9 shrink-0 rounded-lg px-2.5 text-[14px] font-semibold text-accent disabled:opacity-40 active:bg-sunken"
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      }
    >
      <Card className="space-y-3 p-4">
        <label className="block">
          <span className="text-[11px] text-ink-muted">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Sunday chilli"
            className="mt-0.5 w-full rounded-xl bg-sunken px-3 py-2 text-[15px] outline-none"
          />
        </label>
        <div className="flex gap-3">
          <label className="block flex-1">
            <span className="text-[11px] text-ink-muted">Servings</span>
            <input
              type="number"
              inputMode="numeric"
              value={servings}
              onChange={(event) => setServings(event.target.value)}
              className="tabular mt-0.5 w-full rounded-xl bg-sunken px-3 py-2 text-[15px] outline-none"
            />
          </label>
          <label className="block flex-[1.4]">
            <span className="text-[11px] text-ink-muted">Cuisine</span>
            <select
              value={cuisine}
              onChange={(event) => setCuisine(event.target.value as CuisineKey | '')}
              className="mt-0.5 w-full rounded-xl bg-sunken px-3 py-2 text-[15px] outline-none"
            >
              <option value="">Not set</option>
              {CUISINES.map((key) => (
                <option key={key} value={key}>
                  {CUISINE_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {totalMinutes !== null && (
          <p className="text-[12px] text-ink-muted">Takes about {totalMinutes} minutes.</p>
        )}
      </Card>

      <Card className="space-y-2 p-4">
        <SegmentedTabs
          tabs={START_TABS}
          active={mode}
          onSelect={(next) => {
            setMode(next)
            setInput('')
            setError(null)
          }}
        />

        {mode === 'link' ? (
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            inputMode="url"
            placeholder="https://…"
            className="w-full rounded-xl bg-sunken px-3 py-2.5 text-[15px] outline-none"
          />
        ) : (
          <textarea
            rows={mode === 'paste' ? 4 : 2}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={
              mode === 'paste'
                ? '500g beef mince\n2 tins chopped tomatoes\n1 onion'
                : 'A big bowl of chilli with rice and sour cream'
            }
            className="w-full resize-none rounded-xl bg-sunken px-3 py-2.5 text-[15px] outline-none"
          />
        )}

        <Button
          variant="secondary"
          className="w-full"
          disabled={input.trim().length < 3 || isBusy}
          onClick={() => {
            if (mode === 'link') void read()
            else if (mode === 'paste') void fromPaste()
            else void fromDescription()
          }}
        >
          {mode === 'link' ? <LinkIcon size={15} /> : mode === 'paste' ? <ClipboardList size={15} /> : <Sparkles size={15} />}
          {isReading
            ? 'Reading the page…'
            : isConverting
              ? 'Working out the amounts…'
              : mode === 'link'
                ? 'Read the ingredients'
                : mode === 'paste'
                  ? 'Convert these lines'
                  : 'Break it into ingredients'}
        </Button>

        <p className="text-[12px] text-ink-muted">
          {mode === 'link'
            ? 'Reads the recipe the site publishes for search engines — its name, servings, cuisine and ingredient lines. Nothing nutritional comes from the page: the weights come from the amounts it states, and every macro from the food database.'
            : mode === 'paste'
              ? 'One ingredient per line, at the amounts written. Works for any site, including the ones a link can’t read.'
              : 'For a dish with no written recipe. Ordinary portions are assumed, so check the weights.'}
        </p>

        {error && (
          <p role="alert" className="text-[12.5px]" style={{ color: 'var(--status-critical)' }}>
            {error}
          </p>
        )}
      </Card>

      {pending && (
        <Card className="space-y-2 p-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
            Read from {pending.from}
          </h2>
          <ul className="space-y-0.5">
            {pending.lines.map((line, index) => (
              <li key={index} className="text-[13px] text-ink-secondary">
                {line}
              </li>
            ))}
          </ul>
          <Button
            className="w-full"
            disabled={isConverting}
            onClick={() => void convert(pending.lines)}
          >
            <Wand2 size={15} />
            {isConverting
              ? 'Working out the amounts…'
              : `Convert ${pending.lines.length} amounts to weights`}
          </Button>
          <button
            onClick={() => setPending(null)}
            className="w-full py-1 text-[12.5px] text-ink-muted active:opacity-60"
          >
            Discard these lines
          </button>
        </Card>
      )}

      <Card className="p-0">
        <div className="flex items-baseline justify-between px-4 pb-1 pt-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
            Ingredients
          </h2>
          {unmatched > 0 && (
            <span className="text-[11.5px]" style={{ color: 'var(--status-serious)' }}>
              {unmatched} not counted
            </span>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-4 pb-3 text-[13px] text-ink-muted">Nothing added yet.</p>
        ) : (
          <ul className="divide-y divide-line px-4">
            {items.map((item, index) => {
              const setGrams = (grams: number) =>
                setItems(items.map((draft, i) => (i === index ? { ...draft, grams } : draft)))
              // Deliberately not asserted: the food lookup is a live query, so a row added a
              // moment ago is legitimately absent from the map for one render. Asserting it
              // crashed the editor every time an ingredient was added.
              const food = item.foodId === null ? undefined : foods?.get(item.foodId)
              return (
                <GramsRow
                  key={index}
                  after={
                    // A nineteen-line import always leaves a few lines the database has no row
                    // for, and those count zero — so the total reads low and there was no way to
                    // fix it but delete the row and search again from the bottom of the screen.
                    item.foodId === null ? (
                      <FoodSearchPicker
                        placeholder={`Find a match for “${item.label}”`}
                        branded={false}
                        limit={5}
                        onPick={(food) =>
                          setItems(
                            items.map((draft, i) =>
                              i === index
                                ? { ...draft, foodId: food.id, label: food.description }
                                : draft,
                            ),
                          )
                        }
                      />
                    ) : undefined
                  }
                  title={food?.description ?? item.label}
                  subtitle={
                    item.foodId === null ? (
                      <span style={{ color: 'var(--status-serious)' }}>
                        no match for “{item.label}” — not counted
                      </span>
                    ) : (
                      <span className="tabular text-ink-muted">
                        {food ? `${Math.round(nutrientsFor(food, item.grams).kcal)} kcal` : '…'}
                      </span>
                    )
                  }
                  grams={item.grams}
                  onGrams={setGrams}
                  onRemove={() => setItems(items.filter((_, i) => i !== index))}
                />
              )
            })}
          </ul>
        )}

        <div className="border-t border-line px-4 py-3">
          <FoodSearchPicker
            placeholder="Add an ingredient"
            branded={false}
            onPick={(food) =>
              setItems((current) => [
                ...current,
                { foodId: food.id, label: food.description, grams: 100 },
              ])
            }
          />
        </div>
      </Card>

      <Card className="space-y-1.5 p-4">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
          Method
        </h2>
        <textarea
          rows={Math.min(12, Math.max(3, steps.split('\n').length))}
          value={steps}
          onChange={(event) => setSteps(event.target.value)}
          placeholder="One step per line. Imported recipes fill this in."
          className="w-full resize-none rounded-xl bg-sunken px-3 py-2.5 text-[13.5px] leading-relaxed outline-none"
        />
      </Card>

      <Card className="p-4">
        <p className="tabular text-[13.5px] font-semibold">
          {total.kcal} kcal total · {each.kcal} kcal per serving
        </p>
        <p className="tabular mt-0.5 text-[12.5px] text-ink-muted">
          Per serving: {grams(each.proteinMg)}P {grams(each.carbsMg)}C {grams(each.fatMg)}F
        </p>
        {unmatched > 0 && (
          <p className="mt-1.5 text-[12px]" style={{ color: 'var(--status-serious)' }}>
            {unmatched} ingredient{unmatched === 1 ? '' : 's'} matched nothing and count zero, so
            this total is low. Search a match on each one above.
          </p>
        )}
        {source && (
          <p className="mt-2 truncate text-[12px] text-ink-muted">From {hostOf(source)}</p>
        )}

        {/* Also in the header, for a long form — but the end of the form is where you finish, and
            a header-only Save reads as "no way to save this". */}
        <Button className="mt-3 w-full" disabled={!canSave || isSaving} onClick={() => void save()}>
          {isSaving ? 'Saving…' : recipeId ? 'Save changes' : 'Save recipe'}
        </Button>
        {!canSave && (
          <p className="mt-1.5 text-center text-[12px] text-ink-muted">
            {name.trim().length === 0
              ? 'Give it a name first.'
              : 'Add at least one ingredient first.'}
          </p>
        )}
      </Card>
    </Screen>
  )
}

const toDraft = (item: { food: Food | null; query: string; grams: number }): Draft => ({
  foodId: item.food?.id ?? null,
  label: item.food?.description ?? item.query,
  grams: item.grams,
})

const isPresent = (value: string | null): value is string => value !== null

/** The site's name, which is what a person recognises — not the whole tracking-laden URL. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
