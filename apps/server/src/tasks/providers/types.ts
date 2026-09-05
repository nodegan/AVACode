import type { TaskAttachment, TaskComment, TaskStatusCategory } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { HttpClient } from "effect/unstable/http";

import { makeClickUpAdapter } from "./clickup.ts";

/** A task row's provider-shaped payload, normalized before it reaches the store. */
export interface ProviderTaskSnapshot {
  readonly externalTaskId: string;
  readonly externalCustomId: string | null;
  readonly title: string;
  readonly description: string;
  readonly statusLabel: string;
  readonly statusCategory: TaskStatusCategory;
  readonly statusColor: string | null;
  readonly externalUrl: string | null;
  /** List/folder refs are namespaced by the provider and resolved to local registry rows. */
  readonly externalListId: string | null;
  readonly externalListName: string | null;
  readonly externalFolderId: string | null;
  readonly externalFolderName: string | null;
  readonly assignees: ReadonlyArray<string>;
  readonly externalCreatedAt: string | null;
  readonly externalUpdatedAt: string | null;
}

export class TaskProviderError extends Schema.TaggedErrorClass<TaskProviderError>()(
  "TaskProviderError",
  {
    provider: Schema.String,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `${this.provider} ${this.operation}: ${this.detail}`;
  }
}

export const taskProviderError = (
  provider: string,
  operation: string,
  detail: string,
  cause?: unknown,
) =>
  new TaskProviderError({
    provider,
    operation,
    detail,
    ...(cause === undefined ? {} : { cause }),
  });

/**
 * One task provider (ClickUp today, Linear next). The adapter owns everything
 * provider-shaped — auth, config schema, wire payloads, status mapping — and
 * hands the store clean snapshots. Adapters are plain objects built from the
 * HttpClient; provider config travels as the adapter's own opaque JSON blob
 * stored in task_provider_configs.
 */
export interface TaskProviderAdapter {
  readonly id: string;
  readonly label: string;
  /** ServerSecretStore key holding the credential. */
  readonly credentialSecretKey: string;
  /** Users paste "Bearer …" and other decorated forms; normalize before store/use. */
  readonly normalizeCredential: (raw: string) => string;
  /** Serialized config for a fresh connection (e.g. the credential's first workspace). */
  readonly bootstrapConfig: (credential: string) => Effect.Effect<string, TaskProviderError>;
  /** Account label for status display; null when it cannot be determined. */
  readonly accountLabel: (input: {
    readonly credential: string;
    readonly configJson: string | null;
  }) => Effect.Effect<string | null, TaskProviderError>;
  /** Account label from the stored config alone — no network, for panel reads. */
  readonly cachedAccountLabel: (configJson: string | null) => string | null;
  readonly fetchSyncTasks: (input: {
    readonly credential: string;
    readonly configJson: string;
  }) => Effect.Effect<ReadonlyArray<ProviderTaskSnapshot>, TaskProviderError>;
  readonly fetchTaskAttachments: (input: {
    readonly credential: string;
    readonly externalTaskId: string;
  }) => Effect.Effect<ReadonlyArray<TaskAttachment>, TaskProviderError>;
  readonly fetchTaskComments: (input: {
    readonly credential: string;
    readonly externalTaskId: string;
  }) => Effect.Effect<ReadonlyArray<TaskComment>, TaskProviderError>;
}

export class TaskProviderRegistry extends Context.Service<
  TaskProviderRegistry,
  {
    readonly providers: ReadonlyArray<TaskProviderAdapter>;
    readonly get: (providerId: string) => TaskProviderAdapter | null;
  }
>()("t3/tasks/providers/types/TaskProviderRegistry") {}

export const TaskProviderRegistryLive = Layer.effect(
  TaskProviderRegistry,
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const providers: ReadonlyArray<TaskProviderAdapter> = [makeClickUpAdapter(httpClient)];
    return TaskProviderRegistry.of({
      providers,
      get: (providerId) => providers.find((provider) => provider.id === providerId) ?? null,
    });
  }),
);
