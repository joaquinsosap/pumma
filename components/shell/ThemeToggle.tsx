"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon } from "@/components/icons";
import { setTheme } from "@/lib/actions/settings";

export function ThemeToggle() {
  const { theme, setTheme: setLocal } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggle = async () => {
    const next = theme === "dark" ? "light" : "dark";
    setLocal(next);
    await setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] text-faint hover:bg-hover"
      title="Toggle theme"
      suppressHydrationWarning
    >
      {!mounted ? (
        <span className="inline-block h-[15px] w-[15px]" aria-hidden />
      ) : theme === "dark" ? (
        <Moon className="h-[15px] w-[15px]" />
      ) : (
        <Sun className="h-[15px] w-[15px]" />
      )}
    </button>
  );
}
