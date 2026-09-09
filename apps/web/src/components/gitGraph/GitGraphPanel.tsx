import type {
  ContextMenuItem,
  EnvironmentId,
  GitGraphCommit,
  GitGraphCommitFile,
  Task,
  VcsStatusResult,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  ArrowUpRightIcon,
  ChevronDownIcon,
  GitBranchIcon,
  GitCommitVerticalIcon,
  ListTodoIcon,
  Loader2Icon,
  RefreshCwIcon,
  TagIcon,
} from "lucide-react";
import {
  Fragment,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { LegendList } from "@legendapp/list/react";

import { computeGitGraphLayout, type GitGraphRowLayout } from "./gitGraphLanes";
import {
  formatChatTimestampTooltip,
  formatShortDate,
  formatShortTimestamp,
} from "../../timestampFormat";
import { useClientSettings } from "../../hooks/useSettings";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { gitEnvironment } from "../../state/git";
import { vcsEnvironment } from "../../state/vcs";
import { usePreparedConnection } from "../../state/session";
import { fetchTasksQuery } from "../tasks/taskApi";
import { TaskStatusBadge } from "../tasks/TaskDetailsDialog";
import { useTaskLinksChangedVersion } from "../tasks/taskLinkStore";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
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
import { readLocalApi } from "../../localApi";

const GIT_GRAPH_MAX_LIMIT = 500;
const GIT_GRAPH_LOAD_MORE_STEP = 200;
const GIT_GRAPH_ROW_HEIGHT = 56;
const GIT_GRAPH_LANE_SPACING = 14;
const GIT_GRAPH_LANE_COLORS = [
  "hsl(212, 85%, 56%)",
  "hsl(152, 62%, 44%)",
  "hsl(262, 72%, 66%)",
  "hsl(22, 82%, 54%)",
  "hsl(330, 68%, 60%)",
  "hsl(190, 78%, 44%)",
] as const;

const laneColor = (colorIndex: number): string =>
  GIT_GRAPH_LANE_COLORS[colorIndex % GIT_GRAPH_LANE_COLORS.length]!;

type GitGraphDialog =
  | { mode: "create"; oid: string }
  | { mode: "rename"; branch: string }
  | { mode: "delete"; branch: string };

type CommitContextMenuAction = "create-branch" | `rename:${string}` | `delete:${string}`;

type GitGraphListItem =
  | {
      type: "commit";
      key: string;
      commit: GitGraphCommit;
      layout: GitGraphRowLayout;
      isHead: boolean;
    }
  | { type: "commit-detail"; key: string; commit: GitGraphCommit }
  | { type: "file-group"; key: string; oid: string; files: ReadonlyArray<GitGraphCommitFile> }
  | { type: "uncommitted-header"; key: string; files: VcsStatusResult["workingTree"]["files"] }
  | { type: "uncommitted-files"; key: string; files: VcsStatusResult["workingTree"]["files"] }
  | {
      type: "task-branches";
      key: string;
      oid: string;
      branch: string;
      tasks: ReadonlyArray<Task>;
    };

const FILE_STATUS_PRESENTATION: Record<
  GitGraphCommitFile["status"],
  { label: string; className: string }
> = {
  added: { label: "A", className: "text-emerald-600 dark:text-emerald-400" },
  modified: { label: "M", className: "text-amber-600 dark:text-amber-400" },
  deleted: { label: "D", className: "text-red-600 dark:text-red-400" },
  renamed: { label: "R", className: "text-blue-600 dark:text-blue-400" },
  copied: { label: "C", className: "text-blue-600 dark:text-blue-400" },
  typechange: { label: "T", className: "text-violet-600 dark:text-violet-400" },
  unknown: { label: "U", className: "text-muted-foreground" },
};

const CONVENTIONAL_COMMIT_PATTERN = /^([a-z]+)(?:\(([^)]*)\))?(!)?:\s*/;

const CONVENTIONAL_COMMIT_CHIP_CLASS: Record<string, string> = {
  feat: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  fix: "bg-red-500/15 text-red-700 dark:text-red-300",
  docs: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  style: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
  refactor: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  perf: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  test: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  chore: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  build: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  ci: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  revert: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

function CommitSubject({ subject, className }: { subject: string; className?: string }) {
  const match = CONVENTIONAL_COMMIT_PATTERN.exec(subject);
  const chipClass = match === null ? undefined : CONVENTIONAL_COMMIT_CHIP_CLASS[match[1]!];
  if (match === null || chipClass === undefined) {
    return <span className={cn("min-w-0 truncate", className)}>{subject}</span>;
  }
  const [type, scope, breaking] = match.slice(1, 4) as [string, string | undefined, string];
  const message = subject.slice(match[0].length);
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <span
        className={cn(
          "shrink-0 rounded-sm px-1 py-px text-[10px] font-medium leading-4",
          chipClass,
        )}
      >
        {type}
        {breaking}
      </span>
      {scope ? (
        <span className="shrink-0 rounded-sm bg-zinc-500/15 px-1 py-px text-[10px] font-medium leading-4 text-zinc-700 dark:text-zinc-300">
          {scope}
        </span>
      ) : null}
      <span className="min-w-0 truncate">{message}</span>
    </span>
  );
}

function CommitGraphCell({
  layout,
  laneCount,
  rowHeight,
  isTip,
  isHead,
}: {
  layout: GitGraphRowLayout;
  laneCount: number;
  rowHeight: number;
  isTip: boolean;
  isHead: boolean;
}) {
  const width = Math.max(44, laneCount * GIT_GRAPH_LANE_SPACING + 14);
  const laneX = (lane: number) => 10 + lane * GIT_GRAPH_LANE_SPACING;
  const midY = rowHeight / 2;
  const nodeX = laneX(layout.lane);
  const nodeColor = laneColor(layout.colorIndex);
  const nodeLaneBefore = layout.beforeLanes.some((entry) => entry.lane === layout.lane);
  const nodeLaneAfter = layout.afterLanes.some((entry) => entry.lane === layout.lane);

  return (
    <svg
      width={width}
      height={rowHeight}
      viewBox={`0 0 ${width} ${rowHeight}`}
      className="shrink-0"
      aria-hidden="true"
    >
      {/* Through lanes: active entering lines that continue past this node. */}
      {layout.beforeLanes
        .filter((entry) => entry.lane !== layout.lane)
        .map(({ lane, colorIndex }) => (
          <line
            key={`through:${lane}`}
            x1={laneX(lane)}
            y1={0}
            x2={laneX(lane)}
            y2={rowHeight}
            stroke={laneColor(colorIndex)}
            strokeWidth={2}
          />
        ))}
      {/* Incoming line into the node from above. */}
      {nodeLaneBefore ? (
        <line x1={nodeX} y1={0} x2={nodeX} y2={midY} stroke={nodeColor} strokeWidth={2} />
      ) : null}
      {/* Outgoing continuation below the node (first parent). */}
      {nodeLaneAfter ? (
        <line x1={nodeX} y1={midY} x2={nodeX} y2={rowHeight} stroke={nodeColor} strokeWidth={2} />
      ) : null}
      {/* Curved connections to other lanes, terminating on the band bottom. */}
      {layout.downEdges.map((edge) => {
        const x1 = laneX(edge.fromLane);
        const x2 = laneX(edge.toLane);
        const controlOffset = rowHeight * 0.45;
        return (
          <path
            key={`${edge.kind}:${edge.fromLane}:${edge.toLane}`}
            d={`M ${x1} ${midY} C ${x1} ${midY + controlOffset}, ${x2} ${rowHeight - controlOffset}, ${x2} ${rowHeight}`}
            fill="none"
            stroke={laneColor(edge.colorIndex)}
            strokeWidth={2}
          />
        );
      })}
      {/* Branch tips read at a glance: a hollow, color-bordered node on the
          row's tonal background; HEAD gets the heaviest variant. */}
      {isTip ? (
        <circle
          cx={nodeX}
          cy={midY}
          r={isHead ? 7 : 6}
          fill="transparent"
          stroke={nodeColor}
          strokeWidth={isHead ? 2.5 : 2}
        />
      ) : null}
      <circle cx={nodeX} cy={midY} r={isTip ? 3 : 2} fill={nodeColor} opacity={isTip ? 1 : 0.45} />
    </svg>
  );
}

interface GitGraphPanelProps {
  environmentId: EnvironmentId;
  cwd: string;
  onOpenCommitFile: (oid: string, filePath: string) => void;
  onCurrentBranchRenamed: (newBranch: string) => void;
  /** Opens the tasks surface focused on the given task. */
  onOpenTask: (taskId: string) => void;
}

export default function GitGraphPanel({
  environmentId,
  cwd,
  onOpenCommitFile,
  onCurrentBranchRenamed,
  onOpenTask,
}: GitGraphPanelProps) {
  const settings = useClientSettings();
  const [limit, setLimit] = useState(GIT_GRAPH_LOAD_MORE_STEP);
  const [expandedOid, setExpandedOid] = useState<string | null>(null);
  const [dialog, setDialog] = useState<GitGraphDialog | null>(null);
  const [branchName, setBranchName] = useState("");
  const [dialogPending, setDialogPending] = useState(false);
  const switchInFlightRef = useRef(false);

  const graphLogQuery = useEnvironmentQuery(
    gitEnvironment.graphLog({ environmentId, input: { cwd, limit } }),
  );
  const commits = graphLogQuery.data?.commits ?? [];
  const headOid = graphLogQuery.data?.headOid ?? null;

  // Working-tree changes stream live from the vcs status subscription.
  const statusQuery = useEnvironmentQuery(vcsEnvironment.status({ environmentId, input: { cwd } }));
  // The current branch comes from this repo's own status: the graph can be
  // scoped to a project other than the active thread's.
  const currentRefName = statusQuery.data?.refName ?? null;
  const uncommittedFiles = statusQuery.data?.workingTree.files ?? [];
  const hasUncommittedFiles =
    statusQuery.data?.hasWorkingTreeChanges === true && uncommittedFiles.length > 0;
  const [uncommittedExpanded, setUncommittedExpanded] = useState(false);

  // Tasks linked to branches: polled on the graph cadence, and refetched
  // instantly whenever any surface mutates a task (link/unlink/create).
  const prepared = usePreparedConnection(environmentId);
  const taskLinksVersion = useTaskLinksChangedVersion();
  const [linkedTasks, setLinkedTasks] = useState<ReadonlyArray<Task>>([]);
  useEffect(() => {
    if (prepared._tag === "None") return;
    let cancelled = false;
    const load = () => {
      fetchTasksQuery(prepared.value, { pageSize: 200 })
        .then((result) => {
          if (!cancelled) {
            setLinkedTasks(result.tasks.filter((task) => task.linkedBranches.length > 0));
          }
        })
        .catch(() => {
          // Badges are decorative; keep the last good snapshot on failure.
        });
    };
    load();
    const id = setInterval(() => {
      if (document.hidden) return;
      load();
    }, 7_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [prepared, taskLinksVersion]);

  // A clicked task chip reveals that branch's linked tasks in place.
  const [revealedTask, setRevealedTask] = useState<{ oid: string; branch: string } | null>(null);

  const tasksByBranch = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of linkedTasks) {
      for (const branchName of task.linkedBranches) {
        const bucket = map.get(branchName);
        if (bucket) {
          bucket.push(task);
        } else {
          map.set(branchName, [task]);
        }
      }
    }
    return map;
  }, [linkedTasks]);

  const commitFilesQuery = useEnvironmentQuery(
    expandedOid === null
      ? null
      : gitEnvironment.graphCommitFiles({ environmentId, input: { cwd, oid: expandedOid } }),
  );

  const createRef = useAtomCommand(vcsEnvironment.createRef, { reportFailure: false });
  const renameBranch = useAtomCommand(vcsEnvironment.renameBranch, { reportFailure: false });
  const deleteRef = useAtomCommand(vcsEnvironment.deleteRef, { reportFailure: false });
  const switchRef = useAtomCommand(vcsEnvironment.switchRef, { reportFailure: false });

  const layout = useMemo(() => computeGitGraphLayout(commits), [commits]);
  const laneCount = Math.max(layout.laneCount, 1);

  const listItems = useMemo<GitGraphListItem[]>(() => {
    const items: GitGraphListItem[] = [];
    if (hasUncommittedFiles) {
      items.push({ type: "uncommitted-header", key: "uncommitted", files: uncommittedFiles });
      if (uncommittedExpanded) {
        items.push({
          type: "uncommitted-files",
          key: "uncommitted:files",
          files: uncommittedFiles,
        });
      }
    }
    layout.rows.forEach((row, index) => {
      const commit = commits[index];
      if (!commit) return;
      items.push({
        type: "commit",
        key: `commit:${commit.oid}`,
        commit,
        layout: row,
        isHead: commit.oid === headOid,
      });
      if (commit.oid === expandedOid) {
        items.push({ type: "commit-detail", key: `detail:${commit.oid}`, commit });
        const files = commitFilesQuery.data?.files ?? [];
        if (files.length > 0) {
          items.push({ type: "file-group", key: `files:${commit.oid}`, oid: commit.oid, files });
        }
      }
      if (revealedTask !== null && revealedTask.oid === commit.oid) {
        const tasks = tasksByBranch.get(revealedTask.branch) ?? [];
        if (tasks.length > 0) {
          items.push({
            type: "task-branches",
            key: `task-branches:${commit.oid}:${revealedTask.branch}`,
            oid: commit.oid,
            branch: revealedTask.branch,
            tasks,
          });
        }
      }
    });
    return items;
  }, [
    commits,
    expandedOid,
    commitFilesQuery.data?.files,
    hasUncommittedFiles,
    headOid,
    layout.rows,
    linkedTasks,
    revealedTask,
    uncommittedExpanded,
    uncommittedFiles,
  ]);

  const openCreateDialog = useCallback((oid: string) => {
    setBranchName("");
    setDialog({ mode: "create", oid });
  }, []);
  const openRenameDialog = useCallback((branch: string) => {
    setBranchName(branch);
    setDialog({ mode: "rename", branch });
  }, []);
  const openDeleteDialog = useCallback((branch: string) => {
    setBranchName(branch);
    setDialog({ mode: "delete", branch });
  }, []);

  const handleCommitContextMenu = useCallback(
    async (event: ReactMouseEvent, commit: GitGraphCommit) => {
      event.preventDefault();
      event.stopPropagation();

      const api = readLocalApi();
      if (!api) return;

      const localRefs = commit.refs.filter((ref) => ref.kind === "local");
      const items: ContextMenuItem<CommitContextMenuAction>[] = [
        { id: "create-branch", label: "Create branch here" },
        ...localRefs.map((ref) => ({
          id: `rename:${ref.name}` as const,
          label: `Rename ${ref.name}`,
          icon: "pencil",
        })),
        ...localRefs
          .filter((ref) => ref.name !== currentRefName)
          .map((ref) => ({
            id: `delete:${ref.name}` as const,
            label: `Delete ${ref.name}`,
            icon: "trash",
            destructive: true,
          })),
      ];

      const action = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
      if (action === null) return;
      if (action === "create-branch") {
        openCreateDialog(commit.oid);
        return;
      }
      if (action.startsWith("rename:")) {
        openRenameDialog(action.slice("rename:".length));
        return;
      }
      if (action.startsWith("delete:")) {
        openDeleteDialog(action.slice("delete:".length));
      }
    },
    [currentRefName, openCreateDialog, openDeleteDialog, openRenameDialog],
  );

  const handleBranchSwitch = useCallback(
    async (branch: string) => {
      if (branch === currentRefName || switchInFlightRef.current) return;
      switchInFlightRef.current = true;
      try {
        const result = await switchRef({
          environmentId,
          input: { cwd, refName: branch },
        });
        if (result._tag !== "Success") {
          if (!isAtomCommandInterrupted(result)) {
            const cause = squashAtomCommandFailure(result);
            toastManager.add({
              type: "error",
              title: "Failed to switch branch",
              description: cause instanceof Error ? cause.message : "An error occurred.",
            });
          }
          return;
        }
        toastManager.add({ type: "success", title: "Branch switched", description: branch });
        graphLogQuery.refresh();
        statusQuery.refresh();
      } finally {
        switchInFlightRef.current = false;
      }
    },
    [currentRefName, cwd, environmentId, graphLogQuery, statusQuery, switchRef],
  );

  const submitDialog = useCallback(() => {
    if (dialog === null || dialogPending) return;
    const name = branchName.trim();
    if (dialog.mode !== "delete" && name.length === 0) return;
    setDialogPending(true);
    void (async () => {
      try {
        if (dialog.mode === "create") {
          const result = await createRef({
            environmentId,
            input: { cwd, refName: name, startPoint: dialog.oid },
          });
          if (result._tag !== "Success") {
            if (!isAtomCommandInterrupted(result)) {
              const cause = squashAtomCommandFailure(result);
              toastManager.add({
                type: "error",
                title: "Failed to create branch",
                description: cause instanceof Error ? cause.message : "An error occurred.",
              });
            }
            return;
          }
          toastManager.add({ type: "success", title: "Branch created", description: name });
          setDialog(null);
          return;
        }
        if (dialog.mode === "delete") {
          const result = await deleteRef({
            environmentId,
            input: { cwd, refName: dialog.branch },
          });
          if (result._tag !== "Success") {
            if (!isAtomCommandInterrupted(result)) {
              const cause = squashAtomCommandFailure(result);
              toastManager.add({
                type: "error",
                title: "Failed to delete branch",
                description:
                  cause instanceof Error
                    ? cause.message
                    : "Git refuses branches with unmerged commits.",
              });
            }
            return;
          }
          toastManager.add({
            type: "success",
            title: "Branch deleted",
            description: dialog.branch,
          });
          setDialog(null);
          return;
        }
        const previousName = dialog.branch;
        const result = await renameBranch({
          environmentId,
          input: { cwd, oldBranch: previousName, newBranch: name },
        });
        if (result._tag !== "Success") {
          if (!isAtomCommandInterrupted(result)) {
            const cause = squashAtomCommandFailure(result);
            toastManager.add({
              type: "error",
              title: "Failed to rename branch",
              description: cause instanceof Error ? cause.message : "An error occurred.",
            });
          }
          return;
        }
        toastManager.add({
          type: "success",
          title: "Branch renamed",
          description: `${previousName} → ${result.value.refName}`,
        });
        if (previousName === currentRefName) {
          onCurrentBranchRenamed(result.value.refName);
        }
        setDialog(null);
      } finally {
        setDialogPending(false);
      }
    })();
  }, [
    createRef,
    cwd,
    currentRefName,
    deleteRef,
    dialog,
    dialogPending,
    environmentId,
    branchName,
    onCurrentBranchRenamed,
    renameBranch,
  ]);

  const dialogTitle =
    dialog?.mode === "create"
      ? "Create branch here"
      : dialog?.mode === "delete"
        ? "Delete branch"
        : "Rename branch";
  const dialogSubmitLabel =
    dialog?.mode === "create"
      ? "Create branch"
      : dialog?.mode === "delete"
        ? "Delete branch"
        : "Rename branch";
  const dialogInputId = useId();

  const renderRow = useCallback(
    (item: GitGraphListItem) => {
      if (item.type === "uncommitted-header") {
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => setUncommittedExpanded((current) => !current)}
            aria-expanded={uncommittedExpanded}
            className="flex w-full min-w-0 items-center gap-1.5 rounded-lg py-1.5 pr-4 text-left transition-colors focus-visible:bg-accent/50 hover:bg-accent/50 focus-visible:outline-none"
            style={{ paddingLeft: Math.max(52, laneCount * GIT_GRAPH_LANE_SPACING + 26) }}
          >
            <ChevronDownIcon
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                !uncommittedExpanded && "-rotate-90",
              )}
            />
            <span className="min-w-0 truncate text-xs font-medium text-foreground">
              Uncommitted changes
            </span>
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
              {item.files.length}
            </span>
          </button>
        );
      }

      if (item.type === "uncommitted-files") {
        return (
          <div key={item.key} className="my-1 mr-4 rounded-lg py-1">
            {item.files.map((file) => (
              <div
                key={file.path}
                className="flex h-7 w-full min-w-0 items-center gap-2 pr-2 text-left text-xs"
                style={{ paddingLeft: Math.max(52, laneCount * GIT_GRAPH_LANE_SPACING + 26) }}
              >
                <span className="min-w-0 truncate text-foreground/90">{file.path}</span>
                {file.insertions + file.deletions > 0 ? (
                  <span className="ms-auto shrink-0 font-mono text-[10px] tabular-nums">
                    <span className="text-emerald-600 dark:text-emerald-400">
                      +{file.insertions}
                    </span>{" "}
                    <span className="text-red-600 dark:text-red-400">−{file.deletions}</span>
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        );
      }

      if (item.type === "commit-detail") {
        const body = item.commit.body ?? "";
        const dateIso = new Date(item.commit.timestamp * 1000).toISOString();
        return (
          <div
            key={item.key}
            className="my-1 mr-4 space-y-1.5 rounded-lg border border-border/70 bg-muted/30 p-2.5"
            style={{ marginLeft: Math.max(52, laneCount * GIT_GRAPH_LANE_SPACING + 26) }}
          >
            <p className="text-xs leading-5 break-words whitespace-pre-wrap text-foreground">
              {item.commit.subject}
            </p>
            {body.length > 0 ? (
              <p className="text-xs leading-5 break-words whitespace-pre-wrap text-muted-foreground">
                {body}
              </p>
            ) : null}
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground/80">
              <span className="truncate">{item.commit.authorName}</span>
              {item.commit.authorEmail ? (
                <span className="truncate">&lt;{item.commit.authorEmail}&gt;</span>
              ) : null}
              <span aria-hidden="true">·</span>
              <span className="shrink-0">
                {formatChatTimestampTooltip(dateIso, settings.timestampFormat)}
              </span>
              <span aria-hidden="true">·</span>
              <span className="shrink-0 font-mono">{item.commit.oid.slice(0, 7)}</span>
            </p>
          </div>
        );
      }

      if (item.type === "file-group") {
        return (
          <div
            key={item.key}
            className="my-1 mr-4 rounded-lg py-1"
            style={{ marginLeft: Math.max(52, laneCount * GIT_GRAPH_LANE_SPACING + 26) }}
          >
            {item.files.map((file) => {
              const presentation = FILE_STATUS_PRESENTATION[file.status];
              return (
                <button
                  key={`${file.status}:${file.previousPath ?? ""}:${file.path}`}
                  type="button"
                  onClick={() => onOpenCommitFile(item.oid, file.path)}
                  className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md pr-2 pl-2 text-left text-xs transition-colors hover:bg-accent/60"
                >
                  <span
                    className={cn(
                      "w-3 shrink-0 text-center font-mono text-[10px]",
                      presentation.className,
                    )}
                  >
                    {presentation.label}
                  </span>
                  <span className="min-w-0 truncate text-foreground/90">{file.path}</span>
                  {file.previousPath ? (
                    <span className="min-w-0 truncate text-muted-foreground">
                      ← {file.previousPath}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        );
      }

      if (item.type === "task-branches") {
        return (
          <div
            key={item.key}
            className="mb-1 max-w-lg rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-2"
            style={{ marginLeft: Math.max(52, laneCount * GIT_GRAPH_LANE_SPACING + 26) }}
          >
            <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <GitBranchIcon className="size-3 shrink-0" />
              <span className="min-w-0 truncate">
                {item.branch} ·{" "}
                {item.tasks.length === 1 ? "1 linked task" : `${item.tasks.length} linked tasks`}
              </span>
            </p>
            <div className="mt-1.5 space-y-1.5">
              {item.tasks.map((task) => (
                <div key={task.id} className="flex min-w-0 items-center gap-2">
                  <TaskStatusBadge task={task} />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-xs",
                      task.statusCategory === "done" && "text-muted-foreground",
                    )}
                    title={task.title}
                  >
                    {task.title}
                  </span>
                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    {task.linkedBranches.map((branchName) => (
                      <span
                        key={branchName}
                        className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background px-1.5 py-0.5 text-[11px] leading-none"
                      >
                        <GitBranchIcon className="size-3 shrink-0 text-muted-foreground" />
                        {branchName}
                      </span>
                    ))}
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="gap-1.5"
                    aria-label={`Open task ${task.title}`}
                    title="Open task"
                    onClick={() => onOpenTask(task.id)}
                  >
                    <ArrowUpRightIcon className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        );
      }

      const { commit } = item;
      const isBranchTip = commit.refs.some((ref) => ref.kind !== "tag");
      const isCurrentBranchTip = commit.refs.some(
        (ref) => ref.kind === "local" && ref.name === currentRefName,
      );
      const laneTint = laneColor(item.layout.colorIndex);
      const isExpanded = expandedOid === commit.oid;
      return (
        <div
          key={item.key}
          className="relative flex w-full min-w-0 items-center gap-2 pr-4"
          style={{ height: GIT_GRAPH_ROW_HEIGHT }}
        >
          <button
            type="button"
            className="group flex min-h-full min-w-0 flex-1 cursor-pointer items-center gap-2 text-left focus-visible:outline-none"
            style={{ paddingLeft: 4 }}
            onClick={() =>
              setExpandedOid((current) => (current === commit.oid ? null : commit.oid))
            }
            onContextMenu={(event) => void handleCommitContextMenu(event, commit)}
            aria-expanded={isExpanded}
          >
            <span className="relative shrink-0">
              <CommitGraphCell
                layout={item.layout}
                laneCount={laneCount}
                rowHeight={GIT_GRAPH_ROW_HEIGHT}
                isTip={isBranchTip}
                isHead={item.isHead}
              />
            </span>
            <span
              className="flex min-w-0 flex-1 flex-col justify-center rounded-lg py-1 pr-1 transition-colors group-focus-visible:bg-accent/50 group-hover:bg-accent/50"
              style={
                isCurrentBranchTip
                  ? {
                      boxShadow: `inset 0 0 0 9999px color-mix(in srgb, ${laneTint} 7%, transparent)`,
                    }
                  : undefined
              }
            >
              <span className="flex max-w-full min-w-0 flex-col self-start rounded-lg px-2 py-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  {commit.refs
                    .filter(
                      (ref) =>
                        ref.kind === "local" && (tasksByBranch.get(ref.name) ?? []).length > 0,
                    )
                    .map((ref) => {
                      const branchTasks = tasksByBranch.get(ref.name) ?? [];
                      const revealed =
                        revealedTask?.branch === ref.name && revealedTask.oid === commit.oid;
                      return (
                        <button
                          key={`tasks:${ref.name}`}
                          type="button"
                          title={branchTasks.map((task) => task.title).join("\n")}
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium leading-none text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300",
                            revealed && "ring-1 ring-current/40",
                          )}
                          onClick={(event) => {
                            event.stopPropagation();
                            setRevealedTask((current) =>
                              current?.branch === ref.name && current.oid === commit.oid
                                ? null
                                : { oid: commit.oid, branch: ref.name },
                            );
                          }}
                        >
                          <ListTodoIcon className="size-3" />
                          {branchTasks.length}
                        </button>
                      );
                    })}
                  {item.isHead ? (
                    <span className="shrink-0 rounded-sm bg-foreground px-1 py-px font-mono text-[10px] font-medium tracking-wide text-background uppercase">
                      HEAD
                    </span>
                  ) : null}
                  {commit.refs.map((ref) => (
                    <Fragment key={`${ref.kind}:${ref.name}`}>
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium leading-none",
                          ref.kind === "local"
                            ? ref.name === currentRefName
                              ? "border-transparent font-semibold text-white"
                              : "cursor-pointer border-primary/40 bg-primary/15 text-primary"
                            : ref.kind === "tag"
                              ? "border-border/70 bg-transparent text-muted-foreground"
                              : "border-transparent bg-transparent",
                        )}
                        style={
                          ref.kind === "local" && ref.name === currentRefName
                            ? {
                                backgroundColor: `color-mix(in srgb, ${laneTint} 85%, black)`,
                              }
                            : ref.kind === "remote"
                              ? {
                                  borderColor: laneTint,
                                  backgroundColor: `color-mix(in srgb, ${laneTint} 12%, transparent)`,
                                  color: laneTint,
                                }
                              : undefined
                        }
                        title={
                          ref.kind === "local" && ref.name !== currentRefName
                            ? `Double-click to switch to ${ref.name}`
                            : undefined
                        }
                        onDoubleClick={
                          ref.kind === "local" && ref.name !== currentRefName
                            ? (event) => {
                                event.stopPropagation();
                                void handleBranchSwitch(ref.name);
                              }
                            : undefined
                        }
                        onClick={
                          ref.kind === "local"
                            ? (event) => {
                                event.stopPropagation();
                              }
                            : undefined
                        }
                      >
                        {ref.kind === "tag" ? (
                          <TagIcon className="size-3" />
                        ) : (
                          <GitBranchIcon className="size-3" />
                        )}
                        {ref.name}
                      </span>
                    </Fragment>
                  ))}
                  <CommitSubject
                    subject={commit.subject}
                    className={cn(
                      "text-sm",
                      isBranchTip || isExpanded
                        ? "text-foreground"
                        : "text-foreground/60 group-hover:text-foreground",
                    )}
                  />
                </span>
              </span>
              <span
                className={cn(
                  "mt-0.5 flex min-w-0 items-center gap-1.5 pl-2.5 text-xs",
                  isBranchTip || isExpanded ? "text-muted-foreground" : "text-muted-foreground/60",
                )}
              >
                <span className="truncate">{commit.authorName}</span>
                <span aria-hidden="true">·</span>
                <span className="shrink-0">
                  {formatShortTimestamp(
                    new Date(commit.timestamp * 1000).toISOString(),
                    settings.timestampFormat,
                  )}
                </span>
                <span aria-hidden="true">·</span>
                <span className="shrink-0">
                  {formatShortDate(new Date(commit.timestamp * 1000).toISOString())}
                </span>
              </span>
            </span>
          </button>
        </div>
      );
    },
    [
      currentRefName,
      expandedOid,
      laneCount,
      onOpenCommitFile,
      onOpenTask,
      openCreateDialog,
      openDeleteDialog,
      openRenameDialog,
      handleBranchSwitch,
      handleCommitContextMenu,
      revealedTask,
      settings.timestampFormat,
      tasksByBranch,
      uncommittedExpanded,
    ],
  );

  const hasData = graphLogQuery.data !== null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-end gap-1 border-b border-border/70 px-2 py-1">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Refresh graph"
          onClick={graphLogQuery.refresh}
        >
          <RefreshCwIcon className={cn("size-3.5", graphLogQuery.isPending && "animate-spin")} />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        {!hasData && graphLogQuery.isPending ? (
          <div className="flex h-full items-center justify-center">
            <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : graphLogQuery.error !== null ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <GitCommitVerticalIcon className="size-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">{graphLogQuery.error}</p>
            <Button type="button" size="sm" variant="outline" onClick={graphLogQuery.refresh}>
              Retry
            </Button>
          </div>
        ) : hasData && !graphLogQuery.data?.isRepo ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <GitBranchIcon className="size-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">This project has no Git repository.</p>
          </div>
        ) : hasData && commits.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-muted-foreground">No commits yet.</p>
          </div>
        ) : (
          <LegendList<GitGraphListItem>
            data={listItems}
            keyExtractor={(item) => item.key}
            getItemType={(item) => item.type}
            renderItem={({ item }) => renderRow(item)}
            estimatedItemSize={GIT_GRAPH_ROW_HEIGHT}
            className="h-full min-h-0 overflow-x-hidden"
            ListFooterComponent={
              graphLogQuery.data?.nextCursor !== null && graphLogQuery.data !== null ? (
                <div className="flex justify-center py-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={graphLogQuery.isPending}
                    onClick={() =>
                      setLimit((current) =>
                        Math.min(current + GIT_GRAPH_LOAD_MORE_STEP, GIT_GRAPH_MAX_LIMIT),
                      )
                    }
                  >
                    <ChevronDownIcon />
                    Load more
                  </Button>
                </div>
              ) : null
            }
          />
        )}
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(nextOpen) => {
          if (dialogPending) return;
          if (!nextOpen) setDialog(null);
        }}
      >
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>
              {dialog?.mode === "create"
                ? "Creates a local branch pointing at this commit."
                : dialog?.mode === "delete"
                  ? `Deletes the local branch "${dialog.branch}". Git refuses branches with unmerged commits.`
                  : "Renames the local branch in this workspace."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel scrollFade={false}>
            <form
              id={dialogInputId}
              onSubmit={(event) => {
                event.preventDefault();
                submitDialog();
              }}
            >
              {dialog?.mode === "delete" ? null : (
                <Input
                  aria-label="Branch name"
                  autoComplete="off"
                  name="branchName"
                  spellCheck={false}
                  value={branchName}
                  onChange={(event) => setBranchName(event.target.value)}
                />
              )}
            </form>
          </DialogPanel>
          <DialogFooter>
            <Button disabled={dialogPending} variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                dialogPending || (dialog?.mode !== "delete" && branchName.trim().length === 0)
              }
              form={dialogInputId}
              type="submit"
              variant={dialog?.mode === "delete" ? "destructive" : undefined}
            >
              {dialogSubmitLabel}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
