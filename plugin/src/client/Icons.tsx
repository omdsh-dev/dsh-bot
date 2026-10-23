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
export function AttachmentIcon() { return <Icon><path d="m5.5 9.5 5-5a1.8 1.8 0 0 1 2.5 2.5l-6.5 6.5a3.5 3.5 0 0 1-5-5L8 2a2.5 2.5 0 0 1 3.5 0" /></Icon> }
export function MicrophoneIcon() { return <Icon><rect x="5.5" y="1.5" width="5" height="8" rx="2.5" /><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2M5.5 14.5h5" /></Icon> }
export function ConnectionsIcon() { return <Icon><rect x="1.5" y="2" width="9" height="7" rx="2" /><path d="m4 9-1 3 4-3M10.5 5H12a2 2 0 0 1 2 2v4l-2-1H9" /></Icon> }
export function ControlsIcon() { return <Icon><path d="M2 4h3m3 0h6M2 12h6m3 0h3" /><circle cx="6.5" cy="4" r="1.5" /><circle cx="9.5" cy="12" r="1.5" /></Icon> }
