// ECharts renders to canvas with resolved hex, not CSS vars, so chart option objects
// must depend on useAppearanceKey() to repaint on a theme/scheme change. Mirrors
// REPutation's hook: one media-query + MutationObserver on <html>.

import { useEffect, useState } from 'react'

export type ColorScheme = 'light' | 'dark'

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
  }, [])

  return value
}

export function useAppearanceKey(): string {
  return useAppearanceObserver(readKey)
}

export function useColorScheme(): ColorScheme {
  return useAppearanceObserver(readScheme)
}

/** Resolves a CSS color to a concrete value (ECharts canvas can't read `var(--x)`). */
export function resolveColor(value: string): string {
  if (typeof document === 'undefined') return value
  if (value.startsWith('var(')) {
    const name = value.slice(4, -1).trim()
    return (
      getComputedStyle(document.documentElement).getPropertyValue(name).trim() || value
    )
  }
  return value
}

/** Resolved chart colors, read from the CSS tokens once per appearance change. */
export function useChartTokens(): Record<string, string> {
  useAppearanceKey() // re-run on theme/scheme change
  if (typeof document === 'undefined') return {}
  const style = getComputedStyle(document.documentElement)
  const read = (name: string) => style.getPropertyValue(name).trim()
  return {
    accent: read('--accent'),
    ink: read('--text-primary'),
    inkMuted: read('--text-muted'),
    gridline: read('--gridline'),
    axis: read('--axis'),
    pos: read('--div-pos'),
    neg: read('--div-neg'),
  }
}
