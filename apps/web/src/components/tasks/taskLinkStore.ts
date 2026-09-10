import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import { EnvironmentId, type TaskLinkSummary } from "@t3tools/contracts";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { usePreparedConnection } from "~/state/session";

import { fetchTaskLinks } from "./taskApi";

interface TaskLinksState {
  /** All linked tasks per thread; a thread can carry several. */
  readonly byThreadId: ReadonlyMap<string, ReadonlyArray<TaskLinkSummary>>;
}

const EMPTY_STATE: TaskLinksState = { byThreadId: new Map() };

/**
 * Which environment threads hold linked tasks. One lightweight request per
 * environment feeds every indicator surface: header chip, sidebar icons, and
 * task mutations refresh it through `notifyTasksChanged`.
 */
function createTaskLinksStore() {
  const states = new Map<string, TaskLinksState>();
  const preparedByEnvironmentId = new Map<string, PreparedConnection>();
  const inflight = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const load = (environmentId: string) => {
    const prepared = preparedByEnvironmentId.get(environmentId);
    if (!prepared || inflight.has(environmentId)) return;
    const promise = (async () => {
      try {
        const result = await fetchTaskLinks(prepared);
        const byThreadId = new Map<string, Array<TaskLinkSummary>>();
        for (const link of result.links) {
          const bucket = byThreadId.get(link.threadId);
          if (bucket) {
            bucket.push(link);
          } else {
            byThreadId.set(link.threadId, [link]);
          }
        }
        states.set(environmentId, { byThreadId });
      } catch {
        // Indicators are decorative; keep the last good snapshot on failure.
      } finally {
        inflight.delete(environmentId);
        emit();
      }
    })();
    inflight.set(environmentId, promise);
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState(environmentId: EnvironmentId): TaskLinksState {
      return states.get(environmentId) ?? EMPTY_STATE;
    },
    prepare(environmentId: EnvironmentId, prepared: PreparedConnection) {
      const isNew = !preparedByEnvironmentId.has(environmentId);
      preparedByEnvironmentId.set(environmentId, prepared);
      if (isNew || !states.has(environmentId)) load(environmentId);
    },
    refresh(environmentId?: EnvironmentId) {
      if (environmentId) {
        load(environmentId);
        return;
      }
      for (const id of preparedByEnvironmentId.keys()) load(id);
    },
  };
}

const taskLinksStore = createTaskLinksStore();

let changeVersion = 0;

export function notifyTasksChanged(environmentId?: EnvironmentId) {
  changeVersion += 1;
  taskLinksStore.refresh(environmentId);
}

/**
 * Monotonic counter that bumps whenever any surface mutates a task, so other
 * surfaces (the git graph) can refetch instantly instead of waiting for their
 * own poll.
 */
export function useTaskLinksChangedVersion(): number {
  return useSyncExternalStore(taskLinksStore.subscribe, () => changeVersion);
}

function useTaskLinksStoreState(environmentId: EnvironmentId): TaskLinksState {
  const preparedOption = usePreparedConnection(environmentId);
  const state = useSyncExternalStore(taskLinksStore.subscribe, () =>
    taskLinksStore.getState(environmentId),
  );
  useEffect(() => {
    if (preparedOption._tag === "Some") {
      taskLinksStore.prepare(environmentId, preparedOption.value);
    }
  }, [environmentId, preparedOption]);
  return state;
}

export function useTaskLinksByThreadId(
  environmentId: EnvironmentId,
): ReadonlyMap<string, ReadonlyArray<TaskLinkSummary>> {
  return useTaskLinksStoreState(environmentId).byThreadId;
}

interface TaskPanelViewRequest {
  readonly environmentId: EnvironmentId;
  readonly taskId: string;
}

// One-shot "open this task in the tasks panel" signal so surfaces outside the
// panel (the header indicator's dialog) can drive its dedicated detail view.
// Dropped on delivery: a panel remount (switching right-panel tabs) must not
// replay an already-handled request.
let panelViewRequest: TaskPanelViewRequest | null = null;
const panelViewListeners = new Set<() => void>();

export function requestTaskPanelView(environmentId: EnvironmentId, taskId: string) {
  panelViewRequest = { environmentId, taskId };
  for (const listener of panelViewListeners) listener();
}

export function useTaskPanelViewRequest(
  environmentId: EnvironmentId,
  onTaskSelected: (taskId: string) => void,
) {
  const handlerRef = useRef(onTaskSelected);
  useEffect(() => {
    handlerRef.current = onTaskSelected;
  });
  useEffect(() => {
    // Consume on mount too: the request may fire before the panel exists.
    const consume = () => {
      const request = panelViewRequest;
      if (!request || request.environmentId !== environmentId) return;
      panelViewRequest = null;
      handlerRef.current(request.taskId);
    };
    consume();
    panelViewListeners.add(consume);
    return () => {
      panelViewListeners.delete(consume);
    };
  }, [environmentId]);
}
