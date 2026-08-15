import type { MetadataRoute } from "next";
import { robotsRules } from "@/lib/seo";

// Served from this app because robots.txt must sit at the domain root, which
// this app owns. The rules themselves live in lib/seo.ts so they can be tested
// without booting Next. See that file for why MARKETING_PATHS exists.

/**
 * Rendered per request, not at build.
 *
 * Reading process.env does not make a route dynamic, so Next happily
 * prerenders this one into the image — and the image is built in CI, where a
 * deployment's marketing variables do not exist. The result was a robots.txt
 * baked as "Disallow: /" while the running container had the env set,
 * silently telling crawlers to ignore the whole site.
 *
 * The response is three lines of text, so per-request costs nothing.
 */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const { allow, disallow, sitemap } = robotsRules({
    marketingPaths: process.env.MARKETING_PATHS,
    marketingHome: process.env.MARKETING_HOME,
    siteUrl: process.env.BETTER_AUTH_URL,
  });

  return {
    rules: { userAgent: "*", allow, disallow },
    sitemap,
  };
}
