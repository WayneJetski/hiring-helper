/**
 * RatingStars
 *
 * Five SVG stars, `rating` of them filled. Renders an em-dash when unrated.
 */

import { Icon } from './Icon';

const MAX_STARS = 5;

export function RatingStars({ rating }: { rating?: number }): JSX.Element {
  if (!rating) return <span>—</span>;

  return (
    <span className="rating-star-row" role="img" aria-label={`${rating} out of ${MAX_STARS} stars`}>
      {Array.from({ length: MAX_STARS }, (_, index) => (
        <Icon key={index} name="star" size={16} isFilled={index < rating} />
      ))}
    </span>
  );
}
