"use client";

import { Moon, Sun } from "@/components/icons";
import { useLook } from "@/components/providers/look-provider";
import { LookPicker } from "@/components/shell/LookPicker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { lookById } from "@/lib/themes";

/** The bulb in the sidebar: opens the looks. Its glyph says whether the one in front is light or dark. */
export function LookMenu() {
  const { look } = useLook();
  const Glyph = lookById(look).mode === "dark" ? Moon : Sun;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Change the look"
          title="Change the look"
          className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] text-faint hover:bg-hover"
        >
          <Glyph className="h-[15px] w-[15px]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[292px]">
        <LookPicker />
      </PopoverContent>
    </Popover>
  );
}
