import {
  makeEnvironmentHttpApiClient,
  executeEnvironmentHttpRequest,
} from "@t3tools/client-runtime/rpc";
import { type PreparedConnection } from "@t3tools/client-runtime/connection";
import { environmentEndpointUrl } from "@t3tools/client-runtime/environment";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type {
  ProjectTask,
  ProjectTaskId,
  ProjectTaskListFacet,
  ProjectTaskPanel,
  ProjectTaskQueryFilter,
  ProjectTaskQueryResult,
  ProjectTaskStatusCategory,
} from "@t3tools/contracts";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { FetchHttpClient, type HttpMethod } from "effect/unstable/http";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  Link2Icon,
  ListIcon,
  Loader2Icon,
  MessageSquareIcon,
  RefreshCwIcon,
  SquareCheckBigIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { runtime } from "~/lib/runtime";
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

interface EnvironmentHttpAuthHeaders {
  readonly authorization?: string;
  readonly dpop?: string;
}

interface TaskPanelThreadContext {
  readonly id: string;
  readonly modelSelection: EnvironmentThreadShell["modelSelection"];
  readonly runtimeMode: EnvironmentThreadShell["runtimeMode"];
  readonly interactionMode: EnvironmentThreadShell["interactionMode"];
}

function withEnvironmentCredentials<A, E, R>(
  authorization: PreparedConnection["httpAuthorization"],
  request: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return authorization === null
    ? request.pipe(Effect.provideService(FetchHttpClient.RequestInit, { credentials: "include" }))
    : request;
}

function buildEnvironmentAuthHeaders(
  authorization: PreparedConnection["httpAuthorization"],
  method: HttpMethod.HttpMethod,
  url: string,
  signer: Option.Option<ManagedRelay.ManagedRelayDpopSigner["Service"]>,
) {
  return Effect.gen(function* () {
    if (authorization === null) {
      return {};
    }
    if (authorization._tag === "Bearer") {
      return { authorization: `Bearer ${authorization.token}` };
    }
    if (Option.isNone(signer)) {
      return yield* Effect.fail("No DPoP signer is available for this environment.");
    }
    const proof = yield* signer.value.createProof({
      method,
      url,
      accessToken: authorization.accessToken,
    });
    return {
      authorization: `DPoP ${authorization.accessToken}`,
      dpop: proof,
    };
  });
}

async function runTasksRequest<A, E>(
  prepared: PreparedConnection,
  requestUrl: string,
  method: HttpMethod.HttpMethod,
  request: (
    client: Effect.Success<ReturnType<typeof makeEnvironmentHttpApiClient>>,
    headers: EnvironmentHttpAuthHeaders,
  ) => Effect.Effect<A, E>,
  timeoutMs = 8_000,
): Promise<A> {
  return runtime.runPromise(
    Effect.gen(function* () {
      const client = yield* makeEnvironmentHttpApiClient(prepared.httpBaseUrl);
      const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
      const headers = yield* buildEnvironmentAuthHeaders(
        prepared.httpAuthorization,
        method,
        requestUrl,
        signer,
      );
      return yield* executeEnvironmentHttpRequest(
        requestUrl,
        timeoutMs,
        withEnvironmentCredentials(prepared.httpAuthorization, request(client, headers)),
      );
    }),
  );
}

async function fetchProjectTaskPanel(
  prepared: PreparedConnection,
  projectId: ProjectId,
): Promise<ProjectTaskPanel> {
  const requestUrl = environmentEndpointUrl(
    prepared.httpBaseUrl,
    `/api/tasks/projects/${projectId}`,
  );
  return runTasksRequest(prepared, requestUrl, "GET", (client, headers) =>
    client.tasks.panel({
      params: { projectId },
      headers,
    }),
  );
}

const TASKS_PAGE_SIZE = 10;

async function fetchProjectTasksQuery(
  prepared: PreparedConnection,
  projectId: ProjectId,
  filter: ProjectTaskQueryFilter,
): Promise<ProjectTaskQueryResult> {
  const requestUrl = environmentEndpointUrl(prepared.httpBaseUrl, "/api/tasks/query");
  return runTasksRequest(prepared, requestUrl, "POST", (client, headers) =>
    client.tasks.queryTasks({
      headers,
      payload: { projectId, filter },
    }),
  );
}

type ListSelection = { readonly kind: "all" } | { readonly kind: "list"; listId: string };

interface TaskFolderGroup {
  id: string;
  name: string;
  count: number;
  lists: ProjectTaskListFacet[];
}

const statusCategoryLabels: Record<ProjectTaskStatusCategory, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  blocked: "Blocked",
  unknown: "Unknown",
};

function formatTaskStatusLabel(task: ProjectTask): string {
  switch (task.statusCategory) {
    case "done":
      return "Done";
    case "in_progress":
      return "In progress";
    case "blocked":
      return "Blocked";
    case "open":
      return "Open";
    default:
      return task.statusLabel;
  }
}

function statusTone(status: ProjectTaskStatusCategory): string {
  switch (status) {
    case "done":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "in_progress":
      return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    case "blocked":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "open":
      return "border-zinc-500/20 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function TaskStatusBadge({ task }: { task: ProjectTask }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px] font-medium",
        statusTone(task.statusCategory),
      )}
    >
      {formatTaskStatusLabel(task)}
    </span>
  );
}

interface TaskCardProps {
  task: ProjectTask;
  environmentId: string;
  activeThreadId: ThreadId;
  busyKey: string | null;
  commentDraft: string;
  commentsOpen: boolean;
  onCommentDraftChange: (taskId: string, value: string) => void;
  onToggleComments: (taskId: string) => void;
  onAddComment: (taskId: ProjectTaskId) => void;
  onDelete: (taskId: ProjectTaskId) => void;
  onLink: (taskId: ProjectTaskId, threadId: ThreadId) => void;
  onCreateThread: (task: ProjectTask) => void;
  onNavigateThread: (environmentId: string, threadId: ThreadId) => void;
}

function TaskCard(props: TaskCardProps) {
  const { task, activeThreadId, busyKey } = props;
  const isLinkedToCurrentThread = task.linkedThreadId === activeThreadId;
  const linkedThreadId = task.linkedThreadId;
  const commentDraft = props.commentDraft;

  return (
    <article className="rounded-xl border border-border/70 bg-card/80 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate text-sm font-semibold">{task.title}</h4>
            <TaskStatusBadge task={task} />
            {task.source === "manual" ? (
              <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                Manual
              </span>
            ) : null}
          </div>
          {task.description ? (
            <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
              {task.description}
            </p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            {task.externalUrl ? (
              <a
                href={task.externalUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Open in ClickUp
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => props.onToggleComments(task.id)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
            >
              <MessageSquareIcon className="size-3" />
              {task.comments.length > 0 ? `${task.comments.length}` : "Comment"}
            </button>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {task.source === "manual" ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => props.onDelete(task.id)}
              disabled={busyKey === `task-delete:${task.id}`}
            >
              Delete
            </Button>
          ) : null}
          {linkedThreadId ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => props.onNavigateThread(props.environmentId, linkedThreadId)}
              >
                <Link2Icon className="size-3.5" />
                Open thread
              </Button>
              {!isLinkedToCurrentThread ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => props.onLink(task.id, activeThreadId)}
                  disabled={busyKey === `task-link:${task.id}`}
                >
                  Link current
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => props.onCreateThread(task)}>
                <SquareCheckBigIcon className="size-3.5" />
                Create thread
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => props.onLink(task.id, activeThreadId)}
                disabled={busyKey === `task-link:${task.id}`}
              >
                Link current
              </Button>
            </>
          )}
        </div>
      </div>

      {props.commentsOpen ? (
        <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
          {task.comments.length === 0 ? (
            <p className="text-xs text-muted-foreground">No comments yet.</p>
          ) : (
            <div className="space-y-2">
              {task.comments.map((comment) => (
                <div key={comment.id} className="rounded-lg bg-muted/50 p-2.5">
                  <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {new Date(comment.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Textarea
              value={commentDraft}
              onChange={(event) => props.onCommentDraftChange(task.id, event.target.value)}
              placeholder="Add a local comment"
              className="min-h-9"
            />
            <Button
              size="sm"
              onClick={() => props.onAddComment(task.id)}
              disabled={busyKey === `comment:${task.id}` || commentDraft.trim().length === 0}
            >
              Add
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function TaskGroup({
  title,
  tasks,
  renderTask,
}: {
  title: string;
  tasks: ReadonlyArray<ProjectTask>;
  renderTask: (task: ProjectTask) => ReactNode;
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

export function ProjectTasksPanel(props: {
  project: EnvironmentProject;
  activeThread: TaskPanelThreadContext;
}) {
  const prepared = usePreparedConnection(props.project.environmentId);
  const navigate = useNavigate();
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const projectId = ProjectId.make(props.project.id);
  const activeThreadId = ThreadId.make(props.activeThread.id);
  const [panel, setPanel] = useState<ProjectTaskPanel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manualTitle, setManualTitle] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [tasksResult, setTasksResult] = useState<ProjectTaskQueryResult | null>(null);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [listSelection, setListSelection] = useState<ListSelection>({ kind: "all" });
  const [view, setView] = useState<"browse" | "tasks">("browse");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [listSearch, setListSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectTaskStatusCategory | "all">("all");
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
      setPanel(await fetchProjectTaskPanel(prepared.value, projectId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load tasks.");
    } finally {
      setLoading(false);
    }
  }, [prepared, projectId]);

  const queryFilter = useMemo<ProjectTaskQueryFilter>(
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
      setTasksResult(await fetchProjectTasksQuery(prepared.value, projectId, queryFilter));
    } catch (cause) {
      setTasksError(cause instanceof Error ? cause.message : "Failed to load tasks.");
    } finally {
      setTasksLoading(false);
    }
  }, [prepared, projectId, queryFilter]);

  useEffect(() => {
    void loadPanel();
  }, [loadPanel]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const runMutation = useCallback(
    async (
      key: string,
      action: (prepared: PreparedConnection) => Promise<void | ProjectTaskPanel>,
    ) => {
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
    [loadPanel, loadTasks, prepared],
  );

  const syncNow = useCallback(() => {
    void runMutation("clickup-sync", async (connection) => {
      const requestUrl = environmentEndpointUrl(connection.httpBaseUrl, "/api/tasks/clickup/sync");
      // The server starts the sync in a detached fiber and answers right away.
      // Poll the panel until lastSyncAt moves (or an error lands) instead of
      // holding this request open, where any hop can cut it.
      await runTasksRequest(connection, requestUrl, "POST", (client, headers) =>
        client.tasks.syncClickUpTasks({
          headers,
          payload: { projectId },
        }),
      );
      const initialLastSyncAt = panel?.clickup.lastSyncAt ?? null;
      const initialLastSyncError = panel?.clickup.lastSyncError ?? null;
      let latest = panel;
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          latest = await fetchProjectTaskPanel(connection, projectId);
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
  }, [panel, projectId, runMutation]);

  const createManual = useCallback(() => {
    const title = manualTitle.trim();
    if (!title) return;
    void runMutation("manual-create", async (connection) => {
      const requestUrl = environmentEndpointUrl(connection.httpBaseUrl, "/api/tasks/manual");
      await runTasksRequest(connection, requestUrl, "POST", (client, headers) =>
        client.tasks.createManual({
          headers,
          payload: {
            projectId,
            title,
            ...(manualDescription.trim() ? { description: manualDescription.trim() } : {}),
          },
        }),
      );
      setManualTitle("");
      setManualDescription("");
    });
  }, [manualDescription, manualTitle, projectId, runMutation]);

  const setTaskLink = useCallback(
    (taskId: ProjectTaskId, linkedThreadId: ThreadId) => {
      void runMutation(`task-link:${taskId}`, async (connection) => {
        const requestUrl = environmentEndpointUrl(connection.httpBaseUrl, "/api/tasks/task");
        await runTasksRequest(connection, requestUrl, "POST", (client, headers) =>
          client.tasks.updateTask({
            headers,
            payload: { taskId, linkedThreadId },
          }),
        );
      });
    },
    [runMutation],
  );

  const addComment = useCallback(
    (taskId: ProjectTaskId) => {
      const body = commentDrafts[taskId]?.trim();
      if (!body) return;
      void runMutation(`comment:${taskId}`, async (connection) => {
        const requestUrl = environmentEndpointUrl(connection.httpBaseUrl, "/api/tasks/comments");
        await runTasksRequest(connection, requestUrl, "POST", (client, headers) =>
          client.tasks.addComment({
            headers,
            payload: { taskId, body },
          }),
        );
        setCommentDrafts((current) => ({ ...current, [taskId]: "" }));
      });
    },
    [commentDrafts, runMutation],
  );

  const deleteTask = useCallback(
    (taskId: ProjectTaskId) => {
      void runMutation(`task-delete:${taskId}`, async (connection) => {
        const requestUrl = environmentEndpointUrl(connection.httpBaseUrl, "/api/tasks/delete");
        await runTasksRequest(connection, requestUrl, "POST", (client, headers) =>
          client.tasks.deleteTask({
            headers,
            payload: { taskId },
          }),
        );
      });
    },
    [runMutation],
  );

  const createLinkedThread = useCallback(
    async (task: ProjectTask) => {
      const threadId = newThreadId();
      const createResult = await createThread({
        environmentId: props.project.environmentId,
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
          environmentId: props.project.environmentId,
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
      props.project.environmentId,
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
    const byList = new Map<string, ProjectTask[]>();
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
    const orphans: ProjectTaskListFacet[] = [];
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
    (list: ProjectTaskListFacet) =>
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

  const updateStatusFilter = useCallback((value: ProjectTaskStatusCategory | "all") => {
    setStatusFilter(value);
    setPage(1);
  }, []);

  const updateAssigneeFilter = useCallback((value: string) => {
    setAssigneeFilter(value);
    setPage(1);
  }, []);

  const taskCardHandlers = {
    environmentId: props.project.environmentId,
    activeThreadId,
    busyKey,
    onCommentDraftChange: (taskId: string, value: string) => {
      setCommentDrafts((current) => ({ ...current, [taskId]: value }));
    },
    onToggleComments: (taskId: string) => {
      setOpenComments((current) => ({ ...current, [taskId]: !current[taskId] }));
    },
    onAddComment: addComment,
    onDelete: deleteTask,
    onLink: setTaskLink,
    onCreateThread: (task: ProjectTask) => void createLinkedThread(task),
    onNavigateThread: navigateToThread,
  } satisfies Omit<TaskCardProps, "task" | "commentDraft" | "commentsOpen">;

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

  const renderTaskCard = (task: ProjectTask) => (
    <TaskCard
      key={task.id}
      task={task}
      commentDraft={commentDrafts[task.id] ?? ""}
      commentsOpen={openComments[task.id] ?? false}
      {...taskCardHandlers}
    />
  );

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
                  updateStatusFilter(value as ProjectTaskStatusCategory | "all");
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
                    {statusCategoryLabels[facet.value as ProjectTaskStatusCategory] ?? facet.value}
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
            <TaskGroup title="This project" tasks={taskGroups.manual} renderTask={renderTaskCard} />
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
