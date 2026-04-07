import { lazy, Suspense } from 'react'
import dynamicIconImports from 'lucide-react/dynamicIconImports'
import type { LucideProps } from 'lucide-react'

type IconName = keyof typeof dynamicIconImports

/** All available icon names (kebab-case), sorted */
export const ALL_ICON_NAMES: IconName[] = (Object.keys(dynamicIconImports) as IconName[]).sort()

/** Check if a kebab-case icon name exists */
export function isValidIconName(name: string): name is IconName {
  return name in dynamicIconImports
}

/** Convert PascalCase to kebab-case: "CircleCheck" -> "circle-check" */
export function toKebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
}

/** Convert kebab-case to PascalCase: "circle-check" -> "CircleCheck" */
export function toPascalCase(name: string): string {
  return name
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
}

/** Resolve an icon name (PascalCase or kebab-case) to a valid kebab-case key */
export function resolveIconName(name: string): IconName | null {
  if (isValidIconName(name)) return name
  const kebab = toKebabCase(name)
  if (isValidIconName(kebab)) return kebab
  return null
}

interface DynamicIconProps extends LucideProps {
  /** Icon name in kebab-case (e.g., "circle-check") */
  name: string
}

/**
 * Renders a lucide icon by name using dynamic imports.
 * Each icon is loaded as its own chunk on demand.
 */
export function DynamicIcon({ name, ...props }: DynamicIconProps) {
  const resolved = resolveIconName(name)
  if (!resolved) return null

  const IconComponent = lazy(dynamicIconImports[resolved])
  return (
    <Suspense fallback={<div style={{ width: props.size || 24, height: props.size || 24 }} />}>
      <IconComponent {...props} />
    </Suspense>
  )
}
