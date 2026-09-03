import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  Task,
  TaskId,
  TaskListFacet,
  TaskPanel,
  TaskQueryFilter,
  TaskQueryResult,
  TaskStatusCategory,
} from "@t3tools/contracts";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CalendarIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FolderIcon,
  FolderOpenIcon,
  Link2Icon,
  LinkIcon,
  ListIcon,
  Loader2Icon,
  MessageSquareIcon,
  RefreshCwIcon,
  SquareCheckBigIcon,
  UserIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  addTaskComment,
  createManualTask,
  fetchTaskPanel,
  fetchTasksQuery,
  setTaskLinkedThread,
  syncClickUpTasks,
} from "./taskApi";
import { deleteTask as deleteTaskRequest } from "./taskApi";
import { TaskDetailsDialog, TaskStatusBadge } from "./TaskDetailsDialog";
import { notifyTasksChanged } from "./taskLinkStore";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { usePreparedConnection } from "~/state/session";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { newThreadId } from "~/lib/utils";
import { cn } from "~/lib/utils";

interface TaskPanelThreadContext {
  readonly id: string;
  readonly modelSelection: EnvironmentThreadShell["modelSelection"];
  readonly runtimeMode: EnvironmentThreadShell["runtimeMode"];
  readonly interactionMode: EnvironmentThreadShell["interactionMode"];
}

const TASKS_PAGE_SIZE = 10;

type ListSelection = { readonly kind: "all" } | { readonly kind: "list"; listId: string };

interface TaskFolderGroup {
  id: string;
  name: string;
  count: number;
  lists: TaskListFacet[];
}

const statusCategoryLabels: Record<TaskStatusCategory, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  blocked: "Blocked",
  unknown: "Unknown",
};

interface TaskCardProps {
  task: Task;
  isCurrentThread: boolean;
  busyKey: string | null;
  onOpenDetails: (taskId: string) => void;
  onLink: (taskId: TaskId) => void;
  onUnlink: (taskId: TaskId) => void;
}

const cardActionClassName =
  "inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

function TaskCard(props: TaskCardProps) {
  const { task } = props;

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a")) return;
        props.onOpenDetails(task.id);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpenDetails(task.id);
        }
      }}
      className="flex h-full cursor-pointer flex-col rounded-xl border border-border/70 bg-card/80 p-3 outline-none transition hover:border-border hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24"
    >
      <div className="flex items-center gap-2">
        <TaskStatusBadge task={task} />
        {task.source === "manual" ? (
          <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
            Manual
          </span>
        ) : null}
        {props.isCurrentThread ? (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            <Link2Icon className="size-3" />
            This thread
          </span>
        ) : null}
      </div>
      <h4 className="mt-2 truncate text-sm font-semibold">{task.title}</h4>
      <p
        className={cn(
          "mt-1 line-clamp-1 min-h-4 whitespace-pre-wrap text-xs leading-4 text-muted-foreground",
          !task.description && "italic",
        )}
      >
        {task.description || "No description."}
      </p>
      <div className="mt-2 flex h-6 flex-nowrap items-center gap-3 overflow-hidden text-[11px] whitespace-nowrap text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1">
          <CalendarIcon className="size-3 shrink-0" />
          <span className="truncate">
            Created{" "}
            {new Date(task.createdAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </span>
        {task.externalListName ? (
          <span className="inline-flex min-w-0 items-center gap-1">
            <ListIcon className="size-3 shrink-0" />
            <span className="truncate">{task.externalListName}</span>
          </span>
        ) : null}
        {task.assignees.length > 0 ? (
          <span className="inline-flex min-w-0 items-center gap-1">
            <UserIcon className="size-3 shrink-0" />
            <span className="truncate">{task.assignees.join(", ")}</span>
          </span>
        ) : null}
        <span className="ml-auto inline-flex shrink-0 items-center gap-1">
          <MessageSquareIcon className="size-3" />
          {task.comments.length}
        </span>
        <span className="inline-flex shrink-0 items-center gap-0.5">
          {task.linkedThreadId ? (
            <button
              type="button"
              aria-label="Unlink from thread"
              title="Unlink from thread"
              disabled={props.busyKey === `task-link:${task.id}`}
              className={cardActionClassName}
              onClick={(event) => {
                event.stopPropagation();
                props.onUnlink(task.id);
              }}
            >
              <LinkIcon className="size-3.5" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Link current thread"
              title="Link current thread"
              disabled={props.busyKey === `task-link:${task.id}`}
              className={cardActionClassName}
              onClick={(event) => {
                event.stopPropagation();
                props.onLink(task.id);
              }}
            >
              <Link2Icon className="size-3.5" />
            </button>
          )}
          {task.externalUrl ? (
            <a
              href={task.externalUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Open in ClickUp"
              title="Open in ClickUp"
              className={cardActionClassName}
            >
              <ExternalLinkIcon className="size-3.5" />
            </a>
          ) : null}
        </span>
      </div>
    </article>
  );
}

function TaskGroup({
  title,
  tasks,
  renderTask,
}: {
  title: string;
  tasks: ReadonlyArray<Task>;
  renderTask: (task: Task) => ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 px-0.5">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </h4>
        <span className="text-xs text-muted-foreground/70">{tasks.length}</span>
      </div>
      {tasks.map((task) => renderTask(task))}
    </section>
  );
}

function NavTreeRow(props: {
  icon: ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  trailing?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition",
        props.active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "shrink-0 [&_svg]:size-4",
          props.active ? "text-foreground" : "text-muted-foreground/80",
        )}
      >
        {props.icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      {typeof props.count === "number" ? (
        <span className="shrink-0 text-xs tabular-nums opacity-60">{props.count}</span>
      ) : null}
      {props.trailing}
    </button>
  );
}

export function TasksPanel(props: {
  environmentId: EnvironmentId;
  projectId: string;
  activeThread: TaskPanelThreadContext;
}) {
  const prepared = usePreparedConnection(props.environmentId);
  const navigate = useNavigate();
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const projectId = ProjectId.make(props.projectId);
  const activeThreadId = ThreadId.make(props.activeThread.id);
  const [panel, setPanel] = useState<TaskPanel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manualTitle, setManualTitle] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [tasksResult, setTasksResult] = useState<TaskQueryResult | null>(null);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [listSelection, setListSelection] = useState<ListSelection>({ kind: "all" });
  const [view, setView] = useState<"browse" | "tasks">("browse");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [listSearch, setListSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatusCategory | "all">("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  const clickup = panel?.clickup ?? null;
  const tokenConfigured = clickup?.tokenConfigured ?? false;

  const loadPanel = useCallback(async () => {
    if (prepared._tag === "None") {
      setPanel(null);
      setLoading(false);
      setError("Waiting for an authenticated environment connection.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setPanel(await fetchTaskPanel(prepared.value));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load tasks.");
    } finally {
      setLoading(false);
    }
  }, [prepared]);

  const queryFilter = useMemo<TaskQueryFilter>(
    () => ({
      listIds: listSelection.kind === "list" ? [listSelection.listId] : [],
      statuses: statusFilter === "all" ? [] : [statusFilter],
      assignees: assigneeFilter === "all" ? [] : [assigneeFilter],
      page,
      pageSize: TASKS_PAGE_SIZE,
    }),
    [assigneeFilter, listSelection, page, statusFilter],
  );

  const loadTasks = useCallback(async () => {
    if (prepared._tag === "None") {
      setTasksResult(null);
      setTasksLoading(false);
      return;
    }
    setTasksLoading(true);
    setTasksError(null);
    try {
      setTasksResult(await fetchTasksQuery(prepared.value, queryFilter));
    } catch (cause) {
      setTasksError(cause instanceof Error ? cause.message : "Failed to load tasks.");
    } finally {
      setTasksLoading(false);
    }
  }, [prepared, queryFilter]);

  useEffect(() => {
    void loadPanel();
  }, [loadPanel]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const runMutation = useCallback(
    async (key: string, action: (prepared: PreparedConnection) => Promise<void | TaskPanel>) => {
      if (prepared._tag === "None") {
        setError("Waiting for an authenticated environment connection.");
        return;
      }
      setBusyKey(key);
      setError(null);
      try {
        const result = await action(prepared.value);
        if (result) {
          setPanel(result);
        } else {
          await loadPanel();
        }
        await loadTasks();
        notifyTasksChanged(props.environmentId);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Task request failed.");
        if (key === "clickup-sync" || key === "clickup-token") {
          try {
            await loadPanel();
          } catch {
            // Keep the original mutation error visible if the follow-up refresh also fails.
          }
        }
      } finally {
        setBusyKey(null);
      }
    },
    [loadPanel, loadTasks, prepared, props.environmentId],
  );

  const syncNow = useCallback(() => {
    void runMutation("clickup-sync", async (connection) => {
      // The server starts the sync in a detached fiber and answers right away.
      // Poll the panel until lastSyncAt moves (or an error lands) instead of
      // holding this request open, where any hop can cut it.
      await syncClickUpTasks(connection);
      const initialLastSyncAt = panel?.clickup.lastSyncAt ?? null;
      const initialLastSyncError = panel?.clickup.lastSyncError ?? null;
      let latest = panel;
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          latest = await fetchTaskPanel(connection);
          setPanel(latest);
        } catch {
          // A failed poll is transient; keep waiting for the sync to land.
          continue;
        }
        const lastSyncAt = latest?.clickup.lastSyncAt ?? null;
        const lastSyncError = latest?.clickup.lastSyncError ?? null;
        if (
          (lastSyncAt !== null && lastSyncAt !== initialLastSyncAt) ||
          (lastSyncError !== null && lastSyncError !== initialLastSyncError)
        ) {
          break;
        }
      }
      return latest ?? undefined;
    });
  }, [panel, runMutation]);

  const createManual = useCallback(() => {
    const title = manualTitle.trim();
    if (!title) return;
    void runMutation("manual-create", async (connection) => {
      await createManualTask(connection, {
        title,
        ...(manualDescription.trim() ? { description: manualDescription.trim() } : {}),
      });
      setManualTitle("");
      setManualDescription("");
    });
  }, [manualDescription, manualTitle, runMutation]);

  const setTaskLink = useCallback(
    (taskId: TaskId, linkedThreadId: ThreadId | null) => {
      void runMutation(`task-link:${taskId}`, async (connection) => {
        await setTaskLinkedThread(connection, taskId, linkedThreadId);
      });
    },
    [runMutation],
  );

  const setTaskLinkCurrent = useCallback(
    (taskId: TaskId) => setTaskLink(taskId, activeThreadId),
    [activeThreadId, setTaskLink],
  );

  const setTaskLinkUnlinked = useCallback(
    (taskId: TaskId) => setTaskLink(taskId, null),
    [setTaskLink],
  );

  const addComment = useCallback(
    (taskId: TaskId) => {
      const body = commentDrafts[taskId]?.trim();
      if (!body) return;
      void runMutation(`comment:${taskId}`, async (connection) => {
        await addTaskComment(connection, taskId, body);
        setCommentDrafts((current) => ({ ...current, [taskId]: "" }));
      });
    },
    [commentDrafts, runMutation],
  );

  const deleteTask = useCallback(
    (taskId: TaskId) => {
      void runMutation(`task-delete:${taskId}`, async (connection) => {
        await deleteTaskRequest(connection, taskId);
      });
    },
    [runMutation],
  );

  const createLinkedThread = useCallback(
    async (task: Task) => {
      const threadId = newThreadId();
      const createResult = await createThread({
        environmentId: props.environmentId,
        input: {
          threadId,
          projectId,
          title: task.title,
          modelSelection: props.activeThread.modelSelection,
          runtimeMode: props.activeThread.runtimeMode,
          interactionMode: props.activeThread.interactionMode,
          branch: null,
          worktreePath: null,
        },
      });
      if (createResult._tag === "Failure") {
        setError("Failed to create a linked thread.");
        return;
      }
      setTaskLink(task.id, threadId);
      void navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: props.environmentId,
          threadId,
        },
      });
    },
    [
      createThread,
      navigate,
      props.activeThread.interactionMode,
      props.activeThread.modelSelection,
      props.activeThread.runtimeMode,
      props.environmentId,
      projectId,
      setTaskLink,
    ],
  );

  const navigateToThread = useCallback(
    (environmentId: string, threadId: ThreadId) => {
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId },
      });
    },
    [navigate],
  );

  const taskGroups = useMemo(() => {
    const tasks = tasksResult?.tasks ?? [];
    const manual = tasks.filter((task) => task.source === "manual");
    const byList = new Map<string, Task[]>();
    for (const task of tasks) {
      if (task.source !== "clickup") continue;
      const key = task.externalListName ?? "ClickUp";
      const bucket = byList.get(key);
      if (bucket) {
        bucket.push(task);
      } else {
        byList.set(key, [task]);
      }
    }
    return {
      manual,
      clickupGroups: [...byList.entries()].toSorted(([left], [right]) => left.localeCompare(right)),
    };
  }, [tasksResult?.tasks]);

  const selectedTask = useMemo(
    () =>
      selectedTaskId
        ? (tasksResult?.tasks.find((task) => task.id === selectedTaskId) ?? null)
        : null,
    [selectedTaskId, tasksResult],
  );

  const facets = panel?.facets ?? null;
  const totalTasks = tasksResult?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalTasks / TASKS_PAGE_SIZE));
  const anyTasks = (facets?.statuses ?? []).some((facet) => facet.count > 0);

  // ClickUp nests tasks as Workspace > Space > Folder > List > Task; facets
  // carry the list level with its folder path, so the browse view shows
  // folders with their lists nested underneath. Lists without a folder sit at
  // the top level.
  const listTree = useMemo(() => {
    const folders = new Map<string, TaskFolderGroup>();
    const orphans: TaskListFacet[] = [];
    for (const list of facets?.lists ?? []) {
      if (list.folderId && list.folderName) {
        const folder = folders.get(list.folderId) ?? {
          id: list.folderId,
          name: list.folderName,
          count: 0,
          lists: [],
        };
        folder.count += list.count;
        folder.lists.push(list);
        folders.set(list.folderId, folder);
      } else {
        orphans.push(list);
      }
    }
    return {
      folders: [...folders.values()].toSorted((left, right) => left.name.localeCompare(right.name)),
      orphans,
    };
  }, [facets?.lists]);

  const listSearchQuery = listSearch.trim().toLowerCase();
  const matchesList = useCallback(
    (list: TaskListFacet) =>
      listSearchQuery.length === 0 || list.name.toLowerCase().includes(listSearchQuery),
    [listSearchQuery],
  );

  const visibleFolders = useMemo(() => {
    if (listSearchQuery.length === 0) return listTree.folders;
    return listTree.folders.filter(
      (folder) =>
        folder.name.toLowerCase().includes(listSearchQuery) ||
        folder.lists.some((list) => list.name.toLowerCase().includes(listSearchQuery)),
    );
  }, [listSearchQuery, listTree.folders]);

  const visibleOrphans = useMemo(
    () => listTree.orphans.filter(matchesList),
    [listTree.orphans, matchesList],
  );

  const browsableListCount =
    listTree.folders.reduce((total, folder) => total + folder.lists.length, 0) +
    listTree.orphans.length;
  const allTasksCount =
    listTree.folders.reduce((total, folder) => total + folder.count, 0) +
    listTree.orphans.reduce((total, list) => total + list.count, 0);

  const activeList =
    listSelection.kind === "list"
      ? ((facets?.lists ?? []).find((list) => list.id === listSelection.listId) ?? null)
      : null;

  const openAllTasks = useCallback(() => {
    setListSelection({ kind: "all" });
    setPage(1);
    setView("tasks");
  }, []);

  const openTaskList = useCallback((listId: string) => {
    setListSelection({ kind: "list", listId });
    setPage(1);
    setView("tasks");
  }, []);

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((current) => ({ ...current, [folderId]: !current[folderId] }));
  }, []);

  const backToBrowse = useCallback(() => {
    setView("browse");
  }, []);

  const updateStatusFilter = useCallback((value: TaskStatusCategory | "all") => {
    setStatusFilter(value);
    setPage(1);
  }, []);

  const updateAssigneeFilter = useCallback((value: string) => {
    setAssigneeFilter(value);
    setPage(1);
  }, []);

  const refreshButtons = (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        void loadPanel();
        void loadTasks();
      }}
      disabled={loading || tasksLoading}
    >
      <RefreshCwIcon className={cn("size-3.5", (loading || tasksLoading) && "animate-spin")} />
      Refresh
    </Button>
  );

  const renderTaskCard = (task: Task) => (
    <TaskCard
      key={task.id}
      task={task}
      isCurrentThread={task.linkedThreadId === activeThreadId}
      busyKey={busyKey}
      onOpenDetails={setSelectedTaskId}
      onLink={setTaskLinkCurrent}
      onUnlink={setTaskLinkUnlinked}
    />
  );

  const taskDetailsDialog = selectedTask ? (
    <TaskDetailsDialog
      task={selectedTask}
      activeThreadId={activeThreadId}
      busyKey={busyKey}
      commentDraft={commentDrafts[selectedTask.id] ?? ""}
      onCommentDraftChange={(value) => {
        setCommentDrafts((current) => ({ ...current, [selectedTask.id]: value }));
      }}
      onAddComment={() => addComment(selectedTask.id)}
      onDelete={() => deleteTask(selectedTask.id)}
      onLink={() => setTaskLink(selectedTask.id, activeThreadId)}
      onUnlink={() => setTaskLink(selectedTask.id, null)}
      onCreateThread={() => void createLinkedThread(selectedTask)}
      onNavigateThread={() => {
        if (selectedTask.linkedThreadId) {
          navigateToThread(props.environmentId, selectedTask.linkedThreadId);
        }
      }}
      onOpenChange={(open) => {
        if (!open) setSelectedTaskId(null);
      }}
    />
  ) : null;

  if (loading && panel === null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (view === "tasks") {
    const activeTitle =
      listSelection.kind === "list" ? (activeList?.name ?? "Task list") : "All tasks";
    const filtersActive = statusFilter !== "all" || assigneeFilter !== "all";
    return (
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-5 p-4">
          <section className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-1.5">
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={backToBrowse}
                aria-label="Back to folders and lists"
              >
                <ArrowLeftIcon />
              </Button>
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold">{activeTitle}</h3>
                {activeList?.folderName ? (
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <FolderOpenIcon className="size-3" />
                    {activeList.folderName}
                  </p>
                ) : null}
              </div>
            </div>
            {refreshButtons}
          </section>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <div className="grid grid-cols-2 gap-2">
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                if (typeof value === "string")
                  updateStatusFilter(value as TaskStatusCategory | "all");
              }}
            >
              <SelectTrigger size="sm" aria-label="Filter by status">
                <SelectValue>
                  {statusFilter === "all" ? "All statuses" : statusCategoryLabels[statusFilter]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectItem value="all">All statuses</SelectItem>
                {(facets?.statuses ?? []).map((facet) => (
                  <SelectItem key={facet.value} value={facet.value}>
                    {statusCategoryLabels[facet.value as TaskStatusCategory] ?? facet.value}
                    <span className="ml-1 opacity-60">{facet.count}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={assigneeFilter}
              onValueChange={(value) => {
                if (typeof value === "string") updateAssigneeFilter(value);
              }}
            >
              <SelectTrigger size="sm" aria-label="Filter by assignee">
                <SelectValue>
                  {assigneeFilter === "all" ? "All assignees" : assigneeFilter}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectItem value="all">All assignees</SelectItem>
                {(facets?.assignees ?? []).map((facet) => (
                  <SelectItem key={facet.value} value={facet.value}>
                    {facet.value}
                    <span className="ml-1 opacity-60">{facet.count}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {tasksError ? <p className="text-xs text-destructive">{tasksError}</p> : null}

          {!tasksLoading && totalTasks === 0 ? (
            <div className="rounded-xl border border-dashed border-border/80 bg-card/60 p-6 text-center text-sm text-muted-foreground">
              {anyTasks ? "No tasks match the current filters." : "No tasks in this view yet."}
            </div>
          ) : null}

          {taskGroups.manual.length > 0 ? (
            <TaskGroup title="Manual" tasks={taskGroups.manual} renderTask={renderTaskCard} />
          ) : null}

          {taskGroups.clickupGroups.map(([listName, tasks]) => (
            <TaskGroup key={listName} title={listName} tasks={tasks} renderTask={renderTaskCard} />
          ))}

          {totalTasks > 0 ? (
            <div className="flex items-center justify-between gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={page <= 1 || tasksLoading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {page} of {totalPages}
                {filtersActive ? " · filters active" : ""}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={page >= totalPages || tasksLoading}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </Button>
            </div>
          ) : null}
        </div>
        {taskDetailsDialog}
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-5 p-4">
        <section className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold">Tasks</h3>
          {refreshButtons}
        </section>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        <section className="space-y-2 rounded-xl border border-border/70 bg-card/80 p-3">
          <Input
            value={listSearch}
            onChange={(event) => setListSearch(event.target.value)}
            placeholder="Search folders and lists…"
            aria-label="Search folders and lists"
          />
          {browsableListCount === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              No ClickUp folders or lists yet. Sync to import them.
            </p>
          ) : (
            <div className="space-y-0.5">
              <NavTreeRow
                icon={<SquareCheckBigIcon />}
                label="All tasks"
                count={allTasksCount}
                active={listSelection.kind === "all"}
                onClick={openAllTasks}
              />
              {visibleFolders.map((folder) => {
                const expanded =
                  listSearchQuery.length > 0 || (expandedFolders[folder.id] ?? false);
                const matchingLists = folder.lists.filter(matchesList);
                // A folder can match the search by name while none of its
                // lists do; keep the drill-down usable by falling back to all
                // of its lists.
                const folderLists =
                  listSearchQuery.length === 0 || matchingLists.length === 0
                    ? folder.lists
                    : matchingLists;
                return (
                  <div key={folder.id}>
                    <NavTreeRow
                      icon={expanded ? <FolderOpenIcon /> : <FolderIcon />}
                      label={folder.name}
                      count={folder.count}
                      trailing={
                        <ChevronRightIcon
                          className={cn(
                            "size-3.5 shrink-0 transition-transform",
                            expanded && "rotate-90",
                          )}
                        />
                      }
                      onClick={() => toggleFolder(folder.id)}
                    />
                    {expanded ? (
                      <div className="ml-3 space-y-0.5 border-l border-border/70 pl-2">
                        {folderLists.map((list) => (
                          <NavTreeRow
                            key={list.id}
                            icon={<ListIcon />}
                            label={list.name}
                            count={list.count}
                            active={
                              listSelection.kind === "list" && listSelection.listId === list.id
                            }
                            onClick={() => openTaskList(list.id)}
                          />
                        ))}
                        {folderLists.length === 0 ? (
                          <p className="px-2 py-1 text-xs text-muted-foreground">
                            No lists in this folder.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {visibleOrphans.map((list) => (
                <NavTreeRow
                  key={list.id}
                  icon={<ListIcon />}
                  label={list.name}
                  count={list.count}
                  active={listSelection.kind === "list" && listSelection.listId === list.id}
                  onClick={() => openTaskList(list.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border/70 bg-card/80 p-3">
          <div className="flex gap-2">
            <Input
              value={manualTitle}
              onChange={(event) => setManualTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") createManual();
              }}
              placeholder="Add a task for this project"
            />
            <Button
              size="sm"
              onClick={createManual}
              disabled={busyKey === "manual-create" || manualTitle.trim().length === 0}
            >
              {busyKey === "manual-create" ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : null}
              Add
            </Button>
          </div>
          <Textarea
            value={manualDescription}
            onChange={(event) => setManualDescription(event.target.value)}
            placeholder="Optional context"
            className="mt-2 min-h-9 border-none bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
        </section>

        <section className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/80 px-3 py-2.5">
          <div className="min-w-0 text-xs text-muted-foreground">
            {!tokenConfigured ? (
              <span>ClickUp not connected.</span>
            ) : clickup?.lastSyncError ? (
              <span className="text-destructive">Sync failed: {clickup.lastSyncError}</span>
            ) : clickup?.lastSyncAt ? (
              <span>Last synced {new Date(clickup.lastSyncAt).toLocaleString()}</span>
            ) : (
              <span>Connected. Never synced.</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {tokenConfigured ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={syncNow}
                disabled={busyKey === "clickup-sync"}
              >
                {busyKey === "clickup-sync" ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : null}
                Sync
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void navigate({ to: "/settings/connections", hash: "clickup" })}
            >
              Configure
            </Button>
          </div>
        </section>
      </div>
    </ScrollArea>
  );
}
