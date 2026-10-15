/** Plugin-owned icons avoid coupling to DSH's versioned icon export names. */
import type { ReactNode } from 'react'

function Icon({ children }: { children: ReactNode }) {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
}
export function CloseIcon() { return <Icon><path d="m4 4 8 8M12 4l-8 8" /></Icon> }
export function PlusIcon() { return <Icon><path d="M8 3v10M3 8h10" /></Icon> }
export function SearchIcon() { return <Icon><circle cx="6.8" cy="6.8" r="4.3" /><path d="m10 10 3.5 3.5" /></Icon> }
export function SidebarIcon() { return <Icon><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M6 2.5v11" /></Icon> }
export function SendIcon() { return <Icon><path d="M8 13V3m-4 4 4-4 4 4" /></Icon> }
