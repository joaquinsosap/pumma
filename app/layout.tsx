import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Providers } from "@/components/providers/nuqs-provider";
import { getSettings } from "@/lib/db/settings";
import { getSessionUserId } from "@/lib/auth/session";
import "./globals.css";

const schibsted = Schibsted_Grotesk({
  subsets: ["latin"],
  variable: "--font-schibsted",
  weight: ["400", "500", "600", "700", "800"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  weight: ["400", "500", "600"],
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
      className={`${schibsted.variable} ${jetbrains.variable}`}
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
