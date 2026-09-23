import { useId } from 'react'
import { cn } from '@/lib/utils'

/**
 * instantcoffee mark: a steaming cup. Same drawing as public/favicon.svg. The
 * gradient id is per-instance (useId) so several marks on one page don't
 * collide on the <defs> gradient.
 */
export function BrandMark({ className }: { className?: string }) {
  const id = useId()
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      className={cn('shrink-0', className)}
      aria-label="instantcoffee"
      role="img"
    >
      <defs>
        <linearGradient id={id} x1="18" y1="10" x2="82" y2="92" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f0b27a" />
          <stop offset="0.5" stopColor="#c7753a" />
          <stop offset="1" stopColor="#8a4a22" />
        </linearGradient>
      </defs>
      <g stroke={`url(#${id})`} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M34 30c-5-6 5-10 0-17" />
        <path d="M47 30c-5-6 5-10 0-17" />
        <path d="M60 30c-5-6 5-10 0-17" />
        <path d="M18 42h58v16a24 24 0 0 1-24 24h-10a24 24 0 0 1-24-24z" />
        <path d="M76 47h5a10 10 0 0 1 0 20h-7" />
        <path d="M14 92h70" />
      </g>
    </svg>
  )
}
