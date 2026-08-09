import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * A widget's title bar.
 *
 * The panels used to put the title link and the panel's controls (a day
 * pager, a "Meeting" button) side by side as unrelated siblings, with only
 * the title carrying any background. Under a themed skin that reads as a
 * strip that stops halfway across, with the controls stranded outside it.
 *
 * This makes the whole row one bar: it bleeds out to the panel's padding on
 * all three sides so it meets the panel edge, and everything the header owns
 * sits inside it.
 */
export function WidgetHeader({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "widget-head -mx-[18px] -mt-[15px] mb-3 flex items-center gap-2 px-[18px] py-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function WidgetHeaderLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "-mx-1 flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-0.5 transition-colors hover:bg-hover",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function WidgetRowLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "block rounded-lg transition-colors hover:bg-hover",
        className,
      )}
    >
      {children}
    </Link>
  );
}
