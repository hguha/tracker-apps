/**
 * The single ECharts wrapper (§10.7).
 *
 * Owns three things every chart would otherwise get wrong: setOption on change,
 * resize observation, and disposal on unmount. FitNoter leaked a Chart instance
 * per render because none of that was centralized.
 *
 * ECharts is imported through a tree-shaken barrel (`echarts.ts`) so the bundle
 * carries only the chart types actually used.
 */

import { useEffect, useRef } from 'react'
import type { EChartsOption } from 'echarts'
import { echarts } from './echarts'
import { cn } from '@/lib/cn'

export function Chart({
  option,
  height = 220,
  className,
  ariaLabel,
}: {
  option: EChartsOption
  height?: number
  className?: string
  ariaLabel: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<ReturnType<typeof echarts.init> | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const instance = echarts.init(container, undefined, {
      renderer: 'canvas', // a few hundred points stays smooth on a phone
    })
    instanceRef.current = instance

    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(container)

    return () => {
      observer.disconnect()
      instance.dispose()
      instanceRef.current = null
    }
  }, [])

  useEffect(() => {
    // `notMerge` so removing a series actually removes it rather than leaving
    // a stale one behind from the previous option.
    instanceRef.current?.setOption(option, { notMerge: true })
  }, [option])

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      style={{ height }}
      className={cn('w-full', className)}
    />
  )
}
