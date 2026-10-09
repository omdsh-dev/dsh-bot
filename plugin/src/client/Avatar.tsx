/** Stable, decorative Bot portraits shared by the roster, transcript, and picker. */
import clsx from 'clsx'
import css from './Panel.module.css'

/**
 * Draw a geometric face without adding a network image dependency.
 * @param props - Stable identity and optional size treatment.
 * @returns A decorative portrait; the adjacent Bot name supplies its accessible label.
 */
export function Avatar({ id, large = false, small = false }: { id: string; large?: boolean; small?: boolean }) {
  const hash = Array.from(id).reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619), 2166136261)
  const variant = (hash >>> 28) % 4
  return <span className={clsx(css.avatar, large && css.avatarLarge, small && css.avatarSmall)} data-variant={variant} aria-hidden="true">
    <svg viewBox="0 0 48 48" fill="none">
      {variant === 0 ? <rect x="8" y="9" width="32" height="31" rx="12" fill="currentColor" />
        : variant === 1 ? <path d="M24 6 43 22 33 41H15L5 22Z" fill="currentColor" />
          : variant === 2 ? <path d="M12 16C7 5 24 3 26 13c10-9 22 7 12 13 8 10-9 20-15 11-10 8-22-8-13-14Z" fill="currentColor" />
            : <circle cx="24" cy="24" r="17" fill="currentColor" />}
      <g className={css.face} stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <path d={variant === 1 ? 'M18 23v3m12-3v3' : 'M18 21v4m12-4v4'} />
        <path d="M21 31q3 2 6 0" strokeWidth="1.8" />
      </g>
    </svg>
  </span>
}
