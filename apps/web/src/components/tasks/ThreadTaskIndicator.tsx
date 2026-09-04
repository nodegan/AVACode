import type { EnvironmentId, Task, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { SquareCheckBigIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { usePreparedConnection } from "~/state/session";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { TaskDetailsDialog } from "./TaskDetailsDialog";
import { addTaskComment, deleteTask, fetchThreadTask, setTaskLinkedThread } from "./taskApi";
import { notifyTasksChanged, useTaskLinksByThreadId } from "./taskLinkStore";

export function ThreadTaskIndicator(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  /** Hands the dialog's task over to the tasks panel's detail view. */
  onShowInPanel?: ((taskId: string) => void) | undefined;
}) {
  const { environmentId, threadId } = props;
  const preparedOption = usePreparedConnection(environmentId);
  const prepared = preparedOption._tag === "Some" ? preparedOption.value : null;
  const linksByThreadId = useTaskLinksByThreadId(environmentId);
  const summary = linksByThreadId.get(threadId) ?? null;
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const isRightPanelOpen = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, threadRef).isOpen,
  );
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

  const openTask = useCallback(() => {
    // The right panel is the default surface; the dialog is only for when it
    // is closed.
    if (isRightPanelOpen && props.onShowInPanel && summary) {
      props.onShowInPanel(summary.taskId);
      return;
    }
    void openDetails();
  }, [isRightPanelOpen, openDetails, props.onShowInPanel, summary]);

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
              onClick={() => openTask()}
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
          environmentId={environmentId}
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
          onShowInPanel={
            props.onShowInPanel
              ? () => {
                  props.onShowInPanel?.(task.id);
                  closeDetails();
                }
              : undefined
          }
          onOpenChange={(open) => {
            if (!open) closeDetails();
          }}
        />
      ) : null}
    </>
  );
}
