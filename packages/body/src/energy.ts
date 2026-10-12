export function restingKcal(input: {
  kg: number
  heightCm: number
  age: number
  sex: 'male' | 'female'
}): number {
  return 10 * input.kg + 6.25 * input.heightCm - 5 * input.age + (input.sex === 'male' ? 5 : -161)
}
