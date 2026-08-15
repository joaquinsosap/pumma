import { loadPageData } from "@/lib/page-data";
import { NotesView } from "@/components/notes/NotesView";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tag?: string; life?: string }>;
};

export default async function NotePage({ params, searchParams }: Props) {
  const { id } = await params;
  const data = await loadPageData(searchParams);

  return (
    <NotesView
      notes={data.notes}
      tags={data.tags}
      selectedId={id}
      stats={data.stats}
      lifeView={data.lifeView}
      birthDate={data.birthDate}
      lifeSpanYears={data.lifeSpanYears}
      noteSort={data.settings?.noteSort ?? "edited"}
    />
  );
}
