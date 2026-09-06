import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { vcsCommandConcurrency, vcsCommandScheduler } from "./vcsCommandScheduler.ts";

export function createGitEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    pullRequestResolution: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:resolve-pull-request",
      tag: WS_METHODS.gitResolvePullRequest,
    }),
    preparePullRequestThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:prepare-pull-request-thread",
      tag: WS_METHODS.gitPreparePullRequestThread,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
    graphLog: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:graph-log",
      tag: WS_METHODS.gitGraphLog,
      // Poll while the graph panel is open; the idle TTL stops the timer
      // once the panel unmounts.
      refreshIntervalMs: 7_000,
    }),
    graphCommitFiles: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:graph-commit-files",
      tag: WS_METHODS.gitGraphCommitFiles,
    }),
    graphCommitDiff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:graph-commit-diff",
      tag: WS_METHODS.gitGraphCommitDiff,
      // Commit patches are immutable; let the graph panel decide when to refresh.
      staleTimeMs: 300_000,
      idleTtlMs: 300_000,
    }),
  };
}
