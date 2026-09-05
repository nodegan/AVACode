import type { TaskListFacet } from "@t3tools/contracts";
import { Loader2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";

/** Lists grouped by their folder for the task-create target picker. */
export interface TaskListOptionGroup {
  id: string;
  label: string;
  lists: ReadonlyArray<TaskListFacet>;
}

const NO_LIST = "none";
const NO_FOLDER = "none";

interface DialogChromeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: React.ReactNode;
  submitLabel: string;
  submitBusyLabel: string;
  busy: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
}

function DialogChrome(props: DialogChromeProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">{props.children}</DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={props.onSubmit} disabled={!props.canSubmit || props.busy}>
            {props.busy ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
            {props.busy ? props.submitBusyLabel : props.submitLabel}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function CreateTaskDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: ReadonlyArray<TaskListOptionGroup>;
  defaultListId: string | null;
  busy: boolean;
  onSubmit: (input: { title: string; description?: string; listId?: string }) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [listId, setListId] = useState<string>(NO_LIST);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (props.open) {
      setTitle("");
      setDescription("");
      setListId(props.defaultListId ?? NO_LIST);
    }
  }, [props.open, props.defaultListId]);

  const submit = async () => {
    if (submittingRef.current) return;
    const trimmed = title.trim();
    if (trimmed.length === 0 || props.busy) return;
    submittingRef.current = true;
    try {
      const created = await props.onSubmit({
        title: trimmed,
        ...(description.trim().length > 0 ? { description: description.trim() } : {}),
        ...(listId !== NO_LIST ? { listId } : {}),
      });
      if (created) props.onOpenChange(false);
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <DialogChrome
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="New task"
      description="Creates a local task. It stays in AVA Code; provider tasks keep syncing from their source."
      submitLabel="Create task"
      submitBusyLabel="Creating…"
      busy={props.busy}
      canSubmit={title.trim().length > 0}
      onSubmit={() => void submit()}
    >
      <div className="space-y-1.5">
        <Label htmlFor="create-task-title">Title</Label>
        <Input
          id="create-task-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          placeholder="What needs doing?"
          autoFocus
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="create-task-description">Description</Label>
        <Textarea
          id="create-task-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Optional details, acceptance criteria, links…"
          rows={4}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="create-task-list">List</Label>
        <Select
          value={listId}
          onValueChange={(value) => typeof value === "string" && setListId(value)}
        >
          <SelectTrigger id="create-task-list" aria-label="Target list">
            <SelectValue>
              {listId === NO_LIST
                ? "No list"
                : (props.groups.flatMap((group) => group.lists).find((list) => list.id === listId)
                    ?.name ?? "No list")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectItem value={NO_LIST}>No list</SelectItem>
            {props.groups.map((group) => (
              <SelectGroup key={group.id}>
                <SelectGroupLabel>{group.label}</SelectGroupLabel>
                {group.lists.map((list) => (
                  <SelectItem key={list.id} value={list.id}>
                    {list.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
    </DialogChrome>
  );
}

export function CreateListDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: ReadonlyArray<{ id: string; name: string }>;
  busy: boolean;
  onSubmit: (input: { name: string; folderId?: string }) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [folderId, setFolderId] = useState<string>(NO_FOLDER);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (props.open) {
      setName("");
      setFolderId(NO_FOLDER);
    }
  }, [props.open]);

  const submit = async () => {
    if (submittingRef.current) return;
    const trimmed = name.trim();
    if (trimmed.length === 0 || props.busy) return;
    submittingRef.current = true;
    try {
      const created = await props.onSubmit({
        name: trimmed,
        ...(folderId !== NO_FOLDER ? { folderId } : {}),
      });
      if (created) props.onOpenChange(false);
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <DialogChrome
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="New list"
      description="Lists group tasks. Put one in a folder to organize projects."
      submitLabel="Create list"
      submitBusyLabel="Creating…"
      busy={props.busy}
      canSubmit={name.trim().length > 0}
      onSubmit={() => void submit()}
    >
      <div className="space-y-1.5">
        <Label htmlFor="create-list-name">Name</Label>
        <Input
          id="create-list-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          placeholder="e.g. Sprint 42"
          autoFocus
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="create-list-folder">Folder</Label>
        <Select
          value={folderId}
          onValueChange={(value) => typeof value === "string" && setFolderId(value)}
        >
          <SelectTrigger id="create-list-folder" aria-label="Parent folder">
            <SelectValue>
              {folderId === NO_FOLDER
                ? "Top level"
                : (props.folders.find((folder) => folder.id === folderId)?.name ?? "Top level")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectItem value={NO_FOLDER}>Top level</SelectItem>
            {props.folders.map((folder) => (
              <SelectItem key={folder.id} value={folder.id}>
                {folder.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </DialogChrome>
  );
}

export function CreateFolderDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onSubmit: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const submittingRef = useRef(false);

  useEffect(() => {
    if (props.open) setName("");
  }, [props.open]);

  const submit = async () => {
    if (submittingRef.current) return;
    const trimmed = name.trim();
    if (trimmed.length === 0 || props.busy) return;
    submittingRef.current = true;
    try {
      const created = await props.onSubmit(trimmed);
      if (created) props.onOpenChange(false);
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <DialogChrome
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="New folder"
      description="Folders hold lists — one per project keeps tasks tidy."
      submitLabel="Create folder"
      submitBusyLabel="Creating…"
      busy={props.busy}
      canSubmit={name.trim().length > 0}
      onSubmit={() => void submit()}
    >
      <div className="space-y-1.5">
        <Label htmlFor="create-folder-name">Name</Label>
        <Input
          id="create-folder-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          placeholder="e.g. Project X"
          autoFocus
        />
      </div>
    </DialogChrome>
  );
}

/** What a tree delete takes with it, for the confirmation copy. */
export interface TaskTreeDeleteTarget {
  kind: "folder" | "list";
  id: string;
  name: string;
  listCount: number;
  taskCount: number;
}

export function DeleteTreeItemDialog(props: {
  target: TaskTreeDeleteTarget | null;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  // Keep the last target while the alert animates out so its copy never blanks.
  const [lastTarget, setLastTarget] = useState<TaskTreeDeleteTarget | null>(props.target);
  useEffect(() => {
    if (props.target) setLastTarget(props.target);
  }, [props.target]);
  const target = props.target ?? lastTarget;
  if (!target) return null;
  const noun = target.kind === "folder" ? "folder" : "list";
  const scope =
    target.kind === "folder"
      ? target.listCount > 0
        ? `This permanently deletes ${target.listCount === 1 ? "1 list" : `${target.listCount} lists`} and every task inside.`
        : "This folder is empty."
      : target.taskCount > 0
        ? `This permanently deletes the list and ${target.taskCount === 1 ? "its 1 task" : `all ${target.taskCount} tasks in it`}.`
        : "This list is empty.";
  return (
    <AlertDialog
      open={props.target !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <AlertDialogPopup className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete the {noun} &ldquo;{target.name}&rdquo;?
          </AlertDialogTitle>
          <AlertDialogDescription>{scope}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter variant="bare">
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={props.onConfirm} disabled={props.busy}>
            {props.busy ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
            {props.busy ? "Deleting…" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
