/**
 * Pure lane-layout for the git graph. The server returns commits in
 * `--topo-order` (newest first, parents after children); this turns that list
 * into per-row draw instructions.
 *
 * Every row renders strictly inside its own [0, rowHeight] band so adjacent
 * rows connect exactly at the band edge: a lane leaving this row as a vertical
 * at (lane, height) is the same x as the next row's entering vertical, and
 * curves terminate on the band bottom where the parent's row picks them up.
 */

export interface GitGraphLaneCommit {
  readonly oid: string;
  readonly parents: ReadonlyArray<string>;
}

export type GitGraphEdgeKind = "branch-out" | "join";

export interface GitGraphEdge {
  readonly fromLane: number;
  readonly toLane: number;
  readonly colorIndex: number;
  readonly kind: GitGraphEdgeKind;
}

export interface GitGraphLaneRef {
  readonly lane: number;
  readonly colorIndex: number;
}

export interface GitGraphRowLayout {
  readonly lane: number;
  readonly colorIndex: number;
  /** Lanes with an active line entering the top of this row. */
  readonly beforeLanes: ReadonlyArray<GitGraphLaneRef>;
  /** Lanes with an active line leaving the bottom of this row. */
  readonly afterLanes: ReadonlyArray<GitGraphLaneRef>;
  /**
   * Curved connections from this row's node to a different lane at the band
   * bottom ("branch-out") or into an existing lane ("join"). The first
   * parent's straight continuation is not an edge — it is the node lane's
   * membership in `afterLanes`.
   */
  readonly downEdges: ReadonlyArray<GitGraphEdge>;
}

export interface GitGraphLayout {
  readonly rows: ReadonlyArray<GitGraphRowLayout>;
  readonly laneCount: number;
}

export function computeGitGraphLayout(commits: ReadonlyArray<GitGraphLaneCommit>): GitGraphLayout {
  // laneTipOids[l] is the oid lane l expects to consume next, or null when
  // the lane is free for reuse.
  const laneTipOids: Array<string | null> = [];
  const laneColors: Array<number> = [];
  let nextColorIndex = 0;
  const rows: GitGraphRowLayout[] = [];

  const firstFreeLane = (): number => {
    const free = laneTipOids.indexOf(null);
    return free >= 0 ? free : laneTipOids.length;
  };
  const ensureLane = (lane: number): void => {
    if (lane === laneTipOids.length) {
      laneTipOids.push(null);
      laneColors.push(nextColorIndex);
      nextColorIndex += 1;
    }
  };
  const activeLanes = (): Array<GitGraphLaneRef> => {
    const lanes: Array<GitGraphLaneRef> = [];
    for (let l = 0; l < laneTipOids.length; l++) {
      if (laneTipOids[l] !== null) lanes.push({ lane: l, colorIndex: laneColors[l] ?? 0 });
    }
    return lanes;
  };

  for (const commit of commits) {
    let lane = laneTipOids.indexOf(commit.oid);
    if (lane < 0) {
      lane = firstFreeLane();
      ensureLane(lane);
    }
    const colorIndex = laneColors[lane] ?? 0;
    const beforeLanes = activeLanes();

    laneTipOids[lane] = null;
    const downEdges: GitGraphEdge[] = [];
    for (let p = 0; p < commit.parents.length; p++) {
      const parent = commit.parents[p];
      if (parent === undefined) continue;
      const existingLane = laneTipOids.indexOf(parent);
      if (existingLane >= 0 && existingLane !== lane) {
        downEdges.push({
          fromLane: lane,
          toLane: existingLane,
          colorIndex: laneColors[existingLane] ?? colorIndex,
          kind: "join",
        });
        continue;
      }
      if (p === 0) {
        laneTipOids[lane] = parent;
        continue;
      }
      const target = firstFreeLane();
      ensureLane(target);
      laneTipOids[target] = parent;
      downEdges.push({
        fromLane: lane,
        toLane: target,
        colorIndex: laneColors[target] ?? colorIndex,
        kind: "branch-out",
      });
    }

    rows.push({
      lane,
      colorIndex,
      beforeLanes,
      afterLanes: activeLanes(),
      downEdges,
    });
  }

  return { rows, laneCount: laneTipOids.length };
}
