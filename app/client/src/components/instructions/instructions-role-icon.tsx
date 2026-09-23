import { BookOpen, Bot, ScrollText, ListPlus } from 'lucide-react'
import type { InstructionsFileRole } from '@/types/instructions'

const ROLE_ICON: Record<InstructionsFileRole, typeof BookOpen> = {
  context: BookOpen,
  system: ScrollText,
  'append-system': ListPlus,
  agent: Bot,
}

/** Small icon for what a file is to pi. */
export function InstructionsRoleIcon({
  role,
  className,
}: {
  role: InstructionsFileRole
  className?: string
}) {
  const Icon = ROLE_ICON[role]
  return <Icon className={className ?? 'h-3 w-3'} />
}
