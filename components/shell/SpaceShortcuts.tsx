"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLifeView } from "@/components/shell/LifeAreaToggle";
import { hrefWithLife } from "@/lib/life-area";
import { isEditableTarget } from "@/lib/is-editable-target";
import { isTutorialActive } from "@/lib/tutorial-lock";
import { spaceForKey } from "@/lib/space-shortcuts";

/**
 * Number keys jump between spaces: 1 Home, 2 Tasks, 3 Notes, and so on down
 * the sidebar.
 *
 * This has to share a keyboard with type-anywhere capture, which claims every
 * bare character key when nothing is focused. Both cannot have the digits, so
 * the digits go here and the cost is stated plainly: while this is on, a
 * capture cannot START with one. Type "2 coffees" from a standing start and
 * you land on Tasks instead. Everything after the first character still goes
 * to the bar, because by then the bar has focus and this hands the key
 * straight back. The setting in Settings → General is the way out, and it is
 * the reason there is a setting at all.
 *
 * Registered in the capture phase and prevented rather than raced. Both this
 * and the capture bar listen on `window`, so bubbling order would be decided
 * by which component happened to mount first; capturing runs before any of
 * them, and the bar already stands down on `defaultPrevented`.
 *
 * It carries the current life filter across, so jumping to Tasks from a Work
 * view keeps you in Work rather than quietly widening to everything.
 */
export function SpaceShortcuts({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [life] = useLifeView();

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      // The tour owns the keyboard while it is up.
      if (isTutorialActive()) return;
      if (e.defaultPrevented || e.isComposing) return;
      // Typing into anything keeps the key.
      if (isEditableTarget(document.activeElement)) return;
      // A dialog on screen is a question waiting for an answer; navigating
      // out from under it leaves the answer nowhere to go.
      if (document.querySelector('[role="dialog"]')) return;

      const href = spaceForKey(e.key, {
        meta: e.metaKey,
        ctrl: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
      });
      if (!href) return;

      e.preventDefault();
      router.push(hrefWithLife(href, life));
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [enabled, router, life]);

  return null;
}
