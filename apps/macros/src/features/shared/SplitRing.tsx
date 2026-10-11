export function SplitRing({
  before,
  adding,
  max,
  size = 84,
  strokeWidth = 10,
  children,
}: {
  before: number
  adding: number
  max: number
  size?: number
  strokeWidth?: number
  children?: React.ReactNode
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const share = (value: number) => (max > 0 ? Math.max(0, Math.min(1, value / max)) : 0)
  const base = share(before)
  const extra = Math.min(1 - base, share(adding))
  const isOver = before + adding > max
  const arc = (fraction: number, offset: number, stroke: string) => (
    <circle
      cx={size / 2}
      cy={size / 2}
      r={radius}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="butt"
      strokeDasharray={`${fraction * circumference} ${circumference}`}
      strokeDashoffset={-offset * circumference}
      className="transition-[stroke-dasharray,stroke-dashoffset] duration-300"
    />
  )

  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-page)"
          strokeWidth={strokeWidth}
        />
        {base > 0 &&
          arc(
            base,
            0,
            before > max
              ? 'color-mix(in srgb, var(--target-over) 45%, transparent)'
              : 'color-mix(in srgb, var(--accent) 32%, transparent)',
          )}
        {extra > 0 && arc(extra, base, isOver ? 'var(--target-over)' : 'var(--accent)')}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  )
}
