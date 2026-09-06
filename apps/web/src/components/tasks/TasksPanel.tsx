import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  Task,
  TaskId,
  TaskListFacet,
  TaskPanel,
  TaskProviderState,
  TaskQueryFilter,
  TaskQueryResult,
  TaskStatus,
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
  FolderPlusIcon,
  Link2Icon,
  LinkIcon,
  ListIcon,
  ListPlusIcon,
  Loader2Icon,
  MessageSquareIcon,
  PlusIcon,
  RefreshCwIcon,
  SettingsIcon,
  SquareCheckBigIcon,
  Trash2Icon,
  UserIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import {
  addTaskNote,
  createManualTask,
  createTaskFolder,
  createTaskList,
  deleteTaskFolder,
  deleteTaskList,
  fetchTaskPanel,
  fetchTaskStatuses,
  fetchTasksQuery,
  setTaskLinkedThread,
  syncProviderTasks,
  updateManualTask,
} from "./taskApi";
import { deleteTask as deleteTaskRequest } from "./taskApi";
import {
  TaskDetailsActions,
  TaskDetailsBody,
  TaskNoteComposer,
  TaskStatusBadge,
  TaskStatusBadgeMenu,
} from "./TaskDetailsDialog";
import { notifyTasksChanged, requestTaskPanelView, useTaskPanelViewRequest } from "./taskLinkStore";
import {
  CreateFolderDialog,
  CreateListDialog,
  CreateTaskDialog,
  DeleteTreeItemDialog,
  EditTaskDialog,
  type TaskListOptionGroup,
  type TaskTreeDeleteTarget,
} from "./TaskDialogs";
import { waitForServerThreadDetail } from "../ChatView.logic";
import { sortLogicalProjectsForSidebar } from "../Sidebar.logic";
import { useRelativeTimeTick } from "~/components/settings/settingsLayout";
import { openCommandPalette } from "~/commandPaletteBus";
import { useClientSettings } from "~/hooks/useSettings";
import { selectProjectGroupingSettings } from "~/logicalProject";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
} from "~/sidebarProjectGrouping";
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
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
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
// Typing in the search box waits for this quiet period before querying.
const TASK_SEARCH_DEBOUNCE_MS = 150;
// How often the visible view re-reads the local task store while the panel is open.
const VIEW_POLL_INTERVAL_MS = 10_000;
// Opening the panel on data older than this quietly starts a background sync.
const PROVIDER_AUTO_SYNC_MAX_AGE_MS = 5 * 60_000;

type ListSelection = { readonly kind: "all" } | { readonly kind: "list"; listId: string };

interface TaskTreeFolder {
  id: string;
  name: string;
  provider: string;
  count: number;
  lists: TaskListFacet[];
}

/**
 * One top-level group in the browse tree: the manual section renders directly,
 * while each provider's synced content collapses under a single folder node.
 */
interface TaskTreeSection {
  key: string;
  label: string;
  isProvider: boolean;
  folders: TaskTreeFolder[];
  orphanLists: TaskListFacet[];
  count: number;
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
  statuses: ReadonlyArray<TaskStatus>;
  onOpenDetails: (taskId: string) => void;
  onLink: (taskId: TaskId) => void;
  onUnlink: (taskId: TaskId) => void;
  onStatusChange: (taskId: TaskId, statusId: string) => void;
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
        {task.provider === "manual" && props.statuses.length > 0 ? (
          <TaskStatusBadgeMenu
            task={task}
            statuses={props.statuses}
            busy={props.busyKey === `task-update:${task.id}`}
            onStatusChange={(statusId) => props.onStatusChange(task.id, statusId)}
          />
        ) : (
          <TaskStatusBadge task={task} />
        )}
        {task.provider === "manual" ? (
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
        {task.listName ? (
          <span className="inline-flex min-w-0 items-center gap-1">
            <ListIcon className="size-3 shrink-0" />
            <span className="truncate">{task.listName}</span>
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
              aria-label={
                props.isCurrentThread ? "Unlink from this thread" : "Unlink from linked thread"
              }
              title={
                props.isCurrentThread ? "Unlink from this thread" : "Unlink from linked thread"
              }
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
              aria-label="Open at the provider"
              title="Open at the provider"
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
  /**
   * Hover-revealed row actions. They overlay the far right on hover; the
   * counter stays next to the name, and the trailing chevron is dropped on
   * such rows (the folder icon carries the expanded state).
   */
  actions?: ReactNode;
  onClick: () => void;
}) {
  return (
    <div className="group/row relative flex w-full items-center">
      <button
        type="button"
        onClick={props.onClick}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-lg py-1.5 pl-2 pr-2 text-left text-sm transition",
          props.actions && "pr-11",
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
        <span className="min-w-0 truncate">{props.label}</span>
        {typeof props.count === "number" ? (
          <span className="shrink-0 text-xs tabular-nums opacity-60">{props.count}</span>
        ) : null}
        {/* The spacer keeps the counter next to the name while the hover
            region and the trailing chevron still reach the far edge. */}
        <span className="min-w-2 flex-1" />
        {props.actions ? null : props.trailing}
      </button>
      {props.actions ? (
        <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center opacity-0 transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100">
          {props.actions}
        </div>
      ) : null}
    </div>
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
  const [taskStatuses, setTaskStatuses] = useState<ReadonlyArray<TaskStatus>>([]);
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
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [listSearch, setListSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatusCategory | "all">("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [taskSearchInput, setTaskSearchInput] = useState("");
  const [taskSearchQuery, setTaskSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [editTaskOpen, setEditTaskOpen] = useState(false);
  const [createListOpen, setCreateListOpen] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TaskTreeDeleteTarget | null>(null);
  // List ids a pending folder delete takes with it, so the current selection
  // can be dropped if it points into the deleted subtree.
  const deleteTargetListIdsRef = useRef<ReadonlyArray<string>>([]);
  // Where the detail view was opened from, so deleting a task lands back there.
  const viewBeforeDetailRef = useRef<"browse" | "tasks">("tasks");

  // Providers with a stored credential are syncable; today that is ClickUp,
  // tomorrow Linear and friends.
  const connectedProviders = useMemo<TaskProviderState[]>(
    () => (panel?.providers ?? []).filter((provider) => provider.credentialConfigured),
    [panel?.providers],
  );

  // Target options for "Create thread": the same logical project groups the
  // new-thread picker uses, with the current project preferred first.
  const projects = useProjects();
  const threadShells = useThreadShells();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projectSortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const threadProjectOptions = useMemo(() => {
    const environmentLabelById = new Map(
      environments.map((environment) => [environment.environmentId, environment.label] as const),
    );
    return buildSidebarProjectPickerEntries({
      groups: sortLogicalProjectsForSidebar(
        buildSidebarProjectSnapshots({
          projects,
          settings: projectGroupingSettings,
          primaryEnvironmentId,
          resolveEnvironmentLabel: (environmentId) =>
            environmentLabelById.get(environmentId) ?? null,
        }),
        threadShells,
        projectSortOrder,
      ),
      preferredProjectRef: scopeProjectRef(props.environmentId, projectId),
    });
  }, [
    environments,
    primaryEnvironmentId,
    projectGroupingSettings,
    projectSortOrder,
    props.environmentId,
    projectId,
    projects,
    threadShells,
  ]);
  const syncStatusProvider = useMemo<TaskProviderState | null>(() => {
    const connected = panel?.providers.filter((provider) => provider.credentialConfigured) ?? [];
    return (
      connected
        .filter((provider) => provider.lastSyncAt !== null)
        .toSorted((left, right) =>
          (right.lastSyncAt ?? "").localeCompare(left.lastSyncAt ?? ""),
        )[0] ??
      connected[0] ??
      null
    );
  }, [panel?.providers]);

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
        // Statuses ride along for the create dialog; a failure here must not
        // take the whole panel down, so it only clears the picker.
        try {
          setTaskStatuses((await fetchTaskStatuses(prepared.value)).statuses);
        } catch {
          setTaskStatuses([]);
        }
      } catch (cause) {
        if (!silent) setError(cause instanceof Error ? cause.message : "Failed to load tasks.");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [prepared],
  );

  // Debounced task search: landing on a new query restarts pagination.
  useEffect(() => {
    const id = setTimeout(() => {
      setTaskSearchQuery(taskSearchInput);
      setPage(1);
    }, TASK_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [taskSearchInput]);

  const queryFilter = useMemo<TaskQueryFilter>(() => {
    const query = taskSearchQuery.trim();
    return {
      listIds: listSelection.kind === "list" ? [listSelection.listId] : [],
      statuses: statusFilter === "all" ? [] : [statusFilter],
      assignees: assigneeFilter === "all" ? [] : [assigneeFilter],
      query: query.length > 0 ? query : undefined,
      page,
      pageSize: TASKS_PAGE_SIZE,
    };
  }, [assigneeFilter, listSelection, page, statusFilter, taskSearchQuery]);

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

  // The poll only refetches local rows; freshness from providers comes from
  // background syncs. Kick one quietly per connected provider when the panel
  // opens on stale data — the poll surfaces lastSyncAt/lastSyncError, so no
  // toasts here.
  const lastSyncAt = syncStatusProvider?.lastSyncAt ?? null;
  const autoSyncAttemptedRef = useRef<string | null>(null);
  useEffect(() => {
    if (busyKey === "provider-sync" || connectedProviders.length === 0) return;
    const staleKey = connectedProviders.map((provider) => provider.lastSyncAt ?? "never").join("|");
    if (autoSyncAttemptedRef.current === staleKey) return;
    const isStale = connectedProviders.some(
      (provider) =>
        provider.lastSyncAt === null ||
        Date.now() - new Date(provider.lastSyncAt).getTime() > PROVIDER_AUTO_SYNC_MAX_AGE_MS,
    );
    if (!isStale || prepared._tag === "None") return;
    autoSyncAttemptedRef.current = staleKey;
    for (const provider of connectedProviders) {
      void syncProviderTasks(prepared.value, provider.providerId)
        .then(() => loadPanel(true))
        .catch(() => {
          // A failed kick is reported by the next panel poll via lastSyncError.
        });
    }
  }, [busyKey, connectedProviders, loadPanel, prepared]);

  const runMutation = useCallback(
    async (key: string, action: (prepared: PreparedConnection) => Promise<void | TaskPanel>) => {
      if (prepared._tag === "None") {
        setError("Waiting for an authenticated environment connection.");
        return false;
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
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Task request failed.");
        if (key === "provider-sync" || key === "provider-credential") {
          try {
            await loadPanel();
          } catch {
            // Keep the original mutation error visible if the follow-up refresh also fails.
          }
        }
        return false;
      } finally {
        setBusyKey(null);
      }
    },
    [loadPanel, loadTasks, prepared, props.environmentId],
  );

  const syncNow = useCallback(() => {
    void runMutation("provider-sync", async (connection) => {
      // The server starts each sync in a detached fiber and answers right
      // away. Poll the panel until lastSyncAt moves (or an error lands)
      // instead of holding this request open, where any hop can cut it.
      for (const provider of connectedProviders) {
        await syncProviderTasks(connection, provider.providerId);
      }
      const initialLastSyncAt = syncStatusProvider?.lastSyncAt ?? null;
      const initialLastSyncError = syncStatusProvider?.lastSyncError ?? null;
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
        const latestStatus = latest?.providers.find(
          (provider) => provider.providerId === syncStatusProvider?.providerId,
        );
        const lastSyncAt = latestStatus?.lastSyncAt ?? null;
        const lastSyncError = latestStatus?.lastSyncError ?? null;
        if (
          (lastSyncAt !== null && lastSyncAt !== initialLastSyncAt) ||
          (lastSyncError !== null && lastSyncError !== initialLastSyncError)
        ) {
          break;
        }
      }
      return latest ?? undefined;
    });
  }, [connectedProviders, panel, runMutation, syncStatusProvider]);

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
      // Leave the detail view at once and return to where it was opened
      // from; the refresh below confirms the deletion, and a failure shows
      // up as the panel's error line.
      setSelectedTaskId((current) => (current === taskId ? null : current));
      setView((current) => (current === "detail" ? viewBeforeDetailRef.current : current));
      void runMutation(`task-delete:${taskId}`, async (connection) => {
        await deleteTaskRequest(connection, taskId);
      });
    },
    [runMutation],
  );

  const createLinkedThread = useCallback(
    async (task: Task, targetProject: { environmentId: EnvironmentId; projectId: ProjectId }) => {
      const threadId = newThreadId();
      const threadRef = scopeThreadRef(targetProject.environmentId, threadId);
      const createResult = await createThread({
        environmentId: targetProject.environmentId,
        input: {
          threadId,
          projectId: targetProject.projectId,
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
          environmentId: targetProject.environmentId,
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
      setTaskLink,
    ],
  );

  const requestCreateThread = useCallback(
    (task: Task) => {
      const createForProject = (project: { environmentId: EnvironmentId; projectId: ProjectId }) =>
        void createLinkedThread(task, project);
      // One option means there is nothing to choose; skip the picker and
      // fall back to the current project when the picker has no entries.
      const singleOption = threadProjectOptions.length <= 1 ? threadProjectOptions[0] : null;
      if (singleOption) {
        createForProject({
          environmentId: singleOption.targetProject.environmentId,
          projectId: ProjectId.make(singleOption.targetProject.id),
        });
        return;
      }
      // The sidebar's "New thread in..." picker; the picked project routes
      // back into linked-thread creation.
      openCommandPalette({
        open: "new-task-thread-in",
        onProjectPick: (project) =>
          createForProject({
            environmentId: project.environmentId,
            projectId: ProjectId.make(project.id),
          }),
      });
    },
    [createLinkedThread, threadProjectOptions],
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
    const manual = tasks.filter((task) => task.provider === "manual");
    const byList = new Map<string, Task[]>();
    for (const task of tasks) {
      if (task.provider === "manual") continue;
      const key = task.listName ?? "Provider";
      const bucket = byList.get(key);
      if (bucket) {
        bucket.push(task);
      } else {
        byList.set(key, [task]);
      }
    }
    return {
      manual,
      providerGroups: [...byList.entries()].toSorted(([left], [right]) =>
        left.localeCompare(right),
      ),
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
  const projectCwd = useMemo(
    () => projects.find((project) => project.id === projectId)?.workspaceRoot ?? null,
    [projects, projectId],
  );
  const totalPages = Math.max(1, Math.ceil(totalTasks / TASKS_PAGE_SIZE));
  const anyTasks = (facets?.statuses ?? []).some((facet) => facet.count > 0);

  // Providers organize tasks as Workspace > Space > Folder > List > Task;
  // facets carry the list level with its folder path. Manual folders/lists
  // browse at the top level, and every provider's synced content collapses
  // under one folder node so the two never mix.
  const listTree = useMemo<TaskTreeSection[]>(() => {
    const lists = facets?.lists ?? [];
    const foldersById = new Map<string, TaskTreeFolder>();
    for (const folder of facets?.folders ?? []) {
      foldersById.set(folder.id, {
        id: folder.id,
        name: folder.name,
        provider: folder.provider,
        count: 0,
        lists: [],
      });
    }
    // A folder only surfaces through its lists on older servers that do not
    // send the folders facet yet.
    for (const list of lists) {
      if (list.folderId && list.folderName && !foldersById.has(list.folderId)) {
        foldersById.set(list.folderId, {
          id: list.folderId,
          name: list.folderName,
          provider: list.provider,
          count: 0,
          lists: [],
        });
      }
    }
    const folderProvider = new Map<string, string>();
    for (const folder of facets?.folders ?? []) folderProvider.set(folder.id, folder.provider);

    const providerLabel = (providerId: string) =>
      (panel?.providers ?? []).find((provider) => provider.providerId === providerId)?.label ??
      providerId;

    const manual: TaskTreeSection = {
      key: "manual",
      label: "Manual",
      isProvider: false,
      folders: [],
      orphanLists: [],
      count: 0,
    };
    const providers = new Map<string, TaskTreeSection>();
    const sectionFor = (providerId: string): TaskTreeSection => {
      if (providerId === "manual") return manual;
      const existing = providers.get(providerId);
      if (existing) return existing;
      const created: TaskTreeSection = {
        key: `provider:${providerId}`,
        label: providerLabel(providerId),
        isProvider: true,
        folders: [],
        orphanLists: [],
        count: 0,
      };
      providers.set(providerId, created);
      return created;
    };

    for (const list of lists) {
      const folder = list.folderId ? foldersById.get(list.folderId) : undefined;
      if (folder) {
        folder.lists.push(list);
        folder.count += list.count;
      } else {
        sectionFor(list.provider).orphanLists.push(list);
      }
    }
    for (const folder of foldersById.values()) {
      const provider = folderProvider.get(folder.id) ?? folder.lists[0]?.provider ?? "manual";
      sectionFor(provider).folders.push(folder);
    }
    const sections: TaskTreeSection[] = [manual, ...providers.values()];
    for (const section of sections) {
      section.folders.sort((left, right) => left.name.localeCompare(right.name));
      section.orphanLists.sort((left, right) => left.name.localeCompare(right.name));
      section.count =
        section.folders.reduce((total, folder) => total + folder.count, 0) +
        section.orphanLists.reduce((total, list) => total + list.count, 0);
    }
    sections.sort((left, right) => {
      if (left.isProvider !== right.isProvider) return left.isProvider ? 1 : -1;
      return left.label.localeCompare(right.label);
    });
    return sections;
  }, [facets?.folders, facets?.lists, panel?.providers]);

  const listSearchQuery = listSearch.trim().toLowerCase();
  const matchesList = useCallback(
    (list: TaskListFacet) =>
      listSearchQuery.length === 0 || list.name.toLowerCase().includes(listSearchQuery),
    [listSearchQuery],
  );
  const matchesFolder = useCallback(
    (folder: TaskTreeFolder) =>
      listSearchQuery.length === 0 ||
      folder.name.toLowerCase().includes(listSearchQuery) ||
      folder.lists.some(matchesList),
    [listSearchQuery, matchesList],
  );

  const visibleSections = useMemo<TaskTreeSection[]>(() => {
    if (listSearchQuery.length === 0) return listTree;
    return listTree
      .filter(
        (section) =>
          !section.isProvider ||
          section.label.toLowerCase().includes(listSearchQuery) ||
          section.folders.some(matchesFolder) ||
          section.orphanLists.some(matchesList),
      )
      .map((section) => ({
        ...section,
        folders: section.folders.filter(matchesFolder).map((folder) => {
          const matchingLists = folder.lists.filter(matchesList);
          return {
            ...folder,
            lists: matchingLists.length === 0 ? folder.lists : matchingLists,
          };
        }),
        orphanLists: section.orphanLists.filter(matchesList),
      }));
  }, [listSearchQuery, listTree, matchesFolder, matchesList]);

  const manualSection = visibleSections.find((section) => !section.isProvider) ?? null;
  const providerSections = useMemo(
    () => visibleSections.filter((section) => section.isProvider),
    [visibleSections],
  );

  const manualFolders = useMemo(
    () => (facets?.folders ?? []).filter((folder) => folder.provider === "manual"),
    [facets?.folders],
  );

  // Task-create target groups: every list, labeled by its folder path so a
  // ClickUp list and a manual list with the same name stay distinguishable.
  const taskOptionGroups = useMemo<TaskListOptionGroup[]>(() => {
    const lists = facets?.lists ?? [];
    const folderLabel = (list: TaskListFacet): string => {
      if (!list.folderId) return "No folder";
      const provider =
        (facets?.folders ?? []).find((folder) => folder.id === list.folderId)?.provider ??
        list.provider;
      const folderName =
        (facets?.folders ?? []).find((folder) => folder.id === list.folderId)?.name ??
        list.folderName ??
        "";
      if (provider === "manual" || list.provider === "manual") return folderName;
      const label =
        (panel?.providers ?? []).find((candidate) => candidate.providerId === provider)?.label ??
        provider;
      return `${label} / ${folderName}`;
    };
    const groups = new Map<string, { id: string; label: string; lists: TaskListFacet[] }>();
    for (const list of lists) {
      const key = list.folderId ?? "none";
      const group = groups.get(key);
      if (group) {
        group.lists.push(list);
      } else {
        groups.set(key, { id: key, label: folderLabel(list), lists: [list] });
      }
    }
    return [...groups.values()];
  }, [facets?.folders, facets?.lists, panel?.providers]);

  // A folder counts as browsable content even when empty, so a freshly
  // created folder renders immediately instead of the empty state.
  const hasTreeContent = listTree.some(
    (section) => section.folders.length > 0 || section.orphanLists.length > 0,
  );
  const allTasksCount = listTree.reduce((total, section) => total + section.count, 0);

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

  const toggleNode = useCallback((nodeId: string) => {
    setExpandedNodes((current) => ({ ...current, [nodeId]: !current[nodeId] }));
  }, []);

  const backToBrowse = useCallback(() => {
    setView("browse");
  }, []);

  const backFromDetail = useCallback(() => {
    setSelectedTaskId(null);
    setView(viewBeforeDetailRef.current);
  }, []);

  const openTaskDetail = useCallback(
    (taskId: string) => {
      if (view !== "detail") viewBeforeDetailRef.current = view;
      setSelectedTaskId(taskId);
      setView("detail");
    },
    [view],
  );

  // The header indicator's dialog hands its task over to this panel.
  useTaskPanelViewRequest(props.environmentId, openTaskDetail);

  // Detail header breadcrumb: the task's own parent list, so a task opened
  // from a thread link can still jump back to its list regardless of the
  // panel's current selection. Tasks without a list fall back to "All tasks".
  const detailBreadcrumb = useMemo(() => {
    if (!detailTask) return null;
    const listId = detailTask.listId;
    if (listId === null) {
      return { key: "all", folderName: null, label: "All tasks", open: openAllTasks };
    }
    const facetList = (facets?.lists ?? []).find((list) => list.id === listId) ?? null;
    return {
      key: listId,
      folderName: facetList?.folderName ?? null,
      label: detailTask.listName ?? facetList?.name ?? "Task list",
      open: () => openTaskList(listId),
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

  const createTask = useCallback(() => {
    const title = newTaskTitle.trim();
    if (!title) return;
    void runMutation("task-create", async (connection) => {
      // A manual task lands in the list currently browsed, whatever syncs it;
      // from "All tasks" it stays unassigned.
      await createManualTask(connection, {
        title,
        ...(listSelection.kind === "list" ? { listId: listSelection.listId } : {}),
      });
      setNewTaskTitle("");
    });
  }, [listSelection, newTaskTitle, runMutation]);

  const submitCreateTask = useCallback(
    (input: { title: string; description?: string; listId?: string }) =>
      runMutation("task-create", async (connection) => {
        await createManualTask(connection, input);
      }),
    [runMutation],
  );

  const submitEditTask = useCallback(
    (taskId: TaskId, input: { title: string; description?: string; statusId?: string }) =>
      runMutation(`task-update:${taskId}`, async (connection) => {
        await updateManualTask(connection, { taskId, ...input });
      }),
    [runMutation],
  );

  const changeTaskStatus = useCallback(
    (taskId: TaskId, statusId: string) => {
      void runMutation(`task-update:${taskId}`, async (connection) => {
        await updateManualTask(connection, { taskId, statusId });
      });
    },
    [runMutation],
  );

  const submitCreateList = useCallback(
    (input: { name: string; folderId?: string }) =>
      runMutation("list-create", async (connection) => {
        await createTaskList(connection, input);
      }),
    [runMutation],
  );

  const submitCreateFolder = useCallback(
    (name: string) =>
      runMutation("folder-create", async (connection) => {
        await createTaskFolder(connection, name);
      }),
    [runMutation],
  );

  const confirmDeleteTreeItem = useCallback(() => {
    const target = deleteTarget;
    if (!target) return;
    void runMutation(`tree-delete:${target.kind}:${target.id}`, async (connection) => {
      if (target.kind === "folder") {
        await deleteTaskFolder(connection, target.id);
      } else {
        await deleteTaskList(connection, target.id);
      }
    }).then((deleted) => {
      setDeleteTarget(null);
      if (!deleted) return;
      // A selected list inside the deleted subtree would leave the tasks view
      // pointing at nothing; fall back to "All tasks".
      if (
        listSelection.kind === "list" &&
        deleteTargetListIdsRef.current.includes(listSelection.listId)
      ) {
        setListSelection({ kind: "all" });
        setPage(1);
      }
    });
  }, [deleteTarget, listSelection, runMutation]);

  const isSyncing = busyKey === "provider-sync";
  const lastSyncRelative = lastSyncAt === null ? null : formatRelativeTimeLabel(lastSyncAt);
  const lastSyncError = syncStatusProvider?.lastSyncError ?? null;
  const headerActions = (
    <div className="flex shrink-0 items-center gap-2">
      {connectedProviders.length > 0 ? (
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
        aria-label="Task provider settings"
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
      statuses={taskStatuses}
      onOpenDetails={openTaskDetail}
      onLink={setTaskLinkCurrent}
      onUnlink={setTaskLinkUnlinked}
      onStatusChange={changeTaskStatus}
    />
  );

  const taskDetailsActions = (task: Task) => (
    <TaskDetailsActions
      task={task}
      activeThreadId={activeThreadId}
      environmentId={props.environmentId}
      busyKey={busyKey}
      onDelete={() => deleteTask(task.id)}
      onEdit={task.provider === "manual" ? () => setEditTaskOpen(true) : undefined}
      onLink={() => setTaskLink(task.id, activeThreadId)}
      onUnlink={() => setTaskLink(task.id, null)}
      onCreateThread={() => requestCreateThread(task)}
      onNavigateThread={() => {
        if (task.linkedThreadId) {
          navigateToThread(props.environmentId, task.linkedThreadId);
        }
      }}
    />
  );

  const treeRowActions = (
    provider: string,
    target: TaskTreeDeleteTarget,
    doomedListIds: ReadonlyArray<string>,
  ) => {
    // Synced lists/folders are the provider's to manage; only manual ones go.
    if (provider !== "manual") return null;
    return (
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Delete ${target.kind}`}
        title={`Delete ${target.kind}`}
        onClick={() => {
          deleteTargetListIdsRef.current = doomedListIds;
          setDeleteTarget(target);
        }}
      >
        <Trash2Icon className="size-3.5" />
      </Button>
    );
  };

  const renderListNode = (list: TaskListFacet) => (
    <NavTreeRow
      key={list.id}
      icon={<ListIcon />}
      label={list.name}
      count={list.count}
      active={listSelection.kind === "list" && listSelection.listId === list.id}
      onClick={() => openTaskList(list.id)}
      actions={treeRowActions(
        list.provider,
        {
          kind: "list",
          id: list.id,
          name: list.name,
          listCount: 0,
          taskCount: list.count,
        },
        [list.id],
      )}
    />
  );

  const renderFolderNode = (folder: TaskTreeFolder) => {
    const expanded = listSearchQuery.length > 0 || (expandedNodes[folder.id] ?? false);
    // A folder can match the search by name while none of its lists do; keep
    // the drill-down usable by falling back to all of its lists.
    const matchingLists = folder.lists.filter(matchesList);
    const folderLists =
      listSearchQuery.length === 0 || matchingLists.length === 0 ? folder.lists : matchingLists;
    return (
      <div key={folder.id}>
        <NavTreeRow
          icon={expanded ? <FolderOpenIcon /> : <FolderIcon />}
          label={folder.name}
          count={folder.count}
          trailing={
            <ChevronRightIcon
              className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-90")}
            />
          }
          onClick={() => toggleNode(folder.id)}
          actions={treeRowActions(
            folder.provider,
            {
              kind: "folder",
              id: folder.id,
              name: folder.name,
              listCount: folder.lists.length,
              taskCount: folder.count,
            },
            folder.lists.map((list) => list.id),
          )}
        />
        {expanded ? (
          <div className="ml-3 space-y-0.5 border-l border-border/70 pl-2">
            {folderLists.map(renderListNode)}
            {folderLists.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">No lists in this folder.</p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const renderProviderSection = (section: TaskTreeSection) => {
    const expanded = listSearchQuery.length > 0 || (expandedNodes[section.key] ?? false);
    return (
      <div key={section.key}>
        <NavTreeRow
          icon={expanded ? <FolderOpenIcon /> : <FolderIcon />}
          label={section.label}
          count={section.count}
          trailing={
            <ChevronRightIcon
              className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-90")}
            />
          }
          onClick={() => toggleNode(section.key)}
        />
        {expanded ? (
          <div className="ml-3 space-y-0.5 border-l border-border/70 pl-2">
            {section.folders.map(renderFolderNode)}
            {section.orphanLists.map(renderListNode)}
            {section.folders.length === 0 && section.orphanLists.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">No lists yet.</p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const createDialogs = (
    <>
      <CreateTaskDialog
        open={createTaskOpen}
        onOpenChange={setCreateTaskOpen}
        groups={taskOptionGroups}
        defaultListId={listSelection.kind === "list" ? listSelection.listId : null}
        statuses={taskStatuses}
        busy={busyKey === "task-create"}
        onSubmit={submitCreateTask}
      />
      <CreateListDialog
        open={createListOpen}
        onOpenChange={setCreateListOpen}
        folders={manualFolders}
        busy={busyKey === "list-create"}
        onSubmit={submitCreateList}
      />
      <CreateFolderDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        busy={busyKey === "folder-create"}
        onSubmit={submitCreateFolder}
      />
      <DeleteTreeItemDialog
        target={deleteTarget}
        busy={busyKey?.startsWith("tree-delete:") ?? false}
        onConfirm={confirmDeleteTreeItem}
        onClose={() => setDeleteTarget(null)}
      />
    </>
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
                  onClick={backFromDetail}
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
                    ) : detailTask?.listId ? (
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
                <TaskDetailsBody
                  task={detailTask}
                  environmentId={props.environmentId}
                  gitCwd={projectCwd ?? undefined}
                  onTaskChanged={setDetailTask}
                  statuses={taskStatuses}
                  onStatusChange={
                    detailTask.provider === "manual"
                      ? (statusId) => changeTaskStatus(detailTask.id, statusId)
                      : undefined
                  }
                  statusChangeBusy={busyKey === `task-update:${detailTask.id}`}
                />
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
        {detailTask && detailTask.provider === "manual" ? (
          <EditTaskDialog
            task={detailTask}
            open={editTaskOpen}
            onOpenChange={setEditTaskOpen}
            statuses={taskStatuses}
            busy={busyKey === `task-update:${detailTask.id}`}
            onSubmit={(input) => submitEditTask(detailTask.id, input)}
          />
        ) : null}
      </div>
    );
  }

  if (view === "tasks") {
    const activeTitle =
      listSelection.kind === "list" ? (activeList?.name ?? "Task list") : "All tasks";
    const filtersActive =
      statusFilter !== "all" || assigneeFilter !== "all" || taskSearchQuery.trim().length > 0;
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

          <Input
            type="search"
            value={taskSearchInput}
            onChange={(event) => setTaskSearchInput(event.target.value)}
            placeholder="Search by name or ID…"
            aria-label="Search tasks"
          />

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

          <section className="flex items-center gap-2">
            <Input
              value={newTaskTitle}
              onChange={(event) => setNewTaskTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") createTask();
              }}
              placeholder={
                listSelection.kind === "list"
                  ? `Add a task to ${activeList?.name ?? "this list"}…`
                  : "Add a task…"
              }
              aria-label="New task title"
            />
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setCreateTaskOpen(true)}
              aria-label="New task with details"
              title="New task with details"
            >
              <ListPlusIcon />
            </Button>
            <Button
              size="sm"
              onClick={createTask}
              disabled={busyKey === "task-create" || newTaskTitle.trim().length === 0}
            >
              {busyKey === "task-create" ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <PlusIcon className="size-3.5" />
              )}
              Add
            </Button>
          </section>

          {!tasksLoading && totalTasks === 0 ? (
            <div className="rounded-xl border border-dashed border-border/80 bg-card/60 p-6 text-center text-sm text-muted-foreground">
              {anyTasks ? "No tasks match the current filters." : "No tasks in this view yet."}
            </div>
          ) : null}

          {taskGroups.manual.length > 0 ? (
            <TaskGroup title="Manual" tasks={taskGroups.manual} renderTask={renderTaskCard} />
          ) : null}

          {taskGroups.providerGroups.map(([listName, tasks]) => (
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
          {createDialogs}
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
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCreateFolderOpen(true)}
              disabled={busyKey === "folder-create"}
            >
              <FolderPlusIcon className="size-3.5" />
              Folder
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCreateListOpen(true)}
              disabled={busyKey === "list-create"}
            >
              <ListPlusIcon className="size-3.5" />
              List
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCreateTaskOpen(true)}
              disabled={busyKey === "task-create"}
            >
              <SquareCheckBigIcon className="size-3.5" />
              Task
            </Button>
          </div>
          {hasTreeContent ? (
            <div className="space-y-0.5">
              <NavTreeRow
                icon={<SquareCheckBigIcon />}
                label="All tasks"
                count={allTasksCount}
                active={listSelection.kind === "all"}
                onClick={openAllTasks}
              />
              {manualSection ? (
                <>
                  {manualSection.folders.map(renderFolderNode)}
                  {manualSection.orphanLists.map(renderListNode)}
                </>
              ) : null}
              {providerSections.map(renderProviderSection)}
            </div>
          ) : (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              No folders or lists yet. Sync a provider, or create a folder, list, or task to get
              started.
            </p>
          )}
          {createDialogs}
        </section>
      </div>
    </ScrollArea>
  );
}
