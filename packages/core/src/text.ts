export const plural = (count: number, word: string, many = `${word}s`): string =>
  `${count} ${count === 1 ? word : many}`
