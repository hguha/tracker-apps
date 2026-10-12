import { useState } from 'react'
import { FilterChipButton, FilterSheet } from '@tracker-engine/ui'

export interface DayRange<K extends string = string> {
  key: K
  label: string
  days: number
}

export function RangeFilter<K extends string>({
  ranges,
  value,
  onChange,
}: {
  ranges: readonly DayRange<K>[]
  value: K
  onChange: (key: K) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const range = ranges.find((option) => option.key === value)!

  return (
    <>
      <FilterChipButton label={range.label} isActive onClick={() => setIsOpen(true)} />
      {isOpen && (
        <FilterSheet
          title="Date range"
          singleSelect
          options={ranges.map((option) => ({ value: option.key, label: option.label }))}
          selected={[value]}
          onChange={(selected) => {
            if (selected[0]) onChange(selected[0] as K)
          }}
          onDismiss={() => setIsOpen(false)}
        />
      )}
    </>
  )
}
