import type { Metadata, Viewport } from "next";
import {
  Schibsted_Grotesk,
  IBM_Plex_Sans,
  IBM_Plex_Mono,
} from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Providers } from "@/components/providers/nuqs-provider";
import { getSettings } from "@/lib/db/settings";
import { getSessionUserId } from "@/lib/auth/session";
import "./globals.css";

/**
 * IBM Plex, both cuts.
 *
 * Chosen over the alternatives on two counts. It is 11% narrower than
 * Montserrat on a real task title, which is content back in the dense rows;
 * and its sans and mono are one family by one designer, which matters here
 * because roughly half this app's labels are monospace and they used to come
 * from somewhere unrelated.
 */
const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-plex",
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
});

const schibsted = Schibsted_Grotesk({
  subsets: ["latin"],
  variable: "--font-schibsted",
  weight: ["400", "500", "600", "700", "800"],
});

/** The canonical origin. Overridable so a preview deploy links to itself. */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pumma.app";

export const metadata: Metadata = {
  // Without this, Next resolves Open Graph and canonical URLs against
  // localhost and every share card points at a machine nobody else can reach.
  metadataBase: new URL(SITE_URL),
  title: "P.U.M.M.A — Procrastination Ultimate Megasor Monster Annihilator",
  description: "Personal life-management dashboard",
  appleWebApp: { capable: true, title: "PUMMA", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f5" },
    { media: "(prefers-color-scheme: dark)", color: "#111110" },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Theme comes from the signed-in user's settings; auth pages default to light.
  const userId = await getSessionUserId();
  const settings = userId ? await getSettings(userId) : null;
  const defaultTheme = settings?.theme ?? "light";

  return (
    // The font variables live on <html>, not <body>. `--font-sans` is composed
    // at :root, and a custom property is substituted where it is *declared* —
    // so a family variable that only existed on <body> was out of scope there
    // and the whole stack silently collapsed to the generic fallback.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${schibsted.variable} ${plex.variable} ${plexMono.variable}`}
    >
      <body className="antialiased">
        <Providers>
          <ThemeProvider
            attribute="data-theme"
            defaultTheme={defaultTheme}
            enableSystem={false}
          >
            {children}
            <Toaster
              position="bottom-center"
              toastOptions={{
                classNames: {
                  toast:
                    "animate-pumma-toast bg-ink text-background font-semibold border-none",
                  actionButton: "font-mono text-[11px] text-faint2",
                },
              }}
            />
          </ThemeProvider>
        </Providers>
      </body>
    </html>
  );
}
