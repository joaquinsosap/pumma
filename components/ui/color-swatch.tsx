import { Check } from "@/components/icons";
import { cn } from "@/lib/utils";

/** One color to pick. The picked one wears a check and a ring, since `border-ink` is the same pale rim as every other surface. */
export function ColorSwatch({
  color,
  picked,
  title,
  onClick,
  className,
}: {
  color: string;
  picked: boolean;
  title: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={picked}
      onClick={onClick}
      className={cn(
        "flex items-center justify-center rounded-lg transition-transform hover:scale-105",
        picked && "ring-2 ring-ink ring-offset-2 ring-offset-surface",
        className,
      )}
      style={{ background: color }}
    >
      {picked && (
        <Check className="h-3.5 w-3.5 text-white" strokeWidth={3.2} />
      )}
    </button>
  );
}
