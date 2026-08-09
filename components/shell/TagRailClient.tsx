"use client";

import { addTagAction } from "@/lib/actions/settings";
import { cleanUnusedTagsAction, restoreTagsAction } from "@/lib/actions/tags";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Plus, Sparkles } from "@/components/icons";

type TagItem = {
  id: string;
  name: string;
  color: string;
  count: number;
};

export function TagRailClient({ tags }: { tags: TagItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [cleaning, setCleaning] = useState(false);
  const unusedCount = tags.filter((t) => t.count === 0).length;

  const handleAdd = async () => {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) return;
    const res = await addTagAction(trimmed);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Tag "${trimmed}" added`);
    setName("");
    setOpen(false);
    router.refresh();
  };

  const handleClean = async () => {
    if (cleaning) return;
    setCleaning(true);
    try {
      const res = await cleanUnusedTagsAction();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const removed = res.data?.removed ?? 0;
      if (!removed) {
        toast.success("No unused tags to clean");
        return;
      }
      const snapshot = res.undo?.snapshot;
      toast.success(
        removed === 1
          ? `Removed unused tag "${res.data?.names[0]}"`
          : `Removed ${removed} unused tags`,
        {
          action: snapshot
            ? {
                label: "UNDO",
                onClick: async () => {
                  const back = await restoreTagsAction(snapshot);
                  if (!back.ok) toast.error(back.error);
                  else toast.success("Tags restored");
                  router.refresh();
                },
              }
            : undefined,
        },
      );
      router.refresh();
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 px-2 pb-2 pt-[18px]">
        <span className="font-mono text-[10px] tracking-widest text-faint2">
          TAGS
        </span>
        <button
          type="button"
          onClick={handleClean}
          disabled={cleaning || unusedCount === 0}
          title={
            unusedCount
              ? `Remove ${unusedCount} unused tag${unusedCount === 1 ? "" : "s"}`
              : "No unused tags"
          }
          className="ml-auto flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] text-faint transition-colors hover:bg-hover hover:text-ink disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-faint"
        >
          <Sparkles className="h-3 w-3" strokeWidth={2.5} />
          {cleaning ? "…" : "Clean"}
        </button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] text-faint hover:bg-hover hover:text-ink"
              title="Add tag"
            >
              <Plus className="h-3 w-3" strokeWidth={2.5} />
              Add
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New tag</DialogTitle>
            </DialogHeader>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="tag name"
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <Button onClick={handleAdd} className="mt-2">
              Add tag
            </Button>
          </DialogContent>
        </Dialog>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:thin]">
        <div className="flex flex-col gap-px pb-2">
          {tags.length === 0 ? (
            <p className="px-2.5 py-1.5 font-mono text-[10px] text-faint2">
              No tags yet
            </p>
          ) : (
            tags.map((tag) => (
              <div
                key={tag.id}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-muted"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: tag.color }}
                />
                <span className="truncate">{tag.name}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-faint2">
                  {tag.count}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
