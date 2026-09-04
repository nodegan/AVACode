import type { EnvironmentId, Task, ThreadId } from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ChevronDownIcon, GitBranchIcon } from "lucide-react";
import { useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";
import { threadEnvironment } from "~/state/threads";
import { vcsEnvironment } from "~/state/vcs";
import { useProject, useThread } from "~/state/entities";
import { buildTaskBranchName, TASK_BRANCH_PREFIXES } from "~/lib/taskContext";
import { toastManager } from "../ui/toast";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/menu";

interface CreateTaskBranchButtonProps {
  task: Task;
  environmentId: EnvironmentId;
  threadId: ThreadId | null;
  disabled?: boolean;
}

export function CreateTaskBranchButton(props: CreateTaskBranchButtonProps) {
  const { task, environmentId, threadId } = props;
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

  const createBranch = (prefix: (typeof TASK_BRANCH_PREFIXES)[number]) => {
    const refName = buildTaskBranchName(task, prefix);
    if (!threadId || !cwd || !serverThread || pending) return;
    setPending(true);
    void (async () => {
      try {
        const result = await createRef({
          environmentId,
          input: { cwd, refName, switchRef: true },
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
          toastManager.add({ type: "success", title: "Branch created", description: refName });
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" disabled={props.disabled || !ready || pending}>
            <GitBranchIcon className="size-3.5" />
            Create branch
            <ChevronDownIcon className="size-3 opacity-70" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-72">
        {TASK_BRANCH_PREFIXES.map((prefix) => (
          <DropdownMenuItem key={prefix} onClick={() => createBranch(prefix)}>
            <span className="font-medium">{prefix}</span>
            <span className="min-w-0 truncate text-muted-foreground">
              /{buildTaskBranchName(task, prefix).split("/").slice(1).join("/")}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
