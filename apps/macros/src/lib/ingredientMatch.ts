import { queryTerms } from '@/lib/foodSearch'
import type { Food } from '@/domain/types'

const FORM_WORDS = new Set([
  'clove',
  'slice',
  'piece',
  'strip',
  'chunk',
  'cube',
  'sprig',
  'leaf',
  'leave',
  'stick',
  'wedge',
  'fillet',
  'filet',
  'link',
  'portion',
  'serving',
  'scoop',
  'meat',
  'deli',
  'floret',
])

const SYNONYMS: Record<string, string[]> = {
  icing: ['frosting'],
  frosting: ['icing'],
  garbanzo: ['chickpea'],
  chickpea: ['garbanzo'],
  oatmeal: ['oat'],
  ketchup: ['catsup'],
  catsup: ['ketchup'],
  scallion: ['onion'],
}

const MODIFIER_SEGMENT = /^(with|without|no|not|ns as to|made with|prepared with|or)\b/

function forms(word: string): string[] {
  if (word.length <= 3 || !word.endsWith('s') || word.endsWith('ss')) return [word]
  const stems = [word, word.slice(0, -1)]
  if (word.endsWith('es')) stems.push(word.slice(0, -2))
  if (word.endsWith('ies')) stems.push(`${word.slice(0, -3)}y`)
  return stems
}

const sameWord = (a: string, b: string): boolean => {
  const left = forms(a)
  return forms(b).some((form) => left.includes(form))
}

const isFormWord = (word: string): boolean => forms(word).some((form) => FORM_WORDS.has(form))

const nameWords = (text: string): string[] =>
  queryTerms(text).filter((word) => /^[a-z]{3,}$/.test(word))

export function ingredientHead(query: string): string | null {
  const name = (query.split(',')[0] ?? '').split(/\s(?:with|without|in|on|for)\s/i)[0] ?? ''
  const words = nameWords(name)
  const head = [...words].reverse().find((word) => !isFormWord(word))
  return head ?? words[words.length - 1] ?? null
}

function subjectWords(description: string): string[] {
  return description
    .toLowerCase()
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => !MODIFIER_SEGMENT.test(segment))
    .flatMap((segment) => nameWords(segment.split(/\s(?:with|without|w\/)\s/)[0] ?? ''))
}

const synonymsOf = (word: string): string[] =>
  forms(word).flatMap((form) => SYNONYMS[form] ?? [])

export function namesIngredient(food: Food, query: string): boolean {
  const head = ingredientHead(query)
  if (head === null) return true
  const accepted = [head, ...synonymsOf(head)]
  return subjectWords(food.description).some((word) =>
    accepted.some((candidate) => sameWord(word, candidate)),
  )
}

export function ingredientQueries(query: string): string[] {
  const trimmed = query.trim()
  const head = ingredientHead(trimmed)
  if (head === null) return [trimmed]
  const synonyms = synonymsOf(head)
  const lower = trimmed.toLowerCase()
  const swapped = synonyms.map((synonym) =>
    lower.replace(new RegExp(`\\b${head}\\b`), synonym),
  )
  const bare = nameWords(trimmed).length > 1 ? [head, ...synonyms] : synonyms
  return [...new Set([trimmed, ...swapped, ...bare].filter((text) => text.length >= 2))]
}
