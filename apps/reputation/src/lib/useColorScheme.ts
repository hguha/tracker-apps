// ECharts renders to canvas with resolved hex, not CSS vars, so chart option objects must depend on useAppearanceKey() to repaint on theme change.

import { useEffect, useState } from 'react'

export type ColorScheme = 'light' | 'dark'

function readScheme(): ColorScheme {
  if (typeof document === 'undefined') return 'light'
  const applied = document.documentElement.dataset.scheme
  if (applied === 'light' || applied === 'dark') return applied
  // Covers the first paint, before the profile has loaded.
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readKey(): string {
  if (typeof document === 'undefined') return 'default:light'
  return `${document.documentElement.dataset.theme ?? 'default'}:${readScheme()}`
}

function useAppearanceObserver<T>(read: () => T): T {
  const [value, setValue] = useState<T>(read)

  useEffect(() => {
    const update = () => setValue(read())

    const query = window.matchMedia('(prefers-color-scheme: dark)')
    query.addEventListener('change', update)

    // The in-app toggle writes these attributes on <html>; no media query reports that.
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-scheme', 'data-theme'],
    })

    return () => {
      query.removeEventListener('change', update)
      observer.disconnect()
    }
    // `read` is a stable module-level function in both callers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return value
}

export function useAppearanceKey(): string {
  return useAppearanceObserver(readKey)
}

export function useColorScheme(): ColorScheme {
  return useAppearanceObserver(readScheme)
}
