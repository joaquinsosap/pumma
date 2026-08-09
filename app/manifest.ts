import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PUMMA · Procrastination Ultimate Megasor Monster Annihilator",
    short_name: "PUMMA",
    description:
      "Tasks, habits, goals, projects and notes in one quiet dashboard.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf9f5",
    theme_color: "#111110",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
