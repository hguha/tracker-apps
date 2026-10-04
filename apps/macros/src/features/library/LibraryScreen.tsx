import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Screen, SegmentedTabs, type SegmentedTab } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { CustomFoodPanel } from '@/features/log/CustomFoodPanel'
import { FoodsTab } from './FoodsTab'
import { RecipesScreen } from '@/features/recipes/RecipesScreen'

type Tab = 'recipes' | 'foods'

export function LibraryScreen({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('recipes')
  const [isAddingFood, setIsAddingFood] = useState(false)
  const recipes = useLiveQuery(() => repo.recipes(), [], [])

  const tabs: SegmentedTab<Tab>[] = [
    { key: 'recipes', label: 'Recipes', badge: (recipes ?? []).length || undefined },
    { key: 'foods', label: 'Foods' },
  ]

  if (tab === 'recipes') {
    return (
      <RecipesScreen
        onBack={onBack}
        header={<SegmentedTabs tabs={tabs} active={tab} onSelect={setTab} />}
      />
    )
  }

  if (isAddingFood) {
    return (
      <Screen title="Add a food" onBack={() => setIsAddingFood(false)}>
        <CustomFoodPanel initialName="" initialBarcode={null} onSaved={() => setIsAddingFood(false)} />
      </Screen>
    )
  }

  return (
    <Screen title="Your library" onBack={onBack}>
      <SegmentedTabs tabs={tabs} active={tab} onSelect={setTab} />
      <FoodsTab onAdd={() => setIsAddingFood(true)} />
    </Screen>
  )
}
