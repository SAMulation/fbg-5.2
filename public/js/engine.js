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
      if (!isPlayer(action.player)) return "bad player";
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
    case "ACCEPT_PENALTY":
    case "DECLINE_PENALTY":
      return { state, events: [] };
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy92YWxpZGF0ZS50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3N0YXRlLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvbWF0Y2h1cC50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3lhcmRhZ2UudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9kZWNrLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvc2hhcmVkLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvcGxheS50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL2JpZ1BsYXkudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9wdW50LnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMva2lja29mZi50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL2hhaWxNYXJ5LnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvc2FtZVBsYXkudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy90cmlja1BsYXkudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9maWVsZEdvYWwudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy90d29Qb2ludC50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL292ZXJ0aW1lLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcmVkdWNlci50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3JuZy50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL291dGNvbWVzLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvKipcbiAqIEFjdGlvbiB2YWxpZGF0aW9uIGxheWVyLiBSdW5zICpiZWZvcmUqIGByZWR1Y2VgIHRvdWNoZXMgc3RhdGUuXG4gKlxuICogVGhlIGVuZ2luZSBwcmV2aW91c2x5IHJlbGllZCBvbiB0aGUgcmVkdWNlcidzIHBlci1jYXNlIHNoYXBlIGNoZWNrcyBhbmRcbiAqIHNpbGVudGx5IGlnbm9yZWQgYW55dGhpbmcgaXQgY291bGRuJ3QgcmVjb2duaXplLiBUaGF0IHdhcyBmaW5lIGZvciBhXG4gKiB0cnVzdGVkIHNpbmdsZS10YWIgZ2FtZSBidXQgdW5zYWZlIGFzIHNvb24gYXMgdGhlIER1cmFibGUgT2JqZWN0XG4gKiBhY2NlcHRzIGFjdGlvbnMgZnJvbSB1bmF1dGhlbnRpY2F0ZWQgV2ViU29ja2V0IGNsaWVudHMgXHUyMDE0IGEgaG9zdGlsZSAob3JcbiAqIGp1c3QgYnVnZ3kpIGNsaWVudCBjb3VsZCBzZW5kIGB7IHR5cGU6ICdSRVNPTFZFX0tJQ0tPRkYnLCBraWNrVHlwZTogJ0ZHJyB9YFxuICogYW5kIGNvcnJ1cHQgc3RhdGUuXG4gKlxuICogYHZhbGlkYXRlQWN0aW9uYCByZXR1cm5zIG51bGwgd2hlbiB0aGUgYWN0aW9uIGlzIGxlZ2FsIGZvciB0aGUgY3VycmVudFxuICogc3RhdGUsIG9yIGEgc3RyaW5nIGV4cGxhaW5pbmcgdGhlIHJlamVjdGlvbi4gSW52YWxpZCBhY3Rpb25zIHNob3VsZCBiZVxuICogbm8tb3BlZCBieSB0aGUgY2FsbGVyIChyZWR1Y2VyIG9yIHNlcnZlciksIG5vdCB0aHJvd24gb24gXHUyMDE0IHRoYXQgbWF0Y2hlc1xuICogdGhlIHJlc3Qgb2YgdGhlIGVuZ2luZSdzIFwiaWxsZWdhbCBwaWNrcyBhcmUgc2lsZW50bHkgZHJvcHBlZFwiIGNvbnRyYWN0XG4gKiBhbmQgYXZvaWRzIGNyYXNoaW5nIG9uIGFuIHVudHJ1c3RlZCBjbGllbnQuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBBY3Rpb24gfSBmcm9tIFwiLi9hY3Rpb25zLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgS2lja1R5cGUsIFJldHVyblR5cGUgfSBmcm9tIFwiLi90eXBlcy5qc1wiO1xuXG5jb25zdCBLSUNLX1RZUEVTOiBLaWNrVHlwZVtdID0gW1wiUktcIiwgXCJPS1wiLCBcIlNLXCJdO1xuY29uc3QgUkVUVVJOX1RZUEVTOiBSZXR1cm5UeXBlW10gPSBbXCJSUlwiLCBcIk9SXCIsIFwiVEJcIl07XG5cbmNvbnN0IFBMQVlfUEhBU0VTID0gbmV3IFNldChbXCJSRUdfUExBWVwiLCBcIk9UX1BMQVlcIiwgXCJUV09fUFRfQ09OVlwiXSk7XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUFjdGlvbihzdGF0ZTogR2FtZVN0YXRlLCBhY3Rpb246IEFjdGlvbik6IHN0cmluZyB8IG51bGwge1xuICBzd2l0Y2ggKGFjdGlvbi50eXBlKSB7XG4gICAgY2FzZSBcIlNUQVJUX0dBTUVcIjpcbiAgICAgIGlmIChzdGF0ZS5waGFzZSAhPT0gXCJJTklUXCIpIHJldHVybiBcIlNUQVJUX0dBTUUgb25seSB2YWxpZCBpbiBJTklUXCI7XG4gICAgICBpZiAodHlwZW9mIGFjdGlvbi5xdWFydGVyTGVuZ3RoTWludXRlcyAhPT0gXCJudW1iZXJcIikgcmV0dXJuIFwiYmFkIHF0ckxlblwiO1xuICAgICAgaWYgKGFjdGlvbi5xdWFydGVyTGVuZ3RoTWludXRlcyA8IDEgfHwgYWN0aW9uLnF1YXJ0ZXJMZW5ndGhNaW51dGVzID4gMTUpIHtcbiAgICAgICAgcmV0dXJuIFwicXRyTGVuIG11c3QgYmUgMS4uMTVcIjtcbiAgICAgIH1cbiAgICAgIGlmICghYWN0aW9uLnRlYW1zIHx8IHR5cGVvZiBhY3Rpb24udGVhbXNbMV0gIT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIGFjdGlvbi50ZWFtc1syXSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICByZXR1cm4gXCJ0ZWFtcyBtaXNzaW5nXCI7XG4gICAgICB9XG4gICAgICByZXR1cm4gbnVsbDtcblxuICAgIGNhc2UgXCJDT0lOX1RPU1NfQ0FMTFwiOlxuICAgICAgaWYgKHN0YXRlLnBoYXNlICE9PSBcIkNPSU5fVE9TU1wiKSByZXR1cm4gXCJub3QgaW4gQ09JTl9UT1NTXCI7XG4gICAgICBpZiAoIWlzUGxheWVyKGFjdGlvbi5wbGF5ZXIpKSByZXR1cm4gXCJiYWQgcGxheWVyXCI7XG4gICAgICBpZiAoYWN0aW9uLmNhbGwgIT09IFwiaGVhZHNcIiAmJiBhY3Rpb24uY2FsbCAhPT0gXCJ0YWlsc1wiKSByZXR1cm4gXCJiYWQgY2FsbFwiO1xuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICBjYXNlIFwiUkVDRUlWRV9DSE9JQ0VcIjpcbiAgICAgIC8vIEFsbG93ZWQgb25seSBhZnRlciB0aGUgY29pbiB0b3NzIHJlc29sdmVzOyBlbmdpbmUncyByZWR1Y2VyIGxlYXZlc1xuICAgICAgLy8gc3RhdGUucGhhc2UgYXQgQ09JTl9UT1NTIHVudGlsIFJFQ0VJVkVfQ0hPSUNFIHRyYW5zaXRpb25zIHRvIEtJQ0tPRkYuXG4gICAgICBpZiAoc3RhdGUucGhhc2UgIT09IFwiQ09JTl9UT1NTXCIpIHJldHVybiBcIm5vdCBpbiBDT0lOX1RPU1NcIjtcbiAgICAgIGlmICghaXNQbGF5ZXIoYWN0aW9uLnBsYXllcikpIHJldHVybiBcImJhZCBwbGF5ZXJcIjtcbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlICE9PSBcInJlY2VpdmVcIiAmJiBhY3Rpb24uY2hvaWNlICE9PSBcImRlZmVyXCIpIHJldHVybiBcImJhZCBjaG9pY2VcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIlBJQ0tfUExBWVwiOlxuICAgICAgaWYgKCFQTEFZX1BIQVNFUy5oYXMoc3RhdGUucGhhc2UpKSByZXR1cm4gXCJub3QgaW4gYSBwbGF5IHBoYXNlXCI7XG4gICAgICBpZiAoIWlzUGxheWVyKGFjdGlvbi5wbGF5ZXIpKSByZXR1cm4gXCJiYWQgcGxheWVyXCI7XG4gICAgICBpZiAoIWlzUGxheUNhbGwoYWN0aW9uLnBsYXkpKSByZXR1cm4gXCJiYWQgcGxheVwiO1xuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICBjYXNlIFwiQ0FMTF9USU1FT1VUXCI6XG4gICAgICBpZiAoIWlzUGxheWVyKGFjdGlvbi5wbGF5ZXIpKSByZXR1cm4gXCJiYWQgcGxheWVyXCI7XG4gICAgICBpZiAoc3RhdGUucGxheWVyc1thY3Rpb24ucGxheWVyXS50aW1lb3V0cyA8PSAwKSByZXR1cm4gXCJubyB0aW1lb3V0cyByZW1haW5pbmdcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIkFDQ0VQVF9QRU5BTFRZXCI6XG4gICAgY2FzZSBcIkRFQ0xJTkVfUEVOQUxUWVwiOlxuICAgICAgaWYgKCFpc1BsYXllcihhY3Rpb24ucGxheWVyKSkgcmV0dXJuIFwiYmFkIHBsYXllclwiO1xuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICBjYXNlIFwiUEFUX0NIT0lDRVwiOlxuICAgICAgaWYgKHN0YXRlLnBoYXNlICE9PSBcIlBBVF9DSE9JQ0VcIikgcmV0dXJuIFwibm90IGluIFBBVF9DSE9JQ0VcIjtcbiAgICAgIGlmICghaXNQbGF5ZXIoYWN0aW9uLnBsYXllcikpIHJldHVybiBcImJhZCBwbGF5ZXJcIjtcbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlICE9PSBcImtpY2tcIiAmJiBhY3Rpb24uY2hvaWNlICE9PSBcInR3b19wb2ludFwiKSByZXR1cm4gXCJiYWQgY2hvaWNlXCI7XG4gICAgICByZXR1cm4gbnVsbDtcblxuICAgIGNhc2UgXCJGT1VSVEhfRE9XTl9DSE9JQ0VcIjpcbiAgICAgIGlmIChzdGF0ZS5waGFzZSAhPT0gXCJSRUdfUExBWVwiICYmIHN0YXRlLnBoYXNlICE9PSBcIk9UX1BMQVlcIikgcmV0dXJuIFwid3JvbmcgcGhhc2VcIjtcbiAgICAgIGlmIChzdGF0ZS5maWVsZC5kb3duICE9PSA0KSByZXR1cm4gXCJub3QgNHRoIGRvd25cIjtcbiAgICAgIGlmICghaXNQbGF5ZXIoYWN0aW9uLnBsYXllcikpIHJldHVybiBcImJhZCBwbGF5ZXJcIjtcbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlICE9PSBcImdvXCIgJiYgYWN0aW9uLmNob2ljZSAhPT0gXCJwdW50XCIgJiYgYWN0aW9uLmNob2ljZSAhPT0gXCJmZ1wiKSB7XG4gICAgICAgIHJldHVybiBcImJhZCBjaG9pY2VcIjtcbiAgICAgIH1cbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlID09PSBcInB1bnRcIiAmJiBzdGF0ZS5waGFzZSA9PT0gXCJPVF9QTEFZXCIpIHJldHVybiBcIm5vIHB1bnRzIGluIE9UXCI7XG4gICAgICBpZiAoYWN0aW9uLmNob2ljZSA9PT0gXCJmZ1wiICYmIHN0YXRlLmZpZWxkLmJhbGxPbiA8IDQ1KSByZXR1cm4gXCJvdXQgb2YgRkcgcmFuZ2VcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIkZPUkZFSVRcIjpcbiAgICAgIGlmICghaXNQbGF5ZXIoYWN0aW9uLnBsYXllcikpIHJldHVybiBcImJhZCBwbGF5ZXJcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIlJFU09MVkVfS0lDS09GRlwiOlxuICAgICAgaWYgKHN0YXRlLnBoYXNlICE9PSBcIktJQ0tPRkZcIikgcmV0dXJuIFwibm90IGluIEtJQ0tPRkZcIjtcbiAgICAgIC8vIFBpY2tzIGFyZSBvcHRpb25hbCAoc2FmZXR5IGtpY2tzIHNraXAgdGhlbSksIGJ1dCB3aGVuIHByZXNlbnQgdGhleVxuICAgICAgLy8gbXVzdCBiZSBsZWdhbCBlbnVtIHZhbHVlcy5cbiAgICAgIGlmIChhY3Rpb24ua2lja1R5cGUgIT09IHVuZGVmaW5lZCAmJiAhS0lDS19UWVBFUy5pbmNsdWRlcyhhY3Rpb24ua2lja1R5cGUpKSB7XG4gICAgICAgIHJldHVybiBcImJhZCBraWNrVHlwZVwiO1xuICAgICAgfVxuICAgICAgaWYgKGFjdGlvbi5yZXR1cm5UeXBlICE9PSB1bmRlZmluZWQgJiYgIVJFVFVSTl9UWVBFUy5pbmNsdWRlcyhhY3Rpb24ucmV0dXJuVHlwZSkpIHtcbiAgICAgICAgcmV0dXJuIFwiYmFkIHJldHVyblR5cGVcIjtcbiAgICAgIH1cbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIlNUQVJUX09UX1BPU1NFU1NJT05cIjpcbiAgICAgIGlmIChzdGF0ZS5waGFzZSAhPT0gXCJPVF9TVEFSVFwiKSByZXR1cm4gXCJub3QgaW4gT1RfU1RBUlRcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIlRJQ0tfQ0xPQ0tcIjpcbiAgICAgIGlmICh0eXBlb2YgYWN0aW9uLnNlY29uZHMgIT09IFwibnVtYmVyXCIpIHJldHVybiBcImJhZCBzZWNvbmRzXCI7XG4gICAgICBpZiAoYWN0aW9uLnNlY29uZHMgPCAwIHx8IGFjdGlvbi5zZWNvbmRzID4gMzAwKSByZXR1cm4gXCJzZWNvbmRzIG91dCBvZiByYW5nZVwiO1xuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICBkZWZhdWx0OiB7XG4gICAgICBjb25zdCBfZXhoYXVzdGl2ZTogbmV2ZXIgPSBhY3Rpb247XG4gICAgICB2b2lkIF9leGhhdXN0aXZlO1xuICAgICAgcmV0dXJuIFwidW5rbm93biBhY3Rpb24gdHlwZVwiO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBpc1BsYXllcihwOiB1bmtub3duKTogcCBpcyAxIHwgMiB7XG4gIHJldHVybiBwID09PSAxIHx8IHAgPT09IDI7XG59XG5cbmZ1bmN0aW9uIGlzUGxheUNhbGwocDogdW5rbm93bik6IGJvb2xlYW4ge1xuICByZXR1cm4gKFxuICAgIHAgPT09IFwiU1JcIiB8fFxuICAgIHAgPT09IFwiTFJcIiB8fFxuICAgIHAgPT09IFwiU1BcIiB8fFxuICAgIHAgPT09IFwiTFBcIiB8fFxuICAgIHAgPT09IFwiVFBcIiB8fFxuICAgIHAgPT09IFwiSE1cIiB8fFxuICAgIHAgPT09IFwiRkdcIiB8fFxuICAgIHAgPT09IFwiUFVOVFwiIHx8XG4gICAgcCA9PT0gXCJUV09fUFRcIlxuICApO1xufVxuIiwgIi8qKlxuICogU3RhdGUgZmFjdG9yaWVzLlxuICpcbiAqIGBpbml0aWFsU3RhdGUoKWAgcHJvZHVjZXMgYSBmcmVzaCBHYW1lU3RhdGUgaW4gSU5JVCBwaGFzZS4gRXZlcnl0aGluZyBlbHNlXG4gKiBmbG93cyBmcm9tIHJlZHVjaW5nIGFjdGlvbnMgb3ZlciB0aGlzIHN0YXJ0aW5nIHBvaW50LlxuICovXG5cbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBIYW5kLCBQbGF5ZXJJZCwgU3RhdHMsIFRlYW1SZWYgfSBmcm9tIFwiLi90eXBlcy5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gZW1wdHlIYW5kKGlzT3ZlcnRpbWUgPSBmYWxzZSk6IEhhbmQge1xuICByZXR1cm4ge1xuICAgIFNSOiAzLFxuICAgIExSOiAzLFxuICAgIFNQOiAzLFxuICAgIExQOiAzLFxuICAgIFRQOiAxLFxuICAgIEhNOiBpc092ZXJ0aW1lID8gMiA6IDMsXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBlbXB0eVN0YXRzKCk6IFN0YXRzIHtcbiAgcmV0dXJuIHsgcGFzc1lhcmRzOiAwLCBydXNoWWFyZHM6IDAsIHR1cm5vdmVyczogMCwgc2Fja3M6IDAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZyZXNoRGVja011bHRpcGxpZXJzKCk6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdIHtcbiAgcmV0dXJuIFs0LCA0LCA0LCAzXTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZyZXNoRGVja1lhcmRzKCk6IG51bWJlcltdIHtcbiAgcmV0dXJuIFsxLCAxLCAxLCAxLCAxLCAxLCAxLCAxLCAxLCAxXTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBJbml0aWFsU3RhdGVBcmdzIHtcbiAgdGVhbTE6IFRlYW1SZWY7XG4gIHRlYW0yOiBUZWFtUmVmO1xuICBxdWFydGVyTGVuZ3RoTWludXRlczogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaW5pdGlhbFN0YXRlKGFyZ3M6IEluaXRpYWxTdGF0ZUFyZ3MpOiBHYW1lU3RhdGUge1xuICByZXR1cm4ge1xuICAgIHBoYXNlOiBcIklOSVRcIixcbiAgICBzY2hlbWFWZXJzaW9uOiAxLFxuICAgIGNsb2NrOiB7XG4gICAgICBxdWFydGVyOiAwLFxuICAgICAgc2Vjb25kc1JlbWFpbmluZzogYXJncy5xdWFydGVyTGVuZ3RoTWludXRlcyAqIDYwLFxuICAgICAgcXVhcnRlckxlbmd0aE1pbnV0ZXM6IGFyZ3MucXVhcnRlckxlbmd0aE1pbnV0ZXMsXG4gICAgfSxcbiAgICBmaWVsZDoge1xuICAgICAgYmFsbE9uOiAzNSxcbiAgICAgIGZpcnN0RG93bkF0OiA0NSxcbiAgICAgIGRvd246IDEsXG4gICAgICBvZmZlbnNlOiAxLFxuICAgIH0sXG4gICAgZGVjazoge1xuICAgICAgbXVsdGlwbGllcnM6IGZyZXNoRGVja011bHRpcGxpZXJzKCksXG4gICAgICB5YXJkczogZnJlc2hEZWNrWWFyZHMoKSxcbiAgICB9LFxuICAgIHBsYXllcnM6IHtcbiAgICAgIDE6IHtcbiAgICAgICAgdGVhbTogYXJncy50ZWFtMSxcbiAgICAgICAgc2NvcmU6IDAsXG4gICAgICAgIHRpbWVvdXRzOiAzLFxuICAgICAgICBoYW5kOiBlbXB0eUhhbmQoKSxcbiAgICAgICAgc3RhdHM6IGVtcHR5U3RhdHMoKSxcbiAgICAgIH0sXG4gICAgICAyOiB7XG4gICAgICAgIHRlYW06IGFyZ3MudGVhbTIsXG4gICAgICAgIHNjb3JlOiAwLFxuICAgICAgICB0aW1lb3V0czogMyxcbiAgICAgICAgaGFuZDogZW1wdHlIYW5kKCksXG4gICAgICAgIHN0YXRzOiBlbXB0eVN0YXRzKCksXG4gICAgICB9LFxuICAgIH0sXG4gICAgb3BlbmluZ1JlY2VpdmVyOiBudWxsLFxuICAgIG92ZXJ0aW1lOiBudWxsLFxuICAgIHBlbmRpbmdQaWNrOiB7IG9mZmVuc2VQbGF5OiBudWxsLCBkZWZlbnNlUGxheTogbnVsbCB9LFxuICAgIGxhc3RQbGF5RGVzY3JpcHRpb246IFwiU3RhcnQgb2YgZ2FtZVwiLFxuICAgIGlzU2FmZXR5S2ljazogZmFsc2UsXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBvcHAocDogUGxheWVySWQpOiBQbGF5ZXJJZCB7XG4gIHJldHVybiBwID09PSAxID8gMiA6IDE7XG59XG4iLCAiLyoqXG4gKiBUaGUgcGxheSBtYXRjaHVwIG1hdHJpeCBcdTIwMTQgdGhlIGhlYXJ0IG9mIEZvb3RCb3JlZC5cbiAqXG4gKiBCb3RoIHRlYW1zIHBpY2sgYSBwbGF5LiBUaGUgbWF0cml4IHNjb3JlcyBob3cgKmNsb3NlbHkqIHRoZSBkZWZlbnNlXG4gKiBwcmVkaWN0ZWQgdGhlIG9mZmVuc2l2ZSBjYWxsOlxuICogICAtIDEgPSBkZWZlbnNlIHdheSBvZmYgXHUyMTkyIGdyZWF0IGZvciBvZmZlbnNlXG4gKiAgIC0gNSA9IGRlZmVuc2UgbWF0Y2hlZCBcdTIxOTIgdGVycmlibGUgZm9yIG9mZmVuc2UgKGNvbWJpbmVkIHdpdGggYSBsb3dcbiAqICAgICAgICAgbXVsdGlwbGllciBjYXJkLCB0aGlzIGJlY29tZXMgYSBsb3NzIC8gdHVybm92ZXIgcmlzaylcbiAqXG4gKiBSb3dzID0gb2ZmZW5zaXZlIGNhbGwsIENvbHMgPSBkZWZlbnNpdmUgY2FsbC4gT3JkZXI6IFtTUiwgTFIsIFNQLCBMUF0uXG4gKlxuICogICAgICAgICAgIERFRjogU1IgIExSICBTUCAgTFBcbiAqICAgT0ZGOiBTUiAgICAgWyA1LCAgMywgIDMsICAyIF1cbiAqICAgT0ZGOiBMUiAgICAgWyAyLCAgNCwgIDEsICAyIF1cbiAqICAgT0ZGOiBTUCAgICAgWyAzLCAgMiwgIDUsICAzIF1cbiAqICAgT0ZGOiBMUCAgICAgWyAxLCAgMiwgIDIsICA0IF1cbiAqXG4gKiBQb3J0ZWQgdmVyYmF0aW0gZnJvbSBwdWJsaWMvanMvZGVmYXVsdHMuanMgTUFUQ0hVUC4gSW5kZXhpbmcgY29uZmlybWVkXG4gKiBhZ2FpbnN0IHBsYXlNZWNoYW5pc20gLyBjYWxjVGltZXMgaW4gcnVuLmpzOjIzNjguXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBSZWd1bGFyUGxheSB9IGZyb20gXCIuLi90eXBlcy5qc1wiO1xuXG5leHBvcnQgY29uc3QgTUFUQ0hVUDogUmVhZG9ubHlBcnJheTxSZWFkb25seUFycmF5PE1hdGNodXBRdWFsaXR5Pj4gPSBbXG4gIFs1LCAzLCAzLCAyXSxcbiAgWzIsIDQsIDEsIDJdLFxuICBbMywgMiwgNSwgM10sXG4gIFsxLCAyLCAyLCA0XSxcbl0gYXMgY29uc3Q7XG5cbmV4cG9ydCB0eXBlIE1hdGNodXBRdWFsaXR5ID0gMSB8IDIgfCAzIHwgNCB8IDU7XG5cbmNvbnN0IFBMQVlfSU5ERVg6IFJlY29yZDxSZWd1bGFyUGxheSwgMCB8IDEgfCAyIHwgMz4gPSB7XG4gIFNSOiAwLFxuICBMUjogMSxcbiAgU1A6IDIsXG4gIExQOiAzLFxufTtcblxuLyoqXG4gKiBNdWx0aXBsaWVyIGNhcmQgdmFsdWVzLiBJbmRleGluZyAoY29uZmlybWVkIGluIHJ1bi5qczoyMzc3KTpcbiAqICAgcm93ICAgID0gbXVsdGlwbGllciBjYXJkICgwPUtpbmcsIDE9UXVlZW4sIDI9SmFjaywgMz0xMClcbiAqICAgY29sdW1uID0gbWF0Y2h1cCBxdWFsaXR5IC0gMSAoc28gY29sdW1uIDAgPSBxdWFsaXR5IDEsIGNvbHVtbiA0ID0gcXVhbGl0eSA1KVxuICpcbiAqIFF1YWxpdHkgMSAob2ZmZW5zZSBvdXRndWVzc2VkIGRlZmVuc2UpICsgS2luZyA9IDR4LiBCZXN0IHBvc3NpYmxlIHBsYXkuXG4gKiBRdWFsaXR5IDUgKGRlZmVuc2UgbWF0Y2hlZCkgKyAxMCAgICAgICAgPSAtMXguIFdvcnN0IHJlZ3VsYXIgcGxheS5cbiAqXG4gKiAgICAgICAgICAgICAgICAgIHF1YWwgMSAgcXVhbCAyICBxdWFsIDMgIHF1YWwgNCAgcXVhbCA1XG4gKiAgIEtpbmcgICAgKDApICBbICAgNCwgICAgICAzLCAgICAgIDIsICAgICAxLjUsICAgICAxICAgXVxuICogICBRdWVlbiAgICgxKSAgWyAgIDMsICAgICAgMiwgICAgICAxLCAgICAgIDEsICAgICAwLjUgIF1cbiAqICAgSmFjayAgICAoMikgIFsgICAyLCAgICAgIDEsICAgICAwLjUsICAgICAwLCAgICAgIDAgICBdXG4gKiAgIDEwICAgICAgKDMpICBbICAgMCwgICAgICAwLCAgICAgIDAsICAgICAtMSwgICAgIC0xICAgXVxuICpcbiAqIFBvcnRlZCB2ZXJiYXRpbSBmcm9tIHB1YmxpYy9qcy9kZWZhdWx0cy5qcyBNVUxUSS5cbiAqL1xuZXhwb3J0IGNvbnN0IE1VTFRJOiBSZWFkb25seUFycmF5PFJlYWRvbmx5QXJyYXk8bnVtYmVyPj4gPSBbXG4gIFs0LCAzLCAyLCAxLjUsIDFdLFxuICBbMywgMiwgMSwgMSwgMC41XSxcbiAgWzIsIDEsIDAuNSwgMCwgMF0sXG4gIFswLCAwLCAwLCAtMSwgLTFdLFxuXSBhcyBjb25zdDtcblxuZXhwb3J0IGZ1bmN0aW9uIG1hdGNodXBRdWFsaXR5KG9mZjogUmVndWxhclBsYXksIGRlZjogUmVndWxhclBsYXkpOiBNYXRjaHVwUXVhbGl0eSB7XG4gIGNvbnN0IHJvdyA9IE1BVENIVVBbUExBWV9JTkRFWFtvZmZdXTtcbiAgaWYgKCFyb3cpIHRocm93IG5ldyBFcnJvcihgdW5yZWFjaGFibGU6IGJhZCBvZmYgcGxheSAke29mZn1gKTtcbiAgY29uc3QgcSA9IHJvd1tQTEFZX0lOREVYW2RlZl1dO1xuICBpZiAocSA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoYHVucmVhY2hhYmxlOiBiYWQgZGVmIHBsYXkgJHtkZWZ9YCk7XG4gIHJldHVybiBxO1xufVxuIiwgIi8qKlxuICogUHVyZSB5YXJkYWdlIGNhbGN1bGF0aW9uIGZvciBhIHJlZ3VsYXIgcGxheSAoU1IvTFIvU1AvTFApLlxuICpcbiAqIEZvcm11bGEgKHJ1bi5qczoyMzM3KTpcbiAqICAgeWFyZHMgPSByb3VuZChtdWx0aXBsaWVyICogeWFyZHNDYXJkKSArIGJvbnVzXG4gKlxuICogV2hlcmU6XG4gKiAgIC0gbXVsdGlwbGllciA9IE1VTFRJW211bHRpcGxpZXJDYXJkXVtxdWFsaXR5IC0gMV1cbiAqICAgLSBxdWFsaXR5ICAgID0gTUFUQ0hVUFtvZmZlbnNlXVtkZWZlbnNlXSAgIC8vIDEtNVxuICogICAtIGJvbnVzICAgICAgPSBzcGVjaWFsLXBsYXkgYm9udXMgKGUuZy4gVHJpY2sgUGxheSArNSBvbiBMUi9MUCBvdXRjb21lcylcbiAqXG4gKiBTcGVjaWFsIHBsYXlzIChUUCwgSE0sIEZHLCBQVU5ULCBUV09fUFQpIHVzZSBkaWZmZXJlbnQgZm9ybXVsYXMgXHUyMDE0IHRoZXlcbiAqIGxpdmUgaW4gcnVsZXMvc3BlY2lhbC50cyAoVE9ETykgYW5kIHByb2R1Y2UgZXZlbnRzIGRpcmVjdGx5LlxuICovXG5cbmltcG9ydCB0eXBlIHsgUmVndWxhclBsYXkgfSBmcm9tIFwiLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IE1VTFRJLCBtYXRjaHVwUXVhbGl0eSB9IGZyb20gXCIuL21hdGNodXAuanNcIjtcblxuZXhwb3J0IHR5cGUgTXVsdGlwbGllckNhcmRJbmRleCA9IDAgfCAxIHwgMiB8IDM7XG5leHBvcnQgY29uc3QgTVVMVElQTElFUl9DQVJEX05BTUVTID0gW1wiS2luZ1wiLCBcIlF1ZWVuXCIsIFwiSmFja1wiLCBcIjEwXCJdIGFzIGNvbnN0O1xuZXhwb3J0IHR5cGUgTXVsdGlwbGllckNhcmROYW1lID0gKHR5cGVvZiBNVUxUSVBMSUVSX0NBUkRfTkFNRVMpW251bWJlcl07XG5cbmV4cG9ydCBpbnRlcmZhY2UgWWFyZGFnZUlucHV0cyB7XG4gIG9mZmVuc2U6IFJlZ3VsYXJQbGF5O1xuICBkZWZlbnNlOiBSZWd1bGFyUGxheTtcbiAgLyoqIE11bHRpcGxpZXIgY2FyZCBpbmRleDogMD1LaW5nLCAxPVF1ZWVuLCAyPUphY2ssIDM9MTAuICovXG4gIG11bHRpcGxpZXJDYXJkOiBNdWx0aXBsaWVyQ2FyZEluZGV4O1xuICAvKiogWWFyZHMgY2FyZCBkcmF3biwgMS0xMC4gKi9cbiAgeWFyZHNDYXJkOiBudW1iZXI7XG4gIC8qKiBCb251cyB5YXJkcyBmcm9tIHNwZWNpYWwtcGxheSBvdmVybGF5cyAoZS5nLiBUcmljayBQbGF5ICs1KS4gKi9cbiAgYm9udXM/OiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgWWFyZGFnZU91dGNvbWUge1xuICBtYXRjaHVwUXVhbGl0eTogbnVtYmVyO1xuICBtdWx0aXBsaWVyOiBudW1iZXI7XG4gIG11bHRpcGxpZXJDYXJkTmFtZTogTXVsdGlwbGllckNhcmROYW1lO1xuICB5YXJkc0dhaW5lZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY29tcHV0ZVlhcmRhZ2UoaW5wdXRzOiBZYXJkYWdlSW5wdXRzKTogWWFyZGFnZU91dGNvbWUge1xuICBjb25zdCBxdWFsaXR5ID0gbWF0Y2h1cFF1YWxpdHkoaW5wdXRzLm9mZmVuc2UsIGlucHV0cy5kZWZlbnNlKTtcbiAgY29uc3QgbXVsdGlSb3cgPSBNVUxUSVtpbnB1dHMubXVsdGlwbGllckNhcmRdO1xuICBpZiAoIW11bHRpUm93KSB0aHJvdyBuZXcgRXJyb3IoYHVucmVhY2hhYmxlOiBiYWQgbXVsdGkgY2FyZCAke2lucHV0cy5tdWx0aXBsaWVyQ2FyZH1gKTtcbiAgY29uc3QgbXVsdGlwbGllciA9IG11bHRpUm93W3F1YWxpdHkgLSAxXTtcbiAgaWYgKG11bHRpcGxpZXIgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKGB1bnJlYWNoYWJsZTogYmFkIHF1YWxpdHkgJHtxdWFsaXR5fWApO1xuXG4gIGNvbnN0IGJvbnVzID0gaW5wdXRzLmJvbnVzID8/IDA7XG4gIGNvbnN0IHlhcmRzR2FpbmVkID0gTWF0aC5yb3VuZChtdWx0aXBsaWVyICogaW5wdXRzLnlhcmRzQ2FyZCkgKyBib251cztcblxuICByZXR1cm4ge1xuICAgIG1hdGNodXBRdWFsaXR5OiBxdWFsaXR5LFxuICAgIG11bHRpcGxpZXIsXG4gICAgbXVsdGlwbGllckNhcmROYW1lOiBNVUxUSVBMSUVSX0NBUkRfTkFNRVNbaW5wdXRzLm11bHRpcGxpZXJDYXJkXSxcbiAgICB5YXJkc0dhaW5lZCxcbiAgfTtcbn1cbiIsICIvKipcbiAqIENhcmQtZGVjayBkcmF3cyBcdTIwMTQgcHVyZSB2ZXJzaW9ucyBvZiB2NS4xJ3MgYEdhbWUuZGVjTXVsdHNgIGFuZCBgR2FtZS5kZWNZYXJkc2AuXG4gKlxuICogVGhlIGRlY2sgaXMgcmVwcmVzZW50ZWQgYXMgYW4gYXJyYXkgb2YgcmVtYWluaW5nIGNvdW50cyBwZXIgY2FyZCBzbG90LlxuICogVG8gZHJhdywgd2UgcGljayBhIHVuaWZvcm0gcmFuZG9tIHNsb3Q7IGlmIHRoYXQgc2xvdCBpcyBlbXB0eSwgd2UgcmV0cnkuXG4gKiBUaGlzIGlzIG1hdGhlbWF0aWNhbGx5IGVxdWl2YWxlbnQgdG8gc2h1ZmZsaW5nIHRoZSByZW1haW5pbmcgY2FyZHMgYW5kXG4gKiBkcmF3aW5nIG9uZSBcdTIwMTQgYW5kIG1hdGNoZXMgdjUuMSdzIGJlaGF2aW9yIHZlcmJhdGltLlxuICpcbiAqIFdoZW4gdGhlIGRlY2sgaXMgZXhoYXVzdGVkLCB0aGUgY29uc3VtZXIgKHRoZSByZWR1Y2VyKSByZWZpbGxzIGl0IGFuZFxuICogZW1pdHMgYSBERUNLX1NIVUZGTEVEIGV2ZW50LlxuICovXG5cbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBEZWNrU3RhdGUgfSBmcm9tIFwiLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7XG4gIGZyZXNoRGVja011bHRpcGxpZXJzLFxuICBmcmVzaERlY2tZYXJkcyxcbn0gZnJvbSBcIi4uL3N0YXRlLmpzXCI7XG5pbXBvcnQge1xuICBNVUxUSVBMSUVSX0NBUkRfTkFNRVMsXG4gIHR5cGUgTXVsdGlwbGllckNhcmRJbmRleCxcbiAgdHlwZSBNdWx0aXBsaWVyQ2FyZE5hbWUsXG59IGZyb20gXCIuL3lhcmRhZ2UuanNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBNdWx0aXBsaWVyRHJhdyB7XG4gIGNhcmQ6IE11bHRpcGxpZXJDYXJkTmFtZTtcbiAgaW5kZXg6IE11bHRpcGxpZXJDYXJkSW5kZXg7XG4gIGRlY2s6IERlY2tTdGF0ZTtcbiAgcmVzaHVmZmxlZDogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRyYXdNdWx0aXBsaWVyKGRlY2s6IERlY2tTdGF0ZSwgcm5nOiBSbmcpOiBNdWx0aXBsaWVyRHJhdyB7XG4gIGNvbnN0IG11bHRzID0gWy4uLmRlY2subXVsdGlwbGllcnNdIGFzIFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdO1xuXG4gIGxldCBpbmRleDogTXVsdGlwbGllckNhcmRJbmRleDtcbiAgLy8gUmVqZWN0aW9uLXNhbXBsZSB0byBkcmF3IHVuaWZvcm1seSBhY3Jvc3MgcmVtYWluaW5nIGNhcmRzLlxuICAvLyBMb29wIGlzIGJvdW5kZWQgXHUyMDE0IHRvdGFsIGNhcmRzIGluIGZyZXNoIGRlY2sgaXMgMTUuXG4gIGZvciAoOzspIHtcbiAgICBjb25zdCBpID0gcm5nLmludEJldHdlZW4oMCwgMykgYXMgTXVsdGlwbGllckNhcmRJbmRleDtcbiAgICBpZiAobXVsdHNbaV0gPiAwKSB7XG4gICAgICBpbmRleCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICBtdWx0c1tpbmRleF0tLTtcblxuICBsZXQgcmVzaHVmZmxlZCA9IGZhbHNlO1xuICBsZXQgbmV4dERlY2s6IERlY2tTdGF0ZSA9IHsgLi4uZGVjaywgbXVsdGlwbGllcnM6IG11bHRzIH07XG4gIGlmIChtdWx0cy5ldmVyeSgoYykgPT4gYyA9PT0gMCkpIHtcbiAgICByZXNodWZmbGVkID0gdHJ1ZTtcbiAgICBuZXh0RGVjayA9IHsgLi4ubmV4dERlY2ssIG11bHRpcGxpZXJzOiBmcmVzaERlY2tNdWx0aXBsaWVycygpIH07XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGNhcmQ6IE1VTFRJUExJRVJfQ0FSRF9OQU1FU1tpbmRleF0sXG4gICAgaW5kZXgsXG4gICAgZGVjazogbmV4dERlY2ssXG4gICAgcmVzaHVmZmxlZCxcbiAgfTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBZYXJkc0RyYXcge1xuICAvKiogWWFyZHMgY2FyZCB2YWx1ZSwgMS0xMC4gKi9cbiAgY2FyZDogbnVtYmVyO1xuICBkZWNrOiBEZWNrU3RhdGU7XG4gIHJlc2h1ZmZsZWQ6IGJvb2xlYW47XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkcmF3WWFyZHMoZGVjazogRGVja1N0YXRlLCBybmc6IFJuZyk6IFlhcmRzRHJhdyB7XG4gIGNvbnN0IHlhcmRzID0gWy4uLmRlY2sueWFyZHNdO1xuXG4gIGxldCBpbmRleDogbnVtYmVyO1xuICBmb3IgKDs7KSB7XG4gICAgY29uc3QgaSA9IHJuZy5pbnRCZXR3ZWVuKDAsIHlhcmRzLmxlbmd0aCAtIDEpO1xuICAgIGNvbnN0IHNsb3QgPSB5YXJkc1tpXTtcbiAgICBpZiAoc2xvdCAhPT0gdW5kZWZpbmVkICYmIHNsb3QgPiAwKSB7XG4gICAgICBpbmRleCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICB5YXJkc1tpbmRleF0gPSAoeWFyZHNbaW5kZXhdID8/IDApIC0gMTtcblxuICBsZXQgcmVzaHVmZmxlZCA9IGZhbHNlO1xuICBsZXQgbmV4dERlY2s6IERlY2tTdGF0ZSA9IHsgLi4uZGVjaywgeWFyZHMgfTtcbiAgaWYgKHlhcmRzLmV2ZXJ5KChjKSA9PiBjID09PSAwKSkge1xuICAgIHJlc2h1ZmZsZWQgPSB0cnVlO1xuICAgIG5leHREZWNrID0geyAuLi5uZXh0RGVjaywgeWFyZHM6IGZyZXNoRGVja1lhcmRzKCkgfTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgY2FyZDogaW5kZXggKyAxLFxuICAgIGRlY2s6IG5leHREZWNrLFxuICAgIHJlc2h1ZmZsZWQsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgcHJpbWl0aXZlcyB1c2VkIGJ5IG11bHRpcGxlIHNwZWNpYWwtcGxheSByZXNvbHZlcnMuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBQbGF5ZXJJZCwgU3RhdHMgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi8uLi9zdGF0ZS5qc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgc3RhdGU6IEdhbWVTdGF0ZTtcbiAgZXZlbnRzOiBFdmVudFtdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYmxhbmtQaWNrKCk6IEdhbWVTdGF0ZVtcInBlbmRpbmdQaWNrXCJdIHtcbiAgcmV0dXJuIHsgb2ZmZW5zZVBsYXk6IG51bGwsIGRlZmVuc2VQbGF5OiBudWxsIH07XG59XG5cbi8qKlxuICogQnVtcCBwZXItcGxheWVyIHN0YXRzLiBSZXR1cm5zIGEgbmV3IHBsYXllcnMgbWFwIHdpdGggdGhlIGRlbHRhcyBhcHBsaWVkXG4gKiB0byBgcGxheWVySWRgLiBVc2UgcGFydGlhbCBTdGF0cyBcdTIwMTQgdW5zcGVjaWZpZWQgZmllbGRzIGFyZSB1bmNoYW5nZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidW1wU3RhdHMoXG4gIHBsYXllcnM6IEdhbWVTdGF0ZVtcInBsYXllcnNcIl0sXG4gIHBsYXllcklkOiBQbGF5ZXJJZCxcbiAgZGVsdGFzOiBQYXJ0aWFsPFN0YXRzPixcbik6IEdhbWVTdGF0ZVtcInBsYXllcnNcIl0ge1xuICBjb25zdCBjdXIgPSBwbGF5ZXJzW3BsYXllcklkXS5zdGF0cztcbiAgcmV0dXJuIHtcbiAgICAuLi5wbGF5ZXJzLFxuICAgIFtwbGF5ZXJJZF06IHtcbiAgICAgIC4uLnBsYXllcnNbcGxheWVySWRdLFxuICAgICAgc3RhdHM6IHtcbiAgICAgICAgcGFzc1lhcmRzOiBjdXIucGFzc1lhcmRzICsgKGRlbHRhcy5wYXNzWWFyZHMgPz8gMCksXG4gICAgICAgIHJ1c2hZYXJkczogY3VyLnJ1c2hZYXJkcyArIChkZWx0YXMucnVzaFlhcmRzID8/IDApLFxuICAgICAgICB0dXJub3ZlcnM6IGN1ci50dXJub3ZlcnMgKyAoZGVsdGFzLnR1cm5vdmVycyA/PyAwKSxcbiAgICAgICAgc2Fja3M6IGN1ci5zYWNrcyArIChkZWx0YXMuc2Fja3MgPz8gMCksXG4gICAgICB9LFxuICAgIH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbn1cblxuLyoqXG4gKiBBd2FyZCBwb2ludHMsIGZsaXAgdG8gUEFUX0NIT0lDRS4gQ2FsbGVyIGVtaXRzIFRPVUNIRE9XTi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5VG91Y2hkb3duKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBzY29yZXI6IFBsYXllcklkLFxuICBldmVudHM6IEV2ZW50W10sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgLi4uc3RhdGUucGxheWVycyxcbiAgICBbc2NvcmVyXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0uc2NvcmUgKyA2IH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRPVUNIRE9XTlwiLCBzY29yaW5nUGxheWVyOiBzY29yZXIgfSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIHBoYXNlOiBcIlBBVF9DSE9JQ0VcIixcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5U2FmZXR5KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBjb25jZWRlcjogUGxheWVySWQsXG4gIGV2ZW50czogRXZlbnRbXSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgc2NvcmVyID0gb3BwKGNvbmNlZGVyKTtcbiAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtzY29yZXJdOiB7IC4uLnN0YXRlLnBsYXllcnNbc2NvcmVyXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbc2NvcmVyXS5zY29yZSArIDIgfSxcbiAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiU0FGRVRZXCIsIHNjb3JpbmdQbGF5ZXI6IHNjb3JlciB9KTtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgICAgaXNTYWZldHlLaWNrOiB0cnVlLFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG4vKipcbiAqIEFwcGx5IGEgeWFyZGFnZSBvdXRjb21lIHdpdGggZnVsbCBkb3duL3R1cm5vdmVyL3Njb3JlIGJvb2trZWVwaW5nLlxuICogVXNlZCBieSBzcGVjaWFscyB0aGF0IHByb2R1Y2UgeWFyZGFnZSBkaXJlY3RseSAoSGFpbCBNYXJ5LCBCaWcgUGxheSByZXR1cm4pLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlZYXJkYWdlT3V0Y29tZShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgeWFyZHM6IG51bWJlcixcbiAgZXZlbnRzOiBFdmVudFtdLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgcHJvamVjdGVkID0gc3RhdGUuZmllbGQuYmFsbE9uICsgeWFyZHM7XG5cbiAgaWYgKHByb2plY3RlZCA+PSAxMDApIHJldHVybiBhcHBseVRvdWNoZG93bihzdGF0ZSwgb2ZmZW5zZSwgZXZlbnRzKTtcbiAgaWYgKHByb2plY3RlZCA8PSAwKSByZXR1cm4gYXBwbHlTYWZldHkoc3RhdGUsIG9mZmVuc2UsIGV2ZW50cyk7XG5cbiAgY29uc3QgcmVhY2hlZEZpcnN0RG93biA9IHByb2plY3RlZCA+PSBzdGF0ZS5maWVsZC5maXJzdERvd25BdDtcbiAgbGV0IG5leHREb3duID0gc3RhdGUuZmllbGQuZG93bjtcbiAgbGV0IG5leHRGaXJzdERvd25BdCA9IHN0YXRlLmZpZWxkLmZpcnN0RG93bkF0O1xuICBsZXQgcG9zc2Vzc2lvbkZsaXBwZWQgPSBmYWxzZTtcblxuICBpZiAocmVhY2hlZEZpcnN0RG93bikge1xuICAgIG5leHREb3duID0gMTtcbiAgICBuZXh0Rmlyc3REb3duQXQgPSBNYXRoLm1pbigxMDAsIHByb2plY3RlZCArIDEwKTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiRklSU1RfRE9XTlwiIH0pO1xuICB9IGVsc2UgaWYgKHN0YXRlLmZpZWxkLmRvd24gPT09IDQpIHtcbiAgICBwb3NzZXNzaW9uRmxpcHBlZCA9IHRydWU7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSX09OX0RPV05TXCIgfSk7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJkb3duc1wiIH0pO1xuICB9IGVsc2Uge1xuICAgIG5leHREb3duID0gKHN0YXRlLmZpZWxkLmRvd24gKyAxKSBhcyAxIHwgMiB8IDMgfCA0O1xuICB9XG5cbiAgY29uc3QgbWlycm9yZWRCYWxsT24gPSBwb3NzZXNzaW9uRmxpcHBlZCA/IDEwMCAtIHByb2plY3RlZCA6IHByb2plY3RlZDtcbiAgY29uc3QgcGxheWVycyA9IHBvc3Nlc3Npb25GbGlwcGVkXG4gICAgPyBidW1wU3RhdHMoc3RhdGUucGxheWVycywgb2ZmZW5zZSwgeyB0dXJub3ZlcnM6IDEgfSlcbiAgICA6IHN0YXRlLnBsYXllcnM7XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwbGF5ZXJzLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgYmFsbE9uOiBtaXJyb3JlZEJhbGxPbixcbiAgICAgICAgZmlyc3REb3duQXQ6IHBvc3Nlc3Npb25GbGlwcGVkXG4gICAgICAgICAgPyBNYXRoLm1pbigxMDAsIG1pcnJvcmVkQmFsbE9uICsgMTApXG4gICAgICAgICAgOiBuZXh0Rmlyc3REb3duQXQsXG4gICAgICAgIGRvd246IHBvc3Nlc3Npb25GbGlwcGVkID8gMSA6IG5leHREb3duLFxuICAgICAgICBvZmZlbnNlOiBwb3NzZXNzaW9uRmxpcHBlZCA/IG9wcChvZmZlbnNlKSA6IG9mZmVuc2UsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuIiwgIi8qKlxuICogUmVndWxhci1wbGF5IHJlc29sdXRpb24uIFNwZWNpYWwgcGxheXMgKFRQLCBITSwgRkcsIFBVTlQsIFRXT19QVCkgYnJhbmNoXG4gKiBlbHNld2hlcmUgXHUyMDE0IHNlZSBydWxlcy9zcGVjaWFsLnRzIChUT0RPKS5cbiAqXG4gKiBHaXZlbiB0d28gcGlja3MgKG9mZmVuc2UgKyBkZWZlbnNlKSBhbmQgdGhlIGN1cnJlbnQgc3RhdGUsIHByb2R1Y2UgYSBuZXdcbiAqIHN0YXRlIGFuZCB0aGUgZXZlbnQgc3RyZWFtIGZvciB0aGUgcGxheS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgUGxheUNhbGwsIFJlZ3VsYXJQbGF5IH0gZnJvbSBcIi4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBkcmF3TXVsdGlwbGllciwgZHJhd1lhcmRzIH0gZnJvbSBcIi4vZGVjay5qc1wiO1xuaW1wb3J0IHsgY29tcHV0ZVlhcmRhZ2UgfSBmcm9tIFwiLi95YXJkYWdlLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7IGJ1bXBTdGF0cyB9IGZyb20gXCIuL3NwZWNpYWxzL3NoYXJlZC5qc1wiO1xuXG5jb25zdCBSRUdVTEFSOiBSZWFkb25seVNldDxQbGF5Q2FsbD4gPSBuZXcgU2V0KFtcIlNSXCIsIFwiTFJcIiwgXCJTUFwiLCBcIkxQXCJdKTtcblxuZXhwb3J0IGZ1bmN0aW9uIGlzUmVndWxhclBsYXkocDogUGxheUNhbGwpOiBwIGlzIFJlZ3VsYXJQbGF5IHtcbiAgcmV0dXJuIFJFR1VMQVIuaGFzKHApO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJlc29sdmVJbnB1dCB7XG4gIG9mZmVuc2VQbGF5OiBQbGF5Q2FsbDtcbiAgZGVmZW5zZVBsYXk6IFBsYXlDYWxsO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFBsYXlSZXNvbHV0aW9uIHtcbiAgc3RhdGU6IEdhbWVTdGF0ZTtcbiAgZXZlbnRzOiBFdmVudFtdO1xufVxuXG4vKipcbiAqIFJlc29sdmUgYSByZWd1bGFyIHZzIHJlZ3VsYXIgcGxheS4gQ2FsbGVyICh0aGUgcmVkdWNlcikgcm91dGVzIHRvIHNwZWNpYWxcbiAqIHBsYXkgaGFuZGxlcnMgaWYgZWl0aGVyIHBpY2sgaXMgbm9uLXJlZ3VsYXIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUmVndWxhclBsYXkoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIGlucHV0OiBSZXNvbHZlSW5wdXQsXG4gIHJuZzogUm5nLFxuKTogUGxheVJlc29sdXRpb24ge1xuICBpZiAoIWlzUmVndWxhclBsYXkoaW5wdXQub2ZmZW5zZVBsYXkpIHx8ICFpc1JlZ3VsYXJQbGF5KGlucHV0LmRlZmVuc2VQbGF5KSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcInJlc29sdmVSZWd1bGFyUGxheSBjYWxsZWQgd2l0aCBhIG5vbi1yZWd1bGFyIHBsYXlcIik7XG4gIH1cblxuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcblxuICAvLyBEcmF3IGNhcmRzLlxuICBjb25zdCBtdWx0RHJhdyA9IGRyYXdNdWx0aXBsaWVyKHN0YXRlLmRlY2ssIHJuZyk7XG4gIGlmIChtdWx0RHJhdy5yZXNodWZmbGVkKSB7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJtdWx0aXBsaWVyXCIgfSk7XG4gIH1cbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKG11bHREcmF3LmRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkge1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcbiAgfVxuXG4gIC8vIENvbXB1dGUgeWFyZGFnZS5cbiAgY29uc3Qgb3V0Y29tZSA9IGNvbXB1dGVZYXJkYWdlKHtcbiAgICBvZmZlbnNlOiBpbnB1dC5vZmZlbnNlUGxheSxcbiAgICBkZWZlbnNlOiBpbnB1dC5kZWZlbnNlUGxheSxcbiAgICBtdWx0aXBsaWVyQ2FyZDogbXVsdERyYXcuaW5kZXgsXG4gICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgfSk7XG5cbiAgLy8gRGVjcmVtZW50IG9mZmVuc2UncyBoYW5kIGZvciB0aGUgcGxheSB0aGV5IHVzZWQuIFJlZmlsbCBhdCB6ZXJvIFx1MjAxNCB0aGVcbiAgLy8gZXhhY3QgMTItY2FyZCByZXNodWZmbGUgYmVoYXZpb3IgbGl2ZXMgaW4gYGRlY3JlbWVudEhhbmRgLlxuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgbGV0IG5ld1BsYXllcnMgPSB7XG4gICAgLi4uc3RhdGUucGxheWVycyxcbiAgICBbb2ZmZW5zZV06IGRlY3JlbWVudEhhbmQoc3RhdGUucGxheWVyc1tvZmZlbnNlXSwgaW5wdXQub2ZmZW5zZVBsYXkpLFxuICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG5cbiAgLy8gU3RhdHM6IHBhc3MgdnMgcnVuIGJ5IHBsYXkgdHlwZS4gU1AvTFAgY2FycnkgcGFzc1lhcmRzICh3aXRoIG5lZ2F0aXZlXG4gIC8vIHlhcmRhZ2Ugb24gYSBwYXNzID0gc2FjaykuIFNSL0xSIGNhcnJ5IHJ1c2hZYXJkcy5cbiAgY29uc3QgaXNQYXNzID0gaW5wdXQub2ZmZW5zZVBsYXkgPT09IFwiU1BcIiB8fCBpbnB1dC5vZmZlbnNlUGxheSA9PT0gXCJMUFwiO1xuICBjb25zdCBzdGF0RGVsdGEgPSBpc1Bhc3NcbiAgICA/IHtcbiAgICAgICAgcGFzc1lhcmRzOiBvdXRjb21lLnlhcmRzR2FpbmVkLFxuICAgICAgICBzYWNrczogb3V0Y29tZS55YXJkc0dhaW5lZCA8IDAgPyAxIDogMCxcbiAgICAgIH1cbiAgICA6IHsgcnVzaFlhcmRzOiBvdXRjb21lLnlhcmRzR2FpbmVkIH07XG4gIG5ld1BsYXllcnMgPSBidW1wU3RhdHMobmV3UGxheWVycywgb2ZmZW5zZSwgc3RhdERlbHRhKTtcblxuICAvLyBBcHBseSB5YXJkYWdlIHRvIGJhbGwgcG9zaXRpb24uIENsYW1wIGF0IDEwMCAoVEQpIGFuZCAwIChzYWZldHkpLlxuICBjb25zdCBwcm9qZWN0ZWQgPSBzdGF0ZS5maWVsZC5iYWxsT24gKyBvdXRjb21lLnlhcmRzR2FpbmVkO1xuICBsZXQgbmV3QmFsbE9uID0gcHJvamVjdGVkO1xuICBsZXQgc2NvcmVkOiBcInRkXCIgfCBcInNhZmV0eVwiIHwgbnVsbCA9IG51bGw7XG4gIGlmIChwcm9qZWN0ZWQgPj0gMTAwKSB7XG4gICAgbmV3QmFsbE9uID0gMTAwO1xuICAgIHNjb3JlZCA9IFwidGRcIjtcbiAgfSBlbHNlIGlmIChwcm9qZWN0ZWQgPD0gMCkge1xuICAgIG5ld0JhbGxPbiA9IDA7XG4gICAgc2NvcmVkID0gXCJzYWZldHlcIjtcbiAgfVxuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICBvZmZlbnNlUGxheTogaW5wdXQub2ZmZW5zZVBsYXksXG4gICAgZGVmZW5zZVBsYXk6IGlucHV0LmRlZmVuc2VQbGF5LFxuICAgIG1hdGNodXBRdWFsaXR5OiBvdXRjb21lLm1hdGNodXBRdWFsaXR5LFxuICAgIG11bHRpcGxpZXI6IHsgY2FyZDogb3V0Y29tZS5tdWx0aXBsaWVyQ2FyZE5hbWUsIHZhbHVlOiBvdXRjb21lLm11bHRpcGxpZXIgfSxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgIHlhcmRzR2FpbmVkOiBvdXRjb21lLnlhcmRzR2FpbmVkLFxuICAgIG5ld0JhbGxPbixcbiAgfSk7XG5cbiAgLy8gU2NvcmUgaGFuZGxpbmcuXG4gIGlmIChzY29yZWQgPT09IFwidGRcIikge1xuICAgIHJldHVybiB0b3VjaGRvd25TdGF0ZShcbiAgICAgIHsgLi4uc3RhdGUsIGRlY2s6IHlhcmRzRHJhdy5kZWNrLCBwbGF5ZXJzOiBuZXdQbGF5ZXJzLCBwZW5kaW5nUGljazogYmxhbmtQaWNrKCkgfSxcbiAgICAgIG9mZmVuc2UsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuICBpZiAoc2NvcmVkID09PSBcInNhZmV0eVwiKSB7XG4gICAgcmV0dXJuIHNhZmV0eVN0YXRlKFxuICAgICAgeyAuLi5zdGF0ZSwgZGVjazogeWFyZHNEcmF3LmRlY2ssIHBsYXllcnM6IG5ld1BsYXllcnMsIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSB9LFxuICAgICAgb2ZmZW5zZSxcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgLy8gRG93bi9kaXN0YW5jZSBoYW5kbGluZy5cbiAgY29uc3QgcmVhY2hlZEZpcnN0RG93biA9IG5ld0JhbGxPbiA+PSBzdGF0ZS5maWVsZC5maXJzdERvd25BdDtcbiAgbGV0IG5leHREb3duID0gc3RhdGUuZmllbGQuZG93bjtcbiAgbGV0IG5leHRGaXJzdERvd25BdCA9IHN0YXRlLmZpZWxkLmZpcnN0RG93bkF0O1xuICBsZXQgcG9zc2Vzc2lvbkZsaXBwZWQgPSBmYWxzZTtcblxuICBpZiAocmVhY2hlZEZpcnN0RG93bikge1xuICAgIG5leHREb3duID0gMTtcbiAgICBuZXh0Rmlyc3REb3duQXQgPSBNYXRoLm1pbigxMDAsIG5ld0JhbGxPbiArIDEwKTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiRklSU1RfRE9XTlwiIH0pO1xuICB9IGVsc2UgaWYgKHN0YXRlLmZpZWxkLmRvd24gPT09IDQpIHtcbiAgICAvLyBUdXJub3ZlciBvbiBkb3ducyBcdTIwMTQgcG9zc2Vzc2lvbiBmbGlwcywgYmFsbCBzdGF5cy5cbiAgICBuZXh0RG93biA9IDE7XG4gICAgcG9zc2Vzc2lvbkZsaXBwZWQgPSB0cnVlO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUl9PTl9ET1dOU1wiIH0pO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiZG93bnNcIiB9KTtcbiAgICBuZXdQbGF5ZXJzID0gYnVtcFN0YXRzKG5ld1BsYXllcnMsIG9mZmVuc2UsIHsgdHVybm92ZXJzOiAxIH0pO1xuICB9IGVsc2Uge1xuICAgIG5leHREb3duID0gKHN0YXRlLmZpZWxkLmRvd24gKyAxKSBhcyAxIHwgMiB8IDMgfCA0O1xuICB9XG5cbiAgY29uc3QgbmV4dE9mZmVuc2UgPSBwb3NzZXNzaW9uRmxpcHBlZCA/IG9wcChvZmZlbnNlKSA6IG9mZmVuc2U7XG4gIGNvbnN0IG5leHRCYWxsT24gPSBwb3NzZXNzaW9uRmxpcHBlZCA/IDEwMCAtIG5ld0JhbGxPbiA6IG5ld0JhbGxPbjtcbiAgY29uc3QgbmV4dEZpcnN0RG93biA9IHBvc3Nlc3Npb25GbGlwcGVkXG4gICAgPyBNYXRoLm1pbigxMDAsIG5leHRCYWxsT24gKyAxMClcbiAgICA6IG5leHRGaXJzdERvd25BdDtcblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIGRlY2s6IHlhcmRzRHJhdy5kZWNrLFxuICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogbmV4dEJhbGxPbixcbiAgICAgICAgZmlyc3REb3duQXQ6IG5leHRGaXJzdERvd24sXG4gICAgICAgIGRvd246IG5leHREb3duLFxuICAgICAgICBvZmZlbnNlOiBuZXh0T2ZmZW5zZSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGJsYW5rUGljaygpOiBHYW1lU3RhdGVbXCJwZW5kaW5nUGlja1wiXSB7XG4gIHJldHVybiB7IG9mZmVuc2VQbGF5OiBudWxsLCBkZWZlbnNlUGxheTogbnVsbCB9O1xufVxuXG4vKipcbiAqIFRvdWNoZG93biBib29ra2VlcGluZyBcdTIwMTQgNiBwb2ludHMsIHRyYW5zaXRpb24gdG8gUEFUX0NIT0lDRSBwaGFzZS5cbiAqIChQQVQvMnB0IHJlc29sdXRpb24gYW5kIGVuc3Vpbmcga2lja29mZiBoYXBwZW4gaW4gc3Vic2VxdWVudCBhY3Rpb25zLilcbiAqL1xuZnVuY3Rpb24gdG91Y2hkb3duU3RhdGUoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHNjb3JlcjogR2FtZVN0YXRlW1wiZmllbGRcIl1bXCJvZmZlbnNlXCJdLFxuICBldmVudHM6IEV2ZW50W10sXG4pOiBQbGF5UmVzb2x1dGlvbiB7XG4gIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgLi4uc3RhdGUucGxheWVycyxcbiAgICBbc2NvcmVyXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0uc2NvcmUgKyA2IH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRPVUNIRE9XTlwiLCBzY29yaW5nUGxheWVyOiBzY29yZXIgfSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHsgLi4uc3RhdGUsIHBsYXllcnM6IG5ld1BsYXllcnMsIHBoYXNlOiBcIlBBVF9DSE9JQ0VcIiB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuLyoqXG4gKiBTYWZldHkgXHUyMDE0IGRlZmVuc2Ugc2NvcmVzIDIsIG9mZmVuc2Uga2lja3MgZnJlZSBraWNrLlxuICogRm9yIHRoZSBza2V0Y2ggd2Ugc2NvcmUgYW5kIGVtaXQ7IHRoZSBraWNrb2ZmIHRyYW5zaXRpb24gaXMgVE9ETy5cbiAqL1xuZnVuY3Rpb24gc2FmZXR5U3RhdGUoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIGNvbmNlZGVyOiBHYW1lU3RhdGVbXCJmaWVsZFwiXVtcIm9mZmVuc2VcIl0sXG4gIGV2ZW50czogRXZlbnRbXSxcbik6IFBsYXlSZXNvbHV0aW9uIHtcbiAgY29uc3Qgc2NvcmVyID0gb3BwKGNvbmNlZGVyKTtcbiAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtzY29yZXJdOiB7IC4uLnN0YXRlLnBsYXllcnNbc2NvcmVyXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbc2NvcmVyXS5zY29yZSArIDIgfSxcbiAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiU0FGRVRZXCIsIHNjb3JpbmdQbGF5ZXI6IHNjb3JlciB9KTtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZTogeyAuLi5zdGF0ZSwgcGxheWVyczogbmV3UGxheWVycywgcGhhc2U6IFwiS0lDS09GRlwiIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG4vKipcbiAqIERlY3JlbWVudCB0aGUgY2hvc2VuIHBsYXkgaW4gYSBwbGF5ZXIncyBoYW5kLiBJZiB0aGUgcmVndWxhci1wbGF5IGNhcmRzXG4gKiAoU1IvTFIvU1AvTFApIGFyZSBhbGwgZXhoYXVzdGVkLCByZWZpbGwgdGhlbSBcdTIwMTQgSGFpbCBNYXJ5IGNvdW50IGlzXG4gKiBwcmVzZXJ2ZWQgYWNyb3NzIHJlZmlsbHMgKG1hdGNoZXMgdjUuMSBQbGF5ZXIuZmlsbFBsYXlzKCdwJykpLlxuICovXG5mdW5jdGlvbiBkZWNyZW1lbnRIYW5kKFxuICBwbGF5ZXI6IEdhbWVTdGF0ZVtcInBsYXllcnNcIl1bMV0sXG4gIHBsYXk6IFBsYXlDYWxsLFxuKTogR2FtZVN0YXRlW1wicGxheWVyc1wiXVsxXSB7XG4gIGNvbnN0IGhhbmQgPSB7IC4uLnBsYXllci5oYW5kIH07XG5cbiAgaWYgKHBsYXkgPT09IFwiSE1cIikge1xuICAgIGhhbmQuSE0gPSBNYXRoLm1heCgwLCBoYW5kLkhNIC0gMSk7XG4gICAgcmV0dXJuIHsgLi4ucGxheWVyLCBoYW5kIH07XG4gIH1cblxuICBpZiAocGxheSA9PT0gXCJGR1wiIHx8IHBsYXkgPT09IFwiUFVOVFwiIHx8IHBsYXkgPT09IFwiVFdPX1BUXCIpIHtcbiAgICAvLyBObyBjYXJkIGNvbnN1bWVkIFx1MjAxNCB0aGVzZSBhcmUgc2l0dWF0aW9uYWwgZGVjaXNpb25zLCBub3QgZHJhd3MuXG4gICAgcmV0dXJuIHBsYXllcjtcbiAgfVxuXG4gIGhhbmRbcGxheV0gPSBNYXRoLm1heCgwLCBoYW5kW3BsYXldIC0gMSk7XG5cbiAgLy8gdjUuMSAxMi1jYXJkIHJlc2h1ZmZsZTogd2hlbiB0aGUgMTIgcmVndWxhci1wbGF5IGNhcmRzIChTUi9MUi9TUC9MUCxcbiAgLy8gMyBlYWNoKSBhcmUgYWxsIGV4aGF1c3RlZCwgcmVmaWxsIHRoZW0uIFRQIGlzIHRyYWNrZWQgc2VwYXJhdGVseVxuICAvLyB3aXRoIDEgY2FyZCBwZXIgc2h1ZmZsZTsgaXQgcmVmaWxscyBvbiB0aGUgc2FtZSB0cmlnZ2VyIHRvIGF2b2lkXG4gIC8vIGFuIG9ycGhhbmVkLVRQIHN0YXRlIChoYW5kPVswLDAsMCwwLDFdKSB3aGVyZSB0aGUgQ1BVIGlzIGZvcmNlZFxuICAvLyB0byBwaWNrIFRQIGV2ZXJ5IHBsYXkuXG4gIGNvbnN0IHJlZ3VsYXJzRXhoYXVzdGVkID1cbiAgICBoYW5kLlNSID09PSAwICYmIGhhbmQuTFIgPT09IDAgJiYgaGFuZC5TUCA9PT0gMCAmJiBoYW5kLkxQID09PSAwO1xuXG4gIGlmIChyZWd1bGFyc0V4aGF1c3RlZCkge1xuICAgIHJldHVybiB7XG4gICAgICAuLi5wbGF5ZXIsXG4gICAgICBoYW5kOiB7IFNSOiAzLCBMUjogMywgU1A6IDMsIExQOiAzLCBUUDogMSwgSE06IGhhbmQuSE0gfSxcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIHsgLi4ucGxheWVyLCBoYW5kIH07XG59XG4iLCAiLyoqXG4gKiBCaWcgUGxheSByZXNvbHV0aW9uIChydW4uanM6MTkzMykuXG4gKlxuICogVHJpZ2dlcmVkIGJ5OlxuICogICAtIFRyaWNrIFBsYXkgZGllPTVcbiAqICAgLSBTYW1lIFBsYXkgS2luZyBvdXRjb21lXG4gKiAgIC0gT3RoZXIgZnV0dXJlIGhvb2tzXG4gKlxuICogVGhlIGJlbmVmaWNpYXJ5IGFyZ3VtZW50IHNheXMgd2hvIGJlbmVmaXRzIFx1MjAxNCB0aGlzIGNhbiBiZSBvZmZlbnNlIE9SXG4gKiBkZWZlbnNlIChkaWZmZXJlbnQgb3V0Y29tZSB0YWJsZXMpLlxuICpcbiAqIE9mZmVuc2l2ZSBCaWcgUGxheSAob2ZmZW5zZSBiZW5lZml0cyk6XG4gKiAgIGRpZSAxLTMgXHUyMTkyICsyNSB5YXJkc1xuICogICBkaWUgNC01IFx1MjE5MiBtYXgoaGFsZi10by1nb2FsLCA0MCkgeWFyZHNcbiAqICAgZGllIDYgICBcdTIxOTIgVG91Y2hkb3duXG4gKlxuICogRGVmZW5zaXZlIEJpZyBQbGF5IChkZWZlbnNlIGJlbmVmaXRzKTpcbiAqICAgZGllIDEtMyBcdTIxOTIgMTAteWFyZCBwZW5hbHR5IG9uIG9mZmVuc2UgKHJlcGVhdCBkb3duKSwgaGFsZi10by1nb2FsIGlmIHRpZ2h0XG4gKiAgIGRpZSA0LTUgXHUyMTkyIEZVTUJMRSBcdTIxOTIgdHVybm92ZXIgKyBkZWZlbnNlIHJldHVybnMgbWF4KGhhbGYsIDI1KVxuICogICBkaWUgNiAgIFx1MjE5MiBGVU1CTEUgXHUyMTkyIGRlZmVuc2l2ZSBURFxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBQbGF5ZXJJZCB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4uLy4uL3N0YXRlLmpzXCI7XG5pbXBvcnQge1xuICBhcHBseVNhZmV0eSxcbiAgYXBwbHlUb3VjaGRvd24sXG4gIGJsYW5rUGljayxcbiAgYnVtcFN0YXRzLFxuICB0eXBlIFNwZWNpYWxSZXNvbHV0aW9uLFxufSBmcm9tIFwiLi9zaGFyZWQuanNcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVCaWdQbGF5KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBiZW5lZmljaWFyeTogUGxheWVySWQsXG4gIHJuZzogUm5nLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgZGllID0gcm5nLmQ2KCk7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFt7IHR5cGU6IFwiQklHX1BMQVlcIiwgYmVuZWZpY2lhcnksIHN1YnJvbGw6IGRpZSB9XTtcblxuICBpZiAoYmVuZWZpY2lhcnkgPT09IG9mZmVuc2UpIHtcbiAgICByZXR1cm4gb2ZmZW5zaXZlQmlnUGxheShzdGF0ZSwgb2ZmZW5zZSwgZGllLCBldmVudHMpO1xuICB9XG4gIHJldHVybiBkZWZlbnNpdmVCaWdQbGF5KHN0YXRlLCBvZmZlbnNlLCBkaWUsIGV2ZW50cyk7XG59XG5cbmZ1bmN0aW9uIG9mZmVuc2l2ZUJpZ1BsYXkoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIG9mZmVuc2U6IFBsYXllcklkLFxuICBkaWU6IDEgfCAyIHwgMyB8IDQgfCA1IHwgNixcbiAgZXZlbnRzOiBFdmVudFtdLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBpZiAoZGllID09PSA2KSB7XG4gICAgcmV0dXJuIGFwcGx5VG91Y2hkb3duKHN0YXRlLCBvZmZlbnNlLCBldmVudHMpO1xuICB9XG5cbiAgLy8gZGllIDEtMzogKzI1OyBkaWUgNC01OiBtYXgoaGFsZi10by1nb2FsLCA0MClcbiAgbGV0IGdhaW46IG51bWJlcjtcbiAgaWYgKGRpZSA8PSAzKSB7XG4gICAgZ2FpbiA9IDI1O1xuICB9IGVsc2Uge1xuICAgIGNvbnN0IGhhbGZUb0dvYWwgPSBNYXRoLnJvdW5kKCgxMDAgLSBzdGF0ZS5maWVsZC5iYWxsT24pIC8gMik7XG4gICAgZ2FpbiA9IGhhbGZUb0dvYWwgPiA0MCA/IGhhbGZUb0dvYWwgOiA0MDtcbiAgfVxuXG4gIGNvbnN0IHByb2plY3RlZCA9IHN0YXRlLmZpZWxkLmJhbGxPbiArIGdhaW47XG4gIGlmIChwcm9qZWN0ZWQgPj0gMTAwKSB7XG4gICAgcmV0dXJuIGFwcGx5VG91Y2hkb3duKHN0YXRlLCBvZmZlbnNlLCBldmVudHMpO1xuICB9XG5cbiAgLy8gQXBwbHkgZ2FpbiwgY2hlY2sgZm9yIGZpcnN0IGRvd24uXG4gIGNvbnN0IHJlYWNoZWRGaXJzdERvd24gPSBwcm9qZWN0ZWQgPj0gc3RhdGUuZmllbGQuZmlyc3REb3duQXQ7XG4gIGNvbnN0IG5leHREb3duID0gcmVhY2hlZEZpcnN0RG93biA/IDEgOiBzdGF0ZS5maWVsZC5kb3duO1xuICBjb25zdCBuZXh0Rmlyc3REb3duQXQgPSByZWFjaGVkRmlyc3REb3duXG4gICAgPyBNYXRoLm1pbigxMDAsIHByb2plY3RlZCArIDEwKVxuICAgIDogc3RhdGUuZmllbGQuZmlyc3REb3duQXQ7XG5cbiAgaWYgKHJlYWNoZWRGaXJzdERvd24pIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJGSVJTVF9ET1dOXCIgfSk7XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICAuLi5zdGF0ZS5maWVsZCxcbiAgICAgICAgYmFsbE9uOiBwcm9qZWN0ZWQsXG4gICAgICAgIGRvd246IG5leHREb3duLFxuICAgICAgICBmaXJzdERvd25BdDogbmV4dEZpcnN0RG93bkF0LFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gZGVmZW5zaXZlQmlnUGxheShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgb2ZmZW5zZTogUGxheWVySWQsXG4gIGRpZTogMSB8IDIgfCAzIHwgNCB8IDUgfCA2LFxuICBldmVudHM6IEV2ZW50W10sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIC8vIDEtMzogMTAteWFyZCBwZW5hbHR5LCByZXBlYXQgZG93biAobm8gZG93biBjb25zdW1lZCkuXG4gIGlmIChkaWUgPD0gMykge1xuICAgIGNvbnN0IG5haXZlUGVuYWx0eSA9IC0xMDtcbiAgICBjb25zdCBoYWxmVG9Hb2FsID0gLU1hdGguZmxvb3Ioc3RhdGUuZmllbGQuYmFsbE9uIC8gMik7XG4gICAgY29uc3QgcGVuYWx0eVlhcmRzID1cbiAgICAgIHN0YXRlLmZpZWxkLmJhbGxPbiAtIDEwIDwgMSA/IGhhbGZUb0dvYWwgOiBuYWl2ZVBlbmFsdHk7XG5cbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiUEVOQUxUWVwiLCBhZ2FpbnN0OiBvZmZlbnNlLCB5YXJkczogcGVuYWx0eVlhcmRzLCBsb3NzT2ZEb3duOiBmYWxzZSB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICAuLi5zdGF0ZS5maWVsZCxcbiAgICAgICAgICBiYWxsT246IE1hdGgubWF4KDAsIHN0YXRlLmZpZWxkLmJhbGxPbiArIHBlbmFsdHlZYXJkcyksXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyA0LTU6IHR1cm5vdmVyIHdpdGggcmV0dXJuIG9mIG1heChoYWxmLCAyNSkuIDY6IGRlZmVuc2l2ZSBURC5cbiAgY29uc3QgZGVmZW5kZXIgPSBvcHAob2ZmZW5zZSk7XG5cbiAgaWYgKGRpZSA9PT0gNikge1xuICAgIC8vIERlZmVuc2Ugc2NvcmVzIHRoZSBURC5cbiAgICBsZXQgbmV3UGxheWVycyA9IHtcbiAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICBbZGVmZW5kZXJdOiB7IC4uLnN0YXRlLnBsYXllcnNbZGVmZW5kZXJdLCBzY29yZTogc3RhdGUucGxheWVyc1tkZWZlbmRlcl0uc2NvcmUgKyA2IH0sXG4gICAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICAgIG5ld1BsYXllcnMgPSBidW1wU3RhdHMobmV3UGxheWVycywgb2ZmZW5zZSwgeyB0dXJub3ZlcnM6IDEgfSk7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJmdW1ibGVcIiB9KTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVE9VQ0hET1dOXCIsIHNjb3JpbmdQbGF5ZXI6IGRlZmVuZGVyIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBwaGFzZTogXCJQQVRfQ0hPSUNFXCIsXG4gICAgICAgIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiBkZWZlbmRlciB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gZGllIDQtNTogdHVybm92ZXIgd2l0aCByZXR1cm4uXG4gIGNvbnN0IGhhbGZUb0dvYWwgPSBNYXRoLnJvdW5kKCgxMDAgLSBzdGF0ZS5maWVsZC5iYWxsT24pIC8gMik7XG4gIGNvbnN0IHJldHVybllhcmRzID0gaGFsZlRvR29hbCA+IDI1ID8gaGFsZlRvR29hbCA6IDI1O1xuXG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiZnVtYmxlXCIgfSk7XG4gIGNvbnN0IHBsYXllcnNBZnRlclR1cm5vdmVyID0gYnVtcFN0YXRzKHN0YXRlLnBsYXllcnMsIG9mZmVuc2UsIHsgdHVybm92ZXJzOiAxIH0pO1xuXG4gIC8vIEYtNTAgZmlkZWxpdHk6IHY1LjEgc3RvcmVzIGBkaXN0ID0gcmV0dXJuWWFyZHNgIHRoZW4gY2FsbHMgY2hhbmdlUG9zcygndG8nKSxcbiAgLy8gd2hpY2ggbWlycm9ycyB0aGUgYmFsbCB0byBkZWZlbmRlciBQT1YuIFRoZSByZXR1cm4gaXMgdGhlbiBhcHBsaWVkXG4gIC8vIGZvcndhcmQgaW4gZGVmZW5kZXIgUE9WIChgc3BvdCArPSBkaXN0YCkuIEVxdWl2YWxlbnQ6IGRlZmVuZGVyIHN0YXJ0cyBhdFxuICAvLyBgMTAwIC0gYmFsbE9uYCAodGhlaXIgb3duIFBPVikgYW5kIGFkdmFuY2VzIGByZXR1cm5ZYXJkc2AgdG93YXJkIHRoZWlyIGdvYWwuXG4gIGNvbnN0IG5ld09mZmVuc2VTdGFydCA9IDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbjtcbiAgY29uc3QgZmluYWxCYWxsT24gPSBuZXdPZmZlbnNlU3RhcnQgKyByZXR1cm5ZYXJkcztcblxuICBpZiAoZmluYWxCYWxsT24gPj0gMTAwKSB7XG4gICAgLy8gUmV0dXJuZWQgYWxsIHRoZSB3YXkgXHUyMDE0IFREIGZvciBkZWZlbmRlci5cbiAgICBjb25zdCBwbGF5ZXJzV2l0aFNjb3JlID0ge1xuICAgICAgLi4ucGxheWVyc0FmdGVyVHVybm92ZXIsXG4gICAgICBbZGVmZW5kZXJdOiB7IC4uLnBsYXllcnNBZnRlclR1cm5vdmVyW2RlZmVuZGVyXSwgc2NvcmU6IHBsYXllcnNBZnRlclR1cm5vdmVyW2RlZmVuZGVyXS5zY29yZSArIDYgfSxcbiAgICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRPVUNIRE9XTlwiLCBzY29yaW5nUGxheWVyOiBkZWZlbmRlciB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBsYXllcnM6IHBsYXllcnNXaXRoU2NvcmUsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgcGhhc2U6IFwiUEFUX0NIT0lDRVwiLFxuICAgICAgICBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogZGVmZW5kZXIgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuICBpZiAoZmluYWxCYWxsT24gPD0gMCkge1xuICAgIHJldHVybiBhcHBseVNhZmV0eSh7IC4uLnN0YXRlLCBwbGF5ZXJzOiBwbGF5ZXJzQWZ0ZXJUdXJub3ZlciB9LCBvZmZlbnNlLCBldmVudHMpO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwbGF5ZXJzOiBwbGF5ZXJzQWZ0ZXJUdXJub3ZlcixcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogZmluYWxCYWxsT24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIGZpbmFsQmFsbE9uICsgMTApLFxuICAgICAgICBkb3duOiAxLFxuICAgICAgICBvZmZlbnNlOiBkZWZlbmRlcixcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBQdW50IChydW4uanM6MjA5MCkuIEFsc28gc2VydmVzIGZvciBzYWZldHkga2lja3MuXG4gKlxuICogU2VxdWVuY2UgKGFsbCByYW5kb21uZXNzIHRocm91Z2ggcm5nKTpcbiAqICAgMS4gQmxvY2sgY2hlY2s6IGlmIGluaXRpYWwgZDYgaXMgNiwgcm9sbCBhZ2FpbiBcdTIwMTQgMi1zaXhlcyA9IGJsb2NrZWQgKDEvMzYpLlxuICogICAyLiBJZiBub3QgYmxvY2tlZCwgZHJhdyB5YXJkcyBjYXJkICsgY29pbiBmbGlwOlxuICogICAgICAgIGtpY2tEaXN0ID0gMTAgKiB5YXJkc0NhcmQgLyAyICsgMjAgKiAoY29pbj1oZWFkcyA/IDEgOiAwKVxuICogICAgICBSZXN1bHRpbmcgcmFuZ2U6IFs1LCA3MF0geWFyZHMuXG4gKiAgIDMuIElmIGJhbGwgbGFuZHMgcGFzdCAxMDAgXHUyMTkyIHRvdWNoYmFjaywgcGxhY2UgYXQgcmVjZWl2ZXIncyAyMC5cbiAqICAgNC4gTXVmZiBjaGVjayAobm90IG9uIHRvdWNoYmFjay9ibG9jay9zYWZldHkga2ljayk6IDItc2l4ZXMgPSByZWNlaXZlclxuICogICAgICBtdWZmcywga2lja2luZyB0ZWFtIHJlY292ZXJzLlxuICogICA1LiBSZXR1cm46IGlmIHBvc3Nlc3Npb24sIGRyYXcgbXVsdENhcmQgKyB5YXJkcy5cbiAqICAgICAgICBLaW5nPTd4LCBRdWVlbj00eCwgSmFjaz0xeCwgMTA9LTAuNXhcbiAqICAgICAgICByZXR1cm4gPSByb3VuZChtdWx0ICogeWFyZHNDYXJkKVxuICogICAgICBSZXR1cm4gY2FuIHNjb3JlIFREIG9yIGNvbmNlZGUgc2FmZXR5LlxuICpcbiAqIEZvciB0aGUgZW5naW5lIHBvcnQ6IHRoaXMgaXMgdGhlIG1vc3QgcHJvY2VkdXJhbCBvZiB0aGUgc3BlY2lhbHMuIFdlXG4gKiBjb2xsZWN0IGV2ZW50cyBpbiBvcmRlciBhbmQgcHJvZHVjZSBvbmUgZmluYWwgc3RhdGUuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi8uLi9zdGF0ZS5qc1wiO1xuaW1wb3J0IHsgZHJhd011bHRpcGxpZXIsIGRyYXdZYXJkcyB9IGZyb20gXCIuLi9kZWNrLmpzXCI7XG5pbXBvcnQge1xuICBhcHBseVNhZmV0eSxcbiAgYXBwbHlUb3VjaGRvd24sXG4gIGJsYW5rUGljayxcbiAgYnVtcFN0YXRzLFxuICB0eXBlIFNwZWNpYWxSZXNvbHV0aW9uLFxufSBmcm9tIFwiLi9zaGFyZWQuanNcIjtcblxuY29uc3QgUkVUVVJOX01VTFRJUExJRVJTOiBSZWNvcmQ8XCJLaW5nXCIgfCBcIlF1ZWVuXCIgfCBcIkphY2tcIiB8IFwiMTBcIiwgbnVtYmVyPiA9IHtcbiAgS2luZzogNyxcbiAgUXVlZW46IDQsXG4gIEphY2s6IDEsXG4gIFwiMTBcIjogLTAuNSxcbn07XG5cbmV4cG9ydCBpbnRlcmZhY2UgUHVudE9wdGlvbnMge1xuICAvKiogdHJ1ZSBpZiB0aGlzIGlzIGEgc2FmZXR5IGtpY2sgKG5vIGJsb2NrL211ZmYgY2hlY2tzKS4gKi9cbiAgc2FmZXR5S2ljaz86IGJvb2xlYW47XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUHVudChcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgcm5nOiBSbmcsXG4gIG9wdHM6IFB1bnRPcHRpb25zID0ge30sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBkZWZlbmRlciA9IG9wcChvZmZlbnNlKTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG4gIGxldCBkZWNrID0gc3RhdGUuZGVjaztcblxuICAvLyBCbG9jayBjaGVjayAobm90IG9uIHNhZmV0eSBraWNrKS5cbiAgbGV0IGJsb2NrZWQgPSBmYWxzZTtcbiAgaWYgKCFvcHRzLnNhZmV0eUtpY2spIHtcbiAgICBpZiAocm5nLmQ2KCkgPT09IDYgJiYgcm5nLmQ2KCkgPT09IDYpIHtcbiAgICAgIGJsb2NrZWQgPSB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIGlmIChibG9ja2VkKSB7XG4gICAgLy8gS2lja2luZyB0ZWFtIGxvc2VzIHBvc3Nlc3Npb24gYXQgdGhlIGxpbmUgb2Ygc2NyaW1tYWdlLlxuICAgIGNvbnN0IG1pcnJvcmVkQmFsbE9uID0gMTAwIC0gc3RhdGUuZmllbGQuYmFsbE9uO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJQVU5UXCIsIHBsYXllcjogb2ZmZW5zZSwgbGFuZGluZ1Nwb3Q6IHN0YXRlLmZpZWxkLmJhbGxPbiB9KTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcImZ1bWJsZVwiIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGxheWVyczogYnVtcFN0YXRzKHN0YXRlLnBsYXllcnMsIG9mZmVuc2UsIHsgdHVybm92ZXJzOiAxIH0pLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgYmFsbE9uOiBtaXJyb3JlZEJhbGxPbixcbiAgICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBtaXJyb3JlZEJhbGxPbiArIDEwKSxcbiAgICAgICAgICBkb3duOiAxLFxuICAgICAgICAgIG9mZmVuc2U6IGRlZmVuZGVyLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gRHJhdyB5YXJkcyArIGNvaW4gZm9yIGtpY2sgZGlzdGFuY2UuXG4gIGNvbnN0IGNvaW4gPSBybmcuY29pbkZsaXAoKTtcbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKGRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuICBkZWNrID0geWFyZHNEcmF3LmRlY2s7XG5cbiAgY29uc3Qga2lja0Rpc3QgPSAoMTAgKiB5YXJkc0RyYXcuY2FyZCkgLyAyICsgKGNvaW4gPT09IFwiaGVhZHNcIiA/IDIwIDogMCk7XG4gIGNvbnN0IGxhbmRpbmdTcG90ID0gc3RhdGUuZmllbGQuYmFsbE9uICsga2lja0Rpc3Q7XG4gIGNvbnN0IHRvdWNoYmFjayA9IGxhbmRpbmdTcG90ID4gMTAwO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiUFVOVFwiLCBwbGF5ZXI6IG9mZmVuc2UsIGxhbmRpbmdTcG90IH0pO1xuXG4gIC8vIE11ZmYgY2hlY2sgKG5vdCBvbiB0b3VjaGJhY2ssIGJsb2NrLCBzYWZldHkga2ljaykuXG4gIGxldCBtdWZmZWQgPSBmYWxzZTtcbiAgaWYgKCF0b3VjaGJhY2sgJiYgIW9wdHMuc2FmZXR5S2ljaykge1xuICAgIGlmIChybmcuZDYoKSA9PT0gNiAmJiBybmcuZDYoKSA9PT0gNikge1xuICAgICAgbXVmZmVkID0gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICBpZiAobXVmZmVkKSB7XG4gICAgLy8gUmVjZWl2ZXIgbXVmZnMsIGtpY2tpbmcgdGVhbSByZWNvdmVycyB3aGVyZSB0aGUgYmFsbCBsYW5kZWQuXG4gICAgLy8gS2lja2luZyB0ZWFtIHJldGFpbnMgcG9zc2Vzc2lvbiBcdTIwMTQgcG9zc2Vzc2lvbiBkb2VzIE5PVCBjaGFuZ2UsIHNvIHRoaXNcbiAgICAvLyBpcyBub3QgYSB0dXJub3ZlciBmb3IgdGhlIHByZXZpb3VzIG9mZmVuc2UgKGRvbid0IGVtaXQgVFVSTk9WRVIgYW5kXG4gICAgLy8gZG9uJ3QgYnVtcCB0dXJub3ZlciBzdGF0cykuIFRoZSByZWNlaXZlcidzIG1pc3BsYXkgaXMgbG9nZ2VkIGFzIGFcbiAgICAvLyBQVU5UX01VRkZFRCBldmVudCBzbyBjb25zdW1lcnMgY2FuIHN0aWxsIHN1cmZhY2UgaXQuXG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlBVTlRfTVVGRkVEXCIsIHJlY292ZXJpbmdQbGF5ZXI6IG9mZmVuc2UgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBkZWNrLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgYmFsbE9uOiBNYXRoLm1pbig5OSwgbGFuZGluZ1Nwb3QpLFxuICAgICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIGxhbmRpbmdTcG90ICsgMTApLFxuICAgICAgICAgIGRvd246IDEsXG4gICAgICAgICAgb2ZmZW5zZSwgLy8ga2lja2VyIHJldGFpbnNcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIFRvdWNoYmFjazogcmVjZWl2ZXIgZ2V0cyBiYWxsIGF0IHRoZWlyIG93biAyMCAoPSA4MCBmcm9tIHRoZWlyIHBlcnNwZWN0aXZlLFxuICAvLyBidXQgYmFsbCBwb3NpdGlvbiBpcyB0cmFja2VkIGZyb20gb2ZmZW5zZSBQT1YsIHNvIGZvciB0aGUgTkVXIG9mZmVuc2UgdGhhdFxuICAvLyBpcyAxMDAtODAgPSAyMCkuXG4gIGlmICh0b3VjaGJhY2spIHtcbiAgICBjb25zdCBzdGF0ZUFmdGVyS2ljazogR2FtZVN0YXRlID0geyAuLi5zdGF0ZSwgZGVjayB9O1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZUFmdGVyS2ljayxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIGJhbGxPbjogMjAsXG4gICAgICAgICAgZmlyc3REb3duQXQ6IDMwLFxuICAgICAgICAgIGRvd246IDEsXG4gICAgICAgICAgb2ZmZW5zZTogZGVmZW5kZXIsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBOb3JtYWwgcHVudCByZXR1cm46IGRyYXcgbXVsdENhcmQgKyB5YXJkcy4gUmV0dXJuIG1lYXN1cmVkIGZyb20gbGFuZGluZ1Nwb3QuXG4gIGNvbnN0IG11bHREcmF3ID0gZHJhd011bHRpcGxpZXIoZGVjaywgcm5nKTtcbiAgaWYgKG11bHREcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwibXVsdGlwbGllclwiIH0pO1xuICBkZWNrID0gbXVsdERyYXcuZGVjaztcblxuICBjb25zdCByZXR1cm5EcmF3ID0gZHJhd1lhcmRzKGRlY2ssIHJuZyk7XG4gIGlmIChyZXR1cm5EcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcbiAgZGVjayA9IHJldHVybkRyYXcuZGVjaztcblxuICBjb25zdCBtdWx0ID0gUkVUVVJOX01VTFRJUExJRVJTW211bHREcmF3LmNhcmRdO1xuICBjb25zdCByZXR1cm5ZYXJkcyA9IE1hdGgucm91bmQobXVsdCAqIHJldHVybkRyYXcuY2FyZCk7XG5cbiAgLy8gQmFsbCBlbmRzIHVwIGF0IGxhbmRpbmdTcG90IC0gcmV0dXJuWWFyZHMgKGZyb20ga2lja2luZyB0ZWFtJ3MgUE9WKS5cbiAgLy8gRXF1aXZhbGVudGx5LCBmcm9tIHRoZSByZWNlaXZpbmcgdGVhbSdzIFBPVjogKDEwMCAtIGxhbmRpbmdTcG90KSArIHJldHVybllhcmRzLlxuICBjb25zdCByZWNlaXZlckJhbGxPbiA9IDEwMCAtIGxhbmRpbmdTcG90ICsgcmV0dXJuWWFyZHM7XG5cbiAgY29uc3Qgc3RhdGVBZnRlclJldHVybjogR2FtZVN0YXRlID0geyAuLi5zdGF0ZSwgZGVjayB9O1xuXG4gIC8vIFJldHVybiBURCBcdTIwMTQgcmVjZWl2ZXIgc2NvcmVzLlxuICBpZiAocmVjZWl2ZXJCYWxsT24gPj0gMTAwKSB7XG4gICAgY29uc3QgcmVjZWl2ZXJCYWxsQ2xhbXBlZCA9IDEwMDtcbiAgICB2b2lkIHJlY2VpdmVyQmFsbENsYW1wZWQ7XG4gICAgcmV0dXJuIGFwcGx5VG91Y2hkb3duKFxuICAgICAgeyAuLi5zdGF0ZUFmdGVyUmV0dXJuLCBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogZGVmZW5kZXIgfSB9LFxuICAgICAgZGVmZW5kZXIsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuXG4gIC8vIFJldHVybiBzYWZldHkgXHUyMDE0IHJlY2VpdmVyIHRhY2tsZWQgaW4gdGhlaXIgb3duIGVuZHpvbmUgKGNhbid0IGFjdHVhbGx5XG4gIC8vIGhhcHBlbiBmcm9tIGEgbmVnYXRpdmUtcmV0dXJuLXlhcmRhZ2Ugc3RhbmRwb2ludCBpbiB2NS4xIHNpbmNlIHN0YXJ0IGlzXG4gIC8vIDEwMC1sYW5kaW5nU3BvdCB3aGljaCBpcyA+IDAsIGJ1dCBtb2RlbCBpdCBhbnl3YXkgZm9yIGNvbXBsZXRlbmVzcykuXG4gIGlmIChyZWNlaXZlckJhbGxPbiA8PSAwKSB7XG4gICAgcmV0dXJuIGFwcGx5U2FmZXR5KFxuICAgICAgeyAuLi5zdGF0ZUFmdGVyUmV0dXJuLCBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogZGVmZW5kZXIgfSB9LFxuICAgICAgZGVmZW5kZXIsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlQWZ0ZXJSZXR1cm4sXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IHJlY2VpdmVyQmFsbE9uLFxuICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCByZWNlaXZlckJhbGxPbiArIDEwKSxcbiAgICAgICAgZG93bjogMSxcbiAgICAgICAgb2ZmZW5zZTogZGVmZW5kZXIsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuIiwgIi8qKlxuICogS2lja29mZi4gdjYgcmVzdG9yZXMgdjUuMSdzIGtpY2stdHlwZSAvIHJldHVybi10eXBlIHBpY2tzLlxuICpcbiAqIFRoZSBraWNrZXIgKHN0YXRlLmZpZWxkLm9mZmVuc2UpIGNob29zZXMgb25lIG9mOlxuICogICBSSyBcdTIwMTQgUmVndWxhciBLaWNrOiBsb25nIGtpY2ssIG11bHQreWFyZHMgcmV0dXJuXG4gKiAgIE9LIFx1MjAxNCBPbnNpZGUgS2ljazogIHNob3J0IGtpY2ssIDEtaW4tNiByZWNvdmVyeSByb2xsICgxLWluLTEyIHZzIE9SKVxuICogICBTSyBcdTIwMTQgU3F1aWIgS2ljazogICBtZWRpdW0ga2ljaywgMmQ2IHJldHVybiBpZiByZWNlaXZlciBjaG9zZSBSUlxuICpcbiAqIFRoZSByZXR1cm5lciBjaG9vc2VzIG9uZSBvZjpcbiAqICAgUlIgXHUyMDE0IFJlZ3VsYXIgUmV0dXJuOiBub3JtYWwgcmV0dXJuXG4gKiAgIE9SIFx1MjAxNCBPbnNpZGUgY291bnRlcjogZGVmZW5kcyB0aGUgb25zaWRlIChoYXJkZXIgZm9yIGtpY2tlciB0byByZWNvdmVyKVxuICogICBUQiBcdTIwMTQgVG91Y2hiYWNrOiAgICAgIHRha2UgdGhlIGJhbGwgYXQgdGhlIDI1XG4gKlxuICogU2FmZXR5IGtpY2tzIChzdGF0ZS5pc1NhZmV0eUtpY2s9dHJ1ZSkgc2tpcCB0aGUgcGlja3MgYW5kIHVzZSB0aGVcbiAqIGV4aXN0aW5nIHNpbXBsaWZpZWQgcHVudCBwYXRoLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBLaWNrVHlwZSwgUmV0dXJuVHlwZSB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4uLy4uL3N0YXRlLmpzXCI7XG5pbXBvcnQgeyBkcmF3TXVsdGlwbGllciwgZHJhd1lhcmRzIH0gZnJvbSBcIi4uL2RlY2suanNcIjtcbmltcG9ydCB7IHJlc29sdmVQdW50IH0gZnJvbSBcIi4vcHVudC5qc1wiO1xuaW1wb3J0IHtcbiAgYXBwbHlTYWZldHksXG4gIGFwcGx5VG91Y2hkb3duLFxuICBibGFua1BpY2ssXG4gIHR5cGUgU3BlY2lhbFJlc29sdXRpb24sXG59IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5jb25zdCBLSUNLT0ZGX01VTFRJUExJRVJTOiBSZWNvcmQ8XCJLaW5nXCIgfCBcIlF1ZWVuXCIgfCBcIkphY2tcIiB8IFwiMTBcIiwgbnVtYmVyPiA9IHtcbiAgS2luZzogMTAsXG4gIFF1ZWVuOiA1LFxuICBKYWNrOiAxLFxuICBcIjEwXCI6IDAsXG59O1xuXG5leHBvcnQgaW50ZXJmYWNlIEtpY2tvZmZPcHRpb25zIHtcbiAga2lja1R5cGU/OiBLaWNrVHlwZTtcbiAgcmV0dXJuVHlwZT86IFJldHVyblR5cGU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlS2lja29mZihcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgcm5nOiBSbmcsXG4gIG9wdHM6IEtpY2tvZmZPcHRpb25zID0ge30sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IGtpY2tlciA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IHJlY2VpdmVyID0gb3BwKGtpY2tlcik7XG5cbiAgLy8gU2FmZXR5LWtpY2sgcGF0aDogdjUuMSBjYXJ2ZS1vdXQgdHJlYXRzIGl0IGxpa2UgYSBwdW50IGZyb20gdGhlIDM1LlxuICAvLyBObyBwaWNrcyBhcmUgcHJvbXB0ZWQgZm9yLCBzbyBga2lja1R5cGVgIHdpbGwgYmUgdW5kZWZpbmVkIGhlcmUuXG4gIGlmIChzdGF0ZS5pc1NhZmV0eUtpY2sgfHwgIW9wdHMua2lja1R5cGUpIHtcbiAgICBjb25zdCBraWNraW5nU3RhdGU6IEdhbWVTdGF0ZSA9IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIGJhbGxPbjogMzUgfSxcbiAgICB9O1xuICAgIGNvbnN0IHJlc3VsdCA9IHJlc29sdmVQdW50KGtpY2tpbmdTdGF0ZSwgcm5nLCB7IHNhZmV0eUtpY2s6IHRydWUgfSk7XG4gICAgLy8gRi01NDogYSByZXR1cm4gVEQgb24gdGhlIHNhZmV0eSBraWNrIG1lYW5zIHJlc29sdmVQdW50IHNldCBwaGFzZSB0b1xuICAgIC8vIFBBVF9DSE9JQ0UgdmlhIGFwcGx5VG91Y2hkb3duLiBQcmVzZXJ2ZSBzY29yaW5nIHBoYXNlczsgb25seSBmYWxsXG4gICAgLy8gdGhyb3VnaCB0byBSRUdfUExBWSB3aGVuIHRoZSBraWNrIHByb2R1Y2VkIGEgbm9ybWFsIG5ldyBwb3NzZXNzaW9uLlxuICAgIGNvbnN0IHByZXNlcnZlID0gcmVzdWx0LnN0YXRlLnBoYXNlID09PSBcIlBBVF9DSE9JQ0VcIiB8fFxuICAgICAgcmVzdWx0LnN0YXRlLnBoYXNlID09PSBcIlRXT19QVF9DT05WXCI7XG4gICAgY29uc3QgcGhhc2UgPSBwcmVzZXJ2ZSA/IHJlc3VsdC5zdGF0ZS5waGFzZSA6IFwiUkVHX1BMQVlcIjtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHsgLi4ucmVzdWx0LnN0YXRlLCBwaGFzZSwgaXNTYWZldHlLaWNrOiBmYWxzZSB9LFxuICAgICAgZXZlbnRzOiByZXN1bHQuZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICBjb25zdCB7IGtpY2tUeXBlLCByZXR1cm5UeXBlIH0gPSBvcHRzO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIktJQ0tfVFlQRV9DSE9TRU5cIiwgcGxheWVyOiBraWNrZXIsIGNob2ljZToga2lja1R5cGUgfSk7XG4gIGlmIChyZXR1cm5UeXBlKSB7XG4gICAgZXZlbnRzLnB1c2goe1xuICAgICAgdHlwZTogXCJSRVRVUk5fVFlQRV9DSE9TRU5cIixcbiAgICAgIHBsYXllcjogcmVjZWl2ZXIsXG4gICAgICBjaG9pY2U6IHJldHVyblR5cGUsXG4gICAgfSk7XG4gIH1cblxuICBpZiAoa2lja1R5cGUgPT09IFwiUktcIikge1xuICAgIHJldHVybiByZXNvbHZlUmVndWxhcktpY2soc3RhdGUsIHJuZywgZXZlbnRzLCBraWNrZXIsIHJlY2VpdmVyLCByZXR1cm5UeXBlKTtcbiAgfVxuICBpZiAoa2lja1R5cGUgPT09IFwiT0tcIikge1xuICAgIHJldHVybiByZXNvbHZlT25zaWRlS2ljayhzdGF0ZSwgcm5nLCBldmVudHMsIGtpY2tlciwgcmVjZWl2ZXIsIHJldHVyblR5cGUpO1xuICB9XG4gIHJldHVybiByZXNvbHZlU3F1aWJLaWNrKHN0YXRlLCBybmcsIGV2ZW50cywga2lja2VyLCByZWNlaXZlciwgcmV0dXJuVHlwZSk7XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVSZWd1bGFyS2ljayhcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgcm5nOiBSbmcsXG4gIGV2ZW50czogRXZlbnRbXSxcbiAga2lja2VyOiBHYW1lU3RhdGVbXCJmaWVsZFwiXVtcIm9mZmVuc2VcIl0sXG4gIHJlY2VpdmVyOiBHYW1lU3RhdGVbXCJmaWVsZFwiXVtcIm9mZmVuc2VcIl0sXG4gIHJldHVyblR5cGU6IFJldHVyblR5cGUgfCB1bmRlZmluZWQsXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIC8vIFJldHVybmVyIGNob3NlIHRvdWNoYmFjayAob3IgbWlzbWF0Y2hlZCBPUik6IGJhbGwgYXQgdGhlIHJlY2VpdmVyJ3MgMjUuXG4gIGlmIChyZXR1cm5UeXBlID09PSBcIlRCXCIgfHwgcmV0dXJuVHlwZSA9PT0gXCJPUlwiKSB7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRPVUNIQkFDS1wiLCByZWNlaXZpbmdQbGF5ZXI6IHJlY2VpdmVyIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGhhc2U6IFwiUkVHX1BMQVlcIixcbiAgICAgICAgaXNTYWZldHlLaWNrOiBmYWxzZSxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIGJhbGxPbjogMjUsXG4gICAgICAgICAgZmlyc3REb3duQXQ6IDM1LFxuICAgICAgICAgIGRvd246IDEsXG4gICAgICAgICAgb2ZmZW5zZTogcmVjZWl2ZXIsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBSSyArIFJSOiBraWNrIGRpc3RhbmNlIDM1Li42MCwgdGhlbiBtdWx0K3lhcmRzIHJldHVybi5cbiAgY29uc3Qga2lja1JvbGwgPSBybmcuZDYoKTtcbiAgY29uc3Qga2lja1lhcmRzID0gMzUgKyA1ICogKGtpY2tSb2xsIC0gMSk7IC8vIDM1LCA0MCwgNDUsIDUwLCA1NSwgNjAgXHUyMDE0IDM1Li42MFxuICBjb25zdCBraWNrRW5kRnJvbUtpY2tlciA9IDM1ICsga2lja1lhcmRzOyAvLyA3MC4uOTUsIGJvdW5kZWQgdG8gMTAwXG4gIGNvbnN0IGJvdW5kZWRFbmQgPSBNYXRoLm1pbigxMDAsIGtpY2tFbmRGcm9tS2lja2VyKTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIktJQ0tPRkZcIiwgcmVjZWl2aW5nUGxheWVyOiByZWNlaXZlciwgYmFsbE9uOiBib3VuZGVkRW5kLCBraWNrUm9sbCwga2lja1lhcmRzIH0pO1xuXG4gIC8vIFJlY2VpdmVyJ3Mgc3RhcnRpbmcgYmFsbE9uIChwb3NzZXNzaW9uIGZsaXBwZWQpLlxuICBjb25zdCByZWNlaXZlclN0YXJ0ID0gMTAwIC0gYm91bmRlZEVuZDsgLy8gMC4uMzBcblxuICBsZXQgZGVjayA9IHN0YXRlLmRlY2s7XG4gIGNvbnN0IG11bHREcmF3ID0gZHJhd011bHRpcGxpZXIoZGVjaywgcm5nKTtcbiAgaWYgKG11bHREcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwibXVsdGlwbGllclwiIH0pO1xuICBkZWNrID0gbXVsdERyYXcuZGVjaztcblxuICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMoZGVjaywgcm5nKTtcbiAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG4gIGRlY2sgPSB5YXJkc0RyYXcuZGVjaztcblxuICBjb25zdCBtdWx0ID0gS0lDS09GRl9NVUxUSVBMSUVSU1ttdWx0RHJhdy5jYXJkXTtcbiAgY29uc3QgcmV0WWFyZHMgPSBtdWx0ICogeWFyZHNEcmF3LmNhcmQ7XG4gIGlmIChyZXRZYXJkcyAhPT0gMCkge1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJLSUNLT0ZGX1JFVFVSTlwiLCByZXR1cm5lclBsYXllcjogcmVjZWl2ZXIsIHlhcmRzOiByZXRZYXJkcyB9KTtcbiAgfVxuXG4gIGNvbnN0IGZpbmFsQmFsbE9uID0gcmVjZWl2ZXJTdGFydCArIHJldFlhcmRzO1xuXG4gIGlmIChmaW5hbEJhbGxPbiA+PSAxMDApIHtcbiAgICByZXR1cm4gYXBwbHlUb3VjaGRvd24oXG4gICAgICB7IC4uLnN0YXRlLCBkZWNrLCBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogcmVjZWl2ZXIgfSwgaXNTYWZldHlLaWNrOiBmYWxzZSB9LFxuICAgICAgcmVjZWl2ZXIsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuICBpZiAoZmluYWxCYWxsT24gPD0gMCkge1xuICAgIC8vIFJldHVybiBiYWNrd2FyZCBpbnRvIG93biBlbmQgem9uZSBcdTIwMTQgdW5saWtlbHkgd2l0aCB2NS4xIG11bHRpcGxpZXJzIGJ1dCBtb2RlbCBpdC5cbiAgICByZXR1cm4gYXBwbHlTYWZldHkoXG4gICAgICB7IC4uLnN0YXRlLCBkZWNrLCBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogcmVjZWl2ZXIgfSwgaXNTYWZldHlLaWNrOiBmYWxzZSB9LFxuICAgICAgcmVjZWl2ZXIsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgZGVjayxcbiAgICAgIHBoYXNlOiBcIlJFR19QTEFZXCIsXG4gICAgICBpc1NhZmV0eUtpY2s6IGZhbHNlLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgYmFsbE9uOiBmaW5hbEJhbGxPbixcbiAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgZmluYWxCYWxsT24gKyAxMCksXG4gICAgICAgIGRvd246IDEsXG4gICAgICAgIG9mZmVuc2U6IHJlY2VpdmVyLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZU9uc2lkZUtpY2soXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHJuZzogUm5nLFxuICBldmVudHM6IEV2ZW50W10sXG4gIGtpY2tlcjogR2FtZVN0YXRlW1wiZmllbGRcIl1bXCJvZmZlbnNlXCJdLFxuICByZWNlaXZlcjogR2FtZVN0YXRlW1wiZmllbGRcIl1bXCJvZmZlbnNlXCJdLFxuICByZXR1cm5UeXBlOiBSZXR1cm5UeXBlIHwgdW5kZWZpbmVkLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICAvLyBSZXR1cm5lcidzIE9SIGNob2ljZSBjb3JyZWN0bHkgcmVhZHMgdGhlIG9uc2lkZSBcdTIwMTQgbWFrZXMgcmVjb3ZlcnkgaGFyZGVyLlxuICBjb25zdCBvZGRzID0gcmV0dXJuVHlwZSA9PT0gXCJPUlwiID8gMTIgOiA2O1xuICBjb25zdCB0bXAgPSBybmcuaW50QmV0d2VlbigxLCBvZGRzKTtcbiAgY29uc3QgcmVjb3ZlcmVkID0gdG1wID09PSAxO1xuICBjb25zdCBraWNrWWFyZHMgPSAxMCArIHRtcDsgLy8gc2hvcnQga2ljayAxMS4uMTYgKG9yIDExLi4yMiB2cyBPUilcbiAgY29uc3Qga2lja0VuZCA9IDM1ICsga2lja1lhcmRzO1xuXG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJLSUNLT0ZGXCIsIHJlY2VpdmluZ1BsYXllcjogcmVjZWl2ZXIsIGJhbGxPbjoga2lja0VuZCwga2lja1JvbGw6IHRtcCwga2lja1lhcmRzIH0pO1xuICBldmVudHMucHVzaCh7XG4gICAgdHlwZTogXCJPTlNJREVfS0lDS1wiLFxuICAgIHJlY292ZXJlZCxcbiAgICByZWNvdmVyaW5nUGxheWVyOiByZWNvdmVyZWQgPyBraWNrZXIgOiByZWNlaXZlcixcbiAgICByb2xsOiB0bXAsXG4gICAgb2RkcyxcbiAgfSk7XG5cbiAgY29uc3QgcmV0dXJuUm9sbCA9IHJuZy5kNigpICsgdG1wOyAvLyB2NS4xOiB0bXAgKyBkNlxuXG4gIGlmIChyZWNvdmVyZWQpIHtcbiAgICAvLyBLaWNrZXIgcmV0YWlucy4gdjUuMSBmbGlwcyByZXR1cm4gZGlyZWN0aW9uIFx1MjAxNCBtb2RlbHMgXCJraWNrZXIgcmVjb3ZlcnNcbiAgICAvLyBzbGlnaHRseSBiYWNrIG9mIHRoZSBraWNrIHNwb3QuXCJcbiAgICBjb25zdCBraWNrZXJCYWxsT24gPSBNYXRoLm1heCgxLCBraWNrRW5kIC0gcmV0dXJuUm9sbCk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwaGFzZTogXCJSRUdfUExBWVwiLFxuICAgICAgICBpc1NhZmV0eUtpY2s6IGZhbHNlLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgYmFsbE9uOiBraWNrZXJCYWxsT24sXG4gICAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwga2lja2VyQmFsbE9uICsgMTApLFxuICAgICAgICAgIGRvd246IDEsXG4gICAgICAgICAgb2ZmZW5zZToga2lja2VyLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gUmVjZWl2ZXIgcmVjb3ZlcnMgYXQgdGhlIGtpY2sgc3BvdCwgcmV0dXJucyBmb3J3YXJkLlxuICBjb25zdCByZWNlaXZlclN0YXJ0ID0gMTAwIC0ga2lja0VuZDtcbiAgY29uc3QgZmluYWxCYWxsT24gPSByZWNlaXZlclN0YXJ0ICsgcmV0dXJuUm9sbDtcbiAgaWYgKHJldHVyblJvbGwgIT09IDApIHtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiS0lDS09GRl9SRVRVUk5cIiwgcmV0dXJuZXJQbGF5ZXI6IHJlY2VpdmVyLCB5YXJkczogcmV0dXJuUm9sbCB9KTtcbiAgfVxuXG4gIGlmIChmaW5hbEJhbGxPbiA+PSAxMDApIHtcbiAgICByZXR1cm4gYXBwbHlUb3VjaGRvd24oXG4gICAgICB7IC4uLnN0YXRlLCBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogcmVjZWl2ZXIgfSwgaXNTYWZldHlLaWNrOiBmYWxzZSB9LFxuICAgICAgcmVjZWl2ZXIsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGhhc2U6IFwiUkVHX1BMQVlcIixcbiAgICAgIGlzU2FmZXR5S2ljazogZmFsc2UsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IGZpbmFsQmFsbE9uLFxuICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBmaW5hbEJhbGxPbiArIDEwKSxcbiAgICAgICAgZG93bjogMSxcbiAgICAgICAgb2ZmZW5zZTogcmVjZWl2ZXIsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG5mdW5jdGlvbiByZXNvbHZlU3F1aWJLaWNrKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBybmc6IFJuZyxcbiAgZXZlbnRzOiBFdmVudFtdLFxuICBraWNrZXI6IEdhbWVTdGF0ZVtcImZpZWxkXCJdW1wib2ZmZW5zZVwiXSxcbiAgcmVjZWl2ZXI6IEdhbWVTdGF0ZVtcImZpZWxkXCJdW1wib2ZmZW5zZVwiXSxcbiAgcmV0dXJuVHlwZTogUmV0dXJuVHlwZSB8IHVuZGVmaW5lZCxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qga2lja1JvbGwgPSBybmcuZDYoKTtcbiAgY29uc3Qga2lja1lhcmRzID0gMTUgKyA1ICoga2lja1JvbGw7IC8vIDIwLi40NVxuICBjb25zdCBraWNrRW5kID0gTWF0aC5taW4oMTAwLCAzNSArIGtpY2tZYXJkcyk7XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJLSUNLT0ZGXCIsIHJlY2VpdmluZ1BsYXllcjogcmVjZWl2ZXIsIGJhbGxPbjoga2lja0VuZCwga2lja1JvbGwsIGtpY2tZYXJkcyB9KTtcblxuICAvLyBPbmx5IHJldHVybmFibGUgaWYgcmVjZWl2ZXIgY2hvc2UgUlI7IG90aGVyd2lzZSBubyByZXR1cm4uXG4gIGNvbnN0IHJldFlhcmRzID0gcmV0dXJuVHlwZSA9PT0gXCJSUlwiID8gcm5nLmQ2KCkgKyBybmcuZDYoKSA6IDA7XG4gIGlmIChyZXRZYXJkcyA+IDApIHtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiS0lDS09GRl9SRVRVUk5cIiwgcmV0dXJuZXJQbGF5ZXI6IHJlY2VpdmVyLCB5YXJkczogcmV0WWFyZHMgfSk7XG4gIH1cblxuICBjb25zdCByZWNlaXZlclN0YXJ0ID0gMTAwIC0ga2lja0VuZDtcbiAgY29uc3QgZmluYWxCYWxsT24gPSByZWNlaXZlclN0YXJ0ICsgcmV0WWFyZHM7XG5cbiAgaWYgKGZpbmFsQmFsbE9uID49IDEwMCkge1xuICAgIHJldHVybiBhcHBseVRvdWNoZG93bihcbiAgICAgIHsgLi4uc3RhdGUsIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiByZWNlaXZlciB9LCBpc1NhZmV0eUtpY2s6IGZhbHNlIH0sXG4gICAgICByZWNlaXZlcixcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwaGFzZTogXCJSRUdfUExBWVwiLFxuICAgICAgaXNTYWZldHlLaWNrOiBmYWxzZSxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogZmluYWxCYWxsT24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIGZpbmFsQmFsbE9uICsgMTApLFxuICAgICAgICBkb3duOiAxLFxuICAgICAgICBvZmZlbnNlOiByZWNlaXZlcixcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBIYWlsIE1hcnkgb3V0Y29tZXMgKHJ1bi5qczoyMjQyKS4gRGllIHZhbHVlIFx1MjE5MiByZXN1bHQsIGZyb20gb2ZmZW5zZSdzIFBPVjpcbiAqICAgMSBcdTIxOTIgQklHIFNBQ0ssIC0xMCB5YXJkc1xuICogICAyIFx1MjE5MiArMjAgeWFyZHNcbiAqICAgMyBcdTIxOTIgICAwIHlhcmRzXG4gKiAgIDQgXHUyMTkyICs0MCB5YXJkc1xuICogICA1IFx1MjE5MiBJTlRFUkNFUFRJT04gKHR1cm5vdmVyIGF0IHNwb3QpXG4gKiAgIDYgXHUyMTkyIFRPVUNIRE9XTlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7XG4gIGFwcGx5U2FmZXR5LFxuICBhcHBseVRvdWNoZG93bixcbiAgYXBwbHlZYXJkYWdlT3V0Y29tZSxcbiAgYmxhbmtQaWNrLFxuICBidW1wU3RhdHMsXG4gIHR5cGUgU3BlY2lhbFJlc29sdXRpb24sXG59IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUhhaWxNYXJ5KHN0YXRlOiBHYW1lU3RhdGUsIHJuZzogUm5nKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgZGllID0gcm5nLmQ2KCk7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFt7IHR5cGU6IFwiSEFJTF9NQVJZX1JPTExcIiwgb3V0Y29tZTogZGllIH1dO1xuXG4gIC8vIERlY3JlbWVudCBITSBjb3VudCByZWdhcmRsZXNzIG9mIG91dGNvbWUuXG4gIGxldCB1cGRhdGVkUGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtvZmZlbnNlXToge1xuICAgICAgLi4uc3RhdGUucGxheWVyc1tvZmZlbnNlXSxcbiAgICAgIGhhbmQ6IHsgLi4uc3RhdGUucGxheWVyc1tvZmZlbnNlXS5oYW5kLCBITTogTWF0aC5tYXgoMCwgc3RhdGUucGxheWVyc1tvZmZlbnNlXS5oYW5kLkhNIC0gMSkgfSxcbiAgICB9LFxuICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG5cbiAgLy8gSW50ZXJjZXB0aW9uIChkaWUgNSkgXHUyMDE0IHR1cm5vdmVyIGF0IHRoZSBzcG90LCBwb3NzZXNzaW9uIGZsaXBzLlxuICBpZiAoZGllID09PSA1KSB7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJpbnRlcmNlcHRpb25cIiB9KTtcbiAgICB1cGRhdGVkUGxheWVycyA9IGJ1bXBTdGF0cyh1cGRhdGVkUGxheWVycywgb2ZmZW5zZSwgeyB0dXJub3ZlcnM6IDEgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwbGF5ZXJzOiB1cGRhdGVkUGxheWVycyxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIC4uLnN0YXRlLmZpZWxkLFxuICAgICAgICAgIG9mZmVuc2U6IG9wcChvZmZlbnNlKSxcbiAgICAgICAgICBiYWxsT246IDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbixcbiAgICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCAxMDAgLSBzdGF0ZS5maWVsZC5iYWxsT24gKyAxMCksXG4gICAgICAgICAgZG93bjogMSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIFlhcmRhZ2Ugb3V0Y29tZXMgKGRpZSAxLTQsIDYpIFx1MjAxNCBwYXNzIHlhcmRzIHJlZ2FyZGxlc3Mgb2YgVEQvc2FmZXR5LlxuICBjb25zdCB5YXJkcyA9IGRpZSA9PT0gMSA/IC0xMCA6IGRpZSA9PT0gMiA/IDIwIDogZGllID09PSAzID8gMCA6IGRpZSA9PT0gNCA/IDQwIDogMDtcbiAgLy8gU2FjazogSE0gZGllPTEgPSAtMTAgeWRzLCBjb3VudCBhcyBhIHNhY2sgb24gdGhlIG9mZmVuc2UuXG4gIHVwZGF0ZWRQbGF5ZXJzID0gYnVtcFN0YXRzKHVwZGF0ZWRQbGF5ZXJzLCBvZmZlbnNlLCB7XG4gICAgcGFzc1lhcmRzOiBkaWUgPT09IDYgPyAxMDAgLSBzdGF0ZS5maWVsZC5iYWxsT24gOiB5YXJkcyxcbiAgICBzYWNrczogZGllID09PSAxID8gMSA6IDAsXG4gIH0pO1xuICBjb25zdCBzdGF0ZVdpdGhIbTogR2FtZVN0YXRlID0geyAuLi5zdGF0ZSwgcGxheWVyczogdXBkYXRlZFBsYXllcnMgfTtcblxuICAvLyBUb3VjaGRvd24gKGRpZSA2KS5cbiAgaWYgKGRpZSA9PT0gNikge1xuICAgIHJldHVybiBhcHBseVRvdWNoZG93bihzdGF0ZVdpdGhIbSwgb2ZmZW5zZSwgZXZlbnRzKTtcbiAgfVxuXG4gIGNvbnN0IHByb2plY3RlZCA9IHN0YXRlV2l0aEhtLmZpZWxkLmJhbGxPbiArIHlhcmRzO1xuXG4gIGlmIChwcm9qZWN0ZWQgPj0gMTAwKSByZXR1cm4gYXBwbHlUb3VjaGRvd24oc3RhdGVXaXRoSG0sIG9mZmVuc2UsIGV2ZW50cyk7XG4gIGlmIChwcm9qZWN0ZWQgPD0gMCkgcmV0dXJuIGFwcGx5U2FmZXR5KHN0YXRlV2l0aEhtLCBvZmZlbnNlLCBldmVudHMpO1xuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICBvZmZlbnNlUGxheTogXCJITVwiLFxuICAgIGRlZmVuc2VQbGF5OiBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA/PyBcIlNSXCIsXG4gICAgbWF0Y2h1cFF1YWxpdHk6IDAsXG4gICAgbXVsdGlwbGllcjogeyBjYXJkOiBcIjEwXCIsIHZhbHVlOiAwIH0sXG4gICAgeWFyZHNDYXJkOiAwLFxuICAgIHlhcmRzR2FpbmVkOiB5YXJkcyxcbiAgICBuZXdCYWxsT246IHByb2plY3RlZCxcbiAgfSk7XG5cbiAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoc3RhdGVXaXRoSG0sIHlhcmRzLCBldmVudHMpO1xufVxuIiwgIi8qKlxuICogU2FtZSBQbGF5IG1lY2hhbmlzbSAocnVuLmpzOjE4OTkpLlxuICpcbiAqIFRyaWdnZXJlZCB3aGVuIGJvdGggdGVhbXMgcGljayB0aGUgc2FtZSByZWd1bGFyIHBsYXkgQU5EIGEgY29pbi1mbGlwIGxhbmRzXG4gKiBoZWFkcyAoYWxzbyB1bmNvbmRpdGlvbmFsbHkgd2hlbiBib3RoIHBpY2sgVHJpY2sgUGxheSkuIFJ1bnMgaXRzIG93blxuICogY29pbiArIG11bHRpcGxpZXItY2FyZCBjaGFpbjpcbiAqXG4gKiAgIG11bHRDYXJkID0gS2luZyAgXHUyMTkyIEJpZyBQbGF5IChvZmZlbnNlIGlmIGNvaW49aGVhZHMsIGRlZmVuc2UgaWYgdGFpbHMpXG4gKiAgIG11bHRDYXJkID0gUXVlZW4gKyBoZWFkcyBcdTIxOTIgbXVsdGlwbGllciA9ICszLCBkcmF3IHlhcmRzIGNhcmRcbiAqICAgbXVsdENhcmQgPSBRdWVlbiArIHRhaWxzIFx1MjE5MiBtdWx0aXBsaWVyID0gIDAsIG5vIHlhcmRzIChkaXN0ID0gMClcbiAqICAgbXVsdENhcmQgPSBKYWNrICArIGhlYWRzIFx1MjE5MiBtdWx0aXBsaWVyID0gIDAsIG5vIHlhcmRzIChkaXN0ID0gMClcbiAqICAgbXVsdENhcmQgPSBKYWNrICArIHRhaWxzIFx1MjE5MiBtdWx0aXBsaWVyID0gLTMsIGRyYXcgeWFyZHMgY2FyZFxuICogICBtdWx0Q2FyZCA9IDEwICAgICsgaGVhZHMgXHUyMTkyIElOVEVSQ0VQVElPTiAodHVybm92ZXIgYXQgc3BvdClcbiAqICAgbXVsdENhcmQgPSAxMCAgICArIHRhaWxzIFx1MjE5MiAwIHlhcmRzXG4gKlxuICogTm90ZTogdGhlIGNvaW4gZmxpcCBpbnNpZGUgdGhpcyBmdW5jdGlvbiBpcyBhIFNFQ09ORCBjb2luIGZsaXAgXHUyMDE0IHRoZVxuICogbWVjaGFuaXNtLXRyaWdnZXIgY29pbiBmbGlwIGlzIGhhbmRsZWQgYnkgdGhlIHJlZHVjZXIgYmVmb3JlIGNhbGxpbmcgaGVyZS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4uLy4uL3N0YXRlLmpzXCI7XG5pbXBvcnQgeyBkcmF3TXVsdGlwbGllciwgZHJhd1lhcmRzIH0gZnJvbSBcIi4uL2RlY2suanNcIjtcbmltcG9ydCB7IHJlc29sdmVCaWdQbGF5IH0gZnJvbSBcIi4vYmlnUGxheS5qc1wiO1xuaW1wb3J0IHtcbiAgYXBwbHlZYXJkYWdlT3V0Y29tZSxcbiAgYmxhbmtQaWNrLFxuICBidW1wU3RhdHMsXG4gIHR5cGUgU3BlY2lhbFJlc29sdXRpb24sXG59IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVNhbWVQbGF5KHN0YXRlOiBHYW1lU3RhdGUsIHJuZzogUm5nKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG5cbiAgY29uc3QgY29pbiA9IHJuZy5jb2luRmxpcCgpO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiU0FNRV9QTEFZX0NPSU5cIiwgb3V0Y29tZTogY29pbiB9KTtcblxuICBjb25zdCBtdWx0RHJhdyA9IGRyYXdNdWx0aXBsaWVyKHN0YXRlLmRlY2ssIHJuZyk7XG4gIGlmIChtdWx0RHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcIm11bHRpcGxpZXJcIiB9KTtcblxuICBjb25zdCBzdGF0ZUFmdGVyTXVsdDogR2FtZVN0YXRlID0geyAuLi5zdGF0ZSwgZGVjazogbXVsdERyYXcuZGVjayB9O1xuICBjb25zdCBoZWFkcyA9IGNvaW4gPT09IFwiaGVhZHNcIjtcblxuICAvLyBLaW5nIFx1MjE5MiBCaWcgUGxheSBmb3Igd2hpY2hldmVyIHNpZGUgd2lucyB0aGUgY29pbi5cbiAgaWYgKG11bHREcmF3LmNhcmQgPT09IFwiS2luZ1wiKSB7XG4gICAgY29uc3QgYmVuZWZpY2lhcnkgPSBoZWFkcyA/IG9mZmVuc2UgOiBvcHAob2ZmZW5zZSk7XG4gICAgY29uc3QgYnAgPSByZXNvbHZlQmlnUGxheShzdGF0ZUFmdGVyTXVsdCwgYmVuZWZpY2lhcnksIHJuZyk7XG4gICAgcmV0dXJuIHsgc3RhdGU6IGJwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLmJwLmV2ZW50c10gfTtcbiAgfVxuXG4gIC8vIDEwIFx1MjE5MiBpbnRlcmNlcHRpb24gKGhlYWRzKSBvciAwIHlhcmRzICh0YWlscykuXG4gIGlmIChtdWx0RHJhdy5jYXJkID09PSBcIjEwXCIpIHtcbiAgICBpZiAoaGVhZHMpIHtcbiAgICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiaW50ZXJjZXB0aW9uXCIgfSk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0ZToge1xuICAgICAgICAgIC4uLnN0YXRlQWZ0ZXJNdWx0LFxuICAgICAgICAgIHBsYXllcnM6IGJ1bXBTdGF0cyhzdGF0ZUFmdGVyTXVsdC5wbGF5ZXJzLCBvZmZlbnNlLCB7IHR1cm5vdmVyczogMSB9KSxcbiAgICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICAgIC4uLnN0YXRlQWZ0ZXJNdWx0LmZpZWxkLFxuICAgICAgICAgICAgb2ZmZW5zZTogb3BwKG9mZmVuc2UpLFxuICAgICAgICAgICAgYmFsbE9uOiAxMDAgLSBzdGF0ZUFmdGVyTXVsdC5maWVsZC5iYWxsT24sXG4gICAgICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCAxMDAgLSBzdGF0ZUFmdGVyTXVsdC5maWVsZC5iYWxsT24gKyAxMCksXG4gICAgICAgICAgICBkb3duOiAxLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGV2ZW50cyxcbiAgICAgIH07XG4gICAgfVxuICAgIC8vIDAgeWFyZHMsIGRvd24gY29uc3VtZWQuIEVtaXQgUExBWV9SRVNPTFZFRCBzbyB0aGUgbmFycmF0b3IgY2FuXG4gICAgLy8gcmVuZGVyIFwibm8gZ2FpblwiIGluc3RlYWQgb2YgbGVhdmluZyBvbmx5IFNBTUVfUExBWV9DT0lOIHZpc2libGVcbiAgICAvLyBhbmQgdGhlIGRvd24gc2lsZW50bHkgYWR2YW5jaW5nIChGLTQ4KS5cbiAgICBldmVudHMucHVzaCh7XG4gICAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICAgIG9mZmVuc2VQbGF5OiBzdGF0ZS5wZW5kaW5nUGljay5vZmZlbnNlUGxheSA/PyBcIlNSXCIsXG4gICAgICBkZWZlbnNlUGxheTogc3RhdGUucGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgPz8gXCJTUlwiLFxuICAgICAgbWF0Y2h1cFF1YWxpdHk6IDAsXG4gICAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IFwiMTBcIiwgdmFsdWU6IDAgfSxcbiAgICAgIHlhcmRzQ2FyZDogMCxcbiAgICAgIHlhcmRzR2FpbmVkOiAwLFxuICAgICAgbmV3QmFsbE9uOiBzdGF0ZUFmdGVyTXVsdC5maWVsZC5iYWxsT24sXG4gICAgfSk7XG4gICAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoc3RhdGVBZnRlck11bHQsIDAsIGV2ZW50cyk7XG4gIH1cblxuICAvLyBRdWVlbiBvciBKYWNrIFx1MjE5MiBtdWx0aXBsaWVyLCB0aGVuIGRyYXcgeWFyZHMgY2FyZC5cbiAgbGV0IG11bHRpcGxpZXIgPSAwO1xuICBpZiAobXVsdERyYXcuY2FyZCA9PT0gXCJRdWVlblwiKSBtdWx0aXBsaWVyID0gaGVhZHMgPyAzIDogMDtcbiAgaWYgKG11bHREcmF3LmNhcmQgPT09IFwiSmFja1wiKSBtdWx0aXBsaWVyID0gaGVhZHMgPyAwIDogLTM7XG5cbiAgaWYgKG11bHRpcGxpZXIgPT09IDApIHtcbiAgICAvLyAwIHlhcmRzLCBkb3duIGNvbnN1bWVkIChGLTQ4IFx1MjAxNCBzYW1lIGFzIDEwLXRhaWxzIGJyYW5jaCBhYm92ZSkuXG4gICAgZXZlbnRzLnB1c2goe1xuICAgICAgdHlwZTogXCJQTEFZX1JFU09MVkVEXCIsXG4gICAgICBvZmZlbnNlUGxheTogc3RhdGUucGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPz8gXCJTUlwiLFxuICAgICAgZGVmZW5zZVBsYXk6IHN0YXRlLnBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5ID8/IFwiU1JcIixcbiAgICAgIG1hdGNodXBRdWFsaXR5OiAwLFxuICAgICAgbXVsdGlwbGllcjogeyBjYXJkOiBtdWx0RHJhdy5jYXJkLCB2YWx1ZTogMCB9LFxuICAgICAgeWFyZHNDYXJkOiAwLFxuICAgICAgeWFyZHNHYWluZWQ6IDAsXG4gICAgICBuZXdCYWxsT246IHN0YXRlQWZ0ZXJNdWx0LmZpZWxkLmJhbGxPbixcbiAgICB9KTtcbiAgICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShzdGF0ZUFmdGVyTXVsdCwgMCwgZXZlbnRzKTtcbiAgfVxuXG4gIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhzdGF0ZUFmdGVyTXVsdC5kZWNrLCBybmcpO1xuICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcblxuICBjb25zdCB5YXJkcyA9IE1hdGgucm91bmQobXVsdGlwbGllciAqIHlhcmRzRHJhdy5jYXJkKTtcblxuICBldmVudHMucHVzaCh7XG4gICAgdHlwZTogXCJQTEFZX1JFU09MVkVEXCIsXG4gICAgb2ZmZW5zZVBsYXk6IHN0YXRlLnBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ID8/IFwiU1JcIixcbiAgICBkZWZlbnNlUGxheTogc3RhdGUucGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgPz8gXCJTUlwiLFxuICAgIG1hdGNodXBRdWFsaXR5OiAwLFxuICAgIG11bHRpcGxpZXI6IHsgY2FyZDogbXVsdERyYXcuY2FyZCwgdmFsdWU6IG11bHRpcGxpZXIgfSxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgIHlhcmRzR2FpbmVkOiB5YXJkcyxcbiAgICBuZXdCYWxsT246IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgc3RhdGVBZnRlck11bHQuZmllbGQuYmFsbE9uICsgeWFyZHMpKSxcbiAgfSk7XG5cbiAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoXG4gICAgeyAuLi5zdGF0ZUFmdGVyTXVsdCwgZGVjazogeWFyZHNEcmF3LmRlY2sgfSxcbiAgICB5YXJkcyxcbiAgICBldmVudHMsXG4gICk7XG59XG4iLCAiLyoqXG4gKiBUcmljayBQbGF5IHJlc29sdXRpb24gKHJ1bi5qczoxOTg3KS4gT25lIHBlciBzaHVmZmxlLCBjYWxsZWQgYnkgZWl0aGVyXG4gKiBvZmZlbnNlIG9yIGRlZmVuc2UuIERpZSByb2xsIG91dGNvbWVzIChmcm9tIHRoZSAqY2FsbGVyJ3MqIHBlcnNwZWN0aXZlKTpcbiAqXG4gKiAgIDEgXHUyMTkyIExvbmcgUGFzcyB3aXRoICs1IGJvbnVzICAgKG1hdGNodXAgdXNlcyBMUCB2cyB0aGUgb3RoZXIgc2lkZSdzIHBpY2spXG4gKiAgIDIgXHUyMTkyIDE1LXlhcmQgcGVuYWx0eSBvbiBvcHBvc2luZyBzaWRlIChoYWxmLXRvLWdvYWwgaWYgdGlnaHQpXG4gKiAgIDMgXHUyMTkyIGZpeGVkIC0zeCBtdWx0aXBsaWVyLCBkcmF3IHlhcmRzIGNhcmRcbiAqICAgNCBcdTIxOTIgZml4ZWQgKzR4IG11bHRpcGxpZXIsIGRyYXcgeWFyZHMgY2FyZFxuICogICA1IFx1MjE5MiBCaWcgUGxheSAoYmVuZWZpY2lhcnkgPSBjYWxsZXIpXG4gKiAgIDYgXHUyMTkyIExvbmcgUnVuIHdpdGggKzUgYm9udXNcbiAqXG4gKiBXaGVuIHRoZSBjYWxsZXIgaXMgdGhlIGRlZmVuc2UsIHRoZSB5YXJkYWdlIHNpZ25zIGludmVydCAoZGVmZW5zZSBnYWlucyA9XG4gKiBvZmZlbnNlIGxvc2VzKSwgdGhlIExSL0xQIG92ZXJsYXkgaXMgYXBwbGllZCB0byB0aGUgZGVmZW5zaXZlIGNhbGwsIGFuZFxuICogdGhlIEJpZyBQbGF5IGJlbmVmaWNpYXJ5IGlzIGRlZmVuc2UuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIFBsYXllcklkLCBSZWd1bGFyUGxheSB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgZHJhd011bHRpcGxpZXIsIGRyYXdZYXJkcyB9IGZyb20gXCIuLi9kZWNrLmpzXCI7XG5pbXBvcnQgeyBNVUxUSSwgbWF0Y2h1cFF1YWxpdHkgfSBmcm9tIFwiLi4vbWF0Y2h1cC5qc1wiO1xuaW1wb3J0IHsgcmVzb2x2ZUJpZ1BsYXkgfSBmcm9tIFwiLi9iaWdQbGF5LmpzXCI7XG5pbXBvcnQge1xuICBhcHBseVlhcmRhZ2VPdXRjb21lLFxuICBibGFua1BpY2ssXG4gIHR5cGUgU3BlY2lhbFJlc29sdXRpb24sXG59IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZU9mZmVuc2l2ZVRyaWNrUGxheShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgcm5nOiBSbmcsXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBkaWUgPSBybmcuZDYoKTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW3sgdHlwZTogXCJUUklDS19QTEFZX1JPTExcIiwgb3V0Y29tZTogZGllIH1dO1xuXG4gIC8vIDUgXHUyMTkyIEJpZyBQbGF5IGZvciBvZmZlbnNlIChjYWxsZXIpLlxuICBpZiAoZGllID09PSA1KSB7XG4gICAgY29uc3QgYnAgPSByZXNvbHZlQmlnUGxheShzdGF0ZSwgb2ZmZW5zZSwgcm5nKTtcbiAgICByZXR1cm4geyBzdGF0ZTogYnAuc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4uYnAuZXZlbnRzXSB9O1xuICB9XG5cbiAgLy8gMiBcdTIxOTIgMTUteWFyZCBwZW5hbHR5IG9uIGRlZmVuc2UgKD0gb2ZmZW5zZSBnYWlucyAxNSBvciBoYWxmLXRvLWdvYWwpLlxuICBpZiAoZGllID09PSAyKSB7XG4gICAgY29uc3QgcmF3R2FpbiA9IDE1O1xuICAgIGNvbnN0IGdhaW4gPVxuICAgICAgc3RhdGUuZmllbGQuYmFsbE9uICsgcmF3R2FpbiA+IDk5XG4gICAgICAgID8gTWF0aC50cnVuYygoMTAwIC0gc3RhdGUuZmllbGQuYmFsbE9uKSAvIDIpXG4gICAgICAgIDogcmF3R2FpbjtcbiAgICBjb25zdCBuZXdCYWxsT24gPSBNYXRoLm1pbigxMDAsIHN0YXRlLmZpZWxkLmJhbGxPbiArIGdhaW4pO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJQRU5BTFRZXCIsIGFnYWluc3Q6IG9wcG9uZW50KG9mZmVuc2UpLCB5YXJkczogZ2FpbiwgbG9zc09mRG93bjogZmFsc2UgfSk7XG4gICAgLy8gUi0yNTogaWYgdGhlIHBlbmFsdHkgR0FJTiBjYXJyaWVzIHRoZSBiYWxsIHRvIG9yIHBhc3QgdGhlXG4gICAgLy8gZmlyc3QtZG93biBtYXJrZXIsIGdyYW50IGF1dG9tYXRpYyBmaXJzdCBkb3duIFx1MjAxNCByZXNldCBkb3duIHRvIDFcbiAgICAvLyBhbmQgZmlyc3REb3duQXQgdG8gYmFsbE9uICsgMTAuIE90aGVyd2lzZSBrZWVwIHRoZSBjdXJyZW50IGRvd25cbiAgICAvLyAoc2FtZS1kb3duIHJlcGxheXMgd2l0aCB5YXJkcy10by1nbyB1cGRhdGVkKS5cbiAgICBjb25zdCByZWFjaGVkRmlyc3REb3duID0gbmV3QmFsbE9uID49IHN0YXRlLmZpZWxkLmZpcnN0RG93bkF0O1xuICAgIGNvbnN0IG5leHREb3duID0gcmVhY2hlZEZpcnN0RG93biA/IDEgOiBzdGF0ZS5maWVsZC5kb3duO1xuICAgIGNvbnN0IG5leHRGaXJzdERvd25BdCA9IHJlYWNoZWRGaXJzdERvd25cbiAgICAgID8gTWF0aC5taW4oMTAwLCBuZXdCYWxsT24gKyAxMClcbiAgICAgIDogc3RhdGUuZmllbGQuZmlyc3REb3duQXQ7XG4gICAgaWYgKHJlYWNoZWRGaXJzdERvd24pIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJGSVJTVF9ET1dOXCIgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgLi4uc3RhdGUuZmllbGQsXG4gICAgICAgICAgYmFsbE9uOiBuZXdCYWxsT24sXG4gICAgICAgICAgZG93bjogbmV4dERvd24sXG4gICAgICAgICAgZmlyc3REb3duQXQ6IG5leHRGaXJzdERvd25BdCxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIDMgb3IgNCBcdTIxOTIgZml4ZWQgbXVsdGlwbGllciwgZHJhdyB5YXJkcyBjYXJkLlxuICBpZiAoZGllID09PSAzIHx8IGRpZSA9PT0gNCkge1xuICAgIGNvbnN0IG11bHRpcGxpZXIgPSBkaWUgPT09IDMgPyAtMyA6IDQ7XG4gICAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKHN0YXRlLmRlY2ssIHJuZyk7XG4gICAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG4gICAgY29uc3QgeWFyZHMgPSBNYXRoLnJvdW5kKG11bHRpcGxpZXIgKiB5YXJkc0RyYXcuY2FyZCk7XG5cbiAgICBldmVudHMucHVzaCh7XG4gICAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICAgIG9mZmVuc2VQbGF5OiBcIlRQXCIsXG4gICAgICBkZWZlbnNlUGxheTogc3RhdGUucGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgPz8gXCJTUlwiLFxuICAgICAgbWF0Y2h1cFF1YWxpdHk6IDAsXG4gICAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IFwiS2luZ1wiLCB2YWx1ZTogbXVsdGlwbGllciB9LFxuICAgICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgICAgIHlhcmRzR2FpbmVkOiB5YXJkcyxcbiAgICAgIG5ld0JhbGxPbjogTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBzdGF0ZS5maWVsZC5iYWxsT24gKyB5YXJkcykpLFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoXG4gICAgICB7IC4uLnN0YXRlLCBkZWNrOiB5YXJkc0RyYXcuZGVjayB9LFxuICAgICAgeWFyZHMsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuXG4gIC8vIDEgb3IgNiBcdTIxOTIgcmVndWxhciBwbGF5IHJlc29sdXRpb24gd2l0aCBmb3JjZWQgb2ZmZW5zZSBwbGF5ICsgYm9udXMuXG4gIGNvbnN0IGZvcmNlZFBsYXk6IFJlZ3VsYXJQbGF5ID0gZGllID09PSAxID8gXCJMUFwiIDogXCJMUlwiO1xuICBjb25zdCBib251cyA9IDU7XG4gIGNvbnN0IGRlZmVuc2VQbGF5ID0gc3RhdGUucGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgPz8gXCJTUlwiO1xuXG4gIC8vIE11c3QgYmUgYSByZWd1bGFyIHBsYXkgZm9yIG1hdGNodXAgdG8gYmUgbWVhbmluZ2Z1bC4gSWYgZGVmZW5zZSBhbHNvIHBpY2tlZFxuICAvLyBzb21ldGhpbmcgd2VpcmQsIGZhbGwgYmFjayB0byBxdWFsaXR5IDMgKG5ldXRyYWwpLlxuICBjb25zdCBkZWZQbGF5ID0gaXNSZWd1bGFyKGRlZmVuc2VQbGF5KSA/IGRlZmVuc2VQbGF5IDogXCJTUlwiO1xuICBjb25zdCBxdWFsaXR5ID0gbWF0Y2h1cFF1YWxpdHkoZm9yY2VkUGxheSwgZGVmUGxheSk7XG5cbiAgY29uc3QgbXVsdERyYXcgPSBkcmF3TXVsdGlwbGllcihzdGF0ZS5kZWNrLCBybmcpO1xuICBpZiAobXVsdERyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJtdWx0aXBsaWVyXCIgfSk7XG4gIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhtdWx0RHJhdy5kZWNrLCBybmcpO1xuICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcblxuICBjb25zdCBtdWx0Um93ID0gTVVMVElbbXVsdERyYXcuaW5kZXhdO1xuICBjb25zdCBtdWx0aXBsaWVyID0gbXVsdFJvdz8uW3F1YWxpdHkgLSAxXSA/PyAwO1xuICBjb25zdCB5YXJkcyA9IE1hdGgucm91bmQobXVsdGlwbGllciAqIHlhcmRzRHJhdy5jYXJkKSArIGJvbnVzO1xuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICBvZmZlbnNlUGxheTogZm9yY2VkUGxheSxcbiAgICBkZWZlbnNlUGxheTogZGVmUGxheSxcbiAgICBtYXRjaHVwUXVhbGl0eTogcXVhbGl0eSxcbiAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IG11bHREcmF3LmNhcmQsIHZhbHVlOiBtdWx0aXBsaWVyIH0sXG4gICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgICB5YXJkc0dhaW5lZDogeWFyZHMsXG4gICAgbmV3QmFsbE9uOiBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHN0YXRlLmZpZWxkLmJhbGxPbiArIHlhcmRzKSksXG4gIH0pO1xuXG4gIHJldHVybiBhcHBseVlhcmRhZ2VPdXRjb21lKFxuICAgIHsgLi4uc3RhdGUsIGRlY2s6IHlhcmRzRHJhdy5kZWNrIH0sXG4gICAgeWFyZHMsXG4gICAgZXZlbnRzLFxuICApO1xufVxuXG5mdW5jdGlvbiBpc1JlZ3VsYXIocDogc3RyaW5nKTogcCBpcyBSZWd1bGFyUGxheSB7XG4gIHJldHVybiBwID09PSBcIlNSXCIgfHwgcCA9PT0gXCJMUlwiIHx8IHAgPT09IFwiU1BcIiB8fCBwID09PSBcIkxQXCI7XG59XG5cbmZ1bmN0aW9uIG9wcG9uZW50KHA6IFBsYXllcklkKTogUGxheWVySWQge1xuICByZXR1cm4gcCA9PT0gMSA/IDIgOiAxO1xufVxuXG4vKipcbiAqIERlZmVuc2UgY2FsbHMgVHJpY2sgUGxheS4gU3ltbWV0cmljIHRvIHRoZSBvZmZlbnNpdmUgdmVyc2lvbiB3aXRoIHRoZVxuICogeWFyZGFnZSBzaWduIGludmVydGVkIG9uIHRoZSBMUi9MUCBhbmQgcGVuYWx0eSBicmFuY2hlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVEZWZlbnNpdmVUcmlja1BsYXkoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHJuZzogUm5nLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgZGVmZW5kZXIgPSBvcHBvbmVudChvZmZlbnNlKTtcbiAgY29uc3QgZGllID0gcm5nLmQ2KCk7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFt7IHR5cGU6IFwiVFJJQ0tfUExBWV9ST0xMXCIsIG91dGNvbWU6IGRpZSB9XTtcblxuICAvLyA1IFx1MjE5MiBCaWcgUGxheSBmb3IgZGVmZW5zZSAoY2FsbGVyKS5cbiAgaWYgKGRpZSA9PT0gNSkge1xuICAgIGNvbnN0IGJwID0gcmVzb2x2ZUJpZ1BsYXkoc3RhdGUsIGRlZmVuZGVyLCBybmcpO1xuICAgIHJldHVybiB7IHN0YXRlOiBicC5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi5icC5ldmVudHNdIH07XG4gIH1cblxuICAvLyAyIFx1MjE5MiAxNS15YXJkIHBlbmFsdHkgb24gb2ZmZW5zZSAoPSBvZmZlbnNlIGxvc2VzIDE1IG9yIGhhbGYtdG8tb3duLWdvYWwpLlxuICBpZiAoZGllID09PSAyKSB7XG4gICAgY29uc3QgcmF3TG9zcyA9IC0xNTtcbiAgICBjb25zdCBsb3NzID1cbiAgICAgIHN0YXRlLmZpZWxkLmJhbGxPbiArIHJhd0xvc3MgPCAxXG4gICAgICAgID8gLU1hdGgudHJ1bmMoc3RhdGUuZmllbGQuYmFsbE9uIC8gMilcbiAgICAgICAgOiByYXdMb3NzO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJQRU5BTFRZXCIsIGFnYWluc3Q6IG9mZmVuc2UsIHlhcmRzOiBsb3NzLCBsb3NzT2ZEb3duOiBmYWxzZSB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBlbmRpbmdQaWNrOiB7IG9mZmVuc2VQbGF5OiBudWxsLCBkZWZlbnNlUGxheTogbnVsbCB9LFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIC4uLnN0YXRlLmZpZWxkLFxuICAgICAgICAgIGJhbGxPbjogTWF0aC5tYXgoMCwgc3RhdGUuZmllbGQuYmFsbE9uICsgbG9zcyksXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyAzIG9yIDQgXHUyMTkyIGZpeGVkIG11bHRpcGxpZXIgd2l0aCB0aGUgKmRlZmVuc2Uncyogc2lnbiBjb252ZW50aW9uLiB2NS4xXG4gIC8vIGFwcGxpZXMgdGhlIHNhbWUgKy8tIG11bHRpcGxpZXJzIGFzIG9mZmVuc2l2ZSBUcmljayBQbGF5OyB0aGUgaW52ZXJzaW9uXG4gIC8vIGlzIGltcGxpY2l0IGluIGRlZmVuc2UgYmVpbmcgdGhlIGNhbGxlci4gWWFyZGFnZSBpcyBmcm9tIG9mZmVuc2UgUE9WLlxuICBpZiAoZGllID09PSAzIHx8IGRpZSA9PT0gNCkge1xuICAgIGNvbnN0IG11bHRpcGxpZXIgPSBkaWUgPT09IDMgPyAtMyA6IDQ7XG4gICAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKHN0YXRlLmRlY2ssIHJuZyk7XG4gICAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG4gICAgY29uc3QgeWFyZHMgPSBNYXRoLnJvdW5kKG11bHRpcGxpZXIgKiB5YXJkc0RyYXcuY2FyZCk7XG5cbiAgICBldmVudHMucHVzaCh7XG4gICAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICAgIG9mZmVuc2VQbGF5OiBzdGF0ZS5wZW5kaW5nUGljay5vZmZlbnNlUGxheSA/PyBcIlNSXCIsXG4gICAgICBkZWZlbnNlUGxheTogXCJUUFwiLFxuICAgICAgbWF0Y2h1cFF1YWxpdHk6IDAsXG4gICAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IFwiS2luZ1wiLCB2YWx1ZTogbXVsdGlwbGllciB9LFxuICAgICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgICAgIHlhcmRzR2FpbmVkOiB5YXJkcyxcbiAgICAgIG5ld0JhbGxPbjogTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBzdGF0ZS5maWVsZC5iYWxsT24gKyB5YXJkcykpLFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoXG4gICAgICB7IC4uLnN0YXRlLCBkZWNrOiB5YXJkc0RyYXcuZGVjayB9LFxuICAgICAgeWFyZHMsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuXG4gIC8vIDEgb3IgNiBcdTIxOTIgZGVmZW5zZSdzIHBpY2sgYmVjb21lcyBMUCAvIExSIHdpdGggLTUgYm9udXMgdG8gb2ZmZW5zZS5cbiAgY29uc3QgZm9yY2VkRGVmUGxheTogUmVndWxhclBsYXkgPSBkaWUgPT09IDEgPyBcIkxQXCIgOiBcIkxSXCI7XG4gIGNvbnN0IGJvbnVzID0gLTU7XG4gIGNvbnN0IG9mZmVuc2VQbGF5ID0gc3RhdGUucGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPz8gXCJTUlwiO1xuICBjb25zdCBvZmZQbGF5ID0gaXNSZWd1bGFyKG9mZmVuc2VQbGF5KSA/IG9mZmVuc2VQbGF5IDogXCJTUlwiO1xuICBjb25zdCBxdWFsaXR5ID0gbWF0Y2h1cFF1YWxpdHkob2ZmUGxheSwgZm9yY2VkRGVmUGxheSk7XG5cbiAgY29uc3QgbXVsdERyYXcgPSBkcmF3TXVsdGlwbGllcihzdGF0ZS5kZWNrLCBybmcpO1xuICBpZiAobXVsdERyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJtdWx0aXBsaWVyXCIgfSk7XG4gIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhtdWx0RHJhdy5kZWNrLCBybmcpO1xuICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcblxuICBjb25zdCBtdWx0Um93ID0gTVVMVElbbXVsdERyYXcuaW5kZXhdO1xuICBjb25zdCBtdWx0aXBsaWVyID0gbXVsdFJvdz8uW3F1YWxpdHkgLSAxXSA/PyAwO1xuICBjb25zdCB5YXJkcyA9IE1hdGgucm91bmQobXVsdGlwbGllciAqIHlhcmRzRHJhdy5jYXJkKSArIGJvbnVzO1xuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICBvZmZlbnNlUGxheTogb2ZmUGxheSxcbiAgICBkZWZlbnNlUGxheTogZm9yY2VkRGVmUGxheSxcbiAgICBtYXRjaHVwUXVhbGl0eTogcXVhbGl0eSxcbiAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IG11bHREcmF3LmNhcmQsIHZhbHVlOiBtdWx0aXBsaWVyIH0sXG4gICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgICB5YXJkc0dhaW5lZDogeWFyZHMsXG4gICAgbmV3QmFsbE9uOiBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHN0YXRlLmZpZWxkLmJhbGxPbiArIHlhcmRzKSksXG4gIH0pO1xuXG4gIHJldHVybiBhcHBseVlhcmRhZ2VPdXRjb21lKFxuICAgIHsgLi4uc3RhdGUsIGRlY2s6IHlhcmRzRHJhdy5kZWNrIH0sXG4gICAgeWFyZHMsXG4gICAgZXZlbnRzLFxuICApO1xufVxuIiwgIi8qKlxuICogRmllbGQgR29hbCAocnVuLmpzOjIwNDApLlxuICpcbiAqIERpc3RhbmNlID0gKDEwMCAtIGJhbGxPbikgKyAxNy4gU28gZnJvbSB0aGUgNTAsIEZHID0gNjcteWFyZCBhdHRlbXB0LlxuICpcbiAqIERpZSByb2xsIGRldGVybWluZXMgc3VjY2VzcyBieSBkaXN0YW5jZSBiYW5kOlxuICogICBkaXN0YW5jZSA+IDY1ICAgICAgICBcdTIxOTIgMS1pbi0xMDAwIGNoYW5jZSAoZWZmZWN0aXZlbHkgYXV0by1taXNzKVxuICogICBkaXN0YW5jZSA+PSA2MCAgICAgICBcdTIxOTIgbmVlZHMgZGllID0gNlxuICogICBkaXN0YW5jZSA+PSA1MCAgICAgICBcdTIxOTIgbmVlZHMgZGllID49IDVcbiAqICAgZGlzdGFuY2UgPj0gNDAgICAgICAgXHUyMTkyIG5lZWRzIGRpZSA+PSA0XG4gKiAgIGRpc3RhbmNlID49IDMwICAgICAgIFx1MjE5MiBuZWVkcyBkaWUgPj0gM1xuICogICBkaXN0YW5jZSA+PSAyMCAgICAgICBcdTIxOTIgbmVlZHMgZGllID49IDJcbiAqICAgZGlzdGFuY2UgPCAgMjAgICAgICAgXHUyMTkyIGF1dG8tbWFrZVxuICpcbiAqIElmIGEgdGltZW91dCB3YXMgY2FsbGVkIGJ5IHRoZSBkZWZlbnNlIGp1c3QgcHJpb3IgKGtpY2tlciBpY2luZyksIGRpZSsrLlxuICpcbiAqIFN1Y2Nlc3MgXHUyMTkyICszIHBvaW50cywga2lja29mZiB0byBvcHBvbmVudC5cbiAqIE1pc3MgICAgXHUyMTkyIHBvc3Nlc3Npb24gZmxpcHMgYXQgdGhlIFNQT1QgT0YgVEhFIEtJQ0sgKG5vdCB0aGUgbGluZSBvZiBzY3JpbW1hZ2UpLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7IGJsYW5rUGljaywgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbiB9IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIEZpZWxkR29hbE9wdGlvbnMge1xuICAvKiogdHJ1ZSBpZiB0aGUgb3Bwb3NpbmcgdGVhbSBjYWxsZWQgYSB0aW1lb3V0IHRoYXQgc2hvdWxkIGljZSB0aGUga2lja2VyLiAqL1xuICBpY2VkPzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVGaWVsZEdvYWwoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHJuZzogUm5nLFxuICBvcHRzOiBGaWVsZEdvYWxPcHRpb25zID0ge30sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBkaXN0YW5jZSA9IDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbiArIDE3O1xuICBjb25zdCByYXdEaWUgPSBybmcuZDYoKTtcbiAgY29uc3QgZGllID0gb3B0cy5pY2VkID8gTWF0aC5taW4oNiwgcmF3RGllICsgMSkgOiByYXdEaWU7XG5cbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG5cbiAgbGV0IG1ha2U6IGJvb2xlYW47XG4gIGlmIChkaXN0YW5jZSA+IDY1KSB7XG4gICAgLy8gRXNzZW50aWFsbHkgaW1wb3NzaWJsZSBcdTIwMTQgcm9sbGVkIDEtMTAwMCwgbWFrZSBvbmx5IG9uIGV4YWN0IGhpdC5cbiAgICBtYWtlID0gcm5nLmludEJldHdlZW4oMSwgMTAwMCkgPT09IGRpc3RhbmNlO1xuICB9IGVsc2UgaWYgKGRpc3RhbmNlID49IDYwKSBtYWtlID0gZGllID49IDY7XG4gIGVsc2UgaWYgKGRpc3RhbmNlID49IDUwKSBtYWtlID0gZGllID49IDU7XG4gIGVsc2UgaWYgKGRpc3RhbmNlID49IDQwKSBtYWtlID0gZGllID49IDQ7XG4gIGVsc2UgaWYgKGRpc3RhbmNlID49IDMwKSBtYWtlID0gZGllID49IDM7XG4gIGVsc2UgaWYgKGRpc3RhbmNlID49IDIwKSBtYWtlID0gZGllID49IDI7XG4gIGVsc2UgbWFrZSA9IHRydWU7XG5cbiAgaWYgKG1ha2UpIHtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiRklFTERfR09BTF9HT09EXCIsIHBsYXllcjogb2ZmZW5zZSwgcm9sbDogZGllLCBkaXN0YW5jZSB9KTtcbiAgICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgIFtvZmZlbnNlXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLCBzY29yZTogc3RhdGUucGxheWVyc1tvZmZlbnNlXS5zY29yZSArIDMgfSxcbiAgICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIHBoYXNlOiBcIktJQ0tPRkZcIixcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJGSUVMRF9HT0FMX01JU1NFRFwiLCBwbGF5ZXI6IG9mZmVuc2UsIHJvbGw6IGRpZSwgZGlzdGFuY2UgfSk7XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwibWlzc2VkX2ZnXCIgfSk7XG5cbiAgLy8gRi01MSBmaWRlbGl0eTogdjUuMSBwbGFjZXMgYmFsbCBhdCBTUE9UIE9GIEtJQ0sgKDcgeWFyZHMgYmVoaW5kIExPUyBpblxuICAvLyBvZmZlbnNlIFBPViBcdTIxOTIgbWlycm9yICsgNyBpbiBkZWZlbmRlciBQT1YpLiBSZWQtem9uZSBtaXNzZXMgKGtpY2sgc3BvdFxuICAvLyB3b3VsZCBiZSBpbnNpZGUgZGVmZW5kZXIncyAyMCkgc25hcCBmb3J3YXJkIHRvIGRlZmVuZGVyJ3MgMjAuXG4gIGNvbnN0IGRlZmVuZGVyID0gb3BwKG9mZmVuc2UpO1xuICBjb25zdCBraWNrU3BvdEluRGVmZW5kZXJQb3YgPSAxMDAgLSBzdGF0ZS5maWVsZC5iYWxsT24gKyA3O1xuICBjb25zdCBuZXdCYWxsT24gPSBraWNrU3BvdEluRGVmZW5kZXJQb3YgPD0gMjAgPyAyMCA6IGtpY2tTcG90SW5EZWZlbmRlclBvdjtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IG5ld0JhbGxPbixcbiAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgbmV3QmFsbE9uICsgMTApLFxuICAgICAgICBkb3duOiAxLFxuICAgICAgICBvZmZlbnNlOiBkZWZlbmRlcixcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBUd28tUG9pbnQgQ29udmVyc2lvbiAoVFdPX1BUIHBoYXNlKS5cbiAqXG4gKiBCYWxsIGlzIHBsYWNlZCBhdCBvZmZlbnNlJ3MgOTcgKD0gMy15YXJkIGxpbmUpLiBBIHNpbmdsZSByZWd1bGFyIHBsYXkgaXNcbiAqIHJlc29sdmVkLiBJZiB0aGUgcmVzdWx0aW5nIHlhcmRhZ2UgY3Jvc3NlcyB0aGUgZ29hbCBsaW5lLCBUV09fUE9JTlRfR09PRC5cbiAqIE90aGVyd2lzZSwgVFdPX1BPSU5UX0ZBSUxFRC4gRWl0aGVyIHdheSwga2lja29mZiBmb2xsb3dzLlxuICpcbiAqIFVubGlrZSBhIG5vcm1hbCBwbGF5LCBhIDJwdCBkb2VzIE5PVCBjaGFuZ2UgZG93bi9kaXN0YW5jZS4gSXQncyBhIG9uZS1zaG90LlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBSZWd1bGFyUGxheSB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgZHJhd011bHRpcGxpZXIsIGRyYXdZYXJkcyB9IGZyb20gXCIuLi9kZWNrLmpzXCI7XG5pbXBvcnQgeyBjb21wdXRlWWFyZGFnZSB9IGZyb20gXCIuLi95YXJkYWdlLmpzXCI7XG5pbXBvcnQgeyBibGFua1BpY2ssIHR5cGUgU3BlY2lhbFJlc29sdXRpb24gfSBmcm9tIFwiLi9zaGFyZWQuanNcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVUd29Qb2ludENvbnZlcnNpb24oXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIG9mZmVuc2VQbGF5OiBSZWd1bGFyUGxheSxcbiAgZGVmZW5zZVBsYXk6IFJlZ3VsYXJQbGF5LFxuICBybmc6IFJuZyxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuXG4gIGNvbnN0IG11bHREcmF3ID0gZHJhd011bHRpcGxpZXIoc3RhdGUuZGVjaywgcm5nKTtcbiAgaWYgKG11bHREcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwibXVsdGlwbGllclwiIH0pO1xuICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMobXVsdERyYXcuZGVjaywgcm5nKTtcbiAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG5cbiAgY29uc3Qgb3V0Y29tZSA9IGNvbXB1dGVZYXJkYWdlKHtcbiAgICBvZmZlbnNlOiBvZmZlbnNlUGxheSxcbiAgICBkZWZlbnNlOiBkZWZlbnNlUGxheSxcbiAgICBtdWx0aXBsaWVyQ2FyZDogbXVsdERyYXcuaW5kZXgsXG4gICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgfSk7XG5cbiAgLy8gMnB0IHN0YXJ0cyBhdCA5Ny4gQ3Jvc3NpbmcgdGhlIGdvYWwgPSBnb29kLlxuICBjb25zdCBzdGFydEJhbGxPbiA9IDk3O1xuICBjb25zdCBwcm9qZWN0ZWQgPSBzdGFydEJhbGxPbiArIG91dGNvbWUueWFyZHNHYWluZWQ7XG4gIGNvbnN0IGdvb2QgPSBwcm9qZWN0ZWQgPj0gMTAwO1xuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICBvZmZlbnNlUGxheSxcbiAgICBkZWZlbnNlUGxheSxcbiAgICBtYXRjaHVwUXVhbGl0eTogb3V0Y29tZS5tYXRjaHVwUXVhbGl0eSxcbiAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IG91dGNvbWUubXVsdGlwbGllckNhcmROYW1lLCB2YWx1ZTogb3V0Y29tZS5tdWx0aXBsaWVyIH0sXG4gICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgICB5YXJkc0dhaW5lZDogb3V0Y29tZS55YXJkc0dhaW5lZCxcbiAgICBuZXdCYWxsT246IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgcHJvamVjdGVkKSksXG4gIH0pO1xuXG4gIGNvbnN0IG5ld1BsYXllcnMgPSBnb29kXG4gICAgPyAoe1xuICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICBbb2ZmZW5zZV06IHsgLi4uc3RhdGUucGxheWVyc1tvZmZlbnNlXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbb2ZmZW5zZV0uc2NvcmUgKyAyIH0sXG4gICAgICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl0pXG4gICAgOiBzdGF0ZS5wbGF5ZXJzO1xuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBnb29kID8gXCJUV09fUE9JTlRfR09PRFwiIDogXCJUV09fUE9JTlRfRkFJTEVEXCIsXG4gICAgcGxheWVyOiBvZmZlbnNlLFxuICB9KTtcblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIGRlY2s6IHlhcmRzRHJhdy5kZWNrLFxuICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIHBoYXNlOiBcIktJQ0tPRkZcIixcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cbiIsICIvKipcbiAqIE92ZXJ0aW1lIG1lY2hhbmljcy5cbiAqXG4gKiBDb2xsZWdlLWZvb3RiYWxsIHN0eWxlOlxuICogICAtIEVhY2ggcGVyaW9kOiBlYWNoIHRlYW0gZ2V0cyBvbmUgcG9zc2Vzc2lvbiBmcm9tIHRoZSBvcHBvbmVudCdzIDI1XG4gKiAgICAgKG9mZmVuc2UgUE9WOiBiYWxsT24gPSA3NSkuXG4gKiAgIC0gQSBwb3NzZXNzaW9uIGVuZHMgd2l0aDogVEQgKGZvbGxvd2VkIGJ5IFBBVC8ycHQpLCBGRyAobWFkZSBvciBtaXNzZWQpLFxuICogICAgIHR1cm5vdmVyLCB0dXJub3Zlci1vbi1kb3ducywgb3Igc2FmZXR5LlxuICogICAtIEFmdGVyIGJvdGggcG9zc2Vzc2lvbnMsIGlmIHNjb3JlcyBkaWZmZXIgXHUyMTkyIEdBTUVfT1ZFUi4gSWYgdGllZCBcdTIxOTIgbmV4dFxuICogICAgIHBlcmlvZC5cbiAqICAgLSBQZXJpb2RzIGFsdGVybmF0ZSB3aG8gcG9zc2Vzc2VzIGZpcnN0LlxuICogICAtIFBlcmlvZCAzKzogMi1wb2ludCBjb252ZXJzaW9uIG1hbmRhdG9yeSBhZnRlciBhIFREIChubyBQQVQga2ljaykuXG4gKiAgIC0gSGFpbCBNYXJ5czogMiBwZXIgcGVyaW9kLCByZWZpbGxlZCBhdCBzdGFydCBvZiBlYWNoIHBlcmlvZC5cbiAqICAgLSBUaW1lb3V0czogMSBwZXIgcGFpciBvZiBwZXJpb2RzLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgT3ZlcnRpbWVTdGF0ZSwgUGxheWVySWQgfSBmcm9tIFwiLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IGVtcHR5SGFuZCwgb3BwIH0gZnJvbSBcIi4uL3N0YXRlLmpzXCI7XG5pbXBvcnQgeyBmcmVzaERlY2tNdWx0aXBsaWVycywgZnJlc2hEZWNrWWFyZHMgfSBmcm9tIFwiLi4vc3RhdGUuanNcIjtcblxuY29uc3QgT1RfQkFMTF9PTiA9IDc1OyAvLyBvcHBvbmVudCdzIDI1LXlhcmQgbGluZSwgZnJvbSBvZmZlbnNlIFBPVlxuXG4vKipcbiAqIEluaXRpYWxpemUgT1Qgc3RhdGUsIHJlZnJlc2ggZGVja3MvaGFuZHMsIHNldCBiYWxsIGF0IHRoZSAyNS5cbiAqIENhbGxlZCBvbmNlIHRpZWQgcmVndWxhdGlvbiBlbmRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3RhcnRPdmVydGltZShzdGF0ZTogR2FtZVN0YXRlKTogeyBzdGF0ZTogR2FtZVN0YXRlOyBldmVudHM6IEV2ZW50W10gfSB7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuICBjb25zdCBmaXJzdFJlY2VpdmVyOiBQbGF5ZXJJZCA9IHN0YXRlLm9wZW5pbmdSZWNlaXZlciA9PT0gMSA/IDIgOiAxO1xuICBjb25zdCBvdmVydGltZTogT3ZlcnRpbWVTdGF0ZSA9IHtcbiAgICBwZXJpb2Q6IDEsXG4gICAgcG9zc2Vzc2lvbjogZmlyc3RSZWNlaXZlcixcbiAgICBmaXJzdFJlY2VpdmVyLFxuICAgIHBvc3Nlc3Npb25zUmVtYWluaW5nOiAyLFxuICB9O1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiT1ZFUlRJTUVfU1RBUlRFRFwiLCBwZXJpb2Q6IDEsIHBvc3Nlc3Npb246IGZpcnN0UmVjZWl2ZXIgfSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGhhc2U6IFwiT1RfU1RBUlRcIixcbiAgICAgIG92ZXJ0aW1lLFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG4vKiogQmVnaW4gKG9yIHJlc3VtZSkgdGhlIG5leHQgT1QgcG9zc2Vzc2lvbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGFydE92ZXJ0aW1lUG9zc2Vzc2lvbihzdGF0ZTogR2FtZVN0YXRlKTogeyBzdGF0ZTogR2FtZVN0YXRlOyBldmVudHM6IEV2ZW50W10gfSB7XG4gIGlmICghc3RhdGUub3ZlcnRpbWUpIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG5cbiAgY29uc3QgcG9zc2Vzc2lvbiA9IHN0YXRlLm92ZXJ0aW1lLnBvc3Nlc3Npb247XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuXG4gIC8vIFJlZmlsbCBITSBjb3VudCBmb3IgdGhlIHBvc3Nlc3Npb24ncyBvZmZlbnNlIChtYXRjaGVzIHY1LjE6IEhNIHJlc2V0c1xuICAvLyBwZXIgT1QgcGVyaW9kKS4gUGVyaW9kIDMrIHBsYXllcnMgaGF2ZSBvbmx5IDIgSE1zIGFueXdheS5cbiAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtwb3NzZXNzaW9uXToge1xuICAgICAgLi4uc3RhdGUucGxheWVyc1twb3NzZXNzaW9uXSxcbiAgICAgIGhhbmQ6IHsgLi4uc3RhdGUucGxheWVyc1twb3NzZXNzaW9uXS5oYW5kLCBITTogc3RhdGUub3ZlcnRpbWUucGVyaW9kID49IDMgPyAyIDogMiB9LFxuICAgIH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICBwaGFzZTogXCJPVF9QTEFZXCIsXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IE9UX0JBTExfT04sXG4gICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIE9UX0JBTExfT04gKyAxMCksXG4gICAgICAgIGRvd246IDEsXG4gICAgICAgIG9mZmVuc2U6IHBvc3Nlc3Npb24sXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG4vKipcbiAqIEVuZCB0aGUgY3VycmVudCBPVCBwb3NzZXNzaW9uLiBEZWNyZW1lbnRzIHBvc3Nlc3Npb25zUmVtYWluaW5nOyBpZiAwLFxuICogY2hlY2tzIGZvciBnYW1lIGVuZC4gT3RoZXJ3aXNlIGZsaXBzIHBvc3Nlc3Npb24uXG4gKlxuICogQ2FsbGVyIGlzIHJlc3BvbnNpYmxlIGZvciBkZXRlY3RpbmcgXCJ0aGlzIHdhcyBhIHBvc3Nlc3Npb24tZW5kaW5nIGV2ZW50XCJcbiAqIChURCtQQVQsIEZHIGRlY2lzaW9uLCB0dXJub3ZlciwgZXRjKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuZE92ZXJ0aW1lUG9zc2Vzc2lvbihzdGF0ZTogR2FtZVN0YXRlKTogeyBzdGF0ZTogR2FtZVN0YXRlOyBldmVudHM6IEV2ZW50W10gfSB7XG4gIGlmICghc3RhdGUub3ZlcnRpbWUpIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG5cbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG4gIGNvbnN0IHJlbWFpbmluZyA9IHN0YXRlLm92ZXJ0aW1lLnBvc3Nlc3Npb25zUmVtYWluaW5nO1xuXG4gIGlmIChyZW1haW5pbmcgPT09IDIpIHtcbiAgICAvLyBGaXJzdCBwb3NzZXNzaW9uIGVuZGVkLiBGbGlwIHRvIHNlY29uZCB0ZWFtLCBmcmVzaCBiYWxsLlxuICAgIGNvbnN0IG5leHRQb3NzZXNzaW9uID0gb3BwKHN0YXRlLm92ZXJ0aW1lLnBvc3Nlc3Npb24pO1xuICAgIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgW25leHRQb3NzZXNzaW9uXToge1xuICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzW25leHRQb3NzZXNzaW9uXSxcbiAgICAgICAgaGFuZDogeyAuLi5zdGF0ZS5wbGF5ZXJzW25leHRQb3NzZXNzaW9uXS5oYW5kLCBITTogMiB9LFxuICAgICAgfSxcbiAgICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgICBwaGFzZTogXCJPVF9QTEFZXCIsXG4gICAgICAgIG92ZXJ0aW1lOiB7IC4uLnN0YXRlLm92ZXJ0aW1lLCBwb3NzZXNzaW9uOiBuZXh0UG9zc2Vzc2lvbiwgcG9zc2Vzc2lvbnNSZW1haW5pbmc6IDEgfSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICBiYWxsT246IE9UX0JBTExfT04sXG4gICAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgT1RfQkFMTF9PTiArIDEwKSxcbiAgICAgICAgICBkb3duOiAxLFxuICAgICAgICAgIG9mZmVuc2U6IG5leHRQb3NzZXNzaW9uLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gU2Vjb25kIHBvc3Nlc3Npb24gZW5kZWQuIENvbXBhcmUgc2NvcmVzLlxuICBjb25zdCBwMSA9IHN0YXRlLnBsYXllcnNbMV0uc2NvcmU7XG4gIGNvbnN0IHAyID0gc3RhdGUucGxheWVyc1syXS5zY29yZTtcbiAgaWYgKHAxICE9PSBwMikge1xuICAgIGNvbnN0IHdpbm5lcjogUGxheWVySWQgPSBwMSA+IHAyID8gMSA6IDI7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkdBTUVfT1ZFUlwiLCB3aW5uZXIgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwaGFzZTogXCJHQU1FX09WRVJcIixcbiAgICAgICAgb3ZlcnRpbWU6IHsgLi4uc3RhdGUub3ZlcnRpbWUsIHBvc3Nlc3Npb25zUmVtYWluaW5nOiAwIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBUaWVkIFx1MjAxNCBzdGFydCBuZXh0IHBlcmlvZC4gQWx0ZXJuYXRlcyBmaXJzdC1wb3NzZXNzb3IuXG4gIGNvbnN0IG5leHRQZXJpb2QgPSBzdGF0ZS5vdmVydGltZS5wZXJpb2QgKyAxO1xuICBjb25zdCBuZXh0Rmlyc3QgPSBvcHAoc3RhdGUub3ZlcnRpbWUuZmlyc3RSZWNlaXZlcik7XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJPVkVSVElNRV9TVEFSVEVEXCIsIHBlcmlvZDogbmV4dFBlcmlvZCwgcG9zc2Vzc2lvbjogbmV4dEZpcnN0IH0pO1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBoYXNlOiBcIk9UX1NUQVJUXCIsXG4gICAgICBvdmVydGltZToge1xuICAgICAgICBwZXJpb2Q6IG5leHRQZXJpb2QsXG4gICAgICAgIHBvc3Nlc3Npb246IG5leHRGaXJzdCxcbiAgICAgICAgZmlyc3RSZWNlaXZlcjogbmV4dEZpcnN0LFxuICAgICAgICBwb3NzZXNzaW9uc1JlbWFpbmluZzogMixcbiAgICAgIH0sXG4gICAgICAvLyBGcmVzaCBkZWNrcyBmb3IgdGhlIG5ldyBwZXJpb2QuXG4gICAgICBkZWNrOiB7IG11bHRpcGxpZXJzOiBmcmVzaERlY2tNdWx0aXBsaWVycygpLCB5YXJkczogZnJlc2hEZWNrWWFyZHMoKSB9LFxuICAgICAgcGxheWVyczoge1xuICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICAxOiB7IC4uLnN0YXRlLnBsYXllcnNbMV0sIGhhbmQ6IGVtcHR5SGFuZCh0cnVlKSB9LFxuICAgICAgICAyOiB7IC4uLnN0YXRlLnBsYXllcnNbMl0sIGhhbmQ6IGVtcHR5SGFuZCh0cnVlKSB9LFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuLyoqXG4gKiBEZXRlY3Qgd2hldGhlciBhIHNlcXVlbmNlIG9mIGV2ZW50cyBmcm9tIGEgcGxheSByZXNvbHV0aW9uIHNob3VsZCBlbmRcbiAqIHRoZSBjdXJyZW50IE9UIHBvc3Nlc3Npb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1Bvc3Nlc3Npb25FbmRpbmdJbk9UKGV2ZW50czogUmVhZG9ubHlBcnJheTxFdmVudD4pOiBib29sZWFuIHtcbiAgZm9yIChjb25zdCBlIG9mIGV2ZW50cykge1xuICAgIHN3aXRjaCAoZS50eXBlKSB7XG4gICAgICBjYXNlIFwiUEFUX0dPT0RcIjpcbiAgICAgIGNhc2UgXCJUV09fUE9JTlRfR09PRFwiOlxuICAgICAgY2FzZSBcIlRXT19QT0lOVF9GQUlMRURcIjpcbiAgICAgIGNhc2UgXCJGSUVMRF9HT0FMX0dPT0RcIjpcbiAgICAgIGNhc2UgXCJGSUVMRF9HT0FMX01JU1NFRFwiOlxuICAgICAgY2FzZSBcIlRVUk5PVkVSXCI6XG4gICAgICBjYXNlIFwiVFVSTk9WRVJfT05fRE9XTlNcIjpcbiAgICAgIGNhc2UgXCJTQUZFVFlcIjpcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cbiIsICIvKipcbiAqIFRoZSBzaW5nbGUgdHJhbnNpdGlvbiBmdW5jdGlvbi4gVGFrZXMgKHN0YXRlLCBhY3Rpb24sIHJuZykgYW5kIHJldHVybnNcbiAqIGEgbmV3IHN0YXRlIHBsdXMgdGhlIGV2ZW50cyB0aGF0IGRlc2NyaWJlIHdoYXQgaGFwcGVuZWQuXG4gKlxuICogVGhpcyBmaWxlIGlzIHRoZSAqc2tlbGV0b24qIFx1MjAxNCB0aGUgZGlzcGF0Y2ggc2hhcGUgaXMgaGVyZSwgdGhlIGNhc2VzIGFyZVxuICogbW9zdGx5IHN0dWJzIG1hcmtlZCBgLy8gVE9ETzogcG9ydCBmcm9tIHJ1bi5qc2AuIEFzIHdlIHBvcnQsIGVhY2ggY2FzZVxuICogZ2V0cyB1bml0LXRlc3RlZC4gV2hlbiBldmVyeSBjYXNlIGlzIGltcGxlbWVudGVkIGFuZCB0ZXN0ZWQsIHY1LjEncyBydW4uanNcbiAqIGNhbiBiZSBkZWxldGVkLlxuICpcbiAqIFJ1bGVzIGZvciB0aGlzIGZpbGU6XG4gKiAgIDEuIE5FVkVSIGltcG9ydCBmcm9tIERPTSwgbmV0d29yaywgb3IgYW5pbWF0aW9uIG1vZHVsZXMuXG4gKiAgIDIuIE5FVkVSIG11dGF0ZSBgc3RhdGVgIFx1MjAxNCBhbHdheXMgcmV0dXJuIGEgbmV3IG9iamVjdC5cbiAqICAgMy4gTkVWRVIgY2FsbCBNYXRoLnJhbmRvbSBcdTIwMTQgdXNlIHRoZSBgcm5nYCBwYXJhbWV0ZXIuXG4gKiAgIDQuIE5FVkVSIHRocm93IG9uIGludmFsaWQgYWN0aW9ucyBcdTIwMTQgcmV0dXJuIGB7IHN0YXRlLCBldmVudHM6IFtdIH1gXG4gKiAgICAgIGFuZCBsZXQgdGhlIGNhbGxlciBkZWNpZGUuIChWYWxpZGF0aW9uIGlzIHRoZSBzZXJ2ZXIncyBqb2IuKVxuICovXG5cbmltcG9ydCB0eXBlIHsgQWN0aW9uIH0gZnJvbSBcIi4vYWN0aW9ucy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIEtpY2tUeXBlLCBSZXR1cm5UeXBlIH0gZnJvbSBcIi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IHZhbGlkYXRlQWN0aW9uIH0gZnJvbSBcIi4vdmFsaWRhdGUuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4vcm5nLmpzXCI7XG5pbXBvcnQgeyBpc1JlZ3VsYXJQbGF5LCByZXNvbHZlUmVndWxhclBsYXkgfSBmcm9tIFwiLi9ydWxlcy9wbGF5LmpzXCI7XG5pbXBvcnQge1xuICByZXNvbHZlRGVmZW5zaXZlVHJpY2tQbGF5LFxuICByZXNvbHZlRmllbGRHb2FsLFxuICByZXNvbHZlSGFpbE1hcnksXG4gIHJlc29sdmVLaWNrb2ZmLFxuICByZXNvbHZlT2ZmZW5zaXZlVHJpY2tQbGF5LFxuICByZXNvbHZlUHVudCxcbiAgcmVzb2x2ZVNhbWVQbGF5LFxuICByZXNvbHZlVHdvUG9pbnRDb252ZXJzaW9uLFxufSBmcm9tIFwiLi9ydWxlcy9zcGVjaWFscy9pbmRleC5qc1wiO1xuaW1wb3J0IHtcbiAgZW5kT3ZlcnRpbWVQb3NzZXNzaW9uLFxuICBpc1Bvc3Nlc3Npb25FbmRpbmdJbk9ULFxuICBzdGFydE92ZXJ0aW1lLFxuICBzdGFydE92ZXJ0aW1lUG9zc2Vzc2lvbixcbn0gZnJvbSBcIi4vcnVsZXMvb3ZlcnRpbWUuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuL3N0YXRlLmpzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVkdWNlUmVzdWx0IHtcbiAgc3RhdGU6IEdhbWVTdGF0ZTtcbiAgZXZlbnRzOiBFdmVudFtdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVkdWNlKHN0YXRlOiBHYW1lU3RhdGUsIGFjdGlvbjogQWN0aW9uLCBybmc6IFJuZyk6IFJlZHVjZVJlc3VsdCB7XG4gIC8vIEdhdGUgYXQgdGhlIHRvcDogaW52YWxpZCBhY3Rpb25zIGFyZSBzaWxlbnRseSBuby1vcGVkLiBTYW1lIGNvbnRyYWN0XG4gIC8vIGFzIHRoZSByZWR1Y2VyJ3MgcGVyLWNhc2Ugc2hhcGUgY2hlY2tzIChcIklsbGVnYWwgcGlja3MgYXJlIHNpbGVudGx5XG4gIC8vIG5vLW9wJ2Q7IHRoZSBvcmNoZXN0cmF0b3IgaXMgcmVzcG9uc2libGUgZm9yIHN1cmZhY2luZyBlcnJvcnNcIiksIGJ1dFxuICAvLyBjZW50cmFsaXplZCBzbyBhbiB1bmF1dGhlbnRpY2F0ZWQgRE8gY2xpZW50IGNhbid0IHNlbmQgYSBtYWxmb3JtZWRcbiAgLy8gcGF5bG9hZCB0aGF0IHNsaXBzIHBhc3QgYSBtaXNzaW5nIGNhc2UtbGV2ZWwgY2hlY2suXG4gIGlmICh2YWxpZGF0ZUFjdGlvbihzdGF0ZSwgYWN0aW9uKSAhPT0gbnVsbCkge1xuICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gIH1cbiAgY29uc3QgcmVzdWx0ID0gcmVkdWNlQ29yZShzdGF0ZSwgYWN0aW9uLCBybmcpO1xuICByZXR1cm4gYXBwbHlPdmVydGltZVJvdXRpbmcoc3RhdGUsIHJlc3VsdCk7XG59XG5cbi8qKlxuICogSWYgd2UncmUgaW4gT1QgYW5kIGEgcG9zc2Vzc2lvbi1lbmRpbmcgZXZlbnQganVzdCBmaXJlZCwgcm91dGUgdG8gdGhlXG4gKiBuZXh0IE9UIHBvc3Nlc3Npb24gKG9yIGdhbWUgZW5kKS4gU2tpcHMgd2hlbiB0aGUgYWN0aW9uIGlzIGl0c2VsZiBhbiBPVFxuICogaGVscGVyIChzbyB3ZSBkb24ndCBkb3VibGUtcm91dGUpLlxuICovXG5mdW5jdGlvbiBhcHBseU92ZXJ0aW1lUm91dGluZyhwcmV2U3RhdGU6IEdhbWVTdGF0ZSwgcmVzdWx0OiBSZWR1Y2VSZXN1bHQpOiBSZWR1Y2VSZXN1bHQge1xuICAvLyBPbmx5IGNvbnNpZGVyIHJvdXRpbmcgd2hlbiB3ZSAqd2VyZSogaW4gT1QuIChzdGFydE92ZXJ0aW1lIHNldHMgc3RhdGUub3ZlcnRpbWUuKVxuICBpZiAoIXByZXZTdGF0ZS5vdmVydGltZSAmJiAhcmVzdWx0LnN0YXRlLm92ZXJ0aW1lKSByZXR1cm4gcmVzdWx0O1xuICBpZiAoIXJlc3VsdC5zdGF0ZS5vdmVydGltZSkgcmV0dXJuIHJlc3VsdDtcbiAgaWYgKCFpc1Bvc3Nlc3Npb25FbmRpbmdJbk9UKHJlc3VsdC5ldmVudHMpKSByZXR1cm4gcmVzdWx0O1xuXG4gIC8vIFBBVCBpbiBPVDogYSBURCBzY29yZWQsIGJ1dCBwb3NzZXNzaW9uIGRvZXNuJ3QgZW5kIHVudGlsIFBBVC8ycHQgcmVzb2x2ZXMuXG4gIC8vIFBBVF9HT09EIC8gVFdPX1BPSU5UXyogYXJlIHRoZW1zZWx2ZXMgcG9zc2Vzc2lvbi1lbmRpbmcsIHNvIHRoZXkgRE8gcm91dGUuXG4gIC8vIEFmdGVyIHBvc3Nlc3Npb24gZW5kcywgZGVjaWRlIG5leHQuXG4gIGNvbnN0IGVuZGVkID0gZW5kT3ZlcnRpbWVQb3NzZXNzaW9uKHJlc3VsdC5zdGF0ZSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IGVuZGVkLnN0YXRlLFxuICAgIGV2ZW50czogWy4uLnJlc3VsdC5ldmVudHMsIC4uLmVuZGVkLmV2ZW50c10sXG4gIH07XG59XG5cbmZ1bmN0aW9uIHJlZHVjZUNvcmUoc3RhdGU6IEdhbWVTdGF0ZSwgYWN0aW9uOiBBY3Rpb24sIHJuZzogUm5nKTogUmVkdWNlUmVzdWx0IHtcbiAgc3dpdGNoIChhY3Rpb24udHlwZSkge1xuICAgIGNhc2UgXCJTVEFSVF9HQU1FXCI6XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0ZToge1xuICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgIHBoYXNlOiBcIkNPSU5fVE9TU1wiLFxuICAgICAgICAgIGNsb2NrOiB7XG4gICAgICAgICAgICAuLi5zdGF0ZS5jbG9jayxcbiAgICAgICAgICAgIHF1YXJ0ZXI6IDEsXG4gICAgICAgICAgICBxdWFydGVyTGVuZ3RoTWludXRlczogYWN0aW9uLnF1YXJ0ZXJMZW5ndGhNaW51dGVzLFxuICAgICAgICAgICAgc2Vjb25kc1JlbWFpbmluZzogYWN0aW9uLnF1YXJ0ZXJMZW5ndGhNaW51dGVzICogNjAsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBwbGF5ZXJzOiB7XG4gICAgICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICAgICAgMTogeyAuLi5zdGF0ZS5wbGF5ZXJzWzFdLCB0ZWFtOiB7IGlkOiBhY3Rpb24udGVhbXNbMV0gfSB9LFxuICAgICAgICAgICAgMjogeyAuLi5zdGF0ZS5wbGF5ZXJzWzJdLCB0ZWFtOiB7IGlkOiBhY3Rpb24udGVhbXNbMl0gfSB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGV2ZW50czogW3sgdHlwZTogXCJHQU1FX1NUQVJURURcIiB9XSxcbiAgICAgIH07XG5cbiAgICBjYXNlIFwiQ09JTl9UT1NTX0NBTExcIjoge1xuICAgICAgY29uc3QgYWN0dWFsID0gcm5nLmNvaW5GbGlwKCk7XG4gICAgICBjb25zdCB3aW5uZXIgPSBhY3Rpb24uY2FsbCA9PT0gYWN0dWFsID8gYWN0aW9uLnBsYXllciA6IG9wcChhY3Rpb24ucGxheWVyKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlLFxuICAgICAgICBldmVudHM6IFt7IHR5cGU6IFwiQ09JTl9UT1NTX1JFU1VMVFwiLCByZXN1bHQ6IGFjdHVhbCwgd2lubmVyIH1dLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiUkVDRUlWRV9DSE9JQ0VcIjoge1xuICAgICAgLy8gVGhlIGNhbGxlcidzIGNob2ljZSBkZXRlcm1pbmVzIHdobyByZWNlaXZlcyB0aGUgb3BlbmluZyBraWNrb2ZmLlxuICAgICAgLy8gXCJyZWNlaXZlXCIgXHUyMTkyIGNhbGxlciByZWNlaXZlczsgXCJkZWZlclwiIFx1MjE5MiBjYWxsZXIga2lja3MgKG9wcG9uZW50IHJlY2VpdmVzKS5cbiAgICAgIGNvbnN0IHJlY2VpdmVyID0gYWN0aW9uLmNob2ljZSA9PT0gXCJyZWNlaXZlXCIgPyBhY3Rpb24ucGxheWVyIDogb3BwKGFjdGlvbi5wbGF5ZXIpO1xuICAgICAgLy8gS2lja2VyIGlzIHRoZSBvcGVuaW5nIG9mZmVuc2UgKHRoZXkga2ljayBvZmYpOyByZWNlaXZlciBnZXRzIHRoZSBiYWxsIGFmdGVyLlxuICAgICAgY29uc3Qga2lja2VyID0gb3BwKHJlY2VpdmVyKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgICAgICAgIG9wZW5pbmdSZWNlaXZlcjogcmVjZWl2ZXIsXG4gICAgICAgICAgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IGtpY2tlciB9LFxuICAgICAgICB9LFxuICAgICAgICBldmVudHM6IFt7IHR5cGU6IFwiS0lDS09GRlwiLCByZWNlaXZpbmdQbGF5ZXI6IHJlY2VpdmVyLCBiYWxsT246IDM1IH1dLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiUkVTT0xWRV9LSUNLT0ZGXCI6IHtcbiAgICAgIGNvbnN0IG9wdHM6IHsga2lja1R5cGU/OiBLaWNrVHlwZTsgcmV0dXJuVHlwZT86IFJldHVyblR5cGUgfSA9IHt9O1xuICAgICAgaWYgKGFjdGlvbi5raWNrVHlwZSkgb3B0cy5raWNrVHlwZSA9IGFjdGlvbi5raWNrVHlwZTtcbiAgICAgIGlmIChhY3Rpb24ucmV0dXJuVHlwZSkgb3B0cy5yZXR1cm5UeXBlID0gYWN0aW9uLnJldHVyblR5cGU7XG4gICAgICBjb25zdCByZXN1bHQgPSByZXNvbHZlS2lja29mZihzdGF0ZSwgcm5nLCBvcHRzKTtcbiAgICAgIHJldHVybiB7IHN0YXRlOiByZXN1bHQuc3RhdGUsIGV2ZW50czogcmVzdWx0LmV2ZW50cyB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJTVEFSVF9PVF9QT1NTRVNTSU9OXCI6IHtcbiAgICAgIGNvbnN0IHIgPSBzdGFydE92ZXJ0aW1lUG9zc2Vzc2lvbihzdGF0ZSk7XG4gICAgICByZXR1cm4geyBzdGF0ZTogci5zdGF0ZSwgZXZlbnRzOiByLmV2ZW50cyB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJQSUNLX1BMQVlcIjoge1xuICAgICAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gICAgICBjb25zdCBpc09mZmVuc2l2ZUNhbGwgPSBhY3Rpb24ucGxheWVyID09PSBvZmZlbnNlO1xuXG4gICAgICAvLyBWYWxpZGF0ZS4gSWxsZWdhbCBwaWNrcyBhcmUgc2lsZW50bHkgbm8tb3AnZDsgdGhlIG9yY2hlc3RyYXRvclxuICAgICAgLy8gKHNlcnZlciAvIFVJKSBpcyByZXNwb25zaWJsZSBmb3Igc3VyZmFjaW5nIHRoZSBlcnJvciB0byB0aGUgdXNlci5cbiAgICAgIGlmIChhY3Rpb24ucGxheSA9PT0gXCJGR1wiIHx8IGFjdGlvbi5wbGF5ID09PSBcIlBVTlRcIiB8fCBhY3Rpb24ucGxheSA9PT0gXCJUV09fUFRcIikge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9OyAvLyB3cm9uZyBhY3Rpb24gdHlwZSBmb3IgdGhlc2VcbiAgICAgIH1cbiAgICAgIGlmIChhY3Rpb24ucGxheSA9PT0gXCJITVwiICYmICFpc09mZmVuc2l2ZUNhbGwpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTsgLy8gZGVmZW5zZSBjYW4ndCBjYWxsIEhhaWwgTWFyeVxuICAgICAgfVxuICAgICAgY29uc3QgaGFuZCA9IHN0YXRlLnBsYXllcnNbYWN0aW9uLnBsYXllcl0uaGFuZDtcbiAgICAgIGlmIChhY3Rpb24ucGxheSA9PT0gXCJITVwiICYmIGhhbmQuSE0gPD0gMCkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgfVxuICAgICAgaWYgKFxuICAgICAgICAoYWN0aW9uLnBsYXkgPT09IFwiU1JcIiB8fCBhY3Rpb24ucGxheSA9PT0gXCJMUlwiIHx8IGFjdGlvbi5wbGF5ID09PSBcIlNQXCIgfHwgYWN0aW9uLnBsYXkgPT09IFwiTFBcIiB8fCBhY3Rpb24ucGxheSA9PT0gXCJUUFwiKSAmJlxuICAgICAgICBoYW5kW2FjdGlvbi5wbGF5XSA8PSAwXG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcbiAgICAgIH1cbiAgICAgIC8vIFJlamVjdCByZS1waWNrcyBmb3IgdGhlIHNhbWUgc2lkZSBpbiB0aGUgc2FtZSBwbGF5LlxuICAgICAgaWYgKGlzT2ZmZW5zaXZlQ2FsbCAmJiBzdGF0ZS5wZW5kaW5nUGljay5vZmZlbnNlUGxheSkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgfVxuICAgICAgaWYgKCFpc09mZmVuc2l2ZUNhbGwgJiYgc3RhdGUucGVuZGluZ1BpY2suZGVmZW5zZVBsYXkpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW1xuICAgICAgICB7IHR5cGU6IFwiUExBWV9DQUxMRURcIiwgcGxheWVyOiBhY3Rpb24ucGxheWVyLCBwbGF5OiBhY3Rpb24ucGxheSB9LFxuICAgICAgXTtcblxuICAgICAgY29uc3QgcGVuZGluZ1BpY2sgPSB7XG4gICAgICAgIG9mZmVuc2VQbGF5OiBpc09mZmVuc2l2ZUNhbGwgPyBhY3Rpb24ucGxheSA6IHN0YXRlLnBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5LFxuICAgICAgICBkZWZlbnNlUGxheTogaXNPZmZlbnNpdmVDYWxsID8gc3RhdGUucGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgOiBhY3Rpb24ucGxheSxcbiAgICAgIH07XG5cbiAgICAgIC8vIEJvdGggdGVhbXMgaGF2ZSBwaWNrZWQgXHUyMDE0IHJlc29sdmUuXG4gICAgICBpZiAocGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgJiYgcGVuZGluZ1BpY2suZGVmZW5zZVBsYXkpIHtcbiAgICAgICAgLy8gMi1wb2ludCBjb252ZXJzaW9uOiBQSUNLX1BMQVkgaW4gVFdPX1BUX0NPTlYgcGhhc2Ugcm91dGVzIHRvIHRoZVxuICAgICAgICAvLyBkZWRpY2F0ZWQgMi1wdCByZXNvbHZlciAoc2NvcmluZyBjYXBwZWQgYXQgMiBwdHMsIG5vIFBBVCBjeWNsZSkuXG4gICAgICAgIC8vIFRQL0hNIG9uIGEgMi1wdCB0cnkgYXJlIGNvZXJjZWQgdG8gU1Igc28gdGhleSBjYW4ndCBtaXMtc2NvcmU6XG4gICAgICAgIC8vIG90aGVyd2lzZSBhIFRQIHRoYXQgZGVmYXVsdHMgdG8gTFIgYW5kIGNyb3NzZXMgdGhlIGdvYWwgbGluZSB3b3VsZFxuICAgICAgICAvLyBydW4gdGhyb3VnaCBhcHBseVlhcmRhZ2VPdXRjb21lIGFuZCBlbWl0IFRPVUNIRE9XTiArIHRyYW5zaXRpb24gdG9cbiAgICAgICAgLy8gUEFUX0NIT0lDRSwgZ3JhbnRpbmcgNiBwb2ludHMgYW5kIGEgZnVsbCBQQVQgaW5zdGVhZCBvZiAyLlxuICAgICAgICBpZiAoc3RhdGUucGhhc2UgPT09IFwiVFdPX1BUX0NPTlZcIikge1xuICAgICAgICAgIGNvbnN0IG9mZlBsYXkgPSBpc1JlZ3VsYXJQbGF5KHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5KVxuICAgICAgICAgICAgPyBwZW5kaW5nUGljay5vZmZlbnNlUGxheVxuICAgICAgICAgICAgOiBcIlNSXCI7XG4gICAgICAgICAgY29uc3QgZGVmUGxheSA9IGlzUmVndWxhclBsYXkocGVuZGluZ1BpY2suZGVmZW5zZVBsYXkpXG4gICAgICAgICAgICA/IHBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5XG4gICAgICAgICAgICA6IFwiU1JcIjtcbiAgICAgICAgICBjb25zdCBzdGF0ZVdpdGhQaWNrOiBHYW1lU3RhdGUgPSB7XG4gICAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICAgIHBlbmRpbmdQaWNrOiB7IG9mZmVuc2VQbGF5OiBvZmZQbGF5LCBkZWZlbnNlUGxheTogZGVmUGxheSB9LFxuICAgICAgICAgIH07XG4gICAgICAgICAgY29uc3QgdHAgPSByZXNvbHZlVHdvUG9pbnRDb252ZXJzaW9uKFxuICAgICAgICAgICAgc3RhdGVXaXRoUGljayxcbiAgICAgICAgICAgIG9mZlBsYXksXG4gICAgICAgICAgICBkZWZQbGF5LFxuICAgICAgICAgICAgcm5nLFxuICAgICAgICAgICk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHRwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLnRwLmV2ZW50c10gfTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHN0YXRlV2l0aFBpY2s6IEdhbWVTdGF0ZSA9IHsgLi4uc3RhdGUsIHBlbmRpbmdQaWNrIH07XG5cbiAgICAgICAgLy8gSGFpbCBNYXJ5IGJ5IG9mZmVuc2UgXHUyMDE0IHJlc29sdmVzIGltbWVkaWF0ZWx5LCBkZWZlbnNlIHBpY2sgaWdub3JlZC5cbiAgICAgICAgaWYgKHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ID09PSBcIkhNXCIpIHtcbiAgICAgICAgICBjb25zdCBobSA9IHJlc29sdmVIYWlsTWFyeShzdGF0ZVdpdGhQaWNrLCBybmcpO1xuICAgICAgICAgIHJldHVybiB7IHN0YXRlOiBobS5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi5obS5ldmVudHNdIH07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBUcmljayBQbGF5IGJ5IGVpdGhlciBzaWRlLiB2NS4xIChydW4uanM6MTg4Nik6IGlmIGJvdGggcGljayBUUCxcbiAgICAgICAgLy8gU2FtZSBQbGF5IGNvaW4gYWx3YXlzIHRyaWdnZXJzIFx1MjAxNCBmYWxscyB0aHJvdWdoIHRvIFNhbWUgUGxheSBiZWxvdy5cbiAgICAgICAgaWYgKFxuICAgICAgICAgIHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ID09PSBcIlRQXCIgJiZcbiAgICAgICAgICBwZW5kaW5nUGljay5kZWZlbnNlUGxheSAhPT0gXCJUUFwiXG4gICAgICAgICkge1xuICAgICAgICAgIGNvbnN0IHRwID0gcmVzb2x2ZU9mZmVuc2l2ZVRyaWNrUGxheShzdGF0ZVdpdGhQaWNrLCBybmcpO1xuICAgICAgICAgIHJldHVybiB7IHN0YXRlOiB0cC5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi50cC5ldmVudHNdIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKFxuICAgICAgICAgIHBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5ID09PSBcIlRQXCIgJiZcbiAgICAgICAgICBwZW5kaW5nUGljay5vZmZlbnNlUGxheSAhPT0gXCJUUFwiXG4gICAgICAgICkge1xuICAgICAgICAgIGNvbnN0IHRwID0gcmVzb2x2ZURlZmVuc2l2ZVRyaWNrUGxheShzdGF0ZVdpdGhQaWNrLCBybmcpO1xuICAgICAgICAgIHJldHVybiB7IHN0YXRlOiB0cC5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi50cC5ldmVudHNdIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ID09PSBcIlRQXCIgJiYgcGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgPT09IFwiVFBcIikge1xuICAgICAgICAgIC8vIEJvdGggVFAgXHUyMTkyIFNhbWUgUGxheSB1bmNvbmRpdGlvbmFsbHkuXG4gICAgICAgICAgY29uc3Qgc3AgPSByZXNvbHZlU2FtZVBsYXkoc3RhdGVXaXRoUGljaywgcm5nKTtcbiAgICAgICAgICByZXR1cm4geyBzdGF0ZTogc3Auc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4uc3AuZXZlbnRzXSB9O1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmVndWxhciB2cyByZWd1bGFyLlxuICAgICAgICBpZiAoXG4gICAgICAgICAgaXNSZWd1bGFyUGxheShwZW5kaW5nUGljay5vZmZlbnNlUGxheSkgJiZcbiAgICAgICAgICBpc1JlZ3VsYXJQbGF5KHBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5KVxuICAgICAgICApIHtcbiAgICAgICAgICAvLyBTYW1lIHBsYXk/IDUwLzUwIGNoYW5jZSB0byB0cmlnZ2VyIFNhbWUgUGxheSBtZWNoYW5pc20uXG4gICAgICAgICAgLy8gU291cmNlOiBydW4uanM6MTg4NiAoYGlmIChwbDEgPT09IHBsMilgKS5cbiAgICAgICAgICBpZiAocGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPT09IHBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5KSB7XG4gICAgICAgICAgICBjb25zdCB0cmlnZ2VyID0gcm5nLmNvaW5GbGlwKCk7XG4gICAgICAgICAgICBpZiAodHJpZ2dlciA9PT0gXCJoZWFkc1wiKSB7XG4gICAgICAgICAgICAgIGNvbnN0IHNwID0gcmVzb2x2ZVNhbWVQbGF5KHN0YXRlV2l0aFBpY2ssIHJuZyk7XG4gICAgICAgICAgICAgIHJldHVybiB7IHN0YXRlOiBzcC5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi5zcC5ldmVudHNdIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBUYWlsczogZmFsbCB0aHJvdWdoIHRvIHJlZ3VsYXIgcmVzb2x1dGlvbiAocXVhbGl0eSA1IG91dGNvbWUpLlxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHJlc29sdmVkID0gcmVzb2x2ZVJlZ3VsYXJQbGF5KFxuICAgICAgICAgICAgc3RhdGVXaXRoUGljayxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgb2ZmZW5zZVBsYXk6IHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5LFxuICAgICAgICAgICAgICBkZWZlbnNlUGxheTogcGVuZGluZ1BpY2suZGVmZW5zZVBsYXksXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcm5nLFxuICAgICAgICAgICk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHJlc29sdmVkLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLnJlc29sdmVkLmV2ZW50c10gfTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIERlZmVuc2l2ZSB0cmljayBwbGF5LCBGRywgUFVOVCwgVFdPX1BUIHBpY2tzIFx1MjAxNCBub3Qgcm91dGVkIGhlcmUgeWV0LlxuICAgICAgICAvLyBGRy9QVU5UL1RXT19QVCBhcmUgZHJpdmVuIGJ5IEZPVVJUSF9ET1dOX0NIT0lDRSAvIFBBVF9DSE9JQ0UgYWN0aW9ucyxcbiAgICAgICAgLy8gbm90IGJ5IFBJQ0tfUExBWS4gRGVmZW5zaXZlIFRQIGlzIGEgVE9ETy5cbiAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHN0YXRlV2l0aFBpY2ssIGV2ZW50cyB9O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4geyBzdGF0ZTogeyAuLi5zdGF0ZSwgcGVuZGluZ1BpY2sgfSwgZXZlbnRzIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIkNBTExfVElNRU9VVFwiOiB7XG4gICAgICBjb25zdCBwID0gc3RhdGUucGxheWVyc1thY3Rpb24ucGxheWVyXTtcbiAgICAgIGlmIChwLnRpbWVvdXRzIDw9IDApIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gICAgICBjb25zdCByZW1haW5pbmcgPSBwLnRpbWVvdXRzIC0gMTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgcGxheWVyczoge1xuICAgICAgICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgICAgICAgIFthY3Rpb24ucGxheWVyXTogeyAuLi5wLCB0aW1lb3V0czogcmVtYWluaW5nIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgZXZlbnRzOiBbeyB0eXBlOiBcIlRJTUVPVVRfQ0FMTEVEXCIsIHBsYXllcjogYWN0aW9uLnBsYXllciwgcmVtYWluaW5nIH1dLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiQUNDRVBUX1BFTkFMVFlcIjpcbiAgICBjYXNlIFwiREVDTElORV9QRU5BTFRZXCI6XG4gICAgICAvLyBQZW5hbHRpZXMgYXJlIGNhcHR1cmVkIGFzIGV2ZW50cyBhdCByZXNvbHV0aW9uIHRpbWUsIGJ1dCBhY2NlcHQvZGVjbGluZVxuICAgICAgLy8gZmxvdyByZXF1aXJlcyBzdGF0ZSBub3QgeWV0IG1vZGVsZWQgKHBlbmRpbmcgcGVuYWx0eSkuIFRPRE8gd2hlblxuICAgICAgLy8gcGVuYWx0eSBtZWNoYW5pY3MgYXJlIHBvcnRlZCBmcm9tIHJ1bi5qcy5cbiAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG5cbiAgICBjYXNlIFwiUEFUX0NIT0lDRVwiOiB7XG4gICAgICBjb25zdCBzY29yZXIgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICAgICAgLy8gM09UKyByZXF1aXJlcyAyLXBvaW50IGNvbnZlcnNpb24uIFNpbGVudGx5IHN1YnN0aXR1dGUgZXZlbiBpZiBcImtpY2tcIlxuICAgICAgLy8gd2FzIHNlbnQgKG1hdGNoZXMgdjUuMSdzIFwibXVzdFwiIGJlaGF2aW9yIGF0IHJ1bi5qczoxNjQxKS5cbiAgICAgIGNvbnN0IGVmZmVjdGl2ZUNob2ljZSA9XG4gICAgICAgIHN0YXRlLm92ZXJ0aW1lICYmIHN0YXRlLm92ZXJ0aW1lLnBlcmlvZCA+PSAzXG4gICAgICAgICAgPyBcInR3b19wb2ludFwiXG4gICAgICAgICAgOiBhY3Rpb24uY2hvaWNlO1xuICAgICAgaWYgKGVmZmVjdGl2ZUNob2ljZSA9PT0gXCJraWNrXCIpIHtcbiAgICAgICAgLy8gQXNzdW1lIGF1dG9tYXRpYyBpbiB2NS4xIFx1MjAxNCBubyBtZWNoYW5pYyByZWNvcmRlZCBmb3IgUEFUIGtpY2tzLlxuICAgICAgICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgICAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICAgICAgW3Njb3Jlcl06IHsgLi4uc3RhdGUucGxheWVyc1tzY29yZXJdLCBzY29yZTogc3RhdGUucGxheWVyc1tzY29yZXJdLnNjb3JlICsgMSB9LFxuICAgICAgICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgc3RhdGU6IHtcbiAgICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgICAgICAgIHBoYXNlOiBcIktJQ0tPRkZcIixcbiAgICAgICAgICB9LFxuICAgICAgICAgIGV2ZW50czogW3sgdHlwZTogXCJQQVRfR09PRFwiLCBwbGF5ZXI6IHNjb3JlciB9XSxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIC8vIHR3b19wb2ludCBcdTIxOTIgdHJhbnNpdGlvbiB0byBUV09fUFRfQ09OViBwaGFzZTsgYSBQSUNLX1BMQVkgcmVzb2x2ZXMgaXQuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0ZToge1xuICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgIHBoYXNlOiBcIlRXT19QVF9DT05WXCIsXG4gICAgICAgICAgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIGJhbGxPbjogOTcsIGZpcnN0RG93bkF0OiAxMDAsIGRvd246IDEgfSxcbiAgICAgICAgfSxcbiAgICAgICAgZXZlbnRzOiBbXSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIkZPVVJUSF9ET1dOX0NIT0lDRVwiOiB7XG4gICAgICBpZiAoYWN0aW9uLmNob2ljZSA9PT0gXCJnb1wiKSB7XG4gICAgICAgIC8vIE5vdGhpbmcgdG8gZG8gXHUyMDE0IHRoZSBuZXh0IFBJQ0tfUExBWSB3aWxsIHJlc29sdmUgbm9ybWFsbHkgZnJvbSA0dGggZG93bi5cbiAgICAgICAgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcbiAgICAgIH1cbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlID09PSBcInB1bnRcIikge1xuICAgICAgICBjb25zdCByZXN1bHQgPSByZXNvbHZlUHVudChzdGF0ZSwgcm5nKTtcbiAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHJlc3VsdC5zdGF0ZSwgZXZlbnRzOiByZXN1bHQuZXZlbnRzIH07XG4gICAgICB9XG4gICAgICAvLyBmZ1xuICAgICAgY29uc3QgcmVzdWx0ID0gcmVzb2x2ZUZpZWxkR29hbChzdGF0ZSwgcm5nKTtcbiAgICAgIHJldHVybiB7IHN0YXRlOiByZXN1bHQuc3RhdGUsIGV2ZW50czogcmVzdWx0LmV2ZW50cyB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJGT1JGRUlUXCI6IHtcbiAgICAgIGNvbnN0IHdpbm5lciA9IG9wcChhY3Rpb24ucGxheWVyKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7IC4uLnN0YXRlLCBwaGFzZTogXCJHQU1FX09WRVJcIiB9LFxuICAgICAgICBldmVudHM6IFt7IHR5cGU6IFwiR0FNRV9PVkVSXCIsIHdpbm5lciB9XSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIlRJQ0tfQ0xPQ0tcIjoge1xuICAgICAgY29uc3QgcHJldiA9IHN0YXRlLmNsb2NrLnNlY29uZHNSZW1haW5pbmc7XG4gICAgICBjb25zdCBuZXh0ID0gTWF0aC5tYXgoMCwgcHJldiAtIGFjdGlvbi5zZWNvbmRzKTtcbiAgICAgIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFt7IHR5cGU6IFwiQ0xPQ0tfVElDS0VEXCIsIHNlY29uZHM6IGFjdGlvbi5zZWNvbmRzIH1dO1xuXG4gICAgICAvLyBUd28tbWludXRlIHdhcm5pbmc6IGNyb3NzaW5nIDEyMCBzZWNvbmRzIGluIFEyIG9yIFE0IHRyaWdnZXJzIGFuIGV2ZW50LlxuICAgICAgaWYgKFxuICAgICAgICAoc3RhdGUuY2xvY2sucXVhcnRlciA9PT0gMiB8fCBzdGF0ZS5jbG9jay5xdWFydGVyID09PSA0KSAmJlxuICAgICAgICBwcmV2ID4gMTIwICYmXG4gICAgICAgIG5leHQgPD0gMTIwXG4gICAgICApIHtcbiAgICAgICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRXT19NSU5VVEVfV0FSTklOR1wiIH0pO1xuICAgICAgfVxuXG4gICAgICAvLyBSLTI4IFplcm8tc2Vjb25kIHBsYXk6IHdoZW4gdGhlIGNsb2NrIGZpcnN0IGhpdHMgMCAocHJldiA+IDAsXG4gICAgICAvLyBuZXh0ID09PSAwKSwgZW1pdCBMQVNUX0NIQU5DRV9UT19PRkZFUkVEIGFuZCBob2xkIHRoZSBxdWFydGVyXG4gICAgICAvLyBvcGVuLiBBIGZpbmFsIHBsYXkgcnVucyBhdCAwOjAwOyB0aGUgcXVhcnRlciBhY3R1YWxseSBlbmRzIG9uXG4gICAgICAvLyB0aGUgTkVYVCBub24temVybyB0aWNrIChwcmV2ID09PSAwICYmIGFjdGlvbi5zZWNvbmRzID4gMCkuXG4gICAgICAvLyBBIFRPIGNhbGxlZCBkdXJpbmcgdGhlIDA6MDAgcGxheSBkaXNwYXRjaGVzIFRJQ0tfQ0xPQ0soMCkgZnJvbVxuICAgICAgLy8gdGhlIGRyaXZlciwgd2hpY2ggbGVhdmVzIHRoZSBjbG9jayBhdCAwIHdpdGhvdXQgdHJhbnNpdGlvbmluZy5cbiAgICAgIGlmIChwcmV2ID4gMCAmJiBuZXh0ID09PSAwKSB7XG4gICAgICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJMQVNUX0NIQU5DRV9UT19PRkZFUkVEXCIsIHF1YXJ0ZXI6IHN0YXRlLmNsb2NrLnF1YXJ0ZXIgfSk7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgc3RhdGU6IHsgLi4uc3RhdGUsIGNsb2NrOiB7IC4uLnN0YXRlLmNsb2NrLCBzZWNvbmRzUmVtYWluaW5nOiAwIH0gfSxcbiAgICAgICAgICBldmVudHMsXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIC8vIENsb2NrIHdhcyBhbHJlYWR5IGF0IDAgYW5kIGEgbm9uLXplcm8gdGljayB3YXMgZGlzcGF0Y2hlZCBcdTIxOTIgdGhlXG4gICAgICAvLyBmaW5hbC1wbGF5IHdpbmRvdyBpcyBjbG9zZWQsIHF1YXJ0ZXIgYWN0dWFsbHkgZW5kcyBub3cuXG4gICAgICBpZiAocHJldiA9PT0gMCAmJiBhY3Rpb24uc2Vjb25kcyA+IDApIHtcbiAgICAgICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlFVQVJURVJfRU5ERURcIiwgcXVhcnRlcjogc3RhdGUuY2xvY2sucXVhcnRlciB9KTtcbiAgICAgICAgLy8gUTFcdTIxOTJRMiBhbmQgUTNcdTIxOTJRNDogcm9sbCBvdmVyIGNsb2NrLCBzYW1lIGhhbGYsIHNhbWUgcG9zc2Vzc2lvbiBjb250aW51ZXMuXG4gICAgICAgIGlmIChzdGF0ZS5jbG9jay5xdWFydGVyID09PSAxIHx8IHN0YXRlLmNsb2NrLnF1YXJ0ZXIgPT09IDMpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdGU6IHtcbiAgICAgICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgICAgIGNsb2NrOiB7XG4gICAgICAgICAgICAgICAgLi4uc3RhdGUuY2xvY2ssXG4gICAgICAgICAgICAgICAgcXVhcnRlcjogc3RhdGUuY2xvY2sucXVhcnRlciArIDEsXG4gICAgICAgICAgICAgICAgc2Vjb25kc1JlbWFpbmluZzogc3RhdGUuY2xvY2sucXVhcnRlckxlbmd0aE1pbnV0ZXMgKiA2MCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBldmVudHMsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICAvLyBFbmQgb2YgUTIgPSBoYWxmdGltZS4gUTQgZW5kID0gcmVndWxhdGlvbiBvdmVyLlxuICAgICAgICBpZiAoc3RhdGUuY2xvY2sucXVhcnRlciA9PT0gMikge1xuICAgICAgICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJIQUxGX0VOREVEXCIgfSk7XG4gICAgICAgICAgLy8gUmVjZWl2ZXIgb2Ygb3BlbmluZyBraWNrb2ZmIGtpY2tzIHRoZSBzZWNvbmQgaGFsZjsgZmxpcCBwb3NzZXNzaW9uLlxuICAgICAgICAgIGNvbnN0IHNlY29uZEhhbGZSZWNlaXZlciA9XG4gICAgICAgICAgICBzdGF0ZS5vcGVuaW5nUmVjZWl2ZXIgPT09IG51bGwgPyAxIDogb3BwKHN0YXRlLm9wZW5pbmdSZWNlaXZlcik7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgICAgICBwaGFzZTogXCJLSUNLT0ZGXCIsXG4gICAgICAgICAgICAgIGNsb2NrOiB7XG4gICAgICAgICAgICAgICAgLi4uc3RhdGUuY2xvY2ssXG4gICAgICAgICAgICAgICAgcXVhcnRlcjogMyxcbiAgICAgICAgICAgICAgICBzZWNvbmRzUmVtYWluaW5nOiBzdGF0ZS5jbG9jay5xdWFydGVyTGVuZ3RoTWludXRlcyAqIDYwLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogb3BwKHNlY29uZEhhbGZSZWNlaXZlcikgfSxcbiAgICAgICAgICAgICAgLy8gUmVmcmVzaCB0aW1lb3V0cyBmb3IgbmV3IGhhbGYuXG4gICAgICAgICAgICAgIHBsYXllcnM6IHtcbiAgICAgICAgICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICAgICAgICAgIDE6IHsgLi4uc3RhdGUucGxheWVyc1sxXSwgdGltZW91dHM6IDMgfSxcbiAgICAgICAgICAgICAgICAyOiB7IC4uLnN0YXRlLnBsYXllcnNbMl0sIHRpbWVvdXRzOiAzIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZXZlbnRzLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgLy8gUTQgZW5kZWQuXG4gICAgICAgIGNvbnN0IHAxID0gc3RhdGUucGxheWVyc1sxXS5zY29yZTtcbiAgICAgICAgY29uc3QgcDIgPSBzdGF0ZS5wbGF5ZXJzWzJdLnNjb3JlO1xuICAgICAgICBpZiAocDEgIT09IHAyKSB7XG4gICAgICAgICAgY29uc3Qgd2lubmVyID0gcDEgPiBwMiA/IDEgOiAyO1xuICAgICAgICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJHQU1FX09WRVJcIiwgd2lubmVyIH0pO1xuICAgICAgICAgIHJldHVybiB7IHN0YXRlOiB7IC4uLnN0YXRlLCBwaGFzZTogXCJHQU1FX09WRVJcIiB9LCBldmVudHMgfTtcbiAgICAgICAgfVxuICAgICAgICAvLyBUaWVkIFx1MjAxNCBoZWFkIHRvIG92ZXJ0aW1lLlxuICAgICAgICBjb25zdCBvdENsb2NrID0geyAuLi5zdGF0ZS5jbG9jaywgcXVhcnRlcjogNSwgc2Vjb25kc1JlbWFpbmluZzogMCB9O1xuICAgICAgICBjb25zdCBvdCA9IHN0YXJ0T3ZlcnRpbWUoeyAuLi5zdGF0ZSwgY2xvY2s6IG90Q2xvY2sgfSk7XG4gICAgICAgIGV2ZW50cy5wdXNoKC4uLm90LmV2ZW50cyk7XG4gICAgICAgIHJldHVybiB7IHN0YXRlOiBvdC5zdGF0ZSwgZXZlbnRzIH07XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7IC4uLnN0YXRlLCBjbG9jazogeyAuLi5zdGF0ZS5jbG9jaywgc2Vjb25kc1JlbWFpbmluZzogbmV4dCB9IH0sXG4gICAgICAgIGV2ZW50cyxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgZGVmYXVsdDoge1xuICAgICAgLy8gRXhoYXVzdGl2ZW5lc3MgY2hlY2sgXHUyMDE0IGFkZGluZyBhIG5ldyBBY3Rpb24gdmFyaWFudCB3aXRob3V0IGhhbmRsaW5nIGl0XG4gICAgICAvLyBoZXJlIHdpbGwgcHJvZHVjZSBhIGNvbXBpbGUgZXJyb3IuXG4gICAgICBjb25zdCBfZXhoYXVzdGl2ZTogbmV2ZXIgPSBhY3Rpb247XG4gICAgICB2b2lkIF9leGhhdXN0aXZlO1xuICAgICAgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBDb252ZW5pZW5jZSBmb3IgcmVwbGF5aW5nIGEgc2VxdWVuY2Ugb2YgYWN0aW9ucyBcdTIwMTQgdXNlZnVsIGZvciB0ZXN0cyBhbmRcbiAqIGZvciBzZXJ2ZXItc2lkZSBnYW1lIHJlcGxheSBmcm9tIGFjdGlvbiBsb2cuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWR1Y2VNYW55KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBhY3Rpb25zOiBBY3Rpb25bXSxcbiAgcm5nOiBSbmcsXG4pOiBSZWR1Y2VSZXN1bHQge1xuICBsZXQgY3VycmVudCA9IHN0YXRlO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcbiAgZm9yIChjb25zdCBhY3Rpb24gb2YgYWN0aW9ucykge1xuICAgIGNvbnN0IHJlc3VsdCA9IHJlZHVjZShjdXJyZW50LCBhY3Rpb24sIHJuZyk7XG4gICAgY3VycmVudCA9IHJlc3VsdC5zdGF0ZTtcbiAgICBldmVudHMucHVzaCguLi5yZXN1bHQuZXZlbnRzKTtcbiAgfVxuICByZXR1cm4geyBzdGF0ZTogY3VycmVudCwgZXZlbnRzIH07XG59XG4iLCAiLyoqXG4gKiBSTkcgYWJzdHJhY3Rpb24uXG4gKlxuICogVGhlIGVuZ2luZSBuZXZlciByZWFjaGVzIGZvciBgTWF0aC5yYW5kb20oKWAgZGlyZWN0bHkuIEFsbCByYW5kb21uZXNzIGlzXG4gKiBzb3VyY2VkIGZyb20gYW4gYFJuZ2AgaW5zdGFuY2UgcGFzc2VkIGludG8gYHJlZHVjZSgpYC4gVGhpcyBpcyB3aGF0IG1ha2VzXG4gKiB0aGUgZW5naW5lIGRldGVybWluaXN0aWMgYW5kIHRlc3RhYmxlLlxuICpcbiAqIEluIHByb2R1Y3Rpb24sIHRoZSBTdXBhYmFzZSBFZGdlIEZ1bmN0aW9uIGNyZWF0ZXMgYSBzZWVkZWQgUk5HIHBlciBnYW1lXG4gKiAoc2VlZCBzdG9yZWQgYWxvbmdzaWRlIGdhbWUgc3RhdGUpLCBzbyBhIGNvbXBsZXRlIGdhbWUgY2FuIGJlIHJlcGxheWVkXG4gKiBkZXRlcm1pbmlzdGljYWxseSBmcm9tIGl0cyBhY3Rpb24gbG9nIFx1MjAxNCB1c2VmdWwgZm9yIGJ1ZyByZXBvcnRzLCByZWNhcFxuICogZ2VuZXJhdGlvbiwgYW5kIFwid2F0Y2ggdGhlIGdhbWUgYmFja1wiIGZlYXR1cmVzLlxuICovXG5cbmV4cG9ydCBpbnRlcmZhY2UgUm5nIHtcbiAgLyoqIEluY2x1c2l2ZSBib3RoIGVuZHMuICovXG4gIGludEJldHdlZW4obWluSW5jbHVzaXZlOiBudW1iZXIsIG1heEluY2x1c2l2ZTogbnVtYmVyKTogbnVtYmVyO1xuICAvKiogUmV0dXJucyBcImhlYWRzXCIgb3IgXCJ0YWlsc1wiLiAqL1xuICBjb2luRmxpcCgpOiBcImhlYWRzXCIgfCBcInRhaWxzXCI7XG4gIC8qKiBSZXR1cm5zIDEtNi4gKi9cbiAgZDYoKTogMSB8IDIgfCAzIHwgNCB8IDUgfCA2O1xufVxuXG4vKipcbiAqIE11bGJlcnJ5MzIgXHUyMDE0IGEgc21hbGwsIGZhc3QsIHdlbGwtZGlzdHJpYnV0ZWQgc2VlZGVkIFBSTkcuIFN1ZmZpY2llbnQgZm9yXG4gKiBhIGNhcmQtZHJhd2luZyBmb290YmFsbCBnYW1lOyBub3QgZm9yIGNyeXB0b2dyYXBoeS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNlZWRlZFJuZyhzZWVkOiBudW1iZXIpOiBSbmcge1xuICBsZXQgc3RhdGUgPSBzZWVkID4+PiAwO1xuXG4gIGNvbnN0IG5leHQgPSAoKTogbnVtYmVyID0+IHtcbiAgICBzdGF0ZSA9IChzdGF0ZSArIDB4NmQyYjc5ZjUpID4+PiAwO1xuICAgIGxldCB0ID0gc3RhdGU7XG4gICAgdCA9IE1hdGguaW11bCh0IF4gKHQgPj4+IDE1KSwgdCB8IDEpO1xuICAgIHQgXj0gdCArIE1hdGguaW11bCh0IF4gKHQgPj4+IDcpLCB0IHwgNjEpO1xuICAgIHJldHVybiAoKHQgXiAodCA+Pj4gMTQpKSA+Pj4gMCkgLyA0Mjk0OTY3Mjk2O1xuICB9O1xuXG4gIHJldHVybiB7XG4gICAgaW50QmV0d2VlbihtaW4sIG1heCkge1xuICAgICAgcmV0dXJuIE1hdGguZmxvb3IobmV4dCgpICogKG1heCAtIG1pbiArIDEpKSArIG1pbjtcbiAgICB9LFxuICAgIGNvaW5GbGlwKCkge1xuICAgICAgcmV0dXJuIG5leHQoKSA8IDAuNSA/IFwiaGVhZHNcIiA6IFwidGFpbHNcIjtcbiAgICB9LFxuICAgIGQ2KCkge1xuICAgICAgcmV0dXJuIChNYXRoLmZsb29yKG5leHQoKSAqIDYpICsgMSkgYXMgMSB8IDIgfCAzIHwgNCB8IDUgfCA2O1xuICAgIH0sXG4gIH07XG59XG4iLCAiLyoqXG4gKiBQdXJlIG91dGNvbWUtdGFibGUgaGVscGVycyBmb3Igc3BlY2lhbCBwbGF5cy4gVGhlc2UgYXJlIGV4dHJhY3RlZFxuICogZnJvbSB0aGUgZnVsbCByZXNvbHZlcnMgc28gdGhhdCBjb25zdW1lcnMgKGxpa2UgdjUuMSdzIGFzeW5jIGNvZGVcbiAqIHBhdGhzKSBjYW4gbG9vayB1cCB0aGUgcnVsZSBvdXRjb21lIHdpdGhvdXQgcnVubmluZyB0aGUgZW5naW5lJ3NcbiAqIHN0YXRlIHRyYW5zaXRpb24uXG4gKlxuICogT25jZSBQaGFzZSAyIGNvbGxhcHNlcyB0aGUgb3JjaGVzdHJhdG9yIGludG8gYGVuZ2luZS5yZWR1Y2VgLCB0aGVzZVxuICogaGVscGVycyBiZWNvbWUgYW4gaW50ZXJuYWwgaW1wbGVtZW50YXRpb24gZGV0YWlsLiBVbnRpbCB0aGVuLCB0aGV5XG4gKiBsZXQgdjUuMSB1c2UgdGhlIGVuZ2luZSBhcyB0aGUgc291cmNlIG9mIHRydXRoIGZvciBnYW1lIHJ1bGVzIHdoaWxlXG4gKiBrZWVwaW5nIGl0cyBpbXBlcmF0aXZlIGZsb3cuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBNdWx0aXBsaWVyQ2FyZE5hbWUgfSBmcm9tIFwiLi4veWFyZGFnZS5qc1wiO1xuaW1wb3J0IHR5cGUgeyBQbGF5ZXJJZCB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuXG4vLyAtLS0tLS0tLS0tIFNhbWUgUGxheSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IHR5cGUgU2FtZVBsYXlPdXRjb21lID1cbiAgfCB7IGtpbmQ6IFwiYmlnX3BsYXlcIjsgYmVuZWZpY2lhcnk6IFwib2ZmZW5zZVwiIHwgXCJkZWZlbnNlXCIgfVxuICB8IHsga2luZDogXCJtdWx0aXBsaWVyXCI7IHZhbHVlOiBudW1iZXI7IGRyYXdZYXJkczogYm9vbGVhbiB9XG4gIHwgeyBraW5kOiBcImludGVyY2VwdGlvblwiIH1cbiAgfCB7IGtpbmQ6IFwibm9fZ2FpblwiIH07XG5cbi8qKlxuICogdjUuMSdzIFNhbWUgUGxheSB0YWJsZSAocnVuLmpzOjE4OTkpLlxuICpcbiAqICAgS2luZyAgICBcdTIxOTIgQmlnIFBsYXkgKG9mZmVuc2UgaWYgaGVhZHMsIGRlZmVuc2UgaWYgdGFpbHMpXG4gKiAgIFF1ZWVuICsgaGVhZHMgXHUyMTkyICszeCBtdWx0aXBsaWVyIChkcmF3IHlhcmRzKVxuICogICBRdWVlbiArIHRhaWxzIFx1MjE5MiAweCBtdWx0aXBsaWVyIChubyB5YXJkcywgbm8gZ2FpbilcbiAqICAgSmFjayAgKyBoZWFkcyBcdTIxOTIgMHggbXVsdGlwbGllclxuICogICBKYWNrICArIHRhaWxzIFx1MjE5MiAtM3ggbXVsdGlwbGllciAoZHJhdyB5YXJkcylcbiAqICAgMTAgICAgKyBoZWFkcyBcdTIxOTIgSU5URVJDRVBUSU9OXG4gKiAgIDEwICAgICsgdGFpbHMgXHUyMTkyIDAgeWFyZHMgKG5vIG1lY2hhbmljKVxuICovXG5leHBvcnQgZnVuY3Rpb24gc2FtZVBsYXlPdXRjb21lKFxuICBjYXJkOiBNdWx0aXBsaWVyQ2FyZE5hbWUsXG4gIGNvaW46IFwiaGVhZHNcIiB8IFwidGFpbHNcIixcbik6IFNhbWVQbGF5T3V0Y29tZSB7XG4gIGNvbnN0IGhlYWRzID0gY29pbiA9PT0gXCJoZWFkc1wiO1xuICBpZiAoY2FyZCA9PT0gXCJLaW5nXCIpIHJldHVybiB7IGtpbmQ6IFwiYmlnX3BsYXlcIiwgYmVuZWZpY2lhcnk6IGhlYWRzID8gXCJvZmZlbnNlXCIgOiBcImRlZmVuc2VcIiB9O1xuICBpZiAoY2FyZCA9PT0gXCIxMFwiKSByZXR1cm4gaGVhZHMgPyB7IGtpbmQ6IFwiaW50ZXJjZXB0aW9uXCIgfSA6IHsga2luZDogXCJub19nYWluXCIgfTtcbiAgaWYgKGNhcmQgPT09IFwiUXVlZW5cIikge1xuICAgIHJldHVybiBoZWFkc1xuICAgICAgPyB7IGtpbmQ6IFwibXVsdGlwbGllclwiLCB2YWx1ZTogMywgZHJhd1lhcmRzOiB0cnVlIH1cbiAgICAgIDogeyBraW5kOiBcIm11bHRpcGxpZXJcIiwgdmFsdWU6IDAsIGRyYXdZYXJkczogZmFsc2UgfTtcbiAgfVxuICAvLyBKYWNrXG4gIHJldHVybiBoZWFkc1xuICAgID8geyBraW5kOiBcIm11bHRpcGxpZXJcIiwgdmFsdWU6IDAsIGRyYXdZYXJkczogZmFsc2UgfVxuICAgIDogeyBraW5kOiBcIm11bHRpcGxpZXJcIiwgdmFsdWU6IC0zLCBkcmF3WWFyZHM6IHRydWUgfTtcbn1cblxuLy8gLS0tLS0tLS0tLSBUcmljayBQbGF5IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIFRyaWNrUGxheU91dGNvbWUgPVxuICB8IHsga2luZDogXCJiaWdfcGxheVwiOyBiZW5lZmljaWFyeTogUGxheWVySWQgfVxuICB8IHsga2luZDogXCJwZW5hbHR5XCI7IHJhd1lhcmRzOiBudW1iZXIgfVxuICB8IHsga2luZDogXCJtdWx0aXBsaWVyXCI7IHZhbHVlOiBudW1iZXIgfVxuICB8IHsga2luZDogXCJvdmVybGF5XCI7IHBsYXk6IFwiTFBcIiB8IFwiTFJcIjsgYm9udXM6IG51bWJlciB9O1xuXG4vKipcbiAqIHY1LjEncyBUcmljayBQbGF5IHRhYmxlIChydW4uanM6MTk4NykuIENhbGxlciA9IHBsYXllciB3aG8gY2FsbGVkIHRoZVxuICogVHJpY2sgUGxheSAob2ZmZW5zZSBvciBkZWZlbnNlKS4gRGllIHJvbGwgb3V0Y29tZXMgKGZyb20gY2FsbGVyJ3MgUE9WKTpcbiAqXG4gKiAgIDEgXHUyMTkyIG92ZXJsYXkgTFAgd2l0aCArNSBib251cyAoc2lnbnMgZmxpcCBmb3IgZGVmZW5zaXZlIGNhbGxlcilcbiAqICAgMiBcdTIxOTIgMTUteWFyZCBwZW5hbHR5IG9uIG9wcG9uZW50XG4gKiAgIDMgXHUyMTkyIGZpeGVkIC0zeCBtdWx0aXBsaWVyLCBkcmF3IHlhcmRzXG4gKiAgIDQgXHUyMTkyIGZpeGVkICs0eCBtdWx0aXBsaWVyLCBkcmF3IHlhcmRzXG4gKiAgIDUgXHUyMTkyIEJpZyBQbGF5IGZvciBjYWxsZXJcbiAqICAgNiBcdTIxOTIgb3ZlcmxheSBMUiB3aXRoICs1IGJvbnVzXG4gKlxuICogYHJhd1lhcmRzYCBvbiBwZW5hbHR5IGlzIHNpZ25lZCBmcm9tIG9mZmVuc2UgUE9WOiBwb3NpdGl2ZSA9IGdhaW4gZm9yXG4gKiBvZmZlbnNlIChvZmZlbnNpdmUgVHJpY2sgUGxheSByb2xsPTIpLCBuZWdhdGl2ZSA9IGxvc3MgKGRlZmVuc2l2ZSkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0cmlja1BsYXlPdXRjb21lKFxuICBjYWxsZXI6IFBsYXllcklkLFxuICBvZmZlbnNlOiBQbGF5ZXJJZCxcbiAgZGllOiAxIHwgMiB8IDMgfCA0IHwgNSB8IDYsXG4pOiBUcmlja1BsYXlPdXRjb21lIHtcbiAgY29uc3QgY2FsbGVySXNPZmZlbnNlID0gY2FsbGVyID09PSBvZmZlbnNlO1xuXG4gIGlmIChkaWUgPT09IDUpIHJldHVybiB7IGtpbmQ6IFwiYmlnX3BsYXlcIiwgYmVuZWZpY2lhcnk6IGNhbGxlciB9O1xuXG4gIGlmIChkaWUgPT09IDIpIHtcbiAgICBjb25zdCByYXdZYXJkcyA9IGNhbGxlcklzT2ZmZW5zZSA/IDE1IDogLTE1O1xuICAgIHJldHVybiB7IGtpbmQ6IFwicGVuYWx0eVwiLCByYXdZYXJkcyB9O1xuICB9XG5cbiAgaWYgKGRpZSA9PT0gMykgcmV0dXJuIHsga2luZDogXCJtdWx0aXBsaWVyXCIsIHZhbHVlOiAtMyB9O1xuICBpZiAoZGllID09PSA0KSByZXR1cm4geyBraW5kOiBcIm11bHRpcGxpZXJcIiwgdmFsdWU6IDQgfTtcblxuICAvLyBkaWUgMSBvciA2XG4gIGNvbnN0IHBsYXkgPSBkaWUgPT09IDEgPyBcIkxQXCIgOiBcIkxSXCI7XG4gIGNvbnN0IGJvbnVzID0gY2FsbGVySXNPZmZlbnNlID8gNSA6IC01O1xuICByZXR1cm4geyBraW5kOiBcIm92ZXJsYXlcIiwgcGxheSwgYm9udXMgfTtcbn1cblxuLy8gLS0tLS0tLS0tLSBCaWcgUGxheSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIEJpZ1BsYXlPdXRjb21lID1cbiAgfCB7IGtpbmQ6IFwib2ZmZW5zZV9nYWluXCI7IHlhcmRzOiBudW1iZXIgfVxuICB8IHsga2luZDogXCJvZmZlbnNlX3RkXCIgfVxuICB8IHsga2luZDogXCJkZWZlbnNlX3BlbmFsdHlcIjsgcmF3WWFyZHM6IG51bWJlciB9XG4gIHwgeyBraW5kOiBcImRlZmVuc2VfZnVtYmxlX3JldHVyblwiOyB5YXJkczogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6IFwiZGVmZW5zZV9mdW1ibGVfdGRcIiB9O1xuXG4vKipcbiAqIHY1LjEncyBCaWcgUGxheSB0YWJsZSAocnVuLmpzOjE5MzMpLiBiZW5lZmljaWFyeSA9IHdobyBiZW5lZml0c1xuICogKG9mZmVuc2Ugb3IgZGVmZW5zZSkuXG4gKlxuICogT2ZmZW5zZTpcbiAqICAgMS0zIFx1MjE5MiArMjUgeWFyZHNcbiAqICAgNC01IFx1MjE5MiBtYXgoaGFsZi10by1nb2FsLCA0MClcbiAqICAgNiAgIFx1MjE5MiBURFxuICogRGVmZW5zZTpcbiAqICAgMS0zIFx1MjE5MiAxMC15YXJkIHBlbmFsdHkgb24gb2ZmZW5zZSAocmVwZWF0IGRvd24pXG4gKiAgIDQtNSBcdTIxOTIgZnVtYmxlLCBkZWZlbnNlIHJldHVybnMgbWF4KGhhbGYtdG8tZ29hbCwgMjUpXG4gKiAgIDYgICBcdTIxOTIgZnVtYmxlLCBkZWZlbnNpdmUgVERcbiAqL1xuLy8gLS0tLS0tLS0tLSBQdW50IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFB1bnQgcmV0dXJuIG11bHRpcGxpZXIgYnkgZHJhd24gbXVsdGlwbGllciBjYXJkIChydW4uanM6MjE5NikuICovXG5leHBvcnQgZnVuY3Rpb24gcHVudFJldHVybk11bHRpcGxpZXIoY2FyZDogTXVsdGlwbGllckNhcmROYW1lKTogbnVtYmVyIHtcbiAgc3dpdGNoIChjYXJkKSB7XG4gICAgY2FzZSBcIktpbmdcIjogcmV0dXJuIDc7XG4gICAgY2FzZSBcIlF1ZWVuXCI6IHJldHVybiA0O1xuICAgIGNhc2UgXCJKYWNrXCI6IHJldHVybiAxO1xuICAgIGNhc2UgXCIxMFwiOiByZXR1cm4gLTAuNTtcbiAgfVxufVxuXG4vKipcbiAqIFB1bnQga2ljayBkaXN0YW5jZSBmb3JtdWxhIChydW4uanM6MjE0Myk6XG4gKiAgIDEwICogeWFyZHNDYXJkIC8gMiArIDIwICogKGNvaW4gPT09IFwiaGVhZHNcIiA/IDEgOiAwKVxuICogeWFyZHNDYXJkIGlzIHRoZSAxLTEwIGNhcmQuIFJhbmdlOiA1LTcwIHlhcmRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcHVudEtpY2tEaXN0YW5jZSh5YXJkc0NhcmQ6IG51bWJlciwgY29pbjogXCJoZWFkc1wiIHwgXCJ0YWlsc1wiKTogbnVtYmVyIHtcbiAgcmV0dXJuICgxMCAqIHlhcmRzQ2FyZCkgLyAyICsgKGNvaW4gPT09IFwiaGVhZHNcIiA/IDIwIDogMCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBiaWdQbGF5T3V0Y29tZShcbiAgYmVuZWZpY2lhcnk6IFBsYXllcklkLFxuICBvZmZlbnNlOiBQbGF5ZXJJZCxcbiAgZGllOiAxIHwgMiB8IDMgfCA0IHwgNSB8IDYsXG4gIC8qKiBiYWxsT24gZnJvbSBvZmZlbnNlIFBPViAoMC0xMDApLiAqL1xuICBiYWxsT246IG51bWJlcixcbik6IEJpZ1BsYXlPdXRjb21lIHtcbiAgY29uc3QgYmVuZWZpdHNPZmZlbnNlID0gYmVuZWZpY2lhcnkgPT09IG9mZmVuc2U7XG5cbiAgaWYgKGJlbmVmaXRzT2ZmZW5zZSkge1xuICAgIGlmIChkaWUgPT09IDYpIHJldHVybiB7IGtpbmQ6IFwib2ZmZW5zZV90ZFwiIH07XG4gICAgaWYgKGRpZSA8PSAzKSByZXR1cm4geyBraW5kOiBcIm9mZmVuc2VfZ2FpblwiLCB5YXJkczogMjUgfTtcbiAgICBjb25zdCBoYWxmVG9Hb2FsID0gTWF0aC5yb3VuZCgoMTAwIC0gYmFsbE9uKSAvIDIpO1xuICAgIHJldHVybiB7IGtpbmQ6IFwib2ZmZW5zZV9nYWluXCIsIHlhcmRzOiBoYWxmVG9Hb2FsID4gNDAgPyBoYWxmVG9Hb2FsIDogNDAgfTtcbiAgfVxuXG4gIC8vIERlZmVuc2UgYmVuZWZpY2lhcnlcbiAgaWYgKGRpZSA8PSAzKSB7XG4gICAgY29uc3QgcmF3WWFyZHMgPSBiYWxsT24gLSAxMCA8IDEgPyAtTWF0aC5mbG9vcihiYWxsT24gLyAyKSA6IC0xMDtcbiAgICByZXR1cm4geyBraW5kOiBcImRlZmVuc2VfcGVuYWx0eVwiLCByYXdZYXJkcyB9O1xuICB9XG4gIGlmIChkaWUgPT09IDYpIHJldHVybiB7IGtpbmQ6IFwiZGVmZW5zZV9mdW1ibGVfdGRcIiB9O1xuICBjb25zdCBoYWxmVG9Hb2FsID0gTWF0aC5yb3VuZCgoMTAwIC0gYmFsbE9uKSAvIDIpO1xuICByZXR1cm4geyBraW5kOiBcImRlZmVuc2VfZnVtYmxlX3JldHVyblwiLCB5YXJkczogaGFsZlRvR29hbCA+IDI1ID8gaGFsZlRvR29hbCA6IDI1IH07XG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBb0JBLElBQU0sYUFBeUIsQ0FBQyxNQUFNLE1BQU0sSUFBSTtBQUNoRCxJQUFNLGVBQTZCLENBQUMsTUFBTSxNQUFNLElBQUk7QUFFcEQsSUFBTSxjQUFjLG9CQUFJLElBQUksQ0FBQyxZQUFZLFdBQVcsYUFBYSxDQUFDO0FBRTNELFNBQVMsZUFBZSxPQUFrQixRQUErQjtBQUM5RSxVQUFRLE9BQU8sTUFBTTtBQUFBLElBQ25CLEtBQUs7QUFDSCxVQUFJLE1BQU0sVUFBVSxPQUFRLFFBQU87QUFDbkMsVUFBSSxPQUFPLE9BQU8seUJBQXlCLFNBQVUsUUFBTztBQUM1RCxVQUFJLE9BQU8sdUJBQXVCLEtBQUssT0FBTyx1QkFBdUIsSUFBSTtBQUN2RSxlQUFPO0FBQUEsTUFDVDtBQUNBLFVBQUksQ0FBQyxPQUFPLFNBQVMsT0FBTyxPQUFPLE1BQU0sQ0FBQyxNQUFNLFlBQVksT0FBTyxPQUFPLE1BQU0sQ0FBQyxNQUFNLFVBQVU7QUFDL0YsZUFB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QUFXLEtBQUs7QUFDdkQ7QUF3Qk8sU0FBUyxpQkFDZCxRQUNBLFNBQ0EsS0FDa0I7QUFDbEIsUUFBTSxrQkFBa0IsV0FBVztBQUVuQyxNQUFJLFFBQVEsRUFBRyxRQUFPLEVBQUUsTUFBTSxZQUFZLGFBQWEsT0FBTztBQUU5RCxNQUFJLFFBQVEsR0FBRztBQUNiLFVBQU0sV0FBVyxrQkFBa0IsS0FBSztBQUN4QyxXQUFPLEVBQUUsTUFBTSxXQUFXLFNBQVM7QUFBQSxFQUNyQztBQUVBLE1BQUksUUFBUSxFQUFHLFFBQU8sRUFBRSxNQUFNLGNBQWMsT0FBTyxHQUFHO0FBQ3RELE1BQUksUUFBUSxFQUFHLFFBQU8sRUFBRSxNQUFNLGNBQWMsT0FBTyxFQUFFO0FBR3JELFFBQU0sT0FBTyxRQUFRLElBQUksT0FBTztBQUNoQyxRQUFNLFFBQVEsa0JBQWtCLElBQUk7QUFDcEMsU0FBTyxFQUFFLE1BQU0sV0FBVyxNQUFNLE1BQU07QUFDeEM7QUEyQk8sU0FBUyxxQkFBcUIsTUFBa0M7QUFDckUsVUFBUSxNQUFNO0FBQUEsSUFDWixLQUFLO0FBQVEsYUFBTztBQUFBLElBQ3BCLEtBQUs7QUFBUyxhQUFPO0FBQUEsSUFDckIsS0FBSztBQUFRLGFBQU87QUFBQSxJQUNwQixLQUFLO0FBQU0sYUFBTztBQUFBLEVBQ3BCO0FBQ0Y7QUFPTyxTQUFTLGlCQUFpQixXQUFtQixNQUFpQztBQUNuRixTQUFRLEtBQUssWUFBYSxLQUFLLFNBQVMsVUFBVSxLQUFLO0FBQ3pEO0FBRU8sU0FBUyxlQUNkLGFBQ0EsU0FDQSxLQUVBLFFBQ2dCO0FBQ2hCLFFBQU0sa0JBQWtCLGdCQUFnQjtBQUV4QyxNQUFJLGlCQUFpQjtBQUNuQixRQUFJLFFBQVEsRUFBRyxRQUFPLEVBQUUsTUFBTSxhQUFhO0FBQzNDLFFBQUksT0FBTyxFQUFHLFFBQU8sRUFBRSxNQUFNLGdCQUFnQixPQUFPLEdBQUc7QUFDdkQsVUFBTUMsY0FBYSxLQUFLLE9BQU8sTUFBTSxVQUFVLENBQUM7QUFDaEQsV0FBTyxFQUFFLE1BQU0sZ0JBQWdCLE9BQU9BLGNBQWEsS0FBS0EsY0FBYSxHQUFHO0FBQUEsRUFDMUU7QUFHQSxNQUFJLE9BQU8sR0FBRztBQUNaLFVBQU0sV0FBVyxTQUFTLEtBQUssSUFBSSxDQUFDLEtBQUssTUFBTSxTQUFTLENBQUMsSUFBSTtBQUM3RCxXQUFPLEVBQUUsTUFBTSxtQkFBbUIsU0FBUztBQUFBLEVBQzdDO0FBQ0EsTUFBSSxRQUFRLEVBQUcsUUFBTyxFQUFFLE1BQU0sb0JBQW9CO0FBQ2xELFFBQU0sYUFBYSxLQUFLLE9BQU8sTUFBTSxVQUFVLENBQUM7QUFDaEQsU0FBTyxFQUFFLE1BQU0seUJBQXlCLE9BQU8sYUFBYSxLQUFLLGFBQWEsR0FBRztBQUNuRjsiLAogICJuYW1lcyI6IFsiYmxhbmtQaWNrIiwgImhhbGZUb0dvYWwiLCAibXVsdGlwbGllciIsICJ5YXJkc0RyYXciLCAieWFyZHMiLCAic3RhdGVXaXRoUGljayIsICJyZXN1bHQiLCAiaGFsZlRvR29hbCJdCn0K
