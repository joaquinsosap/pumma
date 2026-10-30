import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
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
// Latin files in ./fonts, not next/font/google: Google's extensionless font URLs crash its loader mid-build (vercel/next.js#99114).
const plex = localFont({
  src: "./fonts/ibm-plex-sans-latin.woff2",
  variable: "--font-plex",
  weight: "400 700",
});

const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono-latin-500.woff2", weight: "500" },
    { path: "./fonts/ibm-plex-mono-latin-600.woff2", weight: "600" },
  ],
  variable: "--font-plex-mono",
});

/** Only for the capture bar's scrambled Tab hint, so it is fetched when used. */
const pixelify = localFont({
  src: "./fonts/pixelify-sans-latin-400.woff2",
  variable: "--font-pixelify",
  weight: "400",
  preload: false,
});

/** The canonical origin. Overridable so a preview deploy links to itself. */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pumma.app";

export const metadata: Metadata = {
  // Without this, Next resolves Open Graph and canonical URLs against
  // localhost and every share card points at a machine nobody else can reach.
  metadataBase: new URL(SITE_URL),
  title: "P.U.M.M.A · Procrastination Ultimate Megasor Monster Annihilator",
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
      className={`${plex.variable} ${plexMono.variable} ${pixelify.variable}`}
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
                  cancelButton: "font-mono text-[11px] text-faint2",
                },
                // Sonner's cancel style vanishes on the toast; these are the action button's own variables.
                cancelButtonStyle: {
                  background: "var(--normal-text)",
                  color: "var(--normal-bg)",
                },
              }}
            />
          </ThemeProvider>
        </Providers>
      </body>
    </html>
  );
}
