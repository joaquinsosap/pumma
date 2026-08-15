import type { MetadataRoute } from "next";
import { robotsRules } from "@/lib/seo";

// Served from this app because robots.txt must sit at the domain root, which
// this app owns. The rules themselves live in lib/seo.ts so they can be tested
// without booting Next. See that file for why MARKETING_PATHS exists.
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
