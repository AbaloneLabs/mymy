/**
 * TanStack Query hooks for this domain.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CalendarEvent, CreateCalendarEventInput, UpdateCalendarEventInput } from "@/types/calendar";

/* -------------------------------------------------- Calendar */

interface CalendarEventsResponse {
  events: CalendarEvent[];
}

/**
 * Fetch calendar events for a given month range.
 * @param start ISO date string (inclusive, start of range)
 * @param end   ISO date string (exclusive, end of range)
 * @param projectId optional project filter
 */
export function useCalendarEvents(
  start: string,
  end: string,
  projectId?: string,
) {
  return useQuery({
    queryKey: ["calendar", "events", start, end, projectId ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ start, end });
      if (projectId) params.set("projectId", projectId);
      return api.get<CalendarEventsResponse>(
        `/calendar/events?${params.toString()}`,
      );
    },
    enabled: Boolean(start && end),
  });
}

export function useCreateCalendarEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCalendarEventInput) =>
      api.post<{ event: CalendarEvent }>("/calendar/events", {
        title: input.title,
        description: input.description ?? null,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        allDay: input.allDay ?? true,
        projectId: input.projectId ?? null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calendar"] }),
  });
}

export function useUpdateCalendarEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: UpdateCalendarEventInput }) => {
      const body: Record<string, unknown> = {};
      if (vars.input.title !== undefined) body.title = vars.input.title;
      if (vars.input.description !== undefined)
        body.description = vars.input.description;
      if (vars.input.startDate !== undefined)
        body.startDate = vars.input.startDate;
      if (vars.input.endDate !== undefined) body.endDate = vars.input.endDate;
      if (vars.input.allDay !== undefined) body.allDay = vars.input.allDay;
      if (vars.input.projectId !== undefined)
        body.projectId = vars.input.projectId;
      return api.patch<{ event: CalendarEvent }>(
        `/calendar/events/${vars.id}`,
        body,
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calendar"] }),
  });
}

export function useDeleteCalendarEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ success: boolean }>(`/calendar/events/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calendar"] }),
  });
}
