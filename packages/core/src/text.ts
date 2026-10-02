export const plural = (count: number, word: string, many = `${word}s`): string =>
  `${count} ${count === 1 ? word : many}`

export const signed = (value: number, digits = 0): string =>
  `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`
