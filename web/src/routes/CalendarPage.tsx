import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarGrid } from "@/components/CalendarGrid";
import { EventDetailPanel } from "@/components/EventDetailPanel";
import { AppLayout } from "@/components/AppLayout";
import { useCreateAction } from "@/hooks/useGlobalShortcuts";
import { useProjectContext } from "@/store/projectContext";
import { useProjects } from "@/features/projects/api";
import { useCalendarEvents } from "@/features/calendar/api";

/**
 * Calendar page — left: month grid, right: event detail for selected day.
 *
 * Filters by the TopBar project context (agent filter is a no-op here,
 * per design: calendar events aren't agent-scoped).
 */
export default function CalendarPage() {
  const [searchParams] = useSearchParams();
  const focusedEventId = searchParams.get("eventId");
  const linkedDate = searchDate(searchParams.get("date"));
  const { selectedProjectId } = useProjectContext();
  const { data: projectsData } = useProjects();
  const projects = projectsData?.projects ?? [];

  const [cursor, setCursor] = useState(() => linkedDate);
  const [selectedDate, setSelectedDate] = useState<Date>(() => linkedDate);

  // Month range for fetching.
  const rangeStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const rangeEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  const { data: eventsData } = useCalendarEvents(
    rangeStart.toISOString(),
    rangeEnd.toISOString(),
    selectedProjectId ?? undefined,
  );
  const events = eventsData?.events ?? [];

  // Keyboard shortcut: press E on the calendar page to open the new-event form.
  const createNonce = useCreateAction("create.event");

  return (
    <AppLayout>
      <div className="flex h-full overflow-hidden">
        {/* Left: calendar grid — takes the larger share */}
        <div className="flex min-w-0 flex-1 flex-col border-r border-[var(--border)] px-5 py-4">
          <CalendarGrid
            cursor={cursor}
            onCursorChange={setCursor}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            events={events}
          />
        </div>

        {/* Right: event detail — fixed reasonable width */}
        <div className="flex w-[380px] shrink-0 flex-col">
          <EventDetailPanel
            selectedDate={selectedDate}
            cursor={cursor}
            projectId={selectedProjectId ?? undefined}
            projects={projects}
            openSignal={createNonce}
            focusEventId={focusedEventId}
          />
        </div>
      </div>
    </AppLayout>
  );
}

function searchDate(value: string | null) {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
