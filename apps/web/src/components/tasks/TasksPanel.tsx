import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
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
  SettingsIcon,
  SquareCheckBigIcon,
  UserIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import {
  addTaskNote,
  fetchTaskPanel,
  fetchTasksQuery,
  setTaskLinkedThread,
  syncClickUpTasks,
} from "./taskApi";
import { deleteTask as deleteTaskRequest } from "./taskApi";
import {
  TaskDetailsActions,
  TaskDetailsBody,
  TaskNoteComposer,
  TaskStatusBadge,
} from "./TaskDetailsDialog";
import { notifyTasksChanged, requestTaskPanelView, useTaskPanelViewRequest } from "./taskLinkStore";
import { waitForServerThreadDetail } from "../ChatView.logic";
import { useRelativeTimeTick } from "~/components/settings/settingsLayout";
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
import { usePreparedConnection } from "~/state/session";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useRightPanelStore } from "~/rightPanelStore";
import { newThreadId } from "~/lib/utils";
import { cn } from "~/lib/utils";

interface TaskPanelThreadContext {
  readonly id: string;
  readonly modelSelection: EnvironmentThreadShell["modelSelection"];
  readonly runtimeMode: EnvironmentThreadShell["runtimeMode"];
  readonly interactionMode: EnvironmentThreadShell["interactionMode"];
}

const TASKS_PAGE_SIZE = 10;
// How often the visible view re-reads the local task store while the panel is open.
const VIEW_POLL_INTERVAL_MS = 10_000;
// Opening the panel on data older than this quietly starts a background sync.
const CLICKUP_AUTO_SYNC_MAX_AGE_MS = 5 * 60_000;

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
          {task.notes.length}
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
  // Re-render on a slow tick so the header's relative "last synced" label stays honest.
  useRelativeTimeTick(30_000);
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const projectId = ProjectId.make(props.projectId);
  const activeThreadId = ThreadId.make(props.activeThread.id);
  const [panel, setPanel] = useState<TaskPanel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [tasksResult, setTasksResult] = useState<TaskQueryResult | null>(null);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [listSelection, setListSelection] = useState<ListSelection>({ kind: "all" });
  const [view, setView] = useState<"browse" | "tasks" | "detail">("browse");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [listSearch, setListSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatusCategory | "all">("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  const clickup = panel?.clickup ?? null;
  const tokenConfigured = clickup?.tokenConfigured ?? false;

  const loadPanel = useCallback(
    async (silent = false) => {
      if (prepared._tag === "None") {
        setPanel(null);
        setLoading(false);
        setError("Waiting for an authenticated environment connection.");
        return;
      }
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        setPanel(await fetchTaskPanel(prepared.value));
      } catch (cause) {
        if (!silent) setError(cause instanceof Error ? cause.message : "Failed to load tasks.");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [prepared],
  );

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

  const loadTasks = useCallback(
    async (silent = false) => {
      if (prepared._tag === "None") {
        setTasksResult(null);
        setTasksLoading(false);
        return;
      }
      if (!silent) {
        setTasksLoading(true);
        setTasksError(null);
      }
      try {
        setTasksResult(await fetchTasksQuery(prepared.value, queryFilter));
      } catch (cause) {
        if (!silent)
          setTasksError(cause instanceof Error ? cause.message : "Failed to load tasks.");
      } finally {
        if (!silent) setTasksLoading(false);
      }
    },
    [prepared, queryFilter],
  );

  useEffect(() => {
    void loadPanel();
  }, [loadPanel]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  // Keep the visible view fresh: the query is already scoped to the current
  // list and filters, and panel reads are fully local, so each tick only
  // refetches what is on screen. Silent loads never flash loading states.
  useEffect(() => {
    if (prepared._tag === "None") return;
    const id = setInterval(() => {
      if (document.hidden) return;
      void loadPanel(true);
      void loadTasks(true);
    }, VIEW_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loadPanel, loadTasks]);

  // The poll only refetches local rows; freshness from ClickUp comes from a
  // background sync. Kick one quietly when the panel opens on stale data —
  // the poll surfaces lastSyncAt/lastSyncError, so no toasts here.
  const lastSyncAt = clickup?.lastSyncAt ?? null;
  const autoSyncAttemptedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tokenConfigured || busyKey === "clickup-sync") return;
    const staleKey = lastSyncAt ?? "never";
    if (autoSyncAttemptedRef.current === staleKey) return;
    const isStale =
      lastSyncAt === null ||
      Date.now() - new Date(lastSyncAt).getTime() > CLICKUP_AUTO_SYNC_MAX_AGE_MS;
    if (!isStale || prepared._tag === "None") return;
    autoSyncAttemptedRef.current = staleKey;
    void syncClickUpTasks(prepared.value)
      .then(() => loadPanel(true))
      .catch(() => {
        // A failed kick is reported by the next panel poll via lastSyncError.
      });
  }, [busyKey, lastSyncAt, loadPanel, prepared, tokenConfigured]);

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

  const addNote = useCallback(
    (taskId: TaskId) => {
      const body = noteDrafts[taskId]?.trim();
      if (!body) return;
      void runMutation(`note:${taskId}`, async (connection) => {
        await addTaskNote(connection, taskId, body);
        setNoteDrafts((current) => ({ ...current, [taskId]: "" }));
      });
    },
    [noteDrafts, runMutation],
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
      const threadRef = scopeThreadRef(props.environmentId, threadId);
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
      // The thread route bounces to home while the thread detail is still
      // syncing, so wait for the snapshot before navigating.
      const synced = await waitForServerThreadDetail(threadRef);
      useRightPanelStore.getState().open(threadRef, "tasks");
      await navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: props.environmentId,
          threadId,
        },
      });
      if (synced) {
        requestTaskPanelView(props.environmentId, task.id);
      }
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

  // The detail view must not depend on the current query page: a sync bumps
  // updated_at on every synced row and can push the selected task off page 1,
  // and a view request can land before the first query resolves. Prefer the
  // page's copy; otherwise fetch the task directly by id.
  useEffect(() => {
    if (!selectedTaskId) {
      setDetailTask(null);
      setDetailLoading(false);
      return;
    }
    const inPage = tasksResult?.tasks.find((task) => task.id === selectedTaskId);
    if (inPage) {
      setDetailTask(inPage);
      setDetailLoading(false);
      return;
    }
    if (prepared._tag === "None") {
      setDetailTask(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void fetchTasksQuery(prepared.value, {
      taskIds: [selectedTaskId],
      page: 1,
      pageSize: 1,
    })
      .then((result) => {
        // Accept only the requested row: a server that dropped the filter
        // (older contract) would answer with the top of the list instead.
        const match = result.tasks.find((task) => task.id === selectedTaskId) ?? null;
        if (!cancelled) setDetailTask(match);
      })
      .catch(() => {
        if (!cancelled) setDetailTask(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [prepared, selectedTaskId, tasksResult]);

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
    setSelectedTaskId(null);
    setView("tasks");
  }, []);

  const openTaskList = useCallback((listId: string) => {
    setListSelection({ kind: "list", listId });
    setPage(1);
    setSelectedTaskId(null);
    setView("tasks");
  }, []);

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((current) => ({ ...current, [folderId]: !current[folderId] }));
  }, []);

  const backToBrowse = useCallback(() => {
    setView("browse");
  }, []);

  const openTaskDetail = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    setView("detail");
  }, []);

  // The header indicator's dialog hands its task over to this panel.
  useTaskPanelViewRequest(props.environmentId, openTaskDetail);

  // Detail header breadcrumb: the task's own parent list, so a task opened
  // from a thread link can still jump back to its list regardless of the
  // panel's current selection. Manual tasks have no list and fall back to
  // "All tasks".
  const detailBreadcrumb = useMemo(() => {
    if (!detailTask) return null;
    const externalListId = detailTask.externalListId;
    if (externalListId === null) {
      return { key: "all", folderName: null, label: "All tasks", open: openAllTasks };
    }
    const facetList = (facets?.lists ?? []).find((list) => list.id === externalListId) ?? null;
    return {
      key: externalListId,
      folderName: facetList?.folderName ?? null,
      label: detailTask.externalListName ?? facetList?.name ?? "Task list",
      open: () => openTaskList(externalListId),
    };
  }, [detailTask, facets?.lists, openAllTasks, openTaskList]);

  const updateStatusFilter = useCallback((value: TaskStatusCategory | "all") => {
    setStatusFilter(value);
    setPage(1);
  }, []);

  const updateAssigneeFilter = useCallback((value: string) => {
    setAssigneeFilter(value);
    setPage(1);
  }, []);

  const isSyncing = busyKey === "clickup-sync";
  const lastSyncRelative = lastSyncAt === null ? null : formatRelativeTimeLabel(lastSyncAt);
  const lastSyncError = clickup?.lastSyncError ?? null;
  const headerActions = (
    <div className="flex shrink-0 items-center gap-2">
      {tokenConfigured ? (
        <>
          {isSyncing ? (
            <span className="text-xs text-muted-foreground">Syncing…</span>
          ) : lastSyncError ? (
            <span
              className="truncate text-xs text-destructive"
              title={`Sync failed: ${lastSyncError}`}
            >
              Sync failed
            </span>
          ) : lastSyncAt !== null && lastSyncRelative ? (
            <span
              className="text-xs text-muted-foreground"
              title={`Last synced ${new Date(lastSyncAt).toLocaleString()}`}
            >
              Last synced {lastSyncRelative}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Never synced</span>
          )}
          <Button size="sm" variant="ghost" onClick={syncNow} disabled={isSyncing}>
            <RefreshCwIcon className={cn("size-3.5", isSyncing && "animate-spin")} />
            Sync
          </Button>
        </>
      ) : null}
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={() => void navigate({ to: "/settings/connections", hash: "clickup" })}
        aria-label="ClickUp settings"
      >
        <SettingsIcon />
      </Button>
    </div>
  );

  const renderTaskCard = (task: Task) => (
    <TaskCard
      key={task.id}
      task={task}
      isCurrentThread={task.linkedThreadId === activeThreadId}
      busyKey={busyKey}
      onOpenDetails={openTaskDetail}
      onLink={setTaskLinkCurrent}
      onUnlink={setTaskLinkUnlinked}
    />
  );

  const taskDetailsActions = (task: Task) => (
    <TaskDetailsActions
      task={task}
      activeThreadId={activeThreadId}
      environmentId={props.environmentId}
      busyKey={busyKey}
      onDelete={() => deleteTask(task.id)}
      onLink={() => setTaskLink(task.id, activeThreadId)}
      onUnlink={() => setTaskLink(task.id, null)}
      onCreateThread={() => void createLinkedThread(task)}
      onNavigateThread={() => {
        if (task.linkedThreadId) {
          navigateToThread(props.environmentId, task.linkedThreadId);
        }
      }}
    />
  );

  if (loading && panel === null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (view === "detail") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-5 p-4">
            <section className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-1.5">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => {
                    setSelectedTaskId(null);
                    setView("tasks");
                  }}
                  aria-label="Back to tasks"
                >
                  <ArrowLeftIcon />
                </Button>
                {detailBreadcrumb ? (
                  <button
                    key={detailBreadcrumb.key}
                    type="button"
                    onClick={detailBreadcrumb.open}
                    aria-label={`Back to ${detailBreadcrumb.label}`}
                    className="flex min-w-0 items-center gap-1 rounded-lg px-1.5 py-1 text-sm text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
                  >
                    {detailBreadcrumb.folderName ? (
                      <FolderOpenIcon className="size-3.5 shrink-0" />
                    ) : detailTask?.externalListId ? (
                      <ListIcon className="size-3.5 shrink-0" />
                    ) : (
                      <SquareCheckBigIcon className="size-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 truncate">
                      {detailBreadcrumb.folderName
                        ? `${detailBreadcrumb.folderName} / ${detailBreadcrumb.label}`
                        : detailBreadcrumb.label}
                    </span>
                  </button>
                ) : null}
              </div>
              {detailTask ? taskDetailsActions(detailTask) : null}
            </section>

            {error ? <p className="text-xs text-destructive">{error}</p> : null}

            {detailTask ? (
              <>
                <h2 className="wrap-break-word text-base font-semibold">{detailTask.title}</h2>
                <TaskDetailsBody task={detailTask} environmentId={props.environmentId} />
              </>
            ) : detailLoading ? (
              <div className="flex justify-center py-6">
                <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">This task is no longer available.</p>
            )}
          </div>
        </ScrollArea>
        {detailTask ? (
          <div className="border-t bg-muted/72 p-4">
            <TaskNoteComposer
              task={detailTask}
              busyKey={busyKey}
              noteDraft={noteDrafts[detailTask.id] ?? ""}
              onNoteDraftChange={(value) => {
                setNoteDrafts((current) => ({ ...current, [detailTask.id]: value }));
              }}
              onAddNote={() => addNote(detailTask.id)}
            />
          </div>
        ) : null}
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
            {headerActions}
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
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-5 p-4">
        <section className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold">Tasks</h3>
          {headerActions}
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
      </div>
    </ScrollArea>
  );
}
