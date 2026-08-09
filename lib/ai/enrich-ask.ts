import type { AskAnswer } from "@/lib/ai/ask-schema";
import { resolveFocusHref } from "@/lib/ask-links";
import type { SnapshotData } from "@/lib/ai/user-snapshot";

export function enrichAskAnswer(
  answer: AskAnswer,
  data: SnapshotData,
): AskAnswer {
  return {
    ...answer,
    widgets: answer.widgets.map((widget) => {
      if (widget.type === "list") {
        return {
          ...widget,
          items: widget.items.map((item) => {
            const href = resolveFocusHref(item, data);
            return href ? { ...item, href } : item;
          }),
        };
      }
      if (widget.type === "bar") {
        return {
          ...widget,
          series: widget.series.map((s) => {
            const href = resolveFocusHref(s, data);
            return href ? { ...s, href } : s;
          }),
        };
      }
      return widget;
    }),
  };
}
