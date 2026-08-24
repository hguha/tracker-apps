import { useEffect, useRef } from 'react'
import type { EChartsOption } from 'echarts'
import { echarts } from './echarts'
import { cn } from '@/lib/cn'

export function Chart({
  option,
  height = 240,
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
    const instance = echarts.init(container, undefined, { renderer: 'canvas' })
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
    // notMerge so a removed series actually disappears rather than lingering.
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
