import type { EnvironmentId, Task, ThreadId } from "@t3tools/contracts";
import { SquareCheckBigIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { usePreparedConnection } from "~/state/session";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { TaskDetailsDialog } from "./TaskDetailsDialog";
import { addTaskComment, deleteTask, fetchThreadTask, setTaskLinkedThread } from "./taskApi";
import { notifyTasksChanged, useTaskLinksByThreadId } from "./taskLinkStore";

export function ThreadTaskIndicator(props: { environmentId: EnvironmentId; threadId: ThreadId }) {
  const { environmentId, threadId } = props;
  const preparedOption = usePreparedConnection(environmentId);
  const prepared = preparedOption._tag === "Some" ? preparedOption.value : null;
  const linksByThreadId = useTaskLinksByThreadId(environmentId);
  const summary = linksByThreadId.get(threadId) ?? null;
  const [task, setTask] = useState<Task | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");

  const openDetails = useCallback(async () => {
    if (!prepared) return;
    try {
      setTask(await fetchThreadTask(prepared, threadId));
    } catch {
      setTask(null);
    }
  }, [prepared, threadId]);

  const closeDetails = useCallback(() => {
    setTask(null);
    setCommentDraft("");
    setBusyKey(null);
  }, []);

  const runMutation = useCallback(
    async (key: string, action: (connection: NonNullable<typeof prepared>) => Promise<void>) => {
      if (!prepared) return;
      setBusyKey(key);
      try {
        await action(prepared);
        notifyTasksChanged(environmentId);
        const refreshed = await fetchThreadTask(prepared, threadId);
        if (refreshed) {
          setTask(refreshed);
        } else {
          closeDetails();
        }
      } catch {
        // The dialog keeps the last good task view; the failure is visible
        // through the unchanged state.
      } finally {
        setBusyKey(null);
      }
    },
    [closeDetails, environmentId, prepared, threadId],
  );

  if (!summary || !prepared) return null;

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={`Task: ${summary.title}`}
              onClick={() => void openDetails()}
              className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm bg-primary/10 px-1 py-0.5 text-primary outline-none transition-colors hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <SquareCheckBigIcon className="size-3.5 shrink-0" />
              <span className="hidden max-w-40 truncate text-xs font-medium md:inline">
                {summary.title}
              </span>
            </button>
          }
        />
        <TooltipPopup side="bottom" className="max-w-80 whitespace-normal leading-tight">
          Task: {summary.title}
        </TooltipPopup>
      </Tooltip>
      {task ? (
        <TaskDetailsDialog
          task={task}
          activeThreadId={threadId}
          busyKey={busyKey}
          commentDraft={commentDraft}
          onCommentDraftChange={setCommentDraft}
          onAddComment={() => {
            const body = commentDraft.trim();
            if (!body) return;
            void runMutation(`comment:${task.id}`, (connection) =>
              addTaskComment(connection, task.id, body),
            );
          }}
          onDelete={
            task.source === "manual"
              ? () => {
                  void runMutation(`task-delete:${task.id}`, (connection) =>
                    deleteTask(connection, task.id),
                  );
                }
              : undefined
          }
          onUnlink={() => {
            void runMutation(`task-link:${task.id}`, (connection) =>
              setTaskLinkedThread(connection, task.id, null),
            );
          }}
          onOpenChange={(open) => {
            if (!open) closeDetails();
          }}
        />
      ) : null}
    </>
  );
}
