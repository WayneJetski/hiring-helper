/**
 * HelpTip
 *
 * A small "?" that explains a term in plain language. Works on hover and on
 * keyboard focus, and exposes the text to screen readers.
 */

import { Icon } from './icons/Icon';
import './HelpTip.css';

interface HelpTipProps {
  text: string;
}

export function HelpTip({ text }: HelpTipProps): JSX.Element {
  return (
    <span className="help-tip" tabIndex={0} aria-label={text}>
      <Icon name="helpCircle" size={14} />
      <span className="help-tip-bubble" role="tooltip">
        {text}
      </span>
    </span>
  );
}
