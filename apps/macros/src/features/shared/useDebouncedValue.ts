import { useEffect, useState } from 'react'

export function useDebouncedValue<T>(value: T, ms = 150): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return settled
}
