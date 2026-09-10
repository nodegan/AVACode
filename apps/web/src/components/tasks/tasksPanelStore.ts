import { create } from "zustand";

export type TasksPanelView = "browse" | "tasks" | "detail";

export type TasksPanelListSelection =
  | { readonly kind: "all" }
  | { readonly kind: "list"; listId: string };

/**
 * Where the user is inside the tasks panel. Held in a store rather than
 * component state because the panel unmounts whenever another right-panel
 * surface (git graph, diff, …) is active; this is what makes the Tasks tab
 * come back exactly where it was left.
 */
export interface TasksPanelLocation {
  readonly view: TasksPanelView;
  readonly selectedTaskId: string | null;
  readonly viewBeforeDetail: "browse" | "tasks";
  readonly listSelection: TasksPanelListSelection;
  readonly page: number;
}

const DEFAULT_LOCATION: TasksPanelLocation = {
  view: "browse",
  selectedTaskId: null,
  viewBeforeDetail: "tasks",
  listSelection: { kind: "all" },
  page: 1,
};

interface TasksPanelStoreState {
  readonly byProjectKey: Record<string, TasksPanelLocation>;
  update: (projectKey: string, patch: Partial<TasksPanelLocation>) => void;
}

export const useTasksPanelStore = create<TasksPanelStoreState>()((set) => ({
  byProjectKey: {},
  update: (projectKey, patch) =>
    set((state) => {
      const current = state.byProjectKey[projectKey] ?? DEFAULT_LOCATION;
      return {
        byProjectKey: { ...state.byProjectKey, [projectKey]: { ...current, ...patch } },
      };
    }),
}));

export function selectTasksPanelLocation(
  byProjectKey: Record<string, TasksPanelLocation>,
  projectKey: string,
): TasksPanelLocation {
  return byProjectKey[projectKey] ?? DEFAULT_LOCATION;
}
