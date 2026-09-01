import { loadAgendaData, loadAppData } from "@/lib/data";
import { resolveLifeView } from "@/lib/life-view-server";

type PageSearchParams = {
  life?: string;
};

type AgendaPageSearchParams = PageSearchParams & {
  /** The day whose meetings are open, from nuqs. Today when absent. */
  day?: string;
};

export async function loadPageData(searchParams: Promise<PageSearchParams>) {
  const { life } = await searchParams;
  const lifeView = await resolveLifeView(life);
  return loadAppData({ lifeView });
}

/**
 * For the two pages that draw an agenda: home and calendar.
 *
 * Separate from loadPageData rather than an option on it so that a page which
 * needs meetings cannot forget to ask — the field simply is not on the other
 * loader's type, and using the wrong one is a compile error rather than an
 * empty agenda nobody notices.
 */
export async function loadAgendaPageData(
  searchParams: Promise<AgendaPageSearchParams>,
) {
  const { life, day } = await searchParams;
  const lifeView = await resolveLifeView(life);
  return loadAgendaData({ lifeView, bodyDate: day });
}
