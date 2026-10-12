import { useState } from 'react'

export function useBusy(): [boolean, (work: () => Promise<void>) => Promise<void>] {
  const [isBusy, setIsBusy] = useState(false)
  const run = async (work: () => Promise<void>) => {
    if (isBusy) return
    setIsBusy(true)
    try {
      await work()
    } finally {
      setIsBusy(false)
    }
  }
  return [isBusy, run]
}
