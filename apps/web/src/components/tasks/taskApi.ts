import {
  makeEnvironmentHttpApiClient,
  executeEnvironmentHttpRequest,
} from "@t3tools/client-runtime/rpc";
import { type PreparedConnection } from "@t3tools/client-runtime/connection";
import { environmentEndpointUrl } from "@t3tools/client-runtime/environment";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import type {
  Task,
  TaskAttachmentsResult,
  TaskCommentsResult,
  TaskFolder,
  TaskId,
  TaskLinksResult,
  TaskList,
  TaskPanel,
  TaskQueryFilter,
  TaskQueryResult,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { FetchHttpClient, type HttpMethod } from "effect/unstable/http";

import { runtime } from "~/lib/runtime";

export interface EnvironmentHttpAuthHeaders {
  readonly authorization?: string;
  readonly dpop?: string;
}

function withEnvironmentCredentials<A, E, R>(
  authorization: PreparedConnection["httpAuthorization"],
  request: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return authorization === null
    ? request.pipe(Effect.provideService(FetchHttpClient.RequestInit, { credentials: "include" }))
    : request;
}

function buildEnvironmentAuthHeaders(
  authorization: PreparedConnection["httpAuthorization"],
  method: HttpMethod.HttpMethod,
  url: string,
  signer: Option.Option<ManagedRelay.ManagedRelayDpopSigner["Service"]>,
) {
  return Effect.gen(function* () {
    if (authorization === null) {
      return {};
    }
    if (authorization._tag === "Bearer") {
      return { authorization: `Bearer ${authorization.token}` };
    }
    if (Option.isNone(signer)) {
      return yield* Effect.fail("No DPoP signer is available for this environment.");
    }
    const proof = yield* signer.value.createProof({
      method,
      url,
      accessToken: authorization.accessToken,
    });
    return {
      authorization: `DPoP ${authorization.accessToken}`,
      dpop: proof,
    };
  });
}

export async function runTasksRequest<A, E>(
  prepared: PreparedConnection,
  requestUrl: string,
  method: HttpMethod.HttpMethod,
  request: (
    client: Effect.Success<ReturnType<typeof makeEnvironmentHttpApiClient>>,
    headers: EnvironmentHttpAuthHeaders,
  ) => Effect.Effect<A, E>,
  timeoutMs = 8_000,
): Promise<A> {
  return runtime.runPromise(
    Effect.gen(function* () {
      const client = yield* makeEnvironmentHttpApiClient(prepared.httpBaseUrl);
      const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
      const headers = yield* buildEnvironmentAuthHeaders(
        prepared.httpAuthorization,
        method,
        requestUrl,
        signer,
      );
      return yield* executeEnvironmentHttpRequest(
        requestUrl,
        timeoutMs,
        withEnvironmentCredentials(prepared.httpAuthorization, request(client, headers)),
      );
    }),
  );
}

export async function fetchTaskPanel(prepared: PreparedConnection): Promise<TaskPanel> {
  const requestUrl = environmentEndpointUrl(prepared.httpBaseUrl, "/api/tasks/panel");
  return runTasksRequest(prepared, requestUrl, "GET", (client, headers) =>
    client.tasks.panel({
      headers,
    }),
  );
}

export async function fetchTasksQuery(
  prepared: PreparedConnection,
  filter: TaskQueryFilter,
): Promise<TaskQueryResult> {
  const requestUrl = environmentEndpointUrl(prepared.httpBaseUrl, "/api/tasks/query");
  return runTasksRequest(prepared, requestUrl, "POST", (client, headers) =>
    client.tasks.queryTasks({
      headers,
      payload: { filter },
    }),
  );
}

export async function fetchTaskLinks(prepared: PreparedConnection): Promise<TaskLinksResult> {
  const requestUrl = environmentEndpointUrl(prepared.httpBaseUrl, "/api/tasks/links");
  return runTasksRequest(prepared, requestUrl, "GET", (client, headers) =>
    client.tasks.links({
      headers,
    }),
  );
}

export async function fetchThreadTask(
  prepared: PreparedConnection,
  threadId: ThreadId,
): Promise<Task | null> {
  const result = await fetchTasksQuery(prepared, { linkedThreadId: threadId, pageSize: 1 });
  return result.tasks[0] ?? null;
}

// Both detail fetches relay to the provider, whose latency spikes past the
// default request timeout; give them a wider window.
const PROVIDER_DETAIL_TIMEOUT_MS = 20_000;

export async function fetchTaskAttachments(
  prepared: PreparedConnection,
  taskId: TaskId,
): Promise<TaskAttachmentsResult> {
  const requestUrl = environmentEndpointUrl(
    prepared.httpBaseUrl,
    `/api/tasks/attachments/${taskId}`,
  );
  return runTasksRequest(
    prepared,
    requestUrl,
    "GET",
    (client, headers) =>
      client.tasks.taskAttachments({
        params: { taskId },
        headers,
      }),
    PROVIDER_DETAIL_TIMEOUT_MS,
  );
}

export async function fetchTaskComments(
  prepared: PreparedConnection,
  taskId: TaskId,
): Promise<TaskCommentsResult> {
  const requestUrl = environmentEndpointUrl(prepared.httpBaseUrl, `/api/tasks/comments/${taskId}`);
  return runTasksRequest(
    prepared,
    requestUrl,
    "GET",
    (client, headers) =>
      client.tasks.taskComments({
        params: { taskId },
        headers,
      }),
    PROVIDER_DETAIL_TIMEOUT_MS,
  );
}

export async function setTaskLinkedThread(
  prepared: PreparedConnection,
  taskId: TaskId,
  linkedThreadId: ThreadId | null,
): Promise<void> {
  const requestUrl = environmentEndpointUrl(prepared.httpBaseUrl, "/api/tasks/task");
  await runTasksRequest(prepared, requestUrl, "POST", (client, headers) =>
    client.tasks.updateTask({
      headers,
      payload: { taskId, linkedThreadId },
    }),
  );
}

export async function addTaskNote(
  prepared: PreparedConnection,
  taskId: TaskId,
  body: string,
): Promise<void> {
  const requestUrl = environmentEndpointUrl(prepared.httpBaseUrl, "/api/tasks/notes");
  await runTasksRequest(prepared, requestUrl, "POST", (client, headers) =>
    client.tasks.addNote({
      headers,
      payload: { taskId, body },
    }),
  );
}

export async function deleteTask(prepared: PreparedConnection, taskId: TaskId): Promise<void> {
  const requestUrl = environmentEndpointUrl(prepared.httpBaseUrl, "/api/tasks/delete");
  await runTasksRequest(prepared, requestUrl, "POST", (client, headers) =>
    client.tasks.deleteTask({
      headers,
      payload: { taskId },
    }),
  );
}

export async function deleteTaskList(prepared: PreparedConnection, listId: string): Promise<void> {
  const requestUrl = environmentEndpointUrl(prepared.httpBaseUrl, "/api/tasks/lists/delete");
  await runTasksRequest(prepared, requestUrl, "POST", (client, headers) =>
    client.tasks.deleteList({
      headers,
      payload: { listId },
    }),
  );
}

export async function deleteTaskFolder(
  prepared: PreparedConnection,
  folderId: string,
): Promise<void> {
  const requestUrl = environmentEndpointUrl(prepared.httpBaseUrl, "/api/tasks/folders/delete");
  await runTasksRequest(prepared, requestUrl, "POST", (client, headers) =>
    client.tasks.deleteFolder({
      headers,
      payload: { folderId },
    }),
  );
}

export async function createManualTask(
  prepared: PreparedConnection,
  input: { title: string; description?: string; listId?: string },
): Promise<Task> {
  const requestUrl = environmentEndpointUrl(prepared.httpBaseUrl, "/api/tasks/manual");
  return runTasksRequest(prepared, requestUrl, "POST", (client, headers) =>
    client.tasks.createManual({
      headers,
      payload: input,
    }),
  );
}

export async function createTaskList(
  prepared: PreparedConnection,
  input: { name: string; folderId?: string },
): Promise<TaskList> {
  const requestUrl = environmentEndpointUrl(prepared.httpBaseUrl, "/api/tasks/lists");
  return runTasksRequest(prepared, requestUrl, "POST", (client, headers) =>
    client.tasks.createList({
      headers,
      payload: input,
    }),
  );
}

export async function createTaskFolder(
  prepared: PreparedConnection,
  name: string,
): Promise<TaskFolder> {
  const requestUrl = environmentEndpointUrl(prepared.httpBaseUrl, "/api/tasks/folders");
  return runTasksRequest(prepared, requestUrl, "POST", (client, headers) =>
    client.tasks.createFolder({
      headers,
      payload: { name },
    }),
  );
}

export async function syncProviderTasks(
  prepared: PreparedConnection,
  providerId: string,
): Promise<TaskPanel> {
  const requestUrl = environmentEndpointUrl(
    prepared.httpBaseUrl,
    `/api/tasks/providers/${providerId}/sync`,
  );
  return runTasksRequest(prepared, requestUrl, "POST", (client, headers) =>
    client.tasks.syncProvider({
      params: { providerId },
      headers,
    }),
  );
}
