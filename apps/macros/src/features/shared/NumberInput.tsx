import { useEffect, useState, type InputHTMLAttributes } from 'react'

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>

export function NumberInput({
  value,
  onValue,
  allowZero = true,
  ...props
}: NativeProps & {
  value: number
  onValue: (value: number) => void
  allowZero?: boolean
}) {
  const shown = String(Math.round(value * 100) / 100)
  const [draft, setDraft] = useState(shown)
  useEffect(() => setDraft(shown), [shown])

  return (
    <input
      type="number"
      inputMode="decimal"
      {...props}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value)
        const next = Number(event.target.value)
        if (event.target.value === '' || !Number.isFinite(next)) return
        if (next < 0 || (!allowZero && next === 0)) return
        onValue(next)
      }}
    />
  )
}
