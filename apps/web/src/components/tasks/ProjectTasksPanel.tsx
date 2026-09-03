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
  ClickUpListSummary,
  ProjectTask,
  ProjectTaskId,
  ProjectTaskPanel,
  ProjectTaskStatusCategory,
} from "@t3tools/contracts";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { FetchHttpClient, type HttpMethod } from "effect/unstable/http";
import {
  ChevronDownIcon,
  Link2Icon,
  Loader2Icon,
  MessageSquareIcon,
  RefreshCwIcon,
  SquareCheckBigIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { runtime } from "~/lib/runtime";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
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
        8_000,
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
  const [tokenDraft, setTokenDraft] = useState("");
  const [workspaceIdDraft, setWorkspaceIdDraft] = useState("");
  const [selectedListIds, setSelectedListIds] = useState<ReadonlyArray<string>>([]);
  const [availableLists, setAvailableLists] = useState<ReadonlyArray<ClickUpListSummary>>([]);
  const [listsWorkspaceId, setListsWorkspaceId] = useState<string | null>(null);
  const [listsLoading, setListsLoading] = useState(false);
  const [listsError, setListsError] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const clickup = panel?.clickup ?? null;
  const syncConfig = clickup?.syncConfig ?? null;
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

  useEffect(() => {
    void loadPanel();
  }, [loadPanel]);

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
    [loadPanel, prepared],
  );

  const saveToken = useCallback(() => {
    const token = tokenDraft.trim();
    if (!token) return;
    void runMutation("clickup-token", async (connection) => {
      const requestUrl = environmentEndpointUrl(connection.httpBaseUrl, "/api/tasks/clickup/token");
      await runTasksRequest(connection, requestUrl, "POST", (client, headers) =>
        client.tasks.setClickUpToken({
          headers,
          payload: { token },
        }),
      );
      setTokenDraft("");
    });
  }, [runMutation, tokenDraft]);

  const clearToken = useCallback(() => {
    void runMutation("clickup-token-clear", async (connection) => {
      const requestUrl = environmentEndpointUrl(
        connection.httpBaseUrl,
        "/api/tasks/clickup/token/remove",
      );
      await runTasksRequest(connection, requestUrl, "POST", (client, headers) =>
        client.tasks.clearClickUpToken({ headers }),
      );
      setWorkspaceIdDraft("");
      setSelectedListIds([]);
      setAvailableLists([]);
      setListsWorkspaceId(null);
    });
  }, [runMutation]);

  const loadClickUpLists = useCallback(
    async (workspaceId: string) => {
      if (prepared._tag === "None" || workspaceId.length === 0) return;
      setListsLoading(true);
      setListsError(null);
      try {
        const requestUrl = environmentEndpointUrl(
          prepared.value.httpBaseUrl,
          "/api/tasks/clickup/lists",
        );
        const lists = await runTasksRequest(prepared.value, requestUrl, "POST", (client, headers) =>
          client.tasks.clickUpLists({
            headers,
            payload: { workspaceId },
          }),
        );
        setAvailableLists(lists);
      } catch (cause) {
        setListsError(cause instanceof Error ? cause.message : "Failed to load ClickUp lists.");
      } finally {
        setListsLoading(false);
      }
    },
    [prepared],
  );

  const applySyncConfig = useCallback(
    (connection: PreparedConnection) => {
      const workspaceId = workspaceIdDraft.trim();
      const workspaceName = clickup?.availableWorkspaces.find(
        (workspace) => workspace.id === workspaceId,
      )?.name;
      const requestUrl = environmentEndpointUrl(
        connection.httpBaseUrl,
        "/api/tasks/clickup/config",
      );
      return runTasksRequest(connection, requestUrl, "POST", (client, headers) =>
        client.tasks.setClickUpSyncConfig({
          headers,
          payload: {
            projectId,
            syncConfig: {
              workspaceId,
              listIds: [...selectedListIds],
              ...(workspaceName ? { workspaceName } : {}),
            },
          },
        }),
      );
    },
    [clickup?.availableWorkspaces, projectId, selectedListIds, workspaceIdDraft],
  );

  const syncNow = useCallback(() => {
    if (workspaceIdDraft.trim().length === 0) return;
    void runMutation("clickup-sync", async (connection) => {
      await applySyncConfig(connection);
      const requestUrl = environmentEndpointUrl(connection.httpBaseUrl, "/api/tasks/clickup/sync");
      return runTasksRequest(connection, requestUrl, "POST", (client, headers) =>
        client.tasks.syncClickUpTasks({
          headers,
          payload: { projectId },
        }),
      );
    });
  }, [applySyncConfig, projectId, runMutation, workspaceIdDraft]);

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

  // Seed the workspace/list drafts only when the persisted config actually
  // changes, so refreshes never clobber in-progress edits.
  const appliedConfigRef = useRef<string | null>(null);
  useEffect(() => {
    const key = syncConfig ? JSON.stringify(syncConfig) : null;
    if (key === appliedConfigRef.current) return;
    appliedConfigRef.current = key;
    setWorkspaceIdDraft(syncConfig?.workspaceId ?? "");
    setSelectedListIds(syncConfig?.listIds ?? []);
  }, [syncConfig]);

  useEffect(() => {
    if (!tokenConfigured || !syncConfig) setConfigOpen(true);
  }, [tokenConfigured, syncConfig]);

  useEffect(() => {
    if (!configOpen || workspaceIdDraft.length === 0 || listsWorkspaceId === workspaceIdDraft)
      return;
    setListsWorkspaceId(workspaceIdDraft);
    void loadClickUpLists(workspaceIdDraft);
  }, [configOpen, listsWorkspaceId, loadClickUpLists, workspaceIdDraft]);

  const taskGroups = useMemo(() => {
    const tasks = panel?.tasks ?? [];
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
  }, [panel?.tasks]);

  const taskCount = (panel?.tasks ?? []).length;

  const workspaceOptions = useMemo(() => {
    const options = clickup?.availableWorkspaces ?? [];
    const savedId = syncConfig?.workspaceId;
    if (savedId && !options.some((workspace) => workspace.id === savedId)) {
      const savedName = syncConfig?.workspaceName ?? savedId;
      return [{ id: savedId, name: savedName }, ...options];
    }
    return options;
  }, [clickup?.availableWorkspaces, syncConfig?.workspaceId, syncConfig?.workspaceName]);

  const selectedWorkspaceLabel =
    workspaceOptions.find((workspace) => workspace.id === workspaceIdDraft)?.name ??
    (workspaceIdDraft.length > 0 ? workspaceIdDraft : null);

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

  if (loading && panel === null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-5 p-4">
        <section className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Tasks</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {taskCount === 0
                ? `Nothing tracked for ${props.project.title} yet.`
                : `${taskCount} task${taskCount === 1 ? "" : "s"} for ${props.project.title}.`}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void loadPanel()} disabled={loading}>
            <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </section>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

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

        {taskCount === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-card/60 p-6 text-center text-sm text-muted-foreground">
            No tasks yet. Connect ClickUp below or add one above.
          </div>
        ) : null}

        {taskGroups.manual.length > 0 ? (
          <TaskGroup
            title="This project"
            tasks={taskGroups.manual}
            renderTask={(task) => (
              <TaskCard
                key={task.id}
                task={task}
                commentDraft={commentDrafts[task.id] ?? ""}
                commentsOpen={openComments[task.id] ?? false}
                {...taskCardHandlers}
              />
            )}
          />
        ) : null}

        {taskGroups.clickupGroups.map(([listName, tasks]) => (
          <TaskGroup
            key={listName}
            title={listName}
            tasks={tasks}
            renderTask={(task) => (
              <TaskCard
                key={task.id}
                task={task}
                commentDraft={commentDrafts[task.id] ?? ""}
                commentsOpen={openComments[task.id] ?? false}
                {...taskCardHandlers}
              />
            )}
          />
        ))}

        <Collapsible open={configOpen} onOpenChange={setConfigOpen}>
          <section className="rounded-xl border border-border/70 bg-card/80">
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 p-4 text-left">
              <div>
                <h4 className="text-sm font-semibold">ClickUp</h4>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {!tokenConfigured
                    ? "Not connected."
                    : syncConfig
                      ? `Syncing ${syncConfig.listIds.length === 0 ? "the whole workspace" : `${syncConfig.listIds.length} list${syncConfig.listIds.length === 1 ? "" : "s"}`}.`
                      : "Connected. Pick a workspace to sync."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {clickup?.lastSyncError ? (
                  <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
                    Sync failed
                  </span>
                ) : tokenConfigured ? (
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                    Connected
                  </span>
                ) : null}
                <ChevronDownIcon
                  className={cn(
                    "size-4 text-muted-foreground transition-transform",
                    configOpen && "rotate-180",
                  )}
                />
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-3 border-t border-border/60 p-4">
                {!tokenConfigured ? (
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={tokenDraft}
                      onChange={(event) => setTokenDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") saveToken();
                      }}
                      placeholder="ClickUp personal API token (pk_…)"
                    />
                    <Button
                      size="sm"
                      onClick={saveToken}
                      disabled={busyKey === "clickup-token" || tokenDraft.trim().length === 0}
                    >
                      {busyKey === "clickup-token" ? (
                        <Loader2Icon className="size-3.5 animate-spin" />
                      ) : null}
                      Connect
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <Select
                        value={workspaceIdDraft.length > 0 ? workspaceIdDraft : null}
                        onValueChange={(value) => {
                          if (typeof value === "string") {
                            setWorkspaceIdDraft(value);
                          }
                        }}
                      >
                        <SelectTrigger
                          className="min-w-0 flex-1"
                          size="sm"
                          aria-label="ClickUp workspace"
                        >
                          <SelectValue>{selectedWorkspaceLabel ?? "Pick a workspace"}</SelectValue>
                        </SelectTrigger>
                        <SelectContent alignItemWithTrigger={false}>
                          {workspaceOptions.map((workspace) => (
                            <SelectItem key={workspace.id} value={workspace.id}>
                              {workspace.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        onClick={syncNow}
                        disabled={
                          busyKey === "clickup-sync" || workspaceIdDraft.trim().length === 0
                        }
                      >
                        {busyKey === "clickup-sync" ? (
                          <Loader2Icon className="size-3.5 animate-spin" />
                        ) : null}
                        Sync
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={clearToken}
                        disabled={busyKey === "clickup-token-clear"}
                      >
                        Disconnect
                      </Button>
                    </div>

                    <div className="min-h-8">
                      {listsLoading ? (
                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2Icon className="size-3 animate-spin" />
                          Loading lists…
                        </p>
                      ) : listsError ? (
                        <p className="text-xs text-destructive">{listsError}</p>
                      ) : availableLists.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {availableLists.map((list) => {
                            const selected = selectedListIds.includes(list.id);
                            return (
                              <button
                                key={list.id}
                                type="button"
                                onClick={() => {
                                  setSelectedListIds((current) =>
                                    current.includes(list.id)
                                      ? current.filter((entry) => entry !== list.id)
                                      : [...current, list.id],
                                  );
                                }}
                                className={cn(
                                  "rounded-full border px-2 py-1 text-xs transition",
                                  selected
                                    ? "border-foreground bg-foreground text-background"
                                    : "border-border/70 text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                                )}
                              >
                                {list.spaceName}
                                {list.folderName ? ` / ${list.folderName}` : ""}
                                {` / ${list.name}`}
                              </button>
                            );
                          })}
                        </div>
                      ) : workspaceIdDraft.length > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No lists found. The whole workspace will sync.
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Pick a workspace to choose lists. With no lists selected, the whole
                          workspace syncs.
                        </p>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {clickup?.lastSyncAt
                        ? `Last synced ${new Date(clickup.lastSyncAt).toLocaleString()}`
                        : "Never synced."}
                      {clickup?.lastSyncError ? ` Last error: ${clickup.lastSyncError}` : ""}
                    </p>
                  </>
                )}
              </div>
            </CollapsibleContent>
          </section>
        </Collapsible>
      </div>
    </ScrollArea>
  );
}
