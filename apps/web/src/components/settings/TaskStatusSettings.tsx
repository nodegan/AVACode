import type { TaskStatus, TaskStatusCategory } from "@t3tools/contracts";
import { TaskStatusId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { PrimaryEnvironmentHttpClient } from "~/environments/primary/httpClient";
import { runPrimaryHttp } from "~/lib/runtime";
import { cn } from "~/lib/utils";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { ITEM_ROW_CLASSNAME, ITEM_ROW_INNER_CLASSNAME } from "./itemRows";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** Categories users can pick; "unknown" is a server-side fallback, not a choice. */
const EDITABLE_CATEGORIES = ["open", "in_progress", "blocked", "done"] as const;

const CATEGORY_LABELS: Record<TaskStatusCategory, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  blocked: "Blocked",
  unknown: "Unknown",
};

const STATUS_COLORS = [
  "#2563eb",
  "#16a34a",
  "#0284c7",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#db2777",
] as const;

type EditorTarget =
  | { readonly mode: "create" }
  | { readonly mode: "edit"; readonly status: TaskStatus };

const taskStatusesEffect = () =>
  PrimaryEnvironmentHttpClient.pipe(
    Effect.flatMap((client) => client.tasks.taskStatuses({ headers: {} })),
  );

const createStatusEffect = (input: {
  label: string;
  category: TaskStatusCategory;
  color?: string;
}) =>
  PrimaryEnvironmentHttpClient.pipe(
    Effect.flatMap((client) => client.tasks.createTaskStatus({ headers: {}, payload: input })),
  );

const updateStatusEffect = (input: {
  statusId: string;
  label?: string;
  category?: TaskStatusCategory;
  color?: string | null;
}) =>
  PrimaryEnvironmentHttpClient.pipe(
    Effect.flatMap((client) =>
      client.tasks.updateTaskStatus({
        headers: {},
        payload: {
          statusId: TaskStatusId.make(input.statusId),
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
        },
      }),
    ),
  );

const deleteStatusEffect = (input: { statusId: string; reassignToStatusId?: string }) =>
  PrimaryEnvironmentHttpClient.pipe(
    Effect.flatMap((client) =>
      client.tasks.deleteTaskStatus({
        headers: {},
        payload: {
          statusId: TaskStatusId.make(input.statusId),
          ...(input.reassignToStatusId !== undefined
            ? { reassignToStatusId: TaskStatusId.make(input.reassignToStatusId) }
            : {}),
        },
      }),
    ),
  );

function StatusColorSwatches(props: {
  value: string | null;
  onChange: (color: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-label="No color"
        aria-pressed={props.value === null}
        onClick={() => props.onChange(null)}
        className={cn(
          "size-5 cursor-pointer rounded-full border border-border/70 bg-muted/40 text-muted-foreground",
          props.value === null && "ring-2 ring-ring ring-offset-2 ring-offset-background",
        )}
      >
        <span className="mx-auto block h-px w-2.5 -rotate-45 bg-current" />
      </button>
      {STATUS_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Select color ${color}`}
          aria-pressed={props.value === color}
          onClick={() => props.onChange(color)}
          className={cn(
            "size-5 cursor-pointer rounded-full transition-transform active:scale-90",
            props.value === color && "ring-2 ring-ring ring-offset-2 ring-offset-background",
          )}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

function StatusEditorDialog(props: {
  target: EditorTarget;
  busy: boolean;
  error: string | null;
  onSubmit: (input: { label: string; category: TaskStatusCategory; color: string | null }) => void;
  onClose: () => void;
}) {
  const editing = props.target.mode === "edit" ? props.target.status : null;
  const [label, setLabel] = useState(editing?.label ?? "");
  const [category, setCategory] = useState<TaskStatusCategory>(editing?.category ?? "open");
  const [color, setColor] = useState<string | null>(editing?.color ?? null);

  useEffect(() => {
    if (props.target.mode === "edit") {
      setLabel(props.target.status.label);
      setCategory(props.target.status.category);
      setColor(props.target.status.color);
    } else {
      setLabel("");
      setCategory("open");
      setColor(null);
    }
  }, [props.target]);

  const canSubmit = label.trim().length > 0;
  const submit = () => {
    if (!canSubmit || props.busy) return;
    props.onSubmit({ label: label.trim(), category, color });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit status" : "New status"}</DialogTitle>
          <DialogDescription>
            Statuses label manual tasks and drive their color in the task panels.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="task-status-label">Name</Label>
            <Input
              id="task-status-label"
              value={label}
              onChange={(event) => setLabel(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
              placeholder="e.g. In review"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-status-category">Kind</Label>
            <Select
              value={category}
              onValueChange={(value) => {
                if (typeof value === "string" && value in CATEGORY_LABELS) {
                  setCategory(value as TaskStatusCategory);
                }
              }}
            >
              <SelectTrigger id="task-status-category" aria-label="Status kind">
                <SelectValue>{CATEGORY_LABELS[category]}</SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {EDITABLE_CATEGORIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {CATEGORY_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The kind decides how the status behaves: Done sorts last, Blocked stands out, and so
              on.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <StatusColorSwatches value={color} onChange={setColor} />
          </div>
          {props.error ? <p className="text-xs text-destructive">{props.error}</p> : null}
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || props.busy}>
            {props.busy ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
            {editing ? "Save changes" : "Create status"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function DeleteStatusDialog(props: {
  target: TaskStatus;
  survivors: ReadonlyArray<TaskStatus>;
  busy: boolean;
  error: string | null;
  /** Where attached tasks move; null when the status has none. */
  onConfirm: (reassignToStatusId: string | null) => void;
  onClose: () => void;
}) {
  const hasTasks = props.target.taskCount > 0;
  const [reassignTo, setReassignTo] = useState<string>(props.survivors[0]?.id ?? "");

  const description = hasTasks
    ? `${props.target.taskCount} ${props.target.taskCount === 1 ? "task uses" : "tasks use"} this status. Pick where they move — they keep their place in lists.`
    : "No tasks use this status. You can remove it safely.";

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <AlertDialogPopup className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete the &ldquo;{props.target.label}&rdquo; status?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {hasTasks ? (
          <div className="space-y-1.5">
            <Label htmlFor="delete-status-reassign">Move tasks to</Label>
            <Select
              value={reassignTo}
              onValueChange={(value) => typeof value === "string" && setReassignTo(value)}
            >
              <SelectTrigger id="delete-status-reassign" aria-label="Replacement status">
                <SelectValue>
                  {props.survivors.find((status) => status.id === reassignTo)?.label ?? ""}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {props.survivors.map((status) => (
                  <SelectItem key={status.id} value={status.id}>
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {props.survivors.length === 0 ? (
              <p className="text-xs text-destructive">
                Create another status first — its tasks need somewhere to go.
              </p>
            ) : null}
          </div>
        ) : null}
        {props.error ? <p className="text-xs text-destructive">{props.error}</p> : null}
        <AlertDialogFooter variant="bare">
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={
              props.busy || (hasTasks && (reassignTo === "" || props.survivors.length === 0))
            }
            onClick={() => props.onConfirm(hasTasks ? reassignTo : null)}
          >
            {props.busy ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
            {props.busy ? "Deleting…" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

export function TaskStatusSettingsPanel() {
  const [statuses, setStatuses] = useState<ReadonlyArray<TaskStatus> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskStatus | null>(null);

  const loadStatuses = useCallback(async (silent = false) => {
    if (!silent) setStatuses(null);
    try {
      const result = await runPrimaryHttp(taskStatusesEffect());
      setStatuses(result.statuses);
      setError(null);
    } catch (cause) {
      if (!silent) {
        setError(cause instanceof Error ? cause.message : "Failed to load task statuses.");
      }
    }
  }, []);

  useEffect(() => {
    void loadStatuses();
  }, [loadStatuses]);

  const runMutation = useCallback(
    async (key: string, action: () => Promise<unknown>) => {
      setBusyKey(key);
      setDialogError(null);
      try {
        await action();
        await loadStatuses(true);
        return true;
      } catch (cause) {
        setDialogError(cause instanceof Error ? cause.message : "Task status request failed.");
        return false;
      } finally {
        setBusyKey(null);
      }
    },
    [loadStatuses],
  );

  const submitEditor = useCallback(
    (input: { label: string; category: TaskStatusCategory; color: string | null }) => {
      if (!editorTarget) return;
      const statusId = editorTarget.mode === "edit" ? editorTarget.status.id : null;
      void runMutation("status-save", async () => {
        if (statusId) {
          await runPrimaryHttp(
            updateStatusEffect({
              statusId,
              label: input.label,
              category: input.category,
              color: input.color,
            }),
          );
        } else {
          await runPrimaryHttp(
            createStatusEffect({
              label: input.label,
              category: input.category,
              ...(input.color !== null ? { color: input.color } : {}),
            }),
          );
        }
      }).then((saved) => {
        if (saved) setEditorTarget(null);
      });
    },
    [editorTarget, runMutation],
  );

  const confirmDelete = useCallback(
    (reassignToStatusId: string | null) => {
      if (!deleteTarget) return;
      void runMutation("status-delete", async () => {
        await runPrimaryHttp(
          deleteStatusEffect({
            statusId: deleteTarget.id,
            ...(reassignToStatusId === null ? {} : { reassignToStatusId }),
          }),
        );
      }).then((deleted) => {
        if (deleted) setDeleteTarget(null);
      });
    },
    [deleteTarget, runMutation],
  );

  const list = statuses ?? [];
  const survivorsForDelete = deleteTarget
    ? list.filter((status) => status.id !== deleteTarget.id)
    : [];

  return (
    <SettingsPageContainer>
      <SettingsSection
        id={searchableSetting("task-statuses").id}
        title="Task statuses"
        headerAction={
          <Button size="sm" variant="outline" onClick={() => setEditorTarget({ mode: "create" })}>
            <PlusIcon />
            Add status
          </Button>
        }
      >
        <p className="px-3 text-[13px] leading-[1.45] text-muted-foreground/80 sm:px-4">
          Statuses label manual tasks everywhere they appear. Deleting one moves its tasks to a
          status you pick.
        </p>
        {error ? <p className="px-3 text-xs text-destructive sm:px-4">{error}</p> : null}
        {statuses === null && !error ? (
          <div className={ITEM_ROW_CLASSNAME}>
            <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : list.length === 0 ? (
          <p className="px-3 py-6 text-sm text-muted-foreground sm:px-4">
            No statuses yet — add one to start labeling tasks.
          </p>
        ) : (
          list.map((status) => (
            <div key={status.id} className={ITEM_ROW_CLASSNAME}>
              <div className={ITEM_ROW_INNER_CLASSNAME}>
                <div className="min-w-0 space-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          status.color ?? "color-mix(in srgb, currentColor 30%, transparent)",
                      }}
                      aria-hidden
                    />
                    <span className="truncate text-sm font-medium tracking-[-0.005em] text-foreground">
                      {status.label}
                    </span>
                    <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                      {CATEGORY_LABELS[status.category]}
                    </span>
                  </div>
                  <p className="text-[13px] text-muted-foreground/80">
                    {status.taskCount === 0
                      ? "Not used by any task"
                      : `Used by ${status.taskCount} ${status.taskCount === 1 ? "task" : "tasks"}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Edit ${status.label}`}
                    onClick={() => {
                      setDialogError(null);
                      setEditorTarget({ mode: "edit", status });
                    }}
                  >
                    <PencilIcon className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${status.label}`}
                    onClick={() => {
                      setDialogError(null);
                      setDeleteTarget(status);
                    }}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </SettingsSection>

      {editorTarget ? (
        <StatusEditorDialog
          target={editorTarget}
          busy={busyKey === "status-save"}
          error={dialogError}
          onSubmit={submitEditor}
          onClose={() => {
            setEditorTarget(null);
            setDialogError(null);
          }}
        />
      ) : null}
      {deleteTarget ? (
        <DeleteStatusDialog
          target={deleteTarget}
          survivors={survivorsForDelete}
          busy={busyKey === "status-delete"}
          error={dialogError}
          onConfirm={confirmDelete}
          onClose={() => {
            setDeleteTarget(null);
            setDialogError(null);
          }}
        />
      ) : null}
    </SettingsPageContainer>
  );
}
