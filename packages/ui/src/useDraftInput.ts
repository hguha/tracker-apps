import { useEffect, useRef, useState, type ChangeEvent, type FocusEvent } from 'react'

export function useDraftInput({
  value,
  onCommit,
  commitOnChange = false,
  selectOnFocus = false,
  isEcho = () => true,
}: {
  value: string
  onCommit: (draft: string) => void
  commitOnChange?: boolean
  selectOnFocus?: boolean
  isEcho?: (draft: string, value: string) => boolean
}) {
  const [draft, setDraft] = useState(value)
  const isFocused = useRef(false)
  const isEchoRef = useRef(isEcho)
  isEchoRef.current = isEcho

  useEffect(() => {
    setDraft((current) =>
      isFocused.current && isEchoRef.current(current, value) ? current : value,
    )
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
      if (commitOnChange) setDraft(value)
    },
  }

  return { draft, isEmpty: draft === '', inputProps }
}
