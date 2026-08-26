import { loadPageData } from "@/lib/page-data";
import { AssistantView } from "@/components/assistant/AssistantView";
import { getSessionUserId } from "@/lib/auth/session";
import { hasResolvableAiKey } from "@/lib/ai/api-key";

type Props = { searchParams: Promise<{ tag?: string; life?: string }> };

export default async function AssistantPage({ searchParams }: Props) {
  const data = await loadPageData(searchParams);
  const userId = await getSessionUserId();
  // Only the boolean crosses to the client — never the key itself.
  const aiReady = userId ? await hasResolvableAiKey(userId) : false;
  return (
    <AssistantView
      stats={data.stats}
      birthDate={data.birthDate}
      lifeSpanYears={data.lifeSpanYears}
      tags={data.tags}
      aiReady={aiReady}
    />
  );
}
