"use client";

import { useMemo } from "react";
import { buildTimezoneOptions, getDefaultTimezone } from "@/lib/timezone";

type Props = {
  value: string;
  onChange: (timeZone: string) => void;
};

export function TimezoneSelect({ value, onChange }: Props) {
  const current = value || getDefaultTimezone();
  const options = useMemo(() => buildTimezoneOptions(current), [current]);

  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <select
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
        value={current}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <p className="text-[12px] text-faint">
        Today, due dates, habits, calendar, and the top bar all use this
        timezone.
      </p>
    </div>
  );
}
