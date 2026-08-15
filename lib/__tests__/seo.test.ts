// robots.txt is the file that decides whether anything else in the SEO work
// matters: a wrong line here silently un-indexes pages, and nothing in the app
// surfaces it. These pin the shape of every deployment mode we actually ship —
// self-hosted (index nothing), hosted (index the marketing paths), and the
// upgrade path from the older single-page variable.
import { describe, expect, it } from "vitest";
import { robotsRules } from "@/lib/seo";

describe("robotsRules", () => {
  it("keeps a self-hosted install out of search entirely", () => {
    const { allow, disallow, sitemap } = robotsRules({});
    // No allow list at all, rather than an empty one: "Allow:" with nothing
    // after it is a line crawlers are free to interpret however they like.
    expect(allow).toBeUndefined();
    expect(disallow).toBe("/");
    expect(sitemap).toBeUndefined();
  });

  it("allows every listed marketing path, home included", () => {
    const { allow } = robotsRules({
      marketingPaths: "/landing,/demo,/contact,/legal/",
      siteUrl: "https://pumma.app",
    });
    expect(allow).toEqual(["/$", "/landing", "/demo", "/contact", "/legal/"]);
  });

  it("anchors the home page so the allow does not open the whole app", () => {
    const { allow } = robotsRules({ marketingPaths: "/landing" });
    // "/$" ends at the root. A bare "/" would allow every dashboard route.
    expect(allow?.[0]).toBe("/$");
    expect(allow).not.toContain("/");
  });

  it("still disallows everything else while allowing the marketing paths", () => {
    const { disallow } = robotsRules({ marketingPaths: "/landing,/demo" });
    expect(disallow).toBe("/");
  });

  it("tolerates the spacing a human leaves in an env var", () => {
    const { allow } = robotsRules({ marketingPaths: " /landing , /demo ,, " });
    expect(allow).toEqual(["/$", "/landing", "/demo"]);
  });

  it("does not repeat a path listed twice", () => {
    const { allow } = robotsRules({ marketingPaths: "/landing,/landing" });
    expect(allow).toEqual(["/$", "/landing"]);
  });

  it("falls back to the old single-page variable on an upgrade", () => {
    // A deployment that sets only MARKETING_HOME keeps exactly the behaviour
    // it had before MARKETING_PATHS existed.
    const { allow } = robotsRules({ marketingHome: "/landing" });
    expect(allow).toEqual(["/$", "/landing", "/legal/"]);
  });

  it("prefers the explicit list when both variables are set", () => {
    const { allow } = robotsRules({
      marketingPaths: "/landing,/demo",
      marketingHome: "/landing",
    });
    expect(allow).toEqual(["/$", "/landing", "/demo"]);
  });

  it("declares an absolute sitemap URL", () => {
    const { sitemap } = robotsRules({
      marketingPaths: "/landing",
      siteUrl: "https://pumma.app",
    });
    // Relative sitemap URLs are rejected by crawlers.
    expect(sitemap).toBe("https://pumma.app/sitemap.xml");
  });

  it("does not double the slash when the origin carries a trailing one", () => {
    const { sitemap } = robotsRules({
      marketingPaths: "/landing",
      siteUrl: "https://pumma.app/",
    });
    expect(sitemap).toBe("https://pumma.app/sitemap.xml");
  });

  it("omits the sitemap when there is no origin to make it absolute", () => {
    const { sitemap } = robotsRules({ marketingPaths: "/landing" });
    expect(sitemap).toBeUndefined();
  });

  it("omits the sitemap when nothing public is indexable anyway", () => {
    const { sitemap } = robotsRules({ siteUrl: "https://pumma.app" });
    expect(sitemap).toBeUndefined();
  });
});
