/**
 * The draft lifecycle every text/number input in the app shares.
 *
 * Four fields (set weight/reps, cardio, duration, template name) all reinvented
 * the same three-part dance:
 *   1. hold a local `draft` so a keystroke isn't clobbered by the liveQuery
 *      refetch a write triggers;
 *   2. adopt an external change (a "same as last" tap, an edit elsewhere) — but
 *      only while the field isn't focused, or it would fight the typist;
 *   3. commit on blur, and only if the value actually changed, so tabbing
 *      through an untouched field doesn't rewrite the row and retrigger PR
 *      checks.
 *
 * This hook owns that lifecycle and nothing else. Parsing (number vs `m:ss`)
 * and markup stay with each field, because those genuinely differ. `onCommit`
 * receives the raw draft string; the caller parses.
 */

import { useEffect, useRef, useState, type FocusEvent, type ChangeEvent } from 'react'

export function useDraftInput({
  value,
  onCommit,
  /** Commit on every keystroke instead of on blur (e.g. a name that writes live). */
  commitOnChange = false,
  /** Select the field's contents on focus, so a tap overwrites rather than appends. */
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
      // Guard on the parsed-input boundary: commit only a genuine edit, so
      // "12" vs "12.0" don't thrash but a real change still lands.
      if (!commitOnChange && draft !== value) onCommit(draft)
    },
  }

  return { draft, isEmpty: draft === '', inputProps }
}
