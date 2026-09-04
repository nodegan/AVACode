import { SquareCheckBigIcon, X } from "lucide-react";

import {
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
} from "../composerInlineChip";
import { cn } from "~/lib/utils";
import type { TaskContextDraft } from "~/lib/taskContext";

interface ComposerPendingTaskContextsProps {
  tasks: ReadonlyArray<TaskContextDraft>;
  onRemove: (taskId: string) => void;
  className?: string;
}

export function ComposerPendingTaskContexts({
  tasks,
  onRemove,
  className,
}: ComposerPendingTaskContextsProps) {
  if (tasks.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {tasks.map((task) => (
        <span key={task.id} className={cn(COMPOSER_INLINE_CHIP_CLASS_NAME, "pr-1")}>
          <SquareCheckBigIcon className={cn(COMPOSER_INLINE_CHIP_ICON_CLASS_NAME, "size-3.5")} />
          <span className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}>{task.title}</span>
          <button
            type="button"
            aria-label={`Remove task ${task.title}`}
            className={COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME}
            onClick={() => onRemove(task.taskId)}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
    </div>
  );
}
