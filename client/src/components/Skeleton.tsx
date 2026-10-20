/**
 * Skeleton
 *
 * Placeholder shapes shown while data loads, laid out like the real page so the
 * screen does not jump when content arrives. The shimmer is switched off for
 * people who ask for reduced motion (see Skeleton.css).
 */

import type { CSSProperties } from 'react';
import './Skeleton.css';

interface SkeletonProps {
  /** Any CSS size: a number is pixels. Defaults to the full width of its container. */
  width?: number | string;
  height?: number | string;
  /** Fully rounded (for badges and pills). */
  isPill?: boolean;
  /** Light-on-dark colors, for placeholders sitting on the dark header band. */
  isOnDark?: boolean;
  className?: string;
}

export function Skeleton({
  width = '100%',
  height = '1rem',
  isPill = false,
  isOnDark = false,
  className = '',
}: SkeletonProps): JSX.Element {
  const style: CSSProperties = { width, height };
  const classes = ['skeleton', isPill ? 'skeleton--pill' : '', isOnDark ? 'skeleton--on-dark' : '', className]
    .filter(Boolean)
    .join(' ');
  return <span className={classes} style={style} aria-hidden="true" />;
}

/** Several lines of text; the last one is shorter, like a paragraph's last line. */
export function SkeletonLines({ count, height = '0.9rem' }: { count: number; height?: string }): JSX.Element {
  return (
    <span className="skeleton-lines" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} height={height} width={index === count - 1 && count > 1 ? '62%' : '100%'} />
      ))}
    </span>
  );
}
