import { loadPageData } from "@/lib/page-data";
import { NotesView } from "@/components/notes/NotesView";

type Props = { searchParams: Promise<{ tag?: string; life?: string }> };

export default async function NotesPage({ searchParams }: Props) {
  const data = await loadPageData(searchParams);
  return (
    <NotesView
      notes={data.notes}
      tags={data.tags}
      selectedId={null}
      stats={data.stats}
      lifeView={data.lifeView}
      birthDate={data.birthDate}
      lifeSpanYears={data.lifeSpanYears}
      noteSort={data.settings?.noteSort ?? "edited"}
    />
  );
}
