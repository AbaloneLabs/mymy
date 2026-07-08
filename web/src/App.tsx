import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useLockApp } from "@/hooks/useLockApp";

const PinScreen = lazy(() => import("@/routes/PinScreen"));
const Dashboard = lazy(() => import("@/routes/Dashboard"));
const Settings = lazy(() => import("@/routes/Settings"));
const Chat = lazy(() => import("@/routes/Chat"));
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
    </BrowserRouter>
  );
}
