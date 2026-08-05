/**
 * Tracks the applied appearance.
 *
 * Charts need this because ECharts renders to canvas with resolved hex values,
 * not CSS variables — so unlike the rest of the UI, a chart does not repaint
 * itself when the theme changes. Anything calling `resolveToken` must depend on
 * `useAppearanceKey()` so its option object is rebuilt.
 *
 * The key covers the theme as well as light/dark, because chart chrome (surface,
 * gridline, ink, accent) is themed even though series colors are not.
 */

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

/** Subscribes to appearance changes and returns a value that changes with them. */
function useAppearanceObserver<T>(read: () => T): T {
  const [value, setValue] = useState<T>(read)

  useEffect(() => {
    const update = () => setValue(read())

    const query = window.matchMedia('(prefers-color-scheme: dark)')
    query.addEventListener('change', update)

    // The in-app toggle writes these attributes on <html>; no media query
    // reports that, so watch them directly.
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

/** `"forest:dark"` — a dependency that changes on any appearance change. */
export function useAppearanceKey(): string {
  return useAppearanceObserver(readKey)
}

export function useColorScheme(): ColorScheme {
  return useAppearanceObserver(readScheme)
}
