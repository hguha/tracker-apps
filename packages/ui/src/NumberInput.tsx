import type { InputHTMLAttributes } from 'react'
import { useDraftInput } from './useDraftInput'

type NativeProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'onFocus' | 'onBlur' | 'type'
>

export const readNumber = (draft: string, allowZero: boolean): number | null => {
  const next = Number(draft)
  if (draft.trim() === '' || !Number.isFinite(next)) return null
  if (next < 0 || (!allowZero && next === 0)) return null
  return next
}

export function NumberInput({
  value,
  onValue,
  allowZero = true,
  tolerance = 0.005,
  ...props
}: NativeProps & {
  value: number
  onValue: (value: number) => void
  allowZero?: boolean
  tolerance?: number
}) {
  const { inputProps } = useDraftInput({
    value: String(Math.round(value * 100) / 100),
    commitOnChange: true,
    isEcho: (draft, shown) => Math.abs(Number(draft) - Number(shown)) <= tolerance,
    onCommit: (draft) => {
      const next = readNumber(draft, allowZero)
      if (next !== null) onValue(next)
    },
  })

  return <input type="number" inputMode="decimal" {...props} {...inputProps} />
}
