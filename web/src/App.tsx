import {
  Component,
  lazy,
  Suspense,
  useEffect,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useLockApp } from "@/hooks/useLockApp";

const PinScreen = lazy(() => import("@/routes/PinScreen"));
const Dashboard = lazy(() => import("@/routes/Dashboard"));
const Settings = lazy(() => import("@/routes/Settings"));
const Chat = lazy(() => import("@/routes/Chat"));
const DecisionsPage = lazy(() => import("@/routes/DecisionsPage"));
const CalendarPage = lazy(() => import("@/routes/CalendarPage"));
const NotesPage = lazy(() => import("@/routes/NotesPage"));
const KnowledgePage = lazy(() => import("@/routes/KnowledgePage"));
const JourneyPage = lazy(() => import("@/routes/JourneyPage"));
const ProjectDetail = lazy(() => import("@/routes/ProjectDetail"));
const TasksPage = lazy(() => import("@/routes/TasksPage"));
const AgentsPage = lazy(() => import("@/routes/AgentsPage"));
const FinancePage = lazy(() => import("@/routes/FinancePage"));
const DrivePage = lazy(() => import("@/routes/DrivePage"));
const InvestmentsPage = lazy(() => import("@/routes/InvestmentsPage"));
const ProcessesPage = lazy(() => import("@/routes/ProcessesPage"));
const GoalsPage = lazy(() => import("@/routes/GoalsPage"));
const ShortcutsPage = lazy(() => import("@/routes/ShortcutsPage"));

const protectedRoutes = [
  { path: "/", element: <Dashboard /> },
  { path: "/decisions", element: <DecisionsPage /> },
  { path: "/chat", element: <Chat /> },
  { path: "/calendar", element: <CalendarPage /> },
  { path: "/notes", element: <NotesPage /> },
  { path: "/knowledge", element: <KnowledgePage /> },
  { path: "/journey", element: <JourneyPage /> },
  { path: "/tasks", element: <TasksPage /> },
  { path: "/agents", element: <AgentsPage /> },
  { path: "/finance", element: <FinancePage /> },
  { path: "/drive", element: <DrivePage /> },
  { path: "/investments", element: <InvestmentsPage /> },
  { path: "/processes", element: <ProcessesPage /> },
  { path: "/goals", element: <GoalsPage /> },
  { path: "/settings", element: <Settings /> },
  { path: "/shortcuts", element: <ShortcutsPage /> },
  { path: "/projects/:id", element: <ProjectDetail /> },
] as const;

function RouteFallback() {
  return (
    <div className="flex h-screen items-center justify-center bg-[var(--bg)]" aria-busy="true">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent)]" />
    </div>
  );
}

interface RouteErrorBoundaryState {
  error: Error | null;
}

/**
 * Keep a failed lazy route recoverable without weakening route splitting.
 *
 * React caches a rejected lazy import for the lifetime of the current page,
 * so clearing component state would immediately throw the same rejection.
 * A user-initiated reload creates a fresh module graph and reuses the current
 * URL, which is the only deterministic recovery after a transient chunk/CDN
 * failure or a deployment that replaced hashed assets.
 */
class RouteErrorBoundary extends Component<
  { children: ReactNode },
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Lazy route failed to load", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex h-screen items-center justify-center bg-[var(--bg)] p-6">
        <div
          role="alert"
          className="max-w-md rounded-lg border border-[var(--status-error)]/40 bg-[var(--surface)] p-5 text-[var(--text)]"
        >
          <h1 className="text-base font-semibold">This page could not be loaded.</h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            The route asset may have changed during deployment or failed in transit.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-md bg-[var(--accent)] px-3 py-2 text-sm text-white"
          >
            Retry loading page
          </button>
        </div>
      </main>
    );
  }
}

function UnauthorizedListener() {
  const lock = useLockApp();

  useEffect(() => {
    window.addEventListener("mymy:unauthorized", lock);
    return () => window.removeEventListener("mymy:unauthorized", lock);
  }, [lock]);

  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <UnauthorizedListener />
      <RouteErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/pin" element={<PinScreen />} />
            {protectedRoutes.map(({ path, element }) => (
              <Route
                key={path}
                path={path}
                element={<ProtectedRoute>{element}</ProtectedRoute>}
              />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </RouteErrorBoundary>
    </BrowserRouter>
  );
}
