import { loadPageData } from "@/lib/page-data";
import { NotesView } from "@/components/notes/NotesView";

type Props = {
  searchParams: Promise<{ tag?: string; life?: string; note?: string }>;
};

export default async function NotesPage({ searchParams }: Props) {
  const data = await loadPageData(searchParams);
  const { note } = await searchParams;
  return (
    <NotesView
      notes={data.notes}
      tags={data.tags}
      selectedId={note ?? null}
      stats={data.stats}
      lifeView={data.lifeView}
      birthDate={data.birthDate}
      lifeSpanYears={data.lifeSpanYears}
      noteSort={data.settings?.noteSort ?? "edited"}
      sortReversed={data.settings?.sortReversed ?? []}
    />
  );
}
