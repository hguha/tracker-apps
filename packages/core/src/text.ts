export const plural = (count: number, word: string, many = `${word}s`): string =>
  `${count} ${count === 1 ? word : many}`

export const signed = (value: number, digits = 0): string =>
  `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`

export const formatNumber = (value: number, digits = 0): string =>
  value.toLocaleString(undefined, { maximumFractionDigits: digits })

export const formatGrams = (grams: number): string => `${formatNumber(grams)} g`

export const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)
