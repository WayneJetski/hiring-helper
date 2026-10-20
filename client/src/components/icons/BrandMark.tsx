/**
 * BrandMark
 *
 * The app's own logo mark: a rounded deep-green tile holding a check-in-a-person
 * glyph, with a gold accent dot. Original artwork in the app's brand palette.
 */

interface BrandMarkProps {
  size?: number;
}

export function BrandMark({ size = 36 }: BrandMarkProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label="Hiring Helper"
      focusable="false"
    >
      <rect width="40" height="40" rx="10" fill="#143226" />
      <rect x="0.75" y="0.75" width="38.5" height="38.5" rx="9.25" fill="none" stroke="#ffffff" strokeOpacity="0.14" strokeWidth="1.5" />
      <circle cx="17" cy="14" r="5" fill="#ffffff" />
      <path d="M7 31c0-5.5 4.5-9 10-9s10 3.5 10 9" fill="#ffffff" />
      <circle cx="29.5" cy="26.5" r="6.5" fill="#f2b84b" />
      <path d="M26.4 26.6l2.2 2.2 4-4.6" fill="none" stroke="#1f4d3a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
