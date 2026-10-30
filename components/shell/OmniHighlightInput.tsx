"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { flushSync } from "react-dom";
import type { Tag } from "@/lib/schemas";
import type { OmniHint } from "@/lib/omni-hint";
import { ScrambleText } from "@/components/shell/ScrambleText";
import { NEW_TAG_PREVIEW_COLOR, tagBg, tokenizeOmniInput } from "@/lib/parse";
import { CALENDAR_PRIO } from "@/lib/calendar-tasks";
import { cn } from "@/lib/utils";

type Props = Omit<ComponentPropsWithoutRef<"input">, "value"> & {
  value: string;
  tags: Tag[];
  showTags?: boolean;
  showPriority?: boolean;
  /** What Tab would do at the caret, drawn after the text while focused. */
  hintFor?: (value: string, start: number, end: number) => OmniHint | null;
  /** Bumped when the parent sets the selection itself, so the hint re-reads it before paint. */
  selectionTick?: number;
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
      hintFor,
      selectionTick,
      className,
      style,
      onScroll,
      onFocus,
      onBlur,
      ...props
    },
    ref,
  ) {
    const [scrollLeft, setScrollLeft] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const hintRef = useRef<HTMLSpanElement>(null);
    const [hintWidth, setHintWidth] = useState(0);
    useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

    // The caret moves without the value changing (arrows, clicks, Tab's guess), so it is tracked.
    const [focused, setFocused] = useState(false);
    const [sel, setSel] = useState({ start: 0, end: 0 });
    const readSelection = () => {
      const el = inputRef.current;
      if (!el) return;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      setSel((prev) =>
        prev.start === start && prev.end === end ? prev : { start, end },
      );
    };
    useEffect(() => {
      if (!hintFor) return;
      const onChange = () => {
        if (document.activeElement === inputRef.current) readSelection();
      };
      document.addEventListener("selectionchange", onChange);
      return () => document.removeEventListener("selectionchange", onChange);
    }, [hintFor]);
    useLayoutEffect(() => {
      if (hintFor) readSelection();
    }, [value, hintFor, selectionTick]);

    const hint = focused && hintFor ? hintFor(value, sel.start, sel.end) : null;
    const count =
      hint?.kind === "open" && hint.count > 1
        ? String(hint.count)
        : hint?.kind === "cycling"
          ? `${hint.position}/${hint.count}`
          : null;
    const tokens = useMemo(
      () => tokenizeOmniInput(value, tags, { showTags, showPriority }),
      [value, tags, showTags, showPriority],
    );

    // Room for the hint: a full bar never scrolls past its own text, so padding as wide as the hint makes the gap.
    useLayoutEffect(() => {
      const w = Math.ceil(hintRef.current?.getBoundingClientRect().width ?? 0);
      setHintWidth((prev) => (prev === w ? prev : w));
    });
    // The hint's padding or the due chip narrows the box without the browser scrolling; an observer runs after Tab has put the caret back.
    useEffect(() => {
      const el = inputRef.current;
      if (!el) return;
      const observer = new ResizeObserver(() => {
        if (document.activeElement !== el) return;
        if (el.selectionStart !== el.value.length) return;
        el.scrollLeft = el.scrollWidth;
        flushSync(() => setScrollLeft(el.scrollLeft));
      });
      observer.observe(el);
      return () => observer.disconnect();
    }, []);

    return (
      <div className="flex min-w-0 flex-1 items-center gap-2">
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
                    // Colour only: anything that changes glyph width here
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
              {/* After everything typed, so no glyph before it can shift. */}
              <span ref={hintRef}>
                {hint?.kind === "certain" && (
                  <span className="text-faint2">
                    {hint.replace ? ` → ${hint.text}` : hint.text}
                  </span>
                )}
                {hint?.kind === "open" && (
                  <>
                    {hint.replace ? (
                      <span className="text-faint2">{" → "}</span>
                    ) : (
                      hint.known && (
                        <span className="text-faint2">{hint.known}</span>
                      )
                    )}
                    <ScrambleText
                      text={hint.unknown}
                      className={`omni-scramble omni-scramble-${hint.slot % 3}`}
                    />
                  </>
                )}
              </span>
            </div>
          </div>
          <input
            value={value}
            className={cn(
              INPUT_LAYER,
              "omni-highlight-input relative text-transparent caret-ink outline-none [-webkit-text-fill-color:transparent] placeholder:text-faint placeholder:[-webkit-text-fill-color:var(--faint)] placeholder:transition-colors group-focus-within:placeholder:text-faint2 group-focus-within:placeholder:[-webkit-text-fill-color:var(--faint2)]",
              className,
            )}
            style={hintWidth ? { ...style, paddingRight: hintWidth } : style}
            onScroll={(e) => {
              setScrollLeft(e.currentTarget.scrollLeft);
              onScroll?.(e);
            }}
            onFocus={(e) => {
              setFocused(true);
              readSelection();
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              onBlur?.(e);
            }}
            {...props}
            ref={inputRef}
          />
        </div>
        {count && (
          <span
            aria-hidden
            className="shrink-0 font-mono text-[11px] tabular-nums text-faint"
          >
            {count}
          </span>
        )}
      </div>
    );
  },
);
