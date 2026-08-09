"use client";

import {
  forwardRef,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import type { Tag } from "@/lib/schemas";
import { NEW_TAG_PREVIEW_COLOR, tagBg, tokenizeOmniInput } from "@/lib/parse";
import { CALENDAR_PRIO } from "@/lib/calendar-tasks";
import { cn } from "@/lib/utils";

type Props = Omit<ComponentPropsWithoutRef<"input">, "value"> & {
  value: string;
  tags: Tag[];
  showTags?: boolean;
  showPriority?: boolean;
};

function InlineTagToken({
  text,
  color,
  isNew,
}: {
  text: string;
  color: string;
  isNew: boolean;
}) {
  const accent = isNew ? NEW_TAG_PREVIEW_COLOR : color;
  return (
    <span
      style={{
        color: accent,
        backgroundColor: tagBg(accent),
        textDecoration: isNew ? "underline dotted" : undefined,
        textUnderlineOffset: "2px",
      }}
      title={isNew ? "New tag, created on save" : undefined}
    >
      {text}
    </span>
  );
}

function InlinePriorityToken({
  text,
  level,
}: {
  text: string;
  level: "low" | "med" | "high";
}) {
  const color = CALENDAR_PRIO[level];
  return (
    <span
      style={{
        color,
        backgroundColor: color.replace(")", " / 0.14)"),
      }}
    >
      {text}
    </span>
  );
}

const INPUT_LAYER =
  "m-0 w-full border-none bg-transparent p-0 text-base font-medium font-sans leading-normal tracking-normal antialiased [font-feature-settings:normal] [font-variant-ligatures:none]";

export const OmniHighlightInput = forwardRef<HTMLInputElement, Props>(
  function OmniHighlightInput(
    {
      value,
      tags,
      showTags = true,
      showPriority = true,
      className,
      onScroll,
      ...props
    },
    ref,
  ) {
    const [scrollLeft, setScrollLeft] = useState(0);
    const tokens = useMemo(
      () => tokenizeOmniInput(value, tags, { showTags, showPriority }),
      [value, tags, showTags, showPriority],
    );

    return (
      <div className="relative min-w-0 flex-1">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          <div
            className={cn(
              INPUT_LAYER,
              "inline-block w-max min-w-full whitespace-pre text-ink",
            )}
            style={{ transform: `translateX(-${scrollLeft}px)` }}
          >
            {tokens.map((token, i) => {
              if (token.kind === "text") {
                return (
                  // Colour only — anything that changes glyph width here
                  // drifts this layer out of step with the input under it.
                  <span
                    key={i}
                    className={token.dim ? "text-faint" : undefined}
                  >
                    {token.text}
                  </span>
                );
              }
              if (token.kind === "date") {
                // Its own colour: a date is understood, not a label you are
                // about to invent, and it shouldn't read like a new tag.
                return (
                  <span
                    key={i}
                    style={{
                      color: "oklch(0.55 0.13 250)",
                      backgroundColor: "oklch(0.55 0.13 250 / 0.13)",
                    }}
                  >
                    {token.text}
                  </span>
                );
              }
              if (token.kind === "tag") {
                return (
                  <InlineTagToken
                    key={i}
                    text={token.text}
                    color={token.color}
                    isNew={token.isNew}
                  />
                );
              }
              return (
                <InlinePriorityToken
                  key={i}
                  text={token.text}
                  level={token.level}
                />
              );
            })}
          </div>
        </div>
        <input
          ref={ref}
          value={value}
          className={cn(
            INPUT_LAYER,
            "omni-highlight-input relative text-transparent caret-ink outline-none [-webkit-text-fill-color:transparent] placeholder:text-faint placeholder:[-webkit-text-fill-color:var(--faint)] placeholder:transition-colors group-focus-within:placeholder:text-faint2 group-focus-within:placeholder:[-webkit-text-fill-color:var(--faint2)]",
            className,
          )}
          onScroll={(e) => {
            setScrollLeft(e.currentTarget.scrollLeft);
            onScroll?.(e);
          }}
          {...props}
        />
      </div>
    );
  },
);
