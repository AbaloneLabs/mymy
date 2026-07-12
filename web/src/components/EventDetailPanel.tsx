import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  CalendarPlus,
  Trash2,
  Loader2,
  X,
  Calendar as CalendarIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useCalendarEvents, useCreateCalendarEvent, useDeleteCalendarEvent } from "@/features/calendar/api";
import type { Project } from "@/types/projects";

interface EventDetailPanelProps {
  /** The selected day. */
  selectedDate: Date;
  /** First-of-month cursor (determines the fetch range). */
  cursor: Date;
  /** Optional project filter (from TopBar context). */
  projectId?: string;
  /** Projects lookup for displaying project badges. */
  projects: Project[];
  /** Increments when the create-event shortcut fires (opens the form). */
  openSignal?: number;
  /** Event selected through a typed search link. */
  focusEventId?: string | null;
}

/**
 * Right-side detail panel: shows events for the selected day,
 * and allows creating / deleting events.
 */
export function EventDetailPanel({
  selectedDate,
  cursor,
  projectId,
  projects,
  openSignal,
  focusEventId,
}: EventDetailPanelProps) {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);

  // Open the form when the create-event shortcut signal changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (openSignal && openSignal > 0) setShowForm(true);
  }, [openSignal]);

  // Fetch the whole month; the grid also uses this, but each component
  // fetches independently with the same query key so TanStack dedupes.
  const range = useMonthRange(cursor);
  const { data, isLoading } = useCalendarEvents(
    range.start,
    range.end,
    projectId,
  );

  const createEvent = useCreateCalendarEvent();
  const deleteEvent = useDeleteCalendarEvent();

  const events = (data?.events ?? []).filter((ev) => {
    const evDate = new Date(ev.startDate);
    return (
      evDate.getFullYear() === selectedDate.getFullYear() &&
      evDate.getMonth() === selectedDate.getMonth() &&
      evDate.getDate() === selectedDate.getDate()
    );
  });

  const projectName = (pid?: string) =>
    pid ? projects.find((p) => p.id === pid)?.name : undefined;

  const handleDelete = (id: string) => {
    if (window.confirm(t("calendar.deleteConfirm"))) {
      deleteEvent.mutate(id);
    }
  };

  return (
    <div className="flex h-full w-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-[var(--text)]">
            {format(selectedDate, "MMMM d, yyyy")}
          </span>
          <span className="text-xs text-[var(--text-muted)]">
            {format(selectedDate, "EEEE")}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors duration-150",
            showForm
              ? "bg-[var(--surface-hover)] text-[var(--text)]"
              : "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]",
          )}
        >
          <CalendarPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("calendar.addEvent")}
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <AddEventForm
          date={selectedDate}
          projectId={projectId}
          projects={projects}
          onSubmit={(title, description) => {
            createEvent.mutate(
              {
                title,
                description: description || undefined,
                startDate: new Date(
                  selectedDate.getFullYear(),
                  selectedDate.getMonth(),
                  selectedDate.getDate(),
                  0,
                  0,
                  0,
                ).toISOString(),
                allDay: true,
                projectId: projectId,
              },
              {
                onSuccess: () => setShowForm(false),
              },
            );
          }}
          onCancel={() => setShowForm(false)}
          isSubmitting={createEvent.isPending}
        />
      )}

      {/* Event list */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2
              className="h-4 w-4 animate-spin text-[var(--text-muted)]"
              strokeWidth={1.75}
            />
          </div>
        )}

        {!isLoading && events.length === 0 && !showForm && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <CalendarIcon
              className="mb-2 h-8 w-8 text-[var(--text-faint)]"
              strokeWidth={1.25}
            />
            <span className="text-sm text-[var(--text-muted)]">
              {t("calendar.noEvents")}
            </span>
          </div>
        )}

        <div className="space-y-2">
          {events.map((ev) => {
            const pname = projectName(ev.projectId);
            return (
              <div
                key={ev.id}
                aria-current={focusEventId === ev.id ? "true" : undefined}
                className={cn(
                  "group rounded-lg border bg-[var(--surface)] p-3 transition-colors hover:border-[var(--border-hover)]",
                  focusEventId === ev.id
                    ? "border-[var(--accent)] ring-1 ring-[var(--accent)]"
                    : "border-[var(--border)]",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />
                      <span className="truncate text-sm font-medium text-[var(--text)]">
                        {ev.title}
                      </span>
                    </div>
                    {ev.description && (
                      <p className="mt-1 pl-4 text-xs text-[var(--text-muted)]">
                        {ev.description}
                      </p>
                    )}
                    {pname && (
                      <span className="mt-1.5 inline-block rounded bg-[var(--accent-from)]/20 px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
                        {pname}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(ev.id)}
                    disabled={deleteEvent.isPending}
                    className="shrink-0 text-[var(--text-faint)] opacity-0 transition-opacity hover:text-[var(--status-error)] group-hover:opacity-100"
                    aria-label={t("calendar.deleteEvent")}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------- inline add form ---------- */

function AddEventForm({
  date,
  projectId,
  projects,
  onSubmit,
  onCancel,
  isSubmitting,
}: {
  date: Date;
  projectId?: string;
  projects: Project[];
  onSubmit: (title: string, description: string) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit(title.trim(), description.trim());
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {t("calendar.newEvent")} · {format(date, "MMM d")}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="text-[var(--text-faint)] hover:text-[var(--text)]"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("calendar.eventTitle")}
        className="mb-2 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--accent)]"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t("calendar.eventDescription")}
        rows={2}
        className="mb-2 w-full resize-none rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--accent)]"
      />
      <div className="mb-3 text-[10px] text-[var(--text-faint)]">
        {projectId
          ? `${t("calendar.project")}: ${projects.find((p) => p.id === projectId)?.name ?? ""}`
          : t("calendar.general")}
      </div>
      <button
        type="submit"
        disabled={!title.trim() || isSubmitting}
        className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSubmitting && (
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />
        )}
        {t("calendar.create")}
      </button>
    </form>
  );
}

/* ---------- helpers ---------- */

function useMonthRange(cursor: Date) {
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  return { start: start.toISOString(), end: end.toISOString() };
}
