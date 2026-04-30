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
  return {
    state: {
      ...state,
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
    events.push({ type: "TURNOVER", reason: "fumble" });
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy92YWxpZGF0ZS50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3N0YXRlLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvbWF0Y2h1cC50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3lhcmRhZ2UudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9kZWNrLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvc2hhcmVkLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvcGxheS50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL2JpZ1BsYXkudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9wdW50LnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMva2lja29mZi50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL2hhaWxNYXJ5LnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvc2FtZVBsYXkudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy90cmlja1BsYXkudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9maWVsZEdvYWwudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy90d29Qb2ludC50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL292ZXJ0aW1lLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcmVkdWNlci50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3JuZy50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL291dGNvbWVzLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvKipcbiAqIEFjdGlvbiB2YWxpZGF0aW9uIGxheWVyLiBSdW5zICpiZWZvcmUqIGByZWR1Y2VgIHRvdWNoZXMgc3RhdGUuXG4gKlxuICogVGhlIGVuZ2luZSBwcmV2aW91c2x5IHJlbGllZCBvbiB0aGUgcmVkdWNlcidzIHBlci1jYXNlIHNoYXBlIGNoZWNrcyBhbmRcbiAqIHNpbGVudGx5IGlnbm9yZWQgYW55dGhpbmcgaXQgY291bGRuJ3QgcmVjb2duaXplLiBUaGF0IHdhcyBmaW5lIGZvciBhXG4gKiB0cnVzdGVkIHNpbmdsZS10YWIgZ2FtZSBidXQgdW5zYWZlIGFzIHNvb24gYXMgdGhlIER1cmFibGUgT2JqZWN0XG4gKiBhY2NlcHRzIGFjdGlvbnMgZnJvbSB1bmF1dGhlbnRpY2F0ZWQgV2ViU29ja2V0IGNsaWVudHMgXHUyMDE0IGEgaG9zdGlsZSAob3JcbiAqIGp1c3QgYnVnZ3kpIGNsaWVudCBjb3VsZCBzZW5kIGB7IHR5cGU6ICdSRVNPTFZFX0tJQ0tPRkYnLCBraWNrVHlwZTogJ0ZHJyB9YFxuICogYW5kIGNvcnJ1cHQgc3RhdGUuXG4gKlxuICogYHZhbGlkYXRlQWN0aW9uYCByZXR1cm5zIG51bGwgd2hlbiB0aGUgYWN0aW9uIGlzIGxlZ2FsIGZvciB0aGUgY3VycmVudFxuICogc3RhdGUsIG9yIGEgc3RyaW5nIGV4cGxhaW5pbmcgdGhlIHJlamVjdGlvbi4gSW52YWxpZCBhY3Rpb25zIHNob3VsZCBiZVxuICogbm8tb3BlZCBieSB0aGUgY2FsbGVyIChyZWR1Y2VyIG9yIHNlcnZlciksIG5vdCB0aHJvd24gb24gXHUyMDE0IHRoYXQgbWF0Y2hlc1xuICogdGhlIHJlc3Qgb2YgdGhlIGVuZ2luZSdzIFwiaWxsZWdhbCBwaWNrcyBhcmUgc2lsZW50bHkgZHJvcHBlZFwiIGNvbnRyYWN0XG4gKiBhbmQgYXZvaWRzIGNyYXNoaW5nIG9uIGFuIHVudHJ1c3RlZCBjbGllbnQuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBBY3Rpb24gfSBmcm9tIFwiLi9hY3Rpb25zLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgS2lja1R5cGUsIFJldHVyblR5cGUgfSBmcm9tIFwiLi90eXBlcy5qc1wiO1xuXG5jb25zdCBLSUNLX1RZUEVTOiBLaWNrVHlwZVtdID0gW1wiUktcIiwgXCJPS1wiLCBcIlNLXCJdO1xuY29uc3QgUkVUVVJOX1RZUEVTOiBSZXR1cm5UeXBlW10gPSBbXCJSUlwiLCBcIk9SXCIsIFwiVEJcIl07XG5cbmNvbnN0IFBMQVlfUEhBU0VTID0gbmV3IFNldChbXCJSRUdfUExBWVwiLCBcIk9UX1BMQVlcIiwgXCJUV09fUFRfQ09OVlwiXSk7XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUFjdGlvbihzdGF0ZTogR2FtZVN0YXRlLCBhY3Rpb246IEFjdGlvbik6IHN0cmluZyB8IG51bGwge1xuICBzd2l0Y2ggKGFjdGlvbi50eXBlKSB7XG4gICAgY2FzZSBcIlNUQVJUX0dBTUVcIjpcbiAgICAgIGlmIChzdGF0ZS5waGFzZSAhPT0gXCJJTklUXCIpIHJldHVybiBcIlNUQVJUX0dBTUUgb25seSB2YWxpZCBpbiBJTklUXCI7XG4gICAgICBpZiAodHlwZW9mIGFjdGlvbi5xdWFydGVyTGVuZ3RoTWludXRlcyAhPT0gXCJudW1iZXJcIikgcmV0dXJuIFwiYmFkIHF0ckxlblwiO1xuICAgICAgaWYgKGFjdGlvbi5xdWFydGVyTGVuZ3RoTWludXRlcyA8IDEgfHwgYWN0aW9uLnF1YXJ0ZXJMZW5ndGhNaW51dGVzID4gMTUpIHtcbiAgICAgICAgcmV0dXJuIFwicXRyTGVuIG11c3QgYmUgMS4uMTVcIjtcbiAgICAgIH1cbiAgICAgIGlmICghYWN0aW9uLnRlYW1zIHx8IHR5cGVvZiBhY3Rpb24udGVhbXNbMV0gIT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIGFjdGlvbi50ZWFtc1syXSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICByZXR1cm4gXCJ0ZWFtcyBtaXNzaW5nXCI7XG4gICAgICB9XG4gICAgICByZXR1cm4gbnVsbDtcblxuICAgIGNhc2UgXCJDT0lOX1RPU1NfQ0FMTFwiOlxuICAgICAgaWYgKHN0YXRlLnBoYXNlICE9PSBcIkNPSU5fVE9TU1wiKSByZXR1cm4gXCJub3QgaW4gQ09JTl9UT1NTXCI7XG4gICAgICBpZiAoIWlzUGxheWVyKGFjdGlvbi5wbGF5ZXIpKSByZXR1cm4gXCJiYWQgcGxheWVyXCI7XG4gICAgICBpZiAoYWN0aW9uLmNhbGwgIT09IFwiaGVhZHNcIiAmJiBhY3Rpb24uY2FsbCAhPT0gXCJ0YWlsc1wiKSByZXR1cm4gXCJiYWQgY2FsbFwiO1xuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICBjYXNlIFwiUkVDRUlWRV9DSE9JQ0VcIjpcbiAgICAgIC8vIEFsbG93ZWQgb25seSBhZnRlciB0aGUgY29pbiB0b3NzIHJlc29sdmVzOyBlbmdpbmUncyByZWR1Y2VyIGxlYXZlc1xuICAgICAgLy8gc3RhdGUucGhhc2UgYXQgQ09JTl9UT1NTIHVudGlsIFJFQ0VJVkVfQ0hPSUNFIHRyYW5zaXRpb25zIHRvIEtJQ0tPRkYuXG4gICAgICBpZiAoc3RhdGUucGhhc2UgIT09IFwiQ09JTl9UT1NTXCIpIHJldHVybiBcIm5vdCBpbiBDT0lOX1RPU1NcIjtcbiAgICAgIGlmICghaXNQbGF5ZXIoYWN0aW9uLnBsYXllcikpIHJldHVybiBcImJhZCBwbGF5ZXJcIjtcbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlICE9PSBcInJlY2VpdmVcIiAmJiBhY3Rpb24uY2hvaWNlICE9PSBcImRlZmVyXCIpIHJldHVybiBcImJhZCBjaG9pY2VcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIlBJQ0tfUExBWVwiOlxuICAgICAgaWYgKCFQTEFZX1BIQVNFUy5oYXMoc3RhdGUucGhhc2UpKSByZXR1cm4gXCJub3QgaW4gYSBwbGF5IHBoYXNlXCI7XG4gICAgICBpZiAoIWlzUGxheWVyKGFjdGlvbi5wbGF5ZXIpKSByZXR1cm4gXCJiYWQgcGxheWVyXCI7XG4gICAgICBpZiAoIWlzUGxheUNhbGwoYWN0aW9uLnBsYXkpKSByZXR1cm4gXCJiYWQgcGxheVwiO1xuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICBjYXNlIFwiQ0FMTF9USU1FT1VUXCI6XG4gICAgICBpZiAoIWlzUGxheWVyKGFjdGlvbi5wbGF5ZXIpKSByZXR1cm4gXCJiYWQgcGxheWVyXCI7XG4gICAgICBpZiAoc3RhdGUucGxheWVyc1thY3Rpb24ucGxheWVyXS50aW1lb3V0cyA8PSAwKSByZXR1cm4gXCJubyB0aW1lb3V0cyByZW1haW5pbmdcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIkFDQ0VQVF9QRU5BTFRZXCI6XG4gICAgY2FzZSBcIkRFQ0xJTkVfUEVOQUxUWVwiOlxuICAgICAgaWYgKCFpc1BsYXllcihhY3Rpb24ucGxheWVyKSkgcmV0dXJuIFwiYmFkIHBsYXllclwiO1xuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICBjYXNlIFwiUEFUX0NIT0lDRVwiOlxuICAgICAgaWYgKHN0YXRlLnBoYXNlICE9PSBcIlBBVF9DSE9JQ0VcIikgcmV0dXJuIFwibm90IGluIFBBVF9DSE9JQ0VcIjtcbiAgICAgIGlmICghaXNQbGF5ZXIoYWN0aW9uLnBsYXllcikpIHJldHVybiBcImJhZCBwbGF5ZXJcIjtcbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlICE9PSBcImtpY2tcIiAmJiBhY3Rpb24uY2hvaWNlICE9PSBcInR3b19wb2ludFwiKSByZXR1cm4gXCJiYWQgY2hvaWNlXCI7XG4gICAgICByZXR1cm4gbnVsbDtcblxuICAgIGNhc2UgXCJGT1VSVEhfRE9XTl9DSE9JQ0VcIjpcbiAgICAgIGlmIChzdGF0ZS5waGFzZSAhPT0gXCJSRUdfUExBWVwiICYmIHN0YXRlLnBoYXNlICE9PSBcIk9UX1BMQVlcIikgcmV0dXJuIFwid3JvbmcgcGhhc2VcIjtcbiAgICAgIGlmIChzdGF0ZS5maWVsZC5kb3duICE9PSA0KSByZXR1cm4gXCJub3QgNHRoIGRvd25cIjtcbiAgICAgIGlmICghaXNQbGF5ZXIoYWN0aW9uLnBsYXllcikpIHJldHVybiBcImJhZCBwbGF5ZXJcIjtcbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlICE9PSBcImdvXCIgJiYgYWN0aW9uLmNob2ljZSAhPT0gXCJwdW50XCIgJiYgYWN0aW9uLmNob2ljZSAhPT0gXCJmZ1wiKSB7XG4gICAgICAgIHJldHVybiBcImJhZCBjaG9pY2VcIjtcbiAgICAgIH1cbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlID09PSBcInB1bnRcIiAmJiBzdGF0ZS5waGFzZSA9PT0gXCJPVF9QTEFZXCIpIHJldHVybiBcIm5vIHB1bnRzIGluIE9UXCI7XG4gICAgICBpZiAoYWN0aW9uLmNob2ljZSA9PT0gXCJmZ1wiICYmIHN0YXRlLmZpZWxkLmJhbGxPbiA8IDQ1KSByZXR1cm4gXCJvdXQgb2YgRkcgcmFuZ2VcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIkZPUkZFSVRcIjpcbiAgICAgIGlmICghaXNQbGF5ZXIoYWN0aW9uLnBsYXllcikpIHJldHVybiBcImJhZCBwbGF5ZXJcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIlJFU09MVkVfS0lDS09GRlwiOlxuICAgICAgaWYgKHN0YXRlLnBoYXNlICE9PSBcIktJQ0tPRkZcIikgcmV0dXJuIFwibm90IGluIEtJQ0tPRkZcIjtcbiAgICAgIC8vIFBpY2tzIGFyZSBvcHRpb25hbCAoc2FmZXR5IGtpY2tzIHNraXAgdGhlbSksIGJ1dCB3aGVuIHByZXNlbnQgdGhleVxuICAgICAgLy8gbXVzdCBiZSBsZWdhbCBlbnVtIHZhbHVlcy5cbiAgICAgIGlmIChhY3Rpb24ua2lja1R5cGUgIT09IHVuZGVmaW5lZCAmJiAhS0lDS19UWVBFUy5pbmNsdWRlcyhhY3Rpb24ua2lja1R5cGUpKSB7XG4gICAgICAgIHJldHVybiBcImJhZCBraWNrVHlwZVwiO1xuICAgICAgfVxuICAgICAgaWYgKGFjdGlvbi5yZXR1cm5UeXBlICE9PSB1bmRlZmluZWQgJiYgIVJFVFVSTl9UWVBFUy5pbmNsdWRlcyhhY3Rpb24ucmV0dXJuVHlwZSkpIHtcbiAgICAgICAgcmV0dXJuIFwiYmFkIHJldHVyblR5cGVcIjtcbiAgICAgIH1cbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIlNUQVJUX09UX1BPU1NFU1NJT05cIjpcbiAgICAgIGlmIChzdGF0ZS5waGFzZSAhPT0gXCJPVF9TVEFSVFwiKSByZXR1cm4gXCJub3QgaW4gT1RfU1RBUlRcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIlRJQ0tfQ0xPQ0tcIjpcbiAgICAgIGlmICh0eXBlb2YgYWN0aW9uLnNlY29uZHMgIT09IFwibnVtYmVyXCIpIHJldHVybiBcImJhZCBzZWNvbmRzXCI7XG4gICAgICBpZiAoYWN0aW9uLnNlY29uZHMgPCAwIHx8IGFjdGlvbi5zZWNvbmRzID4gMzAwKSByZXR1cm4gXCJzZWNvbmRzIG91dCBvZiByYW5nZVwiO1xuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICBkZWZhdWx0OiB7XG4gICAgICBjb25zdCBfZXhoYXVzdGl2ZTogbmV2ZXIgPSBhY3Rpb247XG4gICAgICB2b2lkIF9leGhhdXN0aXZlO1xuICAgICAgcmV0dXJuIFwidW5rbm93biBhY3Rpb24gdHlwZVwiO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBpc1BsYXllcihwOiB1bmtub3duKTogcCBpcyAxIHwgMiB7XG4gIHJldHVybiBwID09PSAxIHx8IHAgPT09IDI7XG59XG5cbmZ1bmN0aW9uIGlzUGxheUNhbGwocDogdW5rbm93bik6IGJvb2xlYW4ge1xuICByZXR1cm4gKFxuICAgIHAgPT09IFwiU1JcIiB8fFxuICAgIHAgPT09IFwiTFJcIiB8fFxuICAgIHAgPT09IFwiU1BcIiB8fFxuICAgIHAgPT09IFwiTFBcIiB8fFxuICAgIHAgPT09IFwiVFBcIiB8fFxuICAgIHAgPT09IFwiSE1cIiB8fFxuICAgIHAgPT09IFwiRkdcIiB8fFxuICAgIHAgPT09IFwiUFVOVFwiIHx8XG4gICAgcCA9PT0gXCJUV09fUFRcIlxuICApO1xufVxuIiwgIi8qKlxuICogU3RhdGUgZmFjdG9yaWVzLlxuICpcbiAqIGBpbml0aWFsU3RhdGUoKWAgcHJvZHVjZXMgYSBmcmVzaCBHYW1lU3RhdGUgaW4gSU5JVCBwaGFzZS4gRXZlcnl0aGluZyBlbHNlXG4gKiBmbG93cyBmcm9tIHJlZHVjaW5nIGFjdGlvbnMgb3ZlciB0aGlzIHN0YXJ0aW5nIHBvaW50LlxuICovXG5cbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBIYW5kLCBQbGF5ZXJJZCwgU3RhdHMsIFRlYW1SZWYgfSBmcm9tIFwiLi90eXBlcy5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gZW1wdHlIYW5kKGlzT3ZlcnRpbWUgPSBmYWxzZSk6IEhhbmQge1xuICByZXR1cm4ge1xuICAgIFNSOiAzLFxuICAgIExSOiAzLFxuICAgIFNQOiAzLFxuICAgIExQOiAzLFxuICAgIFRQOiAxLFxuICAgIEhNOiBpc092ZXJ0aW1lID8gMiA6IDMsXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBlbXB0eVN0YXRzKCk6IFN0YXRzIHtcbiAgcmV0dXJuIHsgcGFzc1lhcmRzOiAwLCBydXNoWWFyZHM6IDAsIHR1cm5vdmVyczogMCwgc2Fja3M6IDAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZyZXNoRGVja011bHRpcGxpZXJzKCk6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdIHtcbiAgcmV0dXJuIFs0LCA0LCA0LCAzXTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZyZXNoRGVja1lhcmRzKCk6IG51bWJlcltdIHtcbiAgcmV0dXJuIFsxLCAxLCAxLCAxLCAxLCAxLCAxLCAxLCAxLCAxXTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBJbml0aWFsU3RhdGVBcmdzIHtcbiAgdGVhbTE6IFRlYW1SZWY7XG4gIHRlYW0yOiBUZWFtUmVmO1xuICBxdWFydGVyTGVuZ3RoTWludXRlczogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaW5pdGlhbFN0YXRlKGFyZ3M6IEluaXRpYWxTdGF0ZUFyZ3MpOiBHYW1lU3RhdGUge1xuICByZXR1cm4ge1xuICAgIHBoYXNlOiBcIklOSVRcIixcbiAgICBzY2hlbWFWZXJzaW9uOiAxLFxuICAgIGNsb2NrOiB7XG4gICAgICBxdWFydGVyOiAwLFxuICAgICAgc2Vjb25kc1JlbWFpbmluZzogYXJncy5xdWFydGVyTGVuZ3RoTWludXRlcyAqIDYwLFxuICAgICAgcXVhcnRlckxlbmd0aE1pbnV0ZXM6IGFyZ3MucXVhcnRlckxlbmd0aE1pbnV0ZXMsXG4gICAgfSxcbiAgICBmaWVsZDoge1xuICAgICAgYmFsbE9uOiAzNSxcbiAgICAgIGZpcnN0RG93bkF0OiA0NSxcbiAgICAgIGRvd246IDEsXG4gICAgICBvZmZlbnNlOiAxLFxuICAgIH0sXG4gICAgZGVjazoge1xuICAgICAgbXVsdGlwbGllcnM6IGZyZXNoRGVja011bHRpcGxpZXJzKCksXG4gICAgICB5YXJkczogZnJlc2hEZWNrWWFyZHMoKSxcbiAgICB9LFxuICAgIHBsYXllcnM6IHtcbiAgICAgIDE6IHtcbiAgICAgICAgdGVhbTogYXJncy50ZWFtMSxcbiAgICAgICAgc2NvcmU6IDAsXG4gICAgICAgIHRpbWVvdXRzOiAzLFxuICAgICAgICBoYW5kOiBlbXB0eUhhbmQoKSxcbiAgICAgICAgc3RhdHM6IGVtcHR5U3RhdHMoKSxcbiAgICAgIH0sXG4gICAgICAyOiB7XG4gICAgICAgIHRlYW06IGFyZ3MudGVhbTIsXG4gICAgICAgIHNjb3JlOiAwLFxuICAgICAgICB0aW1lb3V0czogMyxcbiAgICAgICAgaGFuZDogZW1wdHlIYW5kKCksXG4gICAgICAgIHN0YXRzOiBlbXB0eVN0YXRzKCksXG4gICAgICB9LFxuICAgIH0sXG4gICAgb3BlbmluZ1JlY2VpdmVyOiBudWxsLFxuICAgIG92ZXJ0aW1lOiBudWxsLFxuICAgIHBlbmRpbmdQaWNrOiB7IG9mZmVuc2VQbGF5OiBudWxsLCBkZWZlbnNlUGxheTogbnVsbCB9LFxuICAgIGxhc3RQbGF5RGVzY3JpcHRpb246IFwiU3RhcnQgb2YgZ2FtZVwiLFxuICAgIGlzU2FmZXR5S2ljazogZmFsc2UsXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBvcHAocDogUGxheWVySWQpOiBQbGF5ZXJJZCB7XG4gIHJldHVybiBwID09PSAxID8gMiA6IDE7XG59XG4iLCAiLyoqXG4gKiBUaGUgcGxheSBtYXRjaHVwIG1hdHJpeCBcdTIwMTQgdGhlIGhlYXJ0IG9mIEZvb3RCb3JlZC5cbiAqXG4gKiBCb3RoIHRlYW1zIHBpY2sgYSBwbGF5LiBUaGUgbWF0cml4IHNjb3JlcyBob3cgKmNsb3NlbHkqIHRoZSBkZWZlbnNlXG4gKiBwcmVkaWN0ZWQgdGhlIG9mZmVuc2l2ZSBjYWxsOlxuICogICAtIDEgPSBkZWZlbnNlIHdheSBvZmYgXHUyMTkyIGdyZWF0IGZvciBvZmZlbnNlXG4gKiAgIC0gNSA9IGRlZmVuc2UgbWF0Y2hlZCBcdTIxOTIgdGVycmlibGUgZm9yIG9mZmVuc2UgKGNvbWJpbmVkIHdpdGggYSBsb3dcbiAqICAgICAgICAgbXVsdGlwbGllciBjYXJkLCB0aGlzIGJlY29tZXMgYSBsb3NzIC8gdHVybm92ZXIgcmlzaylcbiAqXG4gKiBSb3dzID0gb2ZmZW5zaXZlIGNhbGwsIENvbHMgPSBkZWZlbnNpdmUgY2FsbC4gT3JkZXI6IFtTUiwgTFIsIFNQLCBMUF0uXG4gKlxuICogICAgICAgICAgIERFRjogU1IgIExSICBTUCAgTFBcbiAqICAgT0ZGOiBTUiAgICAgWyA1LCAgMywgIDMsICAyIF1cbiAqICAgT0ZGOiBMUiAgICAgWyAyLCAgNCwgIDEsICAyIF1cbiAqICAgT0ZGOiBTUCAgICAgWyAzLCAgMiwgIDUsICAzIF1cbiAqICAgT0ZGOiBMUCAgICAgWyAxLCAgMiwgIDIsICA0IF1cbiAqXG4gKiBQb3J0ZWQgdmVyYmF0aW0gZnJvbSBwdWJsaWMvanMvZGVmYXVsdHMuanMgTUFUQ0hVUC4gSW5kZXhpbmcgY29uZmlybWVkXG4gKiBhZ2FpbnN0IHBsYXlNZWNoYW5pc20gLyBjYWxjVGltZXMgaW4gcnVuLmpzOjIzNjguXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBSZWd1bGFyUGxheSB9IGZyb20gXCIuLi90eXBlcy5qc1wiO1xuXG5leHBvcnQgY29uc3QgTUFUQ0hVUDogUmVhZG9ubHlBcnJheTxSZWFkb25seUFycmF5PE1hdGNodXBRdWFsaXR5Pj4gPSBbXG4gIFs1LCAzLCAzLCAyXSxcbiAgWzIsIDQsIDEsIDJdLFxuICBbMywgMiwgNSwgM10sXG4gIFsxLCAyLCAyLCA0XSxcbl0gYXMgY29uc3Q7XG5cbmV4cG9ydCB0eXBlIE1hdGNodXBRdWFsaXR5ID0gMSB8IDIgfCAzIHwgNCB8IDU7XG5cbmNvbnN0IFBMQVlfSU5ERVg6IFJlY29yZDxSZWd1bGFyUGxheSwgMCB8IDEgfCAyIHwgMz4gPSB7XG4gIFNSOiAwLFxuICBMUjogMSxcbiAgU1A6IDIsXG4gIExQOiAzLFxufTtcblxuLyoqXG4gKiBNdWx0aXBsaWVyIGNhcmQgdmFsdWVzLiBJbmRleGluZyAoY29uZmlybWVkIGluIHJ1bi5qczoyMzc3KTpcbiAqICAgcm93ICAgID0gbXVsdGlwbGllciBjYXJkICgwPUtpbmcsIDE9UXVlZW4sIDI9SmFjaywgMz0xMClcbiAqICAgY29sdW1uID0gbWF0Y2h1cCBxdWFsaXR5IC0gMSAoc28gY29sdW1uIDAgPSBxdWFsaXR5IDEsIGNvbHVtbiA0ID0gcXVhbGl0eSA1KVxuICpcbiAqIFF1YWxpdHkgMSAob2ZmZW5zZSBvdXRndWVzc2VkIGRlZmVuc2UpICsgS2luZyA9IDR4LiBCZXN0IHBvc3NpYmxlIHBsYXkuXG4gKiBRdWFsaXR5IDUgKGRlZmVuc2UgbWF0Y2hlZCkgKyAxMCAgICAgICAgPSAtMXguIFdvcnN0IHJlZ3VsYXIgcGxheS5cbiAqXG4gKiAgICAgICAgICAgICAgICAgIHF1YWwgMSAgcXVhbCAyICBxdWFsIDMgIHF1YWwgNCAgcXVhbCA1XG4gKiAgIEtpbmcgICAgKDApICBbICAgNCwgICAgICAzLCAgICAgIDIsICAgICAxLjUsICAgICAxICAgXVxuICogICBRdWVlbiAgICgxKSAgWyAgIDMsICAgICAgMiwgICAgICAxLCAgICAgIDEsICAgICAwLjUgIF1cbiAqICAgSmFjayAgICAoMikgIFsgICAyLCAgICAgIDEsICAgICAwLjUsICAgICAwLCAgICAgIDAgICBdXG4gKiAgIDEwICAgICAgKDMpICBbICAgMCwgICAgICAwLCAgICAgIDAsICAgICAtMSwgICAgIC0xICAgXVxuICpcbiAqIFBvcnRlZCB2ZXJiYXRpbSBmcm9tIHB1YmxpYy9qcy9kZWZhdWx0cy5qcyBNVUxUSS5cbiAqL1xuZXhwb3J0IGNvbnN0IE1VTFRJOiBSZWFkb25seUFycmF5PFJlYWRvbmx5QXJyYXk8bnVtYmVyPj4gPSBbXG4gIFs0LCAzLCAyLCAxLjUsIDFdLFxuICBbMywgMiwgMSwgMSwgMC41XSxcbiAgWzIsIDEsIDAuNSwgMCwgMF0sXG4gIFswLCAwLCAwLCAtMSwgLTFdLFxuXSBhcyBjb25zdDtcblxuZXhwb3J0IGZ1bmN0aW9uIG1hdGNodXBRdWFsaXR5KG9mZjogUmVndWxhclBsYXksIGRlZjogUmVndWxhclBsYXkpOiBNYXRjaHVwUXVhbGl0eSB7XG4gIGNvbnN0IHJvdyA9IE1BVENIVVBbUExBWV9JTkRFWFtvZmZdXTtcbiAgaWYgKCFyb3cpIHRocm93IG5ldyBFcnJvcihgdW5yZWFjaGFibGU6IGJhZCBvZmYgcGxheSAke29mZn1gKTtcbiAgY29uc3QgcSA9IHJvd1tQTEFZX0lOREVYW2RlZl1dO1xuICBpZiAocSA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoYHVucmVhY2hhYmxlOiBiYWQgZGVmIHBsYXkgJHtkZWZ9YCk7XG4gIHJldHVybiBxO1xufVxuIiwgIi8qKlxuICogUHVyZSB5YXJkYWdlIGNhbGN1bGF0aW9uIGZvciBhIHJlZ3VsYXIgcGxheSAoU1IvTFIvU1AvTFApLlxuICpcbiAqIEZvcm11bGEgKHJ1bi5qczoyMzM3KTpcbiAqICAgeWFyZHMgPSByb3VuZChtdWx0aXBsaWVyICogeWFyZHNDYXJkKSArIGJvbnVzXG4gKlxuICogV2hlcmU6XG4gKiAgIC0gbXVsdGlwbGllciA9IE1VTFRJW211bHRpcGxpZXJDYXJkXVtxdWFsaXR5IC0gMV1cbiAqICAgLSBxdWFsaXR5ICAgID0gTUFUQ0hVUFtvZmZlbnNlXVtkZWZlbnNlXSAgIC8vIDEtNVxuICogICAtIGJvbnVzICAgICAgPSBzcGVjaWFsLXBsYXkgYm9udXMgKGUuZy4gVHJpY2sgUGxheSArNSBvbiBMUi9MUCBvdXRjb21lcylcbiAqXG4gKiBTcGVjaWFsIHBsYXlzIChUUCwgSE0sIEZHLCBQVU5ULCBUV09fUFQpIHVzZSBkaWZmZXJlbnQgZm9ybXVsYXMgXHUyMDE0IHRoZXlcbiAqIGxpdmUgaW4gcnVsZXMvc3BlY2lhbC50cyAoVE9ETykgYW5kIHByb2R1Y2UgZXZlbnRzIGRpcmVjdGx5LlxuICovXG5cbmltcG9ydCB0eXBlIHsgUmVndWxhclBsYXkgfSBmcm9tIFwiLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IE1VTFRJLCBtYXRjaHVwUXVhbGl0eSB9IGZyb20gXCIuL21hdGNodXAuanNcIjtcblxuZXhwb3J0IHR5cGUgTXVsdGlwbGllckNhcmRJbmRleCA9IDAgfCAxIHwgMiB8IDM7XG5leHBvcnQgY29uc3QgTVVMVElQTElFUl9DQVJEX05BTUVTID0gW1wiS2luZ1wiLCBcIlF1ZWVuXCIsIFwiSmFja1wiLCBcIjEwXCJdIGFzIGNvbnN0O1xuZXhwb3J0IHR5cGUgTXVsdGlwbGllckNhcmROYW1lID0gKHR5cGVvZiBNVUxUSVBMSUVSX0NBUkRfTkFNRVMpW251bWJlcl07XG5cbmV4cG9ydCBpbnRlcmZhY2UgWWFyZGFnZUlucHV0cyB7XG4gIG9mZmVuc2U6IFJlZ3VsYXJQbGF5O1xuICBkZWZlbnNlOiBSZWd1bGFyUGxheTtcbiAgLyoqIE11bHRpcGxpZXIgY2FyZCBpbmRleDogMD1LaW5nLCAxPVF1ZWVuLCAyPUphY2ssIDM9MTAuICovXG4gIG11bHRpcGxpZXJDYXJkOiBNdWx0aXBsaWVyQ2FyZEluZGV4O1xuICAvKiogWWFyZHMgY2FyZCBkcmF3biwgMS0xMC4gKi9cbiAgeWFyZHNDYXJkOiBudW1iZXI7XG4gIC8qKiBCb251cyB5YXJkcyBmcm9tIHNwZWNpYWwtcGxheSBvdmVybGF5cyAoZS5nLiBUcmljayBQbGF5ICs1KS4gKi9cbiAgYm9udXM/OiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgWWFyZGFnZU91dGNvbWUge1xuICBtYXRjaHVwUXVhbGl0eTogbnVtYmVyO1xuICBtdWx0aXBsaWVyOiBudW1iZXI7XG4gIG11bHRpcGxpZXJDYXJkTmFtZTogTXVsdGlwbGllckNhcmROYW1lO1xuICB5YXJkc0dhaW5lZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY29tcHV0ZVlhcmRhZ2UoaW5wdXRzOiBZYXJkYWdlSW5wdXRzKTogWWFyZGFnZU91dGNvbWUge1xuICBjb25zdCBxdWFsaXR5ID0gbWF0Y2h1cFF1YWxpdHkoaW5wdXRzLm9mZmVuc2UsIGlucHV0cy5kZWZlbnNlKTtcbiAgY29uc3QgbXVsdGlSb3cgPSBNVUxUSVtpbnB1dHMubXVsdGlwbGllckNhcmRdO1xuICBpZiAoIW11bHRpUm93KSB0aHJvdyBuZXcgRXJyb3IoYHVucmVhY2hhYmxlOiBiYWQgbXVsdGkgY2FyZCAke2lucHV0cy5tdWx0aXBsaWVyQ2FyZH1gKTtcbiAgY29uc3QgbXVsdGlwbGllciA9IG11bHRpUm93W3F1YWxpdHkgLSAxXTtcbiAgaWYgKG11bHRpcGxpZXIgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKGB1bnJlYWNoYWJsZTogYmFkIHF1YWxpdHkgJHtxdWFsaXR5fWApO1xuXG4gIGNvbnN0IGJvbnVzID0gaW5wdXRzLmJvbnVzID8/IDA7XG4gIGNvbnN0IHlhcmRzR2FpbmVkID0gTWF0aC5yb3VuZChtdWx0aXBsaWVyICogaW5wdXRzLnlhcmRzQ2FyZCkgKyBib251cztcblxuICByZXR1cm4ge1xuICAgIG1hdGNodXBRdWFsaXR5OiBxdWFsaXR5LFxuICAgIG11bHRpcGxpZXIsXG4gICAgbXVsdGlwbGllckNhcmROYW1lOiBNVUxUSVBMSUVSX0NBUkRfTkFNRVNbaW5wdXRzLm11bHRpcGxpZXJDYXJkXSxcbiAgICB5YXJkc0dhaW5lZCxcbiAgfTtcbn1cbiIsICIvKipcbiAqIENhcmQtZGVjayBkcmF3cyBcdTIwMTQgcHVyZSB2ZXJzaW9ucyBvZiB2NS4xJ3MgYEdhbWUuZGVjTXVsdHNgIGFuZCBgR2FtZS5kZWNZYXJkc2AuXG4gKlxuICogVGhlIGRlY2sgaXMgcmVwcmVzZW50ZWQgYXMgYW4gYXJyYXkgb2YgcmVtYWluaW5nIGNvdW50cyBwZXIgY2FyZCBzbG90LlxuICogVG8gZHJhdywgd2UgcGljayBhIHVuaWZvcm0gcmFuZG9tIHNsb3Q7IGlmIHRoYXQgc2xvdCBpcyBlbXB0eSwgd2UgcmV0cnkuXG4gKiBUaGlzIGlzIG1hdGhlbWF0aWNhbGx5IGVxdWl2YWxlbnQgdG8gc2h1ZmZsaW5nIHRoZSByZW1haW5pbmcgY2FyZHMgYW5kXG4gKiBkcmF3aW5nIG9uZSBcdTIwMTQgYW5kIG1hdGNoZXMgdjUuMSdzIGJlaGF2aW9yIHZlcmJhdGltLlxuICpcbiAqIFdoZW4gdGhlIGRlY2sgaXMgZXhoYXVzdGVkLCB0aGUgY29uc3VtZXIgKHRoZSByZWR1Y2VyKSByZWZpbGxzIGl0IGFuZFxuICogZW1pdHMgYSBERUNLX1NIVUZGTEVEIGV2ZW50LlxuICovXG5cbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBEZWNrU3RhdGUgfSBmcm9tIFwiLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7XG4gIGZyZXNoRGVja011bHRpcGxpZXJzLFxuICBmcmVzaERlY2tZYXJkcyxcbn0gZnJvbSBcIi4uL3N0YXRlLmpzXCI7XG5pbXBvcnQge1xuICBNVUxUSVBMSUVSX0NBUkRfTkFNRVMsXG4gIHR5cGUgTXVsdGlwbGllckNhcmRJbmRleCxcbiAgdHlwZSBNdWx0aXBsaWVyQ2FyZE5hbWUsXG59IGZyb20gXCIuL3lhcmRhZ2UuanNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBNdWx0aXBsaWVyRHJhdyB7XG4gIGNhcmQ6IE11bHRpcGxpZXJDYXJkTmFtZTtcbiAgaW5kZXg6IE11bHRpcGxpZXJDYXJkSW5kZXg7XG4gIGRlY2s6IERlY2tTdGF0ZTtcbiAgcmVzaHVmZmxlZDogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRyYXdNdWx0aXBsaWVyKGRlY2s6IERlY2tTdGF0ZSwgcm5nOiBSbmcpOiBNdWx0aXBsaWVyRHJhdyB7XG4gIGNvbnN0IG11bHRzID0gWy4uLmRlY2subXVsdGlwbGllcnNdIGFzIFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdO1xuXG4gIGxldCBpbmRleDogTXVsdGlwbGllckNhcmRJbmRleDtcbiAgLy8gUmVqZWN0aW9uLXNhbXBsZSB0byBkcmF3IHVuaWZvcm1seSBhY3Jvc3MgcmVtYWluaW5nIGNhcmRzLlxuICAvLyBMb29wIGlzIGJvdW5kZWQgXHUyMDE0IHRvdGFsIGNhcmRzIGluIGZyZXNoIGRlY2sgaXMgMTUuXG4gIGZvciAoOzspIHtcbiAgICBjb25zdCBpID0gcm5nLmludEJldHdlZW4oMCwgMykgYXMgTXVsdGlwbGllckNhcmRJbmRleDtcbiAgICBpZiAobXVsdHNbaV0gPiAwKSB7XG4gICAgICBpbmRleCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICBtdWx0c1tpbmRleF0tLTtcblxuICBsZXQgcmVzaHVmZmxlZCA9IGZhbHNlO1xuICBsZXQgbmV4dERlY2s6IERlY2tTdGF0ZSA9IHsgLi4uZGVjaywgbXVsdGlwbGllcnM6IG11bHRzIH07XG4gIGlmIChtdWx0cy5ldmVyeSgoYykgPT4gYyA9PT0gMCkpIHtcbiAgICByZXNodWZmbGVkID0gdHJ1ZTtcbiAgICBuZXh0RGVjayA9IHsgLi4ubmV4dERlY2ssIG11bHRpcGxpZXJzOiBmcmVzaERlY2tNdWx0aXBsaWVycygpIH07XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGNhcmQ6IE1VTFRJUExJRVJfQ0FSRF9OQU1FU1tpbmRleF0sXG4gICAgaW5kZXgsXG4gICAgZGVjazogbmV4dERlY2ssXG4gICAgcmVzaHVmZmxlZCxcbiAgfTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBZYXJkc0RyYXcge1xuICAvKiogWWFyZHMgY2FyZCB2YWx1ZSwgMS0xMC4gKi9cbiAgY2FyZDogbnVtYmVyO1xuICBkZWNrOiBEZWNrU3RhdGU7XG4gIHJlc2h1ZmZsZWQ6IGJvb2xlYW47XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkcmF3WWFyZHMoZGVjazogRGVja1N0YXRlLCBybmc6IFJuZyk6IFlhcmRzRHJhdyB7XG4gIGNvbnN0IHlhcmRzID0gWy4uLmRlY2sueWFyZHNdO1xuXG4gIGxldCBpbmRleDogbnVtYmVyO1xuICBmb3IgKDs7KSB7XG4gICAgY29uc3QgaSA9IHJuZy5pbnRCZXR3ZWVuKDAsIHlhcmRzLmxlbmd0aCAtIDEpO1xuICAgIGNvbnN0IHNsb3QgPSB5YXJkc1tpXTtcbiAgICBpZiAoc2xvdCAhPT0gdW5kZWZpbmVkICYmIHNsb3QgPiAwKSB7XG4gICAgICBpbmRleCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICB5YXJkc1tpbmRleF0gPSAoeWFyZHNbaW5kZXhdID8/IDApIC0gMTtcblxuICBsZXQgcmVzaHVmZmxlZCA9IGZhbHNlO1xuICBsZXQgbmV4dERlY2s6IERlY2tTdGF0ZSA9IHsgLi4uZGVjaywgeWFyZHMgfTtcbiAgaWYgKHlhcmRzLmV2ZXJ5KChjKSA9PiBjID09PSAwKSkge1xuICAgIHJlc2h1ZmZsZWQgPSB0cnVlO1xuICAgIG5leHREZWNrID0geyAuLi5uZXh0RGVjaywgeWFyZHM6IGZyZXNoRGVja1lhcmRzKCkgfTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgY2FyZDogaW5kZXggKyAxLFxuICAgIGRlY2s6IG5leHREZWNrLFxuICAgIHJlc2h1ZmZsZWQsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgcHJpbWl0aXZlcyB1c2VkIGJ5IG11bHRpcGxlIHNwZWNpYWwtcGxheSByZXNvbHZlcnMuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBQbGF5ZXJJZCwgU3RhdHMgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi8uLi9zdGF0ZS5qc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgc3RhdGU6IEdhbWVTdGF0ZTtcbiAgZXZlbnRzOiBFdmVudFtdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYmxhbmtQaWNrKCk6IEdhbWVTdGF0ZVtcInBlbmRpbmdQaWNrXCJdIHtcbiAgcmV0dXJuIHsgb2ZmZW5zZVBsYXk6IG51bGwsIGRlZmVuc2VQbGF5OiBudWxsIH07XG59XG5cbi8qKlxuICogQnVtcCBwZXItcGxheWVyIHN0YXRzLiBSZXR1cm5zIGEgbmV3IHBsYXllcnMgbWFwIHdpdGggdGhlIGRlbHRhcyBhcHBsaWVkXG4gKiB0byBgcGxheWVySWRgLiBVc2UgcGFydGlhbCBTdGF0cyBcdTIwMTQgdW5zcGVjaWZpZWQgZmllbGRzIGFyZSB1bmNoYW5nZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidW1wU3RhdHMoXG4gIHBsYXllcnM6IEdhbWVTdGF0ZVtcInBsYXllcnNcIl0sXG4gIHBsYXllcklkOiBQbGF5ZXJJZCxcbiAgZGVsdGFzOiBQYXJ0aWFsPFN0YXRzPixcbik6IEdhbWVTdGF0ZVtcInBsYXllcnNcIl0ge1xuICBjb25zdCBjdXIgPSBwbGF5ZXJzW3BsYXllcklkXS5zdGF0cztcbiAgcmV0dXJuIHtcbiAgICAuLi5wbGF5ZXJzLFxuICAgIFtwbGF5ZXJJZF06IHtcbiAgICAgIC4uLnBsYXllcnNbcGxheWVySWRdLFxuICAgICAgc3RhdHM6IHtcbiAgICAgICAgcGFzc1lhcmRzOiBjdXIucGFzc1lhcmRzICsgKGRlbHRhcy5wYXNzWWFyZHMgPz8gMCksXG4gICAgICAgIHJ1c2hZYXJkczogY3VyLnJ1c2hZYXJkcyArIChkZWx0YXMucnVzaFlhcmRzID8/IDApLFxuICAgICAgICB0dXJub3ZlcnM6IGN1ci50dXJub3ZlcnMgKyAoZGVsdGFzLnR1cm5vdmVycyA/PyAwKSxcbiAgICAgICAgc2Fja3M6IGN1ci5zYWNrcyArIChkZWx0YXMuc2Fja3MgPz8gMCksXG4gICAgICB9LFxuICAgIH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbn1cblxuLyoqXG4gKiBBd2FyZCBwb2ludHMsIGZsaXAgdG8gUEFUX0NIT0lDRS4gQ2FsbGVyIGVtaXRzIFRPVUNIRE9XTi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5VG91Y2hkb3duKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBzY29yZXI6IFBsYXllcklkLFxuICBldmVudHM6IEV2ZW50W10sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgLi4uc3RhdGUucGxheWVycyxcbiAgICBbc2NvcmVyXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0uc2NvcmUgKyA2IH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRPVUNIRE9XTlwiLCBzY29yaW5nUGxheWVyOiBzY29yZXIgfSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIHBoYXNlOiBcIlBBVF9DSE9JQ0VcIixcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5U2FmZXR5KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBjb25jZWRlcjogUGxheWVySWQsXG4gIGV2ZW50czogRXZlbnRbXSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgc2NvcmVyID0gb3BwKGNvbmNlZGVyKTtcbiAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtzY29yZXJdOiB7IC4uLnN0YXRlLnBsYXllcnNbc2NvcmVyXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbc2NvcmVyXS5zY29yZSArIDIgfSxcbiAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiU0FGRVRZXCIsIHNjb3JpbmdQbGF5ZXI6IHNjb3JlciB9KTtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgICAgaXNTYWZldHlLaWNrOiB0cnVlLFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG4vKipcbiAqIEFwcGx5IGEgeWFyZGFnZSBvdXRjb21lIHdpdGggZnVsbCBkb3duL3R1cm5vdmVyL3Njb3JlIGJvb2trZWVwaW5nLlxuICogVXNlZCBieSBzcGVjaWFscyB0aGF0IHByb2R1Y2UgeWFyZGFnZSBkaXJlY3RseSAoSGFpbCBNYXJ5LCBCaWcgUGxheSByZXR1cm4pLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlZYXJkYWdlT3V0Y29tZShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgeWFyZHM6IG51bWJlcixcbiAgZXZlbnRzOiBFdmVudFtdLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgcHJvamVjdGVkID0gc3RhdGUuZmllbGQuYmFsbE9uICsgeWFyZHM7XG5cbiAgaWYgKHByb2plY3RlZCA+PSAxMDApIHJldHVybiBhcHBseVRvdWNoZG93bihzdGF0ZSwgb2ZmZW5zZSwgZXZlbnRzKTtcbiAgaWYgKHByb2plY3RlZCA8PSAwKSByZXR1cm4gYXBwbHlTYWZldHkoc3RhdGUsIG9mZmVuc2UsIGV2ZW50cyk7XG5cbiAgY29uc3QgcmVhY2hlZEZpcnN0RG93biA9IHByb2plY3RlZCA+PSBzdGF0ZS5maWVsZC5maXJzdERvd25BdDtcbiAgbGV0IG5leHREb3duID0gc3RhdGUuZmllbGQuZG93bjtcbiAgbGV0IG5leHRGaXJzdERvd25BdCA9IHN0YXRlLmZpZWxkLmZpcnN0RG93bkF0O1xuICBsZXQgcG9zc2Vzc2lvbkZsaXBwZWQgPSBmYWxzZTtcblxuICBpZiAocmVhY2hlZEZpcnN0RG93bikge1xuICAgIG5leHREb3duID0gMTtcbiAgICBuZXh0Rmlyc3REb3duQXQgPSBNYXRoLm1pbigxMDAsIHByb2plY3RlZCArIDEwKTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiRklSU1RfRE9XTlwiIH0pO1xuICB9IGVsc2UgaWYgKHN0YXRlLmZpZWxkLmRvd24gPT09IDQpIHtcbiAgICBwb3NzZXNzaW9uRmxpcHBlZCA9IHRydWU7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSX09OX0RPV05TXCIgfSk7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJkb3duc1wiIH0pO1xuICB9IGVsc2Uge1xuICAgIG5leHREb3duID0gKHN0YXRlLmZpZWxkLmRvd24gKyAxKSBhcyAxIHwgMiB8IDMgfCA0O1xuICB9XG5cbiAgY29uc3QgbWlycm9yZWRCYWxsT24gPSBwb3NzZXNzaW9uRmxpcHBlZCA/IDEwMCAtIHByb2plY3RlZCA6IHByb2plY3RlZDtcblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogbWlycm9yZWRCYWxsT24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBwb3NzZXNzaW9uRmxpcHBlZFxuICAgICAgICAgID8gTWF0aC5taW4oMTAwLCBtaXJyb3JlZEJhbGxPbiArIDEwKVxuICAgICAgICAgIDogbmV4dEZpcnN0RG93bkF0LFxuICAgICAgICBkb3duOiBwb3NzZXNzaW9uRmxpcHBlZCA/IDEgOiBuZXh0RG93bixcbiAgICAgICAgb2ZmZW5zZTogcG9zc2Vzc2lvbkZsaXBwZWQgPyBvcHAob2ZmZW5zZSkgOiBvZmZlbnNlLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cbiIsICIvKipcbiAqIFJlZ3VsYXItcGxheSByZXNvbHV0aW9uLiBTcGVjaWFsIHBsYXlzIChUUCwgSE0sIEZHLCBQVU5ULCBUV09fUFQpIGJyYW5jaFxuICogZWxzZXdoZXJlIFx1MjAxNCBzZWUgcnVsZXMvc3BlY2lhbC50cyAoVE9ETykuXG4gKlxuICogR2l2ZW4gdHdvIHBpY2tzIChvZmZlbnNlICsgZGVmZW5zZSkgYW5kIHRoZSBjdXJyZW50IHN0YXRlLCBwcm9kdWNlIGEgbmV3XG4gKiBzdGF0ZSBhbmQgdGhlIGV2ZW50IHN0cmVhbSBmb3IgdGhlIHBsYXkuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIFBsYXlDYWxsLCBSZWd1bGFyUGxheSB9IGZyb20gXCIuLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgZHJhd011bHRpcGxpZXIsIGRyYXdZYXJkcyB9IGZyb20gXCIuL2RlY2suanNcIjtcbmltcG9ydCB7IGNvbXB1dGVZYXJkYWdlIH0gZnJvbSBcIi4veWFyZGFnZS5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4uL3N0YXRlLmpzXCI7XG5pbXBvcnQgeyBidW1wU3RhdHMgfSBmcm9tIFwiLi9zcGVjaWFscy9zaGFyZWQuanNcIjtcblxuY29uc3QgUkVHVUxBUjogUmVhZG9ubHlTZXQ8UGxheUNhbGw+ID0gbmV3IFNldChbXCJTUlwiLCBcIkxSXCIsIFwiU1BcIiwgXCJMUFwiXSk7XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1JlZ3VsYXJQbGF5KHA6IFBsYXlDYWxsKTogcCBpcyBSZWd1bGFyUGxheSB7XG4gIHJldHVybiBSRUdVTEFSLmhhcyhwKTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBSZXNvbHZlSW5wdXQge1xuICBvZmZlbnNlUGxheTogUGxheUNhbGw7XG4gIGRlZmVuc2VQbGF5OiBQbGF5Q2FsbDtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBQbGF5UmVzb2x1dGlvbiB7XG4gIHN0YXRlOiBHYW1lU3RhdGU7XG4gIGV2ZW50czogRXZlbnRbXTtcbn1cblxuLyoqXG4gKiBSZXNvbHZlIGEgcmVndWxhciB2cyByZWd1bGFyIHBsYXkuIENhbGxlciAodGhlIHJlZHVjZXIpIHJvdXRlcyB0byBzcGVjaWFsXG4gKiBwbGF5IGhhbmRsZXJzIGlmIGVpdGhlciBwaWNrIGlzIG5vbi1yZWd1bGFyLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVJlZ3VsYXJQbGF5KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBpbnB1dDogUmVzb2x2ZUlucHV0LFxuICBybmc6IFJuZyxcbik6IFBsYXlSZXNvbHV0aW9uIHtcbiAgaWYgKCFpc1JlZ3VsYXJQbGF5KGlucHV0Lm9mZmVuc2VQbGF5KSB8fCAhaXNSZWd1bGFyUGxheShpbnB1dC5kZWZlbnNlUGxheSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJyZXNvbHZlUmVndWxhclBsYXkgY2FsbGVkIHdpdGggYSBub24tcmVndWxhciBwbGF5XCIpO1xuICB9XG5cbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG5cbiAgLy8gRHJhdyBjYXJkcy5cbiAgY29uc3QgbXVsdERyYXcgPSBkcmF3TXVsdGlwbGllcihzdGF0ZS5kZWNrLCBybmcpO1xuICBpZiAobXVsdERyYXcucmVzaHVmZmxlZCkge1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwibXVsdGlwbGllclwiIH0pO1xuICB9XG4gIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhtdWx0RHJhdy5kZWNrLCBybmcpO1xuICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIHtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG4gIH1cblxuICAvLyBDb21wdXRlIHlhcmRhZ2UuXG4gIGNvbnN0IG91dGNvbWUgPSBjb21wdXRlWWFyZGFnZSh7XG4gICAgb2ZmZW5zZTogaW5wdXQub2ZmZW5zZVBsYXksXG4gICAgZGVmZW5zZTogaW5wdXQuZGVmZW5zZVBsYXksXG4gICAgbXVsdGlwbGllckNhcmQ6IG11bHREcmF3LmluZGV4LFxuICAgIHlhcmRzQ2FyZDogeWFyZHNEcmF3LmNhcmQsXG4gIH0pO1xuXG4gIC8vIERlY3JlbWVudCBvZmZlbnNlJ3MgaGFuZCBmb3IgdGhlIHBsYXkgdGhleSB1c2VkLiBSZWZpbGwgYXQgemVybyBcdTIwMTQgdGhlXG4gIC8vIGV4YWN0IDEyLWNhcmQgcmVzaHVmZmxlIGJlaGF2aW9yIGxpdmVzIGluIGBkZWNyZW1lbnRIYW5kYC5cbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGxldCBuZXdQbGF5ZXJzID0ge1xuICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgW29mZmVuc2VdOiBkZWNyZW1lbnRIYW5kKHN0YXRlLnBsYXllcnNbb2ZmZW5zZV0sIGlucHV0Lm9mZmVuc2VQbGF5KSxcbiAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuXG4gIC8vIFN0YXRzOiBwYXNzIHZzIHJ1biBieSBwbGF5IHR5cGUuIFNQL0xQIGNhcnJ5IHBhc3NZYXJkcyAod2l0aCBuZWdhdGl2ZVxuICAvLyB5YXJkYWdlIG9uIGEgcGFzcyA9IHNhY2spLiBTUi9MUiBjYXJyeSBydXNoWWFyZHMuXG4gIGNvbnN0IGlzUGFzcyA9IGlucHV0Lm9mZmVuc2VQbGF5ID09PSBcIlNQXCIgfHwgaW5wdXQub2ZmZW5zZVBsYXkgPT09IFwiTFBcIjtcbiAgY29uc3Qgc3RhdERlbHRhID0gaXNQYXNzXG4gICAgPyB7XG4gICAgICAgIHBhc3NZYXJkczogb3V0Y29tZS55YXJkc0dhaW5lZCxcbiAgICAgICAgc2Fja3M6IG91dGNvbWUueWFyZHNHYWluZWQgPCAwID8gMSA6IDAsXG4gICAgICB9XG4gICAgOiB7IHJ1c2hZYXJkczogb3V0Y29tZS55YXJkc0dhaW5lZCB9O1xuICBuZXdQbGF5ZXJzID0gYnVtcFN0YXRzKG5ld1BsYXllcnMsIG9mZmVuc2UsIHN0YXREZWx0YSk7XG5cbiAgLy8gQXBwbHkgeWFyZGFnZSB0byBiYWxsIHBvc2l0aW9uLiBDbGFtcCBhdCAxMDAgKFREKSBhbmQgMCAoc2FmZXR5KS5cbiAgY29uc3QgcHJvamVjdGVkID0gc3RhdGUuZmllbGQuYmFsbE9uICsgb3V0Y29tZS55YXJkc0dhaW5lZDtcbiAgbGV0IG5ld0JhbGxPbiA9IHByb2plY3RlZDtcbiAgbGV0IHNjb3JlZDogXCJ0ZFwiIHwgXCJzYWZldHlcIiB8IG51bGwgPSBudWxsO1xuICBpZiAocHJvamVjdGVkID49IDEwMCkge1xuICAgIG5ld0JhbGxPbiA9IDEwMDtcbiAgICBzY29yZWQgPSBcInRkXCI7XG4gIH0gZWxzZSBpZiAocHJvamVjdGVkIDw9IDApIHtcbiAgICBuZXdCYWxsT24gPSAwO1xuICAgIHNjb3JlZCA9IFwic2FmZXR5XCI7XG4gIH1cblxuICBldmVudHMucHVzaCh7XG4gICAgdHlwZTogXCJQTEFZX1JFU09MVkVEXCIsXG4gICAgb2ZmZW5zZVBsYXk6IGlucHV0Lm9mZmVuc2VQbGF5LFxuICAgIGRlZmVuc2VQbGF5OiBpbnB1dC5kZWZlbnNlUGxheSxcbiAgICBtYXRjaHVwUXVhbGl0eTogb3V0Y29tZS5tYXRjaHVwUXVhbGl0eSxcbiAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IG91dGNvbWUubXVsdGlwbGllckNhcmROYW1lLCB2YWx1ZTogb3V0Y29tZS5tdWx0aXBsaWVyIH0sXG4gICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgICB5YXJkc0dhaW5lZDogb3V0Y29tZS55YXJkc0dhaW5lZCxcbiAgICBuZXdCYWxsT24sXG4gIH0pO1xuXG4gIC8vIFNjb3JlIGhhbmRsaW5nLlxuICBpZiAoc2NvcmVkID09PSBcInRkXCIpIHtcbiAgICByZXR1cm4gdG91Y2hkb3duU3RhdGUoXG4gICAgICB7IC4uLnN0YXRlLCBkZWNrOiB5YXJkc0RyYXcuZGVjaywgcGxheWVyczogbmV3UGxheWVycywgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpIH0sXG4gICAgICBvZmZlbnNlLFxuICAgICAgZXZlbnRzLFxuICAgICk7XG4gIH1cbiAgaWYgKHNjb3JlZCA9PT0gXCJzYWZldHlcIikge1xuICAgIHJldHVybiBzYWZldHlTdGF0ZShcbiAgICAgIHsgLi4uc3RhdGUsIGRlY2s6IHlhcmRzRHJhdy5kZWNrLCBwbGF5ZXJzOiBuZXdQbGF5ZXJzLCBwZW5kaW5nUGljazogYmxhbmtQaWNrKCkgfSxcbiAgICAgIG9mZmVuc2UsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuXG4gIC8vIERvd24vZGlzdGFuY2UgaGFuZGxpbmcuXG4gIGNvbnN0IHJlYWNoZWRGaXJzdERvd24gPSBuZXdCYWxsT24gPj0gc3RhdGUuZmllbGQuZmlyc3REb3duQXQ7XG4gIGxldCBuZXh0RG93biA9IHN0YXRlLmZpZWxkLmRvd247XG4gIGxldCBuZXh0Rmlyc3REb3duQXQgPSBzdGF0ZS5maWVsZC5maXJzdERvd25BdDtcbiAgbGV0IHBvc3Nlc3Npb25GbGlwcGVkID0gZmFsc2U7XG5cbiAgaWYgKHJlYWNoZWRGaXJzdERvd24pIHtcbiAgICBuZXh0RG93biA9IDE7XG4gICAgbmV4dEZpcnN0RG93bkF0ID0gTWF0aC5taW4oMTAwLCBuZXdCYWxsT24gKyAxMCk7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkZJUlNUX0RPV05cIiB9KTtcbiAgfSBlbHNlIGlmIChzdGF0ZS5maWVsZC5kb3duID09PSA0KSB7XG4gICAgLy8gVHVybm92ZXIgb24gZG93bnMgXHUyMDE0IHBvc3Nlc3Npb24gZmxpcHMsIGJhbGwgc3RheXMuXG4gICAgbmV4dERvd24gPSAxO1xuICAgIHBvc3Nlc3Npb25GbGlwcGVkID0gdHJ1ZTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJfT05fRE9XTlNcIiB9KTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcImRvd25zXCIgfSk7XG4gICAgbmV3UGxheWVycyA9IGJ1bXBTdGF0cyhuZXdQbGF5ZXJzLCBvZmZlbnNlLCB7IHR1cm5vdmVyczogMSB9KTtcbiAgfSBlbHNlIHtcbiAgICBuZXh0RG93biA9IChzdGF0ZS5maWVsZC5kb3duICsgMSkgYXMgMSB8IDIgfCAzIHwgNDtcbiAgfVxuXG4gIGNvbnN0IG5leHRPZmZlbnNlID0gcG9zc2Vzc2lvbkZsaXBwZWQgPyBvcHAob2ZmZW5zZSkgOiBvZmZlbnNlO1xuICBjb25zdCBuZXh0QmFsbE9uID0gcG9zc2Vzc2lvbkZsaXBwZWQgPyAxMDAgLSBuZXdCYWxsT24gOiBuZXdCYWxsT247XG4gIGNvbnN0IG5leHRGaXJzdERvd24gPSBwb3NzZXNzaW9uRmxpcHBlZFxuICAgID8gTWF0aC5taW4oMTAwLCBuZXh0QmFsbE9uICsgMTApXG4gICAgOiBuZXh0Rmlyc3REb3duQXQ7XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBkZWNrOiB5YXJkc0RyYXcuZGVjayxcbiAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IG5leHRCYWxsT24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBuZXh0Rmlyc3REb3duLFxuICAgICAgICBkb3duOiBuZXh0RG93bixcbiAgICAgICAgb2ZmZW5zZTogbmV4dE9mZmVuc2UsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG5mdW5jdGlvbiBibGFua1BpY2soKTogR2FtZVN0YXRlW1wicGVuZGluZ1BpY2tcIl0ge1xuICByZXR1cm4geyBvZmZlbnNlUGxheTogbnVsbCwgZGVmZW5zZVBsYXk6IG51bGwgfTtcbn1cblxuLyoqXG4gKiBUb3VjaGRvd24gYm9va2tlZXBpbmcgXHUyMDE0IDYgcG9pbnRzLCB0cmFuc2l0aW9uIHRvIFBBVF9DSE9JQ0UgcGhhc2UuXG4gKiAoUEFULzJwdCByZXNvbHV0aW9uIGFuZCBlbnN1aW5nIGtpY2tvZmYgaGFwcGVuIGluIHN1YnNlcXVlbnQgYWN0aW9ucy4pXG4gKi9cbmZ1bmN0aW9uIHRvdWNoZG93blN0YXRlKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBzY29yZXI6IEdhbWVTdGF0ZVtcImZpZWxkXCJdW1wib2ZmZW5zZVwiXSxcbiAgZXZlbnRzOiBFdmVudFtdLFxuKTogUGxheVJlc29sdXRpb24ge1xuICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgW3Njb3Jlcl06IHsgLi4uc3RhdGUucGxheWVyc1tzY29yZXJdLCBzY29yZTogc3RhdGUucGxheWVyc1tzY29yZXJdLnNjb3JlICsgNiB9LFxuICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUT1VDSERPV05cIiwgc2NvcmluZ1BsYXllcjogc2NvcmVyIH0pO1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7IC4uLnN0YXRlLCBwbGF5ZXJzOiBuZXdQbGF5ZXJzLCBwaGFzZTogXCJQQVRfQ0hPSUNFXCIgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbi8qKlxuICogU2FmZXR5IFx1MjAxNCBkZWZlbnNlIHNjb3JlcyAyLCBvZmZlbnNlIGtpY2tzIGZyZWUga2ljay5cbiAqIEZvciB0aGUgc2tldGNoIHdlIHNjb3JlIGFuZCBlbWl0OyB0aGUga2lja29mZiB0cmFuc2l0aW9uIGlzIFRPRE8uXG4gKi9cbmZ1bmN0aW9uIHNhZmV0eVN0YXRlKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBjb25jZWRlcjogR2FtZVN0YXRlW1wiZmllbGRcIl1bXCJvZmZlbnNlXCJdLFxuICBldmVudHM6IEV2ZW50W10sXG4pOiBQbGF5UmVzb2x1dGlvbiB7XG4gIGNvbnN0IHNjb3JlciA9IG9wcChjb25jZWRlcik7XG4gIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgLi4uc3RhdGUucGxheWVycyxcbiAgICBbc2NvcmVyXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0uc2NvcmUgKyAyIH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlNBRkVUWVwiLCBzY29yaW5nUGxheWVyOiBzY29yZXIgfSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHsgLi4uc3RhdGUsIHBsYXllcnM6IG5ld1BsYXllcnMsIHBoYXNlOiBcIktJQ0tPRkZcIiB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuLyoqXG4gKiBEZWNyZW1lbnQgdGhlIGNob3NlbiBwbGF5IGluIGEgcGxheWVyJ3MgaGFuZC4gSWYgdGhlIHJlZ3VsYXItcGxheSBjYXJkc1xuICogKFNSL0xSL1NQL0xQKSBhcmUgYWxsIGV4aGF1c3RlZCwgcmVmaWxsIHRoZW0gXHUyMDE0IEhhaWwgTWFyeSBjb3VudCBpc1xuICogcHJlc2VydmVkIGFjcm9zcyByZWZpbGxzIChtYXRjaGVzIHY1LjEgUGxheWVyLmZpbGxQbGF5cygncCcpKS5cbiAqL1xuZnVuY3Rpb24gZGVjcmVtZW50SGFuZChcbiAgcGxheWVyOiBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdWzFdLFxuICBwbGF5OiBQbGF5Q2FsbCxcbik6IEdhbWVTdGF0ZVtcInBsYXllcnNcIl1bMV0ge1xuICBjb25zdCBoYW5kID0geyAuLi5wbGF5ZXIuaGFuZCB9O1xuXG4gIGlmIChwbGF5ID09PSBcIkhNXCIpIHtcbiAgICBoYW5kLkhNID0gTWF0aC5tYXgoMCwgaGFuZC5ITSAtIDEpO1xuICAgIHJldHVybiB7IC4uLnBsYXllciwgaGFuZCB9O1xuICB9XG5cbiAgaWYgKHBsYXkgPT09IFwiRkdcIiB8fCBwbGF5ID09PSBcIlBVTlRcIiB8fCBwbGF5ID09PSBcIlRXT19QVFwiKSB7XG4gICAgLy8gTm8gY2FyZCBjb25zdW1lZCBcdTIwMTQgdGhlc2UgYXJlIHNpdHVhdGlvbmFsIGRlY2lzaW9ucywgbm90IGRyYXdzLlxuICAgIHJldHVybiBwbGF5ZXI7XG4gIH1cblxuICBoYW5kW3BsYXldID0gTWF0aC5tYXgoMCwgaGFuZFtwbGF5XSAtIDEpO1xuXG4gIC8vIHY1LjEgMTItY2FyZCByZXNodWZmbGU6IHdoZW4gdGhlIDEyIHJlZ3VsYXItcGxheSBjYXJkcyAoU1IvTFIvU1AvTFAsXG4gIC8vIDMgZWFjaCkgYXJlIGFsbCBleGhhdXN0ZWQsIHJlZmlsbCB0aGVtLiBUUCBpcyB0cmFja2VkIHNlcGFyYXRlbHlcbiAgLy8gd2l0aCAxIGNhcmQgcGVyIHNodWZmbGU7IGl0IHJlZmlsbHMgb24gdGhlIHNhbWUgdHJpZ2dlciB0byBhdm9pZFxuICAvLyBhbiBvcnBoYW5lZC1UUCBzdGF0ZSAoaGFuZD1bMCwwLDAsMCwxXSkgd2hlcmUgdGhlIENQVSBpcyBmb3JjZWRcbiAgLy8gdG8gcGljayBUUCBldmVyeSBwbGF5LlxuICBjb25zdCByZWd1bGFyc0V4aGF1c3RlZCA9XG4gICAgaGFuZC5TUiA9PT0gMCAmJiBoYW5kLkxSID09PSAwICYmIGhhbmQuU1AgPT09IDAgJiYgaGFuZC5MUCA9PT0gMDtcblxuICBpZiAocmVndWxhcnNFeGhhdXN0ZWQpIHtcbiAgICByZXR1cm4ge1xuICAgICAgLi4ucGxheWVyLFxuICAgICAgaGFuZDogeyBTUjogMywgTFI6IDMsIFNQOiAzLCBMUDogMywgVFA6IDEsIEhNOiBoYW5kLkhNIH0sXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB7IC4uLnBsYXllciwgaGFuZCB9O1xufVxuIiwgIi8qKlxuICogQmlnIFBsYXkgcmVzb2x1dGlvbiAocnVuLmpzOjE5MzMpLlxuICpcbiAqIFRyaWdnZXJlZCBieTpcbiAqICAgLSBUcmljayBQbGF5IGRpZT01XG4gKiAgIC0gU2FtZSBQbGF5IEtpbmcgb3V0Y29tZVxuICogICAtIE90aGVyIGZ1dHVyZSBob29rc1xuICpcbiAqIFRoZSBiZW5lZmljaWFyeSBhcmd1bWVudCBzYXlzIHdobyBiZW5lZml0cyBcdTIwMTQgdGhpcyBjYW4gYmUgb2ZmZW5zZSBPUlxuICogZGVmZW5zZSAoZGlmZmVyZW50IG91dGNvbWUgdGFibGVzKS5cbiAqXG4gKiBPZmZlbnNpdmUgQmlnIFBsYXkgKG9mZmVuc2UgYmVuZWZpdHMpOlxuICogICBkaWUgMS0zIFx1MjE5MiArMjUgeWFyZHNcbiAqICAgZGllIDQtNSBcdTIxOTIgbWF4KGhhbGYtdG8tZ29hbCwgNDApIHlhcmRzXG4gKiAgIGRpZSA2ICAgXHUyMTkyIFRvdWNoZG93blxuICpcbiAqIERlZmVuc2l2ZSBCaWcgUGxheSAoZGVmZW5zZSBiZW5lZml0cyk6XG4gKiAgIGRpZSAxLTMgXHUyMTkyIDEwLXlhcmQgcGVuYWx0eSBvbiBvZmZlbnNlIChyZXBlYXQgZG93biksIGhhbGYtdG8tZ29hbCBpZiB0aWdodFxuICogICBkaWUgNC01IFx1MjE5MiBGVU1CTEUgXHUyMTkyIHR1cm5vdmVyICsgZGVmZW5zZSByZXR1cm5zIG1heChoYWxmLCAyNSlcbiAqICAgZGllIDYgICBcdTIxOTIgRlVNQkxFIFx1MjE5MiBkZWZlbnNpdmUgVERcbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgUGxheWVySWQgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi8uLi9zdGF0ZS5qc1wiO1xuaW1wb3J0IHtcbiAgYXBwbHlTYWZldHksXG4gIGFwcGx5VG91Y2hkb3duLFxuICBibGFua1BpY2ssXG4gIGJ1bXBTdGF0cyxcbiAgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbixcbn0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlQmlnUGxheShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgYmVuZWZpY2lhcnk6IFBsYXllcklkLFxuICBybmc6IFJuZyxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGRpZSA9IHJuZy5kNigpO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbeyB0eXBlOiBcIkJJR19QTEFZXCIsIGJlbmVmaWNpYXJ5LCBzdWJyb2xsOiBkaWUgfV07XG5cbiAgaWYgKGJlbmVmaWNpYXJ5ID09PSBvZmZlbnNlKSB7XG4gICAgcmV0dXJuIG9mZmVuc2l2ZUJpZ1BsYXkoc3RhdGUsIG9mZmVuc2UsIGRpZSwgZXZlbnRzKTtcbiAgfVxuICByZXR1cm4gZGVmZW5zaXZlQmlnUGxheShzdGF0ZSwgb2ZmZW5zZSwgZGllLCBldmVudHMpO1xufVxuXG5mdW5jdGlvbiBvZmZlbnNpdmVCaWdQbGF5KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBvZmZlbnNlOiBQbGF5ZXJJZCxcbiAgZGllOiAxIHwgMiB8IDMgfCA0IHwgNSB8IDYsXG4gIGV2ZW50czogRXZlbnRbXSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgaWYgKGRpZSA9PT0gNikge1xuICAgIHJldHVybiBhcHBseVRvdWNoZG93bihzdGF0ZSwgb2ZmZW5zZSwgZXZlbnRzKTtcbiAgfVxuXG4gIC8vIGRpZSAxLTM6ICsyNTsgZGllIDQtNTogbWF4KGhhbGYtdG8tZ29hbCwgNDApXG4gIGxldCBnYWluOiBudW1iZXI7XG4gIGlmIChkaWUgPD0gMykge1xuICAgIGdhaW4gPSAyNTtcbiAgfSBlbHNlIHtcbiAgICBjb25zdCBoYWxmVG9Hb2FsID0gTWF0aC5yb3VuZCgoMTAwIC0gc3RhdGUuZmllbGQuYmFsbE9uKSAvIDIpO1xuICAgIGdhaW4gPSBoYWxmVG9Hb2FsID4gNDAgPyBoYWxmVG9Hb2FsIDogNDA7XG4gIH1cblxuICBjb25zdCBwcm9qZWN0ZWQgPSBzdGF0ZS5maWVsZC5iYWxsT24gKyBnYWluO1xuICBpZiAocHJvamVjdGVkID49IDEwMCkge1xuICAgIHJldHVybiBhcHBseVRvdWNoZG93bihzdGF0ZSwgb2ZmZW5zZSwgZXZlbnRzKTtcbiAgfVxuXG4gIC8vIEFwcGx5IGdhaW4sIGNoZWNrIGZvciBmaXJzdCBkb3duLlxuICBjb25zdCByZWFjaGVkRmlyc3REb3duID0gcHJvamVjdGVkID49IHN0YXRlLmZpZWxkLmZpcnN0RG93bkF0O1xuICBjb25zdCBuZXh0RG93biA9IHJlYWNoZWRGaXJzdERvd24gPyAxIDogc3RhdGUuZmllbGQuZG93bjtcbiAgY29uc3QgbmV4dEZpcnN0RG93bkF0ID0gcmVhY2hlZEZpcnN0RG93blxuICAgID8gTWF0aC5taW4oMTAwLCBwcm9qZWN0ZWQgKyAxMClcbiAgICA6IHN0YXRlLmZpZWxkLmZpcnN0RG93bkF0O1xuXG4gIGlmIChyZWFjaGVkRmlyc3REb3duKSBldmVudHMucHVzaCh7IHR5cGU6IFwiRklSU1RfRE9XTlwiIH0pO1xuXG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgLi4uc3RhdGUuZmllbGQsXG4gICAgICAgIGJhbGxPbjogcHJvamVjdGVkLFxuICAgICAgICBkb3duOiBuZXh0RG93bixcbiAgICAgICAgZmlyc3REb3duQXQ6IG5leHRGaXJzdERvd25BdCxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGRlZmVuc2l2ZUJpZ1BsYXkoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIG9mZmVuc2U6IFBsYXllcklkLFxuICBkaWU6IDEgfCAyIHwgMyB8IDQgfCA1IHwgNixcbiAgZXZlbnRzOiBFdmVudFtdLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICAvLyAxLTM6IDEwLXlhcmQgcGVuYWx0eSwgcmVwZWF0IGRvd24gKG5vIGRvd24gY29uc3VtZWQpLlxuICBpZiAoZGllIDw9IDMpIHtcbiAgICBjb25zdCBuYWl2ZVBlbmFsdHkgPSAtMTA7XG4gICAgY29uc3QgaGFsZlRvR29hbCA9IC1NYXRoLmZsb29yKHN0YXRlLmZpZWxkLmJhbGxPbiAvIDIpO1xuICAgIGNvbnN0IHBlbmFsdHlZYXJkcyA9XG4gICAgICBzdGF0ZS5maWVsZC5iYWxsT24gLSAxMCA8IDEgPyBoYWxmVG9Hb2FsIDogbmFpdmVQZW5hbHR5O1xuXG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlBFTkFMVFlcIiwgYWdhaW5zdDogb2ZmZW5zZSwgeWFyZHM6IHBlbmFsdHlZYXJkcywgbG9zc09mRG93bjogZmFsc2UgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgLi4uc3RhdGUuZmllbGQsXG4gICAgICAgICAgYmFsbE9uOiBNYXRoLm1heCgwLCBzdGF0ZS5maWVsZC5iYWxsT24gKyBwZW5hbHR5WWFyZHMpLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gNC01OiB0dXJub3ZlciB3aXRoIHJldHVybiBvZiBtYXgoaGFsZiwgMjUpLiA2OiBkZWZlbnNpdmUgVEQuXG4gIGNvbnN0IGRlZmVuZGVyID0gb3BwKG9mZmVuc2UpO1xuXG4gIGlmIChkaWUgPT09IDYpIHtcbiAgICAvLyBEZWZlbnNlIHNjb3JlcyB0aGUgVEQuXG4gICAgbGV0IG5ld1BsYXllcnMgPSB7XG4gICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgW2RlZmVuZGVyXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW2RlZmVuZGVyXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbZGVmZW5kZXJdLnNjb3JlICsgNiB9LFxuICAgIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgICBuZXdQbGF5ZXJzID0gYnVtcFN0YXRzKG5ld1BsYXllcnMsIG9mZmVuc2UsIHsgdHVybm92ZXJzOiAxIH0pO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiZnVtYmxlXCIgfSk7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRPVUNIRE9XTlwiLCBzY29yaW5nUGxheWVyOiBkZWZlbmRlciB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgcGhhc2U6IFwiUEFUX0NIT0lDRVwiLFxuICAgICAgICBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogZGVmZW5kZXIgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIGRpZSA0LTU6IHR1cm5vdmVyIHdpdGggcmV0dXJuLlxuICBjb25zdCBoYWxmVG9Hb2FsID0gTWF0aC5yb3VuZCgoMTAwIC0gc3RhdGUuZmllbGQuYmFsbE9uKSAvIDIpO1xuICBjb25zdCByZXR1cm5ZYXJkcyA9IGhhbGZUb0dvYWwgPiAyNSA/IGhhbGZUb0dvYWwgOiAyNTtcblxuICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcImZ1bWJsZVwiIH0pO1xuICBjb25zdCBwbGF5ZXJzQWZ0ZXJUdXJub3ZlciA9IGJ1bXBTdGF0cyhzdGF0ZS5wbGF5ZXJzLCBvZmZlbnNlLCB7IHR1cm5vdmVyczogMSB9KTtcblxuICAvLyBGLTUwIGZpZGVsaXR5OiB2NS4xIHN0b3JlcyBgZGlzdCA9IHJldHVybllhcmRzYCB0aGVuIGNhbGxzIGNoYW5nZVBvc3MoJ3RvJyksXG4gIC8vIHdoaWNoIG1pcnJvcnMgdGhlIGJhbGwgdG8gZGVmZW5kZXIgUE9WLiBUaGUgcmV0dXJuIGlzIHRoZW4gYXBwbGllZFxuICAvLyBmb3J3YXJkIGluIGRlZmVuZGVyIFBPViAoYHNwb3QgKz0gZGlzdGApLiBFcXVpdmFsZW50OiBkZWZlbmRlciBzdGFydHMgYXRcbiAgLy8gYDEwMCAtIGJhbGxPbmAgKHRoZWlyIG93biBQT1YpIGFuZCBhZHZhbmNlcyBgcmV0dXJuWWFyZHNgIHRvd2FyZCB0aGVpciBnb2FsLlxuICBjb25zdCBuZXdPZmZlbnNlU3RhcnQgPSAxMDAgLSBzdGF0ZS5maWVsZC5iYWxsT247XG4gIGNvbnN0IGZpbmFsQmFsbE9uID0gbmV3T2ZmZW5zZVN0YXJ0ICsgcmV0dXJuWWFyZHM7XG5cbiAgaWYgKGZpbmFsQmFsbE9uID49IDEwMCkge1xuICAgIC8vIFJldHVybmVkIGFsbCB0aGUgd2F5IFx1MjAxNCBURCBmb3IgZGVmZW5kZXIuXG4gICAgY29uc3QgcGxheWVyc1dpdGhTY29yZSA9IHtcbiAgICAgIC4uLnBsYXllcnNBZnRlclR1cm5vdmVyLFxuICAgICAgW2RlZmVuZGVyXTogeyAuLi5wbGF5ZXJzQWZ0ZXJUdXJub3ZlcltkZWZlbmRlcl0sIHNjb3JlOiBwbGF5ZXJzQWZ0ZXJUdXJub3ZlcltkZWZlbmRlcl0uc2NvcmUgKyA2IH0sXG4gICAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUT1VDSERPV05cIiwgc2NvcmluZ1BsYXllcjogZGVmZW5kZXIgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwbGF5ZXJzOiBwbGF5ZXJzV2l0aFNjb3JlLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIHBoYXNlOiBcIlBBVF9DSE9JQ0VcIixcbiAgICAgICAgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IGRlZmVuZGVyIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cbiAgaWYgKGZpbmFsQmFsbE9uIDw9IDApIHtcbiAgICByZXR1cm4gYXBwbHlTYWZldHkoeyAuLi5zdGF0ZSwgcGxheWVyczogcGxheWVyc0FmdGVyVHVybm92ZXIgfSwgb2ZmZW5zZSwgZXZlbnRzKTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGxheWVyczogcGxheWVyc0FmdGVyVHVybm92ZXIsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IGZpbmFsQmFsbE9uLFxuICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBmaW5hbEJhbGxPbiArIDEwKSxcbiAgICAgICAgZG93bjogMSxcbiAgICAgICAgb2ZmZW5zZTogZGVmZW5kZXIsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuIiwgIi8qKlxuICogUHVudCAocnVuLmpzOjIwOTApLiBBbHNvIHNlcnZlcyBmb3Igc2FmZXR5IGtpY2tzLlxuICpcbiAqIFNlcXVlbmNlIChhbGwgcmFuZG9tbmVzcyB0aHJvdWdoIHJuZyk6XG4gKiAgIDEuIEJsb2NrIGNoZWNrOiBpZiBpbml0aWFsIGQ2IGlzIDYsIHJvbGwgYWdhaW4gXHUyMDE0IDItc2l4ZXMgPSBibG9ja2VkICgxLzM2KS5cbiAqICAgMi4gSWYgbm90IGJsb2NrZWQsIGRyYXcgeWFyZHMgY2FyZCArIGNvaW4gZmxpcDpcbiAqICAgICAgICBraWNrRGlzdCA9IDEwICogeWFyZHNDYXJkIC8gMiArIDIwICogKGNvaW49aGVhZHMgPyAxIDogMClcbiAqICAgICAgUmVzdWx0aW5nIHJhbmdlOiBbNSwgNzBdIHlhcmRzLlxuICogICAzLiBJZiBiYWxsIGxhbmRzIHBhc3QgMTAwIFx1MjE5MiB0b3VjaGJhY2ssIHBsYWNlIGF0IHJlY2VpdmVyJ3MgMjAuXG4gKiAgIDQuIE11ZmYgY2hlY2sgKG5vdCBvbiB0b3VjaGJhY2svYmxvY2svc2FmZXR5IGtpY2spOiAyLXNpeGVzID0gcmVjZWl2ZXJcbiAqICAgICAgbXVmZnMsIGtpY2tpbmcgdGVhbSByZWNvdmVycy5cbiAqICAgNS4gUmV0dXJuOiBpZiBwb3NzZXNzaW9uLCBkcmF3IG11bHRDYXJkICsgeWFyZHMuXG4gKiAgICAgICAgS2luZz03eCwgUXVlZW49NHgsIEphY2s9MXgsIDEwPS0wLjV4XG4gKiAgICAgICAgcmV0dXJuID0gcm91bmQobXVsdCAqIHlhcmRzQ2FyZClcbiAqICAgICAgUmV0dXJuIGNhbiBzY29yZSBURCBvciBjb25jZWRlIHNhZmV0eS5cbiAqXG4gKiBGb3IgdGhlIGVuZ2luZSBwb3J0OiB0aGlzIGlzIHRoZSBtb3N0IHByb2NlZHVyYWwgb2YgdGhlIHNwZWNpYWxzLiBXZVxuICogY29sbGVjdCBldmVudHMgaW4gb3JkZXIgYW5kIHByb2R1Y2Ugb25lIGZpbmFsIHN0YXRlLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7IGRyYXdNdWx0aXBsaWVyLCBkcmF3WWFyZHMgfSBmcm9tIFwiLi4vZGVjay5qc1wiO1xuaW1wb3J0IHtcbiAgYXBwbHlTYWZldHksXG4gIGFwcGx5VG91Y2hkb3duLFxuICBibGFua1BpY2ssXG4gIHR5cGUgU3BlY2lhbFJlc29sdXRpb24sXG59IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5jb25zdCBSRVRVUk5fTVVMVElQTElFUlM6IFJlY29yZDxcIktpbmdcIiB8IFwiUXVlZW5cIiB8IFwiSmFja1wiIHwgXCIxMFwiLCBudW1iZXI+ID0ge1xuICBLaW5nOiA3LFxuICBRdWVlbjogNCxcbiAgSmFjazogMSxcbiAgXCIxMFwiOiAtMC41LFxufTtcblxuZXhwb3J0IGludGVyZmFjZSBQdW50T3B0aW9ucyB7XG4gIC8qKiB0cnVlIGlmIHRoaXMgaXMgYSBzYWZldHkga2ljayAobm8gYmxvY2svbXVmZiBjaGVja3MpLiAqL1xuICBzYWZldHlLaWNrPzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVQdW50KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBybmc6IFJuZyxcbiAgb3B0czogUHVudE9wdGlvbnMgPSB7fSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGRlZmVuZGVyID0gb3BwKG9mZmVuc2UpO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcbiAgbGV0IGRlY2sgPSBzdGF0ZS5kZWNrO1xuXG4gIC8vIEJsb2NrIGNoZWNrIChub3Qgb24gc2FmZXR5IGtpY2spLlxuICBsZXQgYmxvY2tlZCA9IGZhbHNlO1xuICBpZiAoIW9wdHMuc2FmZXR5S2ljaykge1xuICAgIGlmIChybmcuZDYoKSA9PT0gNiAmJiBybmcuZDYoKSA9PT0gNikge1xuICAgICAgYmxvY2tlZCA9IHRydWU7XG4gICAgfVxuICB9XG5cbiAgaWYgKGJsb2NrZWQpIHtcbiAgICAvLyBLaWNraW5nIHRlYW0gbG9zZXMgcG9zc2Vzc2lvbiBhdCB0aGUgbGluZSBvZiBzY3JpbW1hZ2UuXG4gICAgY29uc3QgbWlycm9yZWRCYWxsT24gPSAxMDAgLSBzdGF0ZS5maWVsZC5iYWxsT247XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlBVTlRcIiwgcGxheWVyOiBvZmZlbnNlLCBsYW5kaW5nU3BvdDogc3RhdGUuZmllbGQuYmFsbE9uIH0pO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiZnVtYmxlXCIgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgYmFsbE9uOiBtaXJyb3JlZEJhbGxPbixcbiAgICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBtaXJyb3JlZEJhbGxPbiArIDEwKSxcbiAgICAgICAgICBkb3duOiAxLFxuICAgICAgICAgIG9mZmVuc2U6IGRlZmVuZGVyLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gRHJhdyB5YXJkcyArIGNvaW4gZm9yIGtpY2sgZGlzdGFuY2UuXG4gIGNvbnN0IGNvaW4gPSBybmcuY29pbkZsaXAoKTtcbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKGRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuICBkZWNrID0geWFyZHNEcmF3LmRlY2s7XG5cbiAgY29uc3Qga2lja0Rpc3QgPSAoMTAgKiB5YXJkc0RyYXcuY2FyZCkgLyAyICsgKGNvaW4gPT09IFwiaGVhZHNcIiA/IDIwIDogMCk7XG4gIGNvbnN0IGxhbmRpbmdTcG90ID0gc3RhdGUuZmllbGQuYmFsbE9uICsga2lja0Rpc3Q7XG4gIGNvbnN0IHRvdWNoYmFjayA9IGxhbmRpbmdTcG90ID4gMTAwO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiUFVOVFwiLCBwbGF5ZXI6IG9mZmVuc2UsIGxhbmRpbmdTcG90IH0pO1xuXG4gIC8vIE11ZmYgY2hlY2sgKG5vdCBvbiB0b3VjaGJhY2ssIGJsb2NrLCBzYWZldHkga2ljaykuXG4gIGxldCBtdWZmZWQgPSBmYWxzZTtcbiAgaWYgKCF0b3VjaGJhY2sgJiYgIW9wdHMuc2FmZXR5S2ljaykge1xuICAgIGlmIChybmcuZDYoKSA9PT0gNiAmJiBybmcuZDYoKSA9PT0gNikge1xuICAgICAgbXVmZmVkID0gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICBpZiAobXVmZmVkKSB7XG4gICAgLy8gUmVjZWl2ZXIgbXVmZnMsIGtpY2tpbmcgdGVhbSByZWNvdmVycyB3aGVyZSB0aGUgYmFsbCBsYW5kZWQuXG4gICAgLy8gS2lja2luZyB0ZWFtIHJldGFpbnMgcG9zc2Vzc2lvbiAoc3RpbGwgb2ZmZW5zZSkuXG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJmdW1ibGVcIiB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIGRlY2ssXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICBiYWxsT246IE1hdGgubWluKDk5LCBsYW5kaW5nU3BvdCksXG4gICAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgbGFuZGluZ1Nwb3QgKyAxMCksXG4gICAgICAgICAgZG93bjogMSxcbiAgICAgICAgICBvZmZlbnNlLCAvLyBraWNrZXIgcmV0YWluc1xuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gVG91Y2hiYWNrOiByZWNlaXZlciBnZXRzIGJhbGwgYXQgdGhlaXIgb3duIDIwICg9IDgwIGZyb20gdGhlaXIgcGVyc3BlY3RpdmUsXG4gIC8vIGJ1dCBiYWxsIHBvc2l0aW9uIGlzIHRyYWNrZWQgZnJvbSBvZmZlbnNlIFBPViwgc28gZm9yIHRoZSBORVcgb2ZmZW5zZSB0aGF0XG4gIC8vIGlzIDEwMC04MCA9IDIwKS5cbiAgaWYgKHRvdWNoYmFjaykge1xuICAgIGNvbnN0IHN0YXRlQWZ0ZXJLaWNrOiBHYW1lU3RhdGUgPSB7IC4uLnN0YXRlLCBkZWNrIH07XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlQWZ0ZXJLaWNrLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgYmFsbE9uOiAyMCxcbiAgICAgICAgICBmaXJzdERvd25BdDogMzAsXG4gICAgICAgICAgZG93bjogMSxcbiAgICAgICAgICBvZmZlbnNlOiBkZWZlbmRlcixcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIE5vcm1hbCBwdW50IHJldHVybjogZHJhdyBtdWx0Q2FyZCArIHlhcmRzLiBSZXR1cm4gbWVhc3VyZWQgZnJvbSBsYW5kaW5nU3BvdC5cbiAgY29uc3QgbXVsdERyYXcgPSBkcmF3TXVsdGlwbGllcihkZWNrLCBybmcpO1xuICBpZiAobXVsdERyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJtdWx0aXBsaWVyXCIgfSk7XG4gIGRlY2sgPSBtdWx0RHJhdy5kZWNrO1xuXG4gIGNvbnN0IHJldHVybkRyYXcgPSBkcmF3WWFyZHMoZGVjaywgcm5nKTtcbiAgaWYgKHJldHVybkRyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuICBkZWNrID0gcmV0dXJuRHJhdy5kZWNrO1xuXG4gIGNvbnN0IG11bHQgPSBSRVRVUk5fTVVMVElQTElFUlNbbXVsdERyYXcuY2FyZF07XG4gIGNvbnN0IHJldHVybllhcmRzID0gTWF0aC5yb3VuZChtdWx0ICogcmV0dXJuRHJhdy5jYXJkKTtcblxuICAvLyBCYWxsIGVuZHMgdXAgYXQgbGFuZGluZ1Nwb3QgLSByZXR1cm5ZYXJkcyAoZnJvbSBraWNraW5nIHRlYW0ncyBQT1YpLlxuICAvLyBFcXVpdmFsZW50bHksIGZyb20gdGhlIHJlY2VpdmluZyB0ZWFtJ3MgUE9WOiAoMTAwIC0gbGFuZGluZ1Nwb3QpICsgcmV0dXJuWWFyZHMuXG4gIGNvbnN0IHJlY2VpdmVyQmFsbE9uID0gMTAwIC0gbGFuZGluZ1Nwb3QgKyByZXR1cm5ZYXJkcztcblxuICBjb25zdCBzdGF0ZUFmdGVyUmV0dXJuOiBHYW1lU3RhdGUgPSB7IC4uLnN0YXRlLCBkZWNrIH07XG5cbiAgLy8gUmV0dXJuIFREIFx1MjAxNCByZWNlaXZlciBzY29yZXMuXG4gIGlmIChyZWNlaXZlckJhbGxPbiA+PSAxMDApIHtcbiAgICBjb25zdCByZWNlaXZlckJhbGxDbGFtcGVkID0gMTAwO1xuICAgIHZvaWQgcmVjZWl2ZXJCYWxsQ2xhbXBlZDtcbiAgICByZXR1cm4gYXBwbHlUb3VjaGRvd24oXG4gICAgICB7IC4uLnN0YXRlQWZ0ZXJSZXR1cm4sIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiBkZWZlbmRlciB9IH0sXG4gICAgICBkZWZlbmRlcixcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgLy8gUmV0dXJuIHNhZmV0eSBcdTIwMTQgcmVjZWl2ZXIgdGFja2xlZCBpbiB0aGVpciBvd24gZW5kem9uZSAoY2FuJ3QgYWN0dWFsbHlcbiAgLy8gaGFwcGVuIGZyb20gYSBuZWdhdGl2ZS1yZXR1cm4teWFyZGFnZSBzdGFuZHBvaW50IGluIHY1LjEgc2luY2Ugc3RhcnQgaXNcbiAgLy8gMTAwLWxhbmRpbmdTcG90IHdoaWNoIGlzID4gMCwgYnV0IG1vZGVsIGl0IGFueXdheSBmb3IgY29tcGxldGVuZXNzKS5cbiAgaWYgKHJlY2VpdmVyQmFsbE9uIDw9IDApIHtcbiAgICByZXR1cm4gYXBwbHlTYWZldHkoXG4gICAgICB7IC4uLnN0YXRlQWZ0ZXJSZXR1cm4sIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiBkZWZlbmRlciB9IH0sXG4gICAgICBkZWZlbmRlcixcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGVBZnRlclJldHVybixcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogcmVjZWl2ZXJCYWxsT24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIHJlY2VpdmVyQmFsbE9uICsgMTApLFxuICAgICAgICBkb3duOiAxLFxuICAgICAgICBvZmZlbnNlOiBkZWZlbmRlcixcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBLaWNrb2ZmLiB2NiByZXN0b3JlcyB2NS4xJ3Mga2ljay10eXBlIC8gcmV0dXJuLXR5cGUgcGlja3MuXG4gKlxuICogVGhlIGtpY2tlciAoc3RhdGUuZmllbGQub2ZmZW5zZSkgY2hvb3NlcyBvbmUgb2Y6XG4gKiAgIFJLIFx1MjAxNCBSZWd1bGFyIEtpY2s6IGxvbmcga2ljaywgbXVsdCt5YXJkcyByZXR1cm5cbiAqICAgT0sgXHUyMDE0IE9uc2lkZSBLaWNrOiAgc2hvcnQga2ljaywgMS1pbi02IHJlY292ZXJ5IHJvbGwgKDEtaW4tMTIgdnMgT1IpXG4gKiAgIFNLIFx1MjAxNCBTcXVpYiBLaWNrOiAgIG1lZGl1bSBraWNrLCAyZDYgcmV0dXJuIGlmIHJlY2VpdmVyIGNob3NlIFJSXG4gKlxuICogVGhlIHJldHVybmVyIGNob29zZXMgb25lIG9mOlxuICogICBSUiBcdTIwMTQgUmVndWxhciBSZXR1cm46IG5vcm1hbCByZXR1cm5cbiAqICAgT1IgXHUyMDE0IE9uc2lkZSBjb3VudGVyOiBkZWZlbmRzIHRoZSBvbnNpZGUgKGhhcmRlciBmb3Iga2lja2VyIHRvIHJlY292ZXIpXG4gKiAgIFRCIFx1MjAxNCBUb3VjaGJhY2s6ICAgICAgdGFrZSB0aGUgYmFsbCBhdCB0aGUgMjVcbiAqXG4gKiBTYWZldHkga2lja3MgKHN0YXRlLmlzU2FmZXR5S2ljaz10cnVlKSBza2lwIHRoZSBwaWNrcyBhbmQgdXNlIHRoZVxuICogZXhpc3Rpbmcgc2ltcGxpZmllZCBwdW50IHBhdGguXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIEtpY2tUeXBlLCBSZXR1cm5UeXBlIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7IGRyYXdNdWx0aXBsaWVyLCBkcmF3WWFyZHMgfSBmcm9tIFwiLi4vZGVjay5qc1wiO1xuaW1wb3J0IHsgcmVzb2x2ZVB1bnQgfSBmcm9tIFwiLi9wdW50LmpzXCI7XG5pbXBvcnQge1xuICBhcHBseVNhZmV0eSxcbiAgYXBwbHlUb3VjaGRvd24sXG4gIGJsYW5rUGljayxcbiAgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbixcbn0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmNvbnN0IEtJQ0tPRkZfTVVMVElQTElFUlM6IFJlY29yZDxcIktpbmdcIiB8IFwiUXVlZW5cIiB8IFwiSmFja1wiIHwgXCIxMFwiLCBudW1iZXI+ID0ge1xuICBLaW5nOiAxMCxcbiAgUXVlZW46IDUsXG4gIEphY2s6IDEsXG4gIFwiMTBcIjogMCxcbn07XG5cbmV4cG9ydCBpbnRlcmZhY2UgS2lja29mZk9wdGlvbnMge1xuICBraWNrVHlwZT86IEtpY2tUeXBlO1xuICByZXR1cm5UeXBlPzogUmV0dXJuVHlwZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVLaWNrb2ZmKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBybmc6IFJuZyxcbiAgb3B0czogS2lja29mZk9wdGlvbnMgPSB7fSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qga2lja2VyID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgcmVjZWl2ZXIgPSBvcHAoa2lja2VyKTtcblxuICAvLyBTYWZldHkta2ljayBwYXRoOiB2NS4xIGNhcnZlLW91dCB0cmVhdHMgaXQgbGlrZSBhIHB1bnQgZnJvbSB0aGUgMzUuXG4gIC8vIE5vIHBpY2tzIGFyZSBwcm9tcHRlZCBmb3IsIHNvIGBraWNrVHlwZWAgd2lsbCBiZSB1bmRlZmluZWQgaGVyZS5cbiAgaWYgKHN0YXRlLmlzU2FmZXR5S2ljayB8fCAhb3B0cy5raWNrVHlwZSkge1xuICAgIGNvbnN0IGtpY2tpbmdTdGF0ZTogR2FtZVN0YXRlID0ge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgYmFsbE9uOiAzNSB9LFxuICAgIH07XG4gICAgY29uc3QgcmVzdWx0ID0gcmVzb2x2ZVB1bnQoa2lja2luZ1N0YXRlLCBybmcsIHsgc2FmZXR5S2ljazogdHJ1ZSB9KTtcbiAgICAvLyBGLTU0OiBhIHJldHVybiBURCBvbiB0aGUgc2FmZXR5IGtpY2sgbWVhbnMgcmVzb2x2ZVB1bnQgc2V0IHBoYXNlIHRvXG4gICAgLy8gUEFUX0NIT0lDRSB2aWEgYXBwbHlUb3VjaGRvd24uIFByZXNlcnZlIHNjb3JpbmcgcGhhc2VzOyBvbmx5IGZhbGxcbiAgICAvLyB0aHJvdWdoIHRvIFJFR19QTEFZIHdoZW4gdGhlIGtpY2sgcHJvZHVjZWQgYSBub3JtYWwgbmV3IHBvc3Nlc3Npb24uXG4gICAgY29uc3QgcHJlc2VydmUgPSByZXN1bHQuc3RhdGUucGhhc2UgPT09IFwiUEFUX0NIT0lDRVwiIHx8XG4gICAgICByZXN1bHQuc3RhdGUucGhhc2UgPT09IFwiVFdPX1BUX0NPTlZcIjtcbiAgICBjb25zdCBwaGFzZSA9IHByZXNlcnZlID8gcmVzdWx0LnN0YXRlLnBoYXNlIDogXCJSRUdfUExBWVwiO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZTogeyAuLi5yZXN1bHQuc3RhdGUsIHBoYXNlLCBpc1NhZmV0eUtpY2s6IGZhbHNlIH0sXG4gICAgICBldmVudHM6IHJlc3VsdC5ldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIGNvbnN0IHsga2lja1R5cGUsIHJldHVyblR5cGUgfSA9IG9wdHM7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiS0lDS19UWVBFX0NIT1NFTlwiLCBwbGF5ZXI6IGtpY2tlciwgY2hvaWNlOiBraWNrVHlwZSB9KTtcbiAgaWYgKHJldHVyblR5cGUpIHtcbiAgICBldmVudHMucHVzaCh7XG4gICAgICB0eXBlOiBcIlJFVFVSTl9UWVBFX0NIT1NFTlwiLFxuICAgICAgcGxheWVyOiByZWNlaXZlcixcbiAgICAgIGNob2ljZTogcmV0dXJuVHlwZSxcbiAgICB9KTtcbiAgfVxuXG4gIGlmIChraWNrVHlwZSA9PT0gXCJSS1wiKSB7XG4gICAgcmV0dXJuIHJlc29sdmVSZWd1bGFyS2ljayhzdGF0ZSwgcm5nLCBldmVudHMsIGtpY2tlciwgcmVjZWl2ZXIsIHJldHVyblR5cGUpO1xuICB9XG4gIGlmIChraWNrVHlwZSA9PT0gXCJPS1wiKSB7XG4gICAgcmV0dXJuIHJlc29sdmVPbnNpZGVLaWNrKHN0YXRlLCBybmcsIGV2ZW50cywga2lja2VyLCByZWNlaXZlciwgcmV0dXJuVHlwZSk7XG4gIH1cbiAgcmV0dXJuIHJlc29sdmVTcXVpYktpY2soc3RhdGUsIHJuZywgZXZlbnRzLCBraWNrZXIsIHJlY2VpdmVyLCByZXR1cm5UeXBlKTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZVJlZ3VsYXJLaWNrKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBybmc6IFJuZyxcbiAgZXZlbnRzOiBFdmVudFtdLFxuICBraWNrZXI6IEdhbWVTdGF0ZVtcImZpZWxkXCJdW1wib2ZmZW5zZVwiXSxcbiAgcmVjZWl2ZXI6IEdhbWVTdGF0ZVtcImZpZWxkXCJdW1wib2ZmZW5zZVwiXSxcbiAgcmV0dXJuVHlwZTogUmV0dXJuVHlwZSB8IHVuZGVmaW5lZCxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgLy8gUmV0dXJuZXIgY2hvc2UgdG91Y2hiYWNrIChvciBtaXNtYXRjaGVkIE9SKTogYmFsbCBhdCB0aGUgcmVjZWl2ZXIncyAyNS5cbiAgaWYgKHJldHVyblR5cGUgPT09IFwiVEJcIiB8fCByZXR1cm5UeXBlID09PSBcIk9SXCIpIHtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVE9VQ0hCQUNLXCIsIHJlY2VpdmluZ1BsYXllcjogcmVjZWl2ZXIgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwaGFzZTogXCJSRUdfUExBWVwiLFxuICAgICAgICBpc1NhZmV0eUtpY2s6IGZhbHNlLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgYmFsbE9uOiAyNSxcbiAgICAgICAgICBmaXJzdERvd25BdDogMzUsXG4gICAgICAgICAgZG93bjogMSxcbiAgICAgICAgICBvZmZlbnNlOiByZWNlaXZlcixcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIFJLICsgUlI6IGtpY2sgZGlzdGFuY2UgMzUuLjYwLCB0aGVuIG11bHQreWFyZHMgcmV0dXJuLlxuICBjb25zdCBraWNrUm9sbCA9IHJuZy5kNigpO1xuICBjb25zdCBraWNrWWFyZHMgPSAzNSArIDUgKiAoa2lja1JvbGwgLSAxKTsgLy8gMzUsIDQwLCA0NSwgNTAsIDU1LCA2MCBcdTIwMTQgMzUuLjYwXG4gIGNvbnN0IGtpY2tFbmRGcm9tS2lja2VyID0gMzUgKyBraWNrWWFyZHM7IC8vIDcwLi45NSwgYm91bmRlZCB0byAxMDBcbiAgY29uc3QgYm91bmRlZEVuZCA9IE1hdGgubWluKDEwMCwga2lja0VuZEZyb21LaWNrZXIpO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiS0lDS09GRlwiLCByZWNlaXZpbmdQbGF5ZXI6IHJlY2VpdmVyLCBiYWxsT246IGJvdW5kZWRFbmQsIGtpY2tSb2xsLCBraWNrWWFyZHMgfSk7XG5cbiAgLy8gUmVjZWl2ZXIncyBzdGFydGluZyBiYWxsT24gKHBvc3Nlc3Npb24gZmxpcHBlZCkuXG4gIGNvbnN0IHJlY2VpdmVyU3RhcnQgPSAxMDAgLSBib3VuZGVkRW5kOyAvLyAwLi4zMFxuXG4gIGxldCBkZWNrID0gc3RhdGUuZGVjaztcbiAgY29uc3QgbXVsdERyYXcgPSBkcmF3TXVsdGlwbGllcihkZWNrLCBybmcpO1xuICBpZiAobXVsdERyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJtdWx0aXBsaWVyXCIgfSk7XG4gIGRlY2sgPSBtdWx0RHJhdy5kZWNrO1xuXG4gIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhkZWNrLCBybmcpO1xuICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcbiAgZGVjayA9IHlhcmRzRHJhdy5kZWNrO1xuXG4gIGNvbnN0IG11bHQgPSBLSUNLT0ZGX01VTFRJUExJRVJTW211bHREcmF3LmNhcmRdO1xuICBjb25zdCByZXRZYXJkcyA9IG11bHQgKiB5YXJkc0RyYXcuY2FyZDtcbiAgaWYgKHJldFlhcmRzICE9PSAwKSB7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIktJQ0tPRkZfUkVUVVJOXCIsIHJldHVybmVyUGxheWVyOiByZWNlaXZlciwgeWFyZHM6IHJldFlhcmRzIH0pO1xuICB9XG5cbiAgY29uc3QgZmluYWxCYWxsT24gPSByZWNlaXZlclN0YXJ0ICsgcmV0WWFyZHM7XG5cbiAgaWYgKGZpbmFsQmFsbE9uID49IDEwMCkge1xuICAgIHJldHVybiBhcHBseVRvdWNoZG93bihcbiAgICAgIHsgLi4uc3RhdGUsIGRlY2ssIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiByZWNlaXZlciB9LCBpc1NhZmV0eUtpY2s6IGZhbHNlIH0sXG4gICAgICByZWNlaXZlcixcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG4gIGlmIChmaW5hbEJhbGxPbiA8PSAwKSB7XG4gICAgLy8gUmV0dXJuIGJhY2t3YXJkIGludG8gb3duIGVuZCB6b25lIFx1MjAxNCB1bmxpa2VseSB3aXRoIHY1LjEgbXVsdGlwbGllcnMgYnV0IG1vZGVsIGl0LlxuICAgIHJldHVybiBhcHBseVNhZmV0eShcbiAgICAgIHsgLi4uc3RhdGUsIGRlY2ssIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiByZWNlaXZlciB9LCBpc1NhZmV0eUtpY2s6IGZhbHNlIH0sXG4gICAgICByZWNlaXZlcixcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBkZWNrLFxuICAgICAgcGhhc2U6IFwiUkVHX1BMQVlcIixcbiAgICAgIGlzU2FmZXR5S2ljazogZmFsc2UsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IGZpbmFsQmFsbE9uLFxuICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBmaW5hbEJhbGxPbiArIDEwKSxcbiAgICAgICAgZG93bjogMSxcbiAgICAgICAgb2ZmZW5zZTogcmVjZWl2ZXIsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG5mdW5jdGlvbiByZXNvbHZlT25zaWRlS2ljayhcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgcm5nOiBSbmcsXG4gIGV2ZW50czogRXZlbnRbXSxcbiAga2lja2VyOiBHYW1lU3RhdGVbXCJmaWVsZFwiXVtcIm9mZmVuc2VcIl0sXG4gIHJlY2VpdmVyOiBHYW1lU3RhdGVbXCJmaWVsZFwiXVtcIm9mZmVuc2VcIl0sXG4gIHJldHVyblR5cGU6IFJldHVyblR5cGUgfCB1bmRlZmluZWQsXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIC8vIFJldHVybmVyJ3MgT1IgY2hvaWNlIGNvcnJlY3RseSByZWFkcyB0aGUgb25zaWRlIFx1MjAxNCBtYWtlcyByZWNvdmVyeSBoYXJkZXIuXG4gIGNvbnN0IG9kZHMgPSByZXR1cm5UeXBlID09PSBcIk9SXCIgPyAxMiA6IDY7XG4gIGNvbnN0IHRtcCA9IHJuZy5pbnRCZXR3ZWVuKDEsIG9kZHMpO1xuICBjb25zdCByZWNvdmVyZWQgPSB0bXAgPT09IDE7XG4gIGNvbnN0IGtpY2tZYXJkcyA9IDEwICsgdG1wOyAvLyBzaG9ydCBraWNrIDExLi4xNiAob3IgMTEuLjIyIHZzIE9SKVxuICBjb25zdCBraWNrRW5kID0gMzUgKyBraWNrWWFyZHM7XG5cbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIktJQ0tPRkZcIiwgcmVjZWl2aW5nUGxheWVyOiByZWNlaXZlciwgYmFsbE9uOiBraWNrRW5kLCBraWNrUm9sbDogdG1wLCBraWNrWWFyZHMgfSk7XG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIk9OU0lERV9LSUNLXCIsXG4gICAgcmVjb3ZlcmVkLFxuICAgIHJlY292ZXJpbmdQbGF5ZXI6IHJlY292ZXJlZCA/IGtpY2tlciA6IHJlY2VpdmVyLFxuICAgIHJvbGw6IHRtcCxcbiAgICBvZGRzLFxuICB9KTtcblxuICBjb25zdCByZXR1cm5Sb2xsID0gcm5nLmQ2KCkgKyB0bXA7IC8vIHY1LjE6IHRtcCArIGQ2XG5cbiAgaWYgKHJlY292ZXJlZCkge1xuICAgIC8vIEtpY2tlciByZXRhaW5zLiB2NS4xIGZsaXBzIHJldHVybiBkaXJlY3Rpb24gXHUyMDE0IG1vZGVscyBcImtpY2tlciByZWNvdmVyc1xuICAgIC8vIHNsaWdodGx5IGJhY2sgb2YgdGhlIGtpY2sgc3BvdC5cIlxuICAgIGNvbnN0IGtpY2tlckJhbGxPbiA9IE1hdGgubWF4KDEsIGtpY2tFbmQgLSByZXR1cm5Sb2xsKTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBoYXNlOiBcIlJFR19QTEFZXCIsXG4gICAgICAgIGlzU2FmZXR5S2ljazogZmFsc2UsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICBiYWxsT246IGtpY2tlckJhbGxPbixcbiAgICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBraWNrZXJCYWxsT24gKyAxMCksXG4gICAgICAgICAgZG93bjogMSxcbiAgICAgICAgICBvZmZlbnNlOiBraWNrZXIsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBSZWNlaXZlciByZWNvdmVycyBhdCB0aGUga2ljayBzcG90LCByZXR1cm5zIGZvcndhcmQuXG4gIGNvbnN0IHJlY2VpdmVyU3RhcnQgPSAxMDAgLSBraWNrRW5kO1xuICBjb25zdCBmaW5hbEJhbGxPbiA9IHJlY2VpdmVyU3RhcnQgKyByZXR1cm5Sb2xsO1xuICBpZiAocmV0dXJuUm9sbCAhPT0gMCkge1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJLSUNLT0ZGX1JFVFVSTlwiLCByZXR1cm5lclBsYXllcjogcmVjZWl2ZXIsIHlhcmRzOiByZXR1cm5Sb2xsIH0pO1xuICB9XG5cbiAgaWYgKGZpbmFsQmFsbE9uID49IDEwMCkge1xuICAgIHJldHVybiBhcHBseVRvdWNoZG93bihcbiAgICAgIHsgLi4uc3RhdGUsIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiByZWNlaXZlciB9LCBpc1NhZmV0eUtpY2s6IGZhbHNlIH0sXG4gICAgICByZWNlaXZlcixcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwaGFzZTogXCJSRUdfUExBWVwiLFxuICAgICAgaXNTYWZldHlLaWNrOiBmYWxzZSxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogZmluYWxCYWxsT24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIGZpbmFsQmFsbE9uICsgMTApLFxuICAgICAgICBkb3duOiAxLFxuICAgICAgICBvZmZlbnNlOiByZWNlaXZlcixcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVTcXVpYktpY2soXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHJuZzogUm5nLFxuICBldmVudHM6IEV2ZW50W10sXG4gIGtpY2tlcjogR2FtZVN0YXRlW1wiZmllbGRcIl1bXCJvZmZlbnNlXCJdLFxuICByZWNlaXZlcjogR2FtZVN0YXRlW1wiZmllbGRcIl1bXCJvZmZlbnNlXCJdLFxuICByZXR1cm5UeXBlOiBSZXR1cm5UeXBlIHwgdW5kZWZpbmVkLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBraWNrUm9sbCA9IHJuZy5kNigpO1xuICBjb25zdCBraWNrWWFyZHMgPSAxNSArIDUgKiBraWNrUm9sbDsgLy8gMjAuLjQ1XG4gIGNvbnN0IGtpY2tFbmQgPSBNYXRoLm1pbigxMDAsIDM1ICsga2lja1lhcmRzKTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIktJQ0tPRkZcIiwgcmVjZWl2aW5nUGxheWVyOiByZWNlaXZlciwgYmFsbE9uOiBraWNrRW5kLCBraWNrUm9sbCwga2lja1lhcmRzIH0pO1xuXG4gIC8vIE9ubHkgcmV0dXJuYWJsZSBpZiByZWNlaXZlciBjaG9zZSBSUjsgb3RoZXJ3aXNlIG5vIHJldHVybi5cbiAgY29uc3QgcmV0WWFyZHMgPSByZXR1cm5UeXBlID09PSBcIlJSXCIgPyBybmcuZDYoKSArIHJuZy5kNigpIDogMDtcbiAgaWYgKHJldFlhcmRzID4gMCkge1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJLSUNLT0ZGX1JFVFVSTlwiLCByZXR1cm5lclBsYXllcjogcmVjZWl2ZXIsIHlhcmRzOiByZXRZYXJkcyB9KTtcbiAgfVxuXG4gIGNvbnN0IHJlY2VpdmVyU3RhcnQgPSAxMDAgLSBraWNrRW5kO1xuICBjb25zdCBmaW5hbEJhbGxPbiA9IHJlY2VpdmVyU3RhcnQgKyByZXRZYXJkcztcblxuICBpZiAoZmluYWxCYWxsT24gPj0gMTAwKSB7XG4gICAgcmV0dXJuIGFwcGx5VG91Y2hkb3duKFxuICAgICAgeyAuLi5zdGF0ZSwgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IHJlY2VpdmVyIH0sIGlzU2FmZXR5S2ljazogZmFsc2UgfSxcbiAgICAgIHJlY2VpdmVyLFxuICAgICAgZXZlbnRzLFxuICAgICk7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBoYXNlOiBcIlJFR19QTEFZXCIsXG4gICAgICBpc1NhZmV0eUtpY2s6IGZhbHNlLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgYmFsbE9uOiBmaW5hbEJhbGxPbixcbiAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgZmluYWxCYWxsT24gKyAxMCksXG4gICAgICAgIGRvd246IDEsXG4gICAgICAgIG9mZmVuc2U6IHJlY2VpdmVyLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cbiIsICIvKipcbiAqIEhhaWwgTWFyeSBvdXRjb21lcyAocnVuLmpzOjIyNDIpLiBEaWUgdmFsdWUgXHUyMTkyIHJlc3VsdCwgZnJvbSBvZmZlbnNlJ3MgUE9WOlxuICogICAxIFx1MjE5MiBCSUcgU0FDSywgLTEwIHlhcmRzXG4gKiAgIDIgXHUyMTkyICsyMCB5YXJkc1xuICogICAzIFx1MjE5MiAgIDAgeWFyZHNcbiAqICAgNCBcdTIxOTIgKzQwIHlhcmRzXG4gKiAgIDUgXHUyMTkyIElOVEVSQ0VQVElPTiAodHVybm92ZXIgYXQgc3BvdClcbiAqICAgNiBcdTIxOTIgVE9VQ0hET1dOXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi8uLi9zdGF0ZS5qc1wiO1xuaW1wb3J0IHtcbiAgYXBwbHlTYWZldHksXG4gIGFwcGx5VG91Y2hkb3duLFxuICBhcHBseVlhcmRhZ2VPdXRjb21lLFxuICBibGFua1BpY2ssXG4gIGJ1bXBTdGF0cyxcbiAgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbixcbn0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlSGFpbE1hcnkoc3RhdGU6IEdhbWVTdGF0ZSwgcm5nOiBSbmcpOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBkaWUgPSBybmcuZDYoKTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW3sgdHlwZTogXCJIQUlMX01BUllfUk9MTFwiLCBvdXRjb21lOiBkaWUgfV07XG5cbiAgLy8gRGVjcmVtZW50IEhNIGNvdW50IHJlZ2FyZGxlc3Mgb2Ygb3V0Y29tZS5cbiAgbGV0IHVwZGF0ZWRQbGF5ZXJzID0ge1xuICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgW29mZmVuc2VdOiB7XG4gICAgICAuLi5zdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLFxuICAgICAgaGFuZDogeyAuLi5zdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLmhhbmQsIEhNOiBNYXRoLm1heCgwLCBzdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLmhhbmQuSE0gLSAxKSB9LFxuICAgIH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcblxuICAvLyBJbnRlcmNlcHRpb24gKGRpZSA1KSBcdTIwMTQgdHVybm92ZXIgYXQgdGhlIHNwb3QsIHBvc3Nlc3Npb24gZmxpcHMuXG4gIGlmIChkaWUgPT09IDUpIHtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcImludGVyY2VwdGlvblwiIH0pO1xuICAgIHVwZGF0ZWRQbGF5ZXJzID0gYnVtcFN0YXRzKHVwZGF0ZWRQbGF5ZXJzLCBvZmZlbnNlLCB7IHR1cm5vdmVyczogMSB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBsYXllcnM6IHVwZGF0ZWRQbGF5ZXJzLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgLi4uc3RhdGUuZmllbGQsXG4gICAgICAgICAgb2ZmZW5zZTogb3BwKG9mZmVuc2UpLFxuICAgICAgICAgIGJhbGxPbjogMTAwIC0gc3RhdGUuZmllbGQuYmFsbE9uLFxuICAgICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbiArIDEwKSxcbiAgICAgICAgICBkb3duOiAxLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gWWFyZGFnZSBvdXRjb21lcyAoZGllIDEtNCwgNikgXHUyMDE0IHBhc3MgeWFyZHMgcmVnYXJkbGVzcyBvZiBURC9zYWZldHkuXG4gIGNvbnN0IHlhcmRzID0gZGllID09PSAxID8gLTEwIDogZGllID09PSAyID8gMjAgOiBkaWUgPT09IDMgPyAwIDogZGllID09PSA0ID8gNDAgOiAwO1xuICAvLyBTYWNrOiBITSBkaWU9MSA9IC0xMCB5ZHMsIGNvdW50IGFzIGEgc2FjayBvbiB0aGUgb2ZmZW5zZS5cbiAgdXBkYXRlZFBsYXllcnMgPSBidW1wU3RhdHModXBkYXRlZFBsYXllcnMsIG9mZmVuc2UsIHtcbiAgICBwYXNzWWFyZHM6IGRpZSA9PT0gNiA/IDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbiA6IHlhcmRzLFxuICAgIHNhY2tzOiBkaWUgPT09IDEgPyAxIDogMCxcbiAgfSk7XG4gIGNvbnN0IHN0YXRlV2l0aEhtOiBHYW1lU3RhdGUgPSB7IC4uLnN0YXRlLCBwbGF5ZXJzOiB1cGRhdGVkUGxheWVycyB9O1xuXG4gIC8vIFRvdWNoZG93biAoZGllIDYpLlxuICBpZiAoZGllID09PSA2KSB7XG4gICAgcmV0dXJuIGFwcGx5VG91Y2hkb3duKHN0YXRlV2l0aEhtLCBvZmZlbnNlLCBldmVudHMpO1xuICB9XG5cbiAgY29uc3QgcHJvamVjdGVkID0gc3RhdGVXaXRoSG0uZmllbGQuYmFsbE9uICsgeWFyZHM7XG5cbiAgaWYgKHByb2plY3RlZCA+PSAxMDApIHJldHVybiBhcHBseVRvdWNoZG93bihzdGF0ZVdpdGhIbSwgb2ZmZW5zZSwgZXZlbnRzKTtcbiAgaWYgKHByb2plY3RlZCA8PSAwKSByZXR1cm4gYXBwbHlTYWZldHkoc3RhdGVXaXRoSG0sIG9mZmVuc2UsIGV2ZW50cyk7XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgIG9mZmVuc2VQbGF5OiBcIkhNXCIsXG4gICAgZGVmZW5zZVBsYXk6IHN0YXRlLnBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5ID8/IFwiU1JcIixcbiAgICBtYXRjaHVwUXVhbGl0eTogMCxcbiAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IFwiMTBcIiwgdmFsdWU6IDAgfSxcbiAgICB5YXJkc0NhcmQ6IDAsXG4gICAgeWFyZHNHYWluZWQ6IHlhcmRzLFxuICAgIG5ld0JhbGxPbjogcHJvamVjdGVkLFxuICB9KTtcblxuICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShzdGF0ZVdpdGhIbSwgeWFyZHMsIGV2ZW50cyk7XG59XG4iLCAiLyoqXG4gKiBTYW1lIFBsYXkgbWVjaGFuaXNtIChydW4uanM6MTg5OSkuXG4gKlxuICogVHJpZ2dlcmVkIHdoZW4gYm90aCB0ZWFtcyBwaWNrIHRoZSBzYW1lIHJlZ3VsYXIgcGxheSBBTkQgYSBjb2luLWZsaXAgbGFuZHNcbiAqIGhlYWRzIChhbHNvIHVuY29uZGl0aW9uYWxseSB3aGVuIGJvdGggcGljayBUcmljayBQbGF5KS4gUnVucyBpdHMgb3duXG4gKiBjb2luICsgbXVsdGlwbGllci1jYXJkIGNoYWluOlxuICpcbiAqICAgbXVsdENhcmQgPSBLaW5nICBcdTIxOTIgQmlnIFBsYXkgKG9mZmVuc2UgaWYgY29pbj1oZWFkcywgZGVmZW5zZSBpZiB0YWlscylcbiAqICAgbXVsdENhcmQgPSBRdWVlbiArIGhlYWRzIFx1MjE5MiBtdWx0aXBsaWVyID0gKzMsIGRyYXcgeWFyZHMgY2FyZFxuICogICBtdWx0Q2FyZCA9IFF1ZWVuICsgdGFpbHMgXHUyMTkyIG11bHRpcGxpZXIgPSAgMCwgbm8geWFyZHMgKGRpc3QgPSAwKVxuICogICBtdWx0Q2FyZCA9IEphY2sgICsgaGVhZHMgXHUyMTkyIG11bHRpcGxpZXIgPSAgMCwgbm8geWFyZHMgKGRpc3QgPSAwKVxuICogICBtdWx0Q2FyZCA9IEphY2sgICsgdGFpbHMgXHUyMTkyIG11bHRpcGxpZXIgPSAtMywgZHJhdyB5YXJkcyBjYXJkXG4gKiAgIG11bHRDYXJkID0gMTAgICAgKyBoZWFkcyBcdTIxOTIgSU5URVJDRVBUSU9OICh0dXJub3ZlciBhdCBzcG90KVxuICogICBtdWx0Q2FyZCA9IDEwICAgICsgdGFpbHMgXHUyMTkyIDAgeWFyZHNcbiAqXG4gKiBOb3RlOiB0aGUgY29pbiBmbGlwIGluc2lkZSB0aGlzIGZ1bmN0aW9uIGlzIGEgU0VDT05EIGNvaW4gZmxpcCBcdTIwMTQgdGhlXG4gKiBtZWNoYW5pc20tdHJpZ2dlciBjb2luIGZsaXAgaXMgaGFuZGxlZCBieSB0aGUgcmVkdWNlciBiZWZvcmUgY2FsbGluZyBoZXJlLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7IGRyYXdNdWx0aXBsaWVyLCBkcmF3WWFyZHMgfSBmcm9tIFwiLi4vZGVjay5qc1wiO1xuaW1wb3J0IHsgcmVzb2x2ZUJpZ1BsYXkgfSBmcm9tIFwiLi9iaWdQbGF5LmpzXCI7XG5pbXBvcnQge1xuICBhcHBseVlhcmRhZ2VPdXRjb21lLFxuICBibGFua1BpY2ssXG4gIGJ1bXBTdGF0cyxcbiAgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbixcbn0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlU2FtZVBsYXkoc3RhdGU6IEdhbWVTdGF0ZSwgcm5nOiBSbmcpOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcblxuICBjb25zdCBjb2luID0gcm5nLmNvaW5GbGlwKCk7XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJTQU1FX1BMQVlfQ09JTlwiLCBvdXRjb21lOiBjb2luIH0pO1xuXG4gIGNvbnN0IG11bHREcmF3ID0gZHJhd011bHRpcGxpZXIoc3RhdGUuZGVjaywgcm5nKTtcbiAgaWYgKG11bHREcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwibXVsdGlwbGllclwiIH0pO1xuXG4gIGNvbnN0IHN0YXRlQWZ0ZXJNdWx0OiBHYW1lU3RhdGUgPSB7IC4uLnN0YXRlLCBkZWNrOiBtdWx0RHJhdy5kZWNrIH07XG4gIGNvbnN0IGhlYWRzID0gY29pbiA9PT0gXCJoZWFkc1wiO1xuXG4gIC8vIEtpbmcgXHUyMTkyIEJpZyBQbGF5IGZvciB3aGljaGV2ZXIgc2lkZSB3aW5zIHRoZSBjb2luLlxuICBpZiAobXVsdERyYXcuY2FyZCA9PT0gXCJLaW5nXCIpIHtcbiAgICBjb25zdCBiZW5lZmljaWFyeSA9IGhlYWRzID8gb2ZmZW5zZSA6IG9wcChvZmZlbnNlKTtcbiAgICBjb25zdCBicCA9IHJlc29sdmVCaWdQbGF5KHN0YXRlQWZ0ZXJNdWx0LCBiZW5lZmljaWFyeSwgcm5nKTtcbiAgICByZXR1cm4geyBzdGF0ZTogYnAuc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4uYnAuZXZlbnRzXSB9O1xuICB9XG5cbiAgLy8gMTAgXHUyMTkyIGludGVyY2VwdGlvbiAoaGVhZHMpIG9yIDAgeWFyZHMgKHRhaWxzKS5cbiAgaWYgKG11bHREcmF3LmNhcmQgPT09IFwiMTBcIikge1xuICAgIGlmIChoZWFkcykge1xuICAgICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJpbnRlcmNlcHRpb25cIiB9KTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgLi4uc3RhdGVBZnRlck11bHQsXG4gICAgICAgICAgcGxheWVyczogYnVtcFN0YXRzKHN0YXRlQWZ0ZXJNdWx0LnBsYXllcnMsIG9mZmVuc2UsIHsgdHVybm92ZXJzOiAxIH0pLFxuICAgICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgICBmaWVsZDoge1xuICAgICAgICAgICAgLi4uc3RhdGVBZnRlck11bHQuZmllbGQsXG4gICAgICAgICAgICBvZmZlbnNlOiBvcHAob2ZmZW5zZSksXG4gICAgICAgICAgICBiYWxsT246IDEwMCAtIHN0YXRlQWZ0ZXJNdWx0LmZpZWxkLmJhbGxPbixcbiAgICAgICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIDEwMCAtIHN0YXRlQWZ0ZXJNdWx0LmZpZWxkLmJhbGxPbiArIDEwKSxcbiAgICAgICAgICAgIGRvd246IDEsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgZXZlbnRzLFxuICAgICAgfTtcbiAgICB9XG4gICAgLy8gMCB5YXJkcywgZG93biBjb25zdW1lZC4gRW1pdCBQTEFZX1JFU09MVkVEIHNvIHRoZSBuYXJyYXRvciBjYW5cbiAgICAvLyByZW5kZXIgXCJubyBnYWluXCIgaW5zdGVhZCBvZiBsZWF2aW5nIG9ubHkgU0FNRV9QTEFZX0NPSU4gdmlzaWJsZVxuICAgIC8vIGFuZCB0aGUgZG93biBzaWxlbnRseSBhZHZhbmNpbmcgKEYtNDgpLlxuICAgIGV2ZW50cy5wdXNoKHtcbiAgICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgICAgb2ZmZW5zZVBsYXk6IHN0YXRlLnBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ID8/IFwiU1JcIixcbiAgICAgIGRlZmVuc2VQbGF5OiBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA/PyBcIlNSXCIsXG4gICAgICBtYXRjaHVwUXVhbGl0eTogMCxcbiAgICAgIG11bHRpcGxpZXI6IHsgY2FyZDogXCIxMFwiLCB2YWx1ZTogMCB9LFxuICAgICAgeWFyZHNDYXJkOiAwLFxuICAgICAgeWFyZHNHYWluZWQ6IDAsXG4gICAgICBuZXdCYWxsT246IHN0YXRlQWZ0ZXJNdWx0LmZpZWxkLmJhbGxPbixcbiAgICB9KTtcbiAgICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShzdGF0ZUFmdGVyTXVsdCwgMCwgZXZlbnRzKTtcbiAgfVxuXG4gIC8vIFF1ZWVuIG9yIEphY2sgXHUyMTkyIG11bHRpcGxpZXIsIHRoZW4gZHJhdyB5YXJkcyBjYXJkLlxuICBsZXQgbXVsdGlwbGllciA9IDA7XG4gIGlmIChtdWx0RHJhdy5jYXJkID09PSBcIlF1ZWVuXCIpIG11bHRpcGxpZXIgPSBoZWFkcyA/IDMgOiAwO1xuICBpZiAobXVsdERyYXcuY2FyZCA9PT0gXCJKYWNrXCIpIG11bHRpcGxpZXIgPSBoZWFkcyA/IDAgOiAtMztcblxuICBpZiAobXVsdGlwbGllciA9PT0gMCkge1xuICAgIC8vIDAgeWFyZHMsIGRvd24gY29uc3VtZWQgKEYtNDggXHUyMDE0IHNhbWUgYXMgMTAtdGFpbHMgYnJhbmNoIGFib3ZlKS5cbiAgICBldmVudHMucHVzaCh7XG4gICAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICAgIG9mZmVuc2VQbGF5OiBzdGF0ZS5wZW5kaW5nUGljay5vZmZlbnNlUGxheSA/PyBcIlNSXCIsXG4gICAgICBkZWZlbnNlUGxheTogc3RhdGUucGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgPz8gXCJTUlwiLFxuICAgICAgbWF0Y2h1cFF1YWxpdHk6IDAsXG4gICAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IG11bHREcmF3LmNhcmQsIHZhbHVlOiAwIH0sXG4gICAgICB5YXJkc0NhcmQ6IDAsXG4gICAgICB5YXJkc0dhaW5lZDogMCxcbiAgICAgIG5ld0JhbGxPbjogc3RhdGVBZnRlck11bHQuZmllbGQuYmFsbE9uLFxuICAgIH0pO1xuICAgIHJldHVybiBhcHBseVlhcmRhZ2VPdXRjb21lKHN0YXRlQWZ0ZXJNdWx0LCAwLCBldmVudHMpO1xuICB9XG5cbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKHN0YXRlQWZ0ZXJNdWx0LmRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuXG4gIGNvbnN0IHlhcmRzID0gTWF0aC5yb3VuZChtdWx0aXBsaWVyICogeWFyZHNEcmF3LmNhcmQpO1xuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICBvZmZlbnNlUGxheTogc3RhdGUucGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPz8gXCJTUlwiLFxuICAgIGRlZmVuc2VQbGF5OiBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA/PyBcIlNSXCIsXG4gICAgbWF0Y2h1cFF1YWxpdHk6IDAsXG4gICAgbXVsdGlwbGllcjogeyBjYXJkOiBtdWx0RHJhdy5jYXJkLCB2YWx1ZTogbXVsdGlwbGllciB9LFxuICAgIHlhcmRzQ2FyZDogeWFyZHNEcmF3LmNhcmQsXG4gICAgeWFyZHNHYWluZWQ6IHlhcmRzLFxuICAgIG5ld0JhbGxPbjogTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBzdGF0ZUFmdGVyTXVsdC5maWVsZC5iYWxsT24gKyB5YXJkcykpLFxuICB9KTtcblxuICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShcbiAgICB7IC4uLnN0YXRlQWZ0ZXJNdWx0LCBkZWNrOiB5YXJkc0RyYXcuZGVjayB9LFxuICAgIHlhcmRzLFxuICAgIGV2ZW50cyxcbiAgKTtcbn1cbiIsICIvKipcbiAqIFRyaWNrIFBsYXkgcmVzb2x1dGlvbiAocnVuLmpzOjE5ODcpLiBPbmUgcGVyIHNodWZmbGUsIGNhbGxlZCBieSBlaXRoZXJcbiAqIG9mZmVuc2Ugb3IgZGVmZW5zZS4gRGllIHJvbGwgb3V0Y29tZXMgKGZyb20gdGhlICpjYWxsZXIncyogcGVyc3BlY3RpdmUpOlxuICpcbiAqICAgMSBcdTIxOTIgTG9uZyBQYXNzIHdpdGggKzUgYm9udXMgICAobWF0Y2h1cCB1c2VzIExQIHZzIHRoZSBvdGhlciBzaWRlJ3MgcGljaylcbiAqICAgMiBcdTIxOTIgMTUteWFyZCBwZW5hbHR5IG9uIG9wcG9zaW5nIHNpZGUgKGhhbGYtdG8tZ29hbCBpZiB0aWdodClcbiAqICAgMyBcdTIxOTIgZml4ZWQgLTN4IG11bHRpcGxpZXIsIGRyYXcgeWFyZHMgY2FyZFxuICogICA0IFx1MjE5MiBmaXhlZCArNHggbXVsdGlwbGllciwgZHJhdyB5YXJkcyBjYXJkXG4gKiAgIDUgXHUyMTkyIEJpZyBQbGF5IChiZW5lZmljaWFyeSA9IGNhbGxlcilcbiAqICAgNiBcdTIxOTIgTG9uZyBSdW4gd2l0aCArNSBib251c1xuICpcbiAqIFdoZW4gdGhlIGNhbGxlciBpcyB0aGUgZGVmZW5zZSwgdGhlIHlhcmRhZ2Ugc2lnbnMgaW52ZXJ0IChkZWZlbnNlIGdhaW5zID1cbiAqIG9mZmVuc2UgbG9zZXMpLCB0aGUgTFIvTFAgb3ZlcmxheSBpcyBhcHBsaWVkIHRvIHRoZSBkZWZlbnNpdmUgY2FsbCwgYW5kXG4gKiB0aGUgQmlnIFBsYXkgYmVuZWZpY2lhcnkgaXMgZGVmZW5zZS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgUGxheWVySWQsIFJlZ3VsYXJQbGF5IH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBkcmF3TXVsdGlwbGllciwgZHJhd1lhcmRzIH0gZnJvbSBcIi4uL2RlY2suanNcIjtcbmltcG9ydCB7IE1VTFRJLCBtYXRjaHVwUXVhbGl0eSB9IGZyb20gXCIuLi9tYXRjaHVwLmpzXCI7XG5pbXBvcnQgeyByZXNvbHZlQmlnUGxheSB9IGZyb20gXCIuL2JpZ1BsYXkuanNcIjtcbmltcG9ydCB7XG4gIGFwcGx5WWFyZGFnZU91dGNvbWUsXG4gIGJsYW5rUGljayxcbiAgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbixcbn0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlT2ZmZW5zaXZlVHJpY2tQbGF5KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBybmc6IFJuZyxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGRpZSA9IHJuZy5kNigpO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbeyB0eXBlOiBcIlRSSUNLX1BMQVlfUk9MTFwiLCBvdXRjb21lOiBkaWUgfV07XG5cbiAgLy8gNSBcdTIxOTIgQmlnIFBsYXkgZm9yIG9mZmVuc2UgKGNhbGxlcikuXG4gIGlmIChkaWUgPT09IDUpIHtcbiAgICBjb25zdCBicCA9IHJlc29sdmVCaWdQbGF5KHN0YXRlLCBvZmZlbnNlLCBybmcpO1xuICAgIHJldHVybiB7IHN0YXRlOiBicC5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi5icC5ldmVudHNdIH07XG4gIH1cblxuICAvLyAyIFx1MjE5MiAxNS15YXJkIHBlbmFsdHkgb24gZGVmZW5zZSAoPSBvZmZlbnNlIGdhaW5zIDE1IG9yIGhhbGYtdG8tZ29hbCkuXG4gIGlmIChkaWUgPT09IDIpIHtcbiAgICBjb25zdCByYXdHYWluID0gMTU7XG4gICAgY29uc3QgZ2FpbiA9XG4gICAgICBzdGF0ZS5maWVsZC5iYWxsT24gKyByYXdHYWluID4gOTlcbiAgICAgICAgPyBNYXRoLnRydW5jKCgxMDAgLSBzdGF0ZS5maWVsZC5iYWxsT24pIC8gMilcbiAgICAgICAgOiByYXdHYWluO1xuICAgIGNvbnN0IG5ld0JhbGxPbiA9IE1hdGgubWluKDEwMCwgc3RhdGUuZmllbGQuYmFsbE9uICsgZ2Fpbik7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlBFTkFMVFlcIiwgYWdhaW5zdDogb3Bwb25lbnQob2ZmZW5zZSksIHlhcmRzOiBnYWluLCBsb3NzT2ZEb3duOiBmYWxzZSB9KTtcbiAgICAvLyBSLTI1OiBpZiB0aGUgcGVuYWx0eSBHQUlOIGNhcnJpZXMgdGhlIGJhbGwgdG8gb3IgcGFzdCB0aGVcbiAgICAvLyBmaXJzdC1kb3duIG1hcmtlciwgZ3JhbnQgYXV0b21hdGljIGZpcnN0IGRvd24gXHUyMDE0IHJlc2V0IGRvd24gdG8gMVxuICAgIC8vIGFuZCBmaXJzdERvd25BdCB0byBiYWxsT24gKyAxMC4gT3RoZXJ3aXNlIGtlZXAgdGhlIGN1cnJlbnQgZG93blxuICAgIC8vIChzYW1lLWRvd24gcmVwbGF5cyB3aXRoIHlhcmRzLXRvLWdvIHVwZGF0ZWQpLlxuICAgIGNvbnN0IHJlYWNoZWRGaXJzdERvd24gPSBuZXdCYWxsT24gPj0gc3RhdGUuZmllbGQuZmlyc3REb3duQXQ7XG4gICAgY29uc3QgbmV4dERvd24gPSByZWFjaGVkRmlyc3REb3duID8gMSA6IHN0YXRlLmZpZWxkLmRvd247XG4gICAgY29uc3QgbmV4dEZpcnN0RG93bkF0ID0gcmVhY2hlZEZpcnN0RG93blxuICAgICAgPyBNYXRoLm1pbigxMDAsIG5ld0JhbGxPbiArIDEwKVxuICAgICAgOiBzdGF0ZS5maWVsZC5maXJzdERvd25BdDtcbiAgICBpZiAocmVhY2hlZEZpcnN0RG93bikgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkZJUlNUX0RPV05cIiB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICAuLi5zdGF0ZS5maWVsZCxcbiAgICAgICAgICBiYWxsT246IG5ld0JhbGxPbixcbiAgICAgICAgICBkb3duOiBuZXh0RG93bixcbiAgICAgICAgICBmaXJzdERvd25BdDogbmV4dEZpcnN0RG93bkF0LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gMyBvciA0IFx1MjE5MiBmaXhlZCBtdWx0aXBsaWVyLCBkcmF3IHlhcmRzIGNhcmQuXG4gIGlmIChkaWUgPT09IDMgfHwgZGllID09PSA0KSB7XG4gICAgY29uc3QgbXVsdGlwbGllciA9IGRpZSA9PT0gMyA/IC0zIDogNDtcbiAgICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMoc3RhdGUuZGVjaywgcm5nKTtcbiAgICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcbiAgICBjb25zdCB5YXJkcyA9IE1hdGgucm91bmQobXVsdGlwbGllciAqIHlhcmRzRHJhdy5jYXJkKTtcblxuICAgIGV2ZW50cy5wdXNoKHtcbiAgICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgICAgb2ZmZW5zZVBsYXk6IFwiVFBcIixcbiAgICAgIGRlZmVuc2VQbGF5OiBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA/PyBcIlNSXCIsXG4gICAgICBtYXRjaHVwUXVhbGl0eTogMCxcbiAgICAgIG11bHRpcGxpZXI6IHsgY2FyZDogXCJLaW5nXCIsIHZhbHVlOiBtdWx0aXBsaWVyIH0sXG4gICAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgICAgeWFyZHNHYWluZWQ6IHlhcmRzLFxuICAgICAgbmV3QmFsbE9uOiBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHN0YXRlLmZpZWxkLmJhbGxPbiArIHlhcmRzKSksXG4gICAgfSk7XG5cbiAgICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShcbiAgICAgIHsgLi4uc3RhdGUsIGRlY2s6IHlhcmRzRHJhdy5kZWNrIH0sXG4gICAgICB5YXJkcyxcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgLy8gMSBvciA2IFx1MjE5MiByZWd1bGFyIHBsYXkgcmVzb2x1dGlvbiB3aXRoIGZvcmNlZCBvZmZlbnNlIHBsYXkgKyBib251cy5cbiAgY29uc3QgZm9yY2VkUGxheTogUmVndWxhclBsYXkgPSBkaWUgPT09IDEgPyBcIkxQXCIgOiBcIkxSXCI7XG4gIGNvbnN0IGJvbnVzID0gNTtcbiAgY29uc3QgZGVmZW5zZVBsYXkgPSBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA/PyBcIlNSXCI7XG5cbiAgLy8gTXVzdCBiZSBhIHJlZ3VsYXIgcGxheSBmb3IgbWF0Y2h1cCB0byBiZSBtZWFuaW5nZnVsLiBJZiBkZWZlbnNlIGFsc28gcGlja2VkXG4gIC8vIHNvbWV0aGluZyB3ZWlyZCwgZmFsbCBiYWNrIHRvIHF1YWxpdHkgMyAobmV1dHJhbCkuXG4gIGNvbnN0IGRlZlBsYXkgPSBpc1JlZ3VsYXIoZGVmZW5zZVBsYXkpID8gZGVmZW5zZVBsYXkgOiBcIlNSXCI7XG4gIGNvbnN0IHF1YWxpdHkgPSBtYXRjaHVwUXVhbGl0eShmb3JjZWRQbGF5LCBkZWZQbGF5KTtcblxuICBjb25zdCBtdWx0RHJhdyA9IGRyYXdNdWx0aXBsaWVyKHN0YXRlLmRlY2ssIHJuZyk7XG4gIGlmIChtdWx0RHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcIm11bHRpcGxpZXJcIiB9KTtcbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKG11bHREcmF3LmRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuXG4gIGNvbnN0IG11bHRSb3cgPSBNVUxUSVttdWx0RHJhdy5pbmRleF07XG4gIGNvbnN0IG11bHRpcGxpZXIgPSBtdWx0Um93Py5bcXVhbGl0eSAtIDFdID8/IDA7XG4gIGNvbnN0IHlhcmRzID0gTWF0aC5yb3VuZChtdWx0aXBsaWVyICogeWFyZHNEcmF3LmNhcmQpICsgYm9udXM7XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgIG9mZmVuc2VQbGF5OiBmb3JjZWRQbGF5LFxuICAgIGRlZmVuc2VQbGF5OiBkZWZQbGF5LFxuICAgIG1hdGNodXBRdWFsaXR5OiBxdWFsaXR5LFxuICAgIG11bHRpcGxpZXI6IHsgY2FyZDogbXVsdERyYXcuY2FyZCwgdmFsdWU6IG11bHRpcGxpZXIgfSxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgIHlhcmRzR2FpbmVkOiB5YXJkcyxcbiAgICBuZXdCYWxsT246IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgc3RhdGUuZmllbGQuYmFsbE9uICsgeWFyZHMpKSxcbiAgfSk7XG5cbiAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoXG4gICAgeyAuLi5zdGF0ZSwgZGVjazogeWFyZHNEcmF3LmRlY2sgfSxcbiAgICB5YXJkcyxcbiAgICBldmVudHMsXG4gICk7XG59XG5cbmZ1bmN0aW9uIGlzUmVndWxhcihwOiBzdHJpbmcpOiBwIGlzIFJlZ3VsYXJQbGF5IHtcbiAgcmV0dXJuIHAgPT09IFwiU1JcIiB8fCBwID09PSBcIkxSXCIgfHwgcCA9PT0gXCJTUFwiIHx8IHAgPT09IFwiTFBcIjtcbn1cblxuZnVuY3Rpb24gb3Bwb25lbnQocDogUGxheWVySWQpOiBQbGF5ZXJJZCB7XG4gIHJldHVybiBwID09PSAxID8gMiA6IDE7XG59XG5cbi8qKlxuICogRGVmZW5zZSBjYWxscyBUcmljayBQbGF5LiBTeW1tZXRyaWMgdG8gdGhlIG9mZmVuc2l2ZSB2ZXJzaW9uIHdpdGggdGhlXG4gKiB5YXJkYWdlIHNpZ24gaW52ZXJ0ZWQgb24gdGhlIExSL0xQIGFuZCBwZW5hbHR5IGJyYW5jaGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZURlZmVuc2l2ZVRyaWNrUGxheShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgcm5nOiBSbmcsXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBkZWZlbmRlciA9IG9wcG9uZW50KG9mZmVuc2UpO1xuICBjb25zdCBkaWUgPSBybmcuZDYoKTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW3sgdHlwZTogXCJUUklDS19QTEFZX1JPTExcIiwgb3V0Y29tZTogZGllIH1dO1xuXG4gIC8vIDUgXHUyMTkyIEJpZyBQbGF5IGZvciBkZWZlbnNlIChjYWxsZXIpLlxuICBpZiAoZGllID09PSA1KSB7XG4gICAgY29uc3QgYnAgPSByZXNvbHZlQmlnUGxheShzdGF0ZSwgZGVmZW5kZXIsIHJuZyk7XG4gICAgcmV0dXJuIHsgc3RhdGU6IGJwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLmJwLmV2ZW50c10gfTtcbiAgfVxuXG4gIC8vIDIgXHUyMTkyIDE1LXlhcmQgcGVuYWx0eSBvbiBvZmZlbnNlICg9IG9mZmVuc2UgbG9zZXMgMTUgb3IgaGFsZi10by1vd24tZ29hbCkuXG4gIGlmIChkaWUgPT09IDIpIHtcbiAgICBjb25zdCByYXdMb3NzID0gLTE1O1xuICAgIGNvbnN0IGxvc3MgPVxuICAgICAgc3RhdGUuZmllbGQuYmFsbE9uICsgcmF3TG9zcyA8IDFcbiAgICAgICAgPyAtTWF0aC50cnVuYyhzdGF0ZS5maWVsZC5iYWxsT24gLyAyKVxuICAgICAgICA6IHJhd0xvc3M7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlBFTkFMVFlcIiwgYWdhaW5zdDogb2ZmZW5zZSwgeWFyZHM6IGxvc3MsIGxvc3NPZkRvd246IGZhbHNlIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGVuZGluZ1BpY2s6IHsgb2ZmZW5zZVBsYXk6IG51bGwsIGRlZmVuc2VQbGF5OiBudWxsIH0sXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgLi4uc3RhdGUuZmllbGQsXG4gICAgICAgICAgYmFsbE9uOiBNYXRoLm1heCgwLCBzdGF0ZS5maWVsZC5iYWxsT24gKyBsb3NzKSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIDMgb3IgNCBcdTIxOTIgZml4ZWQgbXVsdGlwbGllciB3aXRoIHRoZSAqZGVmZW5zZSdzKiBzaWduIGNvbnZlbnRpb24uIHY1LjFcbiAgLy8gYXBwbGllcyB0aGUgc2FtZSArLy0gbXVsdGlwbGllcnMgYXMgb2ZmZW5zaXZlIFRyaWNrIFBsYXk7IHRoZSBpbnZlcnNpb25cbiAgLy8gaXMgaW1wbGljaXQgaW4gZGVmZW5zZSBiZWluZyB0aGUgY2FsbGVyLiBZYXJkYWdlIGlzIGZyb20gb2ZmZW5zZSBQT1YuXG4gIGlmIChkaWUgPT09IDMgfHwgZGllID09PSA0KSB7XG4gICAgY29uc3QgbXVsdGlwbGllciA9IGRpZSA9PT0gMyA/IC0zIDogNDtcbiAgICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMoc3RhdGUuZGVjaywgcm5nKTtcbiAgICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcbiAgICBjb25zdCB5YXJkcyA9IE1hdGgucm91bmQobXVsdGlwbGllciAqIHlhcmRzRHJhdy5jYXJkKTtcblxuICAgIGV2ZW50cy5wdXNoKHtcbiAgICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgICAgb2ZmZW5zZVBsYXk6IHN0YXRlLnBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ID8/IFwiU1JcIixcbiAgICAgIGRlZmVuc2VQbGF5OiBcIlRQXCIsXG4gICAgICBtYXRjaHVwUXVhbGl0eTogMCxcbiAgICAgIG11bHRpcGxpZXI6IHsgY2FyZDogXCJLaW5nXCIsIHZhbHVlOiBtdWx0aXBsaWVyIH0sXG4gICAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgICAgeWFyZHNHYWluZWQ6IHlhcmRzLFxuICAgICAgbmV3QmFsbE9uOiBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHN0YXRlLmZpZWxkLmJhbGxPbiArIHlhcmRzKSksXG4gICAgfSk7XG5cbiAgICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShcbiAgICAgIHsgLi4uc3RhdGUsIGRlY2s6IHlhcmRzRHJhdy5kZWNrIH0sXG4gICAgICB5YXJkcyxcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgLy8gMSBvciA2IFx1MjE5MiBkZWZlbnNlJ3MgcGljayBiZWNvbWVzIExQIC8gTFIgd2l0aCAtNSBib251cyB0byBvZmZlbnNlLlxuICBjb25zdCBmb3JjZWREZWZQbGF5OiBSZWd1bGFyUGxheSA9IGRpZSA9PT0gMSA/IFwiTFBcIiA6IFwiTFJcIjtcbiAgY29uc3QgYm9udXMgPSAtNTtcbiAgY29uc3Qgb2ZmZW5zZVBsYXkgPSBzdGF0ZS5wZW5kaW5nUGljay5vZmZlbnNlUGxheSA/PyBcIlNSXCI7XG4gIGNvbnN0IG9mZlBsYXkgPSBpc1JlZ3VsYXIob2ZmZW5zZVBsYXkpID8gb2ZmZW5zZVBsYXkgOiBcIlNSXCI7XG4gIGNvbnN0IHF1YWxpdHkgPSBtYXRjaHVwUXVhbGl0eShvZmZQbGF5LCBmb3JjZWREZWZQbGF5KTtcblxuICBjb25zdCBtdWx0RHJhdyA9IGRyYXdNdWx0aXBsaWVyKHN0YXRlLmRlY2ssIHJuZyk7XG4gIGlmIChtdWx0RHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcIm11bHRpcGxpZXJcIiB9KTtcbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKG11bHREcmF3LmRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuXG4gIGNvbnN0IG11bHRSb3cgPSBNVUxUSVttdWx0RHJhdy5pbmRleF07XG4gIGNvbnN0IG11bHRpcGxpZXIgPSBtdWx0Um93Py5bcXVhbGl0eSAtIDFdID8/IDA7XG4gIGNvbnN0IHlhcmRzID0gTWF0aC5yb3VuZChtdWx0aXBsaWVyICogeWFyZHNEcmF3LmNhcmQpICsgYm9udXM7XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgIG9mZmVuc2VQbGF5OiBvZmZQbGF5LFxuICAgIGRlZmVuc2VQbGF5OiBmb3JjZWREZWZQbGF5LFxuICAgIG1hdGNodXBRdWFsaXR5OiBxdWFsaXR5LFxuICAgIG11bHRpcGxpZXI6IHsgY2FyZDogbXVsdERyYXcuY2FyZCwgdmFsdWU6IG11bHRpcGxpZXIgfSxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgIHlhcmRzR2FpbmVkOiB5YXJkcyxcbiAgICBuZXdCYWxsT246IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgc3RhdGUuZmllbGQuYmFsbE9uICsgeWFyZHMpKSxcbiAgfSk7XG5cbiAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoXG4gICAgeyAuLi5zdGF0ZSwgZGVjazogeWFyZHNEcmF3LmRlY2sgfSxcbiAgICB5YXJkcyxcbiAgICBldmVudHMsXG4gICk7XG59XG4iLCAiLyoqXG4gKiBGaWVsZCBHb2FsIChydW4uanM6MjA0MCkuXG4gKlxuICogRGlzdGFuY2UgPSAoMTAwIC0gYmFsbE9uKSArIDE3LiBTbyBmcm9tIHRoZSA1MCwgRkcgPSA2Ny15YXJkIGF0dGVtcHQuXG4gKlxuICogRGllIHJvbGwgZGV0ZXJtaW5lcyBzdWNjZXNzIGJ5IGRpc3RhbmNlIGJhbmQ6XG4gKiAgIGRpc3RhbmNlID4gNjUgICAgICAgIFx1MjE5MiAxLWluLTEwMDAgY2hhbmNlIChlZmZlY3RpdmVseSBhdXRvLW1pc3MpXG4gKiAgIGRpc3RhbmNlID49IDYwICAgICAgIFx1MjE5MiBuZWVkcyBkaWUgPSA2XG4gKiAgIGRpc3RhbmNlID49IDUwICAgICAgIFx1MjE5MiBuZWVkcyBkaWUgPj0gNVxuICogICBkaXN0YW5jZSA+PSA0MCAgICAgICBcdTIxOTIgbmVlZHMgZGllID49IDRcbiAqICAgZGlzdGFuY2UgPj0gMzAgICAgICAgXHUyMTkyIG5lZWRzIGRpZSA+PSAzXG4gKiAgIGRpc3RhbmNlID49IDIwICAgICAgIFx1MjE5MiBuZWVkcyBkaWUgPj0gMlxuICogICBkaXN0YW5jZSA8ICAyMCAgICAgICBcdTIxOTIgYXV0by1tYWtlXG4gKlxuICogSWYgYSB0aW1lb3V0IHdhcyBjYWxsZWQgYnkgdGhlIGRlZmVuc2UganVzdCBwcmlvciAoa2lja2VyIGljaW5nKSwgZGllKysuXG4gKlxuICogU3VjY2VzcyBcdTIxOTIgKzMgcG9pbnRzLCBraWNrb2ZmIHRvIG9wcG9uZW50LlxuICogTWlzcyAgICBcdTIxOTIgcG9zc2Vzc2lvbiBmbGlwcyBhdCB0aGUgU1BPVCBPRiBUSEUgS0lDSyAobm90IHRoZSBsaW5lIG9mIHNjcmltbWFnZSkuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi8uLi9zdGF0ZS5qc1wiO1xuaW1wb3J0IHsgYmxhbmtQaWNrLCB0eXBlIFNwZWNpYWxSZXNvbHV0aW9uIH0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRmllbGRHb2FsT3B0aW9ucyB7XG4gIC8qKiB0cnVlIGlmIHRoZSBvcHBvc2luZyB0ZWFtIGNhbGxlZCBhIHRpbWVvdXQgdGhhdCBzaG91bGQgaWNlIHRoZSBraWNrZXIuICovXG4gIGljZWQ/OiBib29sZWFuO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUZpZWxkR29hbChcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgcm5nOiBSbmcsXG4gIG9wdHM6IEZpZWxkR29hbE9wdGlvbnMgPSB7fSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGRpc3RhbmNlID0gMTAwIC0gc3RhdGUuZmllbGQuYmFsbE9uICsgMTc7XG4gIGNvbnN0IHJhd0RpZSA9IHJuZy5kNigpO1xuICBjb25zdCBkaWUgPSBvcHRzLmljZWQgPyBNYXRoLm1pbig2LCByYXdEaWUgKyAxKSA6IHJhd0RpZTtcblxuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcblxuICBsZXQgbWFrZTogYm9vbGVhbjtcbiAgaWYgKGRpc3RhbmNlID4gNjUpIHtcbiAgICAvLyBFc3NlbnRpYWxseSBpbXBvc3NpYmxlIFx1MjAxNCByb2xsZWQgMS0xMDAwLCBtYWtlIG9ubHkgb24gZXhhY3QgaGl0LlxuICAgIG1ha2UgPSBybmcuaW50QmV0d2VlbigxLCAxMDAwKSA9PT0gZGlzdGFuY2U7XG4gIH0gZWxzZSBpZiAoZGlzdGFuY2UgPj0gNjApIG1ha2UgPSBkaWUgPj0gNjtcbiAgZWxzZSBpZiAoZGlzdGFuY2UgPj0gNTApIG1ha2UgPSBkaWUgPj0gNTtcbiAgZWxzZSBpZiAoZGlzdGFuY2UgPj0gNDApIG1ha2UgPSBkaWUgPj0gNDtcbiAgZWxzZSBpZiAoZGlzdGFuY2UgPj0gMzApIG1ha2UgPSBkaWUgPj0gMztcbiAgZWxzZSBpZiAoZGlzdGFuY2UgPj0gMjApIG1ha2UgPSBkaWUgPj0gMjtcbiAgZWxzZSBtYWtlID0gdHJ1ZTtcblxuICBpZiAobWFrZSkge1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJGSUVMRF9HT0FMX0dPT0RcIiwgcGxheWVyOiBvZmZlbnNlLCByb2xsOiBkaWUsIGRpc3RhbmNlIH0pO1xuICAgIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgW29mZmVuc2VdOiB7IC4uLnN0YXRlLnBsYXllcnNbb2ZmZW5zZV0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLnNjb3JlICsgMyB9LFxuICAgIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkZJRUxEX0dPQUxfTUlTU0VEXCIsIHBsYXllcjogb2ZmZW5zZSwgcm9sbDogZGllLCBkaXN0YW5jZSB9KTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJtaXNzZWRfZmdcIiB9KTtcblxuICAvLyBGLTUxIGZpZGVsaXR5OiB2NS4xIHBsYWNlcyBiYWxsIGF0IFNQT1QgT0YgS0lDSyAoNyB5YXJkcyBiZWhpbmQgTE9TIGluXG4gIC8vIG9mZmVuc2UgUE9WIFx1MjE5MiBtaXJyb3IgKyA3IGluIGRlZmVuZGVyIFBPVikuIFJlZC16b25lIG1pc3NlcyAoa2ljayBzcG90XG4gIC8vIHdvdWxkIGJlIGluc2lkZSBkZWZlbmRlcidzIDIwKSBzbmFwIGZvcndhcmQgdG8gZGVmZW5kZXIncyAyMC5cbiAgY29uc3QgZGVmZW5kZXIgPSBvcHAob2ZmZW5zZSk7XG4gIGNvbnN0IGtpY2tTcG90SW5EZWZlbmRlclBvdiA9IDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbiArIDc7XG4gIGNvbnN0IG5ld0JhbGxPbiA9IGtpY2tTcG90SW5EZWZlbmRlclBvdiA8PSAyMCA/IDIwIDoga2lja1Nwb3RJbkRlZmVuZGVyUG92O1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogbmV3QmFsbE9uLFxuICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBuZXdCYWxsT24gKyAxMCksXG4gICAgICAgIGRvd246IDEsXG4gICAgICAgIG9mZmVuc2U6IGRlZmVuZGVyLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cbiIsICIvKipcbiAqIFR3by1Qb2ludCBDb252ZXJzaW9uIChUV09fUFQgcGhhc2UpLlxuICpcbiAqIEJhbGwgaXMgcGxhY2VkIGF0IG9mZmVuc2UncyA5NyAoPSAzLXlhcmQgbGluZSkuIEEgc2luZ2xlIHJlZ3VsYXIgcGxheSBpc1xuICogcmVzb2x2ZWQuIElmIHRoZSByZXN1bHRpbmcgeWFyZGFnZSBjcm9zc2VzIHRoZSBnb2FsIGxpbmUsIFRXT19QT0lOVF9HT09ELlxuICogT3RoZXJ3aXNlLCBUV09fUE9JTlRfRkFJTEVELiBFaXRoZXIgd2F5LCBraWNrb2ZmIGZvbGxvd3MuXG4gKlxuICogVW5saWtlIGEgbm9ybWFsIHBsYXksIGEgMnB0IGRvZXMgTk9UIGNoYW5nZSBkb3duL2Rpc3RhbmNlLiBJdCdzIGEgb25lLXNob3QuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIFJlZ3VsYXJQbGF5IH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBkcmF3TXVsdGlwbGllciwgZHJhd1lhcmRzIH0gZnJvbSBcIi4uL2RlY2suanNcIjtcbmltcG9ydCB7IGNvbXB1dGVZYXJkYWdlIH0gZnJvbSBcIi4uL3lhcmRhZ2UuanNcIjtcbmltcG9ydCB7IGJsYW5rUGljaywgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbiB9IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVR3b1BvaW50Q29udmVyc2lvbihcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgb2ZmZW5zZVBsYXk6IFJlZ3VsYXJQbGF5LFxuICBkZWZlbnNlUGxheTogUmVndWxhclBsYXksXG4gIHJuZzogUm5nLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG5cbiAgY29uc3QgbXVsdERyYXcgPSBkcmF3TXVsdGlwbGllcihzdGF0ZS5kZWNrLCBybmcpO1xuICBpZiAobXVsdERyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJtdWx0aXBsaWVyXCIgfSk7XG4gIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhtdWx0RHJhdy5kZWNrLCBybmcpO1xuICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcblxuICBjb25zdCBvdXRjb21lID0gY29tcHV0ZVlhcmRhZ2Uoe1xuICAgIG9mZmVuc2U6IG9mZmVuc2VQbGF5LFxuICAgIGRlZmVuc2U6IGRlZmVuc2VQbGF5LFxuICAgIG11bHRpcGxpZXJDYXJkOiBtdWx0RHJhdy5pbmRleCxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICB9KTtcblxuICAvLyAycHQgc3RhcnRzIGF0IDk3LiBDcm9zc2luZyB0aGUgZ29hbCA9IGdvb2QuXG4gIGNvbnN0IHN0YXJ0QmFsbE9uID0gOTc7XG4gIGNvbnN0IHByb2plY3RlZCA9IHN0YXJ0QmFsbE9uICsgb3V0Y29tZS55YXJkc0dhaW5lZDtcbiAgY29uc3QgZ29vZCA9IHByb2plY3RlZCA+PSAxMDA7XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgIG9mZmVuc2VQbGF5LFxuICAgIGRlZmVuc2VQbGF5LFxuICAgIG1hdGNodXBRdWFsaXR5OiBvdXRjb21lLm1hdGNodXBRdWFsaXR5LFxuICAgIG11bHRpcGxpZXI6IHsgY2FyZDogb3V0Y29tZS5tdWx0aXBsaWVyQ2FyZE5hbWUsIHZhbHVlOiBvdXRjb21lLm11bHRpcGxpZXIgfSxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgIHlhcmRzR2FpbmVkOiBvdXRjb21lLnlhcmRzR2FpbmVkLFxuICAgIG5ld0JhbGxPbjogTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBwcm9qZWN0ZWQpKSxcbiAgfSk7XG5cbiAgY29uc3QgbmV3UGxheWVycyA9IGdvb2RcbiAgICA/ICh7XG4gICAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICAgIFtvZmZlbnNlXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLCBzY29yZTogc3RhdGUucGxheWVyc1tvZmZlbnNlXS5zY29yZSArIDIgfSxcbiAgICAgIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXSlcbiAgICA6IHN0YXRlLnBsYXllcnM7XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IGdvb2QgPyBcIlRXT19QT0lOVF9HT09EXCIgOiBcIlRXT19QT0lOVF9GQUlMRURcIixcbiAgICBwbGF5ZXI6IG9mZmVuc2UsXG4gIH0pO1xuXG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgZGVjazogeWFyZHNEcmF3LmRlY2ssXG4gICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuIiwgIi8qKlxuICogT3ZlcnRpbWUgbWVjaGFuaWNzLlxuICpcbiAqIENvbGxlZ2UtZm9vdGJhbGwgc3R5bGU6XG4gKiAgIC0gRWFjaCBwZXJpb2Q6IGVhY2ggdGVhbSBnZXRzIG9uZSBwb3NzZXNzaW9uIGZyb20gdGhlIG9wcG9uZW50J3MgMjVcbiAqICAgICAob2ZmZW5zZSBQT1Y6IGJhbGxPbiA9IDc1KS5cbiAqICAgLSBBIHBvc3Nlc3Npb24gZW5kcyB3aXRoOiBURCAoZm9sbG93ZWQgYnkgUEFULzJwdCksIEZHIChtYWRlIG9yIG1pc3NlZCksXG4gKiAgICAgdHVybm92ZXIsIHR1cm5vdmVyLW9uLWRvd25zLCBvciBzYWZldHkuXG4gKiAgIC0gQWZ0ZXIgYm90aCBwb3NzZXNzaW9ucywgaWYgc2NvcmVzIGRpZmZlciBcdTIxOTIgR0FNRV9PVkVSLiBJZiB0aWVkIFx1MjE5MiBuZXh0XG4gKiAgICAgcGVyaW9kLlxuICogICAtIFBlcmlvZHMgYWx0ZXJuYXRlIHdobyBwb3NzZXNzZXMgZmlyc3QuXG4gKiAgIC0gUGVyaW9kIDMrOiAyLXBvaW50IGNvbnZlcnNpb24gbWFuZGF0b3J5IGFmdGVyIGEgVEQgKG5vIFBBVCBraWNrKS5cbiAqICAgLSBIYWlsIE1hcnlzOiAyIHBlciBwZXJpb2QsIHJlZmlsbGVkIGF0IHN0YXJ0IG9mIGVhY2ggcGVyaW9kLlxuICogICAtIFRpbWVvdXRzOiAxIHBlciBwYWlyIG9mIHBlcmlvZHMuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBPdmVydGltZVN0YXRlLCBQbGF5ZXJJZCB9IGZyb20gXCIuLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgZW1wdHlIYW5kLCBvcHAgfSBmcm9tIFwiLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7IGZyZXNoRGVja011bHRpcGxpZXJzLCBmcmVzaERlY2tZYXJkcyB9IGZyb20gXCIuLi9zdGF0ZS5qc1wiO1xuXG5jb25zdCBPVF9CQUxMX09OID0gNzU7IC8vIG9wcG9uZW50J3MgMjUteWFyZCBsaW5lLCBmcm9tIG9mZmVuc2UgUE9WXG5cbi8qKlxuICogSW5pdGlhbGl6ZSBPVCBzdGF0ZSwgcmVmcmVzaCBkZWNrcy9oYW5kcywgc2V0IGJhbGwgYXQgdGhlIDI1LlxuICogQ2FsbGVkIG9uY2UgdGllZCByZWd1bGF0aW9uIGVuZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGFydE92ZXJ0aW1lKHN0YXRlOiBHYW1lU3RhdGUpOiB7IHN0YXRlOiBHYW1lU3RhdGU7IGV2ZW50czogRXZlbnRbXSB9IHtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG4gIGNvbnN0IGZpcnN0UmVjZWl2ZXI6IFBsYXllcklkID0gc3RhdGUub3BlbmluZ1JlY2VpdmVyID09PSAxID8gMiA6IDE7XG4gIGNvbnN0IG92ZXJ0aW1lOiBPdmVydGltZVN0YXRlID0ge1xuICAgIHBlcmlvZDogMSxcbiAgICBwb3NzZXNzaW9uOiBmaXJzdFJlY2VpdmVyLFxuICAgIGZpcnN0UmVjZWl2ZXIsXG4gICAgcG9zc2Vzc2lvbnNSZW1haW5pbmc6IDIsXG4gIH07XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJPVkVSVElNRV9TVEFSVEVEXCIsIHBlcmlvZDogMSwgcG9zc2Vzc2lvbjogZmlyc3RSZWNlaXZlciB9KTtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwaGFzZTogXCJPVF9TVEFSVFwiLFxuICAgICAgb3ZlcnRpbWUsXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbi8qKiBCZWdpbiAob3IgcmVzdW1lKSB0aGUgbmV4dCBPVCBwb3NzZXNzaW9uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0YXJ0T3ZlcnRpbWVQb3NzZXNzaW9uKHN0YXRlOiBHYW1lU3RhdGUpOiB7IHN0YXRlOiBHYW1lU3RhdGU7IGV2ZW50czogRXZlbnRbXSB9IHtcbiAgaWYgKCFzdGF0ZS5vdmVydGltZSkgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcblxuICBjb25zdCBwb3NzZXNzaW9uID0gc3RhdGUub3ZlcnRpbWUucG9zc2Vzc2lvbjtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG5cbiAgLy8gUmVmaWxsIEhNIGNvdW50IGZvciB0aGUgcG9zc2Vzc2lvbidzIG9mZmVuc2UgKG1hdGNoZXMgdjUuMTogSE0gcmVzZXRzXG4gIC8vIHBlciBPVCBwZXJpb2QpLiBQZXJpb2QgMysgcGxheWVycyBoYXZlIG9ubHkgMiBITXMgYW55d2F5LlxuICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgW3Bvc3Nlc3Npb25dOiB7XG4gICAgICAuLi5zdGF0ZS5wbGF5ZXJzW3Bvc3Nlc3Npb25dLFxuICAgICAgaGFuZDogeyAuLi5zdGF0ZS5wbGF5ZXJzW3Bvc3Nlc3Npb25dLmhhbmQsIEhNOiBzdGF0ZS5vdmVydGltZS5wZXJpb2QgPj0gMyA/IDIgOiAyIH0sXG4gICAgfSxcbiAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuXG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgIHBoYXNlOiBcIk9UX1BMQVlcIixcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogT1RfQkFMTF9PTixcbiAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgT1RfQkFMTF9PTiArIDEwKSxcbiAgICAgICAgZG93bjogMSxcbiAgICAgICAgb2ZmZW5zZTogcG9zc2Vzc2lvbixcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbi8qKlxuICogRW5kIHRoZSBjdXJyZW50IE9UIHBvc3Nlc3Npb24uIERlY3JlbWVudHMgcG9zc2Vzc2lvbnNSZW1haW5pbmc7IGlmIDAsXG4gKiBjaGVja3MgZm9yIGdhbWUgZW5kLiBPdGhlcndpc2UgZmxpcHMgcG9zc2Vzc2lvbi5cbiAqXG4gKiBDYWxsZXIgaXMgcmVzcG9uc2libGUgZm9yIGRldGVjdGluZyBcInRoaXMgd2FzIGEgcG9zc2Vzc2lvbi1lbmRpbmcgZXZlbnRcIlxuICogKFREK1BBVCwgRkcgZGVjaXNpb24sIHR1cm5vdmVyLCBldGMpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZW5kT3ZlcnRpbWVQb3NzZXNzaW9uKHN0YXRlOiBHYW1lU3RhdGUpOiB7IHN0YXRlOiBHYW1lU3RhdGU7IGV2ZW50czogRXZlbnRbXSB9IHtcbiAgaWYgKCFzdGF0ZS5vdmVydGltZSkgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcblxuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcbiAgY29uc3QgcmVtYWluaW5nID0gc3RhdGUub3ZlcnRpbWUucG9zc2Vzc2lvbnNSZW1haW5pbmc7XG5cbiAgaWYgKHJlbWFpbmluZyA9PT0gMikge1xuICAgIC8vIEZpcnN0IHBvc3Nlc3Npb24gZW5kZWQuIEZsaXAgdG8gc2Vjb25kIHRlYW0sIGZyZXNoIGJhbGwuXG4gICAgY29uc3QgbmV4dFBvc3Nlc3Npb24gPSBvcHAoc3RhdGUub3ZlcnRpbWUucG9zc2Vzc2lvbik7XG4gICAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICBbbmV4dFBvc3Nlc3Npb25dOiB7XG4gICAgICAgIC4uLnN0YXRlLnBsYXllcnNbbmV4dFBvc3Nlc3Npb25dLFxuICAgICAgICBoYW5kOiB7IC4uLnN0YXRlLnBsYXllcnNbbmV4dFBvc3Nlc3Npb25dLmhhbmQsIEhNOiAyIH0sXG4gICAgICB9LFxuICAgIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICAgIHBoYXNlOiBcIk9UX1BMQVlcIixcbiAgICAgICAgb3ZlcnRpbWU6IHsgLi4uc3RhdGUub3ZlcnRpbWUsIHBvc3Nlc3Npb246IG5leHRQb3NzZXNzaW9uLCBwb3NzZXNzaW9uc1JlbWFpbmluZzogMSB9LFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIGJhbGxPbjogT1RfQkFMTF9PTixcbiAgICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBPVF9CQUxMX09OICsgMTApLFxuICAgICAgICAgIGRvd246IDEsXG4gICAgICAgICAgb2ZmZW5zZTogbmV4dFBvc3Nlc3Npb24sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBTZWNvbmQgcG9zc2Vzc2lvbiBlbmRlZC4gQ29tcGFyZSBzY29yZXMuXG4gIGNvbnN0IHAxID0gc3RhdGUucGxheWVyc1sxXS5zY29yZTtcbiAgY29uc3QgcDIgPSBzdGF0ZS5wbGF5ZXJzWzJdLnNjb3JlO1xuICBpZiAocDEgIT09IHAyKSB7XG4gICAgY29uc3Qgd2lubmVyOiBQbGF5ZXJJZCA9IHAxID4gcDIgPyAxIDogMjtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiR0FNRV9PVkVSXCIsIHdpbm5lciB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBoYXNlOiBcIkdBTUVfT1ZFUlwiLFxuICAgICAgICBvdmVydGltZTogeyAuLi5zdGF0ZS5vdmVydGltZSwgcG9zc2Vzc2lvbnNSZW1haW5pbmc6IDAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIFRpZWQgXHUyMDE0IHN0YXJ0IG5leHQgcGVyaW9kLiBBbHRlcm5hdGVzIGZpcnN0LXBvc3Nlc3Nvci5cbiAgY29uc3QgbmV4dFBlcmlvZCA9IHN0YXRlLm92ZXJ0aW1lLnBlcmlvZCArIDE7XG4gIGNvbnN0IG5leHRGaXJzdCA9IG9wcChzdGF0ZS5vdmVydGltZS5maXJzdFJlY2VpdmVyKTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIk9WRVJUSU1FX1NUQVJURURcIiwgcGVyaW9kOiBuZXh0UGVyaW9kLCBwb3NzZXNzaW9uOiBuZXh0Rmlyc3QgfSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGhhc2U6IFwiT1RfU1RBUlRcIixcbiAgICAgIG92ZXJ0aW1lOiB7XG4gICAgICAgIHBlcmlvZDogbmV4dFBlcmlvZCxcbiAgICAgICAgcG9zc2Vzc2lvbjogbmV4dEZpcnN0LFxuICAgICAgICBmaXJzdFJlY2VpdmVyOiBuZXh0Rmlyc3QsXG4gICAgICAgIHBvc3Nlc3Npb25zUmVtYWluaW5nOiAyLFxuICAgICAgfSxcbiAgICAgIC8vIEZyZXNoIGRlY2tzIGZvciB0aGUgbmV3IHBlcmlvZC5cbiAgICAgIGRlY2s6IHsgbXVsdGlwbGllcnM6IGZyZXNoRGVja011bHRpcGxpZXJzKCksIHlhcmRzOiBmcmVzaERlY2tZYXJkcygpIH0sXG4gICAgICBwbGF5ZXJzOiB7XG4gICAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICAgIDE6IHsgLi4uc3RhdGUucGxheWVyc1sxXSwgaGFuZDogZW1wdHlIYW5kKHRydWUpIH0sXG4gICAgICAgIDI6IHsgLi4uc3RhdGUucGxheWVyc1syXSwgaGFuZDogZW1wdHlIYW5kKHRydWUpIH0sXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG4vKipcbiAqIERldGVjdCB3aGV0aGVyIGEgc2VxdWVuY2Ugb2YgZXZlbnRzIGZyb20gYSBwbGF5IHJlc29sdXRpb24gc2hvdWxkIGVuZFxuICogdGhlIGN1cnJlbnQgT1QgcG9zc2Vzc2lvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzUG9zc2Vzc2lvbkVuZGluZ0luT1QoZXZlbnRzOiBSZWFkb25seUFycmF5PEV2ZW50Pik6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IGUgb2YgZXZlbnRzKSB7XG4gICAgc3dpdGNoIChlLnR5cGUpIHtcbiAgICAgIGNhc2UgXCJQQVRfR09PRFwiOlxuICAgICAgY2FzZSBcIlRXT19QT0lOVF9HT09EXCI6XG4gICAgICBjYXNlIFwiVFdPX1BPSU5UX0ZBSUxFRFwiOlxuICAgICAgY2FzZSBcIkZJRUxEX0dPQUxfR09PRFwiOlxuICAgICAgY2FzZSBcIkZJRUxEX0dPQUxfTUlTU0VEXCI6XG4gICAgICBjYXNlIFwiVFVSTk9WRVJcIjpcbiAgICAgIGNhc2UgXCJUVVJOT1ZFUl9PTl9ET1dOU1wiOlxuICAgICAgY2FzZSBcIlNBRkVUWVwiOlxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuIiwgIi8qKlxuICogVGhlIHNpbmdsZSB0cmFuc2l0aW9uIGZ1bmN0aW9uLiBUYWtlcyAoc3RhdGUsIGFjdGlvbiwgcm5nKSBhbmQgcmV0dXJuc1xuICogYSBuZXcgc3RhdGUgcGx1cyB0aGUgZXZlbnRzIHRoYXQgZGVzY3JpYmUgd2hhdCBoYXBwZW5lZC5cbiAqXG4gKiBUaGlzIGZpbGUgaXMgdGhlICpza2VsZXRvbiogXHUyMDE0IHRoZSBkaXNwYXRjaCBzaGFwZSBpcyBoZXJlLCB0aGUgY2FzZXMgYXJlXG4gKiBtb3N0bHkgc3R1YnMgbWFya2VkIGAvLyBUT0RPOiBwb3J0IGZyb20gcnVuLmpzYC4gQXMgd2UgcG9ydCwgZWFjaCBjYXNlXG4gKiBnZXRzIHVuaXQtdGVzdGVkLiBXaGVuIGV2ZXJ5IGNhc2UgaXMgaW1wbGVtZW50ZWQgYW5kIHRlc3RlZCwgdjUuMSdzIHJ1bi5qc1xuICogY2FuIGJlIGRlbGV0ZWQuXG4gKlxuICogUnVsZXMgZm9yIHRoaXMgZmlsZTpcbiAqICAgMS4gTkVWRVIgaW1wb3J0IGZyb20gRE9NLCBuZXR3b3JrLCBvciBhbmltYXRpb24gbW9kdWxlcy5cbiAqICAgMi4gTkVWRVIgbXV0YXRlIGBzdGF0ZWAgXHUyMDE0IGFsd2F5cyByZXR1cm4gYSBuZXcgb2JqZWN0LlxuICogICAzLiBORVZFUiBjYWxsIE1hdGgucmFuZG9tIFx1MjAxNCB1c2UgdGhlIGBybmdgIHBhcmFtZXRlci5cbiAqICAgNC4gTkVWRVIgdGhyb3cgb24gaW52YWxpZCBhY3Rpb25zIFx1MjAxNCByZXR1cm4gYHsgc3RhdGUsIGV2ZW50czogW10gfWBcbiAqICAgICAgYW5kIGxldCB0aGUgY2FsbGVyIGRlY2lkZS4gKFZhbGlkYXRpb24gaXMgdGhlIHNlcnZlcidzIGpvYi4pXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBBY3Rpb24gfSBmcm9tIFwiLi9hY3Rpb25zLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgS2lja1R5cGUsIFJldHVyblR5cGUgfSBmcm9tIFwiLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgdmFsaWRhdGVBY3Rpb24gfSBmcm9tIFwiLi92YWxpZGF0ZS5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi9ybmcuanNcIjtcbmltcG9ydCB7IGlzUmVndWxhclBsYXksIHJlc29sdmVSZWd1bGFyUGxheSB9IGZyb20gXCIuL3J1bGVzL3BsYXkuanNcIjtcbmltcG9ydCB7XG4gIHJlc29sdmVEZWZlbnNpdmVUcmlja1BsYXksXG4gIHJlc29sdmVGaWVsZEdvYWwsXG4gIHJlc29sdmVIYWlsTWFyeSxcbiAgcmVzb2x2ZUtpY2tvZmYsXG4gIHJlc29sdmVPZmZlbnNpdmVUcmlja1BsYXksXG4gIHJlc29sdmVQdW50LFxuICByZXNvbHZlU2FtZVBsYXksXG4gIHJlc29sdmVUd29Qb2ludENvbnZlcnNpb24sXG59IGZyb20gXCIuL3J1bGVzL3NwZWNpYWxzL2luZGV4LmpzXCI7XG5pbXBvcnQge1xuICBlbmRPdmVydGltZVBvc3Nlc3Npb24sXG4gIGlzUG9zc2Vzc2lvbkVuZGluZ0luT1QsXG4gIHN0YXJ0T3ZlcnRpbWUsXG4gIHN0YXJ0T3ZlcnRpbWVQb3NzZXNzaW9uLFxufSBmcm9tIFwiLi9ydWxlcy9vdmVydGltZS5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4vc3RhdGUuanNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBSZWR1Y2VSZXN1bHQge1xuICBzdGF0ZTogR2FtZVN0YXRlO1xuICBldmVudHM6IEV2ZW50W107XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWR1Y2Uoc3RhdGU6IEdhbWVTdGF0ZSwgYWN0aW9uOiBBY3Rpb24sIHJuZzogUm5nKTogUmVkdWNlUmVzdWx0IHtcbiAgLy8gR2F0ZSBhdCB0aGUgdG9wOiBpbnZhbGlkIGFjdGlvbnMgYXJlIHNpbGVudGx5IG5vLW9wZWQuIFNhbWUgY29udHJhY3RcbiAgLy8gYXMgdGhlIHJlZHVjZXIncyBwZXItY2FzZSBzaGFwZSBjaGVja3MgKFwiSWxsZWdhbCBwaWNrcyBhcmUgc2lsZW50bHlcbiAgLy8gbm8tb3AnZDsgdGhlIG9yY2hlc3RyYXRvciBpcyByZXNwb25zaWJsZSBmb3Igc3VyZmFjaW5nIGVycm9yc1wiKSwgYnV0XG4gIC8vIGNlbnRyYWxpemVkIHNvIGFuIHVuYXV0aGVudGljYXRlZCBETyBjbGllbnQgY2FuJ3Qgc2VuZCBhIG1hbGZvcm1lZFxuICAvLyBwYXlsb2FkIHRoYXQgc2xpcHMgcGFzdCBhIG1pc3NpbmcgY2FzZS1sZXZlbCBjaGVjay5cbiAgaWYgKHZhbGlkYXRlQWN0aW9uKHN0YXRlLCBhY3Rpb24pICE9PSBudWxsKSB7XG4gICAgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcbiAgfVxuICBjb25zdCByZXN1bHQgPSByZWR1Y2VDb3JlKHN0YXRlLCBhY3Rpb24sIHJuZyk7XG4gIHJldHVybiBhcHBseU92ZXJ0aW1lUm91dGluZyhzdGF0ZSwgcmVzdWx0KTtcbn1cblxuLyoqXG4gKiBJZiB3ZSdyZSBpbiBPVCBhbmQgYSBwb3NzZXNzaW9uLWVuZGluZyBldmVudCBqdXN0IGZpcmVkLCByb3V0ZSB0byB0aGVcbiAqIG5leHQgT1QgcG9zc2Vzc2lvbiAob3IgZ2FtZSBlbmQpLiBTa2lwcyB3aGVuIHRoZSBhY3Rpb24gaXMgaXRzZWxmIGFuIE9UXG4gKiBoZWxwZXIgKHNvIHdlIGRvbid0IGRvdWJsZS1yb3V0ZSkuXG4gKi9cbmZ1bmN0aW9uIGFwcGx5T3ZlcnRpbWVSb3V0aW5nKHByZXZTdGF0ZTogR2FtZVN0YXRlLCByZXN1bHQ6IFJlZHVjZVJlc3VsdCk6IFJlZHVjZVJlc3VsdCB7XG4gIC8vIE9ubHkgY29uc2lkZXIgcm91dGluZyB3aGVuIHdlICp3ZXJlKiBpbiBPVC4gKHN0YXJ0T3ZlcnRpbWUgc2V0cyBzdGF0ZS5vdmVydGltZS4pXG4gIGlmICghcHJldlN0YXRlLm92ZXJ0aW1lICYmICFyZXN1bHQuc3RhdGUub3ZlcnRpbWUpIHJldHVybiByZXN1bHQ7XG4gIGlmICghcmVzdWx0LnN0YXRlLm92ZXJ0aW1lKSByZXR1cm4gcmVzdWx0O1xuICBpZiAoIWlzUG9zc2Vzc2lvbkVuZGluZ0luT1QocmVzdWx0LmV2ZW50cykpIHJldHVybiByZXN1bHQ7XG5cbiAgLy8gUEFUIGluIE9UOiBhIFREIHNjb3JlZCwgYnV0IHBvc3Nlc3Npb24gZG9lc24ndCBlbmQgdW50aWwgUEFULzJwdCByZXNvbHZlcy5cbiAgLy8gUEFUX0dPT0QgLyBUV09fUE9JTlRfKiBhcmUgdGhlbXNlbHZlcyBwb3NzZXNzaW9uLWVuZGluZywgc28gdGhleSBETyByb3V0ZS5cbiAgLy8gQWZ0ZXIgcG9zc2Vzc2lvbiBlbmRzLCBkZWNpZGUgbmV4dC5cbiAgY29uc3QgZW5kZWQgPSBlbmRPdmVydGltZVBvc3Nlc3Npb24ocmVzdWx0LnN0YXRlKTtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZTogZW5kZWQuc3RhdGUsXG4gICAgZXZlbnRzOiBbLi4ucmVzdWx0LmV2ZW50cywgLi4uZW5kZWQuZXZlbnRzXSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVkdWNlQ29yZShzdGF0ZTogR2FtZVN0YXRlLCBhY3Rpb246IEFjdGlvbiwgcm5nOiBSbmcpOiBSZWR1Y2VSZXN1bHQge1xuICBzd2l0Y2ggKGFjdGlvbi50eXBlKSB7XG4gICAgY2FzZSBcIlNUQVJUX0dBTUVcIjpcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgcGhhc2U6IFwiQ09JTl9UT1NTXCIsXG4gICAgICAgICAgY2xvY2s6IHtcbiAgICAgICAgICAgIC4uLnN0YXRlLmNsb2NrLFxuICAgICAgICAgICAgcXVhcnRlcjogMSxcbiAgICAgICAgICAgIHF1YXJ0ZXJMZW5ndGhNaW51dGVzOiBhY3Rpb24ucXVhcnRlckxlbmd0aE1pbnV0ZXMsXG4gICAgICAgICAgICBzZWNvbmRzUmVtYWluaW5nOiBhY3Rpb24ucXVhcnRlckxlbmd0aE1pbnV0ZXMgKiA2MCxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHBsYXllcnM6IHtcbiAgICAgICAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICAgICAgICAxOiB7IC4uLnN0YXRlLnBsYXllcnNbMV0sIHRlYW06IHsgaWQ6IGFjdGlvbi50ZWFtc1sxXSB9IH0sXG4gICAgICAgICAgICAyOiB7IC4uLnN0YXRlLnBsYXllcnNbMl0sIHRlYW06IHsgaWQ6IGFjdGlvbi50ZWFtc1syXSB9IH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgZXZlbnRzOiBbeyB0eXBlOiBcIkdBTUVfU1RBUlRFRFwiIH1dLFxuICAgICAgfTtcblxuICAgIGNhc2UgXCJDT0lOX1RPU1NfQ0FMTFwiOiB7XG4gICAgICBjb25zdCBhY3R1YWwgPSBybmcuY29pbkZsaXAoKTtcbiAgICAgIGNvbnN0IHdpbm5lciA9IGFjdGlvbi5jYWxsID09PSBhY3R1YWwgPyBhY3Rpb24ucGxheWVyIDogb3BwKGFjdGlvbi5wbGF5ZXIpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGUsXG4gICAgICAgIGV2ZW50czogW3sgdHlwZTogXCJDT0lOX1RPU1NfUkVTVUxUXCIsIHJlc3VsdDogYWN0dWFsLCB3aW5uZXIgfV0sXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJSRUNFSVZFX0NIT0lDRVwiOiB7XG4gICAgICAvLyBUaGUgY2FsbGVyJ3MgY2hvaWNlIGRldGVybWluZXMgd2hvIHJlY2VpdmVzIHRoZSBvcGVuaW5nIGtpY2tvZmYuXG4gICAgICAvLyBcInJlY2VpdmVcIiBcdTIxOTIgY2FsbGVyIHJlY2VpdmVzOyBcImRlZmVyXCIgXHUyMTkyIGNhbGxlciBraWNrcyAob3Bwb25lbnQgcmVjZWl2ZXMpLlxuICAgICAgY29uc3QgcmVjZWl2ZXIgPSBhY3Rpb24uY2hvaWNlID09PSBcInJlY2VpdmVcIiA/IGFjdGlvbi5wbGF5ZXIgOiBvcHAoYWN0aW9uLnBsYXllcik7XG4gICAgICAvLyBLaWNrZXIgaXMgdGhlIG9wZW5pbmcgb2ZmZW5zZSAodGhleSBraWNrIG9mZik7IHJlY2VpdmVyIGdldHMgdGhlIGJhbGwgYWZ0ZXIuXG4gICAgICBjb25zdCBraWNrZXIgPSBvcHAocmVjZWl2ZXIpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGU6IHtcbiAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICBwaGFzZTogXCJLSUNLT0ZGXCIsXG4gICAgICAgICAgb3BlbmluZ1JlY2VpdmVyOiByZWNlaXZlcixcbiAgICAgICAgICBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZToga2lja2VyIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGV2ZW50czogW3sgdHlwZTogXCJLSUNLT0ZGXCIsIHJlY2VpdmluZ1BsYXllcjogcmVjZWl2ZXIsIGJhbGxPbjogMzUgfV0sXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJSRVNPTFZFX0tJQ0tPRkZcIjoge1xuICAgICAgY29uc3Qgb3B0czogeyBraWNrVHlwZT86IEtpY2tUeXBlOyByZXR1cm5UeXBlPzogUmV0dXJuVHlwZSB9ID0ge307XG4gICAgICBpZiAoYWN0aW9uLmtpY2tUeXBlKSBvcHRzLmtpY2tUeXBlID0gYWN0aW9uLmtpY2tUeXBlO1xuICAgICAgaWYgKGFjdGlvbi5yZXR1cm5UeXBlKSBvcHRzLnJldHVyblR5cGUgPSBhY3Rpb24ucmV0dXJuVHlwZTtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHJlc29sdmVLaWNrb2ZmKHN0YXRlLCBybmcsIG9wdHMpO1xuICAgICAgcmV0dXJuIHsgc3RhdGU6IHJlc3VsdC5zdGF0ZSwgZXZlbnRzOiByZXN1bHQuZXZlbnRzIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIlNUQVJUX09UX1BPU1NFU1NJT05cIjoge1xuICAgICAgY29uc3QgciA9IHN0YXJ0T3ZlcnRpbWVQb3NzZXNzaW9uKHN0YXRlKTtcbiAgICAgIHJldHVybiB7IHN0YXRlOiByLnN0YXRlLCBldmVudHM6IHIuZXZlbnRzIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIlBJQ0tfUExBWVwiOiB7XG4gICAgICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgICAgIGNvbnN0IGlzT2ZmZW5zaXZlQ2FsbCA9IGFjdGlvbi5wbGF5ZXIgPT09IG9mZmVuc2U7XG5cbiAgICAgIC8vIFZhbGlkYXRlLiBJbGxlZ2FsIHBpY2tzIGFyZSBzaWxlbnRseSBuby1vcCdkOyB0aGUgb3JjaGVzdHJhdG9yXG4gICAgICAvLyAoc2VydmVyIC8gVUkpIGlzIHJlc3BvbnNpYmxlIGZvciBzdXJmYWNpbmcgdGhlIGVycm9yIHRvIHRoZSB1c2VyLlxuICAgICAgaWYgKGFjdGlvbi5wbGF5ID09PSBcIkZHXCIgfHwgYWN0aW9uLnBsYXkgPT09IFwiUFVOVFwiIHx8IGFjdGlvbi5wbGF5ID09PSBcIlRXT19QVFwiKSB7XG4gICAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07IC8vIHdyb25nIGFjdGlvbiB0eXBlIGZvciB0aGVzZVxuICAgICAgfVxuICAgICAgaWYgKGFjdGlvbi5wbGF5ID09PSBcIkhNXCIgJiYgIWlzT2ZmZW5zaXZlQ2FsbCkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9OyAvLyBkZWZlbnNlIGNhbid0IGNhbGwgSGFpbCBNYXJ5XG4gICAgICB9XG4gICAgICBjb25zdCBoYW5kID0gc3RhdGUucGxheWVyc1thY3Rpb24ucGxheWVyXS5oYW5kO1xuICAgICAgaWYgKGFjdGlvbi5wbGF5ID09PSBcIkhNXCIgJiYgaGFuZC5ITSA8PSAwKSB7XG4gICAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gICAgICB9XG4gICAgICBpZiAoXG4gICAgICAgIChhY3Rpb24ucGxheSA9PT0gXCJTUlwiIHx8IGFjdGlvbi5wbGF5ID09PSBcIkxSXCIgfHwgYWN0aW9uLnBsYXkgPT09IFwiU1BcIiB8fCBhY3Rpb24ucGxheSA9PT0gXCJMUFwiIHx8IGFjdGlvbi5wbGF5ID09PSBcIlRQXCIpICYmXG4gICAgICAgIGhhbmRbYWN0aW9uLnBsYXldIDw9IDBcbiAgICAgICkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgfVxuICAgICAgLy8gUmVqZWN0IHJlLXBpY2tzIGZvciB0aGUgc2FtZSBzaWRlIGluIHRoZSBzYW1lIHBsYXkuXG4gICAgICBpZiAoaXNPZmZlbnNpdmVDYWxsICYmIHN0YXRlLnBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5KSB7XG4gICAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gICAgICB9XG4gICAgICBpZiAoIWlzT2ZmZW5zaXZlQ2FsbCAmJiBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgfVxuXG4gICAgICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXG4gICAgICAgIHsgdHlwZTogXCJQTEFZX0NBTExFRFwiLCBwbGF5ZXI6IGFjdGlvbi5wbGF5ZXIsIHBsYXk6IGFjdGlvbi5wbGF5IH0sXG4gICAgICBdO1xuXG4gICAgICBjb25zdCBwZW5kaW5nUGljayA9IHtcbiAgICAgICAgb2ZmZW5zZVBsYXk6IGlzT2ZmZW5zaXZlQ2FsbCA/IGFjdGlvbi5wbGF5IDogc3RhdGUucGVuZGluZ1BpY2sub2ZmZW5zZVBsYXksXG4gICAgICAgIGRlZmVuc2VQbGF5OiBpc09mZmVuc2l2ZUNhbGwgPyBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA6IGFjdGlvbi5wbGF5LFxuICAgICAgfTtcblxuICAgICAgLy8gQm90aCB0ZWFtcyBoYXZlIHBpY2tlZCBcdTIwMTQgcmVzb2x2ZS5cbiAgICAgIGlmIChwZW5kaW5nUGljay5vZmZlbnNlUGxheSAmJiBwZW5kaW5nUGljay5kZWZlbnNlUGxheSkge1xuICAgICAgICAvLyAyLXBvaW50IGNvbnZlcnNpb246IFBJQ0tfUExBWSBpbiBUV09fUFRfQ09OViBwaGFzZSByb3V0ZXMgdG8gdGhlXG4gICAgICAgIC8vIGRlZGljYXRlZCAyLXB0IHJlc29sdmVyIChzY29yaW5nIGNhcHBlZCBhdCAyIHB0cywgbm8gUEFUIGN5Y2xlKS5cbiAgICAgICAgLy8gVFAvSE0gb24gYSAyLXB0IHRyeSBhcmUgY29lcmNlZCB0byBTUiBzbyB0aGV5IGNhbid0IG1pcy1zY29yZTpcbiAgICAgICAgLy8gb3RoZXJ3aXNlIGEgVFAgdGhhdCBkZWZhdWx0cyB0byBMUiBhbmQgY3Jvc3NlcyB0aGUgZ29hbCBsaW5lIHdvdWxkXG4gICAgICAgIC8vIHJ1biB0aHJvdWdoIGFwcGx5WWFyZGFnZU91dGNvbWUgYW5kIGVtaXQgVE9VQ0hET1dOICsgdHJhbnNpdGlvbiB0b1xuICAgICAgICAvLyBQQVRfQ0hPSUNFLCBncmFudGluZyA2IHBvaW50cyBhbmQgYSBmdWxsIFBBVCBpbnN0ZWFkIG9mIDIuXG4gICAgICAgIGlmIChzdGF0ZS5waGFzZSA9PT0gXCJUV09fUFRfQ09OVlwiKSB7XG4gICAgICAgICAgY29uc3Qgb2ZmUGxheSA9IGlzUmVndWxhclBsYXkocGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkpXG4gICAgICAgICAgICA/IHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5XG4gICAgICAgICAgICA6IFwiU1JcIjtcbiAgICAgICAgICBjb25zdCBkZWZQbGF5ID0gaXNSZWd1bGFyUGxheShwZW5kaW5nUGljay5kZWZlbnNlUGxheSlcbiAgICAgICAgICAgID8gcGVuZGluZ1BpY2suZGVmZW5zZVBsYXlcbiAgICAgICAgICAgIDogXCJTUlwiO1xuICAgICAgICAgIGNvbnN0IHN0YXRlV2l0aFBpY2s6IEdhbWVTdGF0ZSA9IHtcbiAgICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgICAgcGVuZGluZ1BpY2s6IHsgb2ZmZW5zZVBsYXk6IG9mZlBsYXksIGRlZmVuc2VQbGF5OiBkZWZQbGF5IH0sXG4gICAgICAgICAgfTtcbiAgICAgICAgICBjb25zdCB0cCA9IHJlc29sdmVUd29Qb2ludENvbnZlcnNpb24oXG4gICAgICAgICAgICBzdGF0ZVdpdGhQaWNrLFxuICAgICAgICAgICAgb2ZmUGxheSxcbiAgICAgICAgICAgIGRlZlBsYXksXG4gICAgICAgICAgICBybmcsXG4gICAgICAgICAgKTtcbiAgICAgICAgICByZXR1cm4geyBzdGF0ZTogdHAuc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4udHAuZXZlbnRzXSB9O1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc3RhdGVXaXRoUGljazogR2FtZVN0YXRlID0geyAuLi5zdGF0ZSwgcGVuZGluZ1BpY2sgfTtcblxuICAgICAgICAvLyBIYWlsIE1hcnkgYnkgb2ZmZW5zZSBcdTIwMTQgcmVzb2x2ZXMgaW1tZWRpYXRlbHksIGRlZmVuc2UgcGljayBpZ25vcmVkLlxuICAgICAgICBpZiAocGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPT09IFwiSE1cIikge1xuICAgICAgICAgIGNvbnN0IGhtID0gcmVzb2x2ZUhhaWxNYXJ5KHN0YXRlV2l0aFBpY2ssIHJuZyk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IGhtLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLmhtLmV2ZW50c10gfTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFRyaWNrIFBsYXkgYnkgZWl0aGVyIHNpZGUuIHY1LjEgKHJ1bi5qczoxODg2KTogaWYgYm90aCBwaWNrIFRQLFxuICAgICAgICAvLyBTYW1lIFBsYXkgY29pbiBhbHdheXMgdHJpZ2dlcnMgXHUyMDE0IGZhbGxzIHRocm91Z2ggdG8gU2FtZSBQbGF5IGJlbG93LlxuICAgICAgICBpZiAoXG4gICAgICAgICAgcGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPT09IFwiVFBcIiAmJlxuICAgICAgICAgIHBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5ICE9PSBcIlRQXCJcbiAgICAgICAgKSB7XG4gICAgICAgICAgY29uc3QgdHAgPSByZXNvbHZlT2ZmZW5zaXZlVHJpY2tQbGF5KHN0YXRlV2l0aFBpY2ssIHJuZyk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHRwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLnRwLmV2ZW50c10gfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoXG4gICAgICAgICAgcGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgPT09IFwiVFBcIiAmJlxuICAgICAgICAgIHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ICE9PSBcIlRQXCJcbiAgICAgICAgKSB7XG4gICAgICAgICAgY29uc3QgdHAgPSByZXNvbHZlRGVmZW5zaXZlVHJpY2tQbGF5KHN0YXRlV2l0aFBpY2ssIHJuZyk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHRwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLnRwLmV2ZW50c10gfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPT09IFwiVFBcIiAmJiBwZW5kaW5nUGljay5kZWZlbnNlUGxheSA9PT0gXCJUUFwiKSB7XG4gICAgICAgICAgLy8gQm90aCBUUCBcdTIxOTIgU2FtZSBQbGF5IHVuY29uZGl0aW9uYWxseS5cbiAgICAgICAgICBjb25zdCBzcCA9IHJlc29sdmVTYW1lUGxheShzdGF0ZVdpdGhQaWNrLCBybmcpO1xuICAgICAgICAgIHJldHVybiB7IHN0YXRlOiBzcC5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi5zcC5ldmVudHNdIH07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZWd1bGFyIHZzIHJlZ3VsYXIuXG4gICAgICAgIGlmIChcbiAgICAgICAgICBpc1JlZ3VsYXJQbGF5KHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5KSAmJlxuICAgICAgICAgIGlzUmVndWxhclBsYXkocGVuZGluZ1BpY2suZGVmZW5zZVBsYXkpXG4gICAgICAgICkge1xuICAgICAgICAgIC8vIFNhbWUgcGxheT8gNTAvNTAgY2hhbmNlIHRvIHRyaWdnZXIgU2FtZSBQbGF5IG1lY2hhbmlzbS5cbiAgICAgICAgICAvLyBTb3VyY2U6IHJ1bi5qczoxODg2IChgaWYgKHBsMSA9PT0gcGwyKWApLlxuICAgICAgICAgIGlmIChwZW5kaW5nUGljay5vZmZlbnNlUGxheSA9PT0gcGVuZGluZ1BpY2suZGVmZW5zZVBsYXkpIHtcbiAgICAgICAgICAgIGNvbnN0IHRyaWdnZXIgPSBybmcuY29pbkZsaXAoKTtcbiAgICAgICAgICAgIGlmICh0cmlnZ2VyID09PSBcImhlYWRzXCIpIHtcbiAgICAgICAgICAgICAgY29uc3Qgc3AgPSByZXNvbHZlU2FtZVBsYXkoc3RhdGVXaXRoUGljaywgcm5nKTtcbiAgICAgICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHNwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLnNwLmV2ZW50c10gfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIFRhaWxzOiBmYWxsIHRocm91Z2ggdG8gcmVndWxhciByZXNvbHV0aW9uIChxdWFsaXR5IDUgb3V0Y29tZSkuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgcmVzb2x2ZWQgPSByZXNvbHZlUmVndWxhclBsYXkoXG4gICAgICAgICAgICBzdGF0ZVdpdGhQaWNrLFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBvZmZlbnNlUGxheTogcGVuZGluZ1BpY2sub2ZmZW5zZVBsYXksXG4gICAgICAgICAgICAgIGRlZmVuc2VQbGF5OiBwZW5kaW5nUGljay5kZWZlbnNlUGxheSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBybmcsXG4gICAgICAgICAgKTtcbiAgICAgICAgICByZXR1cm4geyBzdGF0ZTogcmVzb2x2ZWQuc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4ucmVzb2x2ZWQuZXZlbnRzXSB9O1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRGVmZW5zaXZlIHRyaWNrIHBsYXksIEZHLCBQVU5ULCBUV09fUFQgcGlja3MgXHUyMDE0IG5vdCByb3V0ZWQgaGVyZSB5ZXQuXG4gICAgICAgIC8vIEZHL1BVTlQvVFdPX1BUIGFyZSBkcml2ZW4gYnkgRk9VUlRIX0RPV05fQ0hPSUNFIC8gUEFUX0NIT0lDRSBhY3Rpb25zLFxuICAgICAgICAvLyBub3QgYnkgUElDS19QTEFZLiBEZWZlbnNpdmUgVFAgaXMgYSBUT0RPLlxuICAgICAgICByZXR1cm4geyBzdGF0ZTogc3RhdGVXaXRoUGljaywgZXZlbnRzIH07XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7IHN0YXRlOiB7IC4uLnN0YXRlLCBwZW5kaW5nUGljayB9LCBldmVudHMgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiQ0FMTF9USU1FT1VUXCI6IHtcbiAgICAgIGNvbnN0IHAgPSBzdGF0ZS5wbGF5ZXJzW2FjdGlvbi5wbGF5ZXJdO1xuICAgICAgaWYgKHAudGltZW91dHMgPD0gMCkgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcbiAgICAgIGNvbnN0IHJlbWFpbmluZyA9IHAudGltZW91dHMgLSAxO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGU6IHtcbiAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICBwbGF5ZXJzOiB7XG4gICAgICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICAgICAgW2FjdGlvbi5wbGF5ZXJdOiB7IC4uLnAsIHRpbWVvdXRzOiByZW1haW5pbmcgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBldmVudHM6IFt7IHR5cGU6IFwiVElNRU9VVF9DQUxMRURcIiwgcGxheWVyOiBhY3Rpb24ucGxheWVyLCByZW1haW5pbmcgfV0sXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJBQ0NFUFRfUEVOQUxUWVwiOlxuICAgIGNhc2UgXCJERUNMSU5FX1BFTkFMVFlcIjpcbiAgICAgIC8vIFBlbmFsdGllcyBhcmUgY2FwdHVyZWQgYXMgZXZlbnRzIGF0IHJlc29sdXRpb24gdGltZSwgYnV0IGFjY2VwdC9kZWNsaW5lXG4gICAgICAvLyBmbG93IHJlcXVpcmVzIHN0YXRlIG5vdCB5ZXQgbW9kZWxlZCAocGVuZGluZyBwZW5hbHR5KS4gVE9ETyB3aGVuXG4gICAgICAvLyBwZW5hbHR5IG1lY2hhbmljcyBhcmUgcG9ydGVkIGZyb20gcnVuLmpzLlxuICAgICAgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcblxuICAgIGNhc2UgXCJQQVRfQ0hPSUNFXCI6IHtcbiAgICAgIGNvbnN0IHNjb3JlciA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gICAgICAvLyAzT1QrIHJlcXVpcmVzIDItcG9pbnQgY29udmVyc2lvbi4gU2lsZW50bHkgc3Vic3RpdHV0ZSBldmVuIGlmIFwia2lja1wiXG4gICAgICAvLyB3YXMgc2VudCAobWF0Y2hlcyB2NS4xJ3MgXCJtdXN0XCIgYmVoYXZpb3IgYXQgcnVuLmpzOjE2NDEpLlxuICAgICAgY29uc3QgZWZmZWN0aXZlQ2hvaWNlID1cbiAgICAgICAgc3RhdGUub3ZlcnRpbWUgJiYgc3RhdGUub3ZlcnRpbWUucGVyaW9kID49IDNcbiAgICAgICAgICA/IFwidHdvX3BvaW50XCJcbiAgICAgICAgICA6IGFjdGlvbi5jaG9pY2U7XG4gICAgICBpZiAoZWZmZWN0aXZlQ2hvaWNlID09PSBcImtpY2tcIikge1xuICAgICAgICAvLyBBc3N1bWUgYXV0b21hdGljIGluIHY1LjEgXHUyMDE0IG5vIG1lY2hhbmljIHJlY29yZGVkIGZvciBQQVQga2lja3MuXG4gICAgICAgIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgICAgICBbc2NvcmVyXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0uc2NvcmUgKyAxIH0sXG4gICAgICAgIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdGF0ZToge1xuICAgICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgZXZlbnRzOiBbeyB0eXBlOiBcIlBBVF9HT09EXCIsIHBsYXllcjogc2NvcmVyIH1dLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgLy8gdHdvX3BvaW50IFx1MjE5MiB0cmFuc2l0aW9uIHRvIFRXT19QVF9DT05WIHBoYXNlOyBhIFBJQ0tfUExBWSByZXNvbHZlcyBpdC5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgcGhhc2U6IFwiVFdPX1BUX0NPTlZcIixcbiAgICAgICAgICBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgYmFsbE9uOiA5NywgZmlyc3REb3duQXQ6IDEwMCwgZG93bjogMSB9LFxuICAgICAgICB9LFxuICAgICAgICBldmVudHM6IFtdLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiRk9VUlRIX0RPV05fQ0hPSUNFXCI6IHtcbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlID09PSBcImdvXCIpIHtcbiAgICAgICAgLy8gTm90aGluZyB0byBkbyBcdTIwMTQgdGhlIG5leHQgUElDS19QTEFZIHdpbGwgcmVzb2x2ZSBub3JtYWxseSBmcm9tIDR0aCBkb3duLlxuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgfVxuICAgICAgaWYgKGFjdGlvbi5jaG9pY2UgPT09IFwicHVudFwiKSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHJlc29sdmVQdW50KHN0YXRlLCBybmcpO1xuICAgICAgICByZXR1cm4geyBzdGF0ZTogcmVzdWx0LnN0YXRlLCBldmVudHM6IHJlc3VsdC5ldmVudHMgfTtcbiAgICAgIH1cbiAgICAgIC8vIGZnXG4gICAgICBjb25zdCByZXN1bHQgPSByZXNvbHZlRmllbGRHb2FsKHN0YXRlLCBybmcpO1xuICAgICAgcmV0dXJuIHsgc3RhdGU6IHJlc3VsdC5zdGF0ZSwgZXZlbnRzOiByZXN1bHQuZXZlbnRzIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIkZPUkZFSVRcIjoge1xuICAgICAgY29uc3Qgd2lubmVyID0gb3BwKGFjdGlvbi5wbGF5ZXIpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGU6IHsgLi4uc3RhdGUsIHBoYXNlOiBcIkdBTUVfT1ZFUlwiIH0sXG4gICAgICAgIGV2ZW50czogW3sgdHlwZTogXCJHQU1FX09WRVJcIiwgd2lubmVyIH1dLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiVElDS19DTE9DS1wiOiB7XG4gICAgICBjb25zdCBwcmV2ID0gc3RhdGUuY2xvY2suc2Vjb25kc1JlbWFpbmluZztcbiAgICAgIGNvbnN0IG5leHQgPSBNYXRoLm1heCgwLCBwcmV2IC0gYWN0aW9uLnNlY29uZHMpO1xuICAgICAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW3sgdHlwZTogXCJDTE9DS19USUNLRURcIiwgc2Vjb25kczogYWN0aW9uLnNlY29uZHMgfV07XG5cbiAgICAgIC8vIFR3by1taW51dGUgd2FybmluZzogY3Jvc3NpbmcgMTIwIHNlY29uZHMgaW4gUTIgb3IgUTQgdHJpZ2dlcnMgYW4gZXZlbnQuXG4gICAgICBpZiAoXG4gICAgICAgIChzdGF0ZS5jbG9jay5xdWFydGVyID09PSAyIHx8IHN0YXRlLmNsb2NrLnF1YXJ0ZXIgPT09IDQpICYmXG4gICAgICAgIHByZXYgPiAxMjAgJiZcbiAgICAgICAgbmV4dCA8PSAxMjBcbiAgICAgICkge1xuICAgICAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFdPX01JTlVURV9XQVJOSU5HXCIgfSk7XG4gICAgICB9XG5cbiAgICAgIC8vIFItMjggWmVyby1zZWNvbmQgcGxheTogd2hlbiB0aGUgY2xvY2sgZmlyc3QgaGl0cyAwIChwcmV2ID4gMCxcbiAgICAgIC8vIG5leHQgPT09IDApLCBlbWl0IExBU1RfQ0hBTkNFX1RPX09GRkVSRUQgYW5kIGhvbGQgdGhlIHF1YXJ0ZXJcbiAgICAgIC8vIG9wZW4uIEEgZmluYWwgcGxheSBydW5zIGF0IDA6MDA7IHRoZSBxdWFydGVyIGFjdHVhbGx5IGVuZHMgb25cbiAgICAgIC8vIHRoZSBORVhUIG5vbi16ZXJvIHRpY2sgKHByZXYgPT09IDAgJiYgYWN0aW9uLnNlY29uZHMgPiAwKS5cbiAgICAgIC8vIEEgVE8gY2FsbGVkIGR1cmluZyB0aGUgMDowMCBwbGF5IGRpc3BhdGNoZXMgVElDS19DTE9DSygwKSBmcm9tXG4gICAgICAvLyB0aGUgZHJpdmVyLCB3aGljaCBsZWF2ZXMgdGhlIGNsb2NrIGF0IDAgd2l0aG91dCB0cmFuc2l0aW9uaW5nLlxuICAgICAgaWYgKHByZXYgPiAwICYmIG5leHQgPT09IDApIHtcbiAgICAgICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkxBU1RfQ0hBTkNFX1RPX09GRkVSRURcIiwgcXVhcnRlcjogc3RhdGUuY2xvY2sucXVhcnRlciB9KTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdGF0ZTogeyAuLi5zdGF0ZSwgY2xvY2s6IHsgLi4uc3RhdGUuY2xvY2ssIHNlY29uZHNSZW1haW5pbmc6IDAgfSB9LFxuICAgICAgICAgIGV2ZW50cyxcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgLy8gQ2xvY2sgd2FzIGFscmVhZHkgYXQgMCBhbmQgYSBub24temVybyB0aWNrIHdhcyBkaXNwYXRjaGVkIFx1MjE5MiB0aGVcbiAgICAgIC8vIGZpbmFsLXBsYXkgd2luZG93IGlzIGNsb3NlZCwgcXVhcnRlciBhY3R1YWxseSBlbmRzIG5vdy5cbiAgICAgIGlmIChwcmV2ID09PSAwICYmIGFjdGlvbi5zZWNvbmRzID4gMCkge1xuICAgICAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiUVVBUlRFUl9FTkRFRFwiLCBxdWFydGVyOiBzdGF0ZS5jbG9jay5xdWFydGVyIH0pO1xuICAgICAgICAvLyBRMVx1MjE5MlEyIGFuZCBRM1x1MjE5MlE0OiByb2xsIG92ZXIgY2xvY2ssIHNhbWUgaGFsZiwgc2FtZSBwb3NzZXNzaW9uIGNvbnRpbnVlcy5cbiAgICAgICAgaWYgKHN0YXRlLmNsb2NrLnF1YXJ0ZXIgPT09IDEgfHwgc3RhdGUuY2xvY2sucXVhcnRlciA9PT0gMykge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0ZToge1xuICAgICAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICAgICAgY2xvY2s6IHtcbiAgICAgICAgICAgICAgICAuLi5zdGF0ZS5jbG9jayxcbiAgICAgICAgICAgICAgICBxdWFydGVyOiBzdGF0ZS5jbG9jay5xdWFydGVyICsgMSxcbiAgICAgICAgICAgICAgICBzZWNvbmRzUmVtYWluaW5nOiBzdGF0ZS5jbG9jay5xdWFydGVyTGVuZ3RoTWludXRlcyAqIDYwLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGV2ZW50cyxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIC8vIEVuZCBvZiBRMiA9IGhhbGZ0aW1lLiBRNCBlbmQgPSByZWd1bGF0aW9uIG92ZXIuXG4gICAgICAgIGlmIChzdGF0ZS5jbG9jay5xdWFydGVyID09PSAyKSB7XG4gICAgICAgICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkhBTEZfRU5ERURcIiB9KTtcbiAgICAgICAgICAvLyBSZWNlaXZlciBvZiBvcGVuaW5nIGtpY2tvZmYga2lja3MgdGhlIHNlY29uZCBoYWxmOyBmbGlwIHBvc3Nlc3Npb24uXG4gICAgICAgICAgY29uc3Qgc2Vjb25kSGFsZlJlY2VpdmVyID1cbiAgICAgICAgICAgIHN0YXRlLm9wZW5pbmdSZWNlaXZlciA9PT0gbnVsbCA/IDEgOiBvcHAoc3RhdGUub3BlbmluZ1JlY2VpdmVyKTtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdGU6IHtcbiAgICAgICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgICAgIHBoYXNlOiBcIktJQ0tPRkZcIixcbiAgICAgICAgICAgICAgY2xvY2s6IHtcbiAgICAgICAgICAgICAgICAuLi5zdGF0ZS5jbG9jayxcbiAgICAgICAgICAgICAgICBxdWFydGVyOiAzLFxuICAgICAgICAgICAgICAgIHNlY29uZHNSZW1haW5pbmc6IHN0YXRlLmNsb2NrLnF1YXJ0ZXJMZW5ndGhNaW51dGVzICogNjAsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiBvcHAoc2Vjb25kSGFsZlJlY2VpdmVyKSB9LFxuICAgICAgICAgICAgICAvLyBSZWZyZXNoIHRpbWVvdXRzIGZvciBuZXcgaGFsZi5cbiAgICAgICAgICAgICAgcGxheWVyczoge1xuICAgICAgICAgICAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICAgICAgICAgICAgMTogeyAuLi5zdGF0ZS5wbGF5ZXJzWzFdLCB0aW1lb3V0czogMyB9LFxuICAgICAgICAgICAgICAgIDI6IHsgLi4uc3RhdGUucGxheWVyc1syXSwgdGltZW91dHM6IDMgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBldmVudHMsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICAvLyBRNCBlbmRlZC5cbiAgICAgICAgY29uc3QgcDEgPSBzdGF0ZS5wbGF5ZXJzWzFdLnNjb3JlO1xuICAgICAgICBjb25zdCBwMiA9IHN0YXRlLnBsYXllcnNbMl0uc2NvcmU7XG4gICAgICAgIGlmIChwMSAhPT0gcDIpIHtcbiAgICAgICAgICBjb25zdCB3aW5uZXIgPSBwMSA+IHAyID8gMSA6IDI7XG4gICAgICAgICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkdBTUVfT1ZFUlwiLCB3aW5uZXIgfSk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHsgLi4uc3RhdGUsIHBoYXNlOiBcIkdBTUVfT1ZFUlwiIH0sIGV2ZW50cyB9O1xuICAgICAgICB9XG4gICAgICAgIC8vIFRpZWQgXHUyMDE0IGhlYWQgdG8gb3ZlcnRpbWUuXG4gICAgICAgIGNvbnN0IG90Q2xvY2sgPSB7IC4uLnN0YXRlLmNsb2NrLCBxdWFydGVyOiA1LCBzZWNvbmRzUmVtYWluaW5nOiAwIH07XG4gICAgICAgIGNvbnN0IG90ID0gc3RhcnRPdmVydGltZSh7IC4uLnN0YXRlLCBjbG9jazogb3RDbG9jayB9KTtcbiAgICAgICAgZXZlbnRzLnB1c2goLi4ub3QuZXZlbnRzKTtcbiAgICAgICAgcmV0dXJuIHsgc3RhdGU6IG90LnN0YXRlLCBldmVudHMgfTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGU6IHsgLi4uc3RhdGUsIGNsb2NrOiB7IC4uLnN0YXRlLmNsb2NrLCBzZWNvbmRzUmVtYWluaW5nOiBuZXh0IH0gfSxcbiAgICAgICAgZXZlbnRzLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBkZWZhdWx0OiB7XG4gICAgICAvLyBFeGhhdXN0aXZlbmVzcyBjaGVjayBcdTIwMTQgYWRkaW5nIGEgbmV3IEFjdGlvbiB2YXJpYW50IHdpdGhvdXQgaGFuZGxpbmcgaXRcbiAgICAgIC8vIGhlcmUgd2lsbCBwcm9kdWNlIGEgY29tcGlsZSBlcnJvci5cbiAgICAgIGNvbnN0IF9leGhhdXN0aXZlOiBuZXZlciA9IGFjdGlvbjtcbiAgICAgIHZvaWQgX2V4aGF1c3RpdmU7XG4gICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIENvbnZlbmllbmNlIGZvciByZXBsYXlpbmcgYSBzZXF1ZW5jZSBvZiBhY3Rpb25zIFx1MjAxNCB1c2VmdWwgZm9yIHRlc3RzIGFuZFxuICogZm9yIHNlcnZlci1zaWRlIGdhbWUgcmVwbGF5IGZyb20gYWN0aW9uIGxvZy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlZHVjZU1hbnkoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIGFjdGlvbnM6IEFjdGlvbltdLFxuICBybmc6IFJuZyxcbik6IFJlZHVjZVJlc3VsdCB7XG4gIGxldCBjdXJyZW50ID0gc3RhdGU7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGFjdGlvbiBvZiBhY3Rpb25zKSB7XG4gICAgY29uc3QgcmVzdWx0ID0gcmVkdWNlKGN1cnJlbnQsIGFjdGlvbiwgcm5nKTtcbiAgICBjdXJyZW50ID0gcmVzdWx0LnN0YXRlO1xuICAgIGV2ZW50cy5wdXNoKC4uLnJlc3VsdC5ldmVudHMpO1xuICB9XG4gIHJldHVybiB7IHN0YXRlOiBjdXJyZW50LCBldmVudHMgfTtcbn1cbiIsICIvKipcbiAqIFJORyBhYnN0cmFjdGlvbi5cbiAqXG4gKiBUaGUgZW5naW5lIG5ldmVyIHJlYWNoZXMgZm9yIGBNYXRoLnJhbmRvbSgpYCBkaXJlY3RseS4gQWxsIHJhbmRvbW5lc3MgaXNcbiAqIHNvdXJjZWQgZnJvbSBhbiBgUm5nYCBpbnN0YW5jZSBwYXNzZWQgaW50byBgcmVkdWNlKClgLiBUaGlzIGlzIHdoYXQgbWFrZXNcbiAqIHRoZSBlbmdpbmUgZGV0ZXJtaW5pc3RpYyBhbmQgdGVzdGFibGUuXG4gKlxuICogSW4gcHJvZHVjdGlvbiwgdGhlIFN1cGFiYXNlIEVkZ2UgRnVuY3Rpb24gY3JlYXRlcyBhIHNlZWRlZCBSTkcgcGVyIGdhbWVcbiAqIChzZWVkIHN0b3JlZCBhbG9uZ3NpZGUgZ2FtZSBzdGF0ZSksIHNvIGEgY29tcGxldGUgZ2FtZSBjYW4gYmUgcmVwbGF5ZWRcbiAqIGRldGVybWluaXN0aWNhbGx5IGZyb20gaXRzIGFjdGlvbiBsb2cgXHUyMDE0IHVzZWZ1bCBmb3IgYnVnIHJlcG9ydHMsIHJlY2FwXG4gKiBnZW5lcmF0aW9uLCBhbmQgXCJ3YXRjaCB0aGUgZ2FtZSBiYWNrXCIgZmVhdHVyZXMuXG4gKi9cblxuZXhwb3J0IGludGVyZmFjZSBSbmcge1xuICAvKiogSW5jbHVzaXZlIGJvdGggZW5kcy4gKi9cbiAgaW50QmV0d2VlbihtaW5JbmNsdXNpdmU6IG51bWJlciwgbWF4SW5jbHVzaXZlOiBudW1iZXIpOiBudW1iZXI7XG4gIC8qKiBSZXR1cm5zIFwiaGVhZHNcIiBvciBcInRhaWxzXCIuICovXG4gIGNvaW5GbGlwKCk6IFwiaGVhZHNcIiB8IFwidGFpbHNcIjtcbiAgLyoqIFJldHVybnMgMS02LiAqL1xuICBkNigpOiAxIHwgMiB8IDMgfCA0IHwgNSB8IDY7XG59XG5cbi8qKlxuICogTXVsYmVycnkzMiBcdTIwMTQgYSBzbWFsbCwgZmFzdCwgd2VsbC1kaXN0cmlidXRlZCBzZWVkZWQgUFJORy4gU3VmZmljaWVudCBmb3JcbiAqIGEgY2FyZC1kcmF3aW5nIGZvb3RiYWxsIGdhbWU7IG5vdCBmb3IgY3J5cHRvZ3JhcGh5LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2VlZGVkUm5nKHNlZWQ6IG51bWJlcik6IFJuZyB7XG4gIGxldCBzdGF0ZSA9IHNlZWQgPj4+IDA7XG5cbiAgY29uc3QgbmV4dCA9ICgpOiBudW1iZXIgPT4ge1xuICAgIHN0YXRlID0gKHN0YXRlICsgMHg2ZDJiNzlmNSkgPj4+IDA7XG4gICAgbGV0IHQgPSBzdGF0ZTtcbiAgICB0ID0gTWF0aC5pbXVsKHQgXiAodCA+Pj4gMTUpLCB0IHwgMSk7XG4gICAgdCBePSB0ICsgTWF0aC5pbXVsKHQgXiAodCA+Pj4gNyksIHQgfCA2MSk7XG4gICAgcmV0dXJuICgodCBeICh0ID4+PiAxNCkpID4+PiAwKSAvIDQyOTQ5NjcyOTY7XG4gIH07XG5cbiAgcmV0dXJuIHtcbiAgICBpbnRCZXR3ZWVuKG1pbiwgbWF4KSB7XG4gICAgICByZXR1cm4gTWF0aC5mbG9vcihuZXh0KCkgKiAobWF4IC0gbWluICsgMSkpICsgbWluO1xuICAgIH0sXG4gICAgY29pbkZsaXAoKSB7XG4gICAgICByZXR1cm4gbmV4dCgpIDwgMC41ID8gXCJoZWFkc1wiIDogXCJ0YWlsc1wiO1xuICAgIH0sXG4gICAgZDYoKSB7XG4gICAgICByZXR1cm4gKE1hdGguZmxvb3IobmV4dCgpICogNikgKyAxKSBhcyAxIHwgMiB8IDMgfCA0IHwgNSB8IDY7XG4gICAgfSxcbiAgfTtcbn1cbiIsICIvKipcbiAqIFB1cmUgb3V0Y29tZS10YWJsZSBoZWxwZXJzIGZvciBzcGVjaWFsIHBsYXlzLiBUaGVzZSBhcmUgZXh0cmFjdGVkXG4gKiBmcm9tIHRoZSBmdWxsIHJlc29sdmVycyBzbyB0aGF0IGNvbnN1bWVycyAobGlrZSB2NS4xJ3MgYXN5bmMgY29kZVxuICogcGF0aHMpIGNhbiBsb29rIHVwIHRoZSBydWxlIG91dGNvbWUgd2l0aG91dCBydW5uaW5nIHRoZSBlbmdpbmUnc1xuICogc3RhdGUgdHJhbnNpdGlvbi5cbiAqXG4gKiBPbmNlIFBoYXNlIDIgY29sbGFwc2VzIHRoZSBvcmNoZXN0cmF0b3IgaW50byBgZW5naW5lLnJlZHVjZWAsIHRoZXNlXG4gKiBoZWxwZXJzIGJlY29tZSBhbiBpbnRlcm5hbCBpbXBsZW1lbnRhdGlvbiBkZXRhaWwuIFVudGlsIHRoZW4sIHRoZXlcbiAqIGxldCB2NS4xIHVzZSB0aGUgZW5naW5lIGFzIHRoZSBzb3VyY2Ugb2YgdHJ1dGggZm9yIGdhbWUgcnVsZXMgd2hpbGVcbiAqIGtlZXBpbmcgaXRzIGltcGVyYXRpdmUgZmxvdy5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IE11bHRpcGxpZXJDYXJkTmFtZSB9IGZyb20gXCIuLi95YXJkYWdlLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFBsYXllcklkIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5cbi8vIC0tLS0tLS0tLS0gU2FtZSBQbGF5IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgdHlwZSBTYW1lUGxheU91dGNvbWUgPVxuICB8IHsga2luZDogXCJiaWdfcGxheVwiOyBiZW5lZmljaWFyeTogXCJvZmZlbnNlXCIgfCBcImRlZmVuc2VcIiB9XG4gIHwgeyBraW5kOiBcIm11bHRpcGxpZXJcIjsgdmFsdWU6IG51bWJlcjsgZHJhd1lhcmRzOiBib29sZWFuIH1cbiAgfCB7IGtpbmQ6IFwiaW50ZXJjZXB0aW9uXCIgfVxuICB8IHsga2luZDogXCJub19nYWluXCIgfTtcblxuLyoqXG4gKiB2NS4xJ3MgU2FtZSBQbGF5IHRhYmxlIChydW4uanM6MTg5OSkuXG4gKlxuICogICBLaW5nICAgIFx1MjE5MiBCaWcgUGxheSAob2ZmZW5zZSBpZiBoZWFkcywgZGVmZW5zZSBpZiB0YWlscylcbiAqICAgUXVlZW4gKyBoZWFkcyBcdTIxOTIgKzN4IG11bHRpcGxpZXIgKGRyYXcgeWFyZHMpXG4gKiAgIFF1ZWVuICsgdGFpbHMgXHUyMTkyIDB4IG11bHRpcGxpZXIgKG5vIHlhcmRzLCBubyBnYWluKVxuICogICBKYWNrICArIGhlYWRzIFx1MjE5MiAweCBtdWx0aXBsaWVyXG4gKiAgIEphY2sgICsgdGFpbHMgXHUyMTkyIC0zeCBtdWx0aXBsaWVyIChkcmF3IHlhcmRzKVxuICogICAxMCAgICArIGhlYWRzIFx1MjE5MiBJTlRFUkNFUFRJT05cbiAqICAgMTAgICAgKyB0YWlscyBcdTIxOTIgMCB5YXJkcyAobm8gbWVjaGFuaWMpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYW1lUGxheU91dGNvbWUoXG4gIGNhcmQ6IE11bHRpcGxpZXJDYXJkTmFtZSxcbiAgY29pbjogXCJoZWFkc1wiIHwgXCJ0YWlsc1wiLFxuKTogU2FtZVBsYXlPdXRjb21lIHtcbiAgY29uc3QgaGVhZHMgPSBjb2luID09PSBcImhlYWRzXCI7XG4gIGlmIChjYXJkID09PSBcIktpbmdcIikgcmV0dXJuIHsga2luZDogXCJiaWdfcGxheVwiLCBiZW5lZmljaWFyeTogaGVhZHMgPyBcIm9mZmVuc2VcIiA6IFwiZGVmZW5zZVwiIH07XG4gIGlmIChjYXJkID09PSBcIjEwXCIpIHJldHVybiBoZWFkcyA/IHsga2luZDogXCJpbnRlcmNlcHRpb25cIiB9IDogeyBraW5kOiBcIm5vX2dhaW5cIiB9O1xuICBpZiAoY2FyZCA9PT0gXCJRdWVlblwiKSB7XG4gICAgcmV0dXJuIGhlYWRzXG4gICAgICA/IHsga2luZDogXCJtdWx0aXBsaWVyXCIsIHZhbHVlOiAzLCBkcmF3WWFyZHM6IHRydWUgfVxuICAgICAgOiB7IGtpbmQ6IFwibXVsdGlwbGllclwiLCB2YWx1ZTogMCwgZHJhd1lhcmRzOiBmYWxzZSB9O1xuICB9XG4gIC8vIEphY2tcbiAgcmV0dXJuIGhlYWRzXG4gICAgPyB7IGtpbmQ6IFwibXVsdGlwbGllclwiLCB2YWx1ZTogMCwgZHJhd1lhcmRzOiBmYWxzZSB9XG4gICAgOiB7IGtpbmQ6IFwibXVsdGlwbGllclwiLCB2YWx1ZTogLTMsIGRyYXdZYXJkczogdHJ1ZSB9O1xufVxuXG4vLyAtLS0tLS0tLS0tIFRyaWNrIFBsYXkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IHR5cGUgVHJpY2tQbGF5T3V0Y29tZSA9XG4gIHwgeyBraW5kOiBcImJpZ19wbGF5XCI7IGJlbmVmaWNpYXJ5OiBQbGF5ZXJJZCB9XG4gIHwgeyBraW5kOiBcInBlbmFsdHlcIjsgcmF3WWFyZHM6IG51bWJlciB9XG4gIHwgeyBraW5kOiBcIm11bHRpcGxpZXJcIjsgdmFsdWU6IG51bWJlciB9XG4gIHwgeyBraW5kOiBcIm92ZXJsYXlcIjsgcGxheTogXCJMUFwiIHwgXCJMUlwiOyBib251czogbnVtYmVyIH07XG5cbi8qKlxuICogdjUuMSdzIFRyaWNrIFBsYXkgdGFibGUgKHJ1bi5qczoxOTg3KS4gQ2FsbGVyID0gcGxheWVyIHdobyBjYWxsZWQgdGhlXG4gKiBUcmljayBQbGF5IChvZmZlbnNlIG9yIGRlZmVuc2UpLiBEaWUgcm9sbCBvdXRjb21lcyAoZnJvbSBjYWxsZXIncyBQT1YpOlxuICpcbiAqICAgMSBcdTIxOTIgb3ZlcmxheSBMUCB3aXRoICs1IGJvbnVzIChzaWducyBmbGlwIGZvciBkZWZlbnNpdmUgY2FsbGVyKVxuICogICAyIFx1MjE5MiAxNS15YXJkIHBlbmFsdHkgb24gb3Bwb25lbnRcbiAqICAgMyBcdTIxOTIgZml4ZWQgLTN4IG11bHRpcGxpZXIsIGRyYXcgeWFyZHNcbiAqICAgNCBcdTIxOTIgZml4ZWQgKzR4IG11bHRpcGxpZXIsIGRyYXcgeWFyZHNcbiAqICAgNSBcdTIxOTIgQmlnIFBsYXkgZm9yIGNhbGxlclxuICogICA2IFx1MjE5MiBvdmVybGF5IExSIHdpdGggKzUgYm9udXNcbiAqXG4gKiBgcmF3WWFyZHNgIG9uIHBlbmFsdHkgaXMgc2lnbmVkIGZyb20gb2ZmZW5zZSBQT1Y6IHBvc2l0aXZlID0gZ2FpbiBmb3JcbiAqIG9mZmVuc2UgKG9mZmVuc2l2ZSBUcmljayBQbGF5IHJvbGw9MiksIG5lZ2F0aXZlID0gbG9zcyAoZGVmZW5zaXZlKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRyaWNrUGxheU91dGNvbWUoXG4gIGNhbGxlcjogUGxheWVySWQsXG4gIG9mZmVuc2U6IFBsYXllcklkLFxuICBkaWU6IDEgfCAyIHwgMyB8IDQgfCA1IHwgNixcbik6IFRyaWNrUGxheU91dGNvbWUge1xuICBjb25zdCBjYWxsZXJJc09mZmVuc2UgPSBjYWxsZXIgPT09IG9mZmVuc2U7XG5cbiAgaWYgKGRpZSA9PT0gNSkgcmV0dXJuIHsga2luZDogXCJiaWdfcGxheVwiLCBiZW5lZmljaWFyeTogY2FsbGVyIH07XG5cbiAgaWYgKGRpZSA9PT0gMikge1xuICAgIGNvbnN0IHJhd1lhcmRzID0gY2FsbGVySXNPZmZlbnNlID8gMTUgOiAtMTU7XG4gICAgcmV0dXJuIHsga2luZDogXCJwZW5hbHR5XCIsIHJhd1lhcmRzIH07XG4gIH1cblxuICBpZiAoZGllID09PSAzKSByZXR1cm4geyBraW5kOiBcIm11bHRpcGxpZXJcIiwgdmFsdWU6IC0zIH07XG4gIGlmIChkaWUgPT09IDQpIHJldHVybiB7IGtpbmQ6IFwibXVsdGlwbGllclwiLCB2YWx1ZTogNCB9O1xuXG4gIC8vIGRpZSAxIG9yIDZcbiAgY29uc3QgcGxheSA9IGRpZSA9PT0gMSA/IFwiTFBcIiA6IFwiTFJcIjtcbiAgY29uc3QgYm9udXMgPSBjYWxsZXJJc09mZmVuc2UgPyA1IDogLTU7XG4gIHJldHVybiB7IGtpbmQ6IFwib3ZlcmxheVwiLCBwbGF5LCBib251cyB9O1xufVxuXG4vLyAtLS0tLS0tLS0tIEJpZyBQbGF5IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IHR5cGUgQmlnUGxheU91dGNvbWUgPVxuICB8IHsga2luZDogXCJvZmZlbnNlX2dhaW5cIjsgeWFyZHM6IG51bWJlciB9XG4gIHwgeyBraW5kOiBcIm9mZmVuc2VfdGRcIiB9XG4gIHwgeyBraW5kOiBcImRlZmVuc2VfcGVuYWx0eVwiOyByYXdZYXJkczogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6IFwiZGVmZW5zZV9mdW1ibGVfcmV0dXJuXCI7IHlhcmRzOiBudW1iZXIgfVxuICB8IHsga2luZDogXCJkZWZlbnNlX2Z1bWJsZV90ZFwiIH07XG5cbi8qKlxuICogdjUuMSdzIEJpZyBQbGF5IHRhYmxlIChydW4uanM6MTkzMykuIGJlbmVmaWNpYXJ5ID0gd2hvIGJlbmVmaXRzXG4gKiAob2ZmZW5zZSBvciBkZWZlbnNlKS5cbiAqXG4gKiBPZmZlbnNlOlxuICogICAxLTMgXHUyMTkyICsyNSB5YXJkc1xuICogICA0LTUgXHUyMTkyIG1heChoYWxmLXRvLWdvYWwsIDQwKVxuICogICA2ICAgXHUyMTkyIFREXG4gKiBEZWZlbnNlOlxuICogICAxLTMgXHUyMTkyIDEwLXlhcmQgcGVuYWx0eSBvbiBvZmZlbnNlIChyZXBlYXQgZG93bilcbiAqICAgNC01IFx1MjE5MiBmdW1ibGUsIGRlZmVuc2UgcmV0dXJucyBtYXgoaGFsZi10by1nb2FsLCAyNSlcbiAqICAgNiAgIFx1MjE5MiBmdW1ibGUsIGRlZmVuc2l2ZSBURFxuICovXG4vLyAtLS0tLS0tLS0tIFB1bnQgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogUHVudCByZXR1cm4gbXVsdGlwbGllciBieSBkcmF3biBtdWx0aXBsaWVyIGNhcmQgKHJ1bi5qczoyMTk2KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwdW50UmV0dXJuTXVsdGlwbGllcihjYXJkOiBNdWx0aXBsaWVyQ2FyZE5hbWUpOiBudW1iZXIge1xuICBzd2l0Y2ggKGNhcmQpIHtcbiAgICBjYXNlIFwiS2luZ1wiOiByZXR1cm4gNztcbiAgICBjYXNlIFwiUXVlZW5cIjogcmV0dXJuIDQ7XG4gICAgY2FzZSBcIkphY2tcIjogcmV0dXJuIDE7XG4gICAgY2FzZSBcIjEwXCI6IHJldHVybiAtMC41O1xuICB9XG59XG5cbi8qKlxuICogUHVudCBraWNrIGRpc3RhbmNlIGZvcm11bGEgKHJ1bi5qczoyMTQzKTpcbiAqICAgMTAgKiB5YXJkc0NhcmQgLyAyICsgMjAgKiAoY29pbiA9PT0gXCJoZWFkc1wiID8gMSA6IDApXG4gKiB5YXJkc0NhcmQgaXMgdGhlIDEtMTAgY2FyZC4gUmFuZ2U6IDUtNzAgeWFyZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwdW50S2lja0Rpc3RhbmNlKHlhcmRzQ2FyZDogbnVtYmVyLCBjb2luOiBcImhlYWRzXCIgfCBcInRhaWxzXCIpOiBudW1iZXIge1xuICByZXR1cm4gKDEwICogeWFyZHNDYXJkKSAvIDIgKyAoY29pbiA9PT0gXCJoZWFkc1wiID8gMjAgOiAwKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJpZ1BsYXlPdXRjb21lKFxuICBiZW5lZmljaWFyeTogUGxheWVySWQsXG4gIG9mZmVuc2U6IFBsYXllcklkLFxuICBkaWU6IDEgfCAyIHwgMyB8IDQgfCA1IHwgNixcbiAgLyoqIGJhbGxPbiBmcm9tIG9mZmVuc2UgUE9WICgwLTEwMCkuICovXG4gIGJhbGxPbjogbnVtYmVyLFxuKTogQmlnUGxheU91dGNvbWUge1xuICBjb25zdCBiZW5lZml0c09mZmVuc2UgPSBiZW5lZmljaWFyeSA9PT0gb2ZmZW5zZTtcblxuICBpZiAoYmVuZWZpdHNPZmZlbnNlKSB7XG4gICAgaWYgKGRpZSA9PT0gNikgcmV0dXJuIHsga2luZDogXCJvZmZlbnNlX3RkXCIgfTtcbiAgICBpZiAoZGllIDw9IDMpIHJldHVybiB7IGtpbmQ6IFwib2ZmZW5zZV9nYWluXCIsIHlhcmRzOiAyNSB9O1xuICAgIGNvbnN0IGhhbGZUb0dvYWwgPSBNYXRoLnJvdW5kKCgxMDAgLSBiYWxsT24pIC8gMik7XG4gICAgcmV0dXJuIHsga2luZDogXCJvZmZlbnNlX2dhaW5cIiwgeWFyZHM6IGhhbGZUb0dvYWwgPiA0MCA/IGhhbGZUb0dvYWwgOiA0MCB9O1xuICB9XG5cbiAgLy8gRGVmZW5zZSBiZW5lZmljaWFyeVxuICBpZiAoZGllIDw9IDMpIHtcbiAgICBjb25zdCByYXdZYXJkcyA9IGJhbGxPbiAtIDEwIDwgMSA/IC1NYXRoLmZsb29yKGJhbGxPbiAvIDIpIDogLTEwO1xuICAgIHJldHVybiB7IGtpbmQ6IFwiZGVmZW5zZV9wZW5hbHR5XCIsIHJhd1lhcmRzIH07XG4gIH1cbiAgaWYgKGRpZSA9PT0gNikgcmV0dXJuIHsga2luZDogXCJkZWZlbnNlX2Z1bWJsZV90ZFwiIH07XG4gIGNvbnN0IGhhbGZUb0dvYWwgPSBNYXRoLnJvdW5kKCgxMDAgLSBiYWxsT24pIC8gMik7XG4gIHJldHVybiB7IGtpbmQ6IFwiZGVmZW5zZV9mdW1ibGVfcmV0dXJuXCIsIHlhcmRzOiBoYWxmVG9Hb2FsID4gMjUgPyBoYWxmVG9Hb2FsIDogMjUgfTtcbn1cbiJdLAog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RixTQUFRLEtBQUssWUFBYSxLQUFLLFNBQVMsVUFBVSxLQUFLO0FBQ3pEO0FBRU8sU0FBUyxlQUNkLGFBQ0EsU0FDQSxLQUVBLFFBQ2dCO0FBQ2hCLFFBQU0sa0JBQWtCLGdCQUFnQjtBQUV4QyxNQUFJLGlCQUFpQjtBQUNuQixRQUFJLFFBQVEsRUFBRyxRQUFPLEVBQUUsTUFBTSxhQUFhO0FBQzNDLFFBQUksT0FBTyxFQUFHLFFBQU8sRUFBRSxNQUFNLGdCQUFnQixPQUFPLEdBQUc7QUFDdkQsVUFBTUMsY0FBYSxLQUFLLE9BQU8sTUFBTSxVQUFVLENBQUM7QUFDaEQsV0FBTyxFQUFFLE1BQU0sZ0JBQWdCLE9BQU9BLGNBQWEsS0FBS0EsY0FBYSxHQUFHO0FBQUEsRUFDMUU7QUFHQSxNQUFJLE9BQU8sR0FBRztBQUNaLFVBQU0sV0FBVyxTQUFTLEtBQUssSUFBSSxDQUFDLEtBQUssTUFBTSxTQUFTLENBQUMsSUFBSTtBQUM3RCxXQUFPLEVBQUUsTUFBTSxtQkFBbUIsU0FBUztBQUFBLEVBQzdDO0FBQ0EsTUFBSSxRQUFRLEVBQUcsUUFBTyxFQUFFLE1BQU0sb0JBQW9CO0FBQ2xELFFBQU0sYUFBYSxLQUFLLE9BQU8sTUFBTSxVQUFVLENBQUM7QUFDaEQsU0FBTyxFQUFFLE1BQU0seUJBQXlCLE9BQU8sYUFBYSxLQUFLLGFBQWEsR0FBRztBQUNuRjsiLAogICJuYW1lcyI6IFsiYmxhbmtQaWNrIiwgImhhbGZUb0dvYWwiLCAibXVsdGlwbGllciIsICJ5YXJkc0RyYXciLCAieWFyZHMiLCAic3RhdGVXaXRoUGljayIsICJyZXN1bHQiLCAiaGFsZlRvR29hbCJdCn0K
