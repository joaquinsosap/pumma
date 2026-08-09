import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Auth endpoints only exist in mongodb mode; the memory demo has no accounts.
function handlers() {
  if (process.env.DATA_SOURCE !== "mongodb") {
    const gone = () =>
      new Response("Auth disabled in demo mode", { status: 404 });
    return { GET: gone, POST: gone };
  }
  return toNextJsHandler(getAuth());
}

const { GET, POST } = handlers();
export { GET, POST };
