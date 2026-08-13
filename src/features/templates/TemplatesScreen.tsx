import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, Dumbbell, MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import * as repo from '@/data/repository'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { useToast } from '@/components/Toast'
import { formatRelativeDay } from '@/lib/dates'
import { TemplatePreviewSheet } from './TemplatePreviewSheet'

export function TemplatesScreen({
  onEditTemplate,
  onStartWorkout,
  onBack,
}: {
  onEditTemplate: (templateId: string) => void
  onStartWorkout: (workoutId: string) => void
  onBack: () => void
}) {
  const toast = useToast()
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [previewFor, setPreviewFor] = useState<string | null>(null)

  const data = useLiveQuery(async () => {
    const templates = await repo.listTemplates()
    const withCounts = await Promise.all(
      templates.map(async (template) => ({
        template,
        exerciseCount: (await repo.listTemplateExercises(template.id)).length,
      })),
    )
    return withCounts
  }, [])

  async function createAndEdit() {
    const id = await repo.createTemplate('New template')
    onEditTemplate(id)
  }

  const templates = data ?? []

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-1 border-b border-line bg-surface px-2 py-2 pt-safe">
        <button
          onClick={onBack}
          aria-label="Back"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken"
        >
          <ChevronLeft size={22} />
        </button>
        <h1 className="flex-1 text-[16px] font-semibold tracking-tight">Templates</h1>
        <button
          onClick={() => void createAndEdit()}
          aria-label="New template"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-accent active:bg-accent-wash"
        >
          <Plus size={22} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {data && data.length === 0 && (
          <div className="mt-16 px-6 text-center">
            <Dumbbell size={26} className="mx-auto text-ink-muted" />
            <p className="mt-3 text-[16px] font-semibold">No templates yet</p>
            <p className="mt-1 text-[14px] text-ink-muted">
              Build a reusable plan, or save one from a finished workout.
            </p>
            <Button className="mt-4" onClick={() => void createAndEdit()}>
              <Plus size={18} />
              New template
            </Button>
          </div>
        )}

        {templates.length > 0 && (
          <Card className="overflow-visible">
            {templates.map(({ template, exerciseCount }, index) => (
              <div
                key={template.id}
                className={
                  'relative flex items-center ' +
                  (index > 0 ? 'border-t border-line' : '')
                }
              >
                <button
                  onClick={() => setPreviewFor(template.id)}
                  className="min-w-0 flex-1 px-4 py-3.5 text-left transition-transform duration-75 active:scale-[0.99] active:bg-accent-wash"
                >
                  <span className="block truncate text-[15px] font-semibold">
                    {template.name}
                  </span>
                  <span className="block text-[12.5px] text-ink-muted">
                    {exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'}
                    {template.lastUsedAt !== null &&
                      ` · last used ${formatRelativeDay(template.lastUsedAt)}`}
                  </span>
                </button>
                <button
                  onClick={() => setMenuFor(menuFor === template.id ? null : template.id)}
                  aria-label={`Options for ${template.name}`}
                  className="mr-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
                >
                  <MoreVertical size={18} />
                </button>

                {menuFor === template.id && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setMenuFor(null)}
                    />
                    <div className="absolute right-2 top-12 z-50 w-48 overflow-hidden rounded-xl border border-line-strong bg-surface shadow-xl">
                      <RowItem
                        icon={<Pencil size={15} />}
                        label="Edit template"
                        onClick={() => {
                          setMenuFor(null)
                          onEditTemplate(template.id)
                        }}
                      />
                      <RowItem
                        icon={<Trash2 size={15} />}
                        label="Delete"
                        destructive
                        onClick={() => {
                          setMenuFor(null)
                          void repo.deleteTemplate(template.id)
                          toast.show(
                            'Template deleted',
                            () => void repo.restoreTemplate(template.id),
                          )
                        }}
                      />
                    </div>
                  </>
                )}
              </div>
            ))}
          </Card>
        )}
      </div>

      {previewFor && (
        <TemplatePreviewSheet
          templateId={previewFor}
          onStart={(workoutId) => {
            setPreviewFor(null)
            onStartWorkout(workoutId)
          }}
          onEdit={() => {
            const id = previewFor
            setPreviewFor(null)
            onEditTemplate(id)
          }}
          onDismiss={() => setPreviewFor(null)}
        />
      )}
    </div>
  )
}

function RowItem({
  icon,
  label,
  onClick,
  destructive = false,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={
        'flex w-full items-center gap-2.5 border-b border-line px-3.5 py-3 text-left text-[14px] font-medium last:border-0 active:bg-accent-wash ' +
        (destructive ? 'text-critical' : '')
      }
    >
      <span className="shrink-0 text-ink-muted">{icon}</span>
      {label}
    </button>
  )
}
