import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, Task, TaskId, TaskPanel, ThreadId } from "@t3tools/contracts";
import {
  ChevronDownIcon,
  FolderIcon,
  Loader2Icon,
  MessageSquareIcon,
  SearchIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useProjects, useThreadShells } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { usePreparedConnection } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { fetchTaskPanel, fetchTasksQuery, setTaskLinkedBranches } from "../tasks/taskApi";
import { notifyTasksChanged } from "../tasks/taskLinkStore";
import { TaskStatusBadge } from "../tasks/TaskDetailsDialog";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";

const TASKS_PAGE_SIZE = 200;
const TASKS_MAX_PAGES = 10;
const NO_LIST_KEY = "no-list";

/** A list node in the picker tree: its tasks, optionally under a folder. */
interface PickerList {
  key: string;
  name: string;
  folderName: string | null;
  tasks: Task[];
}

/** Mirrors the tasks panel: a "Manual" section plus one per task provider. */
interface PickerSection {
  key: string;
  label: string;
  lists: PickerList[];
}

interface BranchLinkDialogProps {
  environmentId: EnvironmentId;
  cwd: string;
  branch: string;
  initialTab: "tasks" | "threads";
  onClose: () => void;
}

export function BranchLinkDialog(props: BranchLinkDialogProps) {
  const { environmentId, cwd, branch } = props;
  const prepared = usePreparedConnection(environmentId);

  const [tab, setTab] = useState<"tasks" | "threads">(props.initialTab);
  const [search, setSearch] = useState("");

  const [panel, setPanel] = useState<TaskPanel | null>(null);
  const [tasks, setTasks] = useState<ReadonlyArray<Task>>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [taskChecked, setTaskChecked] = useState<ReadonlySet<TaskId>>(new Set());
  const taskInitialIdsRef = useRef<ReadonlySet<TaskId> | null>(null);

  // Threads come from the shell snapshot: this repo's threads are the ones
  // whose project root or worktree matches the graph's cwd.
  const projects = useProjects();
  const threadShells = useThreadShells();
  const [threadChecked, setThreadChecked] = useState<ReadonlySet<ThreadId>>(new Set());
  const threadInitialIdsRef = useRef<ReadonlySet<ThreadId> | null>(null);

  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });

  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (prepared._tag === "None") return;
    let cancelled = false;
    const load = async () => {
      setTasksLoading(true);
      setTasksError(null);
      try {
        const [panelResult, firstPage] = await Promise.all([
          fetchTaskPanel(prepared.value),
          fetchTasksQuery(prepared.value, { page: 1, pageSize: TASKS_PAGE_SIZE }),
        ]);
        if (cancelled) return;
        const loaded = [...firstPage.tasks];
        const totalPages = Math.min(
          TASKS_MAX_PAGES,
          Math.max(1, Math.ceil(firstPage.total / TASKS_PAGE_SIZE)),
        );
        for (let page = 2; page <= totalPages; page += 1) {
          const next = await fetchTasksQuery(prepared.value, { page, pageSize: TASKS_PAGE_SIZE });
          if (cancelled) return;
          loaded.push(...next.tasks);
        }
        setPanel(panelResult);
        setTasks(loaded);
        if (taskInitialIdsRef.current === null) {
          taskInitialIdsRef.current = new Set(
            loaded.filter((task) => task.linkedBranches.includes(branch)).map((task) => task.id),
          );
          setTaskChecked(taskInitialIdsRef.current);
        }
      } catch (cause) {
        if (!cancelled) {
          setTasksError(cause instanceof Error ? cause.message : "Failed to load tasks.");
        }
      } finally {
        if (!cancelled) setTasksLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [branch, prepared]);

  const repoThreadShells = useMemo(() => {
    const projectIds = new Set(
      projects
        .filter(
          (project) => project.environmentId === environmentId && project.workspaceRoot === cwd,
        )
        .map((project) => project.id),
    );
    return threadShells
      .filter(
        (thread) =>
          thread.environmentId === environmentId &&
          thread.archivedAt === null &&
          (projectIds.has(thread.projectId) || thread.worktreePath === cwd),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [cwd, environmentId, projects, threadShells]);

  useEffect(() => {
    if (threadInitialIdsRef.current !== null) return;
    threadInitialIdsRef.current = new Set(
      repoThreadShells.filter((thread) => thread.branch === branch).map((thread) => thread.id),
    );
    setThreadChecked(threadInitialIdsRef.current);
    // Runs once, when the shell snapshot first resolves for this dialog.
  }, [branch, repoThreadShells]);

  const sections = useMemo<PickerSection[]>(() => {
    const providerLabel = (providerId: string) =>
      (panel?.providers ?? []).find((provider) => provider.providerId === providerId)?.label ??
      providerId;
    const tasksByListId = new Map<string, Task[]>();
    const listless: Task[] = [];
    for (const task of tasks) {
      if (task.listId === null) {
        listless.push(task);
        continue;
      }
      const bucket = tasksByListId.get(task.listId);
      if (bucket) {
        bucket.push(task);
      } else {
        tasksByListId.set(task.listId, [task]);
      }
    }

    const folderNameById = new Map(
      (panel?.facets.folders ?? []).map((folder) => [folder.id, folder.name] as const),
    );
    const sectionByProvider = new Map<string, PickerSection>();
    const sectionFor = (provider: string): PickerSection => {
      const existing = sectionByProvider.get(provider);
      if (existing) return existing;
      const created: PickerSection = {
        key: provider,
        label: provider === "manual" ? "Manual" : providerLabel(provider),
        lists: [],
      };
      sectionByProvider.set(provider, created);
      return created;
    };

    for (const list of panel?.facets.lists ?? []) {
      const listTasks = tasksByListId.get(list.id) ?? [];
      sectionFor(list.provider).lists.push({
        key: list.id,
        name: list.name,
        folderName: list.folderId ? (folderNameById.get(list.folderId) ?? list.folderName) : null,
        tasks: listTasks,
      });
      tasksByListId.delete(list.id);
    }
    // Tasks whose list is not in the facets (fresh sync, older server) still
    // surface under their provider, named from the task's resolved list name.
    for (const [listId, listTasks] of tasksByListId) {
      const provider = listTasks[0]?.provider ?? "manual";
      sectionFor(provider).lists.push({
        key: listId,
        name: listTasks[0]?.listName ?? listId,
        folderName: null,
        tasks: listTasks,
      });
    }
    const listlessByProvider = new Map<string, Task[]>();
    for (const task of listless) {
      const bucket = listlessByProvider.get(task.provider);
      if (bucket) {
        bucket.push(task);
      } else {
        listlessByProvider.set(task.provider, [task]);
      }
    }
    for (const [provider, providerListless] of listlessByProvider) {
      sectionFor(provider).lists.push({
        key: `${provider}:${NO_LIST_KEY}`,
        name: "No list",
        folderName: null,
        tasks: providerListless,
      });
    }

    const built = [...sectionByProvider.values()];
    for (const section of built) {
      section.lists.sort((left, right) => left.name.localeCompare(right.name));
    }
    built.sort((left, right) => {
      if (left.key === "manual") return -1;
      if (right.key === "manual") return 1;
      return left.label.localeCompare(right.label);
    });
    return built;
  }, [panel, tasks]);

  const query = search.trim().toLowerCase();
  const searching = query.length > 0;

  const filteredSections = useMemo(() => {
    if (!searching) return sections;
    const filtered: PickerSection[] = [];
    for (const section of sections) {
      const lists = section.lists
        .map((list) => ({
          ...list,
          tasks: list.tasks.filter(
            (task) =>
              task.title.toLowerCase().includes(query) ||
              (task.externalCustomId ?? "").toLowerCase().includes(query),
          ),
        }))
        .filter((list) => list.tasks.length > 0);
      if (lists.length > 0) filtered.push({ ...section, lists });
    }
    return filtered;
  }, [query, searching, sections]);

  const matchedThreads = useMemo(() => {
    if (!searching) return repoThreadShells;
    return repoThreadShells.filter((thread) => thread.title.toLowerCase().includes(query));
  }, [query, repoThreadShells, searching]);

  const toggleTask = (taskId: TaskId, checked: boolean) => {
    setTaskChecked((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }
      return next;
    });
  };

  const toggleThread = (threadId: ThreadId, checked: boolean) => {
    setThreadChecked((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(threadId);
      } else {
        next.delete(threadId);
      }
      return next;
    });
  };

  const apply = async () => {
    if (applying || prepared._tag === "None") return;
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const linkTasks: Task[] = [];
    const unlinkTasks: Task[] = [];
    for (const taskId of taskChecked) {
      const task = tasksById.get(taskId);
      if (task && !task.linkedBranches.includes(branch)) linkTasks.push(task);
    }
    for (const taskId of taskInitialIdsRef.current ?? []) {
      const task = tasksById.get(taskId);
      if (task && !taskChecked.has(taskId)) unlinkTasks.push(task);
    }

    const threadsById = new Map(repoThreadShells.map((thread) => [thread.id, thread]));
    const linkThreads: EnvironmentThreadShell[] = [];
    const unlinkThreads: EnvironmentThreadShell[] = [];
    for (const threadId of threadChecked) {
      const thread = threadsById.get(threadId);
      if (thread && thread.branch !== branch) linkThreads.push(thread);
    }
    for (const threadId of threadInitialIdsRef.current ?? []) {
      const thread = threadsById.get(threadId);
      // A thread whose worktree owns the branch cannot be un-linked here; its
      // checkbox is locked, so only worktree-less threads reach this path.
      if (thread && thread.worktreePath === null && !threadChecked.has(threadId)) {
        unlinkThreads.push(thread);
      }
    }

    const updates = [
      ...linkTasks.map((task) =>
        setTaskLinkedBranches(prepared.value, task.id, [...task.linkedBranches, branch]),
      ),
      ...unlinkTasks.map((task) =>
        setTaskLinkedBranches(
          prepared.value,
          task.id,
          task.linkedBranches.filter((name) => name !== branch),
        ),
      ),
      ...linkThreads.map((thread) =>
        updateThreadMetadata({ environmentId, input: { threadId: thread.id, branch } }),
      ),
      ...unlinkThreads.map((thread) =>
        updateThreadMetadata({ environmentId, input: { threadId: thread.id, branch: null } }),
      ),
    ];
    if (updates.length === 0) {
      props.onClose();
      return;
    }

    setApplying(true);
    let failures = 0;
    try {
      const results = await Promise.allSettled(updates);
      for (const result of results) {
        // Task requests resolve to a Task or reject; command requests answer
        // with a tagged result instead of rejecting.
        const failed =
          result.status === "rejected" ||
          (result.status === "fulfilled" &&
            "_tag" in result.value &&
            result.value._tag !== "Success");
        if (failed) failures += 1;
      }
      if (linkTasks.length + unlinkTasks.length > 0) {
        notifyTasksChanged(environmentId);
      }
    } finally {
      setApplying(false);
    }
    if (failures > 0) {
      toastManager.add({
        type: "error",
        title: "Failed to update some links",
        description: `${failures} of ${updates.length} updates did not apply.`,
      });
      return;
    }
    toastManager.add({ type: "success", title: "Branch links updated", description: branch });
    props.onClose();
  };

  const renderTaskRow = (task: Task) => (
    <label
      key={task.id}
      className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md py-1 pr-2 pl-6 text-left text-xs transition-colors hover:bg-accent/60"
    >
      <Checkbox
        checked={taskChecked.has(task.id)}
        disabled={applying}
        onCheckedChange={(value) => toggleTask(task.id, value === true)}
      />
      <TaskStatusBadge task={task} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          task.statusCategory === "done" && "text-muted-foreground",
        )}
        title={task.title}
      >
        {task.title}
      </span>
      {task.externalCustomId ? (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {task.externalCustomId}
        </span>
      ) : null}
    </label>
  );

  const renderThreads = () => {
    if (matchedThreads.length === 0) {
      return (
        <p className="px-2 py-6 text-center text-xs text-muted-foreground">
          {searching ? "No matching threads." : "No threads in this repository yet."}
        </p>
      );
    }
    return matchedThreads.map((thread) => {
      // A worktree thread checked out on this branch owns the link; it is
      // managed from the thread's own branch selector instead.
      const locked = thread.worktreePath !== null && thread.branch === branch;
      return (
        <label
          key={thread.id}
          className={cn(
            "flex min-w-0 items-center gap-2 rounded-md py-1 pr-2 pl-2 text-left text-xs transition-colors hover:bg-accent/60",
            locked ? "cursor-default" : "cursor-pointer",
          )}
        >
          <Checkbox
            checked={threadChecked.has(thread.id)}
            disabled={locked || applying}
            onCheckedChange={(value) => toggleThread(thread.id, value === true)}
          />
          <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate" title={thread.title}>
            {thread.title}
          </span>
          {thread.branch !== null ? (
            <span className="max-w-40 shrink-0 truncate rounded-md border border-border/70 bg-background px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">
              {thread.branch}
            </span>
          ) : null}
        </label>
      );
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !applying) props.onClose();
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Link tasks &amp; threads</DialogTitle>
          <DialogDescription>
            Pick what belongs to branch <span className="font-mono">{branch}</span>. Linked items
            show under this branch in the git graph, and the branch shows on the task or thread.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel scrollFade={false} className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex shrink-0 rounded-lg border border-border/70 p-0.5">
              <button
                type="button"
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  tab === "tasks"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setTab("tasks")}
              >
                Tasks
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  tab === "threads"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setTab("threads")}
              >
                Threads
              </button>
            </div>
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={tab === "tasks" ? "Search tasks…" : "Search threads…"}
                aria-label="Search"
                className="pl-7"
              />
            </div>
          </div>
          <div className="max-h-80 min-h-40 overflow-y-auto rounded-lg border border-border/70 p-1">
            {tab === "tasks" ? (
              tasksLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  Loading tasks…
                </div>
              ) : tasksError !== null ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">{tasksError}</p>
              ) : filteredSections.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  {searching ? "No matching tasks." : "No tasks yet."}
                </p>
              ) : (
                filteredSections.map((section) => (
                  <div key={section.key} className="pb-1">
                    <p className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                      {section.label}
                    </p>
                    {section.lists.map((list) =>
                      searching ? (
                        <div key={list.key} className="pt-1">
                          <p className="px-2 pb-0.5 text-[11px] font-medium text-muted-foreground">
                            {list.folderName ? `${list.folderName} / ` : ""}
                            {list.name}
                          </p>
                          {list.tasks.map(renderTaskRow)}
                        </div>
                      ) : (
                        <ListRow key={list.key} list={list} renderTaskRow={renderTaskRow} />
                      ),
                    )}
                  </div>
                ))
              )
            ) : (
              renderThreads()
            )}
          </div>
        </DialogPanel>
        <DialogFooter variant="bare">
          <span className="mr-auto text-xs text-muted-foreground">
            {tab === "tasks" ? `${taskChecked.size} selected` : `${threadChecked.size} selected`}
          </span>
          <Button variant="outline" disabled={applying} onClick={props.onClose}>
            Cancel
          </Button>
          <Button onClick={() => void apply()} disabled={applying}>
            {applying ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
            Apply
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** A collapsible list row with its tasks; folders show as muted path prefixes. */
function ListRow({
  list,
  renderTaskRow,
}: {
  list: PickerList;
  renderTaskRow: (task: Task) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(list.tasks.length <= 8);
  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-accent/60"
      >
        <ChevronDownIcon
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform",
            !expanded && "-rotate-90",
          )}
        />
        <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-foreground">
          {list.folderName ? (
            <span className="text-muted-foreground">{list.folderName} / </span>
          ) : null}
          {list.name}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
          {list.tasks.length}
        </span>
      </button>
      {expanded ? list.tasks.map(renderTaskRow) : null}
    </div>
  );
}
