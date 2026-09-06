import { createFileRoute } from "@tanstack/react-router";

import { TaskStatusSettingsPanel } from "../components/settings/TaskStatusSettings";

export const Route = createFileRoute("/settings/tasks")({
  component: TaskStatusSettingsPanel,
});
