/**
 * Pure lane-layout for the git graph. The server returns commits in
 * `--topo-order` (newest first, parents after children); this turns that list
 * into per-row draw instructions.
 *
 * Lanes are left-packed: live branches always occupy contiguous indexes from
 * 0, and when a branch line ends the lanes to its right shift left one step.
 * The longest-lived line (usually the trunk) therefore hugs lane 0, and new
 * branches always open to the right of everything still alive. A lane that
 * moves records a "shift" edge so its row can draw the transition.
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

export type GitGraphEdgeKind = "branch-out" | "join" | "shift";

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
   * Curved connections terminating on the band bottom. "branch-out" and
   * "join" start at this row's node; "shift" spans the full band, redrawning
   * a through line that moved left because a lane to its left ended. The
   * first parent's straight continuation is not an edge — it is the node
   * lane's membership in `afterLanes`.
   */
  readonly downEdges: ReadonlyArray<GitGraphEdge>;
}

export interface GitGraphLayout {
  readonly rows: ReadonlyArray<GitGraphRowLayout>;
  readonly laneCount: number;
}

export function computeGitGraphLayout(commits: ReadonlyArray<GitGraphLaneCommit>): GitGraphLayout {
  // Each lane carries the oid it expects to consume next plus the color of
  // the branch line occupying it. Colors rotate per branch, not per column,
  // so a reused position never masquerades as the branch that sat there
  // before. Lanes are always left-packed — a dead lane is removed and the
  // lanes right of it shift left.
  const lanes: Array<{ tip: string; colorIndex: number }> = [];
  let nextColorIndex = 0;
  const rows: GitGraphRowLayout[] = [];
  let peakLanes = 0;

  const laneRefs = (): GitGraphLaneRef[] =>
    lanes.map((entry, index) => ({ lane: index, colorIndex: entry.colorIndex }));

  // End the lane at `dead`; lanes right of it shift left, each recording a
  // full-band shift curve from its old position to its new one.
  const endLane = (dead: number, downEdges: GitGraphEdge[]): void => {
    lanes.splice(dead, 1);
    for (let k = dead; k < lanes.length; k++) {
      downEdges.push({
        fromLane: k + 1,
        toLane: k,
        colorIndex: lanes[k]!.colorIndex,
        kind: "shift",
      });
    }
  };

  for (const commit of commits) {
    // Snapshot before the claim below: a commit that opens a new lane must
    // not see its own lane as an entering line.
    const beforeLanes = laneRefs();
    let lane = lanes.findIndex((entry) => entry.tip === commit.oid);
    if (lane < 0) {
      // A tip the window has not seen: opens as the rightmost lane.
      lane = lanes.length;
      lanes.push({ tip: commit.oid, colorIndex: nextColorIndex++ });
    }
    const colorIndex = lanes[lane]!.colorIndex;
    const downEdges: GitGraphEdge[] = [];

    const [firstParent] = commit.parents;
    if (firstParent === undefined) {
      // Root commit: the line ends here.
      endLane(lane, downEdges);
    } else {
      const parentLane = lanes.findIndex((entry) => entry.tip === firstParent);
      if (parentLane < 0) {
        // Straight continuation: the lane keeps the line and its color.
        lanes[lane]!.tip = firstParent;
      } else if (parentLane < lane) {
        // This line merges into the leftward lane and ends.
        downEdges.push({
          fromLane: lane,
          toLane: parentLane,
          colorIndex: lanes[parentLane]!.colorIndex,
          kind: "join",
        });
        endLane(lane, downEdges);
      } else {
        // The parent is already expected on a rightward lane: that branch's
        // line merges into this one. Carry the expectation into this lane so
        // the trunk stays left, and let the rightward lane shift away.
        downEdges.push({
          fromLane: parentLane,
          toLane: lane,
          colorIndex: lanes[parentLane]!.colorIndex,
          kind: "shift",
        });
        lanes[lane]!.tip = firstParent;
        endLane(parentLane, downEdges);
      }
    }

    for (let p = 1; p < commit.parents.length; p++) {
      const parent = commit.parents[p]!;
      const existing = lanes.findIndex((entry) => entry.tip === parent);
      if (existing === lane) continue;
      if (existing >= 0) {
        downEdges.push({
          fromLane: lane,
          toLane: existing,
          colorIndex: lanes[existing]!.colorIndex,
          kind: "join",
        });
        continue;
      }
      lanes.push({ tip: parent, colorIndex: nextColorIndex++ });
      downEdges.push({
        fromLane: lane,
        toLane: lanes.length - 1,
        colorIndex: lanes[lanes.length - 1]!.colorIndex,
        kind: "branch-out",
      });
    }

    rows.push({
      lane,
      colorIndex,
      beforeLanes,
      afterLanes: laneRefs(),
      downEdges,
    });
    peakLanes = Math.max(peakLanes, beforeLanes.length, lanes.length);
  }

  return { rows, laneCount: peakLanes };
}
