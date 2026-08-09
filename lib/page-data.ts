import { loadAppData } from "@/lib/data";
import { resolveLifeView } from "@/lib/life-view-server";

type PageSearchParams = {
  life?: string;
};

export async function loadPageData(searchParams: Promise<PageSearchParams>) {
  const { life } = await searchParams;
  const lifeView = await resolveLifeView(life);
  return loadAppData({ lifeView });
}
