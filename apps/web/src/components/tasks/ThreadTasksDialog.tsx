import type { TaskId, TaskLinkSummary } from "@t3tools/contracts";
import { Link2OffIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import { statusTone } from "./TaskDetailsDialog";

/**
 * Chooser for threads carrying several linked tasks: one quiet card per task;
 * picking one opens it in the right panel (or the details dialog). Unlink
 * always targets this thread, so the copy can say so plainly.
 */
export function ThreadTasksDialog(props: {
  summaries: ReadonlyArray<TaskLinkSummary>;
  busyKey: string | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (taskId: TaskId) => void;
  onUnlink: (taskId: TaskId) => void;
}) {
  return (
    <Dialog open onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Linked tasks</DialogTitle>
          <DialogDescription>
            {props.summaries.length} tasks are linked to this thread.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="max-h-96 space-y-1.5 overflow-y-auto">
          {props.summaries.map((summary) => {
            const isBusy = props.busyKey === `task-link:${summary.taskId}`;
            return (
              <div
                key={summary.taskId}
                className="group/card flex items-center gap-2 rounded-md border border-border/70 pr-1 transition-colors hover:border-border"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md p-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => props.onSelect(summary.taskId)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 shrink-0 rounded-full border",
                      statusTone(summary.statusCategory),
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{summary.title}</span>
                    <span className="block text-xs text-muted-foreground capitalize">
                      {summary.provider}
                    </span>
                  </span>
                </button>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Unlink ${summary.title} from this thread`}
                        disabled={isBusy}
                        onClick={() => props.onUnlink(summary.taskId)}
                      />
                    }
                  >
                    <Link2OffIcon className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipPopup side="top">Unlink from this thread</TooltipPopup>
                </Tooltip>
              </div>
            );
          })}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
