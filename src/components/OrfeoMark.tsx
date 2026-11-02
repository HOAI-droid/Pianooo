// ── Pianooo logo mark (three piano keys) — shared component ──────────────────
// Same box as the original mark (viewBox 0 0 133.39 150, aspect ≈ 0.889), so
// every place that sizes it by height keeps its layout.
import { useId } from 'react'

export default function OrfeoMark({ height, style }: { height: number; style?: React.CSSProperties }) {
  const mask = useId()
  return (
    <svg
      width={Math.round(height * 133.39 / 150)}
      height={height}
      viewBox="0 0 133.39 150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
    >
      <defs>
        <mask id={mask}>
          <rect x="0" y="0" width="133.39" height="150" fill="#fff" />
          {/* gaps between the white keys, and an outline around each black key */}
          <rect x="38.5" y="0" width="9" height="150" fill="#000" />
          <rect x="85.9" y="0" width="9" height="150" fill="#000" />
          <rect x="22" y="-10" width="42" height="104" rx="9" fill="#000" />
          <rect x="69.4" y="-10" width="42" height="104" rx="9" fill="#000" />
        </mask>
      </defs>
      <rect x="0" y="0" width="133.39" height="150" rx="14" fill="var(--text-amber)" mask={`url(#${mask})`} />
      <rect x="29" y="0" width="28" height="86" rx="6" fill="var(--text-amber)" />
      <rect x="76.4" y="0" width="28" height="86" rx="6" fill="var(--text-amber)" />
    </svg>
  )
}
