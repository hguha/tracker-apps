import { useEffect, useRef } from 'react'
import { useToast } from '@tracker-engine/ui'

export function useTransitionToast<T>(
  auth: { transition: T | null; clearTransition(): void },
  message: (transition: T) => string,
): void {
  const toast = useToast()
  const describe = useRef(message)
  describe.current = message
  const { transition, clearTransition } = auth

  useEffect(() => {
    if (transition === null) return
    toast.show(describe.current(transition))
    clearTransition()
  }, [transition, clearTransition, toast])
}
