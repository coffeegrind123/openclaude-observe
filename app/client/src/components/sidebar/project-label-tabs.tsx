import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useUIStore } from '@/stores/ui-store'
import { ProjectList } from './project-list'
import { LabelList } from './label-list'
import { MemoryStoreList } from '@/components/memory/memory-store-list'

interface ProjectLabelTabsProps {
  collapsed: boolean
}

/**
 * Switcher between the Projects, Labels, and Memory views in the sidebar. In
 * collapsed (narrow) mode, tabs are hidden and the current view renders as
 * icon-only — tabs don't fit the narrow width cleanly. The Memory tab also
 * drives the top-level `view` (handled in setSidebarTab).
 */
export function ProjectLabelTabs({ collapsed }: ProjectLabelTabsProps) {
  const sidebarTab = useUIStore((s) => s.sidebarTab)
  const setSidebarTab = useUIStore((s) => s.setSidebarTab)

  if (collapsed) {
    // Narrow sidebar: render whichever view is active, without the tab strip.
    if (sidebarTab === 'memory') return <MemoryStoreList collapsed />
    if (sidebarTab === 'labels') return <LabelList collapsed />
    return <ProjectList collapsed />
  }

  return (
    <Tabs
      value={sidebarTab}
      onValueChange={(v) => setSidebarTab(v as 'projects' | 'labels' | 'memory')}
      className="flex flex-col"
    >
      <TabsList className="w-full mt-2 h-7">
        <TabsTrigger value="projects" className="flex-1 text-xs">
          Projects
        </TabsTrigger>
        <TabsTrigger value="labels" className="flex-1 text-xs">
          Labels
        </TabsTrigger>
        <TabsTrigger value="memory" className="flex-1 text-xs">
          Memory
        </TabsTrigger>
      </TabsList>
      <TabsContent value="projects" className="mt-1">
        <ProjectList collapsed={false} />
      </TabsContent>
      <TabsContent value="labels" className="mt-1">
        <LabelList collapsed={false} />
      </TabsContent>
      <TabsContent value="memory" className="mt-1">
        <MemoryStoreList collapsed={false} />
      </TabsContent>
    </Tabs>
  )
}
