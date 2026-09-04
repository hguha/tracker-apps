import { ErrorBoundary as BaseErrorBoundary } from '@tracker-engine/ui'
import type { ReactNode } from 'react'
import { clearLocalData } from '@/data/repository'
import { reportError } from '@/backend/errorReporter'

export function ErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <BaseErrorBoundary
      onError={(error) => void reportError('error-boundary', error)}
      onClearLocalData={clearLocalData}
    >
      {children}
    </BaseErrorBoundary>
  )
}
