import { describe, expect, it } from "vitest";
import { isBlockedHost, vetFeedUrl } from "@/lib/calendar-feed-url";

describe("vetFeedUrl", () => {
  it("accepts the URLs the real providers hand out", () => {
    for (const u of [
      "https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/private-9f/basic.ics",
      "https://outlook.office365.com/owa/calendar/abc/reachcalendar.ics",
      "https://p01-calendars.icloud.com/published/2/AbCd",
      "http://example.com/feed.ics",
    ]) {
      expect(vetFeedUrl(u).ok, u).toBe(true);
    }
  });

  it("rewrites webcal:// to https, which is what the buttons produce", () => {
    const v = vetFeedUrl("webcal://example.com/cal.ics");
    expect(v).toEqual({ ok: true, url: "https://example.com/cal.ics" });
  });

  it("refuses anything that is not http(s)", () => {
    for (const u of [
      "file:///etc/passwd",
      "gopher://example.com/",
      "ftp://example.com/cal.ics",
      "data:text/calendar,BEGIN:VCALENDAR",
    ]) {
      expect(vetFeedUrl(u).ok, u).toBe(false);
    }
  });

  it("refuses loopback and private ranges", () => {
    for (const h of [
      "http://localhost/cal.ics",
      "http://127.0.0.1/cal.ics",
      "http://127.1.1.1/cal.ics",
      "http://10.0.0.5/cal.ics",
      "http://172.16.4.4/cal.ics",
      "http://172.31.255.1/cal.ics",
      "http://192.168.1.1/cal.ics",
      "http://100.64.0.1/cal.ics",
      "http://0.0.0.0/cal.ics",
      "http://[::1]/cal.ics",
      "http://[fd00::1]/cal.ics",
      "http://[fe80::1]/cal.ics",
    ]) {
      expect(vetFeedUrl(h).ok, h).toBe(false);
    }
  });

  it("refuses the cloud metadata endpoint", () => {
    // The one that hands out instance credentials to anything that asks.
    expect(vetFeedUrl("http://169.254.169.254/latest/meta-data/").ok).toBe(false);
  });

  it("refuses an IPv4 address wearing an IPv6 hat", () => {
    expect(vetFeedUrl("http://[::ffff:127.0.0.1]/cal.ics").ok).toBe(false);
  });

  it("refuses names that only resolve inside our own network", () => {
    for (const h of [
      "http://pumma/cal.ics", // single label: resolves via search domain
      "http://db.internal/cal.ics",
      "http://nas.local/cal.ics",
      "http://thing.localhost/cal.ics",
    ]) {
      expect(vetFeedUrl(h).ok, h).toBe(false);
    }
  });

  it("refuses credentials embedded in the URL", () => {
    expect(vetFeedUrl("https://user:pass@example.com/cal.ics").ok).toBe(false);
  });

  it("refuses a malformed dotted quad rather than interpreting it", () => {
    expect(vetFeedUrl("http://999.1.1.1/cal.ics").ok).toBe(false);
  });

  it("refuses empty and absurd input", () => {
    expect(vetFeedUrl("").ok).toBe(false);
    expect(vetFeedUrl("   ").ok).toBe(false);
    expect(vetFeedUrl("https://example.com/" + "a".repeat(3000)).ok).toBe(false);
  });

  it("treats a trailing dot as the same host", () => {
    // "localhost." is still localhost to a resolver.
    expect(isBlockedHost("localhost.")).toBe(true);
  });
});
