import { useRef, useState } from 'react'

export function useBusy(): [boolean, (work: () => Promise<void>) => Promise<void>] {
  const [isBusy, setIsBusy] = useState(false)
  const isRunning = useRef(false)
  const run = async (work: () => Promise<void>) => {
    if (isRunning.current) return
    isRunning.current = true
    setIsBusy(true)
    try {
      await work()
    } finally {
      isRunning.current = false
      setIsBusy(false)
    }
  }
  return [isBusy, run]
}
