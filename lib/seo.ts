/**
 * What crawlers are allowed to see.
 *
 * The app itself stays out of search indexes: every path behind it is someone's
 * private dashboard. A hosted deployment, though, serves public marketing pages
 * on the same domain through the reverse proxy, and those pages are the whole
 * point of being findable at all.
 *
 * robots.txt is served by this app either way, because it has to live at the
 * domain root and this app owns "/". So the marketing paths have to be named
 * here even though another service renders them. MARKETING_PATHS is that list.
 *
 * It exists as its own variable rather than being inferred from MARKETING_HOME
 * because the two answer different questions: MARKETING_HOME is the single page
 * an anonymous visitor is redirected to, while this is every public path the
 * proxy routes away from the app. Inferring one from the other is what left
 * "/demo" and "/contact" crawlable-in-principle but disallowed in practice.
 */
export type RobotsInput = {
  /** Comma-separated public path prefixes, e.g. "/landing,/demo,/legal/". */
  marketingPaths?: string;
  /** The single page anonymous visitors land on. Legacy fallback. */
  marketingHome?: string;
  /** Origin for the absolute sitemap URL. No sitemap is declared without it. */
  siteUrl?: string;
};

export type RobotsRules = {
  allow: string[] | undefined;
  disallow: string;
  sitemap: string | undefined;
};

/**
 * "/$" is not a typo and not a regex: in robots.txt, "$" anchors the end of a
 * path, so "/$" means the home page exactly and nothing beneath it. Without it
 * a bare "Allow: /" would open the entire app.
 */
export function robotsRules(env: RobotsInput): RobotsRules {
  const listed = (env.marketingPaths ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  // Fall back to the older single-page variable so a deployment that upgrades
  // without setting the new one keeps exactly the behaviour it had.
  const paths =
    listed.length > 0
      ? listed
      : env.marketingHome
        ? [env.marketingHome, "/legal/"]
        : [];

  if (paths.length === 0) {
    return { allow: undefined, disallow: "/", sitemap: undefined };
  }

  const allow = ["/$", ...new Set(paths)];

  // Only worth pointing at a sitemap when there are public pages in it, and
  // only with an absolute URL — crawlers reject a relative one.
  const origin = env.siteUrl?.replace(/\/+$/, "");
  return {
    allow,
    disallow: "/",
    sitemap: origin ? `${origin}/sitemap.xml` : undefined,
  };
}
