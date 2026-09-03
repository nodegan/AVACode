import * as Effect from "effect/Effect";
import { useCallback, useEffect, useState } from "react";

import { PrimaryEnvironmentHttpClient } from "~/environments/primary/httpClient";
import { runPrimaryHttp } from "~/lib/runtime";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

type ClickUpConnectionState = "loading" | "connected" | "disconnected";

function clickUpStatusEffect() {
  return PrimaryEnvironmentHttpClient.pipe(
    Effect.flatMap((client) => client.tasks.clickUpStatus({ headers: {} })),
  );
}

export function ClickUpSettings() {
  const [connectionState, setConnectionState] = useState<ClickUpConnectionState>("loading");
  const [tokenDraft, setTokenDraft] = useState("");
  const [isBusy, setBusy] = useState(false);

  const refreshStatus = useCallback(() => {
    setConnectionState("loading");
    runPrimaryHttp(clickUpStatusEffect())
      .then((status) => setConnectionState(status.tokenConfigured ? "connected" : "disconnected"))
      .catch(() => setConnectionState("disconnected"));
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const handleConnect = useCallback(() => {
    const token = tokenDraft.trim();
    if (!token) return;
    setBusy(true);
    runPrimaryHttp(
      PrimaryEnvironmentHttpClient.pipe(
        Effect.flatMap((client) =>
          client.tasks.setClickUpToken({ headers: {}, payload: { token } }),
        ),
      ),
    )
      .then(() => {
        setTokenDraft("");
        setConnectionState("connected");
        toastManager.add({
          type: "success",
          title: "ClickUp connected",
          description: "Projects can now sync tasks from your ClickUp workspace.",
        });
      })
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not connect ClickUp",
            description: error instanceof Error ? error.message : "Check the token and try again.",
          }),
        );
      })
      .finally(() => setBusy(false));
  }, [tokenDraft]);

  const handleDisconnect = useCallback(() => {
    setBusy(true);
    runPrimaryHttp(
      PrimaryEnvironmentHttpClient.pipe(
        Effect.flatMap((client) => client.tasks.clearClickUpToken({ headers: {} })),
      ),
    )
      .then(() => {
        setConnectionState("disconnected");
        toastManager.add({ type: "success", title: "ClickUp disconnected" });
      })
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not disconnect ClickUp",
            description: error instanceof Error ? error.message : "Unexpected error.",
          }),
        );
      })
      .finally(() => setBusy(false));
  }, []);

  const description =
    connectionState === "connected"
      ? "Connected. Start a sync from a project's Tasks panel to pull in every task from your workspace."
      : "Connect a ClickUp personal API token (pk_…) so projects can sync tasks from your ClickUp workspace.";

  return (
    <SettingsSection {...searchableSetting("clickup")}>
      <SettingsRow title="ClickUp" description={description}>
        {connectionState === "loading" ? (
          <Spinner className="size-4" />
        ) : connectionState === "connected" ? (
          <Button
            size="xs"
            variant="destructive-outline"
            disabled={isBusy}
            onClick={handleDisconnect}
          >
            {isBusy ? "Disconnecting…" : "Disconnect"}
          </Button>
        ) : (
          <div className="flex gap-2">
            <Input
              type="password"
              value={tokenDraft}
              onChange={(event) => setTokenDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleConnect();
              }}
              placeholder="ClickUp personal API token (pk_…)"
            />
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={isBusy || tokenDraft.trim().length === 0}
            >
              {isBusy ? <Spinner className="size-3.5" /> : null}
              Connect
            </Button>
          </div>
        )}
      </SettingsRow>
    </SettingsSection>
  );
}
