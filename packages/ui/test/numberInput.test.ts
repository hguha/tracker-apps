import { createElement, useState } from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NumberInput } from '../src/NumberInput'
import { useDraftInput } from '../src/useDraftInput'

afterEach(cleanup)

const focus = { currentTarget: { select: () => {} } } as never
const change = (value: string) => ({ target: { value } }) as never

describe('useDraftInput', () => {
  it('puts the saved value back when a commit is refused', () => {
    const { result } = renderHook(() => useDraftInput({ value: '80', onCommit: () => false }))
    act(() => result.current.inputProps.onFocus(focus))
    act(() => result.current.inputProps.onChange(change('abc')))
    act(() => result.current.inputProps.onBlur())
    expect(result.current.draft).toBe('80')
  })

  it('keeps the draft while focused and commits it on blur', () => {
    const onCommit = vi.fn()
    const { result, rerender } = renderHook(({ value }) => useDraftInput({ value, onCommit }), {
      initialProps: { value: '80' },
    })
    act(() => result.current.inputProps.onFocus(focus))
    act(() => result.current.inputProps.onChange(change('82.5')))
    rerender({ value: '81' })
    expect(result.current.draft).toBe('82.5')
    expect(onCommit).not.toHaveBeenCalled()

    act(() => result.current.inputProps.onBlur())
    expect(onCommit).toHaveBeenCalledWith('82.5')
  })

  it('takes an outside value when not focused', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDraftInput({ value, onCommit: () => {} }),
      { initialProps: { value: '5' } },
    )
    rerender({ value: '6' })
    expect(result.current.draft).toBe('6')
  })

  it('does not commit on blur when nothing changed', () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() => useDraftInput({ value: '5', onCommit }))
    act(() => result.current.inputProps.onFocus(focus))
    act(() => result.current.inputProps.onBlur())
    expect(onCommit).not.toHaveBeenCalled()
  })
})

function Field({ initial, tolerance }: { initial: number; tolerance: number }) {
  const [value, setValue] = useState(initial)
  return createElement('div', null, [
    createElement(NumberInput, {
      key: 'input',
      'aria-label': 'Amount',
      value,
      tolerance,
      onValue: (next: number) => setValue(Math.round(next * 28.35) / 28.35),
    }),
    createElement(
      'button',
      { key: 'step', onClick: () => setValue((current) => current + 1) },
      'More',
    ),
  ])
}

describe('NumberInput', () => {
  it('keeps what was typed when the saved value only differs by rounding', () => {
    render(createElement(Field, { initial: 1, tolerance: 0.05 }))
    const input = screen.getByLabelText('Amount') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '1.5' } })
    expect(input.value).toBe('1.5')
  })

  it('shows an outside change while focused, such as a stepper', () => {
    render(createElement(Field, { initial: 1, tolerance: 0.05 }))
    const input = screen.getByLabelText('Amount') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.click(screen.getByText('More'))
    expect(input.value).toBe('2')
  })

  it('tidies the text to the saved value on blur', () => {
    render(createElement(Field, { initial: 1, tolerance: 0.05 }))
    const input = screen.getByLabelText('Amount') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '1.5' } })
    fireEvent.blur(input)
    expect(input.value).toBe('1.52')
  })
})
