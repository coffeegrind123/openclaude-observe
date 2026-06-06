import { User, MessageSquare, FolderKanban, BookOpen, FlaskConical, Tag } from 'lucide-react'

const TYPE_ICON: Record<string, typeof User> = {
  user: User,
  feedback: MessageSquare,
  project: FolderKanban,
  reference: BookOpen,
  'structured-claim': FlaskConical,
}

/** Small icon for a memory `type`; falls back to a generic tag. */
export function MemoryTypeIcon({ type, className }: { type?: string; className?: string }) {
  const Icon = (type && TYPE_ICON[type]) || Tag
  return <Icon className={className ?? 'h-3 w-3'} />
}
