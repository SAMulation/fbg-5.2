/**
 * Kickoff. In v5.1 kickoffs have a "kick type" selection (onside vs
 * regular) which we're skipping for v6 — instead we treat a kickoff as
 * a simplified punt from the 35 with no block check and no muff check.
 *
 * The kicking team (state.field.offense) is whoever just scored or is
 * starting the half. Possession flips to the receiver as part of the
 * resolution.
 */

import type { Rng } from "../../rng.js";
import type { GameState } from "../../types.js";
import { resolvePunt } from "./punt.js";
import { type SpecialResolution } from "./shared.js";

export function resolveKickoff(state: GameState, rng: Rng): SpecialResolution {
  // Place ball at kicking team's 35 and punt from there. Use the safetyKick
  // flag to skip block/muff — a real kickoff can't be "blocked" in the same
  // way, and v5.1 uses punt() for safety kicks similarly.
  const kickingState: GameState = {
    ...state,
    field: { ...state.field, ballOn: 35 },
  };
  const result = resolvePunt(kickingState, rng, { safetyKick: true });
  // After resolution, we're in REG_PLAY.
  return {
    ...result,
    state: { ...result.state, phase: "REG_PLAY" },
  };
}
