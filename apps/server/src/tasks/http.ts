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
import { ProjectTaskService } from "./ProjectTaskService.ts";

export const tasksHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "tasks",
  Effect.fnUntraced(function* (handlers) {
    const tasks = yield* ProjectTaskService;

    return handlers
      .handle(
        "panel",
        Effect.fn("environment.tasks.panel")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* tasks
            .getPanel(args.params.projectId)
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
        "addComment",
        Effect.fn("environment.tasks.addComment")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tasks
            .addComment(args.payload)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_comment_failed", cause)));
        }),
      )
      .handle(
        "setClickUpToken",
        Effect.fn("environment.tasks.setClickUpToken")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tasks
            .setClickUpToken(args.payload.token)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_clickup_failed", cause)));
        }),
      )
      .handle(
        "clearClickUpToken",
        Effect.fn("environment.tasks.clearClickUpToken")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tasks
            .clearClickUpToken()
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_clickup_failed", cause)));
        }),
      )
      .handle(
        "clickUpLists",
        Effect.fn("environment.tasks.clickUpLists")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tasks
            .getClickUpLists(args.payload)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_clickup_failed", cause)));
        }),
      )
      .handle(
        "setClickUpSyncConfig",
        Effect.fn("environment.tasks.setClickUpSyncConfig")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tasks
            .setClickUpSyncConfig(args.payload)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_clickup_failed", cause)));
        }),
      )
      .handle(
        "syncClickUpTasks",
        Effect.fn("environment.tasks.syncClickUpTasks")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tasks
            .syncClickUpTasks(args.payload)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("tasks_clickup_failed", cause)));
        }),
      );
  }),
);
