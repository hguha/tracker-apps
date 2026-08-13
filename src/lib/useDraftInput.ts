// Local draft that isn't clobbered by the liveQuery refetch a write triggers:
// adopts external changes only while unfocused, and commits on blur only if the
// value actually changed. The caller parses the raw draft string.

import { useEffect, useRef, useState, type FocusEvent, type ChangeEvent } from 'react'

export function useDraftInput({
  value,
  onCommit,
  // Commit on every keystroke instead of on blur.
  commitOnChange = false,
  // Select contents on focus, so a tap overwrites rather than appends.
  selectOnFocus = false,
}: {
  value: string
  onCommit: (draft: string) => void
  commitOnChange?: boolean
  selectOnFocus?: boolean
}) {
  const [draft, setDraft] = useState(value)
  const isFocused = useRef(false)

  useEffect(() => {
    if (!isFocused.current) setDraft(value)
  }, [value])

  const inputProps = {
    value: draft,
    onFocus: (event: FocusEvent<HTMLInputElement>) => {
      isFocused.current = true
      if (selectOnFocus) event.currentTarget.select()
    },
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      setDraft(event.target.value)
      if (commitOnChange) onCommit(event.target.value)
    },
    onBlur: () => {
      isFocused.current = false
      if (!commitOnChange && draft !== value) onCommit(draft)
    },
  }

  return { draft, isEmpty: draft === '', inputProps }
}
