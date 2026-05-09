// src/validate.ts
var KICK_TYPES = ["RK", "OK", "SK"];
var RETURN_TYPES = ["RR", "OR", "TB"];
var PLAY_PHASES = /* @__PURE__ */ new Set(["REG_PLAY", "OT_PLAY", "TWO_PT_CONV"]);
function validateAction(state, action) {
  switch (action.type) {
    case "START_GAME":
      if (state.phase !== "INIT") return "START_GAME only valid in INIT";
      if (typeof action.quarterLengthMinutes !== "number") return "bad qtrLen";
      if (action.quarterLengthMinutes < 1 || action.quarterLengthMinutes > 15) {
        return "qtrLen must be 1..15";
      }
      if (!action.teams || typeof action.teams[1] !== "string" || typeof action.teams[2] !== "string") {
        return "teams missing";
      }
      return null;
    case "COIN_TOSS_CALL":
      if (state.phase !== "COIN_TOSS") return "not in COIN_TOSS";
      if (!isPlayer(action.player)) return "bad player";
      if (action.call !== "heads" && action.call !== "tails") return "bad call";
      return null;
    case "RECEIVE_CHOICE":
      if (state.phase !== "COIN_TOSS") return "not in COIN_TOSS";
      if (!isPlayer(action.player)) return "bad player";
      if (action.choice !== "receive" && action.choice !== "defer") return "bad choice";
      return null;
    case "PICK_PLAY":
      if (!PLAY_PHASES.has(state.phase)) return "not in a play phase";
      if (!isPlayer(action.player)) return "bad player";
      if (!isPlayCall(action.play)) return "bad play";
      return null;
    case "CALL_TIMEOUT":
      if (!isPlayer(action.player)) return "bad player";
      if (state.players[action.player].timeouts <= 0) return "no timeouts remaining";
      return null;
    case "ACCEPT_PENALTY":
    case "DECLINE_PENALTY":
      if (state.phase !== "PENALTY_CHOICE") return "not in PENALTY_CHOICE";
      if (!isPlayer(action.player)) return "bad player";
      if (!state.pendingPenalty) return "no pending penalty";
      if (action.player !== state.pendingPenalty.beneficiary) return "wrong player for choice";
      return null;
    case "PAT_CHOICE":
      if (state.phase !== "PAT_CHOICE") return "not in PAT_CHOICE";
      if (!isPlayer(action.player)) return "bad player";
      if (action.choice !== "kick" && action.choice !== "two_point") return "bad choice";
      return null;
    case "FOURTH_DOWN_CHOICE":
      if (state.phase !== "REG_PLAY" && state.phase !== "OT_PLAY") return "wrong phase";
      if (state.field.down !== 4) return "not 4th down";
      if (!isPlayer(action.player)) return "bad player";
      if (action.choice !== "go" && action.choice !== "punt" && action.choice !== "fg") {
        return "bad choice";
      }
      if (action.choice === "punt" && state.phase === "OT_PLAY") return "no punts in OT";
      if (action.choice === "fg" && state.field.ballOn < 45) return "out of FG range";
      return null;
    case "FORFEIT":
      if (!isPlayer(action.player)) return "bad player";
      return null;
    case "RESOLVE_KICKOFF":
      if (state.phase !== "KICKOFF") return "not in KICKOFF";
      if (action.kickType !== void 0 && !KICK_TYPES.includes(action.kickType)) {
        return "bad kickType";
      }
      if (action.returnType !== void 0 && !RETURN_TYPES.includes(action.returnType)) {
        return "bad returnType";
      }
      return null;
    case "START_OT_POSSESSION":
      if (state.phase !== "OT_START") return "not in OT_START";
      return null;
    case "TICK_CLOCK":
      if (typeof action.seconds !== "number") return "bad seconds";
      if (action.seconds < 0 || action.seconds > 300) return "seconds out of range";
      return null;
    default: {
      const _exhaustive = action;
      return "unknown action type";
    }
  }
}
function isPlayer(p) {
  return p === 1 || p === 2;
}
function isPlayCall(p) {
  return p === "SR" || p === "LR" || p === "SP" || p === "LP" || p === "TP" || p === "HM" || p === "FG" || p === "PUNT" || p === "TWO_PT";
}

// src/state.ts
function emptyHand(isOvertime = false) {
  return {
    SR: 3,
    LR: 3,
    SP: 3,
    LP: 3,
    TP: 1,
    HM: isOvertime ? 2 : 3
  };
}
function emptyStats() {
  return { passYards: 0, rushYards: 0, turnovers: 0, sacks: 0 };
}
function freshDeckMultipliers() {
  return [4, 4, 4, 3];
}
function freshDeckYards() {
  return [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
}
function initialState(args) {
  return {
    phase: "INIT",
    schemaVersion: 1,
    clock: {
      quarter: 0,
      secondsRemaining: args.quarterLengthMinutes * 60,
      quarterLengthMinutes: args.quarterLengthMinutes
    },
    field: {
      ballOn: 35,
      firstDownAt: 45,
      down: 1,
      offense: 1
    },
    deck: {
      multipliers: freshDeckMultipliers(),
      yards: freshDeckYards()
    },
    players: {
      1: {
        team: args.team1,
        score: 0,
        timeouts: 3,
        hand: emptyHand(),
        stats: emptyStats()
      },
      2: {
        team: args.team2,
        score: 0,
        timeouts: 3,
        hand: emptyHand(),
        stats: emptyStats()
      }
    },
    openingReceiver: null,
    overtime: null,
    pendingPick: { offensePlay: null, defensePlay: null },
    pendingPenalty: null,
    lastPlayDescription: "Start of game",
    isSafetyKick: false
  };
}
function opp(p) {
  return p === 1 ? 2 : 1;
}

// src/rules/matchup.ts
var MATCHUP = [
  [5, 3, 3, 2],
  [2, 4, 1, 2],
  [3, 2, 5, 3],
  [1, 2, 2, 4]
];
var PLAY_INDEX = {
  SR: 0,
  LR: 1,
  SP: 2,
  LP: 3
};
var MULTI = [
  [4, 3, 2, 1.5, 1],
  [3, 2, 1, 1, 0.5],
  [2, 1, 0.5, 0, 0],
  [0, 0, 0, -1, -1]
];
function matchupQuality(off, def) {
  const row = MATCHUP[PLAY_INDEX[off]];
  if (!row) throw new Error(`unreachable: bad off play ${off}`);
  const q = row[PLAY_INDEX[def]];
  if (q === void 0) throw new Error(`unreachable: bad def play ${def}`);
  return q;
}

// src/rules/yardage.ts
var MULTIPLIER_CARD_NAMES = ["King", "Queen", "Jack", "10"];
function computeYardage(inputs) {
  const quality = matchupQuality(inputs.offense, inputs.defense);
  const multiRow = MULTI[inputs.multiplierCard];
  if (!multiRow) throw new Error(`unreachable: bad multi card ${inputs.multiplierCard}`);
  const multiplier = multiRow[quality - 1];
  if (multiplier === void 0) throw new Error(`unreachable: bad quality ${quality}`);
  const bonus = inputs.bonus ?? 0;
  const yardsGained = Math.round(multiplier * inputs.yardsCard) + bonus;
  return {
    matchupQuality: quality,
    multiplier,
    multiplierCardName: MULTIPLIER_CARD_NAMES[inputs.multiplierCard],
    yardsGained
  };
}

// src/rules/deck.ts
function drawMultiplier(deck, rng) {
  const mults = [...deck.multipliers];
  let index;
  for (; ; ) {
    const i = rng.intBetween(0, 3);
    if (mults[i] > 0) {
      index = i;
      break;
    }
  }
  mults[index]--;
  let reshuffled = false;
  let nextDeck = { ...deck, multipliers: mults };
  if (mults.every((c) => c === 0)) {
    reshuffled = true;
    nextDeck = { ...nextDeck, multipliers: freshDeckMultipliers() };
  }
  return {
    card: MULTIPLIER_CARD_NAMES[index],
    index,
    deck: nextDeck,
    reshuffled
  };
}
function drawYards(deck, rng) {
  const yards = [...deck.yards];
  let index;
  for (; ; ) {
    const i = rng.intBetween(0, yards.length - 1);
    const slot = yards[i];
    if (slot !== void 0 && slot > 0) {
      index = i;
      break;
    }
  }
  yards[index] = (yards[index] ?? 0) - 1;
  let reshuffled = false;
  let nextDeck = { ...deck, yards };
  if (yards.every((c) => c === 0)) {
    reshuffled = true;
    nextDeck = { ...nextDeck, yards: freshDeckYards() };
  }
  return {
    card: index + 1,
    deck: nextDeck,
    reshuffled
  };
}

// src/rules/specials/shared.ts
function blankPick() {
  return { offensePlay: null, defensePlay: null };
}
function bumpStats(players, playerId, deltas) {
  const cur = players[playerId].stats;
  return {
    ...players,
    [playerId]: {
      ...players[playerId],
      stats: {
        passYards: cur.passYards + (deltas.passYards ?? 0),
        rushYards: cur.rushYards + (deltas.rushYards ?? 0),
        turnovers: cur.turnovers + (deltas.turnovers ?? 0),
        sacks: cur.sacks + (deltas.sacks ?? 0)
      }
    }
  };
}
function applyTouchdown(state, scorer, events) {
  const newPlayers = {
    ...state.players,
    [scorer]: { ...state.players[scorer], score: state.players[scorer].score + 6 }
  };
  events.push({ type: "TOUCHDOWN", scoringPlayer: scorer });
  return {
    state: {
      ...state,
      players: newPlayers,
      pendingPick: blankPick(),
      phase: "PAT_CHOICE"
    },
    events
  };
}
function applySafety(state, conceder, events) {
  const scorer = opp(conceder);
  const newPlayers = {
    ...state.players,
    [scorer]: { ...state.players[scorer], score: state.players[scorer].score + 2 }
  };
  events.push({ type: "SAFETY", scoringPlayer: scorer });
  return {
    state: {
      ...state,
      players: newPlayers,
      pendingPick: blankPick(),
      phase: "KICKOFF",
      isSafetyKick: true
    },
    events
  };
}
function applyYardageOutcome(state, yards, events) {
  const offense = state.field.offense;
  const projected = state.field.ballOn + yards;
  if (projected >= 100) return applyTouchdown(state, offense, events);
  if (projected <= 0) return applySafety(state, offense, events);
  const reachedFirstDown = projected >= state.field.firstDownAt;
  let nextDown = state.field.down;
  let nextFirstDownAt = state.field.firstDownAt;
  let possessionFlipped = false;
  if (reachedFirstDown) {
    nextDown = 1;
    nextFirstDownAt = Math.min(100, projected + 10);
    events.push({ type: "FIRST_DOWN" });
  } else if (state.field.down === 4) {
    possessionFlipped = true;
    events.push({ type: "TURNOVER_ON_DOWNS" });
    events.push({ type: "TURNOVER", reason: "downs" });
  } else {
    nextDown = state.field.down + 1;
  }
  const mirroredBallOn = possessionFlipped ? 100 - projected : projected;
  const players = possessionFlipped ? bumpStats(state.players, offense, { turnovers: 1 }) : state.players;
  return {
    state: {
      ...state,
      players,
      pendingPick: blankPick(),
      field: {
        ballOn: mirroredBallOn,
        firstDownAt: possessionFlipped ? Math.min(100, mirroredBallOn + 10) : nextFirstDownAt,
        down: possessionFlipped ? 1 : nextDown,
        offense: possessionFlipped ? opp(offense) : offense
      }
    },
    events
  };
}

// src/rules/play.ts
var REGULAR = /* @__PURE__ */ new Set(["SR", "LR", "SP", "LP"]);
function isRegularPlay(p) {
  return REGULAR.has(p);
}
function resolveRegularPlay(state, input, rng) {
  if (!isRegularPlay(input.offensePlay) || !isRegularPlay(input.defensePlay)) {
    throw new Error("resolveRegularPlay called with a non-regular play");
  }
  const events = [];
  const multDraw = drawMultiplier(state.deck, rng);
  if (multDraw.reshuffled) {
    events.push({ type: "DECK_SHUFFLED", deck: "multiplier" });
  }
  const yardsDraw = drawYards(multDraw.deck, rng);
  if (yardsDraw.reshuffled) {
    events.push({ type: "DECK_SHUFFLED", deck: "yards" });
  }
  const outcome = computeYardage({
    offense: input.offensePlay,
    defense: input.defensePlay,
    multiplierCard: multDraw.index,
    yardsCard: yardsDraw.card
  });
  const offense = state.field.offense;
  let newPlayers = {
    ...state.players,
    [offense]: decrementHand(state.players[offense], input.offensePlay)
  };
  const isPass = input.offensePlay === "SP" || input.offensePlay === "LP";
  const statDelta = isPass ? {
    passYards: outcome.yardsGained,
    sacks: outcome.yardsGained < 0 ? 1 : 0
  } : { rushYards: outcome.yardsGained };
  newPlayers = bumpStats(newPlayers, offense, statDelta);
  const projected = state.field.ballOn + outcome.yardsGained;
  let newBallOn = projected;
  let scored = null;
  if (projected >= 100) {
    newBallOn = 100;
    scored = "td";
  } else if (projected <= 0) {
    newBallOn = 0;
    scored = "safety";
  }
  events.push({
    type: "PLAY_RESOLVED",
    offensePlay: input.offensePlay,
    defensePlay: input.defensePlay,
    matchupQuality: outcome.matchupQuality,
    multiplier: { card: outcome.multiplierCardName, value: outcome.multiplier },
    yardsCard: yardsDraw.card,
    yardsGained: outcome.yardsGained,
    newBallOn
  });
  if (scored === "td") {
    return touchdownState(
      { ...state, deck: yardsDraw.deck, players: newPlayers, pendingPick: blankPick2() },
      offense,
      events
    );
  }
  if (scored === "safety") {
    return safetyState(
      { ...state, deck: yardsDraw.deck, players: newPlayers, pendingPick: blankPick2() },
      offense,
      events
    );
  }
  const reachedFirstDown = newBallOn >= state.field.firstDownAt;
  let nextDown = state.field.down;
  let nextFirstDownAt = state.field.firstDownAt;
  let possessionFlipped = false;
  if (reachedFirstDown) {
    nextDown = 1;
    nextFirstDownAt = Math.min(100, newBallOn + 10);
    events.push({ type: "FIRST_DOWN" });
  } else if (state.field.down === 4) {
    nextDown = 1;
    possessionFlipped = true;
    events.push({ type: "TURNOVER_ON_DOWNS" });
    events.push({ type: "TURNOVER", reason: "downs" });
    newPlayers = bumpStats(newPlayers, offense, { turnovers: 1 });
  } else {
    nextDown = state.field.down + 1;
  }
  const nextOffense = possessionFlipped ? opp(offense) : offense;
  const nextBallOn = possessionFlipped ? 100 - newBallOn : newBallOn;
  const nextFirstDown = possessionFlipped ? Math.min(100, nextBallOn + 10) : nextFirstDownAt;
  return {
    state: {
      ...state,
      deck: yardsDraw.deck,
      players: newPlayers,
      pendingPick: blankPick2(),
      field: {
        ballOn: nextBallOn,
        firstDownAt: nextFirstDown,
        down: nextDown,
        offense: nextOffense
      }
    },
    events
  };
}
function blankPick2() {
  return { offensePlay: null, defensePlay: null };
}
function touchdownState(state, scorer, events) {
  const newPlayers = {
    ...state.players,
    [scorer]: { ...state.players[scorer], score: state.players[scorer].score + 6 }
  };
  events.push({ type: "TOUCHDOWN", scoringPlayer: scorer });
  return {
    state: { ...state, players: newPlayers, phase: "PAT_CHOICE" },
    events
  };
}
function safetyState(state, conceder, events) {
  const scorer = opp(conceder);
  const newPlayers = {
    ...state.players,
    [scorer]: { ...state.players[scorer], score: state.players[scorer].score + 2 }
  };
  events.push({ type: "SAFETY", scoringPlayer: scorer });
  return {
    state: { ...state, players: newPlayers, phase: "KICKOFF" },
    events
  };
}
function decrementHand(player, play) {
  const hand = { ...player.hand };
  if (play === "HM") {
    hand.HM = Math.max(0, hand.HM - 1);
    return { ...player, hand };
  }
  if (play === "FG" || play === "PUNT" || play === "TWO_PT") {
    return player;
  }
  hand[play] = Math.max(0, hand[play] - 1);
  const regularsExhausted = hand.SR === 0 && hand.LR === 0 && hand.SP === 0 && hand.LP === 0;
  if (regularsExhausted) {
    return {
      ...player,
      hand: { SR: 3, LR: 3, SP: 3, LP: 3, TP: 1, HM: hand.HM }
    };
  }
  return { ...player, hand };
}

// src/rules/specials/bigPlay.ts
function resolveBigPlay(state, beneficiary, rng) {
  const offense = state.field.offense;
  const die = rng.d6();
  const events = [{ type: "BIG_PLAY", beneficiary, subroll: die }];
  if (beneficiary === offense) {
    return offensiveBigPlay(state, offense, die, events);
  }
  return defensiveBigPlay(state, offense, die, events);
}
function offensiveBigPlay(state, offense, die, events) {
  if (die === 6) {
    return applyTouchdown(state, offense, events);
  }
  let gain;
  if (die <= 3) {
    gain = 25;
  } else {
    const halfToGoal = Math.round((100 - state.field.ballOn) / 2);
    gain = halfToGoal > 40 ? halfToGoal : 40;
  }
  const projected = state.field.ballOn + gain;
  if (projected >= 100) {
    return applyTouchdown(state, offense, events);
  }
  const reachedFirstDown = projected >= state.field.firstDownAt;
  const nextDown = reachedFirstDown ? 1 : state.field.down;
  const nextFirstDownAt = reachedFirstDown ? Math.min(100, projected + 10) : state.field.firstDownAt;
  if (reachedFirstDown) events.push({ type: "FIRST_DOWN" });
  return {
    state: {
      ...state,
      pendingPick: blankPick(),
      field: {
        ...state.field,
        ballOn: projected,
        down: nextDown,
        firstDownAt: nextFirstDownAt
      }
    },
    events
  };
}
function defensiveBigPlay(state, offense, die, events) {
  if (die <= 3) {
    const naivePenalty = -10;
    const halfToGoal2 = -Math.floor(state.field.ballOn / 2);
    const penaltyYards = state.field.ballOn - 10 < 1 ? halfToGoal2 : naivePenalty;
    events.push({ type: "PENALTY", against: offense, yards: penaltyYards, lossOfDown: false });
    return {
      state: {
        ...state,
        pendingPick: blankPick(),
        field: {
          ...state.field,
          ballOn: Math.max(0, state.field.ballOn + penaltyYards)
        }
      },
      events
    };
  }
  const defender = opp(offense);
  if (die === 6) {
    let newPlayers = {
      ...state.players,
      [defender]: { ...state.players[defender], score: state.players[defender].score + 6 }
    };
    newPlayers = bumpStats(newPlayers, offense, { turnovers: 1 });
    events.push({ type: "TURNOVER", reason: "fumble" });
    events.push({ type: "TOUCHDOWN", scoringPlayer: defender });
    return {
      state: {
        ...state,
        players: newPlayers,
        pendingPick: blankPick(),
        phase: "PAT_CHOICE",
        field: { ...state.field, offense: defender }
      },
      events
    };
  }
  const halfToGoal = Math.round((100 - state.field.ballOn) / 2);
  const returnYards = halfToGoal > 25 ? halfToGoal : 25;
  events.push({ type: "TURNOVER", reason: "fumble" });
  const playersAfterTurnover = bumpStats(state.players, offense, { turnovers: 1 });
  const newOffenseStart = 100 - state.field.ballOn;
  const finalBallOn = newOffenseStart + returnYards;
  if (finalBallOn >= 100) {
    const playersWithScore = {
      ...playersAfterTurnover,
      [defender]: { ...playersAfterTurnover[defender], score: playersAfterTurnover[defender].score + 6 }
    };
    events.push({ type: "TOUCHDOWN", scoringPlayer: defender });
    return {
      state: {
        ...state,
        players: playersWithScore,
        pendingPick: blankPick(),
        phase: "PAT_CHOICE",
        field: { ...state.field, offense: defender }
      },
      events
    };
  }
  if (finalBallOn <= 0) {
    return applySafety({ ...state, players: playersAfterTurnover }, offense, events);
  }
  return {
    state: {
      ...state,
      players: playersAfterTurnover,
      pendingPick: blankPick(),
      field: {
        ballOn: finalBallOn,
        firstDownAt: Math.min(100, finalBallOn + 10),
        down: 1,
        offense: defender
      }
    },
    events
  };
}

// src/rules/specials/punt.ts
var RETURN_MULTIPLIERS = {
  King: 7,
  Queen: 4,
  Jack: 1,
  "10": -0.5
};
function resolvePunt(state, rng, opts = {}) {
  const offense = state.field.offense;
  const defender = opp(offense);
  const events = [];
  let deck = state.deck;
  let blocked = false;
  if (!opts.safetyKick) {
    if (rng.d6() === 6 && rng.d6() === 6) {
      blocked = true;
    }
  }
  if (blocked) {
    const mirroredBallOn = 100 - state.field.ballOn;
    events.push({ type: "PUNT", player: offense, landingSpot: state.field.ballOn });
    events.push({ type: "TURNOVER", reason: "fumble" });
    return {
      state: {
        ...state,
        players: bumpStats(state.players, offense, { turnovers: 1 }),
        pendingPick: blankPick(),
        field: {
          ballOn: mirroredBallOn,
          firstDownAt: Math.min(100, mirroredBallOn + 10),
          down: 1,
          offense: defender
        }
      },
      events
    };
  }
  const coin = rng.coinFlip();
  const yardsDraw = drawYards(deck, rng);
  if (yardsDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "yards" });
  deck = yardsDraw.deck;
  const kickDist = 10 * yardsDraw.card / 2 + (coin === "heads" ? 20 : 0);
  const landingSpot = state.field.ballOn + kickDist;
  const touchback = landingSpot > 100;
  events.push({ type: "PUNT", player: offense, landingSpot });
  let muffed = false;
  if (!touchback && !opts.safetyKick) {
    if (rng.d6() === 6 && rng.d6() === 6) {
      muffed = true;
    }
  }
  if (muffed) {
    events.push({ type: "PUNT_MUFFED", recoveringPlayer: offense });
    return {
      state: {
        ...state,
        deck,
        pendingPick: blankPick(),
        field: {
          ballOn: Math.min(99, landingSpot),
          firstDownAt: Math.min(100, landingSpot + 10),
          down: 1,
          offense
          // kicker retains
        }
      },
      events
    };
  }
  if (touchback) {
    const stateAfterKick = { ...state, deck };
    return {
      state: {
        ...stateAfterKick,
        pendingPick: blankPick(),
        field: {
          ballOn: 20,
          firstDownAt: 30,
          down: 1,
          offense: defender
        }
      },
      events
    };
  }
  const multDraw = drawMultiplier(deck, rng);
  if (multDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "multiplier" });
  deck = multDraw.deck;
  const returnDraw = drawYards(deck, rng);
  if (returnDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "yards" });
  deck = returnDraw.deck;
  const mult = RETURN_MULTIPLIERS[multDraw.card];
  const returnYards = Math.round(mult * returnDraw.card);
  const receiverBallOn = 100 - landingSpot + returnYards;
  const stateAfterReturn = { ...state, deck };
  if (receiverBallOn >= 100) {
    const receiverBallClamped = 100;
    return applyTouchdown(
      { ...stateAfterReturn, field: { ...state.field, offense: defender } },
      defender,
      events
    );
  }
  if (receiverBallOn <= 0) {
    return applySafety(
      { ...stateAfterReturn, field: { ...state.field, offense: defender } },
      defender,
      events
    );
  }
  return {
    state: {
      ...stateAfterReturn,
      pendingPick: blankPick(),
      field: {
        ballOn: receiverBallOn,
        firstDownAt: Math.min(100, receiverBallOn + 10),
        down: 1,
        offense: defender
      }
    },
    events
  };
}

// src/rules/specials/kickoff.ts
var KICKOFF_MULTIPLIERS = {
  King: 10,
  Queen: 5,
  Jack: 1,
  "10": 0
};
function resolveKickoff(state, rng, opts = {}) {
  const kicker = state.field.offense;
  const receiver = opp(kicker);
  if (state.isSafetyKick || !opts.kickType) {
    const kickingState = {
      ...state,
      field: { ...state.field, ballOn: 35 }
    };
    const result = resolvePunt(kickingState, rng, { safetyKick: true });
    const preserve = result.state.phase === "PAT_CHOICE" || result.state.phase === "TWO_PT_CONV";
    const phase = preserve ? result.state.phase : "REG_PLAY";
    return {
      state: { ...result.state, phase, isSafetyKick: false },
      events: result.events
    };
  }
  const { kickType, returnType } = opts;
  const events = [];
  events.push({ type: "KICK_TYPE_CHOSEN", player: kicker, choice: kickType });
  if (returnType) {
    events.push({
      type: "RETURN_TYPE_CHOSEN",
      player: receiver,
      choice: returnType
    });
  }
  if (kickType === "RK") {
    return resolveRegularKick(state, rng, events, kicker, receiver, returnType);
  }
  if (kickType === "OK") {
    return resolveOnsideKick(state, rng, events, kicker, receiver, returnType);
  }
  return resolveSquibKick(state, rng, events, kicker, receiver, returnType);
}
function resolveRegularKick(state, rng, events, kicker, receiver, returnType) {
  if (returnType === "TB" || returnType === "OR") {
    events.push({ type: "TOUCHBACK", receivingPlayer: receiver });
    return {
      state: {
        ...state,
        phase: "REG_PLAY",
        isSafetyKick: false,
        pendingPick: blankPick(),
        field: {
          ballOn: 25,
          firstDownAt: 35,
          down: 1,
          offense: receiver
        }
      },
      events
    };
  }
  const kickRoll = rng.d6();
  const kickYards = 35 + 5 * (kickRoll - 1);
  const kickEndFromKicker = 35 + kickYards;
  const boundedEnd = Math.min(100, kickEndFromKicker);
  events.push({ type: "KICKOFF", receivingPlayer: receiver, ballOn: boundedEnd, kickRoll, kickYards });
  const receiverStart = 100 - boundedEnd;
  let deck = state.deck;
  const multDraw = drawMultiplier(deck, rng);
  if (multDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "multiplier" });
  deck = multDraw.deck;
  const yardsDraw = drawYards(deck, rng);
  if (yardsDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "yards" });
  deck = yardsDraw.deck;
  const mult = KICKOFF_MULTIPLIERS[multDraw.card];
  const retYards = mult * yardsDraw.card;
  if (retYards !== 0) {
    events.push({ type: "KICKOFF_RETURN", returnerPlayer: receiver, yards: retYards });
  }
  const finalBallOn = receiverStart + retYards;
  if (finalBallOn >= 100) {
    return applyTouchdown(
      { ...state, deck, field: { ...state.field, offense: receiver }, isSafetyKick: false },
      receiver,
      events
    );
  }
  if (finalBallOn <= 0) {
    return applySafety(
      { ...state, deck, field: { ...state.field, offense: receiver }, isSafetyKick: false },
      receiver,
      events
    );
  }
  return {
    state: {
      ...state,
      deck,
      phase: "REG_PLAY",
      isSafetyKick: false,
      pendingPick: blankPick(),
      field: {
        ballOn: finalBallOn,
        firstDownAt: Math.min(100, finalBallOn + 10),
        down: 1,
        offense: receiver
      }
    },
    events
  };
}
function resolveOnsideKick(state, rng, events, kicker, receiver, returnType) {
  const odds = returnType === "OR" ? 12 : 6;
  const tmp = rng.intBetween(1, odds);
  const recovered = tmp === 1;
  const kickYards = 10 + tmp;
  const kickEnd = 35 + kickYards;
  events.push({ type: "KICKOFF", receivingPlayer: receiver, ballOn: kickEnd, kickRoll: tmp, kickYards });
  events.push({
    type: "ONSIDE_KICK",
    recovered,
    recoveringPlayer: recovered ? kicker : receiver,
    roll: tmp,
    odds
  });
  const returnRoll = rng.d6() + tmp;
  if (recovered) {
    const kickerBallOn = Math.max(1, kickEnd - returnRoll);
    return {
      state: {
        ...state,
        phase: "REG_PLAY",
        isSafetyKick: false,
        pendingPick: blankPick(),
        field: {
          ballOn: kickerBallOn,
          firstDownAt: Math.min(100, kickerBallOn + 10),
          down: 1,
          offense: kicker
        }
      },
      events
    };
  }
  const receiverStart = 100 - kickEnd;
  const finalBallOn = receiverStart + returnRoll;
  if (returnRoll !== 0) {
    events.push({ type: "KICKOFF_RETURN", returnerPlayer: receiver, yards: returnRoll });
  }
  if (finalBallOn >= 100) {
    return applyTouchdown(
      { ...state, field: { ...state.field, offense: receiver }, isSafetyKick: false },
      receiver,
      events
    );
  }
  return {
    state: {
      ...state,
      phase: "REG_PLAY",
      isSafetyKick: false,
      pendingPick: blankPick(),
      field: {
        ballOn: finalBallOn,
        firstDownAt: Math.min(100, finalBallOn + 10),
        down: 1,
        offense: receiver
      }
    },
    events
  };
}
function resolveSquibKick(state, rng, events, kicker, receiver, returnType) {
  const kickRoll = rng.d6();
  const kickYards = 15 + 5 * kickRoll;
  const kickEnd = Math.min(100, 35 + kickYards);
  events.push({ type: "KICKOFF", receivingPlayer: receiver, ballOn: kickEnd, kickRoll, kickYards });
  const retYards = returnType === "RR" ? rng.d6() + rng.d6() : 0;
  if (retYards > 0) {
    events.push({ type: "KICKOFF_RETURN", returnerPlayer: receiver, yards: retYards });
  }
  const receiverStart = 100 - kickEnd;
  const finalBallOn = receiverStart + retYards;
  if (finalBallOn >= 100) {
    return applyTouchdown(
      { ...state, field: { ...state.field, offense: receiver }, isSafetyKick: false },
      receiver,
      events
    );
  }
  return {
    state: {
      ...state,
      phase: "REG_PLAY",
      isSafetyKick: false,
      pendingPick: blankPick(),
      field: {
        ballOn: finalBallOn,
        firstDownAt: Math.min(100, finalBallOn + 10),
        down: 1,
        offense: receiver
      }
    },
    events
  };
}

// src/rules/specials/hailMary.ts
function resolveHailMary(state, rng) {
  const offense = state.field.offense;
  const die = rng.d6();
  const events = [{ type: "HAIL_MARY_ROLL", outcome: die }];
  let updatedPlayers = {
    ...state.players,
    [offense]: {
      ...state.players[offense],
      hand: { ...state.players[offense].hand, HM: Math.max(0, state.players[offense].hand.HM - 1) }
    }
  };
  if (die === 5) {
    events.push({ type: "TURNOVER", reason: "interception" });
    updatedPlayers = bumpStats(updatedPlayers, offense, { turnovers: 1 });
    return {
      state: {
        ...state,
        players: updatedPlayers,
        pendingPick: blankPick(),
        field: {
          ...state.field,
          offense: opp(offense),
          ballOn: 100 - state.field.ballOn,
          firstDownAt: Math.min(100, 100 - state.field.ballOn + 10),
          down: 1
        }
      },
      events
    };
  }
  const yards = die === 1 ? -10 : die === 2 ? 20 : die === 3 ? 0 : die === 4 ? 40 : 0;
  updatedPlayers = bumpStats(updatedPlayers, offense, {
    passYards: die === 6 ? 100 - state.field.ballOn : yards,
    sacks: die === 1 ? 1 : 0
  });
  const stateWithHm = { ...state, players: updatedPlayers };
  if (die === 6) {
    return applyTouchdown(stateWithHm, offense, events);
  }
  const projected = stateWithHm.field.ballOn + yards;
  if (projected >= 100) return applyTouchdown(stateWithHm, offense, events);
  if (projected <= 0) return applySafety(stateWithHm, offense, events);
  events.push({
    type: "PLAY_RESOLVED",
    offensePlay: "HM",
    defensePlay: state.pendingPick.defensePlay ?? "SR",
    matchupQuality: 0,
    multiplier: { card: "10", value: 0 },
    yardsCard: 0,
    yardsGained: yards,
    newBallOn: projected
  });
  return applyYardageOutcome(stateWithHm, yards, events);
}

// src/rules/specials/samePlay.ts
function resolveSamePlay(state, rng) {
  const offense = state.field.offense;
  const events = [];
  const coin = rng.coinFlip();
  events.push({ type: "SAME_PLAY_COIN", outcome: coin });
  const multDraw = drawMultiplier(state.deck, rng);
  if (multDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "multiplier" });
  const stateAfterMult = { ...state, deck: multDraw.deck };
  const heads = coin === "heads";
  if (multDraw.card === "King") {
    const beneficiary = heads ? offense : opp(offense);
    const bp = resolveBigPlay(stateAfterMult, beneficiary, rng);
    return { state: bp.state, events: [...events, ...bp.events] };
  }
  if (multDraw.card === "10") {
    if (heads) {
      events.push({ type: "TURNOVER", reason: "interception" });
      return {
        state: {
          ...stateAfterMult,
          players: bumpStats(stateAfterMult.players, offense, { turnovers: 1 }),
          pendingPick: blankPick(),
          field: {
            ...stateAfterMult.field,
            offense: opp(offense),
            ballOn: 100 - stateAfterMult.field.ballOn,
            firstDownAt: Math.min(100, 100 - stateAfterMult.field.ballOn + 10),
            down: 1
          }
        },
        events
      };
    }
    events.push({
      type: "PLAY_RESOLVED",
      offensePlay: state.pendingPick.offensePlay ?? "SR",
      defensePlay: state.pendingPick.defensePlay ?? "SR",
      matchupQuality: 0,
      multiplier: { card: "10", value: 0 },
      yardsCard: 0,
      yardsGained: 0,
      newBallOn: stateAfterMult.field.ballOn
    });
    return applyYardageOutcome(stateAfterMult, 0, events);
  }
  let multiplier = 0;
  if (multDraw.card === "Queen") multiplier = heads ? 3 : 0;
  if (multDraw.card === "Jack") multiplier = heads ? 0 : -3;
  if (multiplier === 0) {
    events.push({
      type: "PLAY_RESOLVED",
      offensePlay: state.pendingPick.offensePlay ?? "SR",
      defensePlay: state.pendingPick.defensePlay ?? "SR",
      matchupQuality: 0,
      multiplier: { card: multDraw.card, value: 0 },
      yardsCard: 0,
      yardsGained: 0,
      newBallOn: stateAfterMult.field.ballOn
    });
    return applyYardageOutcome(stateAfterMult, 0, events);
  }
  const yardsDraw = drawYards(stateAfterMult.deck, rng);
  if (yardsDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "yards" });
  const yards = Math.round(multiplier * yardsDraw.card);
  events.push({
    type: "PLAY_RESOLVED",
    offensePlay: state.pendingPick.offensePlay ?? "SR",
    defensePlay: state.pendingPick.defensePlay ?? "SR",
    matchupQuality: 0,
    multiplier: { card: multDraw.card, value: multiplier },
    yardsCard: yardsDraw.card,
    yardsGained: yards,
    newBallOn: Math.max(0, Math.min(100, stateAfterMult.field.ballOn + yards))
  });
  return applyYardageOutcome(
    { ...stateAfterMult, deck: yardsDraw.deck },
    yards,
    events
  );
}

// src/rules/specials/trickPlay.ts
function resolveOffensiveTrickPlay(state, rng) {
  const offense = state.field.offense;
  const die = rng.d6();
  const events = [{ type: "TRICK_PLAY_ROLL", outcome: die }];
  if (die === 5) {
    const bp = resolveBigPlay(state, offense, rng);
    return { state: bp.state, events: [...events, ...bp.events] };
  }
  if (die === 2) {
    const rawGain = 15;
    const gain = state.field.ballOn + rawGain > 99 ? Math.trunc((100 - state.field.ballOn) / 2) : rawGain;
    const newBallOn = Math.min(100, state.field.ballOn + gain);
    events.push({ type: "PENALTY", against: opponent(offense), yards: gain, lossOfDown: false });
    const reachedFirstDown = newBallOn >= state.field.firstDownAt;
    const nextDown = reachedFirstDown ? 1 : state.field.down;
    const nextFirstDownAt = reachedFirstDown ? Math.min(100, newBallOn + 10) : state.field.firstDownAt;
    if (reachedFirstDown) events.push({ type: "FIRST_DOWN" });
    return {
      state: {
        ...state,
        pendingPick: blankPick(),
        field: {
          ...state.field,
          ballOn: newBallOn,
          down: nextDown,
          firstDownAt: nextFirstDownAt
        }
      },
      events
    };
  }
  if (die === 3 || die === 4) {
    const multiplier2 = die === 3 ? -3 : 4;
    const yardsDraw2 = drawYards(state.deck, rng);
    if (yardsDraw2.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "yards" });
    const yards2 = Math.round(multiplier2 * yardsDraw2.card);
    events.push({
      type: "PLAY_RESOLVED",
      offensePlay: "TP",
      defensePlay: state.pendingPick.defensePlay ?? "SR",
      matchupQuality: 0,
      multiplier: { card: "King", value: multiplier2 },
      yardsCard: yardsDraw2.card,
      yardsGained: yards2,
      newBallOn: Math.max(0, Math.min(100, state.field.ballOn + yards2))
    });
    return applyYardageOutcome(
      { ...state, deck: yardsDraw2.deck },
      yards2,
      events
    );
  }
  const forcedPlay = die === 1 ? "LP" : "LR";
  const bonus = 5;
  const defensePlay = state.pendingPick.defensePlay ?? "SR";
  const defPlay = isRegular(defensePlay) ? defensePlay : "SR";
  const quality = matchupQuality(forcedPlay, defPlay);
  const multDraw = drawMultiplier(state.deck, rng);
  if (multDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "multiplier" });
  const yardsDraw = drawYards(multDraw.deck, rng);
  if (yardsDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "yards" });
  const multRow = MULTI[multDraw.index];
  const multiplier = multRow?.[quality - 1] ?? 0;
  const yards = Math.round(multiplier * yardsDraw.card) + bonus;
  events.push({
    type: "PLAY_RESOLVED",
    offensePlay: forcedPlay,
    defensePlay: defPlay,
    matchupQuality: quality,
    multiplier: { card: multDraw.card, value: multiplier },
    yardsCard: yardsDraw.card,
    yardsGained: yards,
    newBallOn: Math.max(0, Math.min(100, state.field.ballOn + yards))
  });
  return applyYardageOutcome(
    { ...state, deck: yardsDraw.deck },
    yards,
    events
  );
}
function isRegular(p) {
  return p === "SR" || p === "LR" || p === "SP" || p === "LP";
}
function opponent(p) {
  return p === 1 ? 2 : 1;
}
function resolveDefensiveTrickPlay(state, rng) {
  const offense = state.field.offense;
  const defender = opponent(offense);
  const die = rng.d6();
  const events = [{ type: "TRICK_PLAY_ROLL", outcome: die }];
  if (die === 5) {
    const bp = resolveBigPlay(state, defender, rng);
    return { state: bp.state, events: [...events, ...bp.events] };
  }
  if (die === 2) {
    const rawLoss = -15;
    const loss = state.field.ballOn + rawLoss < 1 ? -Math.trunc(state.field.ballOn / 2) : rawLoss;
    events.push({ type: "PENALTY", against: offense, yards: loss, lossOfDown: false });
    return {
      state: {
        ...state,
        pendingPick: { offensePlay: null, defensePlay: null },
        field: {
          ...state.field,
          ballOn: Math.max(0, state.field.ballOn + loss)
        }
      },
      events
    };
  }
  if (die === 3 || die === 4) {
    const multiplier2 = die === 3 ? -3 : 4;
    const yardsDraw2 = drawYards(state.deck, rng);
    if (yardsDraw2.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "yards" });
    const yards2 = Math.round(multiplier2 * yardsDraw2.card);
    events.push({
      type: "PLAY_RESOLVED",
      offensePlay: state.pendingPick.offensePlay ?? "SR",
      defensePlay: "TP",
      matchupQuality: 0,
      multiplier: { card: "King", value: multiplier2 },
      yardsCard: yardsDraw2.card,
      yardsGained: yards2,
      newBallOn: Math.max(0, Math.min(100, state.field.ballOn + yards2))
    });
    return applyYardageOutcome(
      { ...state, deck: yardsDraw2.deck },
      yards2,
      events
    );
  }
  const forcedDefPlay = die === 1 ? "LP" : "LR";
  const bonus = -5;
  const offensePlay = state.pendingPick.offensePlay ?? "SR";
  const offPlay = isRegular(offensePlay) ? offensePlay : "SR";
  const quality = matchupQuality(offPlay, forcedDefPlay);
  const multDraw = drawMultiplier(state.deck, rng);
  if (multDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "multiplier" });
  const yardsDraw = drawYards(multDraw.deck, rng);
  if (yardsDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "yards" });
  const multRow = MULTI[multDraw.index];
  const multiplier = multRow?.[quality - 1] ?? 0;
  const yards = Math.round(multiplier * yardsDraw.card) + bonus;
  events.push({
    type: "PLAY_RESOLVED",
    offensePlay: offPlay,
    defensePlay: forcedDefPlay,
    matchupQuality: quality,
    multiplier: { card: multDraw.card, value: multiplier },
    yardsCard: yardsDraw.card,
    yardsGained: yards,
    newBallOn: Math.max(0, Math.min(100, state.field.ballOn + yards))
  });
  return applyYardageOutcome(
    { ...state, deck: yardsDraw.deck },
    yards,
    events
  );
}

// src/rules/specials/fieldGoal.ts
function resolveFieldGoal(state, rng, opts = {}) {
  const offense = state.field.offense;
  const distance = 100 - state.field.ballOn + 17;
  const rawDie = rng.d6();
  const die = opts.iced ? Math.min(6, rawDie + 1) : rawDie;
  const events = [];
  let make;
  if (distance > 65) {
    make = rng.intBetween(1, 1e3) === distance;
  } else if (distance >= 60) make = die >= 6;
  else if (distance >= 50) make = die >= 5;
  else if (distance >= 40) make = die >= 4;
  else if (distance >= 30) make = die >= 3;
  else if (distance >= 20) make = die >= 2;
  else make = true;
  if (make) {
    events.push({ type: "FIELD_GOAL_GOOD", player: offense, roll: die, distance });
    const newPlayers = {
      ...state.players,
      [offense]: { ...state.players[offense], score: state.players[offense].score + 3 }
    };
    return {
      state: {
        ...state,
        players: newPlayers,
        pendingPick: blankPick(),
        phase: "KICKOFF"
      },
      events
    };
  }
  events.push({ type: "FIELD_GOAL_MISSED", player: offense, roll: die, distance });
  events.push({ type: "TURNOVER", reason: "missed_fg" });
  const defender = opp(offense);
  const kickSpotInDefenderPov = 100 - state.field.ballOn + 7;
  const newBallOn = kickSpotInDefenderPov <= 20 ? 20 : kickSpotInDefenderPov;
  return {
    state: {
      ...state,
      pendingPick: blankPick(),
      field: {
        ballOn: newBallOn,
        firstDownAt: Math.min(100, newBallOn + 10),
        down: 1,
        offense: defender
      }
    },
    events
  };
}

// src/rules/specials/twoPoint.ts
function resolveTwoPointConversion(state, offensePlay, defensePlay, rng) {
  const offense = state.field.offense;
  const events = [];
  const multDraw = drawMultiplier(state.deck, rng);
  if (multDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "multiplier" });
  const yardsDraw = drawYards(multDraw.deck, rng);
  if (yardsDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "yards" });
  const outcome = computeYardage({
    offense: offensePlay,
    defense: defensePlay,
    multiplierCard: multDraw.index,
    yardsCard: yardsDraw.card
  });
  const startBallOn = 97;
  const projected = startBallOn + outcome.yardsGained;
  const good = projected >= 100;
  events.push({
    type: "PLAY_RESOLVED",
    offensePlay,
    defensePlay,
    matchupQuality: outcome.matchupQuality,
    multiplier: { card: outcome.multiplierCardName, value: outcome.multiplier },
    yardsCard: yardsDraw.card,
    yardsGained: outcome.yardsGained,
    newBallOn: Math.max(0, Math.min(100, projected))
  });
  const newPlayers = good ? {
    ...state.players,
    [offense]: { ...state.players[offense], score: state.players[offense].score + 2 }
  } : state.players;
  events.push({
    type: good ? "TWO_POINT_GOOD" : "TWO_POINT_FAILED",
    player: offense
  });
  return {
    state: {
      ...state,
      deck: yardsDraw.deck,
      players: newPlayers,
      pendingPick: blankPick(),
      phase: "KICKOFF"
    },
    events
  };
}

// src/rules/overtime.ts
var OT_BALL_ON = 75;
function startOvertime(state) {
  const events = [];
  const firstReceiver = state.openingReceiver === 1 ? 2 : 1;
  const overtime = {
    period: 1,
    possession: firstReceiver,
    firstReceiver,
    possessionsRemaining: 2
  };
  events.push({ type: "OVERTIME_STARTED", period: 1, possession: firstReceiver });
  return {
    state: {
      ...state,
      phase: "OT_START",
      overtime
    },
    events
  };
}
function startOvertimePossession(state) {
  if (!state.overtime) return { state, events: [] };
  const possession = state.overtime.possession;
  const events = [];
  const newPlayers = {
    ...state.players,
    [possession]: {
      ...state.players[possession],
      hand: { ...state.players[possession].hand, HM: state.overtime.period >= 3 ? 2 : 2 }
    }
  };
  return {
    state: {
      ...state,
      players: newPlayers,
      phase: "OT_PLAY",
      field: {
        ballOn: OT_BALL_ON,
        firstDownAt: Math.min(100, OT_BALL_ON + 10),
        down: 1,
        offense: possession
      }
    },
    events
  };
}
function endOvertimePossession(state) {
  if (!state.overtime) return { state, events: [] };
  const events = [];
  const remaining = state.overtime.possessionsRemaining;
  if (remaining === 2) {
    const nextPossession = opp(state.overtime.possession);
    const newPlayers = {
      ...state.players,
      [nextPossession]: {
        ...state.players[nextPossession],
        hand: { ...state.players[nextPossession].hand, HM: 2 }
      }
    };
    return {
      state: {
        ...state,
        players: newPlayers,
        phase: "OT_PLAY",
        overtime: { ...state.overtime, possession: nextPossession, possessionsRemaining: 1 },
        field: {
          ballOn: OT_BALL_ON,
          firstDownAt: Math.min(100, OT_BALL_ON + 10),
          down: 1,
          offense: nextPossession
        }
      },
      events
    };
  }
  const p1 = state.players[1].score;
  const p2 = state.players[2].score;
  if (p1 !== p2) {
    const winner = p1 > p2 ? 1 : 2;
    events.push({ type: "GAME_OVER", winner });
    return {
      state: {
        ...state,
        phase: "GAME_OVER",
        overtime: { ...state.overtime, possessionsRemaining: 0 }
      },
      events
    };
  }
  const nextPeriod = state.overtime.period + 1;
  const nextFirst = opp(state.overtime.firstReceiver);
  events.push({ type: "OVERTIME_STARTED", period: nextPeriod, possession: nextFirst });
  return {
    state: {
      ...state,
      phase: "OT_START",
      overtime: {
        period: nextPeriod,
        possession: nextFirst,
        firstReceiver: nextFirst,
        possessionsRemaining: 2
      },
      // Fresh decks for the new period.
      deck: { multipliers: freshDeckMultipliers(), yards: freshDeckYards() },
      players: {
        ...state.players,
        1: { ...state.players[1], hand: emptyHand(true) },
        2: { ...state.players[2], hand: emptyHand(true) }
      }
    },
    events
  };
}
function isPossessionEndingInOT(events) {
  for (const e of events) {
    switch (e.type) {
      case "PAT_GOOD":
      case "TWO_POINT_GOOD":
      case "TWO_POINT_FAILED":
      case "FIELD_GOAL_GOOD":
      case "FIELD_GOAL_MISSED":
      case "TURNOVER":
      case "TURNOVER_ON_DOWNS":
      case "SAFETY":
        return true;
    }
  }
  return false;
}

// src/reducer.ts
function reduce(state, action, rng) {
  if (validateAction(state, action) !== null) {
    return { state, events: [] };
  }
  const result = reduceCore(state, action, rng);
  return applyOvertimeRouting(state, result);
}
function applyOvertimeRouting(prevState, result) {
  if (!prevState.overtime && !result.state.overtime) return result;
  if (!result.state.overtime) return result;
  if (!isPossessionEndingInOT(result.events)) return result;
  const ended = endOvertimePossession(result.state);
  return {
    state: ended.state,
    events: [...result.events, ...ended.events]
  };
}
function reduceCore(state, action, rng) {
  switch (action.type) {
    case "START_GAME":
      return {
        state: {
          ...state,
          phase: "COIN_TOSS",
          clock: {
            ...state.clock,
            quarter: 1,
            quarterLengthMinutes: action.quarterLengthMinutes,
            secondsRemaining: action.quarterLengthMinutes * 60
          },
          players: {
            ...state.players,
            1: { ...state.players[1], team: { id: action.teams[1] } },
            2: { ...state.players[2], team: { id: action.teams[2] } }
          }
        },
        events: [{ type: "GAME_STARTED" }]
      };
    case "COIN_TOSS_CALL": {
      const actual = rng.coinFlip();
      const winner = action.call === actual ? action.player : opp(action.player);
      return {
        state,
        events: [{ type: "COIN_TOSS_RESULT", result: actual, winner }]
      };
    }
    case "RECEIVE_CHOICE": {
      const receiver = action.choice === "receive" ? action.player : opp(action.player);
      const kicker = opp(receiver);
      return {
        state: {
          ...state,
          phase: "KICKOFF",
          openingReceiver: receiver,
          field: { ...state.field, offense: kicker }
        },
        events: [{ type: "KICKOFF", receivingPlayer: receiver, ballOn: 35 }]
      };
    }
    case "RESOLVE_KICKOFF": {
      const opts = {};
      if (action.kickType) opts.kickType = action.kickType;
      if (action.returnType) opts.returnType = action.returnType;
      const result = resolveKickoff(state, rng, opts);
      return { state: result.state, events: result.events };
    }
    case "START_OT_POSSESSION": {
      const r = startOvertimePossession(state);
      return { state: r.state, events: r.events };
    }
    case "PICK_PLAY": {
      const offense = state.field.offense;
      const isOffensiveCall = action.player === offense;
      if (action.play === "FG" || action.play === "PUNT" || action.play === "TWO_PT") {
        return { state, events: [] };
      }
      if (action.play === "HM" && !isOffensiveCall) {
        return { state, events: [] };
      }
      const hand = state.players[action.player].hand;
      if (action.play === "HM" && hand.HM <= 0) {
        return { state, events: [] };
      }
      if ((action.play === "SR" || action.play === "LR" || action.play === "SP" || action.play === "LP" || action.play === "TP") && hand[action.play] <= 0) {
        return { state, events: [] };
      }
      if (isOffensiveCall && state.pendingPick.offensePlay) {
        return { state, events: [] };
      }
      if (!isOffensiveCall && state.pendingPick.defensePlay) {
        return { state, events: [] };
      }
      const events = [
        { type: "PLAY_CALLED", player: action.player, play: action.play }
      ];
      const pendingPick = {
        offensePlay: isOffensiveCall ? action.play : state.pendingPick.offensePlay,
        defensePlay: isOffensiveCall ? state.pendingPick.defensePlay : action.play
      };
      if (pendingPick.offensePlay && pendingPick.defensePlay) {
        if (state.phase === "TWO_PT_CONV") {
          const offPlay = isRegularPlay(pendingPick.offensePlay) ? pendingPick.offensePlay : "SR";
          const defPlay = isRegularPlay(pendingPick.defensePlay) ? pendingPick.defensePlay : "SR";
          const stateWithPick2 = {
            ...state,
            pendingPick: { offensePlay: offPlay, defensePlay: defPlay }
          };
          const tp = resolveTwoPointConversion(
            stateWithPick2,
            offPlay,
            defPlay,
            rng
          );
          return { state: tp.state, events: [...events, ...tp.events] };
        }
        const stateWithPick = { ...state, pendingPick };
        if (pendingPick.offensePlay === "HM") {
          const hm = resolveHailMary(stateWithPick, rng);
          return { state: hm.state, events: [...events, ...hm.events] };
        }
        if (pendingPick.offensePlay === "TP" && pendingPick.defensePlay !== "TP") {
          const tp = resolveOffensiveTrickPlay(stateWithPick, rng);
          return { state: tp.state, events: [...events, ...tp.events] };
        }
        if (pendingPick.defensePlay === "TP" && pendingPick.offensePlay !== "TP") {
          const tp = resolveDefensiveTrickPlay(stateWithPick, rng);
          return { state: tp.state, events: [...events, ...tp.events] };
        }
        if (pendingPick.offensePlay === "TP" && pendingPick.defensePlay === "TP") {
          const sp = resolveSamePlay(stateWithPick, rng);
          return { state: sp.state, events: [...events, ...sp.events] };
        }
        if (isRegularPlay(pendingPick.offensePlay) && isRegularPlay(pendingPick.defensePlay)) {
          if (pendingPick.offensePlay === pendingPick.defensePlay) {
            const trigger = rng.coinFlip();
            if (trigger === "heads") {
              const sp = resolveSamePlay(stateWithPick, rng);
              return { state: sp.state, events: [...events, ...sp.events] };
            }
          }
          const resolved = resolveRegularPlay(
            stateWithPick,
            {
              offensePlay: pendingPick.offensePlay,
              defensePlay: pendingPick.defensePlay
            },
            rng
          );
          return { state: resolved.state, events: [...events, ...resolved.events] };
        }
        return { state: stateWithPick, events };
      }
      return { state: { ...state, pendingPick }, events };
    }
    case "CALL_TIMEOUT": {
      const p = state.players[action.player];
      if (p.timeouts <= 0) return { state, events: [] };
      const remaining = p.timeouts - 1;
      return {
        state: {
          ...state,
          players: {
            ...state.players,
            [action.player]: { ...p, timeouts: remaining }
          }
        },
        events: [{ type: "TIMEOUT_CALLED", player: action.player, remaining }]
      };
    }
    case "ACCEPT_PENALTY": {
      const pp = state.pendingPenalty;
      if (!pp) return { state, events: [] };
      const offense = state.field.offense;
      const isOffenseBeneficiary = pp.beneficiary === offense;
      const preBallOn = pp.preState.ballOn;
      const rawYards = pp.yards;
      const yards = isOffenseBeneficiary ? preBallOn + rawYards > 99 ? Math.trunc((100 - preBallOn) / 2) : rawYards : preBallOn - rawYards < 1 ? Math.trunc(preBallOn / 2) : rawYards;
      const newBallOn = isOffenseBeneficiary ? Math.min(100, preBallOn + yards) : Math.max(0, preBallOn - yards);
      let nextDown = pp.preState.down;
      let nextFirstDownAt = pp.preState.firstDownAt;
      const events = [];
      if (isOffenseBeneficiary) {
        const reachedFirstDown = newBallOn >= pp.preState.firstDownAt;
        if (reachedFirstDown) {
          nextDown = 1;
          nextFirstDownAt = Math.min(100, newBallOn + 10);
          events.push({ type: "FIRST_DOWN" });
        }
      }
      if (pp.lossOfDown) {
        if (nextDown >= 4) {
          nextDown = 4;
        } else {
          nextDown = nextDown + 1;
        }
      }
      const nextPhase = state.overtime ? "OT_PLAY" : "REG_PLAY";
      return {
        state: {
          ...state,
          phase: nextPhase,
          pendingPenalty: null,
          field: {
            ...state.field,
            ballOn: newBallOn,
            down: nextDown,
            firstDownAt: nextFirstDownAt
          }
        },
        events
      };
    }
    case "DECLINE_PENALTY": {
      if (!state.pendingPenalty) return { state, events: [] };
      const nextPhase = state.overtime ? "OT_PLAY" : "REG_PLAY";
      return {
        state: {
          ...state,
          phase: nextPhase,
          pendingPenalty: null
        },
        events: []
      };
    }
    case "PAT_CHOICE": {
      const scorer = state.field.offense;
      const effectiveChoice = state.overtime && state.overtime.period >= 3 ? "two_point" : action.choice;
      if (effectiveChoice === "kick") {
        const newPlayers = {
          ...state.players,
          [scorer]: { ...state.players[scorer], score: state.players[scorer].score + 1 }
        };
        return {
          state: {
            ...state,
            players: newPlayers,
            phase: "KICKOFF"
          },
          events: [{ type: "PAT_GOOD", player: scorer }]
        };
      }
      return {
        state: {
          ...state,
          phase: "TWO_PT_CONV",
          field: { ...state.field, ballOn: 97, firstDownAt: 100, down: 1 }
        },
        events: []
      };
    }
    case "FOURTH_DOWN_CHOICE": {
      if (action.choice === "go") {
        return { state, events: [] };
      }
      if (action.choice === "punt") {
        const result2 = resolvePunt(state, rng);
        return { state: result2.state, events: result2.events };
      }
      const result = resolveFieldGoal(state, rng);
      return { state: result.state, events: result.events };
    }
    case "FORFEIT": {
      const winner = opp(action.player);
      return {
        state: { ...state, phase: "GAME_OVER" },
        events: [{ type: "GAME_OVER", winner }]
      };
    }
    case "TICK_CLOCK": {
      const prev = state.clock.secondsRemaining;
      const next = Math.max(0, prev - action.seconds);
      const events = [{ type: "CLOCK_TICKED", seconds: action.seconds }];
      if ((state.clock.quarter === 2 || state.clock.quarter === 4) && prev > 120 && next <= 120) {
        events.push({ type: "TWO_MINUTE_WARNING" });
      }
      if (prev > 0 && next === 0) {
        events.push({ type: "LAST_CHANCE_TO_OFFERED", quarter: state.clock.quarter });
        return {
          state: { ...state, clock: { ...state.clock, secondsRemaining: 0 } },
          events
        };
      }
      if (prev === 0 && action.seconds > 0) {
        events.push({ type: "QUARTER_ENDED", quarter: state.clock.quarter });
        if (state.clock.quarter === 1 || state.clock.quarter === 3) {
          return {
            state: {
              ...state,
              clock: {
                ...state.clock,
                quarter: state.clock.quarter + 1,
                secondsRemaining: state.clock.quarterLengthMinutes * 60
              }
            },
            events
          };
        }
        if (state.clock.quarter === 2) {
          events.push({ type: "HALF_ENDED" });
          const secondHalfReceiver = state.openingReceiver === null ? 1 : opp(state.openingReceiver);
          return {
            state: {
              ...state,
              phase: "KICKOFF",
              clock: {
                ...state.clock,
                quarter: 3,
                secondsRemaining: state.clock.quarterLengthMinutes * 60
              },
              field: { ...state.field, offense: opp(secondHalfReceiver) },
              // Refresh timeouts for new half.
              players: {
                ...state.players,
                1: { ...state.players[1], timeouts: 3 },
                2: { ...state.players[2], timeouts: 3 }
              }
            },
            events
          };
        }
        const p1 = state.players[1].score;
        const p2 = state.players[2].score;
        if (p1 !== p2) {
          const winner = p1 > p2 ? 1 : 2;
          events.push({ type: "GAME_OVER", winner });
          return { state: { ...state, phase: "GAME_OVER" }, events };
        }
        const otClock = { ...state.clock, quarter: 5, secondsRemaining: 0 };
        const ot = startOvertime({ ...state, clock: otClock });
        events.push(...ot.events);
        return { state: ot.state, events };
      }
      return {
        state: { ...state, clock: { ...state.clock, secondsRemaining: next } },
        events
      };
    }
    default: {
      const _exhaustive = action;
      return { state, events: [] };
    }
  }
}
function reduceMany(state, actions, rng) {
  let current = state;
  const events = [];
  for (const action of actions) {
    const result = reduce(current, action, rng);
    current = result.state;
    events.push(...result.events);
  }
  return { state: current, events };
}

// src/rng.ts
function seededRng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = state + 1831565813 >>> 0;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  return {
    intBetween(min, max) {
      return Math.floor(next() * (max - min + 1)) + min;
    },
    coinFlip() {
      return next() < 0.5 ? "heads" : "tails";
    },
    d6() {
      return Math.floor(next() * 6) + 1;
    }
  };
}

// src/rules/specials/outcomes.ts
function samePlayOutcome(card, coin) {
  const heads = coin === "heads";
  if (card === "King") return { kind: "big_play", beneficiary: heads ? "offense" : "defense" };
  if (card === "10") return heads ? { kind: "interception" } : { kind: "no_gain" };
  if (card === "Queen") {
    return heads ? { kind: "multiplier", value: 3, drawYards: true } : { kind: "multiplier", value: 0, drawYards: false };
  }
  return heads ? { kind: "multiplier", value: 0, drawYards: false } : { kind: "multiplier", value: -3, drawYards: true };
}
function trickPlayOutcome(caller, offense, die) {
  const callerIsOffense = caller === offense;
  if (die === 5) return { kind: "big_play", beneficiary: caller };
  if (die === 2) {
    const rawYards = callerIsOffense ? 15 : -15;
    return { kind: "penalty", rawYards };
  }
  if (die === 3) return { kind: "multiplier", value: -3 };
  if (die === 4) return { kind: "multiplier", value: 4 };
  const play = die === 1 ? "LP" : "LR";
  const bonus = callerIsOffense ? 5 : -5;
  return { kind: "overlay", play, bonus };
}
function puntReturnMultiplier(card) {
  switch (card) {
    case "King":
      return 7;
    case "Queen":
      return 4;
    case "Jack":
      return 1;
    case "10":
      return -0.5;
  }
}
function puntKickDistance(yardsCard, coin) {
  return 10 * yardsCard / 2 + (coin === "heads" ? 20 : 0);
}
function bigPlayOutcome(beneficiary, offense, die, ballOn) {
  const benefitsOffense = beneficiary === offense;
  if (benefitsOffense) {
    if (die === 6) return { kind: "offense_td" };
    if (die <= 3) return { kind: "offense_gain", yards: 25 };
    const halfToGoal2 = Math.round((100 - ballOn) / 2);
    return { kind: "offense_gain", yards: halfToGoal2 > 40 ? halfToGoal2 : 40 };
  }
  if (die <= 3) {
    const rawYards = ballOn - 10 < 1 ? -Math.floor(ballOn / 2) : -10;
    return { kind: "defense_penalty", rawYards };
  }
  if (die === 6) return { kind: "defense_fumble_td" };
  const halfToGoal = Math.round((100 - ballOn) / 2);
  return { kind: "defense_fumble_return", yards: halfToGoal > 25 ? halfToGoal : 25 };
}
export {
  MATCHUP,
  MULTI,
  bigPlayOutcome,
  computeYardage,
  drawMultiplier,
  drawYards,
  emptyHand,
  emptyStats,
  endOvertimePossession,
  freshDeckMultipliers,
  freshDeckYards,
  initialState,
  matchupQuality,
  opp,
  puntKickDistance,
  puntReturnMultiplier,
  reduce,
  reduceMany,
  resolveBigPlay,
  resolveDefensiveTrickPlay,
  resolveFieldGoal,
  resolveHailMary,
  resolveKickoff,
  resolveOffensiveTrickPlay,
  resolvePunt,
  resolveRegularPlay,
  resolveSamePlay,
  resolveTwoPointConversion,
  samePlayOutcome,
  seededRng,
  startOvertime,
  startOvertimePossession,
  trickPlayOutcome
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy92YWxpZGF0ZS50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3N0YXRlLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvbWF0Y2h1cC50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3lhcmRhZ2UudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9kZWNrLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvc2hhcmVkLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvcGxheS50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL2JpZ1BsYXkudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9wdW50LnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMva2lja29mZi50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL2hhaWxNYXJ5LnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvc2FtZVBsYXkudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy90cmlja1BsYXkudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9maWVsZEdvYWwudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy90d29Qb2ludC50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL292ZXJ0aW1lLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcmVkdWNlci50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3JuZy50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL291dGNvbWVzLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvKipcbiAqIEFjdGlvbiB2YWxpZGF0aW9uIGxheWVyLiBSdW5zICpiZWZvcmUqIGByZWR1Y2VgIHRvdWNoZXMgc3RhdGUuXG4gKlxuICogVGhlIGVuZ2luZSBwcmV2aW91c2x5IHJlbGllZCBvbiB0aGUgcmVkdWNlcidzIHBlci1jYXNlIHNoYXBlIGNoZWNrcyBhbmRcbiAqIHNpbGVudGx5IGlnbm9yZWQgYW55dGhpbmcgaXQgY291bGRuJ3QgcmVjb2duaXplLiBUaGF0IHdhcyBmaW5lIGZvciBhXG4gKiB0cnVzdGVkIHNpbmdsZS10YWIgZ2FtZSBidXQgdW5zYWZlIGFzIHNvb24gYXMgdGhlIER1cmFibGUgT2JqZWN0XG4gKiBhY2NlcHRzIGFjdGlvbnMgZnJvbSB1bmF1dGhlbnRpY2F0ZWQgV2ViU29ja2V0IGNsaWVudHMgXHUyMDE0IGEgaG9zdGlsZSAob3JcbiAqIGp1c3QgYnVnZ3kpIGNsaWVudCBjb3VsZCBzZW5kIGB7IHR5cGU6ICdSRVNPTFZFX0tJQ0tPRkYnLCBraWNrVHlwZTogJ0ZHJyB9YFxuICogYW5kIGNvcnJ1cHQgc3RhdGUuXG4gKlxuICogYHZhbGlkYXRlQWN0aW9uYCByZXR1cm5zIG51bGwgd2hlbiB0aGUgYWN0aW9uIGlzIGxlZ2FsIGZvciB0aGUgY3VycmVudFxuICogc3RhdGUsIG9yIGEgc3RyaW5nIGV4cGxhaW5pbmcgdGhlIHJlamVjdGlvbi4gSW52YWxpZCBhY3Rpb25zIHNob3VsZCBiZVxuICogbm8tb3BlZCBieSB0aGUgY2FsbGVyIChyZWR1Y2VyIG9yIHNlcnZlciksIG5vdCB0aHJvd24gb24gXHUyMDE0IHRoYXQgbWF0Y2hlc1xuICogdGhlIHJlc3Qgb2YgdGhlIGVuZ2luZSdzIFwiaWxsZWdhbCBwaWNrcyBhcmUgc2lsZW50bHkgZHJvcHBlZFwiIGNvbnRyYWN0XG4gKiBhbmQgYXZvaWRzIGNyYXNoaW5nIG9uIGFuIHVudHJ1c3RlZCBjbGllbnQuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBBY3Rpb24gfSBmcm9tIFwiLi9hY3Rpb25zLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgS2lja1R5cGUsIFJldHVyblR5cGUgfSBmcm9tIFwiLi90eXBlcy5qc1wiO1xuXG5jb25zdCBLSUNLX1RZUEVTOiBLaWNrVHlwZVtdID0gW1wiUktcIiwgXCJPS1wiLCBcIlNLXCJdO1xuY29uc3QgUkVUVVJOX1RZUEVTOiBSZXR1cm5UeXBlW10gPSBbXCJSUlwiLCBcIk9SXCIsIFwiVEJcIl07XG5cbmNvbnN0IFBMQVlfUEhBU0VTID0gbmV3IFNldChbXCJSRUdfUExBWVwiLCBcIk9UX1BMQVlcIiwgXCJUV09fUFRfQ09OVlwiXSk7XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUFjdGlvbihzdGF0ZTogR2FtZVN0YXRlLCBhY3Rpb246IEFjdGlvbik6IHN0cmluZyB8IG51bGwge1xuICBzd2l0Y2ggKGFjdGlvbi50eXBlKSB7XG4gICAgY2FzZSBcIlNUQVJUX0dBTUVcIjpcbiAgICAgIGlmIChzdGF0ZS5waGFzZSAhPT0gXCJJTklUXCIpIHJldHVybiBcIlNUQVJUX0dBTUUgb25seSB2YWxpZCBpbiBJTklUXCI7XG4gICAgICBpZiAodHlwZW9mIGFjdGlvbi5xdWFydGVyTGVuZ3RoTWludXRlcyAhPT0gXCJudW1iZXJcIikgcmV0dXJuIFwiYmFkIHF0ckxlblwiO1xuICAgICAgaWYgKGFjdGlvbi5xdWFydGVyTGVuZ3RoTWludXRlcyA8IDEgfHwgYWN0aW9uLnF1YXJ0ZXJMZW5ndGhNaW51dGVzID4gMTUpIHtcbiAgICAgICAgcmV0dXJuIFwicXRyTGVuIG11c3QgYmUgMS4uMTVcIjtcbiAgICAgIH1cbiAgICAgIGlmICghYWN0aW9uLnRlYW1zIHx8IHR5cGVvZiBhY3Rpb24udGVhbXNbMV0gIT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIGFjdGlvbi50ZWFtc1syXSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICByZXR1cm4gXCJ0ZWFtcyBtaXNzaW5nXCI7XG4gICAgICB9XG4gICAgICByZXR1cm4gbnVsbDtcblxuICAgIGNhc2UgXCJDT0lOX1RPU1NfQ0FMTFwiOlxuICAgICAgaWYgKHN0YXRlLnBoYXNlICE9PSBcIkNPSU5fVE9TU1wiKSByZXR1cm4gXCJub3QgaW4gQ09JTl9UT1NTXCI7XG4gICAgICBpZiAoIWlzUGxheWVyKGFjdGlvbi5wbGF5ZXIpKSByZXR1cm4gXCJiYWQgcGxheWVyXCI7XG4gICAgICBpZiAoYWN0aW9uLmNhbGwgIT09IFwiaGVhZHNcIiAmJiBhY3Rpb24uY2FsbCAhPT0gXCJ0YWlsc1wiKSByZXR1cm4gXCJiYWQgY2FsbFwiO1xuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICBjYXNlIFwiUkVDRUlWRV9DSE9JQ0VcIjpcbiAgICAgIC8vIEFsbG93ZWQgb25seSBhZnRlciB0aGUgY29pbiB0b3NzIHJlc29sdmVzOyBlbmdpbmUncyByZWR1Y2VyIGxlYXZlc1xuICAgICAgLy8gc3RhdGUucGhhc2UgYXQgQ09JTl9UT1NTIHVudGlsIFJFQ0VJVkVfQ0hPSUNFIHRyYW5zaXRpb25zIHRvIEtJQ0tPRkYuXG4gICAgICBpZiAoc3RhdGUucGhhc2UgIT09IFwiQ09JTl9UT1NTXCIpIHJldHVybiBcIm5vdCBpbiBDT0lOX1RPU1NcIjtcbiAgICAgIGlmICghaXNQbGF5ZXIoYWN0aW9uLnBsYXllcikpIHJldHVybiBcImJhZCBwbGF5ZXJcIjtcbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlICE9PSBcInJlY2VpdmVcIiAmJiBhY3Rpb24uY2hvaWNlICE9PSBcImRlZmVyXCIpIHJldHVybiBcImJhZCBjaG9pY2VcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIlBJQ0tfUExBWVwiOlxuICAgICAgaWYgKCFQTEFZX1BIQVNFUy5oYXMoc3RhdGUucGhhc2UpKSByZXR1cm4gXCJub3QgaW4gYSBwbGF5IHBoYXNlXCI7XG4gICAgICBpZiAoIWlzUGxheWVyKGFjdGlvbi5wbGF5ZXIpKSByZXR1cm4gXCJiYWQgcGxheWVyXCI7XG4gICAgICBpZiAoIWlzUGxheUNhbGwoYWN0aW9uLnBsYXkpKSByZXR1cm4gXCJiYWQgcGxheVwiO1xuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICBjYXNlIFwiQ0FMTF9USU1FT1VUXCI6XG4gICAgICBpZiAoIWlzUGxheWVyKGFjdGlvbi5wbGF5ZXIpKSByZXR1cm4gXCJiYWQgcGxheWVyXCI7XG4gICAgICBpZiAoc3RhdGUucGxheWVyc1thY3Rpb24ucGxheWVyXS50aW1lb3V0cyA8PSAwKSByZXR1cm4gXCJubyB0aW1lb3V0cyByZW1haW5pbmdcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIkFDQ0VQVF9QRU5BTFRZXCI6XG4gICAgY2FzZSBcIkRFQ0xJTkVfUEVOQUxUWVwiOlxuICAgICAgaWYgKHN0YXRlLnBoYXNlICE9PSBcIlBFTkFMVFlfQ0hPSUNFXCIpIHJldHVybiBcIm5vdCBpbiBQRU5BTFRZX0NIT0lDRVwiO1xuICAgICAgaWYgKCFpc1BsYXllcihhY3Rpb24ucGxheWVyKSkgcmV0dXJuIFwiYmFkIHBsYXllclwiO1xuICAgICAgaWYgKCFzdGF0ZS5wZW5kaW5nUGVuYWx0eSkgcmV0dXJuIFwibm8gcGVuZGluZyBwZW5hbHR5XCI7XG4gICAgICBpZiAoYWN0aW9uLnBsYXllciAhPT0gc3RhdGUucGVuZGluZ1BlbmFsdHkuYmVuZWZpY2lhcnkpIHJldHVybiBcIndyb25nIHBsYXllciBmb3IgY2hvaWNlXCI7XG4gICAgICByZXR1cm4gbnVsbDtcblxuICAgIGNhc2UgXCJQQVRfQ0hPSUNFXCI6XG4gICAgICBpZiAoc3RhdGUucGhhc2UgIT09IFwiUEFUX0NIT0lDRVwiKSByZXR1cm4gXCJub3QgaW4gUEFUX0NIT0lDRVwiO1xuICAgICAgaWYgKCFpc1BsYXllcihhY3Rpb24ucGxheWVyKSkgcmV0dXJuIFwiYmFkIHBsYXllclwiO1xuICAgICAgaWYgKGFjdGlvbi5jaG9pY2UgIT09IFwia2lja1wiICYmIGFjdGlvbi5jaG9pY2UgIT09IFwidHdvX3BvaW50XCIpIHJldHVybiBcImJhZCBjaG9pY2VcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIkZPVVJUSF9ET1dOX0NIT0lDRVwiOlxuICAgICAgaWYgKHN0YXRlLnBoYXNlICE9PSBcIlJFR19QTEFZXCIgJiYgc3RhdGUucGhhc2UgIT09IFwiT1RfUExBWVwiKSByZXR1cm4gXCJ3cm9uZyBwaGFzZVwiO1xuICAgICAgaWYgKHN0YXRlLmZpZWxkLmRvd24gIT09IDQpIHJldHVybiBcIm5vdCA0dGggZG93blwiO1xuICAgICAgaWYgKCFpc1BsYXllcihhY3Rpb24ucGxheWVyKSkgcmV0dXJuIFwiYmFkIHBsYXllclwiO1xuICAgICAgaWYgKGFjdGlvbi5jaG9pY2UgIT09IFwiZ29cIiAmJiBhY3Rpb24uY2hvaWNlICE9PSBcInB1bnRcIiAmJiBhY3Rpb24uY2hvaWNlICE9PSBcImZnXCIpIHtcbiAgICAgICAgcmV0dXJuIFwiYmFkIGNob2ljZVwiO1xuICAgICAgfVxuICAgICAgaWYgKGFjdGlvbi5jaG9pY2UgPT09IFwicHVudFwiICYmIHN0YXRlLnBoYXNlID09PSBcIk9UX1BMQVlcIikgcmV0dXJuIFwibm8gcHVudHMgaW4gT1RcIjtcbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlID09PSBcImZnXCIgJiYgc3RhdGUuZmllbGQuYmFsbE9uIDwgNDUpIHJldHVybiBcIm91dCBvZiBGRyByYW5nZVwiO1xuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICBjYXNlIFwiRk9SRkVJVFwiOlxuICAgICAgaWYgKCFpc1BsYXllcihhY3Rpb24ucGxheWVyKSkgcmV0dXJuIFwiYmFkIHBsYXllclwiO1xuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICBjYXNlIFwiUkVTT0xWRV9LSUNLT0ZGXCI6XG4gICAgICBpZiAoc3RhdGUucGhhc2UgIT09IFwiS0lDS09GRlwiKSByZXR1cm4gXCJub3QgaW4gS0lDS09GRlwiO1xuICAgICAgLy8gUGlja3MgYXJlIG9wdGlvbmFsIChzYWZldHkga2lja3Mgc2tpcCB0aGVtKSwgYnV0IHdoZW4gcHJlc2VudCB0aGV5XG4gICAgICAvLyBtdXN0IGJlIGxlZ2FsIGVudW0gdmFsdWVzLlxuICAgICAgaWYgKGFjdGlvbi5raWNrVHlwZSAhPT0gdW5kZWZpbmVkICYmICFLSUNLX1RZUEVTLmluY2x1ZGVzKGFjdGlvbi5raWNrVHlwZSkpIHtcbiAgICAgICAgcmV0dXJuIFwiYmFkIGtpY2tUeXBlXCI7XG4gICAgICB9XG4gICAgICBpZiAoYWN0aW9uLnJldHVyblR5cGUgIT09IHVuZGVmaW5lZCAmJiAhUkVUVVJOX1RZUEVTLmluY2x1ZGVzKGFjdGlvbi5yZXR1cm5UeXBlKSkge1xuICAgICAgICByZXR1cm4gXCJiYWQgcmV0dXJuVHlwZVwiO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICBjYXNlIFwiU1RBUlRfT1RfUE9TU0VTU0lPTlwiOlxuICAgICAgaWYgKHN0YXRlLnBoYXNlICE9PSBcIk9UX1NUQVJUXCIpIHJldHVybiBcIm5vdCBpbiBPVF9TVEFSVFwiO1xuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICBjYXNlIFwiVElDS19DTE9DS1wiOlxuICAgICAgaWYgKHR5cGVvZiBhY3Rpb24uc2Vjb25kcyAhPT0gXCJudW1iZXJcIikgcmV0dXJuIFwiYmFkIHNlY29uZHNcIjtcbiAgICAgIGlmIChhY3Rpb24uc2Vjb25kcyA8IDAgfHwgYWN0aW9uLnNlY29uZHMgPiAzMDApIHJldHVybiBcInNlY29uZHMgb3V0IG9mIHJhbmdlXCI7XG4gICAgICByZXR1cm4gbnVsbDtcblxuICAgIGRlZmF1bHQ6IHtcbiAgICAgIGNvbnN0IF9leGhhdXN0aXZlOiBuZXZlciA9IGFjdGlvbjtcbiAgICAgIHZvaWQgX2V4aGF1c3RpdmU7XG4gICAgICByZXR1cm4gXCJ1bmtub3duIGFjdGlvbiB0eXBlXCI7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGlzUGxheWVyKHA6IHVua25vd24pOiBwIGlzIDEgfCAyIHtcbiAgcmV0dXJuIHAgPT09IDEgfHwgcCA9PT0gMjtcbn1cblxuZnVuY3Rpb24gaXNQbGF5Q2FsbChwOiB1bmtub3duKTogYm9vbGVhbiB7XG4gIHJldHVybiAoXG4gICAgcCA9PT0gXCJTUlwiIHx8XG4gICAgcCA9PT0gXCJMUlwiIHx8XG4gICAgcCA9PT0gXCJTUFwiIHx8XG4gICAgcCA9PT0gXCJMUFwiIHx8XG4gICAgcCA9PT0gXCJUUFwiIHx8XG4gICAgcCA9PT0gXCJITVwiIHx8XG4gICAgcCA9PT0gXCJGR1wiIHx8XG4gICAgcCA9PT0gXCJQVU5UXCIgfHxcbiAgICBwID09PSBcIlRXT19QVFwiXG4gICk7XG59XG4iLCAiLyoqXG4gKiBTdGF0ZSBmYWN0b3JpZXMuXG4gKlxuICogYGluaXRpYWxTdGF0ZSgpYCBwcm9kdWNlcyBhIGZyZXNoIEdhbWVTdGF0ZSBpbiBJTklUIHBoYXNlLiBFdmVyeXRoaW5nIGVsc2VcbiAqIGZsb3dzIGZyb20gcmVkdWNpbmcgYWN0aW9ucyBvdmVyIHRoaXMgc3RhcnRpbmcgcG9pbnQuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIEhhbmQsIFBsYXllcklkLCBTdGF0cywgVGVhbVJlZiB9IGZyb20gXCIuL3R5cGVzLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBlbXB0eUhhbmQoaXNPdmVydGltZSA9IGZhbHNlKTogSGFuZCB7XG4gIHJldHVybiB7XG4gICAgU1I6IDMsXG4gICAgTFI6IDMsXG4gICAgU1A6IDMsXG4gICAgTFA6IDMsXG4gICAgVFA6IDEsXG4gICAgSE06IGlzT3ZlcnRpbWUgPyAyIDogMyxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGVtcHR5U3RhdHMoKTogU3RhdHMge1xuICByZXR1cm4geyBwYXNzWWFyZHM6IDAsIHJ1c2hZYXJkczogMCwgdHVybm92ZXJzOiAwLCBzYWNrczogMCB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZnJlc2hEZWNrTXVsdGlwbGllcnMoKTogW251bWJlciwgbnVtYmVyLCBudW1iZXIsIG51bWJlcl0ge1xuICByZXR1cm4gWzQsIDQsIDQsIDNdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZnJlc2hEZWNrWWFyZHMoKTogbnVtYmVyW10ge1xuICByZXR1cm4gWzEsIDEsIDEsIDEsIDEsIDEsIDEsIDEsIDEsIDFdO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEluaXRpYWxTdGF0ZUFyZ3Mge1xuICB0ZWFtMTogVGVhbVJlZjtcbiAgdGVhbTI6IFRlYW1SZWY7XG4gIHF1YXJ0ZXJMZW5ndGhNaW51dGVzOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpbml0aWFsU3RhdGUoYXJnczogSW5pdGlhbFN0YXRlQXJncyk6IEdhbWVTdGF0ZSB7XG4gIHJldHVybiB7XG4gICAgcGhhc2U6IFwiSU5JVFwiLFxuICAgIHNjaGVtYVZlcnNpb246IDEsXG4gICAgY2xvY2s6IHtcbiAgICAgIHF1YXJ0ZXI6IDAsXG4gICAgICBzZWNvbmRzUmVtYWluaW5nOiBhcmdzLnF1YXJ0ZXJMZW5ndGhNaW51dGVzICogNjAsXG4gICAgICBxdWFydGVyTGVuZ3RoTWludXRlczogYXJncy5xdWFydGVyTGVuZ3RoTWludXRlcyxcbiAgICB9LFxuICAgIGZpZWxkOiB7XG4gICAgICBiYWxsT246IDM1LFxuICAgICAgZmlyc3REb3duQXQ6IDQ1LFxuICAgICAgZG93bjogMSxcbiAgICAgIG9mZmVuc2U6IDEsXG4gICAgfSxcbiAgICBkZWNrOiB7XG4gICAgICBtdWx0aXBsaWVyczogZnJlc2hEZWNrTXVsdGlwbGllcnMoKSxcbiAgICAgIHlhcmRzOiBmcmVzaERlY2tZYXJkcygpLFxuICAgIH0sXG4gICAgcGxheWVyczoge1xuICAgICAgMToge1xuICAgICAgICB0ZWFtOiBhcmdzLnRlYW0xLFxuICAgICAgICBzY29yZTogMCxcbiAgICAgICAgdGltZW91dHM6IDMsXG4gICAgICAgIGhhbmQ6IGVtcHR5SGFuZCgpLFxuICAgICAgICBzdGF0czogZW1wdHlTdGF0cygpLFxuICAgICAgfSxcbiAgICAgIDI6IHtcbiAgICAgICAgdGVhbTogYXJncy50ZWFtMixcbiAgICAgICAgc2NvcmU6IDAsXG4gICAgICAgIHRpbWVvdXRzOiAzLFxuICAgICAgICBoYW5kOiBlbXB0eUhhbmQoKSxcbiAgICAgICAgc3RhdHM6IGVtcHR5U3RhdHMoKSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBvcGVuaW5nUmVjZWl2ZXI6IG51bGwsXG4gICAgb3ZlcnRpbWU6IG51bGwsXG4gICAgcGVuZGluZ1BpY2s6IHsgb2ZmZW5zZVBsYXk6IG51bGwsIGRlZmVuc2VQbGF5OiBudWxsIH0sXG4gICAgcGVuZGluZ1BlbmFsdHk6IG51bGwsXG4gICAgbGFzdFBsYXlEZXNjcmlwdGlvbjogXCJTdGFydCBvZiBnYW1lXCIsXG4gICAgaXNTYWZldHlLaWNrOiBmYWxzZSxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG9wcChwOiBQbGF5ZXJJZCk6IFBsYXllcklkIHtcbiAgcmV0dXJuIHAgPT09IDEgPyAyIDogMTtcbn1cbiIsICIvKipcbiAqIFRoZSBwbGF5IG1hdGNodXAgbWF0cml4IFx1MjAxNCB0aGUgaGVhcnQgb2YgRm9vdEJvcmVkLlxuICpcbiAqIEJvdGggdGVhbXMgcGljayBhIHBsYXkuIFRoZSBtYXRyaXggc2NvcmVzIGhvdyAqY2xvc2VseSogdGhlIGRlZmVuc2VcbiAqIHByZWRpY3RlZCB0aGUgb2ZmZW5zaXZlIGNhbGw6XG4gKiAgIC0gMSA9IGRlZmVuc2Ugd2F5IG9mZiBcdTIxOTIgZ3JlYXQgZm9yIG9mZmVuc2VcbiAqICAgLSA1ID0gZGVmZW5zZSBtYXRjaGVkIFx1MjE5MiB0ZXJyaWJsZSBmb3Igb2ZmZW5zZSAoY29tYmluZWQgd2l0aCBhIGxvd1xuICogICAgICAgICBtdWx0aXBsaWVyIGNhcmQsIHRoaXMgYmVjb21lcyBhIGxvc3MgLyB0dXJub3ZlciByaXNrKVxuICpcbiAqIFJvd3MgPSBvZmZlbnNpdmUgY2FsbCwgQ29scyA9IGRlZmVuc2l2ZSBjYWxsLiBPcmRlcjogW1NSLCBMUiwgU1AsIExQXS5cbiAqXG4gKiAgICAgICAgICAgREVGOiBTUiAgTFIgIFNQICBMUFxuICogICBPRkY6IFNSICAgICBbIDUsICAzLCAgMywgIDIgXVxuICogICBPRkY6IExSICAgICBbIDIsICA0LCAgMSwgIDIgXVxuICogICBPRkY6IFNQICAgICBbIDMsICAyLCAgNSwgIDMgXVxuICogICBPRkY6IExQICAgICBbIDEsICAyLCAgMiwgIDQgXVxuICpcbiAqIFBvcnRlZCB2ZXJiYXRpbSBmcm9tIHB1YmxpYy9qcy9kZWZhdWx0cy5qcyBNQVRDSFVQLiBJbmRleGluZyBjb25maXJtZWRcbiAqIGFnYWluc3QgcGxheU1lY2hhbmlzbSAvIGNhbGNUaW1lcyBpbiBydW4uanM6MjM2OC5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IFJlZ3VsYXJQbGF5IH0gZnJvbSBcIi4uL3R5cGVzLmpzXCI7XG5cbmV4cG9ydCBjb25zdCBNQVRDSFVQOiBSZWFkb25seUFycmF5PFJlYWRvbmx5QXJyYXk8TWF0Y2h1cFF1YWxpdHk+PiA9IFtcbiAgWzUsIDMsIDMsIDJdLFxuICBbMiwgNCwgMSwgMl0sXG4gIFszLCAyLCA1LCAzXSxcbiAgWzEsIDIsIDIsIDRdLFxuXSBhcyBjb25zdDtcblxuZXhwb3J0IHR5cGUgTWF0Y2h1cFF1YWxpdHkgPSAxIHwgMiB8IDMgfCA0IHwgNTtcblxuY29uc3QgUExBWV9JTkRFWDogUmVjb3JkPFJlZ3VsYXJQbGF5LCAwIHwgMSB8IDIgfCAzPiA9IHtcbiAgU1I6IDAsXG4gIExSOiAxLFxuICBTUDogMixcbiAgTFA6IDMsXG59O1xuXG4vKipcbiAqIE11bHRpcGxpZXIgY2FyZCB2YWx1ZXMuIEluZGV4aW5nIChjb25maXJtZWQgaW4gcnVuLmpzOjIzNzcpOlxuICogICByb3cgICAgPSBtdWx0aXBsaWVyIGNhcmQgKDA9S2luZywgMT1RdWVlbiwgMj1KYWNrLCAzPTEwKVxuICogICBjb2x1bW4gPSBtYXRjaHVwIHF1YWxpdHkgLSAxIChzbyBjb2x1bW4gMCA9IHF1YWxpdHkgMSwgY29sdW1uIDQgPSBxdWFsaXR5IDUpXG4gKlxuICogUXVhbGl0eSAxIChvZmZlbnNlIG91dGd1ZXNzZWQgZGVmZW5zZSkgKyBLaW5nID0gNHguIEJlc3QgcG9zc2libGUgcGxheS5cbiAqIFF1YWxpdHkgNSAoZGVmZW5zZSBtYXRjaGVkKSArIDEwICAgICAgICA9IC0xeC4gV29yc3QgcmVndWxhciBwbGF5LlxuICpcbiAqICAgICAgICAgICAgICAgICAgcXVhbCAxICBxdWFsIDIgIHF1YWwgMyAgcXVhbCA0ICBxdWFsIDVcbiAqICAgS2luZyAgICAoMCkgIFsgICA0LCAgICAgIDMsICAgICAgMiwgICAgIDEuNSwgICAgIDEgICBdXG4gKiAgIFF1ZWVuICAgKDEpICBbICAgMywgICAgICAyLCAgICAgIDEsICAgICAgMSwgICAgIDAuNSAgXVxuICogICBKYWNrICAgICgyKSAgWyAgIDIsICAgICAgMSwgICAgIDAuNSwgICAgIDAsICAgICAgMCAgIF1cbiAqICAgMTAgICAgICAoMykgIFsgICAwLCAgICAgIDAsICAgICAgMCwgICAgIC0xLCAgICAgLTEgICBdXG4gKlxuICogUG9ydGVkIHZlcmJhdGltIGZyb20gcHVibGljL2pzL2RlZmF1bHRzLmpzIE1VTFRJLlxuICovXG5leHBvcnQgY29uc3QgTVVMVEk6IFJlYWRvbmx5QXJyYXk8UmVhZG9ubHlBcnJheTxudW1iZXI+PiA9IFtcbiAgWzQsIDMsIDIsIDEuNSwgMV0sXG4gIFszLCAyLCAxLCAxLCAwLjVdLFxuICBbMiwgMSwgMC41LCAwLCAwXSxcbiAgWzAsIDAsIDAsIC0xLCAtMV0sXG5dIGFzIGNvbnN0O1xuXG5leHBvcnQgZnVuY3Rpb24gbWF0Y2h1cFF1YWxpdHkob2ZmOiBSZWd1bGFyUGxheSwgZGVmOiBSZWd1bGFyUGxheSk6IE1hdGNodXBRdWFsaXR5IHtcbiAgY29uc3Qgcm93ID0gTUFUQ0hVUFtQTEFZX0lOREVYW29mZl1dO1xuICBpZiAoIXJvdykgdGhyb3cgbmV3IEVycm9yKGB1bnJlYWNoYWJsZTogYmFkIG9mZiBwbGF5ICR7b2ZmfWApO1xuICBjb25zdCBxID0gcm93W1BMQVlfSU5ERVhbZGVmXV07XG4gIGlmIChxID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihgdW5yZWFjaGFibGU6IGJhZCBkZWYgcGxheSAke2RlZn1gKTtcbiAgcmV0dXJuIHE7XG59XG4iLCAiLyoqXG4gKiBQdXJlIHlhcmRhZ2UgY2FsY3VsYXRpb24gZm9yIGEgcmVndWxhciBwbGF5IChTUi9MUi9TUC9MUCkuXG4gKlxuICogRm9ybXVsYSAocnVuLmpzOjIzMzcpOlxuICogICB5YXJkcyA9IHJvdW5kKG11bHRpcGxpZXIgKiB5YXJkc0NhcmQpICsgYm9udXNcbiAqXG4gKiBXaGVyZTpcbiAqICAgLSBtdWx0aXBsaWVyID0gTVVMVElbbXVsdGlwbGllckNhcmRdW3F1YWxpdHkgLSAxXVxuICogICAtIHF1YWxpdHkgICAgPSBNQVRDSFVQW29mZmVuc2VdW2RlZmVuc2VdICAgLy8gMS01XG4gKiAgIC0gYm9udXMgICAgICA9IHNwZWNpYWwtcGxheSBib251cyAoZS5nLiBUcmljayBQbGF5ICs1IG9uIExSL0xQIG91dGNvbWVzKVxuICpcbiAqIFNwZWNpYWwgcGxheXMgKFRQLCBITSwgRkcsIFBVTlQsIFRXT19QVCkgdXNlIGRpZmZlcmVudCBmb3JtdWxhcyBcdTIwMTQgdGhleVxuICogbGl2ZSBpbiBydWxlcy9zcGVjaWFsLnRzIChUT0RPKSBhbmQgcHJvZHVjZSBldmVudHMgZGlyZWN0bHkuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBSZWd1bGFyUGxheSB9IGZyb20gXCIuLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgTVVMVEksIG1hdGNodXBRdWFsaXR5IH0gZnJvbSBcIi4vbWF0Y2h1cC5qc1wiO1xuXG5leHBvcnQgdHlwZSBNdWx0aXBsaWVyQ2FyZEluZGV4ID0gMCB8IDEgfCAyIHwgMztcbmV4cG9ydCBjb25zdCBNVUxUSVBMSUVSX0NBUkRfTkFNRVMgPSBbXCJLaW5nXCIsIFwiUXVlZW5cIiwgXCJKYWNrXCIsIFwiMTBcIl0gYXMgY29uc3Q7XG5leHBvcnQgdHlwZSBNdWx0aXBsaWVyQ2FyZE5hbWUgPSAodHlwZW9mIE1VTFRJUExJRVJfQ0FSRF9OQU1FUylbbnVtYmVyXTtcblxuZXhwb3J0IGludGVyZmFjZSBZYXJkYWdlSW5wdXRzIHtcbiAgb2ZmZW5zZTogUmVndWxhclBsYXk7XG4gIGRlZmVuc2U6IFJlZ3VsYXJQbGF5O1xuICAvKiogTXVsdGlwbGllciBjYXJkIGluZGV4OiAwPUtpbmcsIDE9UXVlZW4sIDI9SmFjaywgMz0xMC4gKi9cbiAgbXVsdGlwbGllckNhcmQ6IE11bHRpcGxpZXJDYXJkSW5kZXg7XG4gIC8qKiBZYXJkcyBjYXJkIGRyYXduLCAxLTEwLiAqL1xuICB5YXJkc0NhcmQ6IG51bWJlcjtcbiAgLyoqIEJvbnVzIHlhcmRzIGZyb20gc3BlY2lhbC1wbGF5IG92ZXJsYXlzIChlLmcuIFRyaWNrIFBsYXkgKzUpLiAqL1xuICBib251cz86IG51bWJlcjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBZYXJkYWdlT3V0Y29tZSB7XG4gIG1hdGNodXBRdWFsaXR5OiBudW1iZXI7XG4gIG11bHRpcGxpZXI6IG51bWJlcjtcbiAgbXVsdGlwbGllckNhcmROYW1lOiBNdWx0aXBsaWVyQ2FyZE5hbWU7XG4gIHlhcmRzR2FpbmVkOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjb21wdXRlWWFyZGFnZShpbnB1dHM6IFlhcmRhZ2VJbnB1dHMpOiBZYXJkYWdlT3V0Y29tZSB7XG4gIGNvbnN0IHF1YWxpdHkgPSBtYXRjaHVwUXVhbGl0eShpbnB1dHMub2ZmZW5zZSwgaW5wdXRzLmRlZmVuc2UpO1xuICBjb25zdCBtdWx0aVJvdyA9IE1VTFRJW2lucHV0cy5tdWx0aXBsaWVyQ2FyZF07XG4gIGlmICghbXVsdGlSb3cpIHRocm93IG5ldyBFcnJvcihgdW5yZWFjaGFibGU6IGJhZCBtdWx0aSBjYXJkICR7aW5wdXRzLm11bHRpcGxpZXJDYXJkfWApO1xuICBjb25zdCBtdWx0aXBsaWVyID0gbXVsdGlSb3dbcXVhbGl0eSAtIDFdO1xuICBpZiAobXVsdGlwbGllciA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoYHVucmVhY2hhYmxlOiBiYWQgcXVhbGl0eSAke3F1YWxpdHl9YCk7XG5cbiAgY29uc3QgYm9udXMgPSBpbnB1dHMuYm9udXMgPz8gMDtcbiAgY29uc3QgeWFyZHNHYWluZWQgPSBNYXRoLnJvdW5kKG11bHRpcGxpZXIgKiBpbnB1dHMueWFyZHNDYXJkKSArIGJvbnVzO1xuXG4gIHJldHVybiB7XG4gICAgbWF0Y2h1cFF1YWxpdHk6IHF1YWxpdHksXG4gICAgbXVsdGlwbGllcixcbiAgICBtdWx0aXBsaWVyQ2FyZE5hbWU6IE1VTFRJUExJRVJfQ0FSRF9OQU1FU1tpbnB1dHMubXVsdGlwbGllckNhcmRdLFxuICAgIHlhcmRzR2FpbmVkLFxuICB9O1xufVxuIiwgIi8qKlxuICogQ2FyZC1kZWNrIGRyYXdzIFx1MjAxNCBwdXJlIHZlcnNpb25zIG9mIHY1LjEncyBgR2FtZS5kZWNNdWx0c2AgYW5kIGBHYW1lLmRlY1lhcmRzYC5cbiAqXG4gKiBUaGUgZGVjayBpcyByZXByZXNlbnRlZCBhcyBhbiBhcnJheSBvZiByZW1haW5pbmcgY291bnRzIHBlciBjYXJkIHNsb3QuXG4gKiBUbyBkcmF3LCB3ZSBwaWNrIGEgdW5pZm9ybSByYW5kb20gc2xvdDsgaWYgdGhhdCBzbG90IGlzIGVtcHR5LCB3ZSByZXRyeS5cbiAqIFRoaXMgaXMgbWF0aGVtYXRpY2FsbHkgZXF1aXZhbGVudCB0byBzaHVmZmxpbmcgdGhlIHJlbWFpbmluZyBjYXJkcyBhbmRcbiAqIGRyYXdpbmcgb25lIFx1MjAxNCBhbmQgbWF0Y2hlcyB2NS4xJ3MgYmVoYXZpb3IgdmVyYmF0aW0uXG4gKlxuICogV2hlbiB0aGUgZGVjayBpcyBleGhhdXN0ZWQsIHRoZSBjb25zdW1lciAodGhlIHJlZHVjZXIpIHJlZmlsbHMgaXQgYW5kXG4gKiBlbWl0cyBhIERFQ0tfU0hVRkZMRUQgZXZlbnQuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IERlY2tTdGF0ZSB9IGZyb20gXCIuLi90eXBlcy5qc1wiO1xuaW1wb3J0IHtcbiAgZnJlc2hEZWNrTXVsdGlwbGllcnMsXG4gIGZyZXNoRGVja1lhcmRzLFxufSBmcm9tIFwiLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7XG4gIE1VTFRJUExJRVJfQ0FSRF9OQU1FUyxcbiAgdHlwZSBNdWx0aXBsaWVyQ2FyZEluZGV4LFxuICB0eXBlIE11bHRpcGxpZXJDYXJkTmFtZSxcbn0gZnJvbSBcIi4veWFyZGFnZS5qc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIE11bHRpcGxpZXJEcmF3IHtcbiAgY2FyZDogTXVsdGlwbGllckNhcmROYW1lO1xuICBpbmRleDogTXVsdGlwbGllckNhcmRJbmRleDtcbiAgZGVjazogRGVja1N0YXRlO1xuICByZXNodWZmbGVkOiBib29sZWFuO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZHJhd011bHRpcGxpZXIoZGVjazogRGVja1N0YXRlLCBybmc6IFJuZyk6IE11bHRpcGxpZXJEcmF3IHtcbiAgY29uc3QgbXVsdHMgPSBbLi4uZGVjay5tdWx0aXBsaWVyc10gYXMgW251bWJlciwgbnVtYmVyLCBudW1iZXIsIG51bWJlcl07XG5cbiAgbGV0IGluZGV4OiBNdWx0aXBsaWVyQ2FyZEluZGV4O1xuICAvLyBSZWplY3Rpb24tc2FtcGxlIHRvIGRyYXcgdW5pZm9ybWx5IGFjcm9zcyByZW1haW5pbmcgY2FyZHMuXG4gIC8vIExvb3AgaXMgYm91bmRlZCBcdTIwMTQgdG90YWwgY2FyZHMgaW4gZnJlc2ggZGVjayBpcyAxNS5cbiAgZm9yICg7Oykge1xuICAgIGNvbnN0IGkgPSBybmcuaW50QmV0d2VlbigwLCAzKSBhcyBNdWx0aXBsaWVyQ2FyZEluZGV4O1xuICAgIGlmIChtdWx0c1tpXSA+IDApIHtcbiAgICAgIGluZGV4ID0gaTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIG11bHRzW2luZGV4XS0tO1xuXG4gIGxldCByZXNodWZmbGVkID0gZmFsc2U7XG4gIGxldCBuZXh0RGVjazogRGVja1N0YXRlID0geyAuLi5kZWNrLCBtdWx0aXBsaWVyczogbXVsdHMgfTtcbiAgaWYgKG11bHRzLmV2ZXJ5KChjKSA9PiBjID09PSAwKSkge1xuICAgIHJlc2h1ZmZsZWQgPSB0cnVlO1xuICAgIG5leHREZWNrID0geyAuLi5uZXh0RGVjaywgbXVsdGlwbGllcnM6IGZyZXNoRGVja011bHRpcGxpZXJzKCkgfTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgY2FyZDogTVVMVElQTElFUl9DQVJEX05BTUVTW2luZGV4XSxcbiAgICBpbmRleCxcbiAgICBkZWNrOiBuZXh0RGVjayxcbiAgICByZXNodWZmbGVkLFxuICB9O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFlhcmRzRHJhdyB7XG4gIC8qKiBZYXJkcyBjYXJkIHZhbHVlLCAxLTEwLiAqL1xuICBjYXJkOiBudW1iZXI7XG4gIGRlY2s6IERlY2tTdGF0ZTtcbiAgcmVzaHVmZmxlZDogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRyYXdZYXJkcyhkZWNrOiBEZWNrU3RhdGUsIHJuZzogUm5nKTogWWFyZHNEcmF3IHtcbiAgY29uc3QgeWFyZHMgPSBbLi4uZGVjay55YXJkc107XG5cbiAgbGV0IGluZGV4OiBudW1iZXI7XG4gIGZvciAoOzspIHtcbiAgICBjb25zdCBpID0gcm5nLmludEJldHdlZW4oMCwgeWFyZHMubGVuZ3RoIC0gMSk7XG4gICAgY29uc3Qgc2xvdCA9IHlhcmRzW2ldO1xuICAgIGlmIChzbG90ICE9PSB1bmRlZmluZWQgJiYgc2xvdCA+IDApIHtcbiAgICAgIGluZGV4ID0gaTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIHlhcmRzW2luZGV4XSA9ICh5YXJkc1tpbmRleF0gPz8gMCkgLSAxO1xuXG4gIGxldCByZXNodWZmbGVkID0gZmFsc2U7XG4gIGxldCBuZXh0RGVjazogRGVja1N0YXRlID0geyAuLi5kZWNrLCB5YXJkcyB9O1xuICBpZiAoeWFyZHMuZXZlcnkoKGMpID0+IGMgPT09IDApKSB7XG4gICAgcmVzaHVmZmxlZCA9IHRydWU7XG4gICAgbmV4dERlY2sgPSB7IC4uLm5leHREZWNrLCB5YXJkczogZnJlc2hEZWNrWWFyZHMoKSB9O1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBjYXJkOiBpbmRleCArIDEsXG4gICAgZGVjazogbmV4dERlY2ssXG4gICAgcmVzaHVmZmxlZCxcbiAgfTtcbn1cbiIsICIvKipcbiAqIFNoYXJlZCBwcmltaXRpdmVzIHVzZWQgYnkgbXVsdGlwbGUgc3BlY2lhbC1wbGF5IHJlc29sdmVycy5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIFBsYXllcklkLCBTdGF0cyB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4uLy4uL3N0YXRlLmpzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3BlY2lhbFJlc29sdXRpb24ge1xuICBzdGF0ZTogR2FtZVN0YXRlO1xuICBldmVudHM6IEV2ZW50W107XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBibGFua1BpY2soKTogR2FtZVN0YXRlW1wicGVuZGluZ1BpY2tcIl0ge1xuICByZXR1cm4geyBvZmZlbnNlUGxheTogbnVsbCwgZGVmZW5zZVBsYXk6IG51bGwgfTtcbn1cblxuLyoqXG4gKiBCdW1wIHBlci1wbGF5ZXIgc3RhdHMuIFJldHVybnMgYSBuZXcgcGxheWVycyBtYXAgd2l0aCB0aGUgZGVsdGFzIGFwcGxpZWRcbiAqIHRvIGBwbGF5ZXJJZGAuIFVzZSBwYXJ0aWFsIFN0YXRzIFx1MjAxNCB1bnNwZWNpZmllZCBmaWVsZHMgYXJlIHVuY2hhbmdlZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1bXBTdGF0cyhcbiAgcGxheWVyczogR2FtZVN0YXRlW1wicGxheWVyc1wiXSxcbiAgcGxheWVySWQ6IFBsYXllcklkLFxuICBkZWx0YXM6IFBhcnRpYWw8U3RhdHM+LFxuKTogR2FtZVN0YXRlW1wicGxheWVyc1wiXSB7XG4gIGNvbnN0IGN1ciA9IHBsYXllcnNbcGxheWVySWRdLnN0YXRzO1xuICByZXR1cm4ge1xuICAgIC4uLnBsYXllcnMsXG4gICAgW3BsYXllcklkXToge1xuICAgICAgLi4ucGxheWVyc1twbGF5ZXJJZF0sXG4gICAgICBzdGF0czoge1xuICAgICAgICBwYXNzWWFyZHM6IGN1ci5wYXNzWWFyZHMgKyAoZGVsdGFzLnBhc3NZYXJkcyA/PyAwKSxcbiAgICAgICAgcnVzaFlhcmRzOiBjdXIucnVzaFlhcmRzICsgKGRlbHRhcy5ydXNoWWFyZHMgPz8gMCksXG4gICAgICAgIHR1cm5vdmVyczogY3VyLnR1cm5vdmVycyArIChkZWx0YXMudHVybm92ZXJzID8/IDApLFxuICAgICAgICBzYWNrczogY3VyLnNhY2tzICsgKGRlbHRhcy5zYWNrcyA/PyAwKSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xufVxuXG4vKipcbiAqIEF3YXJkIHBvaW50cywgZmxpcCB0byBQQVRfQ0hPSUNFLiBDYWxsZXIgZW1pdHMgVE9VQ0hET1dOLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlUb3VjaGRvd24oXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHNjb3JlcjogUGxheWVySWQsXG4gIGV2ZW50czogRXZlbnRbXSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtzY29yZXJdOiB7IC4uLnN0YXRlLnBsYXllcnNbc2NvcmVyXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbc2NvcmVyXS5zY29yZSArIDYgfSxcbiAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiVE9VQ0hET1dOXCIsIHNjb3JpbmdQbGF5ZXI6IHNjb3JlciB9KTtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgcGhhc2U6IFwiUEFUX0NIT0lDRVwiLFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlTYWZldHkoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIGNvbmNlZGVyOiBQbGF5ZXJJZCxcbiAgZXZlbnRzOiBFdmVudFtdLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBzY29yZXIgPSBvcHAoY29uY2VkZXIpO1xuICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgW3Njb3Jlcl06IHsgLi4uc3RhdGUucGxheWVyc1tzY29yZXJdLCBzY29yZTogc3RhdGUucGxheWVyc1tzY29yZXJdLnNjb3JlICsgMiB9LFxuICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJTQUZFVFlcIiwgc2NvcmluZ1BsYXllcjogc2NvcmVyIH0pO1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBwaGFzZTogXCJLSUNLT0ZGXCIsXG4gICAgICBpc1NhZmV0eUtpY2s6IHRydWUsXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbi8qKlxuICogQXBwbHkgYSB5YXJkYWdlIG91dGNvbWUgd2l0aCBmdWxsIGRvd24vdHVybm92ZXIvc2NvcmUgYm9va2tlZXBpbmcuXG4gKiBVc2VkIGJ5IHNwZWNpYWxzIHRoYXQgcHJvZHVjZSB5YXJkYWdlIGRpcmVjdGx5IChIYWlsIE1hcnksIEJpZyBQbGF5IHJldHVybikuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhcHBseVlhcmRhZ2VPdXRjb21lKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICB5YXJkczogbnVtYmVyLFxuICBldmVudHM6IEV2ZW50W10sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBwcm9qZWN0ZWQgPSBzdGF0ZS5maWVsZC5iYWxsT24gKyB5YXJkcztcblxuICBpZiAocHJvamVjdGVkID49IDEwMCkgcmV0dXJuIGFwcGx5VG91Y2hkb3duKHN0YXRlLCBvZmZlbnNlLCBldmVudHMpO1xuICBpZiAocHJvamVjdGVkIDw9IDApIHJldHVybiBhcHBseVNhZmV0eShzdGF0ZSwgb2ZmZW5zZSwgZXZlbnRzKTtcblxuICBjb25zdCByZWFjaGVkRmlyc3REb3duID0gcHJvamVjdGVkID49IHN0YXRlLmZpZWxkLmZpcnN0RG93bkF0O1xuICBsZXQgbmV4dERvd24gPSBzdGF0ZS5maWVsZC5kb3duO1xuICBsZXQgbmV4dEZpcnN0RG93bkF0ID0gc3RhdGUuZmllbGQuZmlyc3REb3duQXQ7XG4gIGxldCBwb3NzZXNzaW9uRmxpcHBlZCA9IGZhbHNlO1xuXG4gIGlmIChyZWFjaGVkRmlyc3REb3duKSB7XG4gICAgbmV4dERvd24gPSAxO1xuICAgIG5leHRGaXJzdERvd25BdCA9IE1hdGgubWluKDEwMCwgcHJvamVjdGVkICsgMTApO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJGSVJTVF9ET1dOXCIgfSk7XG4gIH0gZWxzZSBpZiAoc3RhdGUuZmllbGQuZG93biA9PT0gNCkge1xuICAgIHBvc3Nlc3Npb25GbGlwcGVkID0gdHJ1ZTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJfT05fRE9XTlNcIiB9KTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcImRvd25zXCIgfSk7XG4gIH0gZWxzZSB7XG4gICAgbmV4dERvd24gPSAoc3RhdGUuZmllbGQuZG93biArIDEpIGFzIDEgfCAyIHwgMyB8IDQ7XG4gIH1cblxuICBjb25zdCBtaXJyb3JlZEJhbGxPbiA9IHBvc3Nlc3Npb25GbGlwcGVkID8gMTAwIC0gcHJvamVjdGVkIDogcHJvamVjdGVkO1xuICBjb25zdCBwbGF5ZXJzID0gcG9zc2Vzc2lvbkZsaXBwZWRcbiAgICA/IGJ1bXBTdGF0cyhzdGF0ZS5wbGF5ZXJzLCBvZmZlbnNlLCB7IHR1cm5vdmVyczogMSB9KVxuICAgIDogc3RhdGUucGxheWVycztcblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBsYXllcnMsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IG1pcnJvcmVkQmFsbE9uLFxuICAgICAgICBmaXJzdERvd25BdDogcG9zc2Vzc2lvbkZsaXBwZWRcbiAgICAgICAgICA/IE1hdGgubWluKDEwMCwgbWlycm9yZWRCYWxsT24gKyAxMClcbiAgICAgICAgICA6IG5leHRGaXJzdERvd25BdCxcbiAgICAgICAgZG93bjogcG9zc2Vzc2lvbkZsaXBwZWQgPyAxIDogbmV4dERvd24sXG4gICAgICAgIG9mZmVuc2U6IHBvc3Nlc3Npb25GbGlwcGVkID8gb3BwKG9mZmVuc2UpIDogb2ZmZW5zZSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBSZWd1bGFyLXBsYXkgcmVzb2x1dGlvbi4gU3BlY2lhbCBwbGF5cyAoVFAsIEhNLCBGRywgUFVOVCwgVFdPX1BUKSBicmFuY2hcbiAqIGVsc2V3aGVyZSBcdTIwMTQgc2VlIHJ1bGVzL3NwZWNpYWwudHMgKFRPRE8pLlxuICpcbiAqIEdpdmVuIHR3byBwaWNrcyAob2ZmZW5zZSArIGRlZmVuc2UpIGFuZCB0aGUgY3VycmVudCBzdGF0ZSwgcHJvZHVjZSBhIG5ld1xuICogc3RhdGUgYW5kIHRoZSBldmVudCBzdHJlYW0gZm9yIHRoZSBwbGF5LlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBQbGF5Q2FsbCwgUmVndWxhclBsYXkgfSBmcm9tIFwiLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IGRyYXdNdWx0aXBsaWVyLCBkcmF3WWFyZHMgfSBmcm9tIFwiLi9kZWNrLmpzXCI7XG5pbXBvcnQgeyBjb21wdXRlWWFyZGFnZSB9IGZyb20gXCIuL3lhcmRhZ2UuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi9zdGF0ZS5qc1wiO1xuaW1wb3J0IHsgYnVtcFN0YXRzIH0gZnJvbSBcIi4vc3BlY2lhbHMvc2hhcmVkLmpzXCI7XG5cbmNvbnN0IFJFR1VMQVI6IFJlYWRvbmx5U2V0PFBsYXlDYWxsPiA9IG5ldyBTZXQoW1wiU1JcIiwgXCJMUlwiLCBcIlNQXCIsIFwiTFBcIl0pO1xuXG5leHBvcnQgZnVuY3Rpb24gaXNSZWd1bGFyUGxheShwOiBQbGF5Q2FsbCk6IHAgaXMgUmVndWxhclBsYXkge1xuICByZXR1cm4gUkVHVUxBUi5oYXMocCk7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVzb2x2ZUlucHV0IHtcbiAgb2ZmZW5zZVBsYXk6IFBsYXlDYWxsO1xuICBkZWZlbnNlUGxheTogUGxheUNhbGw7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGxheVJlc29sdXRpb24ge1xuICBzdGF0ZTogR2FtZVN0YXRlO1xuICBldmVudHM6IEV2ZW50W107XG59XG5cbi8qKlxuICogUmVzb2x2ZSBhIHJlZ3VsYXIgdnMgcmVndWxhciBwbGF5LiBDYWxsZXIgKHRoZSByZWR1Y2VyKSByb3V0ZXMgdG8gc3BlY2lhbFxuICogcGxheSBoYW5kbGVycyBpZiBlaXRoZXIgcGljayBpcyBub24tcmVndWxhci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVSZWd1bGFyUGxheShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgaW5wdXQ6IFJlc29sdmVJbnB1dCxcbiAgcm5nOiBSbmcsXG4pOiBQbGF5UmVzb2x1dGlvbiB7XG4gIGlmICghaXNSZWd1bGFyUGxheShpbnB1dC5vZmZlbnNlUGxheSkgfHwgIWlzUmVndWxhclBsYXkoaW5wdXQuZGVmZW5zZVBsYXkpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwicmVzb2x2ZVJlZ3VsYXJQbGF5IGNhbGxlZCB3aXRoIGEgbm9uLXJlZ3VsYXIgcGxheVwiKTtcbiAgfVxuXG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuXG4gIC8vIERyYXcgY2FyZHMuXG4gIGNvbnN0IG11bHREcmF3ID0gZHJhd011bHRpcGxpZXIoc3RhdGUuZGVjaywgcm5nKTtcbiAgaWYgKG11bHREcmF3LnJlc2h1ZmZsZWQpIHtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcIm11bHRpcGxpZXJcIiB9KTtcbiAgfVxuICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMobXVsdERyYXcuZGVjaywgcm5nKTtcbiAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSB7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuICB9XG5cbiAgLy8gQ29tcHV0ZSB5YXJkYWdlLlxuICBjb25zdCBvdXRjb21lID0gY29tcHV0ZVlhcmRhZ2Uoe1xuICAgIG9mZmVuc2U6IGlucHV0Lm9mZmVuc2VQbGF5LFxuICAgIGRlZmVuc2U6IGlucHV0LmRlZmVuc2VQbGF5LFxuICAgIG11bHRpcGxpZXJDYXJkOiBtdWx0RHJhdy5pbmRleCxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICB9KTtcblxuICAvLyBEZWNyZW1lbnQgb2ZmZW5zZSdzIGhhbmQgZm9yIHRoZSBwbGF5IHRoZXkgdXNlZC4gUmVmaWxsIGF0IHplcm8gXHUyMDE0IHRoZVxuICAvLyBleGFjdCAxMi1jYXJkIHJlc2h1ZmZsZSBiZWhhdmlvciBsaXZlcyBpbiBgZGVjcmVtZW50SGFuZGAuXG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBsZXQgbmV3UGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtvZmZlbnNlXTogZGVjcmVtZW50SGFuZChzdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLCBpbnB1dC5vZmZlbnNlUGxheSksXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcblxuICAvLyBTdGF0czogcGFzcyB2cyBydW4gYnkgcGxheSB0eXBlLiBTUC9MUCBjYXJyeSBwYXNzWWFyZHMgKHdpdGggbmVnYXRpdmVcbiAgLy8geWFyZGFnZSBvbiBhIHBhc3MgPSBzYWNrKS4gU1IvTFIgY2FycnkgcnVzaFlhcmRzLlxuICBjb25zdCBpc1Bhc3MgPSBpbnB1dC5vZmZlbnNlUGxheSA9PT0gXCJTUFwiIHx8IGlucHV0Lm9mZmVuc2VQbGF5ID09PSBcIkxQXCI7XG4gIGNvbnN0IHN0YXREZWx0YSA9IGlzUGFzc1xuICAgID8ge1xuICAgICAgICBwYXNzWWFyZHM6IG91dGNvbWUueWFyZHNHYWluZWQsXG4gICAgICAgIHNhY2tzOiBvdXRjb21lLnlhcmRzR2FpbmVkIDwgMCA/IDEgOiAwLFxuICAgICAgfVxuICAgIDogeyBydXNoWWFyZHM6IG91dGNvbWUueWFyZHNHYWluZWQgfTtcbiAgbmV3UGxheWVycyA9IGJ1bXBTdGF0cyhuZXdQbGF5ZXJzLCBvZmZlbnNlLCBzdGF0RGVsdGEpO1xuXG4gIC8vIEFwcGx5IHlhcmRhZ2UgdG8gYmFsbCBwb3NpdGlvbi4gQ2xhbXAgYXQgMTAwIChURCkgYW5kIDAgKHNhZmV0eSkuXG4gIGNvbnN0IHByb2plY3RlZCA9IHN0YXRlLmZpZWxkLmJhbGxPbiArIG91dGNvbWUueWFyZHNHYWluZWQ7XG4gIGxldCBuZXdCYWxsT24gPSBwcm9qZWN0ZWQ7XG4gIGxldCBzY29yZWQ6IFwidGRcIiB8IFwic2FmZXR5XCIgfCBudWxsID0gbnVsbDtcbiAgaWYgKHByb2plY3RlZCA+PSAxMDApIHtcbiAgICBuZXdCYWxsT24gPSAxMDA7XG4gICAgc2NvcmVkID0gXCJ0ZFwiO1xuICB9IGVsc2UgaWYgKHByb2plY3RlZCA8PSAwKSB7XG4gICAgbmV3QmFsbE9uID0gMDtcbiAgICBzY29yZWQgPSBcInNhZmV0eVwiO1xuICB9XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgIG9mZmVuc2VQbGF5OiBpbnB1dC5vZmZlbnNlUGxheSxcbiAgICBkZWZlbnNlUGxheTogaW5wdXQuZGVmZW5zZVBsYXksXG4gICAgbWF0Y2h1cFF1YWxpdHk6IG91dGNvbWUubWF0Y2h1cFF1YWxpdHksXG4gICAgbXVsdGlwbGllcjogeyBjYXJkOiBvdXRjb21lLm11bHRpcGxpZXJDYXJkTmFtZSwgdmFsdWU6IG91dGNvbWUubXVsdGlwbGllciB9LFxuICAgIHlhcmRzQ2FyZDogeWFyZHNEcmF3LmNhcmQsXG4gICAgeWFyZHNHYWluZWQ6IG91dGNvbWUueWFyZHNHYWluZWQsXG4gICAgbmV3QmFsbE9uLFxuICB9KTtcblxuICAvLyBTY29yZSBoYW5kbGluZy5cbiAgaWYgKHNjb3JlZCA9PT0gXCJ0ZFwiKSB7XG4gICAgcmV0dXJuIHRvdWNoZG93blN0YXRlKFxuICAgICAgeyAuLi5zdGF0ZSwgZGVjazogeWFyZHNEcmF3LmRlY2ssIHBsYXllcnM6IG5ld1BsYXllcnMsIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSB9LFxuICAgICAgb2ZmZW5zZSxcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG4gIGlmIChzY29yZWQgPT09IFwic2FmZXR5XCIpIHtcbiAgICByZXR1cm4gc2FmZXR5U3RhdGUoXG4gICAgICB7IC4uLnN0YXRlLCBkZWNrOiB5YXJkc0RyYXcuZGVjaywgcGxheWVyczogbmV3UGxheWVycywgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpIH0sXG4gICAgICBvZmZlbnNlLFxuICAgICAgZXZlbnRzLFxuICAgICk7XG4gIH1cblxuICAvLyBEb3duL2Rpc3RhbmNlIGhhbmRsaW5nLlxuICBjb25zdCByZWFjaGVkRmlyc3REb3duID0gbmV3QmFsbE9uID49IHN0YXRlLmZpZWxkLmZpcnN0RG93bkF0O1xuICBsZXQgbmV4dERvd24gPSBzdGF0ZS5maWVsZC5kb3duO1xuICBsZXQgbmV4dEZpcnN0RG93bkF0ID0gc3RhdGUuZmllbGQuZmlyc3REb3duQXQ7XG4gIGxldCBwb3NzZXNzaW9uRmxpcHBlZCA9IGZhbHNlO1xuXG4gIGlmIChyZWFjaGVkRmlyc3REb3duKSB7XG4gICAgbmV4dERvd24gPSAxO1xuICAgIG5leHRGaXJzdERvd25BdCA9IE1hdGgubWluKDEwMCwgbmV3QmFsbE9uICsgMTApO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJGSVJTVF9ET1dOXCIgfSk7XG4gIH0gZWxzZSBpZiAoc3RhdGUuZmllbGQuZG93biA9PT0gNCkge1xuICAgIC8vIFR1cm5vdmVyIG9uIGRvd25zIFx1MjAxNCBwb3NzZXNzaW9uIGZsaXBzLCBiYWxsIHN0YXlzLlxuICAgIG5leHREb3duID0gMTtcbiAgICBwb3NzZXNzaW9uRmxpcHBlZCA9IHRydWU7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSX09OX0RPV05TXCIgfSk7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJkb3duc1wiIH0pO1xuICAgIG5ld1BsYXllcnMgPSBidW1wU3RhdHMobmV3UGxheWVycywgb2ZmZW5zZSwgeyB0dXJub3ZlcnM6IDEgfSk7XG4gIH0gZWxzZSB7XG4gICAgbmV4dERvd24gPSAoc3RhdGUuZmllbGQuZG93biArIDEpIGFzIDEgfCAyIHwgMyB8IDQ7XG4gIH1cblxuICBjb25zdCBuZXh0T2ZmZW5zZSA9IHBvc3Nlc3Npb25GbGlwcGVkID8gb3BwKG9mZmVuc2UpIDogb2ZmZW5zZTtcbiAgY29uc3QgbmV4dEJhbGxPbiA9IHBvc3Nlc3Npb25GbGlwcGVkID8gMTAwIC0gbmV3QmFsbE9uIDogbmV3QmFsbE9uO1xuICBjb25zdCBuZXh0Rmlyc3REb3duID0gcG9zc2Vzc2lvbkZsaXBwZWRcbiAgICA/IE1hdGgubWluKDEwMCwgbmV4dEJhbGxPbiArIDEwKVxuICAgIDogbmV4dEZpcnN0RG93bkF0O1xuXG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgZGVjazogeWFyZHNEcmF3LmRlY2ssXG4gICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgYmFsbE9uOiBuZXh0QmFsbE9uLFxuICAgICAgICBmaXJzdERvd25BdDogbmV4dEZpcnN0RG93bixcbiAgICAgICAgZG93bjogbmV4dERvd24sXG4gICAgICAgIG9mZmVuc2U6IG5leHRPZmZlbnNlLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gYmxhbmtQaWNrKCk6IEdhbWVTdGF0ZVtcInBlbmRpbmdQaWNrXCJdIHtcbiAgcmV0dXJuIHsgb2ZmZW5zZVBsYXk6IG51bGwsIGRlZmVuc2VQbGF5OiBudWxsIH07XG59XG5cbi8qKlxuICogVG91Y2hkb3duIGJvb2trZWVwaW5nIFx1MjAxNCA2IHBvaW50cywgdHJhbnNpdGlvbiB0byBQQVRfQ0hPSUNFIHBoYXNlLlxuICogKFBBVC8ycHQgcmVzb2x1dGlvbiBhbmQgZW5zdWluZyBraWNrb2ZmIGhhcHBlbiBpbiBzdWJzZXF1ZW50IGFjdGlvbnMuKVxuICovXG5mdW5jdGlvbiB0b3VjaGRvd25TdGF0ZShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgc2NvcmVyOiBHYW1lU3RhdGVbXCJmaWVsZFwiXVtcIm9mZmVuc2VcIl0sXG4gIGV2ZW50czogRXZlbnRbXSxcbik6IFBsYXlSZXNvbHV0aW9uIHtcbiAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtzY29yZXJdOiB7IC4uLnN0YXRlLnBsYXllcnNbc2NvcmVyXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbc2NvcmVyXS5zY29yZSArIDYgfSxcbiAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiVE9VQ0hET1dOXCIsIHNjb3JpbmdQbGF5ZXI6IHNjb3JlciB9KTtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZTogeyAuLi5zdGF0ZSwgcGxheWVyczogbmV3UGxheWVycywgcGhhc2U6IFwiUEFUX0NIT0lDRVwiIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG4vKipcbiAqIFNhZmV0eSBcdTIwMTQgZGVmZW5zZSBzY29yZXMgMiwgb2ZmZW5zZSBraWNrcyBmcmVlIGtpY2suXG4gKiBGb3IgdGhlIHNrZXRjaCB3ZSBzY29yZSBhbmQgZW1pdDsgdGhlIGtpY2tvZmYgdHJhbnNpdGlvbiBpcyBUT0RPLlxuICovXG5mdW5jdGlvbiBzYWZldHlTdGF0ZShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgY29uY2VkZXI6IEdhbWVTdGF0ZVtcImZpZWxkXCJdW1wib2ZmZW5zZVwiXSxcbiAgZXZlbnRzOiBFdmVudFtdLFxuKTogUGxheVJlc29sdXRpb24ge1xuICBjb25zdCBzY29yZXIgPSBvcHAoY29uY2VkZXIpO1xuICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgW3Njb3Jlcl06IHsgLi4uc3RhdGUucGxheWVyc1tzY29yZXJdLCBzY29yZTogc3RhdGUucGxheWVyc1tzY29yZXJdLnNjb3JlICsgMiB9LFxuICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJTQUZFVFlcIiwgc2NvcmluZ1BsYXllcjogc2NvcmVyIH0pO1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7IC4uLnN0YXRlLCBwbGF5ZXJzOiBuZXdQbGF5ZXJzLCBwaGFzZTogXCJLSUNLT0ZGXCIgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbi8qKlxuICogRGVjcmVtZW50IHRoZSBjaG9zZW4gcGxheSBpbiBhIHBsYXllcidzIGhhbmQuIElmIHRoZSByZWd1bGFyLXBsYXkgY2FyZHNcbiAqIChTUi9MUi9TUC9MUCkgYXJlIGFsbCBleGhhdXN0ZWQsIHJlZmlsbCB0aGVtIFx1MjAxNCBIYWlsIE1hcnkgY291bnQgaXNcbiAqIHByZXNlcnZlZCBhY3Jvc3MgcmVmaWxscyAobWF0Y2hlcyB2NS4xIFBsYXllci5maWxsUGxheXMoJ3AnKSkuXG4gKi9cbmZ1bmN0aW9uIGRlY3JlbWVudEhhbmQoXG4gIHBsYXllcjogR2FtZVN0YXRlW1wicGxheWVyc1wiXVsxXSxcbiAgcGxheTogUGxheUNhbGwsXG4pOiBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdWzFdIHtcbiAgY29uc3QgaGFuZCA9IHsgLi4ucGxheWVyLmhhbmQgfTtcblxuICBpZiAocGxheSA9PT0gXCJITVwiKSB7XG4gICAgaGFuZC5ITSA9IE1hdGgubWF4KDAsIGhhbmQuSE0gLSAxKTtcbiAgICByZXR1cm4geyAuLi5wbGF5ZXIsIGhhbmQgfTtcbiAgfVxuXG4gIGlmIChwbGF5ID09PSBcIkZHXCIgfHwgcGxheSA9PT0gXCJQVU5UXCIgfHwgcGxheSA9PT0gXCJUV09fUFRcIikge1xuICAgIC8vIE5vIGNhcmQgY29uc3VtZWQgXHUyMDE0IHRoZXNlIGFyZSBzaXR1YXRpb25hbCBkZWNpc2lvbnMsIG5vdCBkcmF3cy5cbiAgICByZXR1cm4gcGxheWVyO1xuICB9XG5cbiAgaGFuZFtwbGF5XSA9IE1hdGgubWF4KDAsIGhhbmRbcGxheV0gLSAxKTtcblxuICAvLyB2NS4xIDEyLWNhcmQgcmVzaHVmZmxlOiB3aGVuIHRoZSAxMiByZWd1bGFyLXBsYXkgY2FyZHMgKFNSL0xSL1NQL0xQLFxuICAvLyAzIGVhY2gpIGFyZSBhbGwgZXhoYXVzdGVkLCByZWZpbGwgdGhlbS4gVFAgaXMgdHJhY2tlZCBzZXBhcmF0ZWx5XG4gIC8vIHdpdGggMSBjYXJkIHBlciBzaHVmZmxlOyBpdCByZWZpbGxzIG9uIHRoZSBzYW1lIHRyaWdnZXIgdG8gYXZvaWRcbiAgLy8gYW4gb3JwaGFuZWQtVFAgc3RhdGUgKGhhbmQ9WzAsMCwwLDAsMV0pIHdoZXJlIHRoZSBDUFUgaXMgZm9yY2VkXG4gIC8vIHRvIHBpY2sgVFAgZXZlcnkgcGxheS5cbiAgY29uc3QgcmVndWxhcnNFeGhhdXN0ZWQgPVxuICAgIGhhbmQuU1IgPT09IDAgJiYgaGFuZC5MUiA9PT0gMCAmJiBoYW5kLlNQID09PSAwICYmIGhhbmQuTFAgPT09IDA7XG5cbiAgaWYgKHJlZ3VsYXJzRXhoYXVzdGVkKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLnBsYXllcixcbiAgICAgIGhhbmQ6IHsgU1I6IDMsIExSOiAzLCBTUDogMywgTFA6IDMsIFRQOiAxLCBITTogaGFuZC5ITSB9LFxuICAgIH07XG4gIH1cblxuICByZXR1cm4geyAuLi5wbGF5ZXIsIGhhbmQgfTtcbn1cbiIsICIvKipcbiAqIEJpZyBQbGF5IHJlc29sdXRpb24gKHJ1bi5qczoxOTMzKS5cbiAqXG4gKiBUcmlnZ2VyZWQgYnk6XG4gKiAgIC0gVHJpY2sgUGxheSBkaWU9NVxuICogICAtIFNhbWUgUGxheSBLaW5nIG91dGNvbWVcbiAqICAgLSBPdGhlciBmdXR1cmUgaG9va3NcbiAqXG4gKiBUaGUgYmVuZWZpY2lhcnkgYXJndW1lbnQgc2F5cyB3aG8gYmVuZWZpdHMgXHUyMDE0IHRoaXMgY2FuIGJlIG9mZmVuc2UgT1JcbiAqIGRlZmVuc2UgKGRpZmZlcmVudCBvdXRjb21lIHRhYmxlcykuXG4gKlxuICogT2ZmZW5zaXZlIEJpZyBQbGF5IChvZmZlbnNlIGJlbmVmaXRzKTpcbiAqICAgZGllIDEtMyBcdTIxOTIgKzI1IHlhcmRzXG4gKiAgIGRpZSA0LTUgXHUyMTkyIG1heChoYWxmLXRvLWdvYWwsIDQwKSB5YXJkc1xuICogICBkaWUgNiAgIFx1MjE5MiBUb3VjaGRvd25cbiAqXG4gKiBEZWZlbnNpdmUgQmlnIFBsYXkgKGRlZmVuc2UgYmVuZWZpdHMpOlxuICogICBkaWUgMS0zIFx1MjE5MiAxMC15YXJkIHBlbmFsdHkgb24gb2ZmZW5zZSAocmVwZWF0IGRvd24pLCBoYWxmLXRvLWdvYWwgaWYgdGlnaHRcbiAqICAgZGllIDQtNSBcdTIxOTIgRlVNQkxFIFx1MjE5MiB0dXJub3ZlciArIGRlZmVuc2UgcmV0dXJucyBtYXgoaGFsZiwgMjUpXG4gKiAgIGRpZSA2ICAgXHUyMTkyIEZVTUJMRSBcdTIxOTIgZGVmZW5zaXZlIFREXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIFBsYXllcklkIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7XG4gIGFwcGx5U2FmZXR5LFxuICBhcHBseVRvdWNoZG93bixcbiAgYmxhbmtQaWNrLFxuICBidW1wU3RhdHMsXG4gIHR5cGUgU3BlY2lhbFJlc29sdXRpb24sXG59IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUJpZ1BsYXkoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIGJlbmVmaWNpYXJ5OiBQbGF5ZXJJZCxcbiAgcm5nOiBSbmcsXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBkaWUgPSBybmcuZDYoKTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW3sgdHlwZTogXCJCSUdfUExBWVwiLCBiZW5lZmljaWFyeSwgc3Vicm9sbDogZGllIH1dO1xuXG4gIGlmIChiZW5lZmljaWFyeSA9PT0gb2ZmZW5zZSkge1xuICAgIHJldHVybiBvZmZlbnNpdmVCaWdQbGF5KHN0YXRlLCBvZmZlbnNlLCBkaWUsIGV2ZW50cyk7XG4gIH1cbiAgcmV0dXJuIGRlZmVuc2l2ZUJpZ1BsYXkoc3RhdGUsIG9mZmVuc2UsIGRpZSwgZXZlbnRzKTtcbn1cblxuZnVuY3Rpb24gb2ZmZW5zaXZlQmlnUGxheShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgb2ZmZW5zZTogUGxheWVySWQsXG4gIGRpZTogMSB8IDIgfCAzIHwgNCB8IDUgfCA2LFxuICBldmVudHM6IEV2ZW50W10sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGlmIChkaWUgPT09IDYpIHtcbiAgICByZXR1cm4gYXBwbHlUb3VjaGRvd24oc3RhdGUsIG9mZmVuc2UsIGV2ZW50cyk7XG4gIH1cblxuICAvLyBkaWUgMS0zOiArMjU7IGRpZSA0LTU6IG1heChoYWxmLXRvLWdvYWwsIDQwKVxuICBsZXQgZ2FpbjogbnVtYmVyO1xuICBpZiAoZGllIDw9IDMpIHtcbiAgICBnYWluID0gMjU7XG4gIH0gZWxzZSB7XG4gICAgY29uc3QgaGFsZlRvR29hbCA9IE1hdGgucm91bmQoKDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbikgLyAyKTtcbiAgICBnYWluID0gaGFsZlRvR29hbCA+IDQwID8gaGFsZlRvR29hbCA6IDQwO1xuICB9XG5cbiAgY29uc3QgcHJvamVjdGVkID0gc3RhdGUuZmllbGQuYmFsbE9uICsgZ2FpbjtcbiAgaWYgKHByb2plY3RlZCA+PSAxMDApIHtcbiAgICByZXR1cm4gYXBwbHlUb3VjaGRvd24oc3RhdGUsIG9mZmVuc2UsIGV2ZW50cyk7XG4gIH1cblxuICAvLyBBcHBseSBnYWluLCBjaGVjayBmb3IgZmlyc3QgZG93bi5cbiAgY29uc3QgcmVhY2hlZEZpcnN0RG93biA9IHByb2plY3RlZCA+PSBzdGF0ZS5maWVsZC5maXJzdERvd25BdDtcbiAgY29uc3QgbmV4dERvd24gPSByZWFjaGVkRmlyc3REb3duID8gMSA6IHN0YXRlLmZpZWxkLmRvd247XG4gIGNvbnN0IG5leHRGaXJzdERvd25BdCA9IHJlYWNoZWRGaXJzdERvd25cbiAgICA/IE1hdGgubWluKDEwMCwgcHJvamVjdGVkICsgMTApXG4gICAgOiBzdGF0ZS5maWVsZC5maXJzdERvd25BdDtcblxuICBpZiAocmVhY2hlZEZpcnN0RG93bikgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkZJUlNUX0RPV05cIiB9KTtcblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIC4uLnN0YXRlLmZpZWxkLFxuICAgICAgICBiYWxsT246IHByb2plY3RlZCxcbiAgICAgICAgZG93bjogbmV4dERvd24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBuZXh0Rmlyc3REb3duQXQsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG5mdW5jdGlvbiBkZWZlbnNpdmVCaWdQbGF5KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBvZmZlbnNlOiBQbGF5ZXJJZCxcbiAgZGllOiAxIHwgMiB8IDMgfCA0IHwgNSB8IDYsXG4gIGV2ZW50czogRXZlbnRbXSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgLy8gMS0zOiAxMC15YXJkIHBlbmFsdHksIHJlcGVhdCBkb3duIChubyBkb3duIGNvbnN1bWVkKS5cbiAgaWYgKGRpZSA8PSAzKSB7XG4gICAgY29uc3QgbmFpdmVQZW5hbHR5ID0gLTEwO1xuICAgIGNvbnN0IGhhbGZUb0dvYWwgPSAtTWF0aC5mbG9vcihzdGF0ZS5maWVsZC5iYWxsT24gLyAyKTtcbiAgICBjb25zdCBwZW5hbHR5WWFyZHMgPVxuICAgICAgc3RhdGUuZmllbGQuYmFsbE9uIC0gMTAgPCAxID8gaGFsZlRvR29hbCA6IG5haXZlUGVuYWx0eTtcblxuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJQRU5BTFRZXCIsIGFnYWluc3Q6IG9mZmVuc2UsIHlhcmRzOiBwZW5hbHR5WWFyZHMsIGxvc3NPZkRvd246IGZhbHNlIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIC4uLnN0YXRlLmZpZWxkLFxuICAgICAgICAgIGJhbGxPbjogTWF0aC5tYXgoMCwgc3RhdGUuZmllbGQuYmFsbE9uICsgcGVuYWx0eVlhcmRzKSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIDQtNTogdHVybm92ZXIgd2l0aCByZXR1cm4gb2YgbWF4KGhhbGYsIDI1KS4gNjogZGVmZW5zaXZlIFRELlxuICBjb25zdCBkZWZlbmRlciA9IG9wcChvZmZlbnNlKTtcblxuICBpZiAoZGllID09PSA2KSB7XG4gICAgLy8gRGVmZW5zZSBzY29yZXMgdGhlIFRELlxuICAgIGxldCBuZXdQbGF5ZXJzID0ge1xuICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgIFtkZWZlbmRlcl06IHsgLi4uc3RhdGUucGxheWVyc1tkZWZlbmRlcl0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW2RlZmVuZGVyXS5zY29yZSArIDYgfSxcbiAgICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gICAgbmV3UGxheWVycyA9IGJ1bXBTdGF0cyhuZXdQbGF5ZXJzLCBvZmZlbnNlLCB7IHR1cm5vdmVyczogMSB9KTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcImZ1bWJsZVwiIH0pO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUT1VDSERPV05cIiwgc2NvcmluZ1BsYXllcjogZGVmZW5kZXIgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIHBoYXNlOiBcIlBBVF9DSE9JQ0VcIixcbiAgICAgICAgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IGRlZmVuZGVyIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBkaWUgNC01OiB0dXJub3ZlciB3aXRoIHJldHVybi5cbiAgY29uc3QgaGFsZlRvR29hbCA9IE1hdGgucm91bmQoKDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbikgLyAyKTtcbiAgY29uc3QgcmV0dXJuWWFyZHMgPSBoYWxmVG9Hb2FsID4gMjUgPyBoYWxmVG9Hb2FsIDogMjU7XG5cbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJmdW1ibGVcIiB9KTtcbiAgY29uc3QgcGxheWVyc0FmdGVyVHVybm92ZXIgPSBidW1wU3RhdHMoc3RhdGUucGxheWVycywgb2ZmZW5zZSwgeyB0dXJub3ZlcnM6IDEgfSk7XG5cbiAgLy8gRi01MCBmaWRlbGl0eTogdjUuMSBzdG9yZXMgYGRpc3QgPSByZXR1cm5ZYXJkc2AgdGhlbiBjYWxscyBjaGFuZ2VQb3NzKCd0bycpLFxuICAvLyB3aGljaCBtaXJyb3JzIHRoZSBiYWxsIHRvIGRlZmVuZGVyIFBPVi4gVGhlIHJldHVybiBpcyB0aGVuIGFwcGxpZWRcbiAgLy8gZm9yd2FyZCBpbiBkZWZlbmRlciBQT1YgKGBzcG90ICs9IGRpc3RgKS4gRXF1aXZhbGVudDogZGVmZW5kZXIgc3RhcnRzIGF0XG4gIC8vIGAxMDAgLSBiYWxsT25gICh0aGVpciBvd24gUE9WKSBhbmQgYWR2YW5jZXMgYHJldHVybllhcmRzYCB0b3dhcmQgdGhlaXIgZ29hbC5cbiAgY29uc3QgbmV3T2ZmZW5zZVN0YXJ0ID0gMTAwIC0gc3RhdGUuZmllbGQuYmFsbE9uO1xuICBjb25zdCBmaW5hbEJhbGxPbiA9IG5ld09mZmVuc2VTdGFydCArIHJldHVybllhcmRzO1xuXG4gIGlmIChmaW5hbEJhbGxPbiA+PSAxMDApIHtcbiAgICAvLyBSZXR1cm5lZCBhbGwgdGhlIHdheSBcdTIwMTQgVEQgZm9yIGRlZmVuZGVyLlxuICAgIGNvbnN0IHBsYXllcnNXaXRoU2NvcmUgPSB7XG4gICAgICAuLi5wbGF5ZXJzQWZ0ZXJUdXJub3ZlcixcbiAgICAgIFtkZWZlbmRlcl06IHsgLi4ucGxheWVyc0FmdGVyVHVybm92ZXJbZGVmZW5kZXJdLCBzY29yZTogcGxheWVyc0FmdGVyVHVybm92ZXJbZGVmZW5kZXJdLnNjb3JlICsgNiB9LFxuICAgIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVE9VQ0hET1dOXCIsIHNjb3JpbmdQbGF5ZXI6IGRlZmVuZGVyIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGxheWVyczogcGxheWVyc1dpdGhTY29yZSxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBwaGFzZTogXCJQQVRfQ0hPSUNFXCIsXG4gICAgICAgIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiBkZWZlbmRlciB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG4gIGlmIChmaW5hbEJhbGxPbiA8PSAwKSB7XG4gICAgcmV0dXJuIGFwcGx5U2FmZXR5KHsgLi4uc3RhdGUsIHBsYXllcnM6IHBsYXllcnNBZnRlclR1cm5vdmVyIH0sIG9mZmVuc2UsIGV2ZW50cyk7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBsYXllcnM6IHBsYXllcnNBZnRlclR1cm5vdmVyLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgYmFsbE9uOiBmaW5hbEJhbGxPbixcbiAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgZmluYWxCYWxsT24gKyAxMCksXG4gICAgICAgIGRvd246IDEsXG4gICAgICAgIG9mZmVuc2U6IGRlZmVuZGVyLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cbiIsICIvKipcbiAqIFB1bnQgKHJ1bi5qczoyMDkwKS4gQWxzbyBzZXJ2ZXMgZm9yIHNhZmV0eSBraWNrcy5cbiAqXG4gKiBTZXF1ZW5jZSAoYWxsIHJhbmRvbW5lc3MgdGhyb3VnaCBybmcpOlxuICogICAxLiBCbG9jayBjaGVjazogaWYgaW5pdGlhbCBkNiBpcyA2LCByb2xsIGFnYWluIFx1MjAxNCAyLXNpeGVzID0gYmxvY2tlZCAoMS8zNikuXG4gKiAgIDIuIElmIG5vdCBibG9ja2VkLCBkcmF3IHlhcmRzIGNhcmQgKyBjb2luIGZsaXA6XG4gKiAgICAgICAga2lja0Rpc3QgPSAxMCAqIHlhcmRzQ2FyZCAvIDIgKyAyMCAqIChjb2luPWhlYWRzID8gMSA6IDApXG4gKiAgICAgIFJlc3VsdGluZyByYW5nZTogWzUsIDcwXSB5YXJkcy5cbiAqICAgMy4gSWYgYmFsbCBsYW5kcyBwYXN0IDEwMCBcdTIxOTIgdG91Y2hiYWNrLCBwbGFjZSBhdCByZWNlaXZlcidzIDIwLlxuICogICA0LiBNdWZmIGNoZWNrIChub3Qgb24gdG91Y2hiYWNrL2Jsb2NrL3NhZmV0eSBraWNrKTogMi1zaXhlcyA9IHJlY2VpdmVyXG4gKiAgICAgIG11ZmZzLCBraWNraW5nIHRlYW0gcmVjb3ZlcnMuXG4gKiAgIDUuIFJldHVybjogaWYgcG9zc2Vzc2lvbiwgZHJhdyBtdWx0Q2FyZCArIHlhcmRzLlxuICogICAgICAgIEtpbmc9N3gsIFF1ZWVuPTR4LCBKYWNrPTF4LCAxMD0tMC41eFxuICogICAgICAgIHJldHVybiA9IHJvdW5kKG11bHQgKiB5YXJkc0NhcmQpXG4gKiAgICAgIFJldHVybiBjYW4gc2NvcmUgVEQgb3IgY29uY2VkZSBzYWZldHkuXG4gKlxuICogRm9yIHRoZSBlbmdpbmUgcG9ydDogdGhpcyBpcyB0aGUgbW9zdCBwcm9jZWR1cmFsIG9mIHRoZSBzcGVjaWFscy4gV2VcbiAqIGNvbGxlY3QgZXZlbnRzIGluIG9yZGVyIGFuZCBwcm9kdWNlIG9uZSBmaW5hbCBzdGF0ZS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4uLy4uL3N0YXRlLmpzXCI7XG5pbXBvcnQgeyBkcmF3TXVsdGlwbGllciwgZHJhd1lhcmRzIH0gZnJvbSBcIi4uL2RlY2suanNcIjtcbmltcG9ydCB7XG4gIGFwcGx5U2FmZXR5LFxuICBhcHBseVRvdWNoZG93bixcbiAgYmxhbmtQaWNrLFxuICBidW1wU3RhdHMsXG4gIHR5cGUgU3BlY2lhbFJlc29sdXRpb24sXG59IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5jb25zdCBSRVRVUk5fTVVMVElQTElFUlM6IFJlY29yZDxcIktpbmdcIiB8IFwiUXVlZW5cIiB8IFwiSmFja1wiIHwgXCIxMFwiLCBudW1iZXI+ID0ge1xuICBLaW5nOiA3LFxuICBRdWVlbjogNCxcbiAgSmFjazogMSxcbiAgXCIxMFwiOiAtMC41LFxufTtcblxuZXhwb3J0IGludGVyZmFjZSBQdW50T3B0aW9ucyB7XG4gIC8qKiB0cnVlIGlmIHRoaXMgaXMgYSBzYWZldHkga2ljayAobm8gYmxvY2svbXVmZiBjaGVja3MpLiAqL1xuICBzYWZldHlLaWNrPzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVQdW50KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBybmc6IFJuZyxcbiAgb3B0czogUHVudE9wdGlvbnMgPSB7fSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGRlZmVuZGVyID0gb3BwKG9mZmVuc2UpO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcbiAgbGV0IGRlY2sgPSBzdGF0ZS5kZWNrO1xuXG4gIC8vIEJsb2NrIGNoZWNrIChub3Qgb24gc2FmZXR5IGtpY2spLlxuICBsZXQgYmxvY2tlZCA9IGZhbHNlO1xuICBpZiAoIW9wdHMuc2FmZXR5S2ljaykge1xuICAgIGlmIChybmcuZDYoKSA9PT0gNiAmJiBybmcuZDYoKSA9PT0gNikge1xuICAgICAgYmxvY2tlZCA9IHRydWU7XG4gICAgfVxuICB9XG5cbiAgaWYgKGJsb2NrZWQpIHtcbiAgICAvLyBLaWNraW5nIHRlYW0gbG9zZXMgcG9zc2Vzc2lvbiBhdCB0aGUgbGluZSBvZiBzY3JpbW1hZ2UuXG4gICAgY29uc3QgbWlycm9yZWRCYWxsT24gPSAxMDAgLSBzdGF0ZS5maWVsZC5iYWxsT247XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlBVTlRcIiwgcGxheWVyOiBvZmZlbnNlLCBsYW5kaW5nU3BvdDogc3RhdGUuZmllbGQuYmFsbE9uIH0pO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiZnVtYmxlXCIgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwbGF5ZXJzOiBidW1wU3RhdHMoc3RhdGUucGxheWVycywgb2ZmZW5zZSwgeyB0dXJub3ZlcnM6IDEgfSksXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICBiYWxsT246IG1pcnJvcmVkQmFsbE9uLFxuICAgICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIG1pcnJvcmVkQmFsbE9uICsgMTApLFxuICAgICAgICAgIGRvd246IDEsXG4gICAgICAgICAgb2ZmZW5zZTogZGVmZW5kZXIsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBEcmF3IHlhcmRzICsgY29pbiBmb3Iga2ljayBkaXN0YW5jZS5cbiAgY29uc3QgY29pbiA9IHJuZy5jb2luRmxpcCgpO1xuICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMoZGVjaywgcm5nKTtcbiAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG4gIGRlY2sgPSB5YXJkc0RyYXcuZGVjaztcblxuICBjb25zdCBraWNrRGlzdCA9ICgxMCAqIHlhcmRzRHJhdy5jYXJkKSAvIDIgKyAoY29pbiA9PT0gXCJoZWFkc1wiID8gMjAgOiAwKTtcbiAgY29uc3QgbGFuZGluZ1Nwb3QgPSBzdGF0ZS5maWVsZC5iYWxsT24gKyBraWNrRGlzdDtcbiAgY29uc3QgdG91Y2hiYWNrID0gbGFuZGluZ1Nwb3QgPiAxMDA7XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJQVU5UXCIsIHBsYXllcjogb2ZmZW5zZSwgbGFuZGluZ1Nwb3QgfSk7XG5cbiAgLy8gTXVmZiBjaGVjayAobm90IG9uIHRvdWNoYmFjaywgYmxvY2ssIHNhZmV0eSBraWNrKS5cbiAgbGV0IG11ZmZlZCA9IGZhbHNlO1xuICBpZiAoIXRvdWNoYmFjayAmJiAhb3B0cy5zYWZldHlLaWNrKSB7XG4gICAgaWYgKHJuZy5kNigpID09PSA2ICYmIHJuZy5kNigpID09PSA2KSB7XG4gICAgICBtdWZmZWQgPSB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIGlmIChtdWZmZWQpIHtcbiAgICAvLyBSZWNlaXZlciBtdWZmcywga2lja2luZyB0ZWFtIHJlY292ZXJzIHdoZXJlIHRoZSBiYWxsIGxhbmRlZC5cbiAgICAvLyBLaWNraW5nIHRlYW0gcmV0YWlucyBwb3NzZXNzaW9uIFx1MjAxNCBwb3NzZXNzaW9uIGRvZXMgTk9UIGNoYW5nZSwgc28gdGhpc1xuICAgIC8vIGlzIG5vdCBhIHR1cm5vdmVyIGZvciB0aGUgcHJldmlvdXMgb2ZmZW5zZSAoZG9uJ3QgZW1pdCBUVVJOT1ZFUiBhbmRcbiAgICAvLyBkb24ndCBidW1wIHR1cm5vdmVyIHN0YXRzKS4gVGhlIHJlY2VpdmVyJ3MgbWlzcGxheSBpcyBsb2dnZWQgYXMgYVxuICAgIC8vIFBVTlRfTVVGRkVEIGV2ZW50IHNvIGNvbnN1bWVycyBjYW4gc3RpbGwgc3VyZmFjZSBpdC5cbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiUFVOVF9NVUZGRURcIiwgcmVjb3ZlcmluZ1BsYXllcjogb2ZmZW5zZSB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIGRlY2ssXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICBiYWxsT246IE1hdGgubWluKDk5LCBsYW5kaW5nU3BvdCksXG4gICAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgbGFuZGluZ1Nwb3QgKyAxMCksXG4gICAgICAgICAgZG93bjogMSxcbiAgICAgICAgICBvZmZlbnNlLCAvLyBraWNrZXIgcmV0YWluc1xuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gVG91Y2hiYWNrOiByZWNlaXZlciBnZXRzIGJhbGwgYXQgdGhlaXIgb3duIDIwICg9IDgwIGZyb20gdGhlaXIgcGVyc3BlY3RpdmUsXG4gIC8vIGJ1dCBiYWxsIHBvc2l0aW9uIGlzIHRyYWNrZWQgZnJvbSBvZmZlbnNlIFBPViwgc28gZm9yIHRoZSBORVcgb2ZmZW5zZSB0aGF0XG4gIC8vIGlzIDEwMC04MCA9IDIwKS5cbiAgaWYgKHRvdWNoYmFjaykge1xuICAgIGNvbnN0IHN0YXRlQWZ0ZXJLaWNrOiBHYW1lU3RhdGUgPSB7IC4uLnN0YXRlLCBkZWNrIH07XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlQWZ0ZXJLaWNrLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgYmFsbE9uOiAyMCxcbiAgICAgICAgICBmaXJzdERvd25BdDogMzAsXG4gICAgICAgICAgZG93bjogMSxcbiAgICAgICAgICBvZmZlbnNlOiBkZWZlbmRlcixcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIE5vcm1hbCBwdW50IHJldHVybjogZHJhdyBtdWx0Q2FyZCArIHlhcmRzLiBSZXR1cm4gbWVhc3VyZWQgZnJvbSBsYW5kaW5nU3BvdC5cbiAgY29uc3QgbXVsdERyYXcgPSBkcmF3TXVsdGlwbGllcihkZWNrLCBybmcpO1xuICBpZiAobXVsdERyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJtdWx0aXBsaWVyXCIgfSk7XG4gIGRlY2sgPSBtdWx0RHJhdy5kZWNrO1xuXG4gIGNvbnN0IHJldHVybkRyYXcgPSBkcmF3WWFyZHMoZGVjaywgcm5nKTtcbiAgaWYgKHJldHVybkRyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuICBkZWNrID0gcmV0dXJuRHJhdy5kZWNrO1xuXG4gIGNvbnN0IG11bHQgPSBSRVRVUk5fTVVMVElQTElFUlNbbXVsdERyYXcuY2FyZF07XG4gIGNvbnN0IHJldHVybllhcmRzID0gTWF0aC5yb3VuZChtdWx0ICogcmV0dXJuRHJhdy5jYXJkKTtcblxuICAvLyBCYWxsIGVuZHMgdXAgYXQgbGFuZGluZ1Nwb3QgLSByZXR1cm5ZYXJkcyAoZnJvbSBraWNraW5nIHRlYW0ncyBQT1YpLlxuICAvLyBFcXVpdmFsZW50bHksIGZyb20gdGhlIHJlY2VpdmluZyB0ZWFtJ3MgUE9WOiAoMTAwIC0gbGFuZGluZ1Nwb3QpICsgcmV0dXJuWWFyZHMuXG4gIGNvbnN0IHJlY2VpdmVyQmFsbE9uID0gMTAwIC0gbGFuZGluZ1Nwb3QgKyByZXR1cm5ZYXJkcztcblxuICBjb25zdCBzdGF0ZUFmdGVyUmV0dXJuOiBHYW1lU3RhdGUgPSB7IC4uLnN0YXRlLCBkZWNrIH07XG5cbiAgLy8gUmV0dXJuIFREIFx1MjAxNCByZWNlaXZlciBzY29yZXMuXG4gIGlmIChyZWNlaXZlckJhbGxPbiA+PSAxMDApIHtcbiAgICBjb25zdCByZWNlaXZlckJhbGxDbGFtcGVkID0gMTAwO1xuICAgIHZvaWQgcmVjZWl2ZXJCYWxsQ2xhbXBlZDtcbiAgICByZXR1cm4gYXBwbHlUb3VjaGRvd24oXG4gICAgICB7IC4uLnN0YXRlQWZ0ZXJSZXR1cm4sIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiBkZWZlbmRlciB9IH0sXG4gICAgICBkZWZlbmRlcixcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgLy8gUmV0dXJuIHNhZmV0eSBcdTIwMTQgcmVjZWl2ZXIgdGFja2xlZCBpbiB0aGVpciBvd24gZW5kem9uZSAoY2FuJ3QgYWN0dWFsbHlcbiAgLy8gaGFwcGVuIGZyb20gYSBuZWdhdGl2ZS1yZXR1cm4teWFyZGFnZSBzdGFuZHBvaW50IGluIHY1LjEgc2luY2Ugc3RhcnQgaXNcbiAgLy8gMTAwLWxhbmRpbmdTcG90IHdoaWNoIGlzID4gMCwgYnV0IG1vZGVsIGl0IGFueXdheSBmb3IgY29tcGxldGVuZXNzKS5cbiAgaWYgKHJlY2VpdmVyQmFsbE9uIDw9IDApIHtcbiAgICByZXR1cm4gYXBwbHlTYWZldHkoXG4gICAgICB7IC4uLnN0YXRlQWZ0ZXJSZXR1cm4sIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiBkZWZlbmRlciB9IH0sXG4gICAgICBkZWZlbmRlcixcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGVBZnRlclJldHVybixcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogcmVjZWl2ZXJCYWxsT24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIHJlY2VpdmVyQmFsbE9uICsgMTApLFxuICAgICAgICBkb3duOiAxLFxuICAgICAgICBvZmZlbnNlOiBkZWZlbmRlcixcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBLaWNrb2ZmLiB2NiByZXN0b3JlcyB2NS4xJ3Mga2ljay10eXBlIC8gcmV0dXJuLXR5cGUgcGlja3MuXG4gKlxuICogVGhlIGtpY2tlciAoc3RhdGUuZmllbGQub2ZmZW5zZSkgY2hvb3NlcyBvbmUgb2Y6XG4gKiAgIFJLIFx1MjAxNCBSZWd1bGFyIEtpY2s6IGxvbmcga2ljaywgbXVsdCt5YXJkcyByZXR1cm5cbiAqICAgT0sgXHUyMDE0IE9uc2lkZSBLaWNrOiAgc2hvcnQga2ljaywgMS1pbi02IHJlY292ZXJ5IHJvbGwgKDEtaW4tMTIgdnMgT1IpXG4gKiAgIFNLIFx1MjAxNCBTcXVpYiBLaWNrOiAgIG1lZGl1bSBraWNrLCAyZDYgcmV0dXJuIGlmIHJlY2VpdmVyIGNob3NlIFJSXG4gKlxuICogVGhlIHJldHVybmVyIGNob29zZXMgb25lIG9mOlxuICogICBSUiBcdTIwMTQgUmVndWxhciBSZXR1cm46IG5vcm1hbCByZXR1cm5cbiAqICAgT1IgXHUyMDE0IE9uc2lkZSBjb3VudGVyOiBkZWZlbmRzIHRoZSBvbnNpZGUgKGhhcmRlciBmb3Iga2lja2VyIHRvIHJlY292ZXIpXG4gKiAgIFRCIFx1MjAxNCBUb3VjaGJhY2s6ICAgICAgdGFrZSB0aGUgYmFsbCBhdCB0aGUgMjVcbiAqXG4gKiBTYWZldHkga2lja3MgKHN0YXRlLmlzU2FmZXR5S2ljaz10cnVlKSBza2lwIHRoZSBwaWNrcyBhbmQgdXNlIHRoZVxuICogZXhpc3Rpbmcgc2ltcGxpZmllZCBwdW50IHBhdGguXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIEtpY2tUeXBlLCBSZXR1cm5UeXBlIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7IGRyYXdNdWx0aXBsaWVyLCBkcmF3WWFyZHMgfSBmcm9tIFwiLi4vZGVjay5qc1wiO1xuaW1wb3J0IHsgcmVzb2x2ZVB1bnQgfSBmcm9tIFwiLi9wdW50LmpzXCI7XG5pbXBvcnQge1xuICBhcHBseVNhZmV0eSxcbiAgYXBwbHlUb3VjaGRvd24sXG4gIGJsYW5rUGljayxcbiAgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbixcbn0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmNvbnN0IEtJQ0tPRkZfTVVMVElQTElFUlM6IFJlY29yZDxcIktpbmdcIiB8IFwiUXVlZW5cIiB8IFwiSmFja1wiIHwgXCIxMFwiLCBudW1iZXI+ID0ge1xuICBLaW5nOiAxMCxcbiAgUXVlZW46IDUsXG4gIEphY2s6IDEsXG4gIFwiMTBcIjogMCxcbn07XG5cbmV4cG9ydCBpbnRlcmZhY2UgS2lja29mZk9wdGlvbnMge1xuICBraWNrVHlwZT86IEtpY2tUeXBlO1xuICByZXR1cm5UeXBlPzogUmV0dXJuVHlwZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVLaWNrb2ZmKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBybmc6IFJuZyxcbiAgb3B0czogS2lja29mZk9wdGlvbnMgPSB7fSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qga2lja2VyID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgcmVjZWl2ZXIgPSBvcHAoa2lja2VyKTtcblxuICAvLyBTYWZldHkta2ljayBwYXRoOiB2NS4xIGNhcnZlLW91dCB0cmVhdHMgaXQgbGlrZSBhIHB1bnQgZnJvbSB0aGUgMzUuXG4gIC8vIE5vIHBpY2tzIGFyZSBwcm9tcHRlZCBmb3IsIHNvIGBraWNrVHlwZWAgd2lsbCBiZSB1bmRlZmluZWQgaGVyZS5cbiAgaWYgKHN0YXRlLmlzU2FmZXR5S2ljayB8fCAhb3B0cy5raWNrVHlwZSkge1xuICAgIGNvbnN0IGtpY2tpbmdTdGF0ZTogR2FtZVN0YXRlID0ge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgYmFsbE9uOiAzNSB9LFxuICAgIH07XG4gICAgY29uc3QgcmVzdWx0ID0gcmVzb2x2ZVB1bnQoa2lja2luZ1N0YXRlLCBybmcsIHsgc2FmZXR5S2ljazogdHJ1ZSB9KTtcbiAgICAvLyBGLTU0OiBhIHJldHVybiBURCBvbiB0aGUgc2FmZXR5IGtpY2sgbWVhbnMgcmVzb2x2ZVB1bnQgc2V0IHBoYXNlIHRvXG4gICAgLy8gUEFUX0NIT0lDRSB2aWEgYXBwbHlUb3VjaGRvd24uIFByZXNlcnZlIHNjb3JpbmcgcGhhc2VzOyBvbmx5IGZhbGxcbiAgICAvLyB0aHJvdWdoIHRvIFJFR19QTEFZIHdoZW4gdGhlIGtpY2sgcHJvZHVjZWQgYSBub3JtYWwgbmV3IHBvc3Nlc3Npb24uXG4gICAgY29uc3QgcHJlc2VydmUgPSByZXN1bHQuc3RhdGUucGhhc2UgPT09IFwiUEFUX0NIT0lDRVwiIHx8XG4gICAgICByZXN1bHQuc3RhdGUucGhhc2UgPT09IFwiVFdPX1BUX0NPTlZcIjtcbiAgICBjb25zdCBwaGFzZSA9IHByZXNlcnZlID8gcmVzdWx0LnN0YXRlLnBoYXNlIDogXCJSRUdfUExBWVwiO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZTogeyAuLi5yZXN1bHQuc3RhdGUsIHBoYXNlLCBpc1NhZmV0eUtpY2s6IGZhbHNlIH0sXG4gICAgICBldmVudHM6IHJlc3VsdC5ldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIGNvbnN0IHsga2lja1R5cGUsIHJldHVyblR5cGUgfSA9IG9wdHM7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiS0lDS19UWVBFX0NIT1NFTlwiLCBwbGF5ZXI6IGtpY2tlciwgY2hvaWNlOiBraWNrVHlwZSB9KTtcbiAgaWYgKHJldHVyblR5cGUpIHtcbiAgICBldmVudHMucHVzaCh7XG4gICAgICB0eXBlOiBcIlJFVFVSTl9UWVBFX0NIT1NFTlwiLFxuICAgICAgcGxheWVyOiByZWNlaXZlcixcbiAgICAgIGNob2ljZTogcmV0dXJuVHlwZSxcbiAgICB9KTtcbiAgfVxuXG4gIGlmIChraWNrVHlwZSA9PT0gXCJSS1wiKSB7XG4gICAgcmV0dXJuIHJlc29sdmVSZWd1bGFyS2ljayhzdGF0ZSwgcm5nLCBldmVudHMsIGtpY2tlciwgcmVjZWl2ZXIsIHJldHVyblR5cGUpO1xuICB9XG4gIGlmIChraWNrVHlwZSA9PT0gXCJPS1wiKSB7XG4gICAgcmV0dXJuIHJlc29sdmVPbnNpZGVLaWNrKHN0YXRlLCBybmcsIGV2ZW50cywga2lja2VyLCByZWNlaXZlciwgcmV0dXJuVHlwZSk7XG4gIH1cbiAgcmV0dXJuIHJlc29sdmVTcXVpYktpY2soc3RhdGUsIHJuZywgZXZlbnRzLCBraWNrZXIsIHJlY2VpdmVyLCByZXR1cm5UeXBlKTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZVJlZ3VsYXJLaWNrKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBybmc6IFJuZyxcbiAgZXZlbnRzOiBFdmVudFtdLFxuICBraWNrZXI6IEdhbWVTdGF0ZVtcImZpZWxkXCJdW1wib2ZmZW5zZVwiXSxcbiAgcmVjZWl2ZXI6IEdhbWVTdGF0ZVtcImZpZWxkXCJdW1wib2ZmZW5zZVwiXSxcbiAgcmV0dXJuVHlwZTogUmV0dXJuVHlwZSB8IHVuZGVmaW5lZCxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgLy8gUmV0dXJuZXIgY2hvc2UgdG91Y2hiYWNrIChvciBtaXNtYXRjaGVkIE9SKTogYmFsbCBhdCB0aGUgcmVjZWl2ZXIncyAyNS5cbiAgaWYgKHJldHVyblR5cGUgPT09IFwiVEJcIiB8fCByZXR1cm5UeXBlID09PSBcIk9SXCIpIHtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVE9VQ0hCQUNLXCIsIHJlY2VpdmluZ1BsYXllcjogcmVjZWl2ZXIgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwaGFzZTogXCJSRUdfUExBWVwiLFxuICAgICAgICBpc1NhZmV0eUtpY2s6IGZhbHNlLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgYmFsbE9uOiAyNSxcbiAgICAgICAgICBmaXJzdERvd25BdDogMzUsXG4gICAgICAgICAgZG93bjogMSxcbiAgICAgICAgICBvZmZlbnNlOiByZWNlaXZlcixcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIFJLICsgUlI6IGtpY2sgZGlzdGFuY2UgMzUuLjYwLCB0aGVuIG11bHQreWFyZHMgcmV0dXJuLlxuICBjb25zdCBraWNrUm9sbCA9IHJuZy5kNigpO1xuICBjb25zdCBraWNrWWFyZHMgPSAzNSArIDUgKiAoa2lja1JvbGwgLSAxKTsgLy8gMzUsIDQwLCA0NSwgNTAsIDU1LCA2MCBcdTIwMTQgMzUuLjYwXG4gIGNvbnN0IGtpY2tFbmRGcm9tS2lja2VyID0gMzUgKyBraWNrWWFyZHM7IC8vIDcwLi45NSwgYm91bmRlZCB0byAxMDBcbiAgY29uc3QgYm91bmRlZEVuZCA9IE1hdGgubWluKDEwMCwga2lja0VuZEZyb21LaWNrZXIpO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiS0lDS09GRlwiLCByZWNlaXZpbmdQbGF5ZXI6IHJlY2VpdmVyLCBiYWxsT246IGJvdW5kZWRFbmQsIGtpY2tSb2xsLCBraWNrWWFyZHMgfSk7XG5cbiAgLy8gUmVjZWl2ZXIncyBzdGFydGluZyBiYWxsT24gKHBvc3Nlc3Npb24gZmxpcHBlZCkuXG4gIGNvbnN0IHJlY2VpdmVyU3RhcnQgPSAxMDAgLSBib3VuZGVkRW5kOyAvLyAwLi4zMFxuXG4gIGxldCBkZWNrID0gc3RhdGUuZGVjaztcbiAgY29uc3QgbXVsdERyYXcgPSBkcmF3TXVsdGlwbGllcihkZWNrLCBybmcpO1xuICBpZiAobXVsdERyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJtdWx0aXBsaWVyXCIgfSk7XG4gIGRlY2sgPSBtdWx0RHJhdy5kZWNrO1xuXG4gIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhkZWNrLCBybmcpO1xuICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcbiAgZGVjayA9IHlhcmRzRHJhdy5kZWNrO1xuXG4gIGNvbnN0IG11bHQgPSBLSUNLT0ZGX01VTFRJUExJRVJTW211bHREcmF3LmNhcmRdO1xuICBjb25zdCByZXRZYXJkcyA9IG11bHQgKiB5YXJkc0RyYXcuY2FyZDtcbiAgaWYgKHJldFlhcmRzICE9PSAwKSB7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIktJQ0tPRkZfUkVUVVJOXCIsIHJldHVybmVyUGxheWVyOiByZWNlaXZlciwgeWFyZHM6IHJldFlhcmRzIH0pO1xuICB9XG5cbiAgY29uc3QgZmluYWxCYWxsT24gPSByZWNlaXZlclN0YXJ0ICsgcmV0WWFyZHM7XG5cbiAgaWYgKGZpbmFsQmFsbE9uID49IDEwMCkge1xuICAgIHJldHVybiBhcHBseVRvdWNoZG93bihcbiAgICAgIHsgLi4uc3RhdGUsIGRlY2ssIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiByZWNlaXZlciB9LCBpc1NhZmV0eUtpY2s6IGZhbHNlIH0sXG4gICAgICByZWNlaXZlcixcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG4gIGlmIChmaW5hbEJhbGxPbiA8PSAwKSB7XG4gICAgLy8gUmV0dXJuIGJhY2t3YXJkIGludG8gb3duIGVuZCB6b25lIFx1MjAxNCB1bmxpa2VseSB3aXRoIHY1LjEgbXVsdGlwbGllcnMgYnV0IG1vZGVsIGl0LlxuICAgIHJldHVybiBhcHBseVNhZmV0eShcbiAgICAgIHsgLi4uc3RhdGUsIGRlY2ssIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiByZWNlaXZlciB9LCBpc1NhZmV0eUtpY2s6IGZhbHNlIH0sXG4gICAgICByZWNlaXZlcixcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBkZWNrLFxuICAgICAgcGhhc2U6IFwiUkVHX1BMQVlcIixcbiAgICAgIGlzU2FmZXR5S2ljazogZmFsc2UsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IGZpbmFsQmFsbE9uLFxuICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBmaW5hbEJhbGxPbiArIDEwKSxcbiAgICAgICAgZG93bjogMSxcbiAgICAgICAgb2ZmZW5zZTogcmVjZWl2ZXIsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG5mdW5jdGlvbiByZXNvbHZlT25zaWRlS2ljayhcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgcm5nOiBSbmcsXG4gIGV2ZW50czogRXZlbnRbXSxcbiAga2lja2VyOiBHYW1lU3RhdGVbXCJmaWVsZFwiXVtcIm9mZmVuc2VcIl0sXG4gIHJlY2VpdmVyOiBHYW1lU3RhdGVbXCJmaWVsZFwiXVtcIm9mZmVuc2VcIl0sXG4gIHJldHVyblR5cGU6IFJldHVyblR5cGUgfCB1bmRlZmluZWQsXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIC8vIFJldHVybmVyJ3MgT1IgY2hvaWNlIGNvcnJlY3RseSByZWFkcyB0aGUgb25zaWRlIFx1MjAxNCBtYWtlcyByZWNvdmVyeSBoYXJkZXIuXG4gIGNvbnN0IG9kZHMgPSByZXR1cm5UeXBlID09PSBcIk9SXCIgPyAxMiA6IDY7XG4gIGNvbnN0IHRtcCA9IHJuZy5pbnRCZXR3ZWVuKDEsIG9kZHMpO1xuICBjb25zdCByZWNvdmVyZWQgPSB0bXAgPT09IDE7XG4gIGNvbnN0IGtpY2tZYXJkcyA9IDEwICsgdG1wOyAvLyBzaG9ydCBraWNrIDExLi4xNiAob3IgMTEuLjIyIHZzIE9SKVxuICBjb25zdCBraWNrRW5kID0gMzUgKyBraWNrWWFyZHM7XG5cbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIktJQ0tPRkZcIiwgcmVjZWl2aW5nUGxheWVyOiByZWNlaXZlciwgYmFsbE9uOiBraWNrRW5kLCBraWNrUm9sbDogdG1wLCBraWNrWWFyZHMgfSk7XG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIk9OU0lERV9LSUNLXCIsXG4gICAgcmVjb3ZlcmVkLFxuICAgIHJlY292ZXJpbmdQbGF5ZXI6IHJlY292ZXJlZCA/IGtpY2tlciA6IHJlY2VpdmVyLFxuICAgIHJvbGw6IHRtcCxcbiAgICBvZGRzLFxuICB9KTtcblxuICBjb25zdCByZXR1cm5Sb2xsID0gcm5nLmQ2KCkgKyB0bXA7IC8vIHY1LjE6IHRtcCArIGQ2XG5cbiAgaWYgKHJlY292ZXJlZCkge1xuICAgIC8vIEtpY2tlciByZXRhaW5zLiB2NS4xIGZsaXBzIHJldHVybiBkaXJlY3Rpb24gXHUyMDE0IG1vZGVscyBcImtpY2tlciByZWNvdmVyc1xuICAgIC8vIHNsaWdodGx5IGJhY2sgb2YgdGhlIGtpY2sgc3BvdC5cIlxuICAgIGNvbnN0IGtpY2tlckJhbGxPbiA9IE1hdGgubWF4KDEsIGtpY2tFbmQgLSByZXR1cm5Sb2xsKTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBoYXNlOiBcIlJFR19QTEFZXCIsXG4gICAgICAgIGlzU2FmZXR5S2ljazogZmFsc2UsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICBiYWxsT246IGtpY2tlckJhbGxPbixcbiAgICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBraWNrZXJCYWxsT24gKyAxMCksXG4gICAgICAgICAgZG93bjogMSxcbiAgICAgICAgICBvZmZlbnNlOiBraWNrZXIsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBSZWNlaXZlciByZWNvdmVycyBhdCB0aGUga2ljayBzcG90LCByZXR1cm5zIGZvcndhcmQuXG4gIGNvbnN0IHJlY2VpdmVyU3RhcnQgPSAxMDAgLSBraWNrRW5kO1xuICBjb25zdCBmaW5hbEJhbGxPbiA9IHJlY2VpdmVyU3RhcnQgKyByZXR1cm5Sb2xsO1xuICBpZiAocmV0dXJuUm9sbCAhPT0gMCkge1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJLSUNLT0ZGX1JFVFVSTlwiLCByZXR1cm5lclBsYXllcjogcmVjZWl2ZXIsIHlhcmRzOiByZXR1cm5Sb2xsIH0pO1xuICB9XG5cbiAgaWYgKGZpbmFsQmFsbE9uID49IDEwMCkge1xuICAgIHJldHVybiBhcHBseVRvdWNoZG93bihcbiAgICAgIHsgLi4uc3RhdGUsIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiByZWNlaXZlciB9LCBpc1NhZmV0eUtpY2s6IGZhbHNlIH0sXG4gICAgICByZWNlaXZlcixcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwaGFzZTogXCJSRUdfUExBWVwiLFxuICAgICAgaXNTYWZldHlLaWNrOiBmYWxzZSxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogZmluYWxCYWxsT24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIGZpbmFsQmFsbE9uICsgMTApLFxuICAgICAgICBkb3duOiAxLFxuICAgICAgICBvZmZlbnNlOiByZWNlaXZlcixcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVTcXVpYktpY2soXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHJuZzogUm5nLFxuICBldmVudHM6IEV2ZW50W10sXG4gIGtpY2tlcjogR2FtZVN0YXRlW1wiZmllbGRcIl1bXCJvZmZlbnNlXCJdLFxuICByZWNlaXZlcjogR2FtZVN0YXRlW1wiZmllbGRcIl1bXCJvZmZlbnNlXCJdLFxuICByZXR1cm5UeXBlOiBSZXR1cm5UeXBlIHwgdW5kZWZpbmVkLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBraWNrUm9sbCA9IHJuZy5kNigpO1xuICBjb25zdCBraWNrWWFyZHMgPSAxNSArIDUgKiBraWNrUm9sbDsgLy8gMjAuLjQ1XG4gIGNvbnN0IGtpY2tFbmQgPSBNYXRoLm1pbigxMDAsIDM1ICsga2lja1lhcmRzKTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIktJQ0tPRkZcIiwgcmVjZWl2aW5nUGxheWVyOiByZWNlaXZlciwgYmFsbE9uOiBraWNrRW5kLCBraWNrUm9sbCwga2lja1lhcmRzIH0pO1xuXG4gIC8vIE9ubHkgcmV0dXJuYWJsZSBpZiByZWNlaXZlciBjaG9zZSBSUjsgb3RoZXJ3aXNlIG5vIHJldHVybi5cbiAgY29uc3QgcmV0WWFyZHMgPSByZXR1cm5UeXBlID09PSBcIlJSXCIgPyBybmcuZDYoKSArIHJuZy5kNigpIDogMDtcbiAgaWYgKHJldFlhcmRzID4gMCkge1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJLSUNLT0ZGX1JFVFVSTlwiLCByZXR1cm5lclBsYXllcjogcmVjZWl2ZXIsIHlhcmRzOiByZXRZYXJkcyB9KTtcbiAgfVxuXG4gIGNvbnN0IHJlY2VpdmVyU3RhcnQgPSAxMDAgLSBraWNrRW5kO1xuICBjb25zdCBmaW5hbEJhbGxPbiA9IHJlY2VpdmVyU3RhcnQgKyByZXRZYXJkcztcblxuICBpZiAoZmluYWxCYWxsT24gPj0gMTAwKSB7XG4gICAgcmV0dXJuIGFwcGx5VG91Y2hkb3duKFxuICAgICAgeyAuLi5zdGF0ZSwgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IHJlY2VpdmVyIH0sIGlzU2FmZXR5S2ljazogZmFsc2UgfSxcbiAgICAgIHJlY2VpdmVyLFxuICAgICAgZXZlbnRzLFxuICAgICk7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBoYXNlOiBcIlJFR19QTEFZXCIsXG4gICAgICBpc1NhZmV0eUtpY2s6IGZhbHNlLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgYmFsbE9uOiBmaW5hbEJhbGxPbixcbiAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgZmluYWxCYWxsT24gKyAxMCksXG4gICAgICAgIGRvd246IDEsXG4gICAgICAgIG9mZmVuc2U6IHJlY2VpdmVyLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cbiIsICIvKipcbiAqIEhhaWwgTWFyeSBvdXRjb21lcyAocnVuLmpzOjIyNDIpLiBEaWUgdmFsdWUgXHUyMTkyIHJlc3VsdCwgZnJvbSBvZmZlbnNlJ3MgUE9WOlxuICogICAxIFx1MjE5MiBCSUcgU0FDSywgLTEwIHlhcmRzXG4gKiAgIDIgXHUyMTkyICsyMCB5YXJkc1xuICogICAzIFx1MjE5MiAgIDAgeWFyZHNcbiAqICAgNCBcdTIxOTIgKzQwIHlhcmRzXG4gKiAgIDUgXHUyMTkyIElOVEVSQ0VQVElPTiAodHVybm92ZXIgYXQgc3BvdClcbiAqICAgNiBcdTIxOTIgVE9VQ0hET1dOXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi8uLi9zdGF0ZS5qc1wiO1xuaW1wb3J0IHtcbiAgYXBwbHlTYWZldHksXG4gIGFwcGx5VG91Y2hkb3duLFxuICBhcHBseVlhcmRhZ2VPdXRjb21lLFxuICBibGFua1BpY2ssXG4gIGJ1bXBTdGF0cyxcbiAgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbixcbn0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlSGFpbE1hcnkoc3RhdGU6IEdhbWVTdGF0ZSwgcm5nOiBSbmcpOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBkaWUgPSBybmcuZDYoKTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW3sgdHlwZTogXCJIQUlMX01BUllfUk9MTFwiLCBvdXRjb21lOiBkaWUgfV07XG5cbiAgLy8gRGVjcmVtZW50IEhNIGNvdW50IHJlZ2FyZGxlc3Mgb2Ygb3V0Y29tZS5cbiAgbGV0IHVwZGF0ZWRQbGF5ZXJzID0ge1xuICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgW29mZmVuc2VdOiB7XG4gICAgICAuLi5zdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLFxuICAgICAgaGFuZDogeyAuLi5zdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLmhhbmQsIEhNOiBNYXRoLm1heCgwLCBzdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLmhhbmQuSE0gLSAxKSB9LFxuICAgIH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcblxuICAvLyBJbnRlcmNlcHRpb24gKGRpZSA1KSBcdTIwMTQgdHVybm92ZXIgYXQgdGhlIHNwb3QsIHBvc3Nlc3Npb24gZmxpcHMuXG4gIGlmIChkaWUgPT09IDUpIHtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcImludGVyY2VwdGlvblwiIH0pO1xuICAgIHVwZGF0ZWRQbGF5ZXJzID0gYnVtcFN0YXRzKHVwZGF0ZWRQbGF5ZXJzLCBvZmZlbnNlLCB7IHR1cm5vdmVyczogMSB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBsYXllcnM6IHVwZGF0ZWRQbGF5ZXJzLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgLi4uc3RhdGUuZmllbGQsXG4gICAgICAgICAgb2ZmZW5zZTogb3BwKG9mZmVuc2UpLFxuICAgICAgICAgIGJhbGxPbjogMTAwIC0gc3RhdGUuZmllbGQuYmFsbE9uLFxuICAgICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbiArIDEwKSxcbiAgICAgICAgICBkb3duOiAxLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gWWFyZGFnZSBvdXRjb21lcyAoZGllIDEtNCwgNikgXHUyMDE0IHBhc3MgeWFyZHMgcmVnYXJkbGVzcyBvZiBURC9zYWZldHkuXG4gIGNvbnN0IHlhcmRzID0gZGllID09PSAxID8gLTEwIDogZGllID09PSAyID8gMjAgOiBkaWUgPT09IDMgPyAwIDogZGllID09PSA0ID8gNDAgOiAwO1xuICAvLyBTYWNrOiBITSBkaWU9MSA9IC0xMCB5ZHMsIGNvdW50IGFzIGEgc2FjayBvbiB0aGUgb2ZmZW5zZS5cbiAgdXBkYXRlZFBsYXllcnMgPSBidW1wU3RhdHModXBkYXRlZFBsYXllcnMsIG9mZmVuc2UsIHtcbiAgICBwYXNzWWFyZHM6IGRpZSA9PT0gNiA/IDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbiA6IHlhcmRzLFxuICAgIHNhY2tzOiBkaWUgPT09IDEgPyAxIDogMCxcbiAgfSk7XG4gIGNvbnN0IHN0YXRlV2l0aEhtOiBHYW1lU3RhdGUgPSB7IC4uLnN0YXRlLCBwbGF5ZXJzOiB1cGRhdGVkUGxheWVycyB9O1xuXG4gIC8vIFRvdWNoZG93biAoZGllIDYpLlxuICBpZiAoZGllID09PSA2KSB7XG4gICAgcmV0dXJuIGFwcGx5VG91Y2hkb3duKHN0YXRlV2l0aEhtLCBvZmZlbnNlLCBldmVudHMpO1xuICB9XG5cbiAgY29uc3QgcHJvamVjdGVkID0gc3RhdGVXaXRoSG0uZmllbGQuYmFsbE9uICsgeWFyZHM7XG5cbiAgaWYgKHByb2plY3RlZCA+PSAxMDApIHJldHVybiBhcHBseVRvdWNoZG93bihzdGF0ZVdpdGhIbSwgb2ZmZW5zZSwgZXZlbnRzKTtcbiAgaWYgKHByb2plY3RlZCA8PSAwKSByZXR1cm4gYXBwbHlTYWZldHkoc3RhdGVXaXRoSG0sIG9mZmVuc2UsIGV2ZW50cyk7XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgIG9mZmVuc2VQbGF5OiBcIkhNXCIsXG4gICAgZGVmZW5zZVBsYXk6IHN0YXRlLnBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5ID8/IFwiU1JcIixcbiAgICBtYXRjaHVwUXVhbGl0eTogMCxcbiAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IFwiMTBcIiwgdmFsdWU6IDAgfSxcbiAgICB5YXJkc0NhcmQ6IDAsXG4gICAgeWFyZHNHYWluZWQ6IHlhcmRzLFxuICAgIG5ld0JhbGxPbjogcHJvamVjdGVkLFxuICB9KTtcblxuICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShzdGF0ZVdpdGhIbSwgeWFyZHMsIGV2ZW50cyk7XG59XG4iLCAiLyoqXG4gKiBTYW1lIFBsYXkgbWVjaGFuaXNtIChydW4uanM6MTg5OSkuXG4gKlxuICogVHJpZ2dlcmVkIHdoZW4gYm90aCB0ZWFtcyBwaWNrIHRoZSBzYW1lIHJlZ3VsYXIgcGxheSBBTkQgYSBjb2luLWZsaXAgbGFuZHNcbiAqIGhlYWRzIChhbHNvIHVuY29uZGl0aW9uYWxseSB3aGVuIGJvdGggcGljayBUcmljayBQbGF5KS4gUnVucyBpdHMgb3duXG4gKiBjb2luICsgbXVsdGlwbGllci1jYXJkIGNoYWluOlxuICpcbiAqICAgbXVsdENhcmQgPSBLaW5nICBcdTIxOTIgQmlnIFBsYXkgKG9mZmVuc2UgaWYgY29pbj1oZWFkcywgZGVmZW5zZSBpZiB0YWlscylcbiAqICAgbXVsdENhcmQgPSBRdWVlbiArIGhlYWRzIFx1MjE5MiBtdWx0aXBsaWVyID0gKzMsIGRyYXcgeWFyZHMgY2FyZFxuICogICBtdWx0Q2FyZCA9IFF1ZWVuICsgdGFpbHMgXHUyMTkyIG11bHRpcGxpZXIgPSAgMCwgbm8geWFyZHMgKGRpc3QgPSAwKVxuICogICBtdWx0Q2FyZCA9IEphY2sgICsgaGVhZHMgXHUyMTkyIG11bHRpcGxpZXIgPSAgMCwgbm8geWFyZHMgKGRpc3QgPSAwKVxuICogICBtdWx0Q2FyZCA9IEphY2sgICsgdGFpbHMgXHUyMTkyIG11bHRpcGxpZXIgPSAtMywgZHJhdyB5YXJkcyBjYXJkXG4gKiAgIG11bHRDYXJkID0gMTAgICAgKyBoZWFkcyBcdTIxOTIgSU5URVJDRVBUSU9OICh0dXJub3ZlciBhdCBzcG90KVxuICogICBtdWx0Q2FyZCA9IDEwICAgICsgdGFpbHMgXHUyMTkyIDAgeWFyZHNcbiAqXG4gKiBOb3RlOiB0aGUgY29pbiBmbGlwIGluc2lkZSB0aGlzIGZ1bmN0aW9uIGlzIGEgU0VDT05EIGNvaW4gZmxpcCBcdTIwMTQgdGhlXG4gKiBtZWNoYW5pc20tdHJpZ2dlciBjb2luIGZsaXAgaXMgaGFuZGxlZCBieSB0aGUgcmVkdWNlciBiZWZvcmUgY2FsbGluZyBoZXJlLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7IGRyYXdNdWx0aXBsaWVyLCBkcmF3WWFyZHMgfSBmcm9tIFwiLi4vZGVjay5qc1wiO1xuaW1wb3J0IHsgcmVzb2x2ZUJpZ1BsYXkgfSBmcm9tIFwiLi9iaWdQbGF5LmpzXCI7XG5pbXBvcnQge1xuICBhcHBseVlhcmRhZ2VPdXRjb21lLFxuICBibGFua1BpY2ssXG4gIGJ1bXBTdGF0cyxcbiAgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbixcbn0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlU2FtZVBsYXkoc3RhdGU6IEdhbWVTdGF0ZSwgcm5nOiBSbmcpOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcblxuICBjb25zdCBjb2luID0gcm5nLmNvaW5GbGlwKCk7XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJTQU1FX1BMQVlfQ09JTlwiLCBvdXRjb21lOiBjb2luIH0pO1xuXG4gIGNvbnN0IG11bHREcmF3ID0gZHJhd011bHRpcGxpZXIoc3RhdGUuZGVjaywgcm5nKTtcbiAgaWYgKG11bHREcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwibXVsdGlwbGllclwiIH0pO1xuXG4gIGNvbnN0IHN0YXRlQWZ0ZXJNdWx0OiBHYW1lU3RhdGUgPSB7IC4uLnN0YXRlLCBkZWNrOiBtdWx0RHJhdy5kZWNrIH07XG4gIGNvbnN0IGhlYWRzID0gY29pbiA9PT0gXCJoZWFkc1wiO1xuXG4gIC8vIEtpbmcgXHUyMTkyIEJpZyBQbGF5IGZvciB3aGljaGV2ZXIgc2lkZSB3aW5zIHRoZSBjb2luLlxuICBpZiAobXVsdERyYXcuY2FyZCA9PT0gXCJLaW5nXCIpIHtcbiAgICBjb25zdCBiZW5lZmljaWFyeSA9IGhlYWRzID8gb2ZmZW5zZSA6IG9wcChvZmZlbnNlKTtcbiAgICBjb25zdCBicCA9IHJlc29sdmVCaWdQbGF5KHN0YXRlQWZ0ZXJNdWx0LCBiZW5lZmljaWFyeSwgcm5nKTtcbiAgICByZXR1cm4geyBzdGF0ZTogYnAuc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4uYnAuZXZlbnRzXSB9O1xuICB9XG5cbiAgLy8gMTAgXHUyMTkyIGludGVyY2VwdGlvbiAoaGVhZHMpIG9yIDAgeWFyZHMgKHRhaWxzKS5cbiAgaWYgKG11bHREcmF3LmNhcmQgPT09IFwiMTBcIikge1xuICAgIGlmIChoZWFkcykge1xuICAgICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJpbnRlcmNlcHRpb25cIiB9KTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgLi4uc3RhdGVBZnRlck11bHQsXG4gICAgICAgICAgcGxheWVyczogYnVtcFN0YXRzKHN0YXRlQWZ0ZXJNdWx0LnBsYXllcnMsIG9mZmVuc2UsIHsgdHVybm92ZXJzOiAxIH0pLFxuICAgICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgICBmaWVsZDoge1xuICAgICAgICAgICAgLi4uc3RhdGVBZnRlck11bHQuZmllbGQsXG4gICAgICAgICAgICBvZmZlbnNlOiBvcHAob2ZmZW5zZSksXG4gICAgICAgICAgICBiYWxsT246IDEwMCAtIHN0YXRlQWZ0ZXJNdWx0LmZpZWxkLmJhbGxPbixcbiAgICAgICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIDEwMCAtIHN0YXRlQWZ0ZXJNdWx0LmZpZWxkLmJhbGxPbiArIDEwKSxcbiAgICAgICAgICAgIGRvd246IDEsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgZXZlbnRzLFxuICAgICAgfTtcbiAgICB9XG4gICAgLy8gMCB5YXJkcywgZG93biBjb25zdW1lZC4gRW1pdCBQTEFZX1JFU09MVkVEIHNvIHRoZSBuYXJyYXRvciBjYW5cbiAgICAvLyByZW5kZXIgXCJubyBnYWluXCIgaW5zdGVhZCBvZiBsZWF2aW5nIG9ubHkgU0FNRV9QTEFZX0NPSU4gdmlzaWJsZVxuICAgIC8vIGFuZCB0aGUgZG93biBzaWxlbnRseSBhZHZhbmNpbmcgKEYtNDgpLlxuICAgIGV2ZW50cy5wdXNoKHtcbiAgICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgICAgb2ZmZW5zZVBsYXk6IHN0YXRlLnBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ID8/IFwiU1JcIixcbiAgICAgIGRlZmVuc2VQbGF5OiBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA/PyBcIlNSXCIsXG4gICAgICBtYXRjaHVwUXVhbGl0eTogMCxcbiAgICAgIG11bHRpcGxpZXI6IHsgY2FyZDogXCIxMFwiLCB2YWx1ZTogMCB9LFxuICAgICAgeWFyZHNDYXJkOiAwLFxuICAgICAgeWFyZHNHYWluZWQ6IDAsXG4gICAgICBuZXdCYWxsT246IHN0YXRlQWZ0ZXJNdWx0LmZpZWxkLmJhbGxPbixcbiAgICB9KTtcbiAgICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShzdGF0ZUFmdGVyTXVsdCwgMCwgZXZlbnRzKTtcbiAgfVxuXG4gIC8vIFF1ZWVuIG9yIEphY2sgXHUyMTkyIG11bHRpcGxpZXIsIHRoZW4gZHJhdyB5YXJkcyBjYXJkLlxuICBsZXQgbXVsdGlwbGllciA9IDA7XG4gIGlmIChtdWx0RHJhdy5jYXJkID09PSBcIlF1ZWVuXCIpIG11bHRpcGxpZXIgPSBoZWFkcyA/IDMgOiAwO1xuICBpZiAobXVsdERyYXcuY2FyZCA9PT0gXCJKYWNrXCIpIG11bHRpcGxpZXIgPSBoZWFkcyA/IDAgOiAtMztcblxuICBpZiAobXVsdGlwbGllciA9PT0gMCkge1xuICAgIC8vIDAgeWFyZHMsIGRvd24gY29uc3VtZWQgKEYtNDggXHUyMDE0IHNhbWUgYXMgMTAtdGFpbHMgYnJhbmNoIGFib3ZlKS5cbiAgICBldmVudHMucHVzaCh7XG4gICAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICAgIG9mZmVuc2VQbGF5OiBzdGF0ZS5wZW5kaW5nUGljay5vZmZlbnNlUGxheSA/PyBcIlNSXCIsXG4gICAgICBkZWZlbnNlUGxheTogc3RhdGUucGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgPz8gXCJTUlwiLFxuICAgICAgbWF0Y2h1cFF1YWxpdHk6IDAsXG4gICAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IG11bHREcmF3LmNhcmQsIHZhbHVlOiAwIH0sXG4gICAgICB5YXJkc0NhcmQ6IDAsXG4gICAgICB5YXJkc0dhaW5lZDogMCxcbiAgICAgIG5ld0JhbGxPbjogc3RhdGVBZnRlck11bHQuZmllbGQuYmFsbE9uLFxuICAgIH0pO1xuICAgIHJldHVybiBhcHBseVlhcmRhZ2VPdXRjb21lKHN0YXRlQWZ0ZXJNdWx0LCAwLCBldmVudHMpO1xuICB9XG5cbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKHN0YXRlQWZ0ZXJNdWx0LmRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuXG4gIGNvbnN0IHlhcmRzID0gTWF0aC5yb3VuZChtdWx0aXBsaWVyICogeWFyZHNEcmF3LmNhcmQpO1xuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICBvZmZlbnNlUGxheTogc3RhdGUucGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPz8gXCJTUlwiLFxuICAgIGRlZmVuc2VQbGF5OiBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA/PyBcIlNSXCIsXG4gICAgbWF0Y2h1cFF1YWxpdHk6IDAsXG4gICAgbXVsdGlwbGllcjogeyBjYXJkOiBtdWx0RHJhdy5jYXJkLCB2YWx1ZTogbXVsdGlwbGllciB9LFxuICAgIHlhcmRzQ2FyZDogeWFyZHNEcmF3LmNhcmQsXG4gICAgeWFyZHNHYWluZWQ6IHlhcmRzLFxuICAgIG5ld0JhbGxPbjogTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBzdGF0ZUFmdGVyTXVsdC5maWVsZC5iYWxsT24gKyB5YXJkcykpLFxuICB9KTtcblxuICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShcbiAgICB7IC4uLnN0YXRlQWZ0ZXJNdWx0LCBkZWNrOiB5YXJkc0RyYXcuZGVjayB9LFxuICAgIHlhcmRzLFxuICAgIGV2ZW50cyxcbiAgKTtcbn1cbiIsICIvKipcbiAqIFRyaWNrIFBsYXkgcmVzb2x1dGlvbiAocnVuLmpzOjE5ODcpLiBPbmUgcGVyIHNodWZmbGUsIGNhbGxlZCBieSBlaXRoZXJcbiAqIG9mZmVuc2Ugb3IgZGVmZW5zZS4gRGllIHJvbGwgb3V0Y29tZXMgKGZyb20gdGhlICpjYWxsZXIncyogcGVyc3BlY3RpdmUpOlxuICpcbiAqICAgMSBcdTIxOTIgTG9uZyBQYXNzIHdpdGggKzUgYm9udXMgICAobWF0Y2h1cCB1c2VzIExQIHZzIHRoZSBvdGhlciBzaWRlJ3MgcGljaylcbiAqICAgMiBcdTIxOTIgMTUteWFyZCBwZW5hbHR5IG9uIG9wcG9zaW5nIHNpZGUgKGhhbGYtdG8tZ29hbCBpZiB0aWdodClcbiAqICAgMyBcdTIxOTIgZml4ZWQgLTN4IG11bHRpcGxpZXIsIGRyYXcgeWFyZHMgY2FyZFxuICogICA0IFx1MjE5MiBmaXhlZCArNHggbXVsdGlwbGllciwgZHJhdyB5YXJkcyBjYXJkXG4gKiAgIDUgXHUyMTkyIEJpZyBQbGF5IChiZW5lZmljaWFyeSA9IGNhbGxlcilcbiAqICAgNiBcdTIxOTIgTG9uZyBSdW4gd2l0aCArNSBib251c1xuICpcbiAqIFdoZW4gdGhlIGNhbGxlciBpcyB0aGUgZGVmZW5zZSwgdGhlIHlhcmRhZ2Ugc2lnbnMgaW52ZXJ0IChkZWZlbnNlIGdhaW5zID1cbiAqIG9mZmVuc2UgbG9zZXMpLCB0aGUgTFIvTFAgb3ZlcmxheSBpcyBhcHBsaWVkIHRvIHRoZSBkZWZlbnNpdmUgY2FsbCwgYW5kXG4gKiB0aGUgQmlnIFBsYXkgYmVuZWZpY2lhcnkgaXMgZGVmZW5zZS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgUGxheWVySWQsIFJlZ3VsYXJQbGF5IH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBkcmF3TXVsdGlwbGllciwgZHJhd1lhcmRzIH0gZnJvbSBcIi4uL2RlY2suanNcIjtcbmltcG9ydCB7IE1VTFRJLCBtYXRjaHVwUXVhbGl0eSB9IGZyb20gXCIuLi9tYXRjaHVwLmpzXCI7XG5pbXBvcnQgeyByZXNvbHZlQmlnUGxheSB9IGZyb20gXCIuL2JpZ1BsYXkuanNcIjtcbmltcG9ydCB7XG4gIGFwcGx5WWFyZGFnZU91dGNvbWUsXG4gIGJsYW5rUGljayxcbiAgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbixcbn0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlT2ZmZW5zaXZlVHJpY2tQbGF5KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBybmc6IFJuZyxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGRpZSA9IHJuZy5kNigpO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbeyB0eXBlOiBcIlRSSUNLX1BMQVlfUk9MTFwiLCBvdXRjb21lOiBkaWUgfV07XG5cbiAgLy8gNSBcdTIxOTIgQmlnIFBsYXkgZm9yIG9mZmVuc2UgKGNhbGxlcikuXG4gIGlmIChkaWUgPT09IDUpIHtcbiAgICBjb25zdCBicCA9IHJlc29sdmVCaWdQbGF5KHN0YXRlLCBvZmZlbnNlLCBybmcpO1xuICAgIHJldHVybiB7IHN0YXRlOiBicC5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi5icC5ldmVudHNdIH07XG4gIH1cblxuICAvLyAyIFx1MjE5MiAxNS15YXJkIHBlbmFsdHkgb24gZGVmZW5zZSAoPSBvZmZlbnNlIGdhaW5zIDE1IG9yIGhhbGYtdG8tZ29hbCkuXG4gIGlmIChkaWUgPT09IDIpIHtcbiAgICBjb25zdCByYXdHYWluID0gMTU7XG4gICAgY29uc3QgZ2FpbiA9XG4gICAgICBzdGF0ZS5maWVsZC5iYWxsT24gKyByYXdHYWluID4gOTlcbiAgICAgICAgPyBNYXRoLnRydW5jKCgxMDAgLSBzdGF0ZS5maWVsZC5iYWxsT24pIC8gMilcbiAgICAgICAgOiByYXdHYWluO1xuICAgIGNvbnN0IG5ld0JhbGxPbiA9IE1hdGgubWluKDEwMCwgc3RhdGUuZmllbGQuYmFsbE9uICsgZ2Fpbik7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlBFTkFMVFlcIiwgYWdhaW5zdDogb3Bwb25lbnQob2ZmZW5zZSksIHlhcmRzOiBnYWluLCBsb3NzT2ZEb3duOiBmYWxzZSB9KTtcbiAgICAvLyBSLTI1OiBpZiB0aGUgcGVuYWx0eSBHQUlOIGNhcnJpZXMgdGhlIGJhbGwgdG8gb3IgcGFzdCB0aGVcbiAgICAvLyBmaXJzdC1kb3duIG1hcmtlciwgZ3JhbnQgYXV0b21hdGljIGZpcnN0IGRvd24gXHUyMDE0IHJlc2V0IGRvd24gdG8gMVxuICAgIC8vIGFuZCBmaXJzdERvd25BdCB0byBiYWxsT24gKyAxMC4gT3RoZXJ3aXNlIGtlZXAgdGhlIGN1cnJlbnQgZG93blxuICAgIC8vIChzYW1lLWRvd24gcmVwbGF5cyB3aXRoIHlhcmRzLXRvLWdvIHVwZGF0ZWQpLlxuICAgIGNvbnN0IHJlYWNoZWRGaXJzdERvd24gPSBuZXdCYWxsT24gPj0gc3RhdGUuZmllbGQuZmlyc3REb3duQXQ7XG4gICAgY29uc3QgbmV4dERvd24gPSByZWFjaGVkRmlyc3REb3duID8gMSA6IHN0YXRlLmZpZWxkLmRvd247XG4gICAgY29uc3QgbmV4dEZpcnN0RG93bkF0ID0gcmVhY2hlZEZpcnN0RG93blxuICAgICAgPyBNYXRoLm1pbigxMDAsIG5ld0JhbGxPbiArIDEwKVxuICAgICAgOiBzdGF0ZS5maWVsZC5maXJzdERvd25BdDtcbiAgICBpZiAocmVhY2hlZEZpcnN0RG93bikgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkZJUlNUX0RPV05cIiB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICAuLi5zdGF0ZS5maWVsZCxcbiAgICAgICAgICBiYWxsT246IG5ld0JhbGxPbixcbiAgICAgICAgICBkb3duOiBuZXh0RG93bixcbiAgICAgICAgICBmaXJzdERvd25BdDogbmV4dEZpcnN0RG93bkF0LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gMyBvciA0IFx1MjE5MiBmaXhlZCBtdWx0aXBsaWVyLCBkcmF3IHlhcmRzIGNhcmQuXG4gIGlmIChkaWUgPT09IDMgfHwgZGllID09PSA0KSB7XG4gICAgY29uc3QgbXVsdGlwbGllciA9IGRpZSA9PT0gMyA/IC0zIDogNDtcbiAgICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMoc3RhdGUuZGVjaywgcm5nKTtcbiAgICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcbiAgICBjb25zdCB5YXJkcyA9IE1hdGgucm91bmQobXVsdGlwbGllciAqIHlhcmRzRHJhdy5jYXJkKTtcblxuICAgIGV2ZW50cy5wdXNoKHtcbiAgICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgICAgb2ZmZW5zZVBsYXk6IFwiVFBcIixcbiAgICAgIGRlZmVuc2VQbGF5OiBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA/PyBcIlNSXCIsXG4gICAgICBtYXRjaHVwUXVhbGl0eTogMCxcbiAgICAgIG11bHRpcGxpZXI6IHsgY2FyZDogXCJLaW5nXCIsIHZhbHVlOiBtdWx0aXBsaWVyIH0sXG4gICAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgICAgeWFyZHNHYWluZWQ6IHlhcmRzLFxuICAgICAgbmV3QmFsbE9uOiBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHN0YXRlLmZpZWxkLmJhbGxPbiArIHlhcmRzKSksXG4gICAgfSk7XG5cbiAgICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShcbiAgICAgIHsgLi4uc3RhdGUsIGRlY2s6IHlhcmRzRHJhdy5kZWNrIH0sXG4gICAgICB5YXJkcyxcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgLy8gMSBvciA2IFx1MjE5MiByZWd1bGFyIHBsYXkgcmVzb2x1dGlvbiB3aXRoIGZvcmNlZCBvZmZlbnNlIHBsYXkgKyBib251cy5cbiAgY29uc3QgZm9yY2VkUGxheTogUmVndWxhclBsYXkgPSBkaWUgPT09IDEgPyBcIkxQXCIgOiBcIkxSXCI7XG4gIGNvbnN0IGJvbnVzID0gNTtcbiAgY29uc3QgZGVmZW5zZVBsYXkgPSBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA/PyBcIlNSXCI7XG5cbiAgLy8gTXVzdCBiZSBhIHJlZ3VsYXIgcGxheSBmb3IgbWF0Y2h1cCB0byBiZSBtZWFuaW5nZnVsLiBJZiBkZWZlbnNlIGFsc28gcGlja2VkXG4gIC8vIHNvbWV0aGluZyB3ZWlyZCwgZmFsbCBiYWNrIHRvIHF1YWxpdHkgMyAobmV1dHJhbCkuXG4gIGNvbnN0IGRlZlBsYXkgPSBpc1JlZ3VsYXIoZGVmZW5zZVBsYXkpID8gZGVmZW5zZVBsYXkgOiBcIlNSXCI7XG4gIGNvbnN0IHF1YWxpdHkgPSBtYXRjaHVwUXVhbGl0eShmb3JjZWRQbGF5LCBkZWZQbGF5KTtcblxuICBjb25zdCBtdWx0RHJhdyA9IGRyYXdNdWx0aXBsaWVyKHN0YXRlLmRlY2ssIHJuZyk7XG4gIGlmIChtdWx0RHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcIm11bHRpcGxpZXJcIiB9KTtcbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKG11bHREcmF3LmRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuXG4gIGNvbnN0IG11bHRSb3cgPSBNVUxUSVttdWx0RHJhdy5pbmRleF07XG4gIGNvbnN0IG11bHRpcGxpZXIgPSBtdWx0Um93Py5bcXVhbGl0eSAtIDFdID8/IDA7XG4gIGNvbnN0IHlhcmRzID0gTWF0aC5yb3VuZChtdWx0aXBsaWVyICogeWFyZHNEcmF3LmNhcmQpICsgYm9udXM7XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgIG9mZmVuc2VQbGF5OiBmb3JjZWRQbGF5LFxuICAgIGRlZmVuc2VQbGF5OiBkZWZQbGF5LFxuICAgIG1hdGNodXBRdWFsaXR5OiBxdWFsaXR5LFxuICAgIG11bHRpcGxpZXI6IHsgY2FyZDogbXVsdERyYXcuY2FyZCwgdmFsdWU6IG11bHRpcGxpZXIgfSxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgIHlhcmRzR2FpbmVkOiB5YXJkcyxcbiAgICBuZXdCYWxsT246IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgc3RhdGUuZmllbGQuYmFsbE9uICsgeWFyZHMpKSxcbiAgfSk7XG5cbiAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoXG4gICAgeyAuLi5zdGF0ZSwgZGVjazogeWFyZHNEcmF3LmRlY2sgfSxcbiAgICB5YXJkcyxcbiAgICBldmVudHMsXG4gICk7XG59XG5cbmZ1bmN0aW9uIGlzUmVndWxhcihwOiBzdHJpbmcpOiBwIGlzIFJlZ3VsYXJQbGF5IHtcbiAgcmV0dXJuIHAgPT09IFwiU1JcIiB8fCBwID09PSBcIkxSXCIgfHwgcCA9PT0gXCJTUFwiIHx8IHAgPT09IFwiTFBcIjtcbn1cblxuZnVuY3Rpb24gb3Bwb25lbnQocDogUGxheWVySWQpOiBQbGF5ZXJJZCB7XG4gIHJldHVybiBwID09PSAxID8gMiA6IDE7XG59XG5cbi8qKlxuICogRGVmZW5zZSBjYWxscyBUcmljayBQbGF5LiBTeW1tZXRyaWMgdG8gdGhlIG9mZmVuc2l2ZSB2ZXJzaW9uIHdpdGggdGhlXG4gKiB5YXJkYWdlIHNpZ24gaW52ZXJ0ZWQgb24gdGhlIExSL0xQIGFuZCBwZW5hbHR5IGJyYW5jaGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZURlZmVuc2l2ZVRyaWNrUGxheShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgcm5nOiBSbmcsXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBkZWZlbmRlciA9IG9wcG9uZW50KG9mZmVuc2UpO1xuICBjb25zdCBkaWUgPSBybmcuZDYoKTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW3sgdHlwZTogXCJUUklDS19QTEFZX1JPTExcIiwgb3V0Y29tZTogZGllIH1dO1xuXG4gIC8vIDUgXHUyMTkyIEJpZyBQbGF5IGZvciBkZWZlbnNlIChjYWxsZXIpLlxuICBpZiAoZGllID09PSA1KSB7XG4gICAgY29uc3QgYnAgPSByZXNvbHZlQmlnUGxheShzdGF0ZSwgZGVmZW5kZXIsIHJuZyk7XG4gICAgcmV0dXJuIHsgc3RhdGU6IGJwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLmJwLmV2ZW50c10gfTtcbiAgfVxuXG4gIC8vIDIgXHUyMTkyIDE1LXlhcmQgcGVuYWx0eSBvbiBvZmZlbnNlICg9IG9mZmVuc2UgbG9zZXMgMTUgb3IgaGFsZi10by1vd24tZ29hbCkuXG4gIGlmIChkaWUgPT09IDIpIHtcbiAgICBjb25zdCByYXdMb3NzID0gLTE1O1xuICAgIGNvbnN0IGxvc3MgPVxuICAgICAgc3RhdGUuZmllbGQuYmFsbE9uICsgcmF3TG9zcyA8IDFcbiAgICAgICAgPyAtTWF0aC50cnVuYyhzdGF0ZS5maWVsZC5iYWxsT24gLyAyKVxuICAgICAgICA6IHJhd0xvc3M7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlBFTkFMVFlcIiwgYWdhaW5zdDogb2ZmZW5zZSwgeWFyZHM6IGxvc3MsIGxvc3NPZkRvd246IGZhbHNlIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGVuZGluZ1BpY2s6IHsgb2ZmZW5zZVBsYXk6IG51bGwsIGRlZmVuc2VQbGF5OiBudWxsIH0sXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgLi4uc3RhdGUuZmllbGQsXG4gICAgICAgICAgYmFsbE9uOiBNYXRoLm1heCgwLCBzdGF0ZS5maWVsZC5iYWxsT24gKyBsb3NzKSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIDMgb3IgNCBcdTIxOTIgZml4ZWQgbXVsdGlwbGllciB3aXRoIHRoZSAqZGVmZW5zZSdzKiBzaWduIGNvbnZlbnRpb24uIHY1LjFcbiAgLy8gYXBwbGllcyB0aGUgc2FtZSArLy0gbXVsdGlwbGllcnMgYXMgb2ZmZW5zaXZlIFRyaWNrIFBsYXk7IHRoZSBpbnZlcnNpb25cbiAgLy8gaXMgaW1wbGljaXQgaW4gZGVmZW5zZSBiZWluZyB0aGUgY2FsbGVyLiBZYXJkYWdlIGlzIGZyb20gb2ZmZW5zZSBQT1YuXG4gIGlmIChkaWUgPT09IDMgfHwgZGllID09PSA0KSB7XG4gICAgY29uc3QgbXVsdGlwbGllciA9IGRpZSA9PT0gMyA/IC0zIDogNDtcbiAgICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMoc3RhdGUuZGVjaywgcm5nKTtcbiAgICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcbiAgICBjb25zdCB5YXJkcyA9IE1hdGgucm91bmQobXVsdGlwbGllciAqIHlhcmRzRHJhdy5jYXJkKTtcblxuICAgIGV2ZW50cy5wdXNoKHtcbiAgICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgICAgb2ZmZW5zZVBsYXk6IHN0YXRlLnBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ID8/IFwiU1JcIixcbiAgICAgIGRlZmVuc2VQbGF5OiBcIlRQXCIsXG4gICAgICBtYXRjaHVwUXVhbGl0eTogMCxcbiAgICAgIG11bHRpcGxpZXI6IHsgY2FyZDogXCJLaW5nXCIsIHZhbHVlOiBtdWx0aXBsaWVyIH0sXG4gICAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgICAgeWFyZHNHYWluZWQ6IHlhcmRzLFxuICAgICAgbmV3QmFsbE9uOiBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHN0YXRlLmZpZWxkLmJhbGxPbiArIHlhcmRzKSksXG4gICAgfSk7XG5cbiAgICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShcbiAgICAgIHsgLi4uc3RhdGUsIGRlY2s6IHlhcmRzRHJhdy5kZWNrIH0sXG4gICAgICB5YXJkcyxcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgLy8gMSBvciA2IFx1MjE5MiBkZWZlbnNlJ3MgcGljayBiZWNvbWVzIExQIC8gTFIgd2l0aCAtNSBib251cyB0byBvZmZlbnNlLlxuICBjb25zdCBmb3JjZWREZWZQbGF5OiBSZWd1bGFyUGxheSA9IGRpZSA9PT0gMSA/IFwiTFBcIiA6IFwiTFJcIjtcbiAgY29uc3QgYm9udXMgPSAtNTtcbiAgY29uc3Qgb2ZmZW5zZVBsYXkgPSBzdGF0ZS5wZW5kaW5nUGljay5vZmZlbnNlUGxheSA/PyBcIlNSXCI7XG4gIGNvbnN0IG9mZlBsYXkgPSBpc1JlZ3VsYXIob2ZmZW5zZVBsYXkpID8gb2ZmZW5zZVBsYXkgOiBcIlNSXCI7XG4gIGNvbnN0IHF1YWxpdHkgPSBtYXRjaHVwUXVhbGl0eShvZmZQbGF5LCBmb3JjZWREZWZQbGF5KTtcblxuICBjb25zdCBtdWx0RHJhdyA9IGRyYXdNdWx0aXBsaWVyKHN0YXRlLmRlY2ssIHJuZyk7XG4gIGlmIChtdWx0RHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcIm11bHRpcGxpZXJcIiB9KTtcbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKG11bHREcmF3LmRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuXG4gIGNvbnN0IG11bHRSb3cgPSBNVUxUSVttdWx0RHJhdy5pbmRleF07XG4gIGNvbnN0IG11bHRpcGxpZXIgPSBtdWx0Um93Py5bcXVhbGl0eSAtIDFdID8/IDA7XG4gIGNvbnN0IHlhcmRzID0gTWF0aC5yb3VuZChtdWx0aXBsaWVyICogeWFyZHNEcmF3LmNhcmQpICsgYm9udXM7XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgIG9mZmVuc2VQbGF5OiBvZmZQbGF5LFxuICAgIGRlZmVuc2VQbGF5OiBmb3JjZWREZWZQbGF5LFxuICAgIG1hdGNodXBRdWFsaXR5OiBxdWFsaXR5LFxuICAgIG11bHRpcGxpZXI6IHsgY2FyZDogbXVsdERyYXcuY2FyZCwgdmFsdWU6IG11bHRpcGxpZXIgfSxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgIHlhcmRzR2FpbmVkOiB5YXJkcyxcbiAgICBuZXdCYWxsT246IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgc3RhdGUuZmllbGQuYmFsbE9uICsgeWFyZHMpKSxcbiAgfSk7XG5cbiAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoXG4gICAgeyAuLi5zdGF0ZSwgZGVjazogeWFyZHNEcmF3LmRlY2sgfSxcbiAgICB5YXJkcyxcbiAgICBldmVudHMsXG4gICk7XG59XG4iLCAiLyoqXG4gKiBGaWVsZCBHb2FsIChydW4uanM6MjA0MCkuXG4gKlxuICogRGlzdGFuY2UgPSAoMTAwIC0gYmFsbE9uKSArIDE3LiBTbyBmcm9tIHRoZSA1MCwgRkcgPSA2Ny15YXJkIGF0dGVtcHQuXG4gKlxuICogRGllIHJvbGwgZGV0ZXJtaW5lcyBzdWNjZXNzIGJ5IGRpc3RhbmNlIGJhbmQ6XG4gKiAgIGRpc3RhbmNlID4gNjUgICAgICAgIFx1MjE5MiAxLWluLTEwMDAgY2hhbmNlIChlZmZlY3RpdmVseSBhdXRvLW1pc3MpXG4gKiAgIGRpc3RhbmNlID49IDYwICAgICAgIFx1MjE5MiBuZWVkcyBkaWUgPSA2XG4gKiAgIGRpc3RhbmNlID49IDUwICAgICAgIFx1MjE5MiBuZWVkcyBkaWUgPj0gNVxuICogICBkaXN0YW5jZSA+PSA0MCAgICAgICBcdTIxOTIgbmVlZHMgZGllID49IDRcbiAqICAgZGlzdGFuY2UgPj0gMzAgICAgICAgXHUyMTkyIG5lZWRzIGRpZSA+PSAzXG4gKiAgIGRpc3RhbmNlID49IDIwICAgICAgIFx1MjE5MiBuZWVkcyBkaWUgPj0gMlxuICogICBkaXN0YW5jZSA8ICAyMCAgICAgICBcdTIxOTIgYXV0by1tYWtlXG4gKlxuICogSWYgYSB0aW1lb3V0IHdhcyBjYWxsZWQgYnkgdGhlIGRlZmVuc2UganVzdCBwcmlvciAoa2lja2VyIGljaW5nKSwgZGllKysuXG4gKlxuICogU3VjY2VzcyBcdTIxOTIgKzMgcG9pbnRzLCBraWNrb2ZmIHRvIG9wcG9uZW50LlxuICogTWlzcyAgICBcdTIxOTIgcG9zc2Vzc2lvbiBmbGlwcyBhdCB0aGUgU1BPVCBPRiBUSEUgS0lDSyAobm90IHRoZSBsaW5lIG9mIHNjcmltbWFnZSkuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi8uLi9zdGF0ZS5qc1wiO1xuaW1wb3J0IHsgYmxhbmtQaWNrLCB0eXBlIFNwZWNpYWxSZXNvbHV0aW9uIH0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRmllbGRHb2FsT3B0aW9ucyB7XG4gIC8qKiB0cnVlIGlmIHRoZSBvcHBvc2luZyB0ZWFtIGNhbGxlZCBhIHRpbWVvdXQgdGhhdCBzaG91bGQgaWNlIHRoZSBraWNrZXIuICovXG4gIGljZWQ/OiBib29sZWFuO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUZpZWxkR29hbChcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgcm5nOiBSbmcsXG4gIG9wdHM6IEZpZWxkR29hbE9wdGlvbnMgPSB7fSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGRpc3RhbmNlID0gMTAwIC0gc3RhdGUuZmllbGQuYmFsbE9uICsgMTc7XG4gIGNvbnN0IHJhd0RpZSA9IHJuZy5kNigpO1xuICBjb25zdCBkaWUgPSBvcHRzLmljZWQgPyBNYXRoLm1pbig2LCByYXdEaWUgKyAxKSA6IHJhd0RpZTtcblxuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcblxuICBsZXQgbWFrZTogYm9vbGVhbjtcbiAgaWYgKGRpc3RhbmNlID4gNjUpIHtcbiAgICAvLyBFc3NlbnRpYWxseSBpbXBvc3NpYmxlIFx1MjAxNCByb2xsZWQgMS0xMDAwLCBtYWtlIG9ubHkgb24gZXhhY3QgaGl0LlxuICAgIG1ha2UgPSBybmcuaW50QmV0d2VlbigxLCAxMDAwKSA9PT0gZGlzdGFuY2U7XG4gIH0gZWxzZSBpZiAoZGlzdGFuY2UgPj0gNjApIG1ha2UgPSBkaWUgPj0gNjtcbiAgZWxzZSBpZiAoZGlzdGFuY2UgPj0gNTApIG1ha2UgPSBkaWUgPj0gNTtcbiAgZWxzZSBpZiAoZGlzdGFuY2UgPj0gNDApIG1ha2UgPSBkaWUgPj0gNDtcbiAgZWxzZSBpZiAoZGlzdGFuY2UgPj0gMzApIG1ha2UgPSBkaWUgPj0gMztcbiAgZWxzZSBpZiAoZGlzdGFuY2UgPj0gMjApIG1ha2UgPSBkaWUgPj0gMjtcbiAgZWxzZSBtYWtlID0gdHJ1ZTtcblxuICBpZiAobWFrZSkge1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJGSUVMRF9HT0FMX0dPT0RcIiwgcGxheWVyOiBvZmZlbnNlLCByb2xsOiBkaWUsIGRpc3RhbmNlIH0pO1xuICAgIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgW29mZmVuc2VdOiB7IC4uLnN0YXRlLnBsYXllcnNbb2ZmZW5zZV0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLnNjb3JlICsgMyB9LFxuICAgIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkZJRUxEX0dPQUxfTUlTU0VEXCIsIHBsYXllcjogb2ZmZW5zZSwgcm9sbDogZGllLCBkaXN0YW5jZSB9KTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJtaXNzZWRfZmdcIiB9KTtcblxuICAvLyBGLTUxIGZpZGVsaXR5OiB2NS4xIHBsYWNlcyBiYWxsIGF0IFNQT1QgT0YgS0lDSyAoNyB5YXJkcyBiZWhpbmQgTE9TIGluXG4gIC8vIG9mZmVuc2UgUE9WIFx1MjE5MiBtaXJyb3IgKyA3IGluIGRlZmVuZGVyIFBPVikuIFJlZC16b25lIG1pc3NlcyAoa2ljayBzcG90XG4gIC8vIHdvdWxkIGJlIGluc2lkZSBkZWZlbmRlcidzIDIwKSBzbmFwIGZvcndhcmQgdG8gZGVmZW5kZXIncyAyMC5cbiAgY29uc3QgZGVmZW5kZXIgPSBvcHAob2ZmZW5zZSk7XG4gIGNvbnN0IGtpY2tTcG90SW5EZWZlbmRlclBvdiA9IDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbiArIDc7XG4gIGNvbnN0IG5ld0JhbGxPbiA9IGtpY2tTcG90SW5EZWZlbmRlclBvdiA8PSAyMCA/IDIwIDoga2lja1Nwb3RJbkRlZmVuZGVyUG92O1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogbmV3QmFsbE9uLFxuICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBuZXdCYWxsT24gKyAxMCksXG4gICAgICAgIGRvd246IDEsXG4gICAgICAgIG9mZmVuc2U6IGRlZmVuZGVyLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cbiIsICIvKipcbiAqIFR3by1Qb2ludCBDb252ZXJzaW9uIChUV09fUFQgcGhhc2UpLlxuICpcbiAqIEJhbGwgaXMgcGxhY2VkIGF0IG9mZmVuc2UncyA5NyAoPSAzLXlhcmQgbGluZSkuIEEgc2luZ2xlIHJlZ3VsYXIgcGxheSBpc1xuICogcmVzb2x2ZWQuIElmIHRoZSByZXN1bHRpbmcgeWFyZGFnZSBjcm9zc2VzIHRoZSBnb2FsIGxpbmUsIFRXT19QT0lOVF9HT09ELlxuICogT3RoZXJ3aXNlLCBUV09fUE9JTlRfRkFJTEVELiBFaXRoZXIgd2F5LCBraWNrb2ZmIGZvbGxvd3MuXG4gKlxuICogVW5saWtlIGEgbm9ybWFsIHBsYXksIGEgMnB0IGRvZXMgTk9UIGNoYW5nZSBkb3duL2Rpc3RhbmNlLiBJdCdzIGEgb25lLXNob3QuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIFJlZ3VsYXJQbGF5IH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBkcmF3TXVsdGlwbGllciwgZHJhd1lhcmRzIH0gZnJvbSBcIi4uL2RlY2suanNcIjtcbmltcG9ydCB7IGNvbXB1dGVZYXJkYWdlIH0gZnJvbSBcIi4uL3lhcmRhZ2UuanNcIjtcbmltcG9ydCB7IGJsYW5rUGljaywgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbiB9IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVR3b1BvaW50Q29udmVyc2lvbihcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgb2ZmZW5zZVBsYXk6IFJlZ3VsYXJQbGF5LFxuICBkZWZlbnNlUGxheTogUmVndWxhclBsYXksXG4gIHJuZzogUm5nLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG5cbiAgY29uc3QgbXVsdERyYXcgPSBkcmF3TXVsdGlwbGllcihzdGF0ZS5kZWNrLCBybmcpO1xuICBpZiAobXVsdERyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJtdWx0aXBsaWVyXCIgfSk7XG4gIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhtdWx0RHJhdy5kZWNrLCBybmcpO1xuICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcblxuICBjb25zdCBvdXRjb21lID0gY29tcHV0ZVlhcmRhZ2Uoe1xuICAgIG9mZmVuc2U6IG9mZmVuc2VQbGF5LFxuICAgIGRlZmVuc2U6IGRlZmVuc2VQbGF5LFxuICAgIG11bHRpcGxpZXJDYXJkOiBtdWx0RHJhdy5pbmRleCxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICB9KTtcblxuICAvLyAycHQgc3RhcnRzIGF0IDk3LiBDcm9zc2luZyB0aGUgZ29hbCA9IGdvb2QuXG4gIGNvbnN0IHN0YXJ0QmFsbE9uID0gOTc7XG4gIGNvbnN0IHByb2plY3RlZCA9IHN0YXJ0QmFsbE9uICsgb3V0Y29tZS55YXJkc0dhaW5lZDtcbiAgY29uc3QgZ29vZCA9IHByb2plY3RlZCA+PSAxMDA7XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgIG9mZmVuc2VQbGF5LFxuICAgIGRlZmVuc2VQbGF5LFxuICAgIG1hdGNodXBRdWFsaXR5OiBvdXRjb21lLm1hdGNodXBRdWFsaXR5LFxuICAgIG11bHRpcGxpZXI6IHsgY2FyZDogb3V0Y29tZS5tdWx0aXBsaWVyQ2FyZE5hbWUsIHZhbHVlOiBvdXRjb21lLm11bHRpcGxpZXIgfSxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgIHlhcmRzR2FpbmVkOiBvdXRjb21lLnlhcmRzR2FpbmVkLFxuICAgIG5ld0JhbGxPbjogTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBwcm9qZWN0ZWQpKSxcbiAgfSk7XG5cbiAgY29uc3QgbmV3UGxheWVycyA9IGdvb2RcbiAgICA/ICh7XG4gICAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICAgIFtvZmZlbnNlXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLCBzY29yZTogc3RhdGUucGxheWVyc1tvZmZlbnNlXS5zY29yZSArIDIgfSxcbiAgICAgIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXSlcbiAgICA6IHN0YXRlLnBsYXllcnM7XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IGdvb2QgPyBcIlRXT19QT0lOVF9HT09EXCIgOiBcIlRXT19QT0lOVF9GQUlMRURcIixcbiAgICBwbGF5ZXI6IG9mZmVuc2UsXG4gIH0pO1xuXG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgZGVjazogeWFyZHNEcmF3LmRlY2ssXG4gICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuIiwgIi8qKlxuICogT3ZlcnRpbWUgbWVjaGFuaWNzLlxuICpcbiAqIENvbGxlZ2UtZm9vdGJhbGwgc3R5bGU6XG4gKiAgIC0gRWFjaCBwZXJpb2Q6IGVhY2ggdGVhbSBnZXRzIG9uZSBwb3NzZXNzaW9uIGZyb20gdGhlIG9wcG9uZW50J3MgMjVcbiAqICAgICAob2ZmZW5zZSBQT1Y6IGJhbGxPbiA9IDc1KS5cbiAqICAgLSBBIHBvc3Nlc3Npb24gZW5kcyB3aXRoOiBURCAoZm9sbG93ZWQgYnkgUEFULzJwdCksIEZHIChtYWRlIG9yIG1pc3NlZCksXG4gKiAgICAgdHVybm92ZXIsIHR1cm5vdmVyLW9uLWRvd25zLCBvciBzYWZldHkuXG4gKiAgIC0gQWZ0ZXIgYm90aCBwb3NzZXNzaW9ucywgaWYgc2NvcmVzIGRpZmZlciBcdTIxOTIgR0FNRV9PVkVSLiBJZiB0aWVkIFx1MjE5MiBuZXh0XG4gKiAgICAgcGVyaW9kLlxuICogICAtIFBlcmlvZHMgYWx0ZXJuYXRlIHdobyBwb3NzZXNzZXMgZmlyc3QuXG4gKiAgIC0gUGVyaW9kIDMrOiAyLXBvaW50IGNvbnZlcnNpb24gbWFuZGF0b3J5IGFmdGVyIGEgVEQgKG5vIFBBVCBraWNrKS5cbiAqICAgLSBIYWlsIE1hcnlzOiAyIHBlciBwZXJpb2QsIHJlZmlsbGVkIGF0IHN0YXJ0IG9mIGVhY2ggcGVyaW9kLlxuICogICAtIFRpbWVvdXRzOiAxIHBlciBwYWlyIG9mIHBlcmlvZHMuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBPdmVydGltZVN0YXRlLCBQbGF5ZXJJZCB9IGZyb20gXCIuLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgZW1wdHlIYW5kLCBvcHAgfSBmcm9tIFwiLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7IGZyZXNoRGVja011bHRpcGxpZXJzLCBmcmVzaERlY2tZYXJkcyB9IGZyb20gXCIuLi9zdGF0ZS5qc1wiO1xuXG5jb25zdCBPVF9CQUxMX09OID0gNzU7IC8vIG9wcG9uZW50J3MgMjUteWFyZCBsaW5lLCBmcm9tIG9mZmVuc2UgUE9WXG5cbi8qKlxuICogSW5pdGlhbGl6ZSBPVCBzdGF0ZSwgcmVmcmVzaCBkZWNrcy9oYW5kcywgc2V0IGJhbGwgYXQgdGhlIDI1LlxuICogQ2FsbGVkIG9uY2UgdGllZCByZWd1bGF0aW9uIGVuZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGFydE92ZXJ0aW1lKHN0YXRlOiBHYW1lU3RhdGUpOiB7IHN0YXRlOiBHYW1lU3RhdGU7IGV2ZW50czogRXZlbnRbXSB9IHtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG4gIGNvbnN0IGZpcnN0UmVjZWl2ZXI6IFBsYXllcklkID0gc3RhdGUub3BlbmluZ1JlY2VpdmVyID09PSAxID8gMiA6IDE7XG4gIGNvbnN0IG92ZXJ0aW1lOiBPdmVydGltZVN0YXRlID0ge1xuICAgIHBlcmlvZDogMSxcbiAgICBwb3NzZXNzaW9uOiBmaXJzdFJlY2VpdmVyLFxuICAgIGZpcnN0UmVjZWl2ZXIsXG4gICAgcG9zc2Vzc2lvbnNSZW1haW5pbmc6IDIsXG4gIH07XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJPVkVSVElNRV9TVEFSVEVEXCIsIHBlcmlvZDogMSwgcG9zc2Vzc2lvbjogZmlyc3RSZWNlaXZlciB9KTtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwaGFzZTogXCJPVF9TVEFSVFwiLFxuICAgICAgb3ZlcnRpbWUsXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbi8qKiBCZWdpbiAob3IgcmVzdW1lKSB0aGUgbmV4dCBPVCBwb3NzZXNzaW9uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0YXJ0T3ZlcnRpbWVQb3NzZXNzaW9uKHN0YXRlOiBHYW1lU3RhdGUpOiB7IHN0YXRlOiBHYW1lU3RhdGU7IGV2ZW50czogRXZlbnRbXSB9IHtcbiAgaWYgKCFzdGF0ZS5vdmVydGltZSkgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcblxuICBjb25zdCBwb3NzZXNzaW9uID0gc3RhdGUub3ZlcnRpbWUucG9zc2Vzc2lvbjtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG5cbiAgLy8gUmVmaWxsIEhNIGNvdW50IGZvciB0aGUgcG9zc2Vzc2lvbidzIG9mZmVuc2UgKG1hdGNoZXMgdjUuMTogSE0gcmVzZXRzXG4gIC8vIHBlciBPVCBwZXJpb2QpLiBQZXJpb2QgMysgcGxheWVycyBoYXZlIG9ubHkgMiBITXMgYW55d2F5LlxuICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgW3Bvc3Nlc3Npb25dOiB7XG4gICAgICAuLi5zdGF0ZS5wbGF5ZXJzW3Bvc3Nlc3Npb25dLFxuICAgICAgaGFuZDogeyAuLi5zdGF0ZS5wbGF5ZXJzW3Bvc3Nlc3Npb25dLmhhbmQsIEhNOiBzdGF0ZS5vdmVydGltZS5wZXJpb2QgPj0gMyA/IDIgOiAyIH0sXG4gICAgfSxcbiAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuXG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgIHBoYXNlOiBcIk9UX1BMQVlcIixcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogT1RfQkFMTF9PTixcbiAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgT1RfQkFMTF9PTiArIDEwKSxcbiAgICAgICAgZG93bjogMSxcbiAgICAgICAgb2ZmZW5zZTogcG9zc2Vzc2lvbixcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbi8qKlxuICogRW5kIHRoZSBjdXJyZW50IE9UIHBvc3Nlc3Npb24uIERlY3JlbWVudHMgcG9zc2Vzc2lvbnNSZW1haW5pbmc7IGlmIDAsXG4gKiBjaGVja3MgZm9yIGdhbWUgZW5kLiBPdGhlcndpc2UgZmxpcHMgcG9zc2Vzc2lvbi5cbiAqXG4gKiBDYWxsZXIgaXMgcmVzcG9uc2libGUgZm9yIGRldGVjdGluZyBcInRoaXMgd2FzIGEgcG9zc2Vzc2lvbi1lbmRpbmcgZXZlbnRcIlxuICogKFREK1BBVCwgRkcgZGVjaXNpb24sIHR1cm5vdmVyLCBldGMpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZW5kT3ZlcnRpbWVQb3NzZXNzaW9uKHN0YXRlOiBHYW1lU3RhdGUpOiB7IHN0YXRlOiBHYW1lU3RhdGU7IGV2ZW50czogRXZlbnRbXSB9IHtcbiAgaWYgKCFzdGF0ZS5vdmVydGltZSkgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcblxuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcbiAgY29uc3QgcmVtYWluaW5nID0gc3RhdGUub3ZlcnRpbWUucG9zc2Vzc2lvbnNSZW1haW5pbmc7XG5cbiAgaWYgKHJlbWFpbmluZyA9PT0gMikge1xuICAgIC8vIEZpcnN0IHBvc3Nlc3Npb24gZW5kZWQuIEZsaXAgdG8gc2Vjb25kIHRlYW0sIGZyZXNoIGJhbGwuXG4gICAgY29uc3QgbmV4dFBvc3Nlc3Npb24gPSBvcHAoc3RhdGUub3ZlcnRpbWUucG9zc2Vzc2lvbik7XG4gICAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICBbbmV4dFBvc3Nlc3Npb25dOiB7XG4gICAgICAgIC4uLnN0YXRlLnBsYXllcnNbbmV4dFBvc3Nlc3Npb25dLFxuICAgICAgICBoYW5kOiB7IC4uLnN0YXRlLnBsYXllcnNbbmV4dFBvc3Nlc3Npb25dLmhhbmQsIEhNOiAyIH0sXG4gICAgICB9LFxuICAgIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICAgIHBoYXNlOiBcIk9UX1BMQVlcIixcbiAgICAgICAgb3ZlcnRpbWU6IHsgLi4uc3RhdGUub3ZlcnRpbWUsIHBvc3Nlc3Npb246IG5leHRQb3NzZXNzaW9uLCBwb3NzZXNzaW9uc1JlbWFpbmluZzogMSB9LFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIGJhbGxPbjogT1RfQkFMTF9PTixcbiAgICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBPVF9CQUxMX09OICsgMTApLFxuICAgICAgICAgIGRvd246IDEsXG4gICAgICAgICAgb2ZmZW5zZTogbmV4dFBvc3Nlc3Npb24sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBTZWNvbmQgcG9zc2Vzc2lvbiBlbmRlZC4gQ29tcGFyZSBzY29yZXMuXG4gIGNvbnN0IHAxID0gc3RhdGUucGxheWVyc1sxXS5zY29yZTtcbiAgY29uc3QgcDIgPSBzdGF0ZS5wbGF5ZXJzWzJdLnNjb3JlO1xuICBpZiAocDEgIT09IHAyKSB7XG4gICAgY29uc3Qgd2lubmVyOiBQbGF5ZXJJZCA9IHAxID4gcDIgPyAxIDogMjtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiR0FNRV9PVkVSXCIsIHdpbm5lciB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBoYXNlOiBcIkdBTUVfT1ZFUlwiLFxuICAgICAgICBvdmVydGltZTogeyAuLi5zdGF0ZS5vdmVydGltZSwgcG9zc2Vzc2lvbnNSZW1haW5pbmc6IDAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIFRpZWQgXHUyMDE0IHN0YXJ0IG5leHQgcGVyaW9kLiBBbHRlcm5hdGVzIGZpcnN0LXBvc3Nlc3Nvci5cbiAgY29uc3QgbmV4dFBlcmlvZCA9IHN0YXRlLm92ZXJ0aW1lLnBlcmlvZCArIDE7XG4gIGNvbnN0IG5leHRGaXJzdCA9IG9wcChzdGF0ZS5vdmVydGltZS5maXJzdFJlY2VpdmVyKTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIk9WRVJUSU1FX1NUQVJURURcIiwgcGVyaW9kOiBuZXh0UGVyaW9kLCBwb3NzZXNzaW9uOiBuZXh0Rmlyc3QgfSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGhhc2U6IFwiT1RfU1RBUlRcIixcbiAgICAgIG92ZXJ0aW1lOiB7XG4gICAgICAgIHBlcmlvZDogbmV4dFBlcmlvZCxcbiAgICAgICAgcG9zc2Vzc2lvbjogbmV4dEZpcnN0LFxuICAgICAgICBmaXJzdFJlY2VpdmVyOiBuZXh0Rmlyc3QsXG4gICAgICAgIHBvc3Nlc3Npb25zUmVtYWluaW5nOiAyLFxuICAgICAgfSxcbiAgICAgIC8vIEZyZXNoIGRlY2tzIGZvciB0aGUgbmV3IHBlcmlvZC5cbiAgICAgIGRlY2s6IHsgbXVsdGlwbGllcnM6IGZyZXNoRGVja011bHRpcGxpZXJzKCksIHlhcmRzOiBmcmVzaERlY2tZYXJkcygpIH0sXG4gICAgICBwbGF5ZXJzOiB7XG4gICAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICAgIDE6IHsgLi4uc3RhdGUucGxheWVyc1sxXSwgaGFuZDogZW1wdHlIYW5kKHRydWUpIH0sXG4gICAgICAgIDI6IHsgLi4uc3RhdGUucGxheWVyc1syXSwgaGFuZDogZW1wdHlIYW5kKHRydWUpIH0sXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG4vKipcbiAqIERldGVjdCB3aGV0aGVyIGEgc2VxdWVuY2Ugb2YgZXZlbnRzIGZyb20gYSBwbGF5IHJlc29sdXRpb24gc2hvdWxkIGVuZFxuICogdGhlIGN1cnJlbnQgT1QgcG9zc2Vzc2lvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzUG9zc2Vzc2lvbkVuZGluZ0luT1QoZXZlbnRzOiBSZWFkb25seUFycmF5PEV2ZW50Pik6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IGUgb2YgZXZlbnRzKSB7XG4gICAgc3dpdGNoIChlLnR5cGUpIHtcbiAgICAgIGNhc2UgXCJQQVRfR09PRFwiOlxuICAgICAgY2FzZSBcIlRXT19QT0lOVF9HT09EXCI6XG4gICAgICBjYXNlIFwiVFdPX1BPSU5UX0ZBSUxFRFwiOlxuICAgICAgY2FzZSBcIkZJRUxEX0dPQUxfR09PRFwiOlxuICAgICAgY2FzZSBcIkZJRUxEX0dPQUxfTUlTU0VEXCI6XG4gICAgICBjYXNlIFwiVFVSTk9WRVJcIjpcbiAgICAgIGNhc2UgXCJUVVJOT1ZFUl9PTl9ET1dOU1wiOlxuICAgICAgY2FzZSBcIlNBRkVUWVwiOlxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuIiwgIi8qKlxuICogVGhlIHNpbmdsZSB0cmFuc2l0aW9uIGZ1bmN0aW9uLiBUYWtlcyAoc3RhdGUsIGFjdGlvbiwgcm5nKSBhbmQgcmV0dXJuc1xuICogYSBuZXcgc3RhdGUgcGx1cyB0aGUgZXZlbnRzIHRoYXQgZGVzY3JpYmUgd2hhdCBoYXBwZW5lZC5cbiAqXG4gKiBUaGlzIGZpbGUgaXMgdGhlICpza2VsZXRvbiogXHUyMDE0IHRoZSBkaXNwYXRjaCBzaGFwZSBpcyBoZXJlLCB0aGUgY2FzZXMgYXJlXG4gKiBtb3N0bHkgc3R1YnMgbWFya2VkIGAvLyBUT0RPOiBwb3J0IGZyb20gcnVuLmpzYC4gQXMgd2UgcG9ydCwgZWFjaCBjYXNlXG4gKiBnZXRzIHVuaXQtdGVzdGVkLiBXaGVuIGV2ZXJ5IGNhc2UgaXMgaW1wbGVtZW50ZWQgYW5kIHRlc3RlZCwgdjUuMSdzIHJ1bi5qc1xuICogY2FuIGJlIGRlbGV0ZWQuXG4gKlxuICogUnVsZXMgZm9yIHRoaXMgZmlsZTpcbiAqICAgMS4gTkVWRVIgaW1wb3J0IGZyb20gRE9NLCBuZXR3b3JrLCBvciBhbmltYXRpb24gbW9kdWxlcy5cbiAqICAgMi4gTkVWRVIgbXV0YXRlIGBzdGF0ZWAgXHUyMDE0IGFsd2F5cyByZXR1cm4gYSBuZXcgb2JqZWN0LlxuICogICAzLiBORVZFUiBjYWxsIE1hdGgucmFuZG9tIFx1MjAxNCB1c2UgdGhlIGBybmdgIHBhcmFtZXRlci5cbiAqICAgNC4gTkVWRVIgdGhyb3cgb24gaW52YWxpZCBhY3Rpb25zIFx1MjAxNCByZXR1cm4gYHsgc3RhdGUsIGV2ZW50czogW10gfWBcbiAqICAgICAgYW5kIGxldCB0aGUgY2FsbGVyIGRlY2lkZS4gKFZhbGlkYXRpb24gaXMgdGhlIHNlcnZlcidzIGpvYi4pXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBBY3Rpb24gfSBmcm9tIFwiLi9hY3Rpb25zLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgS2lja1R5cGUsIFJldHVyblR5cGUgfSBmcm9tIFwiLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgdmFsaWRhdGVBY3Rpb24gfSBmcm9tIFwiLi92YWxpZGF0ZS5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi9ybmcuanNcIjtcbmltcG9ydCB7IGlzUmVndWxhclBsYXksIHJlc29sdmVSZWd1bGFyUGxheSB9IGZyb20gXCIuL3J1bGVzL3BsYXkuanNcIjtcbmltcG9ydCB7XG4gIHJlc29sdmVEZWZlbnNpdmVUcmlja1BsYXksXG4gIHJlc29sdmVGaWVsZEdvYWwsXG4gIHJlc29sdmVIYWlsTWFyeSxcbiAgcmVzb2x2ZUtpY2tvZmYsXG4gIHJlc29sdmVPZmZlbnNpdmVUcmlja1BsYXksXG4gIHJlc29sdmVQdW50LFxuICByZXNvbHZlU2FtZVBsYXksXG4gIHJlc29sdmVUd29Qb2ludENvbnZlcnNpb24sXG59IGZyb20gXCIuL3J1bGVzL3NwZWNpYWxzL2luZGV4LmpzXCI7XG5pbXBvcnQge1xuICBlbmRPdmVydGltZVBvc3Nlc3Npb24sXG4gIGlzUG9zc2Vzc2lvbkVuZGluZ0luT1QsXG4gIHN0YXJ0T3ZlcnRpbWUsXG4gIHN0YXJ0T3ZlcnRpbWVQb3NzZXNzaW9uLFxufSBmcm9tIFwiLi9ydWxlcy9vdmVydGltZS5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4vc3RhdGUuanNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBSZWR1Y2VSZXN1bHQge1xuICBzdGF0ZTogR2FtZVN0YXRlO1xuICBldmVudHM6IEV2ZW50W107XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWR1Y2Uoc3RhdGU6IEdhbWVTdGF0ZSwgYWN0aW9uOiBBY3Rpb24sIHJuZzogUm5nKTogUmVkdWNlUmVzdWx0IHtcbiAgLy8gR2F0ZSBhdCB0aGUgdG9wOiBpbnZhbGlkIGFjdGlvbnMgYXJlIHNpbGVudGx5IG5vLW9wZWQuIFNhbWUgY29udHJhY3RcbiAgLy8gYXMgdGhlIHJlZHVjZXIncyBwZXItY2FzZSBzaGFwZSBjaGVja3MgKFwiSWxsZWdhbCBwaWNrcyBhcmUgc2lsZW50bHlcbiAgLy8gbm8tb3AnZDsgdGhlIG9yY2hlc3RyYXRvciBpcyByZXNwb25zaWJsZSBmb3Igc3VyZmFjaW5nIGVycm9yc1wiKSwgYnV0XG4gIC8vIGNlbnRyYWxpemVkIHNvIGFuIHVuYXV0aGVudGljYXRlZCBETyBjbGllbnQgY2FuJ3Qgc2VuZCBhIG1hbGZvcm1lZFxuICAvLyBwYXlsb2FkIHRoYXQgc2xpcHMgcGFzdCBhIG1pc3NpbmcgY2FzZS1sZXZlbCBjaGVjay5cbiAgaWYgKHZhbGlkYXRlQWN0aW9uKHN0YXRlLCBhY3Rpb24pICE9PSBudWxsKSB7XG4gICAgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcbiAgfVxuICBjb25zdCByZXN1bHQgPSByZWR1Y2VDb3JlKHN0YXRlLCBhY3Rpb24sIHJuZyk7XG4gIHJldHVybiBhcHBseU92ZXJ0aW1lUm91dGluZyhzdGF0ZSwgcmVzdWx0KTtcbn1cblxuLyoqXG4gKiBJZiB3ZSdyZSBpbiBPVCBhbmQgYSBwb3NzZXNzaW9uLWVuZGluZyBldmVudCBqdXN0IGZpcmVkLCByb3V0ZSB0byB0aGVcbiAqIG5leHQgT1QgcG9zc2Vzc2lvbiAob3IgZ2FtZSBlbmQpLiBTa2lwcyB3aGVuIHRoZSBhY3Rpb24gaXMgaXRzZWxmIGFuIE9UXG4gKiBoZWxwZXIgKHNvIHdlIGRvbid0IGRvdWJsZS1yb3V0ZSkuXG4gKi9cbmZ1bmN0aW9uIGFwcGx5T3ZlcnRpbWVSb3V0aW5nKHByZXZTdGF0ZTogR2FtZVN0YXRlLCByZXN1bHQ6IFJlZHVjZVJlc3VsdCk6IFJlZHVjZVJlc3VsdCB7XG4gIC8vIE9ubHkgY29uc2lkZXIgcm91dGluZyB3aGVuIHdlICp3ZXJlKiBpbiBPVC4gKHN0YXJ0T3ZlcnRpbWUgc2V0cyBzdGF0ZS5vdmVydGltZS4pXG4gIGlmICghcHJldlN0YXRlLm92ZXJ0aW1lICYmICFyZXN1bHQuc3RhdGUub3ZlcnRpbWUpIHJldHVybiByZXN1bHQ7XG4gIGlmICghcmVzdWx0LnN0YXRlLm92ZXJ0aW1lKSByZXR1cm4gcmVzdWx0O1xuICBpZiAoIWlzUG9zc2Vzc2lvbkVuZGluZ0luT1QocmVzdWx0LmV2ZW50cykpIHJldHVybiByZXN1bHQ7XG5cbiAgLy8gUEFUIGluIE9UOiBhIFREIHNjb3JlZCwgYnV0IHBvc3Nlc3Npb24gZG9lc24ndCBlbmQgdW50aWwgUEFULzJwdCByZXNvbHZlcy5cbiAgLy8gUEFUX0dPT0QgLyBUV09fUE9JTlRfKiBhcmUgdGhlbXNlbHZlcyBwb3NzZXNzaW9uLWVuZGluZywgc28gdGhleSBETyByb3V0ZS5cbiAgLy8gQWZ0ZXIgcG9zc2Vzc2lvbiBlbmRzLCBkZWNpZGUgbmV4dC5cbiAgY29uc3QgZW5kZWQgPSBlbmRPdmVydGltZVBvc3Nlc3Npb24ocmVzdWx0LnN0YXRlKTtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZTogZW5kZWQuc3RhdGUsXG4gICAgZXZlbnRzOiBbLi4ucmVzdWx0LmV2ZW50cywgLi4uZW5kZWQuZXZlbnRzXSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVkdWNlQ29yZShzdGF0ZTogR2FtZVN0YXRlLCBhY3Rpb246IEFjdGlvbiwgcm5nOiBSbmcpOiBSZWR1Y2VSZXN1bHQge1xuICBzd2l0Y2ggKGFjdGlvbi50eXBlKSB7XG4gICAgY2FzZSBcIlNUQVJUX0dBTUVcIjpcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgcGhhc2U6IFwiQ09JTl9UT1NTXCIsXG4gICAgICAgICAgY2xvY2s6IHtcbiAgICAgICAgICAgIC4uLnN0YXRlLmNsb2NrLFxuICAgICAgICAgICAgcXVhcnRlcjogMSxcbiAgICAgICAgICAgIHF1YXJ0ZXJMZW5ndGhNaW51dGVzOiBhY3Rpb24ucXVhcnRlckxlbmd0aE1pbnV0ZXMsXG4gICAgICAgICAgICBzZWNvbmRzUmVtYWluaW5nOiBhY3Rpb24ucXVhcnRlckxlbmd0aE1pbnV0ZXMgKiA2MCxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHBsYXllcnM6IHtcbiAgICAgICAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICAgICAgICAxOiB7IC4uLnN0YXRlLnBsYXllcnNbMV0sIHRlYW06IHsgaWQ6IGFjdGlvbi50ZWFtc1sxXSB9IH0sXG4gICAgICAgICAgICAyOiB7IC4uLnN0YXRlLnBsYXllcnNbMl0sIHRlYW06IHsgaWQ6IGFjdGlvbi50ZWFtc1syXSB9IH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgZXZlbnRzOiBbeyB0eXBlOiBcIkdBTUVfU1RBUlRFRFwiIH1dLFxuICAgICAgfTtcblxuICAgIGNhc2UgXCJDT0lOX1RPU1NfQ0FMTFwiOiB7XG4gICAgICBjb25zdCBhY3R1YWwgPSBybmcuY29pbkZsaXAoKTtcbiAgICAgIGNvbnN0IHdpbm5lciA9IGFjdGlvbi5jYWxsID09PSBhY3R1YWwgPyBhY3Rpb24ucGxheWVyIDogb3BwKGFjdGlvbi5wbGF5ZXIpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGUsXG4gICAgICAgIGV2ZW50czogW3sgdHlwZTogXCJDT0lOX1RPU1NfUkVTVUxUXCIsIHJlc3VsdDogYWN0dWFsLCB3aW5uZXIgfV0sXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJSRUNFSVZFX0NIT0lDRVwiOiB7XG4gICAgICAvLyBUaGUgY2FsbGVyJ3MgY2hvaWNlIGRldGVybWluZXMgd2hvIHJlY2VpdmVzIHRoZSBvcGVuaW5nIGtpY2tvZmYuXG4gICAgICAvLyBcInJlY2VpdmVcIiBcdTIxOTIgY2FsbGVyIHJlY2VpdmVzOyBcImRlZmVyXCIgXHUyMTkyIGNhbGxlciBraWNrcyAob3Bwb25lbnQgcmVjZWl2ZXMpLlxuICAgICAgY29uc3QgcmVjZWl2ZXIgPSBhY3Rpb24uY2hvaWNlID09PSBcInJlY2VpdmVcIiA/IGFjdGlvbi5wbGF5ZXIgOiBvcHAoYWN0aW9uLnBsYXllcik7XG4gICAgICAvLyBLaWNrZXIgaXMgdGhlIG9wZW5pbmcgb2ZmZW5zZSAodGhleSBraWNrIG9mZik7IHJlY2VpdmVyIGdldHMgdGhlIGJhbGwgYWZ0ZXIuXG4gICAgICBjb25zdCBraWNrZXIgPSBvcHAocmVjZWl2ZXIpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGU6IHtcbiAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICBwaGFzZTogXCJLSUNLT0ZGXCIsXG4gICAgICAgICAgb3BlbmluZ1JlY2VpdmVyOiByZWNlaXZlcixcbiAgICAgICAgICBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZToga2lja2VyIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGV2ZW50czogW3sgdHlwZTogXCJLSUNLT0ZGXCIsIHJlY2VpdmluZ1BsYXllcjogcmVjZWl2ZXIsIGJhbGxPbjogMzUgfV0sXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJSRVNPTFZFX0tJQ0tPRkZcIjoge1xuICAgICAgY29uc3Qgb3B0czogeyBraWNrVHlwZT86IEtpY2tUeXBlOyByZXR1cm5UeXBlPzogUmV0dXJuVHlwZSB9ID0ge307XG4gICAgICBpZiAoYWN0aW9uLmtpY2tUeXBlKSBvcHRzLmtpY2tUeXBlID0gYWN0aW9uLmtpY2tUeXBlO1xuICAgICAgaWYgKGFjdGlvbi5yZXR1cm5UeXBlKSBvcHRzLnJldHVyblR5cGUgPSBhY3Rpb24ucmV0dXJuVHlwZTtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHJlc29sdmVLaWNrb2ZmKHN0YXRlLCBybmcsIG9wdHMpO1xuICAgICAgcmV0dXJuIHsgc3RhdGU6IHJlc3VsdC5zdGF0ZSwgZXZlbnRzOiByZXN1bHQuZXZlbnRzIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIlNUQVJUX09UX1BPU1NFU1NJT05cIjoge1xuICAgICAgY29uc3QgciA9IHN0YXJ0T3ZlcnRpbWVQb3NzZXNzaW9uKHN0YXRlKTtcbiAgICAgIHJldHVybiB7IHN0YXRlOiByLnN0YXRlLCBldmVudHM6IHIuZXZlbnRzIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIlBJQ0tfUExBWVwiOiB7XG4gICAgICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgICAgIGNvbnN0IGlzT2ZmZW5zaXZlQ2FsbCA9IGFjdGlvbi5wbGF5ZXIgPT09IG9mZmVuc2U7XG5cbiAgICAgIC8vIFZhbGlkYXRlLiBJbGxlZ2FsIHBpY2tzIGFyZSBzaWxlbnRseSBuby1vcCdkOyB0aGUgb3JjaGVzdHJhdG9yXG4gICAgICAvLyAoc2VydmVyIC8gVUkpIGlzIHJlc3BvbnNpYmxlIGZvciBzdXJmYWNpbmcgdGhlIGVycm9yIHRvIHRoZSB1c2VyLlxuICAgICAgaWYgKGFjdGlvbi5wbGF5ID09PSBcIkZHXCIgfHwgYWN0aW9uLnBsYXkgPT09IFwiUFVOVFwiIHx8IGFjdGlvbi5wbGF5ID09PSBcIlRXT19QVFwiKSB7XG4gICAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07IC8vIHdyb25nIGFjdGlvbiB0eXBlIGZvciB0aGVzZVxuICAgICAgfVxuICAgICAgaWYgKGFjdGlvbi5wbGF5ID09PSBcIkhNXCIgJiYgIWlzT2ZmZW5zaXZlQ2FsbCkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9OyAvLyBkZWZlbnNlIGNhbid0IGNhbGwgSGFpbCBNYXJ5XG4gICAgICB9XG4gICAgICBjb25zdCBoYW5kID0gc3RhdGUucGxheWVyc1thY3Rpb24ucGxheWVyXS5oYW5kO1xuICAgICAgaWYgKGFjdGlvbi5wbGF5ID09PSBcIkhNXCIgJiYgaGFuZC5ITSA8PSAwKSB7XG4gICAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gICAgICB9XG4gICAgICBpZiAoXG4gICAgICAgIChhY3Rpb24ucGxheSA9PT0gXCJTUlwiIHx8IGFjdGlvbi5wbGF5ID09PSBcIkxSXCIgfHwgYWN0aW9uLnBsYXkgPT09IFwiU1BcIiB8fCBhY3Rpb24ucGxheSA9PT0gXCJMUFwiIHx8IGFjdGlvbi5wbGF5ID09PSBcIlRQXCIpICYmXG4gICAgICAgIGhhbmRbYWN0aW9uLnBsYXldIDw9IDBcbiAgICAgICkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgfVxuICAgICAgLy8gUmVqZWN0IHJlLXBpY2tzIGZvciB0aGUgc2FtZSBzaWRlIGluIHRoZSBzYW1lIHBsYXkuXG4gICAgICBpZiAoaXNPZmZlbnNpdmVDYWxsICYmIHN0YXRlLnBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5KSB7XG4gICAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gICAgICB9XG4gICAgICBpZiAoIWlzT2ZmZW5zaXZlQ2FsbCAmJiBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgfVxuXG4gICAgICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXG4gICAgICAgIHsgdHlwZTogXCJQTEFZX0NBTExFRFwiLCBwbGF5ZXI6IGFjdGlvbi5wbGF5ZXIsIHBsYXk6IGFjdGlvbi5wbGF5IH0sXG4gICAgICBdO1xuXG4gICAgICBjb25zdCBwZW5kaW5nUGljayA9IHtcbiAgICAgICAgb2ZmZW5zZVBsYXk6IGlzT2ZmZW5zaXZlQ2FsbCA/IGFjdGlvbi5wbGF5IDogc3RhdGUucGVuZGluZ1BpY2sub2ZmZW5zZVBsYXksXG4gICAgICAgIGRlZmVuc2VQbGF5OiBpc09mZmVuc2l2ZUNhbGwgPyBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA6IGFjdGlvbi5wbGF5LFxuICAgICAgfTtcblxuICAgICAgLy8gQm90aCB0ZWFtcyBoYXZlIHBpY2tlZCBcdTIwMTQgcmVzb2x2ZS5cbiAgICAgIGlmIChwZW5kaW5nUGljay5vZmZlbnNlUGxheSAmJiBwZW5kaW5nUGljay5kZWZlbnNlUGxheSkge1xuICAgICAgICAvLyAyLXBvaW50IGNvbnZlcnNpb246IFBJQ0tfUExBWSBpbiBUV09fUFRfQ09OViBwaGFzZSByb3V0ZXMgdG8gdGhlXG4gICAgICAgIC8vIGRlZGljYXRlZCAyLXB0IHJlc29sdmVyIChzY29yaW5nIGNhcHBlZCBhdCAyIHB0cywgbm8gUEFUIGN5Y2xlKS5cbiAgICAgICAgLy8gVFAvSE0gb24gYSAyLXB0IHRyeSBhcmUgY29lcmNlZCB0byBTUiBzbyB0aGV5IGNhbid0IG1pcy1zY29yZTpcbiAgICAgICAgLy8gb3RoZXJ3aXNlIGEgVFAgdGhhdCBkZWZhdWx0cyB0byBMUiBhbmQgY3Jvc3NlcyB0aGUgZ29hbCBsaW5lIHdvdWxkXG4gICAgICAgIC8vIHJ1biB0aHJvdWdoIGFwcGx5WWFyZGFnZU91dGNvbWUgYW5kIGVtaXQgVE9VQ0hET1dOICsgdHJhbnNpdGlvbiB0b1xuICAgICAgICAvLyBQQVRfQ0hPSUNFLCBncmFudGluZyA2IHBvaW50cyBhbmQgYSBmdWxsIFBBVCBpbnN0ZWFkIG9mIDIuXG4gICAgICAgIGlmIChzdGF0ZS5waGFzZSA9PT0gXCJUV09fUFRfQ09OVlwiKSB7XG4gICAgICAgICAgY29uc3Qgb2ZmUGxheSA9IGlzUmVndWxhclBsYXkocGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkpXG4gICAgICAgICAgICA/IHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5XG4gICAgICAgICAgICA6IFwiU1JcIjtcbiAgICAgICAgICBjb25zdCBkZWZQbGF5ID0gaXNSZWd1bGFyUGxheShwZW5kaW5nUGljay5kZWZlbnNlUGxheSlcbiAgICAgICAgICAgID8gcGVuZGluZ1BpY2suZGVmZW5zZVBsYXlcbiAgICAgICAgICAgIDogXCJTUlwiO1xuICAgICAgICAgIGNvbnN0IHN0YXRlV2l0aFBpY2s6IEdhbWVTdGF0ZSA9IHtcbiAgICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgICAgcGVuZGluZ1BpY2s6IHsgb2ZmZW5zZVBsYXk6IG9mZlBsYXksIGRlZmVuc2VQbGF5OiBkZWZQbGF5IH0sXG4gICAgICAgICAgfTtcbiAgICAgICAgICBjb25zdCB0cCA9IHJlc29sdmVUd29Qb2ludENvbnZlcnNpb24oXG4gICAgICAgICAgICBzdGF0ZVdpdGhQaWNrLFxuICAgICAgICAgICAgb2ZmUGxheSxcbiAgICAgICAgICAgIGRlZlBsYXksXG4gICAgICAgICAgICBybmcsXG4gICAgICAgICAgKTtcbiAgICAgICAgICByZXR1cm4geyBzdGF0ZTogdHAuc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4udHAuZXZlbnRzXSB9O1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc3RhdGVXaXRoUGljazogR2FtZVN0YXRlID0geyAuLi5zdGF0ZSwgcGVuZGluZ1BpY2sgfTtcblxuICAgICAgICAvLyBIYWlsIE1hcnkgYnkgb2ZmZW5zZSBcdTIwMTQgcmVzb2x2ZXMgaW1tZWRpYXRlbHksIGRlZmVuc2UgcGljayBpZ25vcmVkLlxuICAgICAgICBpZiAocGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPT09IFwiSE1cIikge1xuICAgICAgICAgIGNvbnN0IGhtID0gcmVzb2x2ZUhhaWxNYXJ5KHN0YXRlV2l0aFBpY2ssIHJuZyk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IGhtLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLmhtLmV2ZW50c10gfTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFRyaWNrIFBsYXkgYnkgZWl0aGVyIHNpZGUuIHY1LjEgKHJ1bi5qczoxODg2KTogaWYgYm90aCBwaWNrIFRQLFxuICAgICAgICAvLyBTYW1lIFBsYXkgY29pbiBhbHdheXMgdHJpZ2dlcnMgXHUyMDE0IGZhbGxzIHRocm91Z2ggdG8gU2FtZSBQbGF5IGJlbG93LlxuICAgICAgICBpZiAoXG4gICAgICAgICAgcGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPT09IFwiVFBcIiAmJlxuICAgICAgICAgIHBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5ICE9PSBcIlRQXCJcbiAgICAgICAgKSB7XG4gICAgICAgICAgY29uc3QgdHAgPSByZXNvbHZlT2ZmZW5zaXZlVHJpY2tQbGF5KHN0YXRlV2l0aFBpY2ssIHJuZyk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHRwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLnRwLmV2ZW50c10gfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoXG4gICAgICAgICAgcGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgPT09IFwiVFBcIiAmJlxuICAgICAgICAgIHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ICE9PSBcIlRQXCJcbiAgICAgICAgKSB7XG4gICAgICAgICAgY29uc3QgdHAgPSByZXNvbHZlRGVmZW5zaXZlVHJpY2tQbGF5KHN0YXRlV2l0aFBpY2ssIHJuZyk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHRwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLnRwLmV2ZW50c10gfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPT09IFwiVFBcIiAmJiBwZW5kaW5nUGljay5kZWZlbnNlUGxheSA9PT0gXCJUUFwiKSB7XG4gICAgICAgICAgLy8gQm90aCBUUCBcdTIxOTIgU2FtZSBQbGF5IHVuY29uZGl0aW9uYWxseS5cbiAgICAgICAgICBjb25zdCBzcCA9IHJlc29sdmVTYW1lUGxheShzdGF0ZVdpdGhQaWNrLCBybmcpO1xuICAgICAgICAgIHJldHVybiB7IHN0YXRlOiBzcC5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi5zcC5ldmVudHNdIH07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZWd1bGFyIHZzIHJlZ3VsYXIuXG4gICAgICAgIGlmIChcbiAgICAgICAgICBpc1JlZ3VsYXJQbGF5KHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5KSAmJlxuICAgICAgICAgIGlzUmVndWxhclBsYXkocGVuZGluZ1BpY2suZGVmZW5zZVBsYXkpXG4gICAgICAgICkge1xuICAgICAgICAgIC8vIFNhbWUgcGxheT8gNTAvNTAgY2hhbmNlIHRvIHRyaWdnZXIgU2FtZSBQbGF5IG1lY2hhbmlzbS5cbiAgICAgICAgICAvLyBTb3VyY2U6IHJ1bi5qczoxODg2IChgaWYgKHBsMSA9PT0gcGwyKWApLlxuICAgICAgICAgIGlmIChwZW5kaW5nUGljay5vZmZlbnNlUGxheSA9PT0gcGVuZGluZ1BpY2suZGVmZW5zZVBsYXkpIHtcbiAgICAgICAgICAgIGNvbnN0IHRyaWdnZXIgPSBybmcuY29pbkZsaXAoKTtcbiAgICAgICAgICAgIGlmICh0cmlnZ2VyID09PSBcImhlYWRzXCIpIHtcbiAgICAgICAgICAgICAgY29uc3Qgc3AgPSByZXNvbHZlU2FtZVBsYXkoc3RhdGVXaXRoUGljaywgcm5nKTtcbiAgICAgICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHNwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLnNwLmV2ZW50c10gfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIFRhaWxzOiBmYWxsIHRocm91Z2ggdG8gcmVndWxhciByZXNvbHV0aW9uIChxdWFsaXR5IDUgb3V0Y29tZSkuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgcmVzb2x2ZWQgPSByZXNvbHZlUmVndWxhclBsYXkoXG4gICAgICAgICAgICBzdGF0ZVdpdGhQaWNrLFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBvZmZlbnNlUGxheTogcGVuZGluZ1BpY2sub2ZmZW5zZVBsYXksXG4gICAgICAgICAgICAgIGRlZmVuc2VQbGF5OiBwZW5kaW5nUGljay5kZWZlbnNlUGxheSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBybmcsXG4gICAgICAgICAgKTtcbiAgICAgICAgICByZXR1cm4geyBzdGF0ZTogcmVzb2x2ZWQuc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4ucmVzb2x2ZWQuZXZlbnRzXSB9O1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRGVmZW5zaXZlIHRyaWNrIHBsYXksIEZHLCBQVU5ULCBUV09fUFQgcGlja3MgXHUyMDE0IG5vdCByb3V0ZWQgaGVyZSB5ZXQuXG4gICAgICAgIC8vIEZHL1BVTlQvVFdPX1BUIGFyZSBkcml2ZW4gYnkgRk9VUlRIX0RPV05fQ0hPSUNFIC8gUEFUX0NIT0lDRSBhY3Rpb25zLFxuICAgICAgICAvLyBub3QgYnkgUElDS19QTEFZLiBEZWZlbnNpdmUgVFAgaXMgYSBUT0RPLlxuICAgICAgICByZXR1cm4geyBzdGF0ZTogc3RhdGVXaXRoUGljaywgZXZlbnRzIH07XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7IHN0YXRlOiB7IC4uLnN0YXRlLCBwZW5kaW5nUGljayB9LCBldmVudHMgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiQ0FMTF9USU1FT1VUXCI6IHtcbiAgICAgIGNvbnN0IHAgPSBzdGF0ZS5wbGF5ZXJzW2FjdGlvbi5wbGF5ZXJdO1xuICAgICAgaWYgKHAudGltZW91dHMgPD0gMCkgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcbiAgICAgIGNvbnN0IHJlbWFpbmluZyA9IHAudGltZW91dHMgLSAxO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGU6IHtcbiAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICBwbGF5ZXJzOiB7XG4gICAgICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICAgICAgW2FjdGlvbi5wbGF5ZXJdOiB7IC4uLnAsIHRpbWVvdXRzOiByZW1haW5pbmcgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBldmVudHM6IFt7IHR5cGU6IFwiVElNRU9VVF9DQUxMRURcIiwgcGxheWVyOiBhY3Rpb24ucGxheWVyLCByZW1haW5pbmcgfV0sXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJBQ0NFUFRfUEVOQUxUWVwiOiB7XG4gICAgICBjb25zdCBwcCA9IHN0YXRlLnBlbmRpbmdQZW5hbHR5O1xuICAgICAgaWYgKCFwcCkgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcbiAgICAgIC8vIEFwcGx5IHlhcmRzOiBiZW5lZmljaWFyeSBhZHZhbmNlcyB0b3dhcmQgdGhlaXIgZ29hbC4gWWFyZHMgYXJlXG4gICAgICAvLyBjYXBwZWQgYXQgaGFsZi1kaXN0YW5jZS10by1nb2FsIHdoZW4gdGhlIHJhdyB5YXJkcyB3b3VsZCBwdXNoXG4gICAgICAvLyBwYXN0IHRoZSBvcHBvc2luZyBnb2FsIGxpbmUuIERpcmVjdGlvbiBpcyBpbiB0aGUgYmVuZWZpY2lhcnknc1xuICAgICAgLy8gUE9WIFx1MjAxNCBidXQgYmFsbE9uIGlzIGFsd2F5cyBpbiB0aGUgb2ZmZW5zZSdzIFBPViwgc28gd2UgaGF2ZVxuICAgICAgLy8gdG8gdHJhbnNsYXRlIHdoZW4gdGhlIGJlbmVmaWNpYXJ5IGlzIHRoZSBkZWZlbnNlLlxuICAgICAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gICAgICBjb25zdCBpc09mZmVuc2VCZW5lZmljaWFyeSA9IHBwLmJlbmVmaWNpYXJ5ID09PSBvZmZlbnNlO1xuICAgICAgY29uc3QgcHJlQmFsbE9uID0gcHAucHJlU3RhdGUuYmFsbE9uO1xuICAgICAgLy8gSGFsZi10by1nb2FsIGNhcCBmb3IgdGhlIGJlbmVmaWNpYXJ5IHNpZGUuIEluIG9mZmVuc2UgUE9WOiBpZlxuICAgICAgLy8gb2ZmZW5zZSBiZW5lZml0cywgY2FwIHNvIG5ld0JhbGxPbiA8PSA5OTsgaWYgZGVmZW5zZSBiZW5lZml0cyxcbiAgICAgIC8vIG5ld0JhbGxPbiB3b3VsZCBtaXJyb3IgdG8gMTAwIC0gKHRoZWlyIGdvYWwgbGluZSkgb24gYWNjZXB0LlxuICAgICAgY29uc3QgcmF3WWFyZHMgPSBwcC55YXJkcztcbiAgICAgIGNvbnN0IHlhcmRzID0gaXNPZmZlbnNlQmVuZWZpY2lhcnlcbiAgICAgICAgPyBwcmVCYWxsT24gKyByYXdZYXJkcyA+IDk5XG4gICAgICAgICAgPyBNYXRoLnRydW5jKCgxMDAgLSBwcmVCYWxsT24pIC8gMilcbiAgICAgICAgICA6IHJhd1lhcmRzXG4gICAgICAgIDogcHJlQmFsbE9uIC0gcmF3WWFyZHMgPCAxXG4gICAgICAgICAgPyBNYXRoLnRydW5jKHByZUJhbGxPbiAvIDIpXG4gICAgICAgICAgOiByYXdZYXJkcztcbiAgICAgIGNvbnN0IG5ld0JhbGxPbiA9IGlzT2ZmZW5zZUJlbmVmaWNpYXJ5XG4gICAgICAgID8gTWF0aC5taW4oMTAwLCBwcmVCYWxsT24gKyB5YXJkcylcbiAgICAgICAgOiBNYXRoLm1heCgwLCBwcmVCYWxsT24gLSB5YXJkcyk7XG4gICAgICAvLyBSLTI1OiBwZW5hbHR5IGNyb3NzZXMgZmlyc3QtZG93biBtYXJrZXIgXHUyMTkyIGF1dG9tYXRpYyBmaXJzdCBkb3duLlxuICAgICAgLy8gUi0yNjogcGVuYWx0eSBvbiBvZmZlbnNlIGRvZXNuJ3QgcmVzZXQgZmlyc3QtZG93biBtYXJrZXIuXG4gICAgICBsZXQgbmV4dERvd246IDEgfCAyIHwgMyB8IDQgPSBwcC5wcmVTdGF0ZS5kb3duO1xuICAgICAgbGV0IG5leHRGaXJzdERvd25BdCA9IHBwLnByZVN0YXRlLmZpcnN0RG93bkF0O1xuICAgICAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG4gICAgICBpZiAoaXNPZmZlbnNlQmVuZWZpY2lhcnkpIHtcbiAgICAgICAgY29uc3QgcmVhY2hlZEZpcnN0RG93biA9IG5ld0JhbGxPbiA+PSBwcC5wcmVTdGF0ZS5maXJzdERvd25BdDtcbiAgICAgICAgaWYgKHJlYWNoZWRGaXJzdERvd24pIHtcbiAgICAgICAgICBuZXh0RG93biA9IDE7XG4gICAgICAgICAgbmV4dEZpcnN0RG93bkF0ID0gTWF0aC5taW4oMTAwLCBuZXdCYWxsT24gKyAxMCk7XG4gICAgICAgICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkZJUlNUX0RPV05cIiB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gTG9zcy1vZi1kb3duOiBhZHZhbmNlIHRoZSBkb3duIChvciB0cmlnZ2VyIHR1cm5vdmVyLW9uLWRvd25zIGF0IDQpLlxuICAgICAgaWYgKHBwLmxvc3NPZkRvd24pIHtcbiAgICAgICAgaWYgKG5leHREb3duID49IDQpIHtcbiAgICAgICAgICAvLyBUdXJub3Zlci1vbi1kb3duczogaGFuZGxlZCBvdXQtb2YtYmFuZDsgZm9yIG5vdyBqdXN0IGFkdmFuY2UuXG4gICAgICAgICAgbmV4dERvd24gPSA0O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG5leHREb3duID0gKG5leHREb3duICsgMSkgYXMgMSB8IDIgfCAzIHwgNDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gUGhhc2UgcmV0dXJucyB0byB3aGljaGV2ZXIgcGxheSBwaGFzZSB3ZSBjYW1lIGZyb20uIERlZmF1bHQgdG9cbiAgICAgIC8vIE9UX1BMQVkgaWYgdGhlIGdhbWUgaXMgaW4gb3ZlcnRpbWU7IGVsc2UgUkVHX1BMQVkuXG4gICAgICBjb25zdCBuZXh0UGhhc2U6IEdhbWVTdGF0ZVtcInBoYXNlXCJdID0gc3RhdGUub3ZlcnRpbWUgPyBcIk9UX1BMQVlcIiA6IFwiUkVHX1BMQVlcIjtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgcGhhc2U6IG5leHRQaGFzZSxcbiAgICAgICAgICBwZW5kaW5nUGVuYWx0eTogbnVsbCxcbiAgICAgICAgICBmaWVsZDoge1xuICAgICAgICAgICAgLi4uc3RhdGUuZmllbGQsXG4gICAgICAgICAgICBiYWxsT246IG5ld0JhbGxPbixcbiAgICAgICAgICAgIGRvd246IG5leHREb3duLFxuICAgICAgICAgICAgZmlyc3REb3duQXQ6IG5leHRGaXJzdERvd25BdCxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBldmVudHMsXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJERUNMSU5FX1BFTkFMVFlcIjoge1xuICAgICAgLy8gRGVjbGluZSA9IHRha2UgdGhlIHBsYXkncyBuYXR1cmFsIG91dGNvbWUsIHdoaWNoIG1lYW5zIGxlYXZpbmdcbiAgICAgIC8vIHRoZSBjdXJyZW50IHN0YXRlLmZpZWxkIGFzLWlzICh0aGUgcmVzb2x2ZXIgYXBwbGllZCB0aGUgcGxheVxuICAgICAgLy8gb3V0Y29tZSBCRUZPUkUgZmxhZ2dpbmcgdGhlIHBlbmFsdHkgZm9yIGNob2ljZSkuIFRoZSBwZW5kaW5nUGVuYWx0eVxuICAgICAgLy8gZGVzY3JpcHRvcidzIHByZVN0YXRlIGlzIGZvciBBQ0NFUFQgb25seSBcdTIwMTQgREVDTElORSBkb2Vzbid0IHJldmVydC5cbiAgICAgIGlmICghc3RhdGUucGVuZGluZ1BlbmFsdHkpIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gICAgICBjb25zdCBuZXh0UGhhc2U6IEdhbWVTdGF0ZVtcInBoYXNlXCJdID0gc3RhdGUub3ZlcnRpbWUgPyBcIk9UX1BMQVlcIiA6IFwiUkVHX1BMQVlcIjtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgcGhhc2U6IG5leHRQaGFzZSxcbiAgICAgICAgICBwZW5kaW5nUGVuYWx0eTogbnVsbCxcbiAgICAgICAgfSxcbiAgICAgICAgZXZlbnRzOiBbXSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIlBBVF9DSE9JQ0VcIjoge1xuICAgICAgY29uc3Qgc2NvcmVyID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgICAgIC8vIDNPVCsgcmVxdWlyZXMgMi1wb2ludCBjb252ZXJzaW9uLiBTaWxlbnRseSBzdWJzdGl0dXRlIGV2ZW4gaWYgXCJraWNrXCJcbiAgICAgIC8vIHdhcyBzZW50IChtYXRjaGVzIHY1LjEncyBcIm11c3RcIiBiZWhhdmlvciBhdCBydW4uanM6MTY0MSkuXG4gICAgICBjb25zdCBlZmZlY3RpdmVDaG9pY2UgPVxuICAgICAgICBzdGF0ZS5vdmVydGltZSAmJiBzdGF0ZS5vdmVydGltZS5wZXJpb2QgPj0gM1xuICAgICAgICAgID8gXCJ0d29fcG9pbnRcIlxuICAgICAgICAgIDogYWN0aW9uLmNob2ljZTtcbiAgICAgIGlmIChlZmZlY3RpdmVDaG9pY2UgPT09IFwia2lja1wiKSB7XG4gICAgICAgIC8vIEFzc3VtZSBhdXRvbWF0aWMgaW4gdjUuMSBcdTIwMTQgbm8gbWVjaGFuaWMgcmVjb3JkZWQgZm9yIFBBVCBraWNrcy5cbiAgICAgICAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICAgIFtzY29yZXJdOiB7IC4uLnN0YXRlLnBsYXllcnNbc2NvcmVyXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbc2NvcmVyXS5zY29yZSArIDEgfSxcbiAgICAgICAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICAgICAgICBwaGFzZTogXCJLSUNLT0ZGXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBldmVudHM6IFt7IHR5cGU6IFwiUEFUX0dPT0RcIiwgcGxheWVyOiBzY29yZXIgfV0sXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICAvLyB0d29fcG9pbnQgXHUyMTkyIHRyYW5zaXRpb24gdG8gVFdPX1BUX0NPTlYgcGhhc2U7IGEgUElDS19QTEFZIHJlc29sdmVzIGl0LlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGU6IHtcbiAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICBwaGFzZTogXCJUV09fUFRfQ09OVlwiLFxuICAgICAgICAgIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBiYWxsT246IDk3LCBmaXJzdERvd25BdDogMTAwLCBkb3duOiAxIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGV2ZW50czogW10sXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJGT1VSVEhfRE9XTl9DSE9JQ0VcIjoge1xuICAgICAgaWYgKGFjdGlvbi5jaG9pY2UgPT09IFwiZ29cIikge1xuICAgICAgICAvLyBOb3RoaW5nIHRvIGRvIFx1MjAxNCB0aGUgbmV4dCBQSUNLX1BMQVkgd2lsbCByZXNvbHZlIG5vcm1hbGx5IGZyb20gNHRoIGRvd24uXG4gICAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gICAgICB9XG4gICAgICBpZiAoYWN0aW9uLmNob2ljZSA9PT0gXCJwdW50XCIpIHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gcmVzb2x2ZVB1bnQoc3RhdGUsIHJuZyk7XG4gICAgICAgIHJldHVybiB7IHN0YXRlOiByZXN1bHQuc3RhdGUsIGV2ZW50czogcmVzdWx0LmV2ZW50cyB9O1xuICAgICAgfVxuICAgICAgLy8gZmdcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHJlc29sdmVGaWVsZEdvYWwoc3RhdGUsIHJuZyk7XG4gICAgICByZXR1cm4geyBzdGF0ZTogcmVzdWx0LnN0YXRlLCBldmVudHM6IHJlc3VsdC5ldmVudHMgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiRk9SRkVJVFwiOiB7XG4gICAgICBjb25zdCB3aW5uZXIgPSBvcHAoYWN0aW9uLnBsYXllcik7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0ZTogeyAuLi5zdGF0ZSwgcGhhc2U6IFwiR0FNRV9PVkVSXCIgfSxcbiAgICAgICAgZXZlbnRzOiBbeyB0eXBlOiBcIkdBTUVfT1ZFUlwiLCB3aW5uZXIgfV0sXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJUSUNLX0NMT0NLXCI6IHtcbiAgICAgIGNvbnN0IHByZXYgPSBzdGF0ZS5jbG9jay5zZWNvbmRzUmVtYWluaW5nO1xuICAgICAgY29uc3QgbmV4dCA9IE1hdGgubWF4KDAsIHByZXYgLSBhY3Rpb24uc2Vjb25kcyk7XG4gICAgICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbeyB0eXBlOiBcIkNMT0NLX1RJQ0tFRFwiLCBzZWNvbmRzOiBhY3Rpb24uc2Vjb25kcyB9XTtcblxuICAgICAgLy8gVHdvLW1pbnV0ZSB3YXJuaW5nOiBjcm9zc2luZyAxMjAgc2Vjb25kcyBpbiBRMiBvciBRNCB0cmlnZ2VycyBhbiBldmVudC5cbiAgICAgIGlmIChcbiAgICAgICAgKHN0YXRlLmNsb2NrLnF1YXJ0ZXIgPT09IDIgfHwgc3RhdGUuY2xvY2sucXVhcnRlciA9PT0gNCkgJiZcbiAgICAgICAgcHJldiA+IDEyMCAmJlxuICAgICAgICBuZXh0IDw9IDEyMFxuICAgICAgKSB7XG4gICAgICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUV09fTUlOVVRFX1dBUk5JTkdcIiB9KTtcbiAgICAgIH1cblxuICAgICAgLy8gUi0yOCBaZXJvLXNlY29uZCBwbGF5OiB3aGVuIHRoZSBjbG9jayBmaXJzdCBoaXRzIDAgKHByZXYgPiAwLFxuICAgICAgLy8gbmV4dCA9PT0gMCksIGVtaXQgTEFTVF9DSEFOQ0VfVE9fT0ZGRVJFRCBhbmQgaG9sZCB0aGUgcXVhcnRlclxuICAgICAgLy8gb3Blbi4gQSBmaW5hbCBwbGF5IHJ1bnMgYXQgMDowMDsgdGhlIHF1YXJ0ZXIgYWN0dWFsbHkgZW5kcyBvblxuICAgICAgLy8gdGhlIE5FWFQgbm9uLXplcm8gdGljayAocHJldiA9PT0gMCAmJiBhY3Rpb24uc2Vjb25kcyA+IDApLlxuICAgICAgLy8gQSBUTyBjYWxsZWQgZHVyaW5nIHRoZSAwOjAwIHBsYXkgZGlzcGF0Y2hlcyBUSUNLX0NMT0NLKDApIGZyb21cbiAgICAgIC8vIHRoZSBkcml2ZXIsIHdoaWNoIGxlYXZlcyB0aGUgY2xvY2sgYXQgMCB3aXRob3V0IHRyYW5zaXRpb25pbmcuXG4gICAgICBpZiAocHJldiA+IDAgJiYgbmV4dCA9PT0gMCkge1xuICAgICAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiTEFTVF9DSEFOQ0VfVE9fT0ZGRVJFRFwiLCBxdWFydGVyOiBzdGF0ZS5jbG9jay5xdWFydGVyIH0pO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHN0YXRlOiB7IC4uLnN0YXRlLCBjbG9jazogeyAuLi5zdGF0ZS5jbG9jaywgc2Vjb25kc1JlbWFpbmluZzogMCB9IH0sXG4gICAgICAgICAgZXZlbnRzLFxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICAvLyBDbG9jayB3YXMgYWxyZWFkeSBhdCAwIGFuZCBhIG5vbi16ZXJvIHRpY2sgd2FzIGRpc3BhdGNoZWQgXHUyMTkyIHRoZVxuICAgICAgLy8gZmluYWwtcGxheSB3aW5kb3cgaXMgY2xvc2VkLCBxdWFydGVyIGFjdHVhbGx5IGVuZHMgbm93LlxuICAgICAgaWYgKHByZXYgPT09IDAgJiYgYWN0aW9uLnNlY29uZHMgPiAwKSB7XG4gICAgICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJRVUFSVEVSX0VOREVEXCIsIHF1YXJ0ZXI6IHN0YXRlLmNsb2NrLnF1YXJ0ZXIgfSk7XG4gICAgICAgIC8vIFExXHUyMTkyUTIgYW5kIFEzXHUyMTkyUTQ6IHJvbGwgb3ZlciBjbG9jaywgc2FtZSBoYWxmLCBzYW1lIHBvc3Nlc3Npb24gY29udGludWVzLlxuICAgICAgICBpZiAoc3RhdGUuY2xvY2sucXVhcnRlciA9PT0gMSB8fCBzdGF0ZS5jbG9jay5xdWFydGVyID09PSAzKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgICAgICBjbG9jazoge1xuICAgICAgICAgICAgICAgIC4uLnN0YXRlLmNsb2NrLFxuICAgICAgICAgICAgICAgIHF1YXJ0ZXI6IHN0YXRlLmNsb2NrLnF1YXJ0ZXIgKyAxLFxuICAgICAgICAgICAgICAgIHNlY29uZHNSZW1haW5pbmc6IHN0YXRlLmNsb2NrLnF1YXJ0ZXJMZW5ndGhNaW51dGVzICogNjAsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZXZlbnRzLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgLy8gRW5kIG9mIFEyID0gaGFsZnRpbWUuIFE0IGVuZCA9IHJlZ3VsYXRpb24gb3Zlci5cbiAgICAgICAgaWYgKHN0YXRlLmNsb2NrLnF1YXJ0ZXIgPT09IDIpIHtcbiAgICAgICAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiSEFMRl9FTkRFRFwiIH0pO1xuICAgICAgICAgIC8vIFJlY2VpdmVyIG9mIG9wZW5pbmcga2lja29mZiBraWNrcyB0aGUgc2Vjb25kIGhhbGY7IGZsaXAgcG9zc2Vzc2lvbi5cbiAgICAgICAgICBjb25zdCBzZWNvbmRIYWxmUmVjZWl2ZXIgPVxuICAgICAgICAgICAgc3RhdGUub3BlbmluZ1JlY2VpdmVyID09PSBudWxsID8gMSA6IG9wcChzdGF0ZS5vcGVuaW5nUmVjZWl2ZXIpO1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0ZToge1xuICAgICAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgICAgICAgICAgICBjbG9jazoge1xuICAgICAgICAgICAgICAgIC4uLnN0YXRlLmNsb2NrLFxuICAgICAgICAgICAgICAgIHF1YXJ0ZXI6IDMsXG4gICAgICAgICAgICAgICAgc2Vjb25kc1JlbWFpbmluZzogc3RhdGUuY2xvY2sucXVhcnRlckxlbmd0aE1pbnV0ZXMgKiA2MCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IG9wcChzZWNvbmRIYWxmUmVjZWl2ZXIpIH0sXG4gICAgICAgICAgICAgIC8vIFJlZnJlc2ggdGltZW91dHMgZm9yIG5ldyBoYWxmLlxuICAgICAgICAgICAgICBwbGF5ZXJzOiB7XG4gICAgICAgICAgICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgICAgICAgICAgICAxOiB7IC4uLnN0YXRlLnBsYXllcnNbMV0sIHRpbWVvdXRzOiAzIH0sXG4gICAgICAgICAgICAgICAgMjogeyAuLi5zdGF0ZS5wbGF5ZXJzWzJdLCB0aW1lb3V0czogMyB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGV2ZW50cyxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIC8vIFE0IGVuZGVkLlxuICAgICAgICBjb25zdCBwMSA9IHN0YXRlLnBsYXllcnNbMV0uc2NvcmU7XG4gICAgICAgIGNvbnN0IHAyID0gc3RhdGUucGxheWVyc1syXS5zY29yZTtcbiAgICAgICAgaWYgKHAxICE9PSBwMikge1xuICAgICAgICAgIGNvbnN0IHdpbm5lciA9IHAxID4gcDIgPyAxIDogMjtcbiAgICAgICAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiR0FNRV9PVkVSXCIsIHdpbm5lciB9KTtcbiAgICAgICAgICByZXR1cm4geyBzdGF0ZTogeyAuLi5zdGF0ZSwgcGhhc2U6IFwiR0FNRV9PVkVSXCIgfSwgZXZlbnRzIH07XG4gICAgICAgIH1cbiAgICAgICAgLy8gVGllZCBcdTIwMTQgaGVhZCB0byBvdmVydGltZS5cbiAgICAgICAgY29uc3Qgb3RDbG9jayA9IHsgLi4uc3RhdGUuY2xvY2ssIHF1YXJ0ZXI6IDUsIHNlY29uZHNSZW1haW5pbmc6IDAgfTtcbiAgICAgICAgY29uc3Qgb3QgPSBzdGFydE92ZXJ0aW1lKHsgLi4uc3RhdGUsIGNsb2NrOiBvdENsb2NrIH0pO1xuICAgICAgICBldmVudHMucHVzaCguLi5vdC5ldmVudHMpO1xuICAgICAgICByZXR1cm4geyBzdGF0ZTogb3Quc3RhdGUsIGV2ZW50cyB9O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0ZTogeyAuLi5zdGF0ZSwgY2xvY2s6IHsgLi4uc3RhdGUuY2xvY2ssIHNlY29uZHNSZW1haW5pbmc6IG5leHQgfSB9LFxuICAgICAgICBldmVudHMsXG4gICAgICB9O1xuICAgIH1cblxuICAgIGRlZmF1bHQ6IHtcbiAgICAgIC8vIEV4aGF1c3RpdmVuZXNzIGNoZWNrIFx1MjAxNCBhZGRpbmcgYSBuZXcgQWN0aW9uIHZhcmlhbnQgd2l0aG91dCBoYW5kbGluZyBpdFxuICAgICAgLy8gaGVyZSB3aWxsIHByb2R1Y2UgYSBjb21waWxlIGVycm9yLlxuICAgICAgY29uc3QgX2V4aGF1c3RpdmU6IG5ldmVyID0gYWN0aW9uO1xuICAgICAgdm9pZCBfZXhoYXVzdGl2ZTtcbiAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogQ29udmVuaWVuY2UgZm9yIHJlcGxheWluZyBhIHNlcXVlbmNlIG9mIGFjdGlvbnMgXHUyMDE0IHVzZWZ1bCBmb3IgdGVzdHMgYW5kXG4gKiBmb3Igc2VydmVyLXNpZGUgZ2FtZSByZXBsYXkgZnJvbSBhY3Rpb24gbG9nLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVkdWNlTWFueShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgYWN0aW9uczogQWN0aW9uW10sXG4gIHJuZzogUm5nLFxuKTogUmVkdWNlUmVzdWx0IHtcbiAgbGV0IGN1cnJlbnQgPSBzdGF0ZTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG4gIGZvciAoY29uc3QgYWN0aW9uIG9mIGFjdGlvbnMpIHtcbiAgICBjb25zdCByZXN1bHQgPSByZWR1Y2UoY3VycmVudCwgYWN0aW9uLCBybmcpO1xuICAgIGN1cnJlbnQgPSByZXN1bHQuc3RhdGU7XG4gICAgZXZlbnRzLnB1c2goLi4ucmVzdWx0LmV2ZW50cyk7XG4gIH1cbiAgcmV0dXJuIHsgc3RhdGU6IGN1cnJlbnQsIGV2ZW50cyB9O1xufVxuIiwgIi8qKlxuICogUk5HIGFic3RyYWN0aW9uLlxuICpcbiAqIFRoZSBlbmdpbmUgbmV2ZXIgcmVhY2hlcyBmb3IgYE1hdGgucmFuZG9tKClgIGRpcmVjdGx5LiBBbGwgcmFuZG9tbmVzcyBpc1xuICogc291cmNlZCBmcm9tIGFuIGBSbmdgIGluc3RhbmNlIHBhc3NlZCBpbnRvIGByZWR1Y2UoKWAuIFRoaXMgaXMgd2hhdCBtYWtlc1xuICogdGhlIGVuZ2luZSBkZXRlcm1pbmlzdGljIGFuZCB0ZXN0YWJsZS5cbiAqXG4gKiBJbiBwcm9kdWN0aW9uLCB0aGUgU3VwYWJhc2UgRWRnZSBGdW5jdGlvbiBjcmVhdGVzIGEgc2VlZGVkIFJORyBwZXIgZ2FtZVxuICogKHNlZWQgc3RvcmVkIGFsb25nc2lkZSBnYW1lIHN0YXRlKSwgc28gYSBjb21wbGV0ZSBnYW1lIGNhbiBiZSByZXBsYXllZFxuICogZGV0ZXJtaW5pc3RpY2FsbHkgZnJvbSBpdHMgYWN0aW9uIGxvZyBcdTIwMTQgdXNlZnVsIGZvciBidWcgcmVwb3J0cywgcmVjYXBcbiAqIGdlbmVyYXRpb24sIGFuZCBcIndhdGNoIHRoZSBnYW1lIGJhY2tcIiBmZWF0dXJlcy5cbiAqL1xuXG5leHBvcnQgaW50ZXJmYWNlIFJuZyB7XG4gIC8qKiBJbmNsdXNpdmUgYm90aCBlbmRzLiAqL1xuICBpbnRCZXR3ZWVuKG1pbkluY2x1c2l2ZTogbnVtYmVyLCBtYXhJbmNsdXNpdmU6IG51bWJlcik6IG51bWJlcjtcbiAgLyoqIFJldHVybnMgXCJoZWFkc1wiIG9yIFwidGFpbHNcIi4gKi9cbiAgY29pbkZsaXAoKTogXCJoZWFkc1wiIHwgXCJ0YWlsc1wiO1xuICAvKiogUmV0dXJucyAxLTYuICovXG4gIGQ2KCk6IDEgfCAyIHwgMyB8IDQgfCA1IHwgNjtcbn1cblxuLyoqXG4gKiBNdWxiZXJyeTMyIFx1MjAxNCBhIHNtYWxsLCBmYXN0LCB3ZWxsLWRpc3RyaWJ1dGVkIHNlZWRlZCBQUk5HLiBTdWZmaWNpZW50IGZvclxuICogYSBjYXJkLWRyYXdpbmcgZm9vdGJhbGwgZ2FtZTsgbm90IGZvciBjcnlwdG9ncmFwaHkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZWVkZWRSbmcoc2VlZDogbnVtYmVyKTogUm5nIHtcbiAgbGV0IHN0YXRlID0gc2VlZCA+Pj4gMDtcblxuICBjb25zdCBuZXh0ID0gKCk6IG51bWJlciA9PiB7XG4gICAgc3RhdGUgPSAoc3RhdGUgKyAweDZkMmI3OWY1KSA+Pj4gMDtcbiAgICBsZXQgdCA9IHN0YXRlO1xuICAgIHQgPSBNYXRoLmltdWwodCBeICh0ID4+PiAxNSksIHQgfCAxKTtcbiAgICB0IF49IHQgKyBNYXRoLmltdWwodCBeICh0ID4+PiA3KSwgdCB8IDYxKTtcbiAgICByZXR1cm4gKCh0IF4gKHQgPj4+IDE0KSkgPj4+IDApIC8gNDI5NDk2NzI5NjtcbiAgfTtcblxuICByZXR1cm4ge1xuICAgIGludEJldHdlZW4obWluLCBtYXgpIHtcbiAgICAgIHJldHVybiBNYXRoLmZsb29yKG5leHQoKSAqIChtYXggLSBtaW4gKyAxKSkgKyBtaW47XG4gICAgfSxcbiAgICBjb2luRmxpcCgpIHtcbiAgICAgIHJldHVybiBuZXh0KCkgPCAwLjUgPyBcImhlYWRzXCIgOiBcInRhaWxzXCI7XG4gICAgfSxcbiAgICBkNigpIHtcbiAgICAgIHJldHVybiAoTWF0aC5mbG9vcihuZXh0KCkgKiA2KSArIDEpIGFzIDEgfCAyIHwgMyB8IDQgfCA1IHwgNjtcbiAgICB9LFxuICB9O1xufVxuIiwgIi8qKlxuICogUHVyZSBvdXRjb21lLXRhYmxlIGhlbHBlcnMgZm9yIHNwZWNpYWwgcGxheXMuIFRoZXNlIGFyZSBleHRyYWN0ZWRcbiAqIGZyb20gdGhlIGZ1bGwgcmVzb2x2ZXJzIHNvIHRoYXQgY29uc3VtZXJzIChsaWtlIHY1LjEncyBhc3luYyBjb2RlXG4gKiBwYXRocykgY2FuIGxvb2sgdXAgdGhlIHJ1bGUgb3V0Y29tZSB3aXRob3V0IHJ1bm5pbmcgdGhlIGVuZ2luZSdzXG4gKiBzdGF0ZSB0cmFuc2l0aW9uLlxuICpcbiAqIE9uY2UgUGhhc2UgMiBjb2xsYXBzZXMgdGhlIG9yY2hlc3RyYXRvciBpbnRvIGBlbmdpbmUucmVkdWNlYCwgdGhlc2VcbiAqIGhlbHBlcnMgYmVjb21lIGFuIGludGVybmFsIGltcGxlbWVudGF0aW9uIGRldGFpbC4gVW50aWwgdGhlbiwgdGhleVxuICogbGV0IHY1LjEgdXNlIHRoZSBlbmdpbmUgYXMgdGhlIHNvdXJjZSBvZiB0cnV0aCBmb3IgZ2FtZSBydWxlcyB3aGlsZVxuICoga2VlcGluZyBpdHMgaW1wZXJhdGl2ZSBmbG93LlxuICovXG5cbmltcG9ydCB0eXBlIHsgTXVsdGlwbGllckNhcmROYW1lIH0gZnJvbSBcIi4uL3lhcmRhZ2UuanNcIjtcbmltcG9ydCB0eXBlIHsgUGxheWVySWQgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcblxuLy8gLS0tLS0tLS0tLSBTYW1lIFBsYXkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIFNhbWVQbGF5T3V0Y29tZSA9XG4gIHwgeyBraW5kOiBcImJpZ19wbGF5XCI7IGJlbmVmaWNpYXJ5OiBcIm9mZmVuc2VcIiB8IFwiZGVmZW5zZVwiIH1cbiAgfCB7IGtpbmQ6IFwibXVsdGlwbGllclwiOyB2YWx1ZTogbnVtYmVyOyBkcmF3WWFyZHM6IGJvb2xlYW4gfVxuICB8IHsga2luZDogXCJpbnRlcmNlcHRpb25cIiB9XG4gIHwgeyBraW5kOiBcIm5vX2dhaW5cIiB9O1xuXG4vKipcbiAqIHY1LjEncyBTYW1lIFBsYXkgdGFibGUgKHJ1bi5qczoxODk5KS5cbiAqXG4gKiAgIEtpbmcgICAgXHUyMTkyIEJpZyBQbGF5IChvZmZlbnNlIGlmIGhlYWRzLCBkZWZlbnNlIGlmIHRhaWxzKVxuICogICBRdWVlbiArIGhlYWRzIFx1MjE5MiArM3ggbXVsdGlwbGllciAoZHJhdyB5YXJkcylcbiAqICAgUXVlZW4gKyB0YWlscyBcdTIxOTIgMHggbXVsdGlwbGllciAobm8geWFyZHMsIG5vIGdhaW4pXG4gKiAgIEphY2sgICsgaGVhZHMgXHUyMTkyIDB4IG11bHRpcGxpZXJcbiAqICAgSmFjayAgKyB0YWlscyBcdTIxOTIgLTN4IG11bHRpcGxpZXIgKGRyYXcgeWFyZHMpXG4gKiAgIDEwICAgICsgaGVhZHMgXHUyMTkyIElOVEVSQ0VQVElPTlxuICogICAxMCAgICArIHRhaWxzIFx1MjE5MiAwIHlhcmRzIChubyBtZWNoYW5pYylcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbWVQbGF5T3V0Y29tZShcbiAgY2FyZDogTXVsdGlwbGllckNhcmROYW1lLFxuICBjb2luOiBcImhlYWRzXCIgfCBcInRhaWxzXCIsXG4pOiBTYW1lUGxheU91dGNvbWUge1xuICBjb25zdCBoZWFkcyA9IGNvaW4gPT09IFwiaGVhZHNcIjtcbiAgaWYgKGNhcmQgPT09IFwiS2luZ1wiKSByZXR1cm4geyBraW5kOiBcImJpZ19wbGF5XCIsIGJlbmVmaWNpYXJ5OiBoZWFkcyA/IFwib2ZmZW5zZVwiIDogXCJkZWZlbnNlXCIgfTtcbiAgaWYgKGNhcmQgPT09IFwiMTBcIikgcmV0dXJuIGhlYWRzID8geyBraW5kOiBcImludGVyY2VwdGlvblwiIH0gOiB7IGtpbmQ6IFwibm9fZ2FpblwiIH07XG4gIGlmIChjYXJkID09PSBcIlF1ZWVuXCIpIHtcbiAgICByZXR1cm4gaGVhZHNcbiAgICAgID8geyBraW5kOiBcIm11bHRpcGxpZXJcIiwgdmFsdWU6IDMsIGRyYXdZYXJkczogdHJ1ZSB9XG4gICAgICA6IHsga2luZDogXCJtdWx0aXBsaWVyXCIsIHZhbHVlOiAwLCBkcmF3WWFyZHM6IGZhbHNlIH07XG4gIH1cbiAgLy8gSmFja1xuICByZXR1cm4gaGVhZHNcbiAgICA/IHsga2luZDogXCJtdWx0aXBsaWVyXCIsIHZhbHVlOiAwLCBkcmF3WWFyZHM6IGZhbHNlIH1cbiAgICA6IHsga2luZDogXCJtdWx0aXBsaWVyXCIsIHZhbHVlOiAtMywgZHJhd1lhcmRzOiB0cnVlIH07XG59XG5cbi8vIC0tLS0tLS0tLS0gVHJpY2sgUGxheSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgdHlwZSBUcmlja1BsYXlPdXRjb21lID1cbiAgfCB7IGtpbmQ6IFwiYmlnX3BsYXlcIjsgYmVuZWZpY2lhcnk6IFBsYXllcklkIH1cbiAgfCB7IGtpbmQ6IFwicGVuYWx0eVwiOyByYXdZYXJkczogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6IFwibXVsdGlwbGllclwiOyB2YWx1ZTogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6IFwib3ZlcmxheVwiOyBwbGF5OiBcIkxQXCIgfCBcIkxSXCI7IGJvbnVzOiBudW1iZXIgfTtcblxuLyoqXG4gKiB2NS4xJ3MgVHJpY2sgUGxheSB0YWJsZSAocnVuLmpzOjE5ODcpLiBDYWxsZXIgPSBwbGF5ZXIgd2hvIGNhbGxlZCB0aGVcbiAqIFRyaWNrIFBsYXkgKG9mZmVuc2Ugb3IgZGVmZW5zZSkuIERpZSByb2xsIG91dGNvbWVzIChmcm9tIGNhbGxlcidzIFBPVik6XG4gKlxuICogICAxIFx1MjE5MiBvdmVybGF5IExQIHdpdGggKzUgYm9udXMgKHNpZ25zIGZsaXAgZm9yIGRlZmVuc2l2ZSBjYWxsZXIpXG4gKiAgIDIgXHUyMTkyIDE1LXlhcmQgcGVuYWx0eSBvbiBvcHBvbmVudFxuICogICAzIFx1MjE5MiBmaXhlZCAtM3ggbXVsdGlwbGllciwgZHJhdyB5YXJkc1xuICogICA0IFx1MjE5MiBmaXhlZCArNHggbXVsdGlwbGllciwgZHJhdyB5YXJkc1xuICogICA1IFx1MjE5MiBCaWcgUGxheSBmb3IgY2FsbGVyXG4gKiAgIDYgXHUyMTkyIG92ZXJsYXkgTFIgd2l0aCArNSBib251c1xuICpcbiAqIGByYXdZYXJkc2Agb24gcGVuYWx0eSBpcyBzaWduZWQgZnJvbSBvZmZlbnNlIFBPVjogcG9zaXRpdmUgPSBnYWluIGZvclxuICogb2ZmZW5zZSAob2ZmZW5zaXZlIFRyaWNrIFBsYXkgcm9sbD0yKSwgbmVnYXRpdmUgPSBsb3NzIChkZWZlbnNpdmUpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gdHJpY2tQbGF5T3V0Y29tZShcbiAgY2FsbGVyOiBQbGF5ZXJJZCxcbiAgb2ZmZW5zZTogUGxheWVySWQsXG4gIGRpZTogMSB8IDIgfCAzIHwgNCB8IDUgfCA2LFxuKTogVHJpY2tQbGF5T3V0Y29tZSB7XG4gIGNvbnN0IGNhbGxlcklzT2ZmZW5zZSA9IGNhbGxlciA9PT0gb2ZmZW5zZTtcblxuICBpZiAoZGllID09PSA1KSByZXR1cm4geyBraW5kOiBcImJpZ19wbGF5XCIsIGJlbmVmaWNpYXJ5OiBjYWxsZXIgfTtcblxuICBpZiAoZGllID09PSAyKSB7XG4gICAgY29uc3QgcmF3WWFyZHMgPSBjYWxsZXJJc09mZmVuc2UgPyAxNSA6IC0xNTtcbiAgICByZXR1cm4geyBraW5kOiBcInBlbmFsdHlcIiwgcmF3WWFyZHMgfTtcbiAgfVxuXG4gIGlmIChkaWUgPT09IDMpIHJldHVybiB7IGtpbmQ6IFwibXVsdGlwbGllclwiLCB2YWx1ZTogLTMgfTtcbiAgaWYgKGRpZSA9PT0gNCkgcmV0dXJuIHsga2luZDogXCJtdWx0aXBsaWVyXCIsIHZhbHVlOiA0IH07XG5cbiAgLy8gZGllIDEgb3IgNlxuICBjb25zdCBwbGF5ID0gZGllID09PSAxID8gXCJMUFwiIDogXCJMUlwiO1xuICBjb25zdCBib251cyA9IGNhbGxlcklzT2ZmZW5zZSA/IDUgOiAtNTtcbiAgcmV0dXJuIHsga2luZDogXCJvdmVybGF5XCIsIHBsYXksIGJvbnVzIH07XG59XG5cbi8vIC0tLS0tLS0tLS0gQmlnIFBsYXkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgdHlwZSBCaWdQbGF5T3V0Y29tZSA9XG4gIHwgeyBraW5kOiBcIm9mZmVuc2VfZ2FpblwiOyB5YXJkczogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6IFwib2ZmZW5zZV90ZFwiIH1cbiAgfCB7IGtpbmQ6IFwiZGVmZW5zZV9wZW5hbHR5XCI7IHJhd1lhcmRzOiBudW1iZXIgfVxuICB8IHsga2luZDogXCJkZWZlbnNlX2Z1bWJsZV9yZXR1cm5cIjsgeWFyZHM6IG51bWJlciB9XG4gIHwgeyBraW5kOiBcImRlZmVuc2VfZnVtYmxlX3RkXCIgfTtcblxuLyoqXG4gKiB2NS4xJ3MgQmlnIFBsYXkgdGFibGUgKHJ1bi5qczoxOTMzKS4gYmVuZWZpY2lhcnkgPSB3aG8gYmVuZWZpdHNcbiAqIChvZmZlbnNlIG9yIGRlZmVuc2UpLlxuICpcbiAqIE9mZmVuc2U6XG4gKiAgIDEtMyBcdTIxOTIgKzI1IHlhcmRzXG4gKiAgIDQtNSBcdTIxOTIgbWF4KGhhbGYtdG8tZ29hbCwgNDApXG4gKiAgIDYgICBcdTIxOTIgVERcbiAqIERlZmVuc2U6XG4gKiAgIDEtMyBcdTIxOTIgMTAteWFyZCBwZW5hbHR5IG9uIG9mZmVuc2UgKHJlcGVhdCBkb3duKVxuICogICA0LTUgXHUyMTkyIGZ1bWJsZSwgZGVmZW5zZSByZXR1cm5zIG1heChoYWxmLXRvLWdvYWwsIDI1KVxuICogICA2ICAgXHUyMTkyIGZ1bWJsZSwgZGVmZW5zaXZlIFREXG4gKi9cbi8vIC0tLS0tLS0tLS0gUHVudCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBQdW50IHJldHVybiBtdWx0aXBsaWVyIGJ5IGRyYXduIG11bHRpcGxpZXIgY2FyZCAocnVuLmpzOjIxOTYpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHB1bnRSZXR1cm5NdWx0aXBsaWVyKGNhcmQ6IE11bHRpcGxpZXJDYXJkTmFtZSk6IG51bWJlciB7XG4gIHN3aXRjaCAoY2FyZCkge1xuICAgIGNhc2UgXCJLaW5nXCI6IHJldHVybiA3O1xuICAgIGNhc2UgXCJRdWVlblwiOiByZXR1cm4gNDtcbiAgICBjYXNlIFwiSmFja1wiOiByZXR1cm4gMTtcbiAgICBjYXNlIFwiMTBcIjogcmV0dXJuIC0wLjU7XG4gIH1cbn1cblxuLyoqXG4gKiBQdW50IGtpY2sgZGlzdGFuY2UgZm9ybXVsYSAocnVuLmpzOjIxNDMpOlxuICogICAxMCAqIHlhcmRzQ2FyZCAvIDIgKyAyMCAqIChjb2luID09PSBcImhlYWRzXCIgPyAxIDogMClcbiAqIHlhcmRzQ2FyZCBpcyB0aGUgMS0xMCBjYXJkLiBSYW5nZTogNS03MCB5YXJkcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHB1bnRLaWNrRGlzdGFuY2UoeWFyZHNDYXJkOiBudW1iZXIsIGNvaW46IFwiaGVhZHNcIiB8IFwidGFpbHNcIik6IG51bWJlciB7XG4gIHJldHVybiAoMTAgKiB5YXJkc0NhcmQpIC8gMiArIChjb2luID09PSBcImhlYWRzXCIgPyAyMCA6IDApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYmlnUGxheU91dGNvbWUoXG4gIGJlbmVmaWNpYXJ5OiBQbGF5ZXJJZCxcbiAgb2ZmZW5zZTogUGxheWVySWQsXG4gIGRpZTogMSB8IDIgfCAzIHwgNCB8IDUgfCA2LFxuICAvKiogYmFsbE9uIGZyb20gb2ZmZW5zZSBQT1YgKDAtMTAwKS4gKi9cbiAgYmFsbE9uOiBudW1iZXIsXG4pOiBCaWdQbGF5T3V0Y29tZSB7XG4gIGNvbnN0IGJlbmVmaXRzT2ZmZW5zZSA9IGJlbmVmaWNpYXJ5ID09PSBvZmZlbnNlO1xuXG4gIGlmIChiZW5lZml0c09mZmVuc2UpIHtcbiAgICBpZiAoZGllID09PSA2KSByZXR1cm4geyBraW5kOiBcIm9mZmVuc2VfdGRcIiB9O1xuICAgIGlmIChkaWUgPD0gMykgcmV0dXJuIHsga2luZDogXCJvZmZlbnNlX2dhaW5cIiwgeWFyZHM6IDI1IH07XG4gICAgY29uc3QgaGFsZlRvR29hbCA9IE1hdGgucm91bmQoKDEwMCAtIGJhbGxPbikgLyAyKTtcbiAgICByZXR1cm4geyBraW5kOiBcIm9mZmVuc2VfZ2FpblwiLCB5YXJkczogaGFsZlRvR29hbCA+IDQwID8gaGFsZlRvR29hbCA6IDQwIH07XG4gIH1cblxuICAvLyBEZWZlbnNlIGJlbmVmaWNpYXJ5XG4gIGlmIChkaWUgPD0gMykge1xuICAgIGNvbnN0IHJhd1lhcmRzID0gYmFsbE9uIC0gMTAgPCAxID8gLU1hdGguZmxvb3IoYmFsbE9uIC8gMikgOiAtMTA7XG4gICAgcmV0dXJuIHsga2luZDogXCJkZWZlbnNlX3BlbmFsdHlcIiwgcmF3WWFyZHMgfTtcbiAgfVxuICBpZiAoZGllID09PSA2KSByZXR1cm4geyBraW5kOiBcImRlZmVuc2VfZnVtYmxlX3RkXCIgfTtcbiAgY29uc3QgaGFsZlRvR29hbCA9IE1hdGgucm91bmQoKDEwMCAtIGJhbGxPbikgLyAyKTtcbiAgcmV0dXJuIHsga2luZDogXCJkZWZlbnNlX2Z1bWJsZV9yZXR1cm5cIiwgeWFyZHM6IGhhbGZUb0dvYWwgPiAyNSA/IGhhbGZUb0dvYWwgOiAyNSB9O1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQW9CQSxJQUFNLGFBQXlCLENBQUMsTUFBTSxNQUFNLElBQUk7QUFDaEQsSUFBTSxlQUE2QixDQUFDLE1BQU0sTUFBTSxJQUFJO0FBRXBELElBQU0sY0FBYyxvQkFBSSxJQUFJLENBQUMsWUFBWSxXQUFXLGFBQWEsQ0FBQztBQUUzRCxTQUFTLGVBQWUsT0FBa0IsUUFBK0I7QUFDOUUsVUFBUSxPQUFPLE1BQU07QUFBQSxJQUNuQixLQUFLO0FBQ0gsVUFBSSxNQUFNLFVBQVUsT0FBUSxRQUFPO0FBQ25DLFVBQUksT0FBTyxPQUFPLHlCQUF5QixTQUFVLFFBQU87QUFDNUQsVUFBSSxPQUFPLHVCQUF1QixLQUFLLE9BQU8sdUJBQXVCLElBQUk7QUFDdkUsZUFBTztBQUFBLE1BQ1Q7QUFDQSxVQUFJLENBQUMsT0FBTyxTQUFTLE9BQU8sT0FBTyxNQUFNLENBQUMsTUFBTSxZQUFZLE9BQU8sT0FBTyxNQUFNLENBQUMsTUFBTSxVQUFVO0FBQy9GLGVBQU87QUFBQSxNQUNUO0FBQ0EsYUFBTztBQUFBLElBRVQsS0FBSztBQUNILFVBQUksTUFBTSxVQUFVLFlBQWEsUUFBTztBQUN4QyxVQUFJLENBQUMsU0FBUyxPQUFPLE1BQU0sRUFBRyxRQUFPO0FBQ3JDLFVBQUksT0FBTyxTQUFTLFdBQVcsT0FBTyxTQUFTLFFBQVMsUUFBTztBQUMvRCxhQUFPO0FBQUEsSUFFVCxLQUFLO0FBR0gsVUFBSSxNQUFNLFVBQVUsWUFBYSxRQUFPO0FBQ3hDLFVBQUksQ0FBQyxTQUFTLE9BQU8sTUFBTSxFQUFHLFFB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QzNDLFFBQUksT0FBTyxFQUFHLFFBQU8sRUFBRSxNQUFNLGdCQUFnQixPQUFPLEdBQUc7QUFDdkQsVUFBTUMsY0FBYSxLQUFLLE9BQU8sTUFBTSxVQUFVLENBQUM7QUFDaEQsV0FBTyxFQUFFLE1BQU0sZ0JBQWdCLE9BQU9BLGNBQWEsS0FBS0EsY0FBYSxHQUFHO0FBQUEsRUFDMUU7QUFHQSxNQUFJLE9BQU8sR0FBRztBQUNaLFVBQU0sV0FBVyxTQUFTLEtBQUssSUFBSSxDQUFDLEtBQUssTUFBTSxTQUFTLENBQUMsSUFBSTtBQUM3RCxXQUFPLEVBQUUsTUFBTSxtQkFBbUIsU0FBUztBQUFBLEVBQzdDO0FBQ0EsTUFBSSxRQUFRLEVBQUcsUUFBTyxFQUFFLE1BQU0sb0JBQW9CO0FBQ2xELFFBQU0sYUFBYSxLQUFLLE9BQU8sTUFBTSxVQUFVLENBQUM7QUFDaEQsU0FBTyxFQUFFLE1BQU0seUJBQXlCLE9BQU8sYUFBYSxLQUFLLGFBQWEsR0FBRztBQUNuRjsiLAogICJuYW1lcyI6IFsiYmxhbmtQaWNrIiwgImhhbGZUb0dvYWwiLCAibXVsdGlwbGllciIsICJ5YXJkc0RyYXciLCAieWFyZHMiLCAic3RhdGVXaXRoUGljayIsICJyZXN1bHQiLCAiaGFsZlRvR29hbCJdCn0K
