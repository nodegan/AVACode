import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  requireEnvironmentScope,
} from "../auth/http.ts";
import { TaskService } from "./TaskService.ts";

export const tasksHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "tasks",
  Effect.fnUntraced(function* (handlers) {
    const tasks = yield* TaskService;

    return handlers
      .handle(
        "panel",
        Effect.fn("environment.tasks.panel")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* tasks
            .getPanel()
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_panel_failed", cause)));
        }),
      )
      .handle(
        "queryTasks",
        Effect.fn("environment.tasks.queryTasks")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* tasks
            .queryTasks(args.payload)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_panel_failed", cause)));
        }),
      )
      .handle(
        "links",
        Effect.fn("environment.tasks.links")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* tasks
            .listLinks()
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_panel_failed", cause)));
        }),
      )
      .handle(
        "createManual",
        Effect.fn("environment.tasks.createManual")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tasks
            .createManualTask(args.payload)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_upsert_failed", cause)));
        }),
      )
      .handle(
        "createList",
        Effect.fn("environment.tasks.createList")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tasks
            .createList(args.payload)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_upsert_failed", cause)));
        }),
      )
      .handle(
        "createFolder",
        Effect.fn("environment.tasks.createFolder")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tasks
            .createFolder(args.payload)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_upsert_failed", cause)));
        }),
      )
      .handle(
        "updateTask",
        Effect.fn("environment.tasks.updateTask")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tasks
            .updateTask(args.payload)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_upsert_failed", cause)));
        }),
      )
      .handle(
        "deleteTask",
        Effect.fn("environment.tasks.deleteTask")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tasks
            .deleteTask(args.payload)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_upsert_failed", cause)));
        }),
      )
      .handle(
        "deleteList",
        Effect.fn("environment.tasks.deleteList")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tasks
            .deleteList(args.payload)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_upsert_failed", cause)));
        }),
      )
      .handle(
        "deleteFolder",
        Effect.fn("environment.tasks.deleteFolder")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tasks
            .deleteFolder(args.payload)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_upsert_failed", cause)));
        }),
      )
      .handle(
        "taskStatuses",
        Effect.fn("environment.tasks.taskStatuses")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* tasks
            .listStatuses()
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_panel_failed", cause)));
        }),
      )
      .handle(
        "createTaskStatus",
        Effect.fn("environment.tasks.createTaskStatus")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tasks
            .createStatus(args.payload)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_upsert_failed", cause)));
        }),
      )
      .handle(
        "updateTaskStatus",
        Effect.fn("environment.tasks.updateTaskStatus")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tasks
            .updateStatus(args.payload)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_upsert_failed", cause)));
        }),
      )
      .handle(
        "deleteTaskStatus",
        Effect.fn("environment.tasks.deleteTaskStatus")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tasks
            .deleteStatus(args.payload)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_upsert_failed", cause)));
        }),
      )
      .handle(
        "addNote",
        Effect.fn("environment.tasks.addNote")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tasks
            .addNote(args.payload)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_note_failed", cause)));
        }),
      )
      .handle(
        "taskAttachments",
        Effect.fn("environment.tasks.taskAttachments")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* tasks
            .getTaskAttachments(args.params.taskId)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_provider_failed", cause)));
        }),
      )
      .handle(
        "taskComments",
        Effect.fn("environment.tasks.taskComments")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* tasks
            .getTaskComments(args.params.taskId)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_provider_failed", cause)));
        }),
      )
      .handle(
        "setProviderCredential",
        Effect.fn("environment.tasks.setProviderCredential")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tasks
            .setProviderCredential({
              providerId: args.params.providerId,
              token: args.payload.token,
            })
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_provider_failed", cause)));
        }),
      )
      .handle(
        "clearProviderCredential",
        Effect.fn("environment.tasks.clearProviderCredential")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tasks
            .clearProviderCredential({ providerId: args.params.providerId })
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_provider_failed", cause)));
        }),
      )
      .handle(
        "providerStatus",
        Effect.fn("environment.tasks.providerStatus")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* tasks
            .getProviderStatus({ providerId: args.params.providerId })
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_provider_failed", cause)));
        }),
      )
      .handle(
        "syncProvider",
        Effect.fn("environment.tasks.syncProvider")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tasks
            .syncProviderTasks({ providerId: args.params.providerId })
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_provider_failed", cause)));
        }),
      );
  }),
);
