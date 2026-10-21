import { redirect } from "next/navigation";
import { noteHref } from "@/lib/note-href";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Old /notes/<id> links land on the one notes page, which selects with ?note= (see lib/note-href.ts).
export default async function NotePage({ params, searchParams }: Props) {
  const { id } = await params;
  const rest = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string" && key !== "note") rest.set(key, value);
  }
  const query = rest.toString();
  redirect(query ? `${noteHref(id)}&${query}` : noteHref(id));
}
