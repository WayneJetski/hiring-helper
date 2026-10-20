/**
 * ConnectionBadge
 *
 * The top bar's BambooHR indicator: a green dot when the saved credentials work,
 * red when they do not (or the computer is offline), neutral while checking. The
 * wording changes with the state too, so it never depends on color alone. Opens
 * the connection settings.
 */

import { Link } from 'react-router-dom';
import { useBambooHRConnection } from '../hooks/useBambooHRConnection';
import { describeConnection } from '../utils/connectionStatus';

export function ConnectionBadge({ subdomain }: { subdomain: string }): JSX.Element {
  const status = useBambooHRConnection();
  const label = describeConnection(status, subdomain);

  return (
    <Link to="/setup" className="nav-badge" title={`${status.message} Click for connection settings.`}>
      <span className={`connection-dot is-${status.state}`} aria-hidden="true" />
      <span role="status">{label}</span>
    </Link>
  );
}
