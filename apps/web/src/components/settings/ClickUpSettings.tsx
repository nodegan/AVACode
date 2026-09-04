import type { ClickUpConnectionStatus } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useState } from "react";

import { PrimaryEnvironmentHttpClient } from "~/environments/primary/httpClient";
import { runPrimaryHttp } from "~/lib/runtime";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { ConnectionStatusDot } from "../ConnectionStatusDot";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { ITEM_ROW_CLASSNAME, ITEM_ROW_INNER_CLASSNAME } from "./itemRows";
import { SettingsSection, useRelativeTimeTick } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

type BusyAction = "connect" | "disconnect" | null;

const DISCONNECTED_STATUS: ClickUpConnectionStatus = {
  tokenConfigured: false,
  workspaceName: null,
  lastSyncAt: null,
  lastSyncError: null,
};

const absoluteTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function clickUpStatusEffect() {
  return PrimaryEnvironmentHttpClient.pipe(
    Effect.flatMap((client) => client.tasks.clickUpStatus({ headers: {} })),
  );
}

export function ClickUpSettings() {
  const [status, setStatus] = useState<ClickUpConnectionStatus | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");
  const [busyAction, setBusyAction] = useState<BusyAction>(null);

  // Re-render on a slow tick so the relative "last synced" label stays honest
  // without repainting per second.
  useRelativeTimeTick(30_000);

  const refreshStatus = useCallback((silent: boolean) => {
    if (!silent) setStatus(null);
    runPrimaryHttp(clickUpStatusEffect())
      .then(setStatus)
      .catch(() => setStatus(DISCONNECTED_STATUS));
  }, []);

  useEffect(() => {
    refreshStatus(false);
  }, [refreshStatus]);

  const handleConnect = useCallback(() => {
    const token = tokenDraft.trim();
    if (!token) return;
    setBusyAction("connect");
    runPrimaryHttp(
      PrimaryEnvironmentHttpClient.pipe(
        Effect.flatMap((client) =>
          client.tasks.setClickUpToken({ headers: {}, payload: { token } }),
        ),
      ),
    )
      .then(() => {
        setTokenDraft("");
        setStatus((current) => (current ? { ...current, tokenConfigured: true } : current));
        // Pick up the account name without flashing the loading state.
        refreshStatus(true);
        toastManager.add({
          type: "success",
          title: "ClickUp connected",
          description: "Start a sync from a project's Tasks panel to pull in tasks.",
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
      .finally(() => setBusyAction(null));
  }, [refreshStatus, tokenDraft]);

  const handleDisconnect = useCallback(() => {
    setBusyAction("disconnect");
    runPrimaryHttp(
      PrimaryEnvironmentHttpClient.pipe(
        Effect.flatMap((client) => client.tasks.clearClickUpToken({ headers: {} })),
      ),
    )
      .then(() => {
        setStatus((current) =>
          current ? { ...current, tokenConfigured: false, lastSyncError: null } : current,
        );
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
      .finally(() => setBusyAction(null));
  }, []);

  const isLoading = status === null;
  const isConnected = status?.tokenConfigured ?? false;
  const workspaceName = status?.workspaceName?.trim() || null;
  const lastSyncAt = status?.lastSyncAt ?? null;
  const lastSyncError = status?.lastSyncError ?? null;

  const title = workspaceName ?? "ClickUp";
  const stateLabel = isLoading ? "Checking…" : isConnected ? "Connected" : "Not connected";
  const dotClassName = isLoading
    ? "bg-muted-foreground/30"
    : isConnected
      ? "bg-success"
      : "bg-muted-foreground/40";
  const statusTooltip = isLoading
    ? null
    : isConnected
      ? workspaceName
        ? `Connected to ${workspaceName}`
        : "Connected"
      : "Not connected";
  const lastSyncAbsolute =
    lastSyncAt !== null && !Number.isNaN(new Date(lastSyncAt).getTime())
      ? absoluteTimeFormatter.format(new Date(lastSyncAt))
      : null;

  return (
    <SettingsSection {...searchableSetting("clickup")}>
      <div className={ITEM_ROW_CLASSNAME}>
        <div className={ITEM_ROW_INNER_CLASSNAME}>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-h-5 items-center gap-1.5">
              <ConnectionStatusDot tooltipText={statusTooltip} dotClassName={dotClassName} />
              <h3 className="min-w-0 truncate text-sm font-medium text-foreground">{title}</h3>
              <span className="shrink-0 rounded-md border border-border/50 bg-muted/50 px-1 py-0.5 text-[10px] text-muted-foreground">
                {stateLabel}
              </span>
            </div>
            {isLoading ? (
              <p className="text-xs text-muted-foreground">Checking connection…</p>
            ) : isConnected ? (
              lastSyncAt !== null ? (
                <p className="text-xs text-muted-foreground" title={lastSyncAbsolute ?? undefined}>
                  Last synced {formatRelativeTimeLabel(lastSyncAt) || lastSyncAbsolute}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No sync yet — start one from a project&apos;s Tasks panel.
                </p>
              )
            ) : (
              <p className="text-xs text-muted-foreground">
                Connect a personal API token (pk_…) so projects can sync tasks from your ClickUp
                workspace.
              </p>
            )}
            {!isLoading && lastSyncError ? (
              <p className="text-xs text-destructive">Sync failed: {lastSyncError}</p>
            ) : null}
          </div>
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
            {isLoading ? (
              <Spinner className="size-4 text-muted-foreground" />
            ) : isConnected ? (
              <Button
                size="xs"
                variant="destructive-outline"
                disabled={busyAction !== null}
                onClick={handleDisconnect}
              >
                {busyAction === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </Button>
            ) : (
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <Input
                  type="password"
                  value={tokenDraft}
                  onChange={(event) => setTokenDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleConnect();
                  }}
                  placeholder="Personal API token (pk_…)"
                  className="sm:w-80"
                />
                <Button
                  size="sm"
                  onClick={handleConnect}
                  disabled={busyAction !== null || tokenDraft.trim().length === 0}
                >
                  {busyAction === "connect" ? <Spinner className="size-3.5" /> : null}
                  Connect
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
