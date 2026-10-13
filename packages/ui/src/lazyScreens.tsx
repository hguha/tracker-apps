import { lazy, type ComponentType } from 'react'

export function createLazyScreens() {
  const preloads: (() => Promise<unknown>)[] = []

  function screen<P extends object>(load: () => Promise<ComponentType<P>>) {
    let loaded: ComponentType<P> | null = null
    const fetch = () => load().then((component) => (loaded = component))
    preloads.push(fetch)
    const Lazy = lazy(() => fetch().then((component) => ({ default: component })))
    return function Screen(props: P) {
      const Loaded = loaded
      return Loaded ? <Loaded {...props} /> : <Lazy {...props} />
    }
  }

  function preloadScreens() {
    const run = () =>
      preloads.forEach(
        (load) => void load().catch((error) => console.warn('[screens] preload failed', error)),
      )
    if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 2000 })
    else setTimeout(run, 500)
  }

  return { screen, preloadScreens }
}
