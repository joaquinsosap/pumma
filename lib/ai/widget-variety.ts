// A dashboard of four bar charts is one chart repeated. The model marks
// series that read equally well the other way (altPie on a bar, altBar on a
// pie — same item shape, so the swap is lossless), and this pass flips a
// repeat into the unused form. Pure so it's testable; the dashboard calls it
// once per render.
import type { Widget } from "@/lib/ai/ask-schema";

export function diversifyWidgets(widgets: Widget[]): Widget[] {
  const seen = new Set<string>();
  return widgets.map((w) => {
    let out: Widget = w;
    if (w.type === "bar" && w.altPie && seen.has("bar") && !seen.has("pie")) {
      out = {
        type: "pie",
        title: w.title,
        span: w.span,
        slices: w.series,
        unit: w.unit,
        centerLabel: "",
      };
    } else if (
      w.type === "pie" &&
      w.altBar &&
      seen.has("pie") &&
      !seen.has("bar")
    ) {
      out = {
        type: "bar",
        title: w.title,
        span: w.span,
        unit: w.unit,
        series: w.slices,
      };
    }
    seen.add(out.type);
    return out;
  });
}
