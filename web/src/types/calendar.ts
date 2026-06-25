


export interface CalendarEvent {
  id: string;

  title: string;

  description?: string;

  startDate: string;

  endDate?: string;

  allDay: boolean;

  projectId?: string;

  createdAt: string;

  updatedAt: string;
}


export interface CreateCalendarEventInput {
  title: string;
  description?: string;
  startDate: string;
  endDate?: string;
  allDay?: boolean;
  projectId?: string;
}


export interface UpdateCalendarEventInput {
  title?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  allDay?: boolean;
  projectId?: string;
}
