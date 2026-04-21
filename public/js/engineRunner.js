/**
 * engineRunner — delegates v5.1's regular-play resolution to the engine.
 *
 * Scope: SR/LR/SP/LP vs SR/LR/SP/LP where the picks DON'T match. The
 * matching-pick path (Same Play mechanism), Trick Play, Hail Mary,
 * Field Goal, and Punt are still routed through v5.1 for now — see
 * docs/PHASE2.md for the collapse plan that takes care of them too.
 *
 * Single-player only. The engine is driven by a local Math.random-based
 * RNG; v5.1's game.mults / game.yards decks are kept coherent by applying
 * the engine's post-resolution deck state back onto the game.
 */

import { resolveRegularPlay } from './engine.js'
import { buildEngineState } from './engineBridge.js'

function makeLocalRng () {
  return {
    intBetween: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
    coinFlip: () => (Math.random() < 0.5 ? 'heads' : 'tails'),
    d6: () => Math.floor(Math.random() * 6) + 1
  }
}

function isRegular (p) {
  return p === 'SR' || p === 'LR' || p === 'SP' || p === 'LP'
}

export function canResolveRegularViaEngine (game, p1, p2) {
  // Only the clean case: both are regular, they differ, no special status
  // already set by a trick/hail/etc. resolver.
  return isRegular(p1) && isRegular(p2) && p1 !== p2 && game.status === 11
}

/**
 * Resolve a non-matching regular-play call. Returns an outcome the v5.1
 * doPlay/calcDist flow can consume directly, or null if the engine can't
 * handle this case (caller falls back to v5.1).
 */
export function resolveRegularViaEngine (game, p1, p2) {
  if (!canResolveRegularViaEngine(game, p1, p2)) return null

  const rng = makeLocalRng()
  const engineState = {
    ...buildEngineState(game),
    pendingPick: { offensePlay: p1, defensePlay: p2 }
  }
  const result = resolveRegularPlay(
    engineState,
    { offensePlay: p1, defensePlay: p2 },
    rng
  )

  // Apply deck state back — game.mults/yards stay in sync with the engine.
  game.mults = [...result.state.deck.multipliers]
  game.yards = [...result.state.deck.yards]

  const resolved = result.events.find(e => e.type === 'PLAY_RESOLVED')
  if (!resolved) return null

  return {
    multiplierCard: {
      card: resolved.multiplier.card,
      num: cardNumFromName(resolved.multiplier.card)
    },
    yardCard: resolved.yardsCard,
    multiplier: resolved.multiplier.value,
    quality: resolved.matchupQuality,
    dist: resolved.yardsGained
  }
}

function cardNumFromName (name) {
  switch (name) {
    case 'King': return 1
    case 'Queen': return 2
    case 'Jack': return 3
    case '10': return 4
    default: return 0
  }
}
