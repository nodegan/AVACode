import type { EnvironmentId, Task, TaskStatus, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ListTodoIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { usePreparedConnection } from "~/state/session";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { TaskDetailsDialog } from "./TaskDetailsDialog";
import { ThreadTasksDialog } from "./ThreadTasksDialog";
import {
  addTaskNote,
  deleteTask,
  fetchTaskStatuses,
  fetchThreadTasks,
  fetchTasksQuery,
  setTaskLinkedThread,
  updateManualTask,
} from "./taskApi";
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
  const summaries = linksByThreadId.get(threadId) ?? [];
  // One linked task renders inline with its title; several collapse into the
  // chooser, where no single task represents the thread.
  const summary = summaries.length === 1 ? (summaries[0] ?? null) : null;
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const isRightPanelOpen = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, threadRef).isOpen,
  );
  const [task, setTask] = useState<Task | null>(null);
  const [taskStatuses, setTaskStatuses] = useState<ReadonlyArray<TaskStatus>>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [chooserOpen, setChooserOpen] = useState(false);

  const openDetails = useCallback(async () => {
    if (!prepared) return;
    try {
      const tasks = await fetchThreadTasks(prepared, threadId);
      setTask(tasks[0] ?? null);
    } catch {
      setTask(null);
    }
    try {
      setTaskStatuses((await fetchTaskStatuses(prepared)).statuses);
    } catch {
      // Without statuses the quick status menu hides; the edit dialog still works.
    }
  }, [prepared, threadId]);

  const openTaskById = useCallback(
    async (taskId: string) => {
      setChooserOpen(false);
      if (isRightPanelOpen && props.onShowInPanel) {
        props.onShowInPanel(taskId);
        return;
      }
      if (!prepared) return;
      try {
        const result = await fetchTasksQuery(prepared, {
          taskIds: [taskId],
          page: 1,
          pageSize: 1,
        });
        setTask(result.tasks.find((candidate) => candidate.id === taskId) ?? null);
      } catch {
        setTask(null);
      }
      try {
        setTaskStatuses((await fetchTaskStatuses(prepared)).statuses);
      } catch {
        // Without statuses the quick status menu hides; the edit dialog still works.
      }
    },
    [isRightPanelOpen, prepared, props.onShowInPanel],
  );

  const openTask = useCallback(() => {
    // The right panel is the default surface; the chooser and dialog are for
    // when it is closed (several tasks) or cannot be used.
    if (summaries.length > 1) {
      setChooserOpen(true);
      return;
    }
    if (isRightPanelOpen && props.onShowInPanel && summary) {
      props.onShowInPanel(summary.taskId);
      return;
    }
    void openDetails();
  }, [isRightPanelOpen, openDetails, props.onShowInPanel, summary, summaries.length]);

  const closeDetails = useCallback(() => {
    setTask(null);
    setNoteDraft("");
    setBusyKey(null);
  }, []);

  const runMutation = useCallback(
    async (key: string, action: (connection: NonNullable<typeof prepared>) => Promise<void>) => {
      if (!prepared) return;
      setBusyKey(key);
      try {
        await action(prepared);
        notifyTasksChanged(environmentId);
        const refreshed = await fetchThreadTasks(prepared, threadId);
        // The dialog keeps the last good task view until its task leaves the
        // thread's linked set (e.g. unlinked from the chooser).
        setTask((current) =>
          current ? (refreshed.find((candidate) => candidate.id === current.id) ?? null) : null,
        );
      } catch {
        // The dialog keeps the last good task view; the failure is visible
        // through the unchanged state.
      } finally {
        setBusyKey(null);
      }
    },
    [environmentId, prepared, threadId],
  );

  if (summaries.length === 0 || !prepared) return null;

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            summary ? (
              <button
                type="button"
                aria-label={`Task: ${summary.title}`}
                onClick={() => openTask()}
                className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm bg-primary/10 px-1 py-0.5 text-primary outline-none transition-colors hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ListTodoIcon className="size-3.5 shrink-0" />
                <span className="hidden max-w-40 truncate text-xs font-medium md:inline">
                  {summary.title}
                </span>
              </button>
            ) : (
              <button
                type="button"
                aria-label={`${summaries.length} linked tasks`}
                onClick={() => setChooserOpen(true)}
                className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm bg-primary/10 px-1 py-0.5 text-primary outline-none transition-colors hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ListTodoIcon className="size-3.5 shrink-0" />
                <span className="hidden text-xs font-medium md:inline">
                  {summaries.length} tasks
                </span>
              </button>
            )
          }
        />
        <TooltipPopup side="bottom" className="max-w-80 whitespace-normal leading-tight">
          {summary ? `Task: ${summary.title}` : `${summaries.length} linked tasks`}
        </TooltipPopup>
      </Tooltip>
      {chooserOpen && summaries.length > 1 ? (
        <ThreadTasksDialog
          summaries={summaries}
          busyKey={busyKey}
          onOpenChange={(open) => {
            if (!open) setChooserOpen(false);
          }}
          onSelect={(taskId) => void openTaskById(taskId)}
          onUnlink={(taskId) => {
            void runMutation(`task-link:${taskId}`, (connection) =>
              setTaskLinkedThread(connection, taskId, null),
            );
          }}
        />
      ) : null}
      {task ? (
        <TaskDetailsDialog
          task={task}
          activeThreadId={threadId}
          environmentId={environmentId}
          busyKey={busyKey}
          statuses={taskStatuses}
          onStatusChange={
            task.provider === "manual"
              ? (statusId) => {
                  void runMutation(`task-update:${task.id}`, async (connection) => {
                    await updateManualTask(connection, { taskId: task.id, statusId });
                  });
                }
              : undefined
          }
          noteDraft={noteDraft}
          onNoteDraftChange={setNoteDraft}
          onAddNote={() => {
            const body = noteDraft.trim();
            if (!body) return;
            void runMutation(`note:${task.id}`, (connection) =>
              addTaskNote(connection, task.id, body),
            );
          }}
          onDelete={
            task.provider === "manual"
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
