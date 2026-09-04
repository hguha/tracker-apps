import { useEffect, useState } from 'react'
import type { ColorScheme } from './appearance'

function readScheme(): ColorScheme {
  if (typeof document === 'undefined') return 'light'
  const applied = document.documentElement.dataset.scheme
  if (applied === 'light' || applied === 'dark') return applied
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readKey(): string {
  if (typeof document === 'undefined') return 'default:light'
  return `${document.documentElement.dataset.theme ?? 'default'}:${readScheme()}`
}

// The in-app toggle writes attributes on <html>, which no media query reports, so both
// sources have to be watched.
function useAppearanceObserver<T>(read: () => T): T {
  const [value, setValue] = useState<T>(read)

  useEffect(() => {
    const update = () => setValue(read())
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    query.addEventListener('change', update)
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-scheme', 'data-theme'],
    })
    return () => {
      query.removeEventListener('change', update)
      observer.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return value
}

export function useColorScheme(): ColorScheme {
  return useAppearanceObserver(readScheme)
}

/** Charts that render to canvas resolve tokens to hex, so their option objects must
 *  depend on this to repaint when the theme or scheme changes. */
export function useAppearanceKey(): string {
  return useAppearanceObserver(readKey)
}

/** Resolves a `var(--x)` reference to a concrete value; canvas can't read CSS vars. */
export function resolveColor(value: string): string {
  if (typeof document === 'undefined') return value
  if (!value.startsWith('var(')) return value
  const name = value.slice(4, -1).trim()
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || value
}
