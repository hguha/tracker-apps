/**
 * The card every chart lives in.
 *
 * Owns two obligations from §10.5 so no individual chart can forget them:
 *   - A **table-view twin**, reachable from the card. Both an accessibility
 *     requirement and the relief for the three light-mode region colors measured
 *     below 3:1 contrast.
 *   - A **per-chart empty state** that says what's missing, rather than an empty
 *     axis that looks broken.
 */

import { useState, type ReactNode } from 'react'
import { Table2 } from 'lucide-react'
import { Card } from '@/components/Card'
import { cn } from '@/lib/cn'

export interface TableData {
  columns: string[]
  rows: (string | number)[][]
}

export function ChartCard({
  title,
  subtitle,
  children,
  table,
  /** Rendered instead of the chart when there isn't enough data yet. */
  emptyMessage,
  isEmpty = false,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  table: TableData
  emptyMessage?: string
  isEmpty?: boolean
}) {
  const [isTable, setIsTable] = useState(false)

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-2 px-4 pt-3.5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="text-[12.5px] text-ink-muted">{subtitle}</p>}
        </div>
        {!isEmpty && (
          <button
            onClick={() => setIsTable((current) => !current)}
            aria-label={isTable ? 'Show chart' : 'Show table'}
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-lg',
              isTable ? 'bg-accent-wash text-accent' : 'text-ink-muted active:bg-sunken',
            )}
          >
            <Table2 size={16} />
          </button>
        )}
      </div>

      <div className="px-2 pb-2 pt-1">
        {isEmpty ? (
          <p className="px-2 py-8 text-center text-[13.5px] text-ink-muted">
            {emptyMessage ?? 'Not enough data yet.'}
          </p>
        ) : isTable ? (
          <TableView table={table} />
        ) : (
          children
        )}
      </div>
    </Card>
  )
}

function TableView({ table }: { table: TableData }) {
  return (
    <div className="max-h-72 overflow-auto px-2">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-line">
            {table.columns.map((column, index) => (
              <th
                key={column}
                className={cn(
                  'py-1.5 font-semibold text-ink-muted',
                  index === 0 ? 'text-left' : 'text-right',
                )}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular">
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-line last:border-0">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={cn(
                    'py-1.5 text-ink-secondary',
                    cellIndex === 0 ? 'text-left' : 'text-right',
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.rows.length === 0 && (
        <p className="py-6 text-center text-[13px] text-ink-muted">No rows in range.</p>
      )}
    </div>
  )
}
