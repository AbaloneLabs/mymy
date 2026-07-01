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
const GoalsPage = lazy(() => import("@/routes/GoalsPage"));
const ShortcutsPage = lazy(() => import("@/routes/ShortcutsPage"));

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
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/chat"
            element={
              <ProtectedRoute>
                <Chat />
              </ProtectedRoute>
            }
          />
          <Route
            path="/calendar"
            element={
              <ProtectedRoute>
                <CalendarPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/notes"
            element={
              <ProtectedRoute>
                <NotesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/knowledge"
            element={
              <ProtectedRoute>
                <KnowledgePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/journey"
            element={
              <ProtectedRoute>
                <JourneyPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tasks"
            element={
              <ProtectedRoute>
                <TasksPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agents"
            element={
              <ProtectedRoute>
                <AgentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance"
            element={
              <ProtectedRoute>
                <FinancePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/goals"
            element={
              <ProtectedRoute>
                <GoalsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/shortcuts"
            element={
              <ProtectedRoute>
                <ShortcutsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/projects/:id"
            element={
              <ProtectedRoute>
                <ProjectDetail />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
