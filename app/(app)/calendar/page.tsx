import { loadPageData } from "@/lib/page-data";
import { CalendarView } from "@/components/calendar/CalendarView";

type Props = { searchParams: Promise<{ tag?: string; life?: string }> };

export default async function CalendarPage({ searchParams }: Props) {
  const data = await loadPageData(searchParams);
  return (
    <CalendarView
      tasks={data.tasks}
      agenda={data.agenda}
      showMeetingCodes={data.settings?.showMeetingCodes ?? false}
      habitEntries={data.habitEntries}
      tags={data.tags}
      stats={data.stats}
      birthDate={data.birthDate}
      lifeSpanYears={data.lifeSpanYears}
    />
  );
}
