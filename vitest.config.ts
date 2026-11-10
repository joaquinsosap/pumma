import { configDefaults, defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    // Session worktrees live under .claude/ and carry a stale copy of every test.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // The real package throws when imported outside an RSC bundler (its
      // whole job is to fail a client-component build) — tests run plain
      // Node, so use its own no-op build instead, same as Next.js does under
      // the "react-server" condition.
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
});
