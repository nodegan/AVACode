import { createFileRoute } from "@tanstack/react-router";

import { ClickUpSettings } from "../components/settings/ClickUpSettings";
import { TaskStatusSettingsPanel } from "../components/settings/TaskStatusSettings";
import { SettingsPageContainer } from "../components/settings/settingsLayout";

export const Route = createFileRoute("/settings/tasks")({
  component: () => (
    <SettingsPageContainer>
      <TaskStatusSettingsPanel />
      <ClickUpSettings />
    </SettingsPageContainer>
  ),
});
