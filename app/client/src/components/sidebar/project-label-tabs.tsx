import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useUIStore } from '@/stores/ui-store'
import { ProjectList } from './project-list'
import { LabelList } from './label-list'
import { InstructionsStoreList } from '@/components/instructions/instructions-store-list'

interface ProjectLabelTabsProps {
  collapsed: boolean
}

/**
 * Switcher between the Projects, Labels, and Instructions views in the sidebar. In
 * collapsed (narrow) mode, tabs are hidden and the current view renders as
 * icon-only — tabs don't fit the narrow width cleanly. The Instructions tab also
 * drives the top-level `view` (handled in setSidebarTab).
 */
export function ProjectLabelTabs({ collapsed }: ProjectLabelTabsProps) {
  const sidebarTab = useUIStore((s) => s.sidebarTab)
  const setSidebarTab = useUIStore((s) => s.setSidebarTab)

  if (collapsed) {
    // Narrow sidebar: render whichever view is active, without the tab strip.
    if (sidebarTab === 'instructions') return <InstructionsStoreList collapsed />
    if (sidebarTab === 'labels') return <LabelList collapsed />
    return <ProjectList collapsed />
  }

  return (
    <Tabs
      value={sidebarTab}
      onValueChange={(v) => setSidebarTab(v as 'projects' | 'labels' | 'instructions')}
      className="flex flex-col"
    >
      <TabsList className="w-full mt-2 h-7">
        <TabsTrigger value="projects" className="flex-1 text-xs">
          Projects
        </TabsTrigger>
        <TabsTrigger value="labels" className="flex-1 text-xs">
          Labels
        </TabsTrigger>
        <TabsTrigger value="instructions" className="flex-1 text-xs">
          Instructions
        </TabsTrigger>
      </TabsList>
      <TabsContent value="projects" className="mt-1">
        <ProjectList collapsed={false} />
      </TabsContent>
      <TabsContent value="labels" className="mt-1">
        <LabelList collapsed={false} />
      </TabsContent>
      <TabsContent value="instructions" className="mt-1">
        <InstructionsStoreList collapsed={false} />
      </TabsContent>
    </Tabs>
  )
}
