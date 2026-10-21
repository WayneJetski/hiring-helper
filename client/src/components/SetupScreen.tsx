/**
 * SetupScreen
 *
 * First-run (and "change connection") screen: enter the BambooHR subdomain and
 * API key, test them, and save. Also shows whether Claude Code (used for
 * scoring) is installed. Shown automatically while BambooHR is not connected.
 */

import { useState, useCallback, useEffect } from 'react';
import { apiService } from '../services/api.service';
import type { BambooHRConnection, ConnectionResult, SetupStatus } from '../types/applicant.types';
import { formatTimeAgo } from '../utils/relativeTime';
import { Icon } from './icons/Icon';
import { StatusIcon } from './icons/StatusIcon';
import './SetupScreen.css';

/** Same shape the server accepts for a BambooHR company address. */
const SUBDOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;

interface SetupScreenProps {
  status: SetupStatus | null;
  /** Called after the credentials were saved so the app can reload its status. */
  onConnected: () => void;
  /** Reload the setup status (used while a Claude sign-in is open, and after it starts). */
  onRefreshStatus: () => void;
  /** Present when reached voluntarily (not first run), to leave without changing anything. */
  onCancel?: () => void;
}

export function SetupScreen({
  status,
  onConnected,
  onRefreshStatus,
  onCancel,
}: SetupScreenProps): JSX.Element {
  const [useSso, setUseSso] = useState<boolean>(false);
  const [signInError, setSignInError] = useState<string>('');
  const [subdomain, setSubdomain] = useState<string>(status?.bambooHR.subdomain ?? '');
  const [apiKey, setApiKey] = useState<string>('');
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [result, setResult] = useState<ConnectionResult | null>(null);

  // While a Claude sign-in is open in the browser, check back until it finishes.
  const isSigningIn = status?.claude.isSigningIn === true;
  useEffect(() => {
    if (!isSigningIn) return undefined;
    const timer = setInterval(onRefreshStatus, 2000);
    return () => clearInterval(timer);
  }, [isSigningIn, onRefreshStatus]);

  const handleStartSignIn = async (): Promise<void> => {
    setSignInError('');
    try {
      await apiService.startClaudeSignIn(useSso);
      onRefreshStatus();
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : 'Could not start the sign-in.');
    }
  };

  const handleCancelSignIn = async (): Promise<void> => {
    try {
      await apiService.cancelClaudeSignIn();
    } finally {
      onRefreshStatus();
    }
  };

  // When a key is already saved, test it on open (the server caches this for a
  // minute) so the screen shows whether it really works.
  const isConfigured = status?.bambooHR.configured === true;
  const [connection, setConnection] = useState<BambooHRConnection | null>(null);
  const [connectionError, setConnectionError] = useState<string>('');
  const [isChangingKey, setIsChangingKey] = useState<boolean>(false);
  // Bumped by "Check again" to re-run the saved-connection check.
  const [connectionCheckCount, setConnectionCheckCount] = useState<number>(0);

  useEffect(() => {
    if (!isConfigured) return;
    let isStale = false;
    apiService
      .getBambooHRConnection()
      .then((checked) => {
        if (!isStale) setConnection(checked);
      })
      .catch((err) => {
        if (!isStale) {
          setConnectionError(err instanceof Error ? err.message : 'Could not check the connection.');
        }
      });
    return () => {
      isStale = true;
    };
  }, [isConfigured, connectionCheckCount]);

  const handleCheckAgain = (): void => {
    setConnection(null);
    setConnectionError('');
    setConnectionCheckCount((count) => count + 1);
  };

  const isChecking = isConfigured && connection === null && connectionError === '';
  const isWorking = connection?.ok === true;
  // BambooHR being down or unreachable says nothing about the saved key.
  const isTemporaryFailure = connection?.isTemporaryFailure === true;
  // Hide the form while a key is saved and not known to be bad, until the user asks to change it.
  const isFormVisible = !isConfigured || isChangingKey || (!isWorking && !isTemporaryFailure);
  const showConnectionCard = isConfigured;

  const run = useCallback(
    async (action: 'test' | 'save'): Promise<void> => {
      setIsBusy(true);
      setResult(null);
      try {
        const outcome =
          action === 'test'
            ? await apiService.testBambooHR(apiKey.trim(), subdomain.trim())
            : await apiService.saveBambooHR(apiKey.trim(), subdomain.trim());
        setResult(outcome);
        if (action === 'save' && outcome.ok) onConnected();
      } catch (err) {
        setResult({
          ok: false,
          message: err instanceof Error ? err.message : 'Something went wrong. Please try again.',
        });
      } finally {
        setIsBusy(false);
      }
    },
    [apiKey, subdomain, onConnected]
  );

  // Link straight to the API keys page of the company entered above, but only
  // once it looks like a real address (never build a URL from arbitrary text).
  const trimmedSubdomain = subdomain.trim();
  const apiKeysUrl = SUBDOMAIN_PATTERN.test(trimmedSubdomain)
    ? `https://${trimmedSubdomain}.bamboohr.com/app/settings/permissions/api_keys`
    : null;

  const canSubmit = subdomain.trim() !== '' && apiKey.trim() !== '' && !isBusy;

  return (
    <div className="setup-screen">
      <h1>Hiring Helper - Setup</h1>

      <section className="setup-section setup-bamboo" aria-label="BambooHR connection">
      <h2>BambooHR Connection</h2>

      {showConnectionCard && (
        <div
          className={`setup-connection ${
            isChecking ? 'checking' : isWorking ? 'ok' : isTemporaryFailure ? 'warning' : 'problem'
          }`}
          role="status"
        >
          {isChecking ? (
            <p className="setup-connection-line">
              <Icon name="loader" isSpinning /> Checking your saved BambooHR connection…
            </p>
          ) : isWorking ? (
            <>
              <p className="setup-connection-line">
                <Icon name="checkCircle" /> Connected to{' '}
                <strong>{connection?.subdomain}.bamboohr.com</strong>
              </p>
              <p className="setup-hint">
                Your saved API key works.
                {connection?.checkedAt && ` Checked ${formatTimeAgo(new Date(connection.checkedAt))}.`}
              </p>
              {!isChangingKey && (
                <button type="button" className="setup-secondary" onClick={() => setIsChangingKey(true)}>
                  Modify connection
                </button>
              )}
            </>
          ) : isTemporaryFailure ? (
            <>
              <p className="setup-connection-line">
                <Icon name="alertTriangle" /> Could not check your BambooHR connection right now.
              </p>
              <p className="setup-hint">
                {connection?.message} Your saved API key has not been changed or removed.
              </p>
              <button type="button" className="setup-secondary" onClick={handleCheckAgain}>
                Check again
              </button>
              {!isChangingKey && (
                <button type="button" className="setup-secondary" onClick={() => setIsChangingKey(true)}>
                  Modify connection
                </button>
              )}
            </>
          ) : (
            <>
              <p className="setup-connection-line">
                <Icon name="alertTriangle" /> Your saved key could not connect
                {status?.bambooHR.subdomain ? ` to ${status.bambooHR.subdomain}.bamboohr.com` : ''}.
              </p>
              <p className="setup-hint">
                {connection?.message ?? connectionError} Enter a new key below to fix it.
              </p>
            </>
          )}
        </div>
      )}

      {isFormVisible && (
      <>
      {!isConfigured && (
        <p className="setup-lead">
          Hiring Helper reads your applicants from BambooHR. Enter your company address and an API
          key once; they are saved on this computer only.
        </p>
      )}

      <ol className="setup-steps">
        <li>In BambooHR, open the menu under your name and choose <strong>API Keys</strong>.</li>
        <li>Add a new key (any name, for example &ldquo;Hiring Helper&rdquo;) and copy it.</li>
        <li>
          The key must belong to a user who can see Hiring. If you can open the Hiring page in
          BambooHR, you are fine.
        </li>
      </ol>

      <form
        className="setup-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) void run('save');
        }}
      >
        <label htmlFor="setup-subdomain">Company address</label>
        <div className="setup-subdomain-row">
          <input
            id="setup-subdomain"
            type="text"
            value={subdomain}
            onChange={(event) => setSubdomain(event.target.value)}
            placeholder="yourcompany"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <span className="setup-suffix">.bamboohr.com</span>
        </div>
        <p className="setup-hint">Just the part before .bamboohr.com in your BambooHR web address.</p>

        <div className="setup-label-row">
          <label htmlFor="setup-api-key">{isConfigured ? 'New API key' : 'API key'}</label>
          {apiKeysUrl && (
            <a
              className="setup-helper-link"
              href={apiKeysUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Create API key <Icon name="externalLink" />
            </a>
          )}
        </div>
        <input
          id="setup-api-key"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={isConfigured ? 'Paste the new API key' : 'Paste your API key'}
          autoComplete="off"
          spellCheck={false}
        />

        <div className="setup-buttons">
          <button type="button" className="setup-secondary" onClick={() => void run('test')} disabled={!canSubmit}>
            {isBusy ? 'Checking…' : 'Test connection'}
          </button>
          <button type="submit" className="setup-primary" disabled={!canSubmit}>
            Save and connect
          </button>
          {(isWorking || isTemporaryFailure || onCancel) && (
            <button
              type="button"
              className="setup-link"
              onClick={() => (isWorking || isTemporaryFailure ? setIsChangingKey(false) : onCancel?.())}
            >
              Cancel
            </button>
          )}
        </div>

        {result && (
          <div className={`setup-result ${result.ok ? 'success' : 'error'}`} role="alert">
            <StatusIcon tone={result.ok ? 'success' : 'error'} />
            <span>{result.message}</span>
          </div>
        )}
      </form>
      </>
      )}
      </section>

      <section className="setup-section setup-claude" aria-label="Claude Code status">
        <h2>Scoring (Claude Code)</h2>
        {status === null ? (
          <p className="setup-hint">Checking…</p>
        ) : status.claude.installed ? (
          <>
            <p className="setup-claude-ok">
              <Icon name="checkCircle" /> Claude Code {status.claude.version} is installed.
            </p>
            {status.claude.isSigningIn ? (
              <div className="setup-claude-signin">
                <p>
                  <Icon name="loader" isSpinning /> Finish signing in in the browser window that just
                  opened. This page updates by itself.
                </p>
                <button type="button" className="setup-secondary" onClick={() => void handleCancelSignIn()}>
                  Cancel
                </button>
              </div>
            ) : status.claude.signedIn === true ? (
              <p className="setup-claude-ok">
                <Icon name="checkCircle" /> Signed in to Claude
                {status.claude.account ? ` as ${status.claude.account}` : ''}.
              </p>
            ) : status.claude.signedIn === false ? (
              <div className="setup-claude-signin">
                <p className="setup-claude-missing">
                  <Icon name="alertTriangle" /> Claude is not signed in, so scoring will not work yet.
                </p>
                <label className="setup-claude-sso">
                  <input
                    type="checkbox"
                    checked={useSso}
                    onChange={(event) => setUseSso(event.target.checked)}
                  />
                  My company uses single sign-on (SSO)
                </label>
                <button type="button" className="setup-secondary" onClick={() => void handleStartSignIn()}>
                  Sign in to Claude
                </button>
                {signInError && <p className="setup-claude-missing">{signInError}</p>}
              </div>
            ) : (
              <p className="setup-hint">
                Scoring uses the Claude account that Claude Code is signed in to. Could not tell
                whether it is signed in; if scoring fails, run <code>claude</code> in a terminal and
                sign in.
              </p>
            )}
          </>
        ) : (
          <p className="setup-claude-missing">
            <Icon name="alertTriangle" /> Claude Code was not found on this computer. You can still
            browse applicants, but scoring will not work until it is installed.
          </p>
        )}
        <p className="setup-hint">
          Scoring uses the Claude account that Claude Code is signed in to. Installation steps are in
          SETUP.md.
        </p>
      </section>
    </div>
  );
}
