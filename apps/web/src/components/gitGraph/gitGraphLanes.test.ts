import { describe, expect, it } from "vite-plus/test";

import { computeGitGraphLayout } from "./gitGraphLanes";

describe("computeGitGraphLayout", () => {
  it("lays out a linear history on a single lane", () => {
    const layout = computeGitGraphLayout([
      { oid: "c3", parents: ["c2"] },
      { oid: "c2", parents: ["c1"] },
      { oid: "c1", parents: [] },
    ]);

    expect(layout.laneCount).toBe(1);
    expect(layout.rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    // The first row opens the lane: nothing enters its node from above.
    expect(layout.rows[0]?.beforeLanes).toEqual([]);
    // The first parent's continuation is the node lane staying active, not an edge.
    expect(layout.rows.map((row) => row.downEdges)).toEqual([[], [], []]);
    expect(layout.rows[0]?.afterLanes).toEqual([{ lane: 0, colorIndex: 0 }]);
    expect(layout.rows[1]?.beforeLanes).toEqual([{ lane: 0, colorIndex: 0 }]);
    // The root commit frees the lane.
    expect(layout.rows[2]?.afterLanes).toEqual([]);
  });

  it("branches out onto a new lane for a second parent and merges back", () => {
    const layout = computeGitGraphLayout([
      { oid: "merge", parents: ["main-tip", "feature-tip"] },
      { oid: "main-tip", parents: ["base"] },
      { oid: "feature-tip", parents: ["base"] },
      { oid: "base", parents: [] },
    ]);

    // The merge occupies lane 0; both parents arrive on the rows below.
    expect(layout.rows[0]?.lane).toBe(0);
    // First parent takes over the merge's lane (no edge); second parent
    // branches out to lane 1 with the new lane's own color.
    expect(layout.rows[0]?.downEdges).toEqual([
      { fromLane: 0, toLane: 1, colorIndex: 1, kind: "branch-out" },
    ]);
    expect(layout.rows[0]?.afterLanes).toEqual([
      { lane: 0, colorIndex: 0 },
      { lane: 1, colorIndex: 1 },
    ]);

    expect(layout.rows[1]?.lane).toBe(0);
    // feature-tip (row 2) arrives on the branched lane; lane 1 passes through row 1.
    expect(layout.rows[1]?.beforeLanes).toEqual([
      { lane: 0, colorIndex: 0 },
      { lane: 1, colorIndex: 1 },
    ]);
    // Row 1 draws lane 1 as a through line plus its own straight continuation.
    expect(layout.rows[1]?.downEdges).toEqual([]);

    expect(layout.rows[2]?.lane).toBe(1);
    // feature-tip's first parent joins the lane still held open for base.
    expect(layout.rows[2]?.downEdges).toEqual([
      { fromLane: 1, toLane: 0, colorIndex: 0, kind: "join" },
    ]);

    expect(layout.rows[3]?.lane).toBe(0);
  });

  it("keeps the trunk on the left lane through a merge-back", () => {
    const layout = computeGitGraphLayout([
      { oid: "m7", parents: ["m6"] },
      { oid: "m6", parents: ["m5"] },
      { oid: "m5", parents: ["merge"] },
      { oid: "merge", parents: ["m4", "f1b"] },
      { oid: "f1b", parents: ["f1a"] },
      { oid: "f1a", parents: ["m3"] },
      { oid: "m4", parents: ["m3"] },
      { oid: "m3", parents: ["m2"] },
      { oid: "m2", parents: ["m1"] },
      { oid: "m1", parents: [] },
    ]);

    // The feature branch opens lane 1 at the merge and merges back into the
    // trunk: m4's first parent m3 is already expected on lane 1, so that
    // expectation is re-homed into lane 0 and lane 1 shifts away.
    expect(layout.rows[5]?.lane).toBe(1);
    expect(layout.rows[6]?.downEdges).toEqual([
      { fromLane: 1, toLane: 0, colorIndex: 1, kind: "shift" },
    ]);
    // Main continues on lane 0 for the rest of history instead of hopping
    // right onto the freed lane's position.
    expect(layout.rows.slice(6).map((row) => row.lane)).toEqual([0, 0, 0, 0]);
    expect(layout.rows[9]?.afterLanes).toEqual([]);
  });

  it("compacts a freed lane leftward and reuses its position", () => {
    const layout = computeGitGraphLayout([
      { oid: "a1", parents: ["a0"] },
      { oid: "b0", parents: ["b-1"] },
      { oid: "a0", parents: [] },
      { oid: "b-1", parents: [] },
    ]);

    // a0 is still expected on lane 0, so b0 opens lane 1.
    expect(layout.rows[0]?.lane).toBe(0);
    // b0 is a freshly opened tip: no line enters its node from above.
    expect(layout.rows[1]?.beforeLanes).toEqual([{ lane: 0, colorIndex: 0 }]);
    expect(layout.rows[1]?.lane).toBe(1);
    // When lane 0 ends, lane 1 shifts left with a visible transition rather
    // than leaving a ghost gap on the left.
    expect(layout.rows[2]?.downEdges).toEqual([
      { fromLane: 1, toLane: 0, colorIndex: 1, kind: "shift" },
    ]);
    expect(layout.rows[2]?.afterLanes).toEqual([{ lane: 0, colorIndex: 1 }]);
    expect(layout.rows[3]?.lane).toBe(0);
    expect(layout.laneCount).toBe(2);
  });

  it("gives a new branch a fresh color instead of a shifted lane's old one", () => {
    const layout = computeGitGraphLayout([
      { oid: "a1", parents: ["a0"] },
      { oid: "b1", parents: ["b0"] },
      { oid: "a0", parents: [] },
      { oid: "c1", parents: ["c0"] },
      { oid: "b0", parents: [] },
      { oid: "c0", parents: [] },
    ]);

    // c1 opens a new lane after the compaction; its color must not collide
    // with the neighboring branch's color.
    expect(layout.rows[3]?.lane).toBe(1);
    expect(layout.rows[3]?.colorIndex).toBe(2);
  });

  it("keeps dangling lanes visible for parents beyond the page", () => {
    const layout = computeGitGraphLayout([{ oid: "tip", parents: ["unloaded-parent"] }]);

    expect(layout.rows[0]?.lane).toBe(0);
    // The unloaded parent holds the lane open below the page.
    expect(layout.rows[0]?.downEdges).toEqual([]);
    expect(layout.rows[0]?.afterLanes).toEqual([{ lane: 0, colorIndex: 0 }]);
  });

  it("connects sibling branches that share a parent through a join", () => {
    const layout = computeGitGraphLayout([
      { oid: "a", parents: ["base"] },
      { oid: "b", parents: ["base"] },
      { oid: "base", parents: [] },
    ]);

    // a's first parent continues straight down lane 0; when b (a new tip on
    // lane 1) hits the shared parent, its line joins lane 0.
    expect(layout.rows[0]?.downEdges).toEqual([]);
    expect(layout.rows[1]?.downEdges).toEqual([
      { fromLane: 1, toLane: 0, colorIndex: 0, kind: "join" },
    ]);
    expect(layout.rows[2]?.lane).toBe(0);
  });

  it("handles an empty page", () => {
    expect(computeGitGraphLayout([])).toEqual({ rows: [], laneCount: 0 });
  });
});
