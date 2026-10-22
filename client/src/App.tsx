/**
 * Main App Component
 * Sets up routing and layout, and shows the first-run setup screen until
 * BambooHR is connected.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { apiService } from './services/api.service';
import type { SetupStatus } from './types/applicant.types';
import { BrandMark } from './components/icons/BrandMark';
import { Icon } from './components/icons/Icon';
import { JobsPage } from './components/JobsPage';
import { JobPage } from './components/JobPage';
import { ApplicantDetail } from './components/ApplicantDetail';
import { SetupScreen } from './components/SetupScreen';
import { ConnectionBadge } from './components/ConnectionBadge';
import { UpdateBanner } from './components/UpdateBanner';
import { HelpOverlay, type HelpPageKey } from './components/HelpOverlay';
import { ApplicantDetailSkeleton, ApplicantsListSkeleton } from './components/PageSkeletons';
import './App.css';

function AppContent(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);

  const loadSetupStatus = useCallback(async (): Promise<void> => {
    try {
      setSetupError(null);
      setSetupStatus(await apiService.getSetupStatus());
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : 'Could not reach the app server.');
    }
  }, []);

  useEffect(() => {
    void loadSetupStatus();
  }, [loadSetupStatus]);

  const isConnected = setupStatus?.bambooHR.configured === true;

  // Help points at things on the applicant list and applicant pages only.
  const helpPageKey: HelpPageKey | null = !isConnected
    ? null
    : /^\/jobs\/\d+\/?$/.test(location.pathname)
      ? 'list'
      : location.pathname.startsWith('/applicants/')
        ? 'candidate'
        : null;

  // Scroll to the top first so the overlay measures the page as it is laid out at the
  // top, and its highlights and legend start from the same place every time. Hovering a
  // legend item scrolls the page around, so closing puts the reader back where they were.
  const scrollBeforeHelpRef = useRef<number>(0);
  const openHelp = (): void => {
    scrollBeforeHelpRef.current = window.scrollY;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    setIsHelpOpen(true);
  };
  const closeHelp = (): void => {
    setIsHelpOpen(false);
    window.scrollTo({ top: scrollBeforeHelpRef.current, left: 0, behavior: 'instant' });
  };

  // Leaving the page (or its help) closes the overlay.
  useEffect(() => {
    setIsHelpOpen(false);
  }, [location.pathname]);

  // Remember that this session started without a connection, so that once the
  // setup screen connects BambooHR we can leave /setup for the applicant list.
  // (Opening /setup voluntarily while already connected must not bounce away.)
  const startedUnconnectedRef = useRef<boolean>(false);
  useEffect(() => {
    if (setupStatus === null) return;
    if (!isConnected) {
      startedUnconnectedRef.current = true;
    } else if (startedUnconnectedRef.current) {
      startedUnconnectedRef.current = false;
      if (location.pathname === '/setup') navigate('/', { replace: true });
    }
  }, [setupStatus, isConnected, location.pathname, navigate]);

  const renderBody = (): JSX.Element => {
    if (setupError) {
      return (
        <div className="app-notice" role="alert">
          <p>
            Hiring Helper could not reach its server. Make sure it is still running, then try
            again.
          </p>
          <p className="app-notice-detail">{setupError}</p>
          <button type="button" className="app-notice-button" onClick={() => void loadSetupStatus()}>
            Try again
          </button>
        </div>
      );
    }
    if (setupStatus === null) {
      // Show the shape of the page being opened instead of a blank "Loading…".
      if (location.pathname.startsWith('/applicants/')) return <ApplicantDetailSkeleton />;
      if (location.pathname.startsWith('/jobs/')) return <ApplicantsListSkeleton />;
      return <div className="app-notice">Loading…</div>;
    }
    if (!isConnected) {
      // Until BambooHR is connected, every address leads to the setup screen.
      return (
        <Routes>
          <Route
            path="/setup"
            element={
              <SetupScreen
                status={setupStatus}
                onConnected={() => void loadSetupStatus()}
                onRefreshStatus={() => void loadSetupStatus()}
              />
            }
          />
          <Route path="*" element={<Navigate to="/setup" replace />} />
        </Routes>
      );
    }
    return (
      <Routes>
        <Route path="/" element={<JobsPage />} />
        <Route
          path="/jobs/:jobId"
          element={
            <JobPage
              tab="applicants"
              bambooHRSubdomain={setupStatus.bambooHR.subdomain}
              claude={setupStatus.claude}
            />
          }
        />
        <Route
          path="/jobs/:jobId/settings"
          element={
            <JobPage
              tab="settings"
              bambooHRSubdomain={setupStatus.bambooHR.subdomain}
              claude={setupStatus.claude}
            />
          }
        />
        <Route
          path="/applicants/:id"
          element={<ApplicantDetail bambooHRSubdomain={setupStatus.bambooHR.subdomain} />}
        />
        <Route
          path="/setup"
          element={
            <SetupScreen
              status={setupStatus}
              onConnected={() => {
                void loadSetupStatus();
                navigate('/');
              }}
              onRefreshStatus={() => void loadSetupStatus()}
              onCancel={() => navigate('/')}
            />
          }
        />
      </Routes>
    );
  };

  return (
    <div className="app">
      <header className="navbar">
        <div className="nav-container">
          <Link to="/" className="brand" aria-label="Hiring Helper home">
            <span className="brand-mark">
              <BrandMark size={38} />
            </span>
            <span className="brand-text">
              <span className="logo">Hiring Helper</span>
              <span className="tagline">Applicant Tracking</span>
            </span>
          </Link>
          <nav className="nav-links" aria-label="Main">
            {isConnected && (
              <ConnectionBadge subdomain={setupStatus?.bambooHR.subdomain ?? ''} />
            )}
            {helpPageKey && (
              <button type="button" className="nav-help" onClick={openHelp}>
                <Icon name="helpCircle" /> Help
              </button>
            )}
          </nav>
        </div>
      </header>

      <UpdateBanner />

      <main className="main-content">{renderBody()}</main>

      {isHelpOpen && helpPageKey && (
        <HelpOverlay pageKey={helpPageKey} onClose={closeHelp} />
      )}
    </div>
  );
}

function App(): JSX.Element {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
