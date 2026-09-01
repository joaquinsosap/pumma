import { loadAgendaPageData } from "@/lib/page-data";
import { CalendarView } from "@/components/calendar/CalendarView";

type Props = {
  searchParams: Promise<{ tag?: string; life?: string; day?: string }>;
};

export default async function CalendarPage({ searchParams }: Props) {
  const data = await loadAgendaPageData(searchParams);
  return (
    <CalendarView
      tasks={data.tasks}
      agenda={data.agenda}
      meetingBodies={data.bodies}
      showMeetingCodes={data.settings?.showMeetingCodes ?? false}
      feedCount={data.calendarFeeds.filter((f) => f.enabled).length}
      calendarLinkOffered={data.settings?.calendarLinkOffered ?? false}
      habitEntries={data.habitEntries}
      tags={data.tags}
      stats={data.stats}
      birthDate={data.birthDate}
      lifeSpanYears={data.lifeSpanYears}
    />
  );
}
