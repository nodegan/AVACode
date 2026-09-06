import type { EnvironmentId, Task, ThreadId } from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { GitBranchIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";
import { threadEnvironment } from "~/state/threads";
import { vcsEnvironment } from "~/state/vcs";
import { useProject, useThread } from "~/state/entities";
import { buildTaskBranchName } from "~/lib/taskContext";
import { toastManager } from "../ui/toast";
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
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface CreateTaskBranchButtonProps {
  task: Task;
  environmentId: EnvironmentId;
  threadId: ThreadId | null;
  disabled?: boolean;
}

export function CreateTaskBranchButton(props: CreateTaskBranchButtonProps) {
  const { task, environmentId, threadId } = props;
  const [open, setOpen] = useState(false);
  const [refName, setRefName] = useState("");
  const [pending, setPending] = useState(false);
  const createRef = useAtomCommand(vcsEnvironment.createRef, { reportFailure: false });
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });

  const threadRef = threadId === null ? null : scopeThreadRef(environmentId, threadId);
  const serverThread = useThread(threadRef);
  const projectRef = serverThread ? scopeProjectRef(environmentId, serverThread.projectId) : null;
  const project = useProject(projectRef);
  const cwd = serverThread?.worktreePath ?? project?.workspaceRoot ?? null;
  const ready = serverThread !== null && cwd !== null;

  const openDialog = () => {
    setRefName(buildTaskBranchName(task));
    setOpen(true);
  };

  const createBranch = () => {
    const name = refName.trim();
    if (!threadId || !cwd || !serverThread || pending || name.length === 0) return;
    setPending(true);
    void (async () => {
      try {
        const result = await createRef({
          environmentId,
          input: { cwd, refName: name, switchRef: true },
        });
        if (result._tag === "Success") {
          void updateThreadMetadata({
            environmentId,
            input: {
              threadId,
              branch: result.value.refName,
              worktreePath: serverThread.worktreePath,
            },
          });
          toastManager.add({ type: "success", title: "Branch created", description: name });
          setOpen(false);
          return;
        }
        if (!isAtomCommandInterrupted(result)) {
          const cause = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "Failed to create branch",
            description: cause instanceof Error ? cause.message : "An error occurred.",
          });
        }
      } finally {
        setPending(false);
      }
    })();
  };

  const formId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        // The git command is in flight; don't let Esc or the backdrop drop
        // the dialog mid-create and invite a double submit.
        if (pending) return;
        setOpen(nextOpen);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Create branch"
              disabled={props.disabled || !ready}
              onClick={openDialog}
            >
              <GitBranchIcon className="size-3.5" />
            </Button>
          }
        />
        <TooltipPopup side="bottom">Create branch</TooltipPopup>
      </Tooltip>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create branch</DialogTitle>
          <DialogDescription>
            Edit the prefilled name, then create — the thread switches to the new branch.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel scrollFade={false}>
          <form
            id={formId}
            onSubmit={(event) => {
              event.preventDefault();
              createBranch();
            }}
          >
            <Input
              ref={inputRef}
              aria-label="Branch name"
              autoComplete="off"
              name="refName"
              spellCheck={false}
              value={refName}
              onChange={(event) => setRefName(event.target.value)}
            />
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button disabled={pending} variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={pending || refName.trim().length === 0} form={formId} type="submit">
            Create branch
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
