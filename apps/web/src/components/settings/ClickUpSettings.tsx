import type { TaskProviderConnectionStatus, TaskProviderWorkspace } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { CheckIcon, ListTodoIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { PrimaryEnvironmentHttpClient } from "~/environments/primary/httpClient";
import { runPrimaryHttp } from "~/lib/runtime";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { ConnectionStatusDot } from "../ConnectionStatusDot";
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
import { Label } from "../ui/label";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { ITEM_ROW_CLASSNAME, ITEM_ROW_INNER_CLASSNAME } from "./itemRows";
import { SettingsSection, useRelativeTimeTick } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/**
 * ClickUp is the first task provider; the connection rides the generic
 * provider endpoints, so additional providers slot into this shape.
 */
const CLICKUP_PROVIDER_ID = "clickup";

const SYNC_POLL_INTERVAL_MS = 2_000;

const DISCONNECTED_STATUS: TaskProviderConnectionStatus = {
  credentialConfigured: false,
  accountLabel: null,
  accountId: null,
  lastSyncAt: null,
  lastSyncError: null,
  syncing: false,
};

const absoluteTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function clickUpStatusEffect() {
  return PrimaryEnvironmentHttpClient.pipe(
    Effect.flatMap((client) =>
      client.tasks.providerStatus({ headers: {}, params: { providerId: CLICKUP_PROVIDER_ID } }),
    ),
  );
}

function clickUpWorkspacesEffect() {
  return PrimaryEnvironmentHttpClient.pipe(
    Effect.flatMap((client) =>
      client.tasks.listProviderWorkspaces({
        headers: {},
        params: { providerId: CLICKUP_PROVIDER_ID },
      }),
    ),
  );
}

const clickUpCredentialEffect = (token: string) =>
  PrimaryEnvironmentHttpClient.pipe(
    Effect.flatMap((client) =>
      client.tasks.setProviderCredential({
        headers: {},
        params: { providerId: CLICKUP_PROVIDER_ID },
        payload: { token },
      }),
    ),
  );

const clickUpClearCredentialEffect = () =>
  PrimaryEnvironmentHttpClient.pipe(
    Effect.flatMap((client) =>
      client.tasks.clearProviderCredential({
        headers: {},
        params: { providerId: CLICKUP_PROVIDER_ID },
      }),
    ),
  );

const clickUpWorkspaceEffect = (workspaceId: string) =>
  PrimaryEnvironmentHttpClient.pipe(
    Effect.flatMap((client) =>
      client.tasks.setProviderWorkspace({
        headers: {},
        params: { providerId: CLICKUP_PROVIDER_ID },
        payload: { workspaceId },
      }),
    ),
  );

/**
 * Connect (token step, then workspace pick) or change the workspace on an
 * existing connection. Closing mid-flow is safe: the credential only matters
 * once a workspace is confirmed, which is also what kicks the first sync.
 */
function ClickUpConnectDialog(props: {
  /** "token" starts a fresh connect; "workspace" re-picks on a live connection. */
  readonly initialStep: "token" | "workspace";
  readonly currentWorkspaceId: string | null;
  readonly onClose: () => void;
}) {
  const [step, setStep] = useState(props.initialStep);
  const [tokenDraft, setTokenDraft] = useState("");
  const [workspaces, setWorkspaces] = useState<ReadonlyArray<TaskProviderWorkspace> | null>(null);
  const [workspacesError, setWorkspacesError] = useState<string | null>(null);
  const [workspaceDraft, setWorkspaceDraft] = useState(props.currentWorkspaceId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadWorkspaces = useCallback(async () => {
    setWorkspaces(null);
    setWorkspacesError(null);
    try {
      const result = await runPrimaryHttp(clickUpWorkspacesEffect());
      setWorkspaces(result.workspaces);
      return result.workspaces;
    } catch (cause) {
      setWorkspacesError(
        cause instanceof Error ? cause.message : "Could not load your ClickUp workspaces.",
      );
      return null;
    }
  }, []);

  useEffect(() => {
    if (step === "workspace") void loadWorkspaces();
  }, [step, loadWorkspaces]);

  const handleTokenSubmit = useCallback(async () => {
    const token = tokenDraft.trim();
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await runPrimaryHttp(clickUpCredentialEffect(token));
      const list = await loadWorkspaces();
      if (list !== null && list.length === 0) {
        setError("No ClickUp workspaces are available for this token.");
        return;
      }
      setTokenDraft("");
      setWorkspaceDraft((current) => (current || list === null ? current : (list[0]?.id ?? "")));
      setStep("workspace");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the token and try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, loadWorkspaces, tokenDraft]);

  const handleWorkspaceConfirm = useCallback(async () => {
    if (!workspaceDraft || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Saving the workspace kicks the sync on the server; the section picks
      // up the progress spinner from the returned status.
      await runPrimaryHttp(clickUpWorkspaceEffect(workspaceDraft));
      toastManager.add({
        type: "success",
        title: "Syncing ClickUp tasks",
        description: "Tasks will appear in your projects' task panels as they land.",
      });
      props.onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error.");
      setBusy(false);
    }
  }, [busy, props, workspaceDraft]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup className="max-w-md">
        {step === "token" ? (
          <>
            <DialogHeader>
              <DialogTitle>Connect ClickUp</DialogTitle>
              <DialogDescription>
                Tasks sync read-only from your ClickUp workspace — nothing is ever written back to
                ClickUp.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="clickup-token">Personal API token</Label>
                <Input
                  id="clickup-token"
                  type="password"
                  value={tokenDraft}
                  onChange={(event) => setTokenDraft(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleTokenSubmit();
                  }}
                  placeholder="pk_…"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Create one in ClickUp under Settings → Apps.
                </p>
              </div>
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
            </DialogPanel>
            <DialogFooter variant="bare">
              <Button variant="outline" onClick={props.onClose}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleTokenSubmit()}
                disabled={busy || !tokenDraft.trim()}
              >
                {busy ? <Spinner className="size-3.5" /> : null}
                Connect
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Choose a workspace</DialogTitle>
              <DialogDescription>
                Tasks sync from the workspace you pick. Confirming starts the first sync.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-3">
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {workspaces === null && workspacesError === null ? (
                  <div className="flex items-center justify-center py-6">
                    <Spinner className="size-4 text-muted-foreground" />
                  </div>
                ) : workspacesError !== null ? (
                  <div className="space-y-2 py-4 text-center">
                    <p className="text-xs text-destructive">{workspacesError}</p>
                    <Button size="sm" variant="outline" onClick={() => void loadWorkspaces()}>
                      Retry
                    </Button>
                  </div>
                ) : (
                  (workspaces ?? []).map((workspace) => {
                    const selected = workspace.id === workspaceDraft;
                    return (
                      <button
                        key={workspace.id}
                        type="button"
                        onClick={() => setWorkspaceDraft(workspace.id)}
                        className={cn(
                          "flex w-full cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                          selected
                            ? "border-ring bg-muted/60"
                            : "border-border/70 hover:bg-muted/40",
                        )}
                      >
                        <ListTodoIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                        {selected ? <CheckIcon className="size-4 shrink-0" /> : null}
                      </button>
                    );
                  })
                )}
              </div>
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
            </DialogPanel>
            <DialogFooter variant="bare">
              <Button variant="outline" onClick={props.onClose}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleWorkspaceConfirm()}
                disabled={busy || !workspaceDraft}
              >
                {busy ? <Spinner className="size-3.5" /> : null}
                Sync tasks
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogPopup>
    </Dialog>
  );
}

export function ClickUpSettings() {
  const [status, setStatus] = useState<TaskProviderConnectionStatus | null>(null);
  const [dialog, setDialog] = useState<"token" | "workspace" | null>(null);

  // Re-render on a slow tick so the relative "last synced" label stays honest
  // without repainting per second.
  useRelativeTimeTick(30_000);

  const refreshStatus = useCallback(async (silent = false) => {
    if (!silent) setStatus(null);
    try {
      setStatus(await runPrimaryHttp(clickUpStatusEffect()));
    } catch {
      // A silent refresh failing (poll hiccup) keeps the current status; a
      // visible one renders the disconnected state.
      if (!silent) setStatus(DISCONNECTED_STATUS);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // While a sync runs, poll the status so progress and the fresh "last
  // synced" label land as soon as the server's fiber finishes.
  const isSyncing = status?.syncing ?? false;
  useEffect(() => {
    if (!isSyncing) return;
    const id = setInterval(() => void refreshStatus(true), SYNC_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isSyncing, refreshStatus]);

  const handleDisconnect = useCallback(async () => {
    try {
      await runPrimaryHttp(clickUpClearCredentialEffect());
      // The server drops the stored config with the credential, so every
      // field (workspace name, last sync) resets, not just the connection.
      setStatus(DISCONNECTED_STATUS);
      toastManager.add({ type: "success", title: "ClickUp disconnected" });
    } catch (error: unknown) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not disconnect ClickUp",
          description: error instanceof Error ? error.message : "Unexpected error.",
        }),
      );
    }
  }, []);

  const isLoading = status === null;
  const isConnected = status?.credentialConfigured ?? false;
  const workspaceName = status?.accountLabel?.trim() || null;
  const lastSyncAt = status?.lastSyncAt ?? null;
  const lastSyncError = status?.lastSyncError ?? null;

  const title = workspaceName ?? "ClickUp";
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

  const statusLine = isLoading ? (
    <p className="text-xs text-muted-foreground">Checking connection…</p>
  ) : isSyncing ? (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Spinner className="size-3" />
      Syncing tasks from ClickUp… Large workspaces can take a few minutes.
    </p>
  ) : isConnected ? (
    lastSyncAt !== null ? (
      <p className="text-xs text-muted-foreground" title={lastSyncAbsolute ?? undefined}>
        Last synced {formatRelativeTimeLabel(lastSyncAt) || lastSyncAbsolute}
      </p>
    ) : (
      <p className="text-xs text-muted-foreground">No sync yet — pick a workspace to start one.</p>
    )
  ) : null;

  return (
    <SettingsSection {...searchableSetting("clickup")}>
      {isLoading ? (
        <div className={ITEM_ROW_CLASSNAME}>
          <div className={ITEM_ROW_INNER_CLASSNAME}>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex min-h-5 items-center gap-1.5">
                <ConnectionStatusDot tooltipText={null} dotClassName={dotClassName} />
                <h3 className="min-w-0 truncate text-sm font-medium text-foreground">ClickUp</h3>
              </div>
              <p className="text-xs text-muted-foreground">Checking connection…</p>
            </div>
            <Spinner className="size-4 shrink-0 text-muted-foreground" />
          </div>
        </div>
      ) : isConnected ? (
        <>
          <p className="px-3 text-[13px] leading-[1.45] text-muted-foreground/80 sm:px-4">
            Tasks sync read-only from the workspace selected below — nothing is ever written back to
            ClickUp.
          </p>
          <div className={ITEM_ROW_CLASSNAME}>
            <div className={ITEM_ROW_INNER_CLASSNAME}>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex min-h-5 items-center gap-1.5">
                  <ConnectionStatusDot tooltipText={statusTooltip} dotClassName={dotClassName} />
                  <h3 className="min-w-0 truncate text-sm font-medium text-foreground">{title}</h3>
                  <span className="shrink-0 rounded-md border border-border/50 bg-muted/50 px-1 py-0.5 text-[10px] text-muted-foreground">
                    Connected
                  </span>
                </div>
                {statusLine}
                {lastSyncError ? (
                  <p className="text-xs text-destructive">Sync failed: {lastSyncError}</p>
                ) : null}
              </div>
              <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => setDialog("workspace")}
                  disabled={isSyncing}
                >
                  {workspaceName ? "Change" : "Choose"} workspace
                </Button>
                <Button
                  size="xs"
                  variant="destructive-outline"
                  onClick={() => void handleDisconnect()}
                >
                  Disconnect
                </Button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 px-6 py-10 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl border border-border/60 bg-muted/40">
            <ListTodoIcon className="size-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-foreground">Connect ClickUp</h3>
            <p className="mx-auto max-w-sm text-[13px] leading-[1.45] text-muted-foreground/80">
              Sync tasks read-only from your ClickUp workspace into every project&apos;s task panel.
              Nothing is ever written back to ClickUp.
            </p>
          </div>
          <Button size="sm" onClick={() => setDialog("token")}>
            Connect
          </Button>
        </div>
      )}
      {dialog !== null ? (
        <ClickUpConnectDialog
          key={dialog}
          initialStep={dialog}
          currentWorkspaceId={status?.accountId ?? null}
          onClose={() => {
            setDialog(null);
            void refreshStatus(true);
          }}
        />
      ) : null}
    </SettingsSection>
  );
}
