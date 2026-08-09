import { cookies } from "next/headers";
import {
  LIFE_AREA_COOKIE,
  parseLifeView,
  type LifeView,
} from "@/lib/life-area";

/** Resolve life view from URL param, falling back to the persisted cookie. */
export async function resolveLifeView(
  urlLife?: string | null,
): Promise<LifeView> {
  if (urlLife != null && urlLife !== "") {
    return parseLifeView(urlLife);
  }
  const cookieStore = await cookies();
  return parseLifeView(cookieStore.get(LIFE_AREA_COOKIE)?.value);
}
