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
  const newPlayers = {
    ...state.players,
    [offense]: decrementHand(state.players[offense], input.offensePlay)
  };
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
      { ...state, deck: yardsDraw.deck, players: newPlayers, pendingPick: blankPick() },
      offense,
      events
    );
  }
  if (scored === "safety") {
    return safetyState(
      { ...state, deck: yardsDraw.deck, players: newPlayers, pendingPick: blankPick() },
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
      pendingPick: blankPick(),
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
function blankPick() {
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

// src/rules/specials/shared.ts
function blankPick2() {
  return { offensePlay: null, defensePlay: null };
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
      pendingPick: blankPick2(),
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
      pendingPick: blankPick2(),
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
      pendingPick: blankPick2(),
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
      pendingPick: blankPick2(),
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
        pendingPick: blankPick2(),
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
    const newPlayers = {
      ...state.players,
      [defender]: { ...state.players[defender], score: state.players[defender].score + 6 }
    };
    events.push({ type: "TURNOVER", reason: "fumble" });
    events.push({ type: "TOUCHDOWN", scoringPlayer: defender });
    return {
      state: {
        ...state,
        players: newPlayers,
        pendingPick: blankPick2(),
        phase: "PAT_CHOICE",
        field: { ...state.field, offense: defender }
      },
      events
    };
  }
  const halfToGoal = Math.round((100 - state.field.ballOn) / 2);
  const returnYards = halfToGoal > 25 ? halfToGoal : 25;
  events.push({ type: "TURNOVER", reason: "fumble" });
  const projected = state.field.ballOn + returnYards;
  if (projected >= 100) {
    const newPlayers = {
      ...state.players,
      [defender]: { ...state.players[defender], score: state.players[defender].score + 6 }
    };
    events.push({ type: "TOUCHDOWN", scoringPlayer: defender });
    return {
      state: {
        ...state,
        players: newPlayers,
        pendingPick: blankPick2(),
        phase: "PAT_CHOICE",
        field: { ...state.field, offense: defender }
      },
      events
    };
  }
  if (projected <= 0) {
    return applySafety(state, offense, events);
  }
  const mirroredBallOn = 100 - projected;
  return {
    state: {
      ...state,
      pendingPick: blankPick2(),
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
        pendingPick: blankPick2(),
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
        pendingPick: blankPick2(),
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
        pendingPick: blankPick2(),
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
      pendingPick: blankPick2(),
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
    return {
      state: { ...result.state, phase: "REG_PLAY", isSafetyKick: false },
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
        pendingPick: blankPick2(),
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
  events.push({ type: "KICKOFF", receivingPlayer: receiver, ballOn: boundedEnd });
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
      pendingPick: blankPick2(),
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
  events.push({ type: "KICKOFF", receivingPlayer: receiver, ballOn: kickEnd });
  events.push({
    type: "ONSIDE_KICK",
    recovered,
    recoveringPlayer: recovered ? kicker : receiver
  });
  const returnRoll = rng.d6() + tmp;
  if (recovered) {
    const kickerBallOn = Math.max(1, kickEnd - returnRoll);
    return {
      state: {
        ...state,
        phase: "REG_PLAY",
        isSafetyKick: false,
        pendingPick: blankPick2(),
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
      pendingPick: blankPick2(),
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
  events.push({ type: "KICKOFF", receivingPlayer: receiver, ballOn: kickEnd });
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
      pendingPick: blankPick2(),
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
  const updatedPlayers = {
    ...state.players,
    [offense]: {
      ...state.players[offense],
      hand: { ...state.players[offense].hand, HM: Math.max(0, state.players[offense].hand.HM - 1) }
    }
  };
  const stateWithHm = { ...state, players: updatedPlayers };
  if (die === 5) {
    events.push({ type: "TURNOVER", reason: "interception" });
    return {
      state: {
        ...stateWithHm,
        pendingPick: blankPick2(),
        field: {
          ...stateWithHm.field,
          offense: opp(offense),
          ballOn: 100 - stateWithHm.field.ballOn,
          firstDownAt: Math.min(100, 100 - stateWithHm.field.ballOn + 10),
          down: 1
        }
      },
      events
    };
  }
  if (die === 6) {
    return applyTouchdown(stateWithHm, offense, events);
  }
  const yards = die === 1 ? -10 : die === 2 ? 20 : die === 3 ? 0 : 40;
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
          pendingPick: blankPick2(),
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
    return applyYardageOutcome(stateAfterMult, 0, events);
  }
  let multiplier = 0;
  if (multDraw.card === "Queen") multiplier = heads ? 3 : 0;
  if (multDraw.card === "Jack") multiplier = heads ? 0 : -3;
  if (multiplier === 0) {
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
    events.push({ type: "PENALTY", against: opponent(offense), yards: gain, lossOfDown: false });
    return {
      state: {
        ...state,
        pendingPick: blankPick2(),
        field: {
          ...state.field,
          ballOn: Math.min(100, state.field.ballOn + gain)
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
    events.push({ type: "FIELD_GOAL_GOOD", player: offense });
    const newPlayers = {
      ...state.players,
      [offense]: { ...state.players[offense], score: state.players[offense].score + 3 }
    };
    return {
      state: {
        ...state,
        players: newPlayers,
        pendingPick: blankPick2(),
        phase: "KICKOFF"
      },
      events
    };
  }
  events.push({ type: "FIELD_GOAL_MISSED", player: offense });
  events.push({ type: "TURNOVER", reason: "missed_fg" });
  const defender = opp(offense);
  const mirroredBallOn = 100 - state.field.ballOn;
  return {
    state: {
      ...state,
      pendingPick: blankPick2(),
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
      pendingPick: blankPick2(),
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy92YWxpZGF0ZS50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3N0YXRlLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvbWF0Y2h1cC50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3lhcmRhZ2UudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9kZWNrLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvcGxheS50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL3NoYXJlZC50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL2JpZ1BsYXkudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9wdW50LnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMva2lja29mZi50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL2hhaWxNYXJ5LnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvc2FtZVBsYXkudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy90cmlja1BsYXkudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9maWVsZEdvYWwudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy90d29Qb2ludC50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL292ZXJ0aW1lLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcmVkdWNlci50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3JuZy50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL291dGNvbWVzLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvKipcbiAqIEFjdGlvbiB2YWxpZGF0aW9uIGxheWVyLiBSdW5zICpiZWZvcmUqIGByZWR1Y2VgIHRvdWNoZXMgc3RhdGUuXG4gKlxuICogVGhlIGVuZ2luZSBwcmV2aW91c2x5IHJlbGllZCBvbiB0aGUgcmVkdWNlcidzIHBlci1jYXNlIHNoYXBlIGNoZWNrcyBhbmRcbiAqIHNpbGVudGx5IGlnbm9yZWQgYW55dGhpbmcgaXQgY291bGRuJ3QgcmVjb2duaXplLiBUaGF0IHdhcyBmaW5lIGZvciBhXG4gKiB0cnVzdGVkIHNpbmdsZS10YWIgZ2FtZSBidXQgdW5zYWZlIGFzIHNvb24gYXMgdGhlIER1cmFibGUgT2JqZWN0XG4gKiBhY2NlcHRzIGFjdGlvbnMgZnJvbSB1bmF1dGhlbnRpY2F0ZWQgV2ViU29ja2V0IGNsaWVudHMgXHUyMDE0IGEgaG9zdGlsZSAob3JcbiAqIGp1c3QgYnVnZ3kpIGNsaWVudCBjb3VsZCBzZW5kIGB7IHR5cGU6ICdSRVNPTFZFX0tJQ0tPRkYnLCBraWNrVHlwZTogJ0ZHJyB9YFxuICogYW5kIGNvcnJ1cHQgc3RhdGUuXG4gKlxuICogYHZhbGlkYXRlQWN0aW9uYCByZXR1cm5zIG51bGwgd2hlbiB0aGUgYWN0aW9uIGlzIGxlZ2FsIGZvciB0aGUgY3VycmVudFxuICogc3RhdGUsIG9yIGEgc3RyaW5nIGV4cGxhaW5pbmcgdGhlIHJlamVjdGlvbi4gSW52YWxpZCBhY3Rpb25zIHNob3VsZCBiZVxuICogbm8tb3BlZCBieSB0aGUgY2FsbGVyIChyZWR1Y2VyIG9yIHNlcnZlciksIG5vdCB0aHJvd24gb24gXHUyMDE0IHRoYXQgbWF0Y2hlc1xuICogdGhlIHJlc3Qgb2YgdGhlIGVuZ2luZSdzIFwiaWxsZWdhbCBwaWNrcyBhcmUgc2lsZW50bHkgZHJvcHBlZFwiIGNvbnRyYWN0XG4gKiBhbmQgYXZvaWRzIGNyYXNoaW5nIG9uIGFuIHVudHJ1c3RlZCBjbGllbnQuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBBY3Rpb24gfSBmcm9tIFwiLi9hY3Rpb25zLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgS2lja1R5cGUsIFJldHVyblR5cGUgfSBmcm9tIFwiLi90eXBlcy5qc1wiO1xuXG5jb25zdCBLSUNLX1RZUEVTOiBLaWNrVHlwZVtdID0gW1wiUktcIiwgXCJPS1wiLCBcIlNLXCJdO1xuY29uc3QgUkVUVVJOX1RZUEVTOiBSZXR1cm5UeXBlW10gPSBbXCJSUlwiLCBcIk9SXCIsIFwiVEJcIl07XG5cbmNvbnN0IFBMQVlfUEhBU0VTID0gbmV3IFNldChbXCJSRUdfUExBWVwiLCBcIk9UX1BMQVlcIiwgXCJUV09fUFRfQ09OVlwiXSk7XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUFjdGlvbihzdGF0ZTogR2FtZVN0YXRlLCBhY3Rpb246IEFjdGlvbik6IHN0cmluZyB8IG51bGwge1xuICBzd2l0Y2ggKGFjdGlvbi50eXBlKSB7XG4gICAgY2FzZSBcIlNUQVJUX0dBTUVcIjpcbiAgICAgIGlmIChzdGF0ZS5waGFzZSAhPT0gXCJJTklUXCIpIHJldHVybiBcIlNUQVJUX0dBTUUgb25seSB2YWxpZCBpbiBJTklUXCI7XG4gICAgICBpZiAodHlwZW9mIGFjdGlvbi5xdWFydGVyTGVuZ3RoTWludXRlcyAhPT0gXCJudW1iZXJcIikgcmV0dXJuIFwiYmFkIHF0ckxlblwiO1xuICAgICAgaWYgKGFjdGlvbi5xdWFydGVyTGVuZ3RoTWludXRlcyA8IDEgfHwgYWN0aW9uLnF1YXJ0ZXJMZW5ndGhNaW51dGVzID4gMTUpIHtcbiAgICAgICAgcmV0dXJuIFwicXRyTGVuIG11c3QgYmUgMS4uMTVcIjtcbiAgICAgIH1cbiAgICAgIGlmICghYWN0aW9uLnRlYW1zIHx8IHR5cGVvZiBhY3Rpb24udGVhbXNbMV0gIT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIGFjdGlvbi50ZWFtc1syXSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICByZXR1cm4gXCJ0ZWFtcyBtaXNzaW5nXCI7XG4gICAgICB9XG4gICAgICByZXR1cm4gbnVsbDtcblxuICAgIGNhc2UgXCJDT0lOX1RPU1NfQ0FMTFwiOlxuICAgICAgaWYgKHN0YXRlLnBoYXNlICE9PSBcIkNPSU5fVE9TU1wiKSByZXR1cm4gXCJub3QgaW4gQ09JTl9UT1NTXCI7XG4gICAgICBpZiAoIWlzUGxheWVyKGFjdGlvbi5wbGF5ZXIpKSByZXR1cm4gXCJiYWQgcGxheWVyXCI7XG4gICAgICBpZiAoYWN0aW9uLmNhbGwgIT09IFwiaGVhZHNcIiAmJiBhY3Rpb24uY2FsbCAhPT0gXCJ0YWlsc1wiKSByZXR1cm4gXCJiYWQgY2FsbFwiO1xuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICBjYXNlIFwiUkVDRUlWRV9DSE9JQ0VcIjpcbiAgICAgIC8vIEFsbG93ZWQgb25seSBhZnRlciB0aGUgY29pbiB0b3NzIHJlc29sdmVzOyBlbmdpbmUncyByZWR1Y2VyIGxlYXZlc1xuICAgICAgLy8gc3RhdGUucGhhc2UgYXQgQ09JTl9UT1NTIHVudGlsIFJFQ0VJVkVfQ0hPSUNFIHRyYW5zaXRpb25zIHRvIEtJQ0tPRkYuXG4gICAgICBpZiAoc3RhdGUucGhhc2UgIT09IFwiQ09JTl9UT1NTXCIpIHJldHVybiBcIm5vdCBpbiBDT0lOX1RPU1NcIjtcbiAgICAgIGlmICghaXNQbGF5ZXIoYWN0aW9uLnBsYXllcikpIHJldHVybiBcImJhZCBwbGF5ZXJcIjtcbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlICE9PSBcInJlY2VpdmVcIiAmJiBhY3Rpb24uY2hvaWNlICE9PSBcImRlZmVyXCIpIHJldHVybiBcImJhZCBjaG9pY2VcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIlBJQ0tfUExBWVwiOlxuICAgICAgaWYgKCFQTEFZX1BIQVNFUy5oYXMoc3RhdGUucGhhc2UpKSByZXR1cm4gXCJub3QgaW4gYSBwbGF5IHBoYXNlXCI7XG4gICAgICBpZiAoIWlzUGxheWVyKGFjdGlvbi5wbGF5ZXIpKSByZXR1cm4gXCJiYWQgcGxheWVyXCI7XG4gICAgICBpZiAoIWlzUGxheUNhbGwoYWN0aW9uLnBsYXkpKSByZXR1cm4gXCJiYWQgcGxheVwiO1xuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICBjYXNlIFwiQ0FMTF9USU1FT1VUXCI6XG4gICAgICBpZiAoIWlzUGxheWVyKGFjdGlvbi5wbGF5ZXIpKSByZXR1cm4gXCJiYWQgcGxheWVyXCI7XG4gICAgICBpZiAoc3RhdGUucGxheWVyc1thY3Rpb24ucGxheWVyXS50aW1lb3V0cyA8PSAwKSByZXR1cm4gXCJubyB0aW1lb3V0cyByZW1haW5pbmdcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIkFDQ0VQVF9QRU5BTFRZXCI6XG4gICAgY2FzZSBcIkRFQ0xJTkVfUEVOQUxUWVwiOlxuICAgICAgaWYgKCFpc1BsYXllcihhY3Rpb24ucGxheWVyKSkgcmV0dXJuIFwiYmFkIHBsYXllclwiO1xuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICBjYXNlIFwiUEFUX0NIT0lDRVwiOlxuICAgICAgaWYgKHN0YXRlLnBoYXNlICE9PSBcIlBBVF9DSE9JQ0VcIikgcmV0dXJuIFwibm90IGluIFBBVF9DSE9JQ0VcIjtcbiAgICAgIGlmICghaXNQbGF5ZXIoYWN0aW9uLnBsYXllcikpIHJldHVybiBcImJhZCBwbGF5ZXJcIjtcbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlICE9PSBcImtpY2tcIiAmJiBhY3Rpb24uY2hvaWNlICE9PSBcInR3b19wb2ludFwiKSByZXR1cm4gXCJiYWQgY2hvaWNlXCI7XG4gICAgICByZXR1cm4gbnVsbDtcblxuICAgIGNhc2UgXCJGT1VSVEhfRE9XTl9DSE9JQ0VcIjpcbiAgICAgIGlmIChzdGF0ZS5waGFzZSAhPT0gXCJSRUdfUExBWVwiICYmIHN0YXRlLnBoYXNlICE9PSBcIk9UX1BMQVlcIikgcmV0dXJuIFwid3JvbmcgcGhhc2VcIjtcbiAgICAgIGlmIChzdGF0ZS5maWVsZC5kb3duICE9PSA0KSByZXR1cm4gXCJub3QgNHRoIGRvd25cIjtcbiAgICAgIGlmICghaXNQbGF5ZXIoYWN0aW9uLnBsYXllcikpIHJldHVybiBcImJhZCBwbGF5ZXJcIjtcbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlICE9PSBcImdvXCIgJiYgYWN0aW9uLmNob2ljZSAhPT0gXCJwdW50XCIgJiYgYWN0aW9uLmNob2ljZSAhPT0gXCJmZ1wiKSB7XG4gICAgICAgIHJldHVybiBcImJhZCBjaG9pY2VcIjtcbiAgICAgIH1cbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlID09PSBcInB1bnRcIiAmJiBzdGF0ZS5waGFzZSA9PT0gXCJPVF9QTEFZXCIpIHJldHVybiBcIm5vIHB1bnRzIGluIE9UXCI7XG4gICAgICBpZiAoYWN0aW9uLmNob2ljZSA9PT0gXCJmZ1wiICYmIHN0YXRlLmZpZWxkLmJhbGxPbiA8IDQ1KSByZXR1cm4gXCJvdXQgb2YgRkcgcmFuZ2VcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIkZPUkZFSVRcIjpcbiAgICAgIGlmICghaXNQbGF5ZXIoYWN0aW9uLnBsYXllcikpIHJldHVybiBcImJhZCBwbGF5ZXJcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIlJFU09MVkVfS0lDS09GRlwiOlxuICAgICAgaWYgKHN0YXRlLnBoYXNlICE9PSBcIktJQ0tPRkZcIikgcmV0dXJuIFwibm90IGluIEtJQ0tPRkZcIjtcbiAgICAgIC8vIFBpY2tzIGFyZSBvcHRpb25hbCAoc2FmZXR5IGtpY2tzIHNraXAgdGhlbSksIGJ1dCB3aGVuIHByZXNlbnQgdGhleVxuICAgICAgLy8gbXVzdCBiZSBsZWdhbCBlbnVtIHZhbHVlcy5cbiAgICAgIGlmIChhY3Rpb24ua2lja1R5cGUgIT09IHVuZGVmaW5lZCAmJiAhS0lDS19UWVBFUy5pbmNsdWRlcyhhY3Rpb24ua2lja1R5cGUpKSB7XG4gICAgICAgIHJldHVybiBcImJhZCBraWNrVHlwZVwiO1xuICAgICAgfVxuICAgICAgaWYgKGFjdGlvbi5yZXR1cm5UeXBlICE9PSB1bmRlZmluZWQgJiYgIVJFVFVSTl9UWVBFUy5pbmNsdWRlcyhhY3Rpb24ucmV0dXJuVHlwZSkpIHtcbiAgICAgICAgcmV0dXJuIFwiYmFkIHJldHVyblR5cGVcIjtcbiAgICAgIH1cbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIlNUQVJUX09UX1BPU1NFU1NJT05cIjpcbiAgICAgIGlmIChzdGF0ZS5waGFzZSAhPT0gXCJPVF9TVEFSVFwiKSByZXR1cm4gXCJub3QgaW4gT1RfU1RBUlRcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIlRJQ0tfQ0xPQ0tcIjpcbiAgICAgIGlmICh0eXBlb2YgYWN0aW9uLnNlY29uZHMgIT09IFwibnVtYmVyXCIpIHJldHVybiBcImJhZCBzZWNvbmRzXCI7XG4gICAgICBpZiAoYWN0aW9uLnNlY29uZHMgPCAwIHx8IGFjdGlvbi5zZWNvbmRzID4gMzAwKSByZXR1cm4gXCJzZWNvbmRzIG91dCBvZiByYW5nZVwiO1xuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICBkZWZhdWx0OiB7XG4gICAgICBjb25zdCBfZXhoYXVzdGl2ZTogbmV2ZXIgPSBhY3Rpb247XG4gICAgICB2b2lkIF9leGhhdXN0aXZlO1xuICAgICAgcmV0dXJuIFwidW5rbm93biBhY3Rpb24gdHlwZVwiO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBpc1BsYXllcihwOiB1bmtub3duKTogcCBpcyAxIHwgMiB7XG4gIHJldHVybiBwID09PSAxIHx8IHAgPT09IDI7XG59XG5cbmZ1bmN0aW9uIGlzUGxheUNhbGwocDogdW5rbm93bik6IGJvb2xlYW4ge1xuICByZXR1cm4gKFxuICAgIHAgPT09IFwiU1JcIiB8fFxuICAgIHAgPT09IFwiTFJcIiB8fFxuICAgIHAgPT09IFwiU1BcIiB8fFxuICAgIHAgPT09IFwiTFBcIiB8fFxuICAgIHAgPT09IFwiVFBcIiB8fFxuICAgIHAgPT09IFwiSE1cIiB8fFxuICAgIHAgPT09IFwiRkdcIiB8fFxuICAgIHAgPT09IFwiUFVOVFwiIHx8XG4gICAgcCA9PT0gXCJUV09fUFRcIlxuICApO1xufVxuIiwgIi8qKlxuICogU3RhdGUgZmFjdG9yaWVzLlxuICpcbiAqIGBpbml0aWFsU3RhdGUoKWAgcHJvZHVjZXMgYSBmcmVzaCBHYW1lU3RhdGUgaW4gSU5JVCBwaGFzZS4gRXZlcnl0aGluZyBlbHNlXG4gKiBmbG93cyBmcm9tIHJlZHVjaW5nIGFjdGlvbnMgb3ZlciB0aGlzIHN0YXJ0aW5nIHBvaW50LlxuICovXG5cbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBIYW5kLCBQbGF5ZXJJZCwgU3RhdHMsIFRlYW1SZWYgfSBmcm9tIFwiLi90eXBlcy5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gZW1wdHlIYW5kKGlzT3ZlcnRpbWUgPSBmYWxzZSk6IEhhbmQge1xuICByZXR1cm4ge1xuICAgIFNSOiAzLFxuICAgIExSOiAzLFxuICAgIFNQOiAzLFxuICAgIExQOiAzLFxuICAgIFRQOiAxLFxuICAgIEhNOiBpc092ZXJ0aW1lID8gMiA6IDMsXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBlbXB0eVN0YXRzKCk6IFN0YXRzIHtcbiAgcmV0dXJuIHsgcGFzc1lhcmRzOiAwLCBydXNoWWFyZHM6IDAsIHR1cm5vdmVyczogMCwgc2Fja3M6IDAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZyZXNoRGVja011bHRpcGxpZXJzKCk6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdIHtcbiAgcmV0dXJuIFs0LCA0LCA0LCAzXTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZyZXNoRGVja1lhcmRzKCk6IG51bWJlcltdIHtcbiAgcmV0dXJuIFsxLCAxLCAxLCAxLCAxLCAxLCAxLCAxLCAxLCAxXTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBJbml0aWFsU3RhdGVBcmdzIHtcbiAgdGVhbTE6IFRlYW1SZWY7XG4gIHRlYW0yOiBUZWFtUmVmO1xuICBxdWFydGVyTGVuZ3RoTWludXRlczogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaW5pdGlhbFN0YXRlKGFyZ3M6IEluaXRpYWxTdGF0ZUFyZ3MpOiBHYW1lU3RhdGUge1xuICByZXR1cm4ge1xuICAgIHBoYXNlOiBcIklOSVRcIixcbiAgICBzY2hlbWFWZXJzaW9uOiAxLFxuICAgIGNsb2NrOiB7XG4gICAgICBxdWFydGVyOiAwLFxuICAgICAgc2Vjb25kc1JlbWFpbmluZzogYXJncy5xdWFydGVyTGVuZ3RoTWludXRlcyAqIDYwLFxuICAgICAgcXVhcnRlckxlbmd0aE1pbnV0ZXM6IGFyZ3MucXVhcnRlckxlbmd0aE1pbnV0ZXMsXG4gICAgfSxcbiAgICBmaWVsZDoge1xuICAgICAgYmFsbE9uOiAzNSxcbiAgICAgIGZpcnN0RG93bkF0OiA0NSxcbiAgICAgIGRvd246IDEsXG4gICAgICBvZmZlbnNlOiAxLFxuICAgIH0sXG4gICAgZGVjazoge1xuICAgICAgbXVsdGlwbGllcnM6IGZyZXNoRGVja011bHRpcGxpZXJzKCksXG4gICAgICB5YXJkczogZnJlc2hEZWNrWWFyZHMoKSxcbiAgICB9LFxuICAgIHBsYXllcnM6IHtcbiAgICAgIDE6IHtcbiAgICAgICAgdGVhbTogYXJncy50ZWFtMSxcbiAgICAgICAgc2NvcmU6IDAsXG4gICAgICAgIHRpbWVvdXRzOiAzLFxuICAgICAgICBoYW5kOiBlbXB0eUhhbmQoKSxcbiAgICAgICAgc3RhdHM6IGVtcHR5U3RhdHMoKSxcbiAgICAgIH0sXG4gICAgICAyOiB7XG4gICAgICAgIHRlYW06IGFyZ3MudGVhbTIsXG4gICAgICAgIHNjb3JlOiAwLFxuICAgICAgICB0aW1lb3V0czogMyxcbiAgICAgICAgaGFuZDogZW1wdHlIYW5kKCksXG4gICAgICAgIHN0YXRzOiBlbXB0eVN0YXRzKCksXG4gICAgICB9LFxuICAgIH0sXG4gICAgb3BlbmluZ1JlY2VpdmVyOiBudWxsLFxuICAgIG92ZXJ0aW1lOiBudWxsLFxuICAgIHBlbmRpbmdQaWNrOiB7IG9mZmVuc2VQbGF5OiBudWxsLCBkZWZlbnNlUGxheTogbnVsbCB9LFxuICAgIGxhc3RQbGF5RGVzY3JpcHRpb246IFwiU3RhcnQgb2YgZ2FtZVwiLFxuICAgIGlzU2FmZXR5S2ljazogZmFsc2UsXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBvcHAocDogUGxheWVySWQpOiBQbGF5ZXJJZCB7XG4gIHJldHVybiBwID09PSAxID8gMiA6IDE7XG59XG4iLCAiLyoqXG4gKiBUaGUgcGxheSBtYXRjaHVwIG1hdHJpeCBcdTIwMTQgdGhlIGhlYXJ0IG9mIEZvb3RCb3JlZC5cbiAqXG4gKiBCb3RoIHRlYW1zIHBpY2sgYSBwbGF5LiBUaGUgbWF0cml4IHNjb3JlcyBob3cgKmNsb3NlbHkqIHRoZSBkZWZlbnNlXG4gKiBwcmVkaWN0ZWQgdGhlIG9mZmVuc2l2ZSBjYWxsOlxuICogICAtIDEgPSBkZWZlbnNlIHdheSBvZmYgXHUyMTkyIGdyZWF0IGZvciBvZmZlbnNlXG4gKiAgIC0gNSA9IGRlZmVuc2UgbWF0Y2hlZCBcdTIxOTIgdGVycmlibGUgZm9yIG9mZmVuc2UgKGNvbWJpbmVkIHdpdGggYSBsb3dcbiAqICAgICAgICAgbXVsdGlwbGllciBjYXJkLCB0aGlzIGJlY29tZXMgYSBsb3NzIC8gdHVybm92ZXIgcmlzaylcbiAqXG4gKiBSb3dzID0gb2ZmZW5zaXZlIGNhbGwsIENvbHMgPSBkZWZlbnNpdmUgY2FsbC4gT3JkZXI6IFtTUiwgTFIsIFNQLCBMUF0uXG4gKlxuICogICAgICAgICAgIERFRjogU1IgIExSICBTUCAgTFBcbiAqICAgT0ZGOiBTUiAgICAgWyA1LCAgMywgIDMsICAyIF1cbiAqICAgT0ZGOiBMUiAgICAgWyAyLCAgNCwgIDEsICAyIF1cbiAqICAgT0ZGOiBTUCAgICAgWyAzLCAgMiwgIDUsICAzIF1cbiAqICAgT0ZGOiBMUCAgICAgWyAxLCAgMiwgIDIsICA0IF1cbiAqXG4gKiBQb3J0ZWQgdmVyYmF0aW0gZnJvbSBwdWJsaWMvanMvZGVmYXVsdHMuanMgTUFUQ0hVUC4gSW5kZXhpbmcgY29uZmlybWVkXG4gKiBhZ2FpbnN0IHBsYXlNZWNoYW5pc20gLyBjYWxjVGltZXMgaW4gcnVuLmpzOjIzNjguXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBSZWd1bGFyUGxheSB9IGZyb20gXCIuLi90eXBlcy5qc1wiO1xuXG5leHBvcnQgY29uc3QgTUFUQ0hVUDogUmVhZG9ubHlBcnJheTxSZWFkb25seUFycmF5PE1hdGNodXBRdWFsaXR5Pj4gPSBbXG4gIFs1LCAzLCAzLCAyXSxcbiAgWzIsIDQsIDEsIDJdLFxuICBbMywgMiwgNSwgM10sXG4gIFsxLCAyLCAyLCA0XSxcbl0gYXMgY29uc3Q7XG5cbmV4cG9ydCB0eXBlIE1hdGNodXBRdWFsaXR5ID0gMSB8IDIgfCAzIHwgNCB8IDU7XG5cbmNvbnN0IFBMQVlfSU5ERVg6IFJlY29yZDxSZWd1bGFyUGxheSwgMCB8IDEgfCAyIHwgMz4gPSB7XG4gIFNSOiAwLFxuICBMUjogMSxcbiAgU1A6IDIsXG4gIExQOiAzLFxufTtcblxuLyoqXG4gKiBNdWx0aXBsaWVyIGNhcmQgdmFsdWVzLiBJbmRleGluZyAoY29uZmlybWVkIGluIHJ1bi5qczoyMzc3KTpcbiAqICAgcm93ICAgID0gbXVsdGlwbGllciBjYXJkICgwPUtpbmcsIDE9UXVlZW4sIDI9SmFjaywgMz0xMClcbiAqICAgY29sdW1uID0gbWF0Y2h1cCBxdWFsaXR5IC0gMSAoc28gY29sdW1uIDAgPSBxdWFsaXR5IDEsIGNvbHVtbiA0ID0gcXVhbGl0eSA1KVxuICpcbiAqIFF1YWxpdHkgMSAob2ZmZW5zZSBvdXRndWVzc2VkIGRlZmVuc2UpICsgS2luZyA9IDR4LiBCZXN0IHBvc3NpYmxlIHBsYXkuXG4gKiBRdWFsaXR5IDUgKGRlZmVuc2UgbWF0Y2hlZCkgKyAxMCAgICAgICAgPSAtMXguIFdvcnN0IHJlZ3VsYXIgcGxheS5cbiAqXG4gKiAgICAgICAgICAgICAgICAgIHF1YWwgMSAgcXVhbCAyICBxdWFsIDMgIHF1YWwgNCAgcXVhbCA1XG4gKiAgIEtpbmcgICAgKDApICBbICAgNCwgICAgICAzLCAgICAgIDIsICAgICAxLjUsICAgICAxICAgXVxuICogICBRdWVlbiAgICgxKSAgWyAgIDMsICAgICAgMiwgICAgICAxLCAgICAgIDEsICAgICAwLjUgIF1cbiAqICAgSmFjayAgICAoMikgIFsgICAyLCAgICAgIDEsICAgICAwLjUsICAgICAwLCAgICAgIDAgICBdXG4gKiAgIDEwICAgICAgKDMpICBbICAgMCwgICAgICAwLCAgICAgIDAsICAgICAtMSwgICAgIC0xICAgXVxuICpcbiAqIFBvcnRlZCB2ZXJiYXRpbSBmcm9tIHB1YmxpYy9qcy9kZWZhdWx0cy5qcyBNVUxUSS5cbiAqL1xuZXhwb3J0IGNvbnN0IE1VTFRJOiBSZWFkb25seUFycmF5PFJlYWRvbmx5QXJyYXk8bnVtYmVyPj4gPSBbXG4gIFs0LCAzLCAyLCAxLjUsIDFdLFxuICBbMywgMiwgMSwgMSwgMC41XSxcbiAgWzIsIDEsIDAuNSwgMCwgMF0sXG4gIFswLCAwLCAwLCAtMSwgLTFdLFxuXSBhcyBjb25zdDtcblxuZXhwb3J0IGZ1bmN0aW9uIG1hdGNodXBRdWFsaXR5KG9mZjogUmVndWxhclBsYXksIGRlZjogUmVndWxhclBsYXkpOiBNYXRjaHVwUXVhbGl0eSB7XG4gIGNvbnN0IHJvdyA9IE1BVENIVVBbUExBWV9JTkRFWFtvZmZdXTtcbiAgaWYgKCFyb3cpIHRocm93IG5ldyBFcnJvcihgdW5yZWFjaGFibGU6IGJhZCBvZmYgcGxheSAke29mZn1gKTtcbiAgY29uc3QgcSA9IHJvd1tQTEFZX0lOREVYW2RlZl1dO1xuICBpZiAocSA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoYHVucmVhY2hhYmxlOiBiYWQgZGVmIHBsYXkgJHtkZWZ9YCk7XG4gIHJldHVybiBxO1xufVxuIiwgIi8qKlxuICogUHVyZSB5YXJkYWdlIGNhbGN1bGF0aW9uIGZvciBhIHJlZ3VsYXIgcGxheSAoU1IvTFIvU1AvTFApLlxuICpcbiAqIEZvcm11bGEgKHJ1bi5qczoyMzM3KTpcbiAqICAgeWFyZHMgPSByb3VuZChtdWx0aXBsaWVyICogeWFyZHNDYXJkKSArIGJvbnVzXG4gKlxuICogV2hlcmU6XG4gKiAgIC0gbXVsdGlwbGllciA9IE1VTFRJW211bHRpcGxpZXJDYXJkXVtxdWFsaXR5IC0gMV1cbiAqICAgLSBxdWFsaXR5ICAgID0gTUFUQ0hVUFtvZmZlbnNlXVtkZWZlbnNlXSAgIC8vIDEtNVxuICogICAtIGJvbnVzICAgICAgPSBzcGVjaWFsLXBsYXkgYm9udXMgKGUuZy4gVHJpY2sgUGxheSArNSBvbiBMUi9MUCBvdXRjb21lcylcbiAqXG4gKiBTcGVjaWFsIHBsYXlzIChUUCwgSE0sIEZHLCBQVU5ULCBUV09fUFQpIHVzZSBkaWZmZXJlbnQgZm9ybXVsYXMgXHUyMDE0IHRoZXlcbiAqIGxpdmUgaW4gcnVsZXMvc3BlY2lhbC50cyAoVE9ETykgYW5kIHByb2R1Y2UgZXZlbnRzIGRpcmVjdGx5LlxuICovXG5cbmltcG9ydCB0eXBlIHsgUmVndWxhclBsYXkgfSBmcm9tIFwiLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IE1VTFRJLCBtYXRjaHVwUXVhbGl0eSB9IGZyb20gXCIuL21hdGNodXAuanNcIjtcblxuZXhwb3J0IHR5cGUgTXVsdGlwbGllckNhcmRJbmRleCA9IDAgfCAxIHwgMiB8IDM7XG5leHBvcnQgY29uc3QgTVVMVElQTElFUl9DQVJEX05BTUVTID0gW1wiS2luZ1wiLCBcIlF1ZWVuXCIsIFwiSmFja1wiLCBcIjEwXCJdIGFzIGNvbnN0O1xuZXhwb3J0IHR5cGUgTXVsdGlwbGllckNhcmROYW1lID0gKHR5cGVvZiBNVUxUSVBMSUVSX0NBUkRfTkFNRVMpW251bWJlcl07XG5cbmV4cG9ydCBpbnRlcmZhY2UgWWFyZGFnZUlucHV0cyB7XG4gIG9mZmVuc2U6IFJlZ3VsYXJQbGF5O1xuICBkZWZlbnNlOiBSZWd1bGFyUGxheTtcbiAgLyoqIE11bHRpcGxpZXIgY2FyZCBpbmRleDogMD1LaW5nLCAxPVF1ZWVuLCAyPUphY2ssIDM9MTAuICovXG4gIG11bHRpcGxpZXJDYXJkOiBNdWx0aXBsaWVyQ2FyZEluZGV4O1xuICAvKiogWWFyZHMgY2FyZCBkcmF3biwgMS0xMC4gKi9cbiAgeWFyZHNDYXJkOiBudW1iZXI7XG4gIC8qKiBCb251cyB5YXJkcyBmcm9tIHNwZWNpYWwtcGxheSBvdmVybGF5cyAoZS5nLiBUcmljayBQbGF5ICs1KS4gKi9cbiAgYm9udXM/OiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgWWFyZGFnZU91dGNvbWUge1xuICBtYXRjaHVwUXVhbGl0eTogbnVtYmVyO1xuICBtdWx0aXBsaWVyOiBudW1iZXI7XG4gIG11bHRpcGxpZXJDYXJkTmFtZTogTXVsdGlwbGllckNhcmROYW1lO1xuICB5YXJkc0dhaW5lZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY29tcHV0ZVlhcmRhZ2UoaW5wdXRzOiBZYXJkYWdlSW5wdXRzKTogWWFyZGFnZU91dGNvbWUge1xuICBjb25zdCBxdWFsaXR5ID0gbWF0Y2h1cFF1YWxpdHkoaW5wdXRzLm9mZmVuc2UsIGlucHV0cy5kZWZlbnNlKTtcbiAgY29uc3QgbXVsdGlSb3cgPSBNVUxUSVtpbnB1dHMubXVsdGlwbGllckNhcmRdO1xuICBpZiAoIW11bHRpUm93KSB0aHJvdyBuZXcgRXJyb3IoYHVucmVhY2hhYmxlOiBiYWQgbXVsdGkgY2FyZCAke2lucHV0cy5tdWx0aXBsaWVyQ2FyZH1gKTtcbiAgY29uc3QgbXVsdGlwbGllciA9IG11bHRpUm93W3F1YWxpdHkgLSAxXTtcbiAgaWYgKG11bHRpcGxpZXIgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKGB1bnJlYWNoYWJsZTogYmFkIHF1YWxpdHkgJHtxdWFsaXR5fWApO1xuXG4gIGNvbnN0IGJvbnVzID0gaW5wdXRzLmJvbnVzID8/IDA7XG4gIGNvbnN0IHlhcmRzR2FpbmVkID0gTWF0aC5yb3VuZChtdWx0aXBsaWVyICogaW5wdXRzLnlhcmRzQ2FyZCkgKyBib251cztcblxuICByZXR1cm4ge1xuICAgIG1hdGNodXBRdWFsaXR5OiBxdWFsaXR5LFxuICAgIG11bHRpcGxpZXIsXG4gICAgbXVsdGlwbGllckNhcmROYW1lOiBNVUxUSVBMSUVSX0NBUkRfTkFNRVNbaW5wdXRzLm11bHRpcGxpZXJDYXJkXSxcbiAgICB5YXJkc0dhaW5lZCxcbiAgfTtcbn1cbiIsICIvKipcbiAqIENhcmQtZGVjayBkcmF3cyBcdTIwMTQgcHVyZSB2ZXJzaW9ucyBvZiB2NS4xJ3MgYEdhbWUuZGVjTXVsdHNgIGFuZCBgR2FtZS5kZWNZYXJkc2AuXG4gKlxuICogVGhlIGRlY2sgaXMgcmVwcmVzZW50ZWQgYXMgYW4gYXJyYXkgb2YgcmVtYWluaW5nIGNvdW50cyBwZXIgY2FyZCBzbG90LlxuICogVG8gZHJhdywgd2UgcGljayBhIHVuaWZvcm0gcmFuZG9tIHNsb3Q7IGlmIHRoYXQgc2xvdCBpcyBlbXB0eSwgd2UgcmV0cnkuXG4gKiBUaGlzIGlzIG1hdGhlbWF0aWNhbGx5IGVxdWl2YWxlbnQgdG8gc2h1ZmZsaW5nIHRoZSByZW1haW5pbmcgY2FyZHMgYW5kXG4gKiBkcmF3aW5nIG9uZSBcdTIwMTQgYW5kIG1hdGNoZXMgdjUuMSdzIGJlaGF2aW9yIHZlcmJhdGltLlxuICpcbiAqIFdoZW4gdGhlIGRlY2sgaXMgZXhoYXVzdGVkLCB0aGUgY29uc3VtZXIgKHRoZSByZWR1Y2VyKSByZWZpbGxzIGl0IGFuZFxuICogZW1pdHMgYSBERUNLX1NIVUZGTEVEIGV2ZW50LlxuICovXG5cbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBEZWNrU3RhdGUgfSBmcm9tIFwiLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7XG4gIGZyZXNoRGVja011bHRpcGxpZXJzLFxuICBmcmVzaERlY2tZYXJkcyxcbn0gZnJvbSBcIi4uL3N0YXRlLmpzXCI7XG5pbXBvcnQge1xuICBNVUxUSVBMSUVSX0NBUkRfTkFNRVMsXG4gIHR5cGUgTXVsdGlwbGllckNhcmRJbmRleCxcbiAgdHlwZSBNdWx0aXBsaWVyQ2FyZE5hbWUsXG59IGZyb20gXCIuL3lhcmRhZ2UuanNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBNdWx0aXBsaWVyRHJhdyB7XG4gIGNhcmQ6IE11bHRpcGxpZXJDYXJkTmFtZTtcbiAgaW5kZXg6IE11bHRpcGxpZXJDYXJkSW5kZXg7XG4gIGRlY2s6IERlY2tTdGF0ZTtcbiAgcmVzaHVmZmxlZDogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRyYXdNdWx0aXBsaWVyKGRlY2s6IERlY2tTdGF0ZSwgcm5nOiBSbmcpOiBNdWx0aXBsaWVyRHJhdyB7XG4gIGNvbnN0IG11bHRzID0gWy4uLmRlY2subXVsdGlwbGllcnNdIGFzIFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdO1xuXG4gIGxldCBpbmRleDogTXVsdGlwbGllckNhcmRJbmRleDtcbiAgLy8gUmVqZWN0aW9uLXNhbXBsZSB0byBkcmF3IHVuaWZvcm1seSBhY3Jvc3MgcmVtYWluaW5nIGNhcmRzLlxuICAvLyBMb29wIGlzIGJvdW5kZWQgXHUyMDE0IHRvdGFsIGNhcmRzIGluIGZyZXNoIGRlY2sgaXMgMTUuXG4gIGZvciAoOzspIHtcbiAgICBjb25zdCBpID0gcm5nLmludEJldHdlZW4oMCwgMykgYXMgTXVsdGlwbGllckNhcmRJbmRleDtcbiAgICBpZiAobXVsdHNbaV0gPiAwKSB7XG4gICAgICBpbmRleCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICBtdWx0c1tpbmRleF0tLTtcblxuICBsZXQgcmVzaHVmZmxlZCA9IGZhbHNlO1xuICBsZXQgbmV4dERlY2s6IERlY2tTdGF0ZSA9IHsgLi4uZGVjaywgbXVsdGlwbGllcnM6IG11bHRzIH07XG4gIGlmIChtdWx0cy5ldmVyeSgoYykgPT4gYyA9PT0gMCkpIHtcbiAgICByZXNodWZmbGVkID0gdHJ1ZTtcbiAgICBuZXh0RGVjayA9IHsgLi4ubmV4dERlY2ssIG11bHRpcGxpZXJzOiBmcmVzaERlY2tNdWx0aXBsaWVycygpIH07XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGNhcmQ6IE1VTFRJUExJRVJfQ0FSRF9OQU1FU1tpbmRleF0sXG4gICAgaW5kZXgsXG4gICAgZGVjazogbmV4dERlY2ssXG4gICAgcmVzaHVmZmxlZCxcbiAgfTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBZYXJkc0RyYXcge1xuICAvKiogWWFyZHMgY2FyZCB2YWx1ZSwgMS0xMC4gKi9cbiAgY2FyZDogbnVtYmVyO1xuICBkZWNrOiBEZWNrU3RhdGU7XG4gIHJlc2h1ZmZsZWQ6IGJvb2xlYW47XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkcmF3WWFyZHMoZGVjazogRGVja1N0YXRlLCBybmc6IFJuZyk6IFlhcmRzRHJhdyB7XG4gIGNvbnN0IHlhcmRzID0gWy4uLmRlY2sueWFyZHNdO1xuXG4gIGxldCBpbmRleDogbnVtYmVyO1xuICBmb3IgKDs7KSB7XG4gICAgY29uc3QgaSA9IHJuZy5pbnRCZXR3ZWVuKDAsIHlhcmRzLmxlbmd0aCAtIDEpO1xuICAgIGNvbnN0IHNsb3QgPSB5YXJkc1tpXTtcbiAgICBpZiAoc2xvdCAhPT0gdW5kZWZpbmVkICYmIHNsb3QgPiAwKSB7XG4gICAgICBpbmRleCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICB5YXJkc1tpbmRleF0gPSAoeWFyZHNbaW5kZXhdID8/IDApIC0gMTtcblxuICBsZXQgcmVzaHVmZmxlZCA9IGZhbHNlO1xuICBsZXQgbmV4dERlY2s6IERlY2tTdGF0ZSA9IHsgLi4uZGVjaywgeWFyZHMgfTtcbiAgaWYgKHlhcmRzLmV2ZXJ5KChjKSA9PiBjID09PSAwKSkge1xuICAgIHJlc2h1ZmZsZWQgPSB0cnVlO1xuICAgIG5leHREZWNrID0geyAuLi5uZXh0RGVjaywgeWFyZHM6IGZyZXNoRGVja1lhcmRzKCkgfTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgY2FyZDogaW5kZXggKyAxLFxuICAgIGRlY2s6IG5leHREZWNrLFxuICAgIHJlc2h1ZmZsZWQsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBSZWd1bGFyLXBsYXkgcmVzb2x1dGlvbi4gU3BlY2lhbCBwbGF5cyAoVFAsIEhNLCBGRywgUFVOVCwgVFdPX1BUKSBicmFuY2hcbiAqIGVsc2V3aGVyZSBcdTIwMTQgc2VlIHJ1bGVzL3NwZWNpYWwudHMgKFRPRE8pLlxuICpcbiAqIEdpdmVuIHR3byBwaWNrcyAob2ZmZW5zZSArIGRlZmVuc2UpIGFuZCB0aGUgY3VycmVudCBzdGF0ZSwgcHJvZHVjZSBhIG5ld1xuICogc3RhdGUgYW5kIHRoZSBldmVudCBzdHJlYW0gZm9yIHRoZSBwbGF5LlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBQbGF5Q2FsbCwgUmVndWxhclBsYXkgfSBmcm9tIFwiLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IGRyYXdNdWx0aXBsaWVyLCBkcmF3WWFyZHMgfSBmcm9tIFwiLi9kZWNrLmpzXCI7XG5pbXBvcnQgeyBjb21wdXRlWWFyZGFnZSB9IGZyb20gXCIuL3lhcmRhZ2UuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi9zdGF0ZS5qc1wiO1xuXG5jb25zdCBSRUdVTEFSOiBSZWFkb25seVNldDxQbGF5Q2FsbD4gPSBuZXcgU2V0KFtcIlNSXCIsIFwiTFJcIiwgXCJTUFwiLCBcIkxQXCJdKTtcblxuZXhwb3J0IGZ1bmN0aW9uIGlzUmVndWxhclBsYXkocDogUGxheUNhbGwpOiBwIGlzIFJlZ3VsYXJQbGF5IHtcbiAgcmV0dXJuIFJFR1VMQVIuaGFzKHApO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJlc29sdmVJbnB1dCB7XG4gIG9mZmVuc2VQbGF5OiBQbGF5Q2FsbDtcbiAgZGVmZW5zZVBsYXk6IFBsYXlDYWxsO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFBsYXlSZXNvbHV0aW9uIHtcbiAgc3RhdGU6IEdhbWVTdGF0ZTtcbiAgZXZlbnRzOiBFdmVudFtdO1xufVxuXG4vKipcbiAqIFJlc29sdmUgYSByZWd1bGFyIHZzIHJlZ3VsYXIgcGxheS4gQ2FsbGVyICh0aGUgcmVkdWNlcikgcm91dGVzIHRvIHNwZWNpYWxcbiAqIHBsYXkgaGFuZGxlcnMgaWYgZWl0aGVyIHBpY2sgaXMgbm9uLXJlZ3VsYXIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUmVndWxhclBsYXkoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIGlucHV0OiBSZXNvbHZlSW5wdXQsXG4gIHJuZzogUm5nLFxuKTogUGxheVJlc29sdXRpb24ge1xuICBpZiAoIWlzUmVndWxhclBsYXkoaW5wdXQub2ZmZW5zZVBsYXkpIHx8ICFpc1JlZ3VsYXJQbGF5KGlucHV0LmRlZmVuc2VQbGF5KSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcInJlc29sdmVSZWd1bGFyUGxheSBjYWxsZWQgd2l0aCBhIG5vbi1yZWd1bGFyIHBsYXlcIik7XG4gIH1cblxuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcblxuICAvLyBEcmF3IGNhcmRzLlxuICBjb25zdCBtdWx0RHJhdyA9IGRyYXdNdWx0aXBsaWVyKHN0YXRlLmRlY2ssIHJuZyk7XG4gIGlmIChtdWx0RHJhdy5yZXNodWZmbGVkKSB7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJtdWx0aXBsaWVyXCIgfSk7XG4gIH1cbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKG11bHREcmF3LmRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkge1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcbiAgfVxuXG4gIC8vIENvbXB1dGUgeWFyZGFnZS5cbiAgY29uc3Qgb3V0Y29tZSA9IGNvbXB1dGVZYXJkYWdlKHtcbiAgICBvZmZlbnNlOiBpbnB1dC5vZmZlbnNlUGxheSxcbiAgICBkZWZlbnNlOiBpbnB1dC5kZWZlbnNlUGxheSxcbiAgICBtdWx0aXBsaWVyQ2FyZDogbXVsdERyYXcuaW5kZXgsXG4gICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgfSk7XG5cbiAgLy8gRGVjcmVtZW50IG9mZmVuc2UncyBoYW5kIGZvciB0aGUgcGxheSB0aGV5IHVzZWQuIFJlZmlsbCBhdCB6ZXJvIFx1MjAxNCB0aGVcbiAgLy8gZXhhY3QgMTItY2FyZCByZXNodWZmbGUgYmVoYXZpb3IgbGl2ZXMgaW4gYGRlY3JlbWVudEhhbmRgLlxuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtvZmZlbnNlXTogZGVjcmVtZW50SGFuZChzdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLCBpbnB1dC5vZmZlbnNlUGxheSksXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcblxuICAvLyBBcHBseSB5YXJkYWdlIHRvIGJhbGwgcG9zaXRpb24uIENsYW1wIGF0IDEwMCAoVEQpIGFuZCAwIChzYWZldHkpLlxuICBjb25zdCBwcm9qZWN0ZWQgPSBzdGF0ZS5maWVsZC5iYWxsT24gKyBvdXRjb21lLnlhcmRzR2FpbmVkO1xuICBsZXQgbmV3QmFsbE9uID0gcHJvamVjdGVkO1xuICBsZXQgc2NvcmVkOiBcInRkXCIgfCBcInNhZmV0eVwiIHwgbnVsbCA9IG51bGw7XG4gIGlmIChwcm9qZWN0ZWQgPj0gMTAwKSB7XG4gICAgbmV3QmFsbE9uID0gMTAwO1xuICAgIHNjb3JlZCA9IFwidGRcIjtcbiAgfSBlbHNlIGlmIChwcm9qZWN0ZWQgPD0gMCkge1xuICAgIG5ld0JhbGxPbiA9IDA7XG4gICAgc2NvcmVkID0gXCJzYWZldHlcIjtcbiAgfVxuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICBvZmZlbnNlUGxheTogaW5wdXQub2ZmZW5zZVBsYXksXG4gICAgZGVmZW5zZVBsYXk6IGlucHV0LmRlZmVuc2VQbGF5LFxuICAgIG1hdGNodXBRdWFsaXR5OiBvdXRjb21lLm1hdGNodXBRdWFsaXR5LFxuICAgIG11bHRpcGxpZXI6IHsgY2FyZDogb3V0Y29tZS5tdWx0aXBsaWVyQ2FyZE5hbWUsIHZhbHVlOiBvdXRjb21lLm11bHRpcGxpZXIgfSxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgIHlhcmRzR2FpbmVkOiBvdXRjb21lLnlhcmRzR2FpbmVkLFxuICAgIG5ld0JhbGxPbixcbiAgfSk7XG5cbiAgLy8gU2NvcmUgaGFuZGxpbmcuXG4gIGlmIChzY29yZWQgPT09IFwidGRcIikge1xuICAgIHJldHVybiB0b3VjaGRvd25TdGF0ZShcbiAgICAgIHsgLi4uc3RhdGUsIGRlY2s6IHlhcmRzRHJhdy5kZWNrLCBwbGF5ZXJzOiBuZXdQbGF5ZXJzLCBwZW5kaW5nUGljazogYmxhbmtQaWNrKCkgfSxcbiAgICAgIG9mZmVuc2UsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuICBpZiAoc2NvcmVkID09PSBcInNhZmV0eVwiKSB7XG4gICAgcmV0dXJuIHNhZmV0eVN0YXRlKFxuICAgICAgeyAuLi5zdGF0ZSwgZGVjazogeWFyZHNEcmF3LmRlY2ssIHBsYXllcnM6IG5ld1BsYXllcnMsIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSB9LFxuICAgICAgb2ZmZW5zZSxcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgLy8gRG93bi9kaXN0YW5jZSBoYW5kbGluZy5cbiAgY29uc3QgcmVhY2hlZEZpcnN0RG93biA9IG5ld0JhbGxPbiA+PSBzdGF0ZS5maWVsZC5maXJzdERvd25BdDtcbiAgbGV0IG5leHREb3duID0gc3RhdGUuZmllbGQuZG93bjtcbiAgbGV0IG5leHRGaXJzdERvd25BdCA9IHN0YXRlLmZpZWxkLmZpcnN0RG93bkF0O1xuICBsZXQgcG9zc2Vzc2lvbkZsaXBwZWQgPSBmYWxzZTtcblxuICBpZiAocmVhY2hlZEZpcnN0RG93bikge1xuICAgIG5leHREb3duID0gMTtcbiAgICBuZXh0Rmlyc3REb3duQXQgPSBNYXRoLm1pbigxMDAsIG5ld0JhbGxPbiArIDEwKTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiRklSU1RfRE9XTlwiIH0pO1xuICB9IGVsc2UgaWYgKHN0YXRlLmZpZWxkLmRvd24gPT09IDQpIHtcbiAgICAvLyBUdXJub3ZlciBvbiBkb3ducyBcdTIwMTQgcG9zc2Vzc2lvbiBmbGlwcywgYmFsbCBzdGF5cy5cbiAgICBuZXh0RG93biA9IDE7XG4gICAgcG9zc2Vzc2lvbkZsaXBwZWQgPSB0cnVlO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUl9PTl9ET1dOU1wiIH0pO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiZG93bnNcIiB9KTtcbiAgfSBlbHNlIHtcbiAgICBuZXh0RG93biA9IChzdGF0ZS5maWVsZC5kb3duICsgMSkgYXMgMSB8IDIgfCAzIHwgNDtcbiAgfVxuXG4gIGNvbnN0IG5leHRPZmZlbnNlID0gcG9zc2Vzc2lvbkZsaXBwZWQgPyBvcHAob2ZmZW5zZSkgOiBvZmZlbnNlO1xuICBjb25zdCBuZXh0QmFsbE9uID0gcG9zc2Vzc2lvbkZsaXBwZWQgPyAxMDAgLSBuZXdCYWxsT24gOiBuZXdCYWxsT247XG4gIGNvbnN0IG5leHRGaXJzdERvd24gPSBwb3NzZXNzaW9uRmxpcHBlZFxuICAgID8gTWF0aC5taW4oMTAwLCBuZXh0QmFsbE9uICsgMTApXG4gICAgOiBuZXh0Rmlyc3REb3duQXQ7XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBkZWNrOiB5YXJkc0RyYXcuZGVjayxcbiAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IG5leHRCYWxsT24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBuZXh0Rmlyc3REb3duLFxuICAgICAgICBkb3duOiBuZXh0RG93bixcbiAgICAgICAgb2ZmZW5zZTogbmV4dE9mZmVuc2UsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG5mdW5jdGlvbiBibGFua1BpY2soKTogR2FtZVN0YXRlW1wicGVuZGluZ1BpY2tcIl0ge1xuICByZXR1cm4geyBvZmZlbnNlUGxheTogbnVsbCwgZGVmZW5zZVBsYXk6IG51bGwgfTtcbn1cblxuLyoqXG4gKiBUb3VjaGRvd24gYm9va2tlZXBpbmcgXHUyMDE0IDYgcG9pbnRzLCB0cmFuc2l0aW9uIHRvIFBBVF9DSE9JQ0UgcGhhc2UuXG4gKiAoUEFULzJwdCByZXNvbHV0aW9uIGFuZCBlbnN1aW5nIGtpY2tvZmYgaGFwcGVuIGluIHN1YnNlcXVlbnQgYWN0aW9ucy4pXG4gKi9cbmZ1bmN0aW9uIHRvdWNoZG93blN0YXRlKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBzY29yZXI6IEdhbWVTdGF0ZVtcImZpZWxkXCJdW1wib2ZmZW5zZVwiXSxcbiAgZXZlbnRzOiBFdmVudFtdLFxuKTogUGxheVJlc29sdXRpb24ge1xuICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgW3Njb3Jlcl06IHsgLi4uc3RhdGUucGxheWVyc1tzY29yZXJdLCBzY29yZTogc3RhdGUucGxheWVyc1tzY29yZXJdLnNjb3JlICsgNiB9LFxuICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUT1VDSERPV05cIiwgc2NvcmluZ1BsYXllcjogc2NvcmVyIH0pO1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7IC4uLnN0YXRlLCBwbGF5ZXJzOiBuZXdQbGF5ZXJzLCBwaGFzZTogXCJQQVRfQ0hPSUNFXCIgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbi8qKlxuICogU2FmZXR5IFx1MjAxNCBkZWZlbnNlIHNjb3JlcyAyLCBvZmZlbnNlIGtpY2tzIGZyZWUga2ljay5cbiAqIEZvciB0aGUgc2tldGNoIHdlIHNjb3JlIGFuZCBlbWl0OyB0aGUga2lja29mZiB0cmFuc2l0aW9uIGlzIFRPRE8uXG4gKi9cbmZ1bmN0aW9uIHNhZmV0eVN0YXRlKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBjb25jZWRlcjogR2FtZVN0YXRlW1wiZmllbGRcIl1bXCJvZmZlbnNlXCJdLFxuICBldmVudHM6IEV2ZW50W10sXG4pOiBQbGF5UmVzb2x1dGlvbiB7XG4gIGNvbnN0IHNjb3JlciA9IG9wcChjb25jZWRlcik7XG4gIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgLi4uc3RhdGUucGxheWVycyxcbiAgICBbc2NvcmVyXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0uc2NvcmUgKyAyIH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlNBRkVUWVwiLCBzY29yaW5nUGxheWVyOiBzY29yZXIgfSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHsgLi4uc3RhdGUsIHBsYXllcnM6IG5ld1BsYXllcnMsIHBoYXNlOiBcIktJQ0tPRkZcIiB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuLyoqXG4gKiBEZWNyZW1lbnQgdGhlIGNob3NlbiBwbGF5IGluIGEgcGxheWVyJ3MgaGFuZC4gSWYgdGhlIHJlZ3VsYXItcGxheSBjYXJkc1xuICogKFNSL0xSL1NQL0xQKSBhcmUgYWxsIGV4aGF1c3RlZCwgcmVmaWxsIHRoZW0gXHUyMDE0IEhhaWwgTWFyeSBjb3VudCBpc1xuICogcHJlc2VydmVkIGFjcm9zcyByZWZpbGxzIChtYXRjaGVzIHY1LjEgUGxheWVyLmZpbGxQbGF5cygncCcpKS5cbiAqL1xuZnVuY3Rpb24gZGVjcmVtZW50SGFuZChcbiAgcGxheWVyOiBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdWzFdLFxuICBwbGF5OiBQbGF5Q2FsbCxcbik6IEdhbWVTdGF0ZVtcInBsYXllcnNcIl1bMV0ge1xuICBjb25zdCBoYW5kID0geyAuLi5wbGF5ZXIuaGFuZCB9O1xuXG4gIGlmIChwbGF5ID09PSBcIkhNXCIpIHtcbiAgICBoYW5kLkhNID0gTWF0aC5tYXgoMCwgaGFuZC5ITSAtIDEpO1xuICAgIHJldHVybiB7IC4uLnBsYXllciwgaGFuZCB9O1xuICB9XG5cbiAgaWYgKHBsYXkgPT09IFwiRkdcIiB8fCBwbGF5ID09PSBcIlBVTlRcIiB8fCBwbGF5ID09PSBcIlRXT19QVFwiKSB7XG4gICAgLy8gTm8gY2FyZCBjb25zdW1lZCBcdTIwMTQgdGhlc2UgYXJlIHNpdHVhdGlvbmFsIGRlY2lzaW9ucywgbm90IGRyYXdzLlxuICAgIHJldHVybiBwbGF5ZXI7XG4gIH1cblxuICBoYW5kW3BsYXldID0gTWF0aC5tYXgoMCwgaGFuZFtwbGF5XSAtIDEpO1xuXG4gIC8vIHY1LjEgMTItY2FyZCByZXNodWZmbGU6IHdoZW4gdGhlIDEyIHJlZ3VsYXItcGxheSBjYXJkcyAoU1IvTFIvU1AvTFAsXG4gIC8vIDMgZWFjaCkgYXJlIGFsbCBleGhhdXN0ZWQsIHJlZmlsbCB0aGVtLiBUUCBpcyB0cmFja2VkIHNlcGFyYXRlbHlcbiAgLy8gd2l0aCAxIGNhcmQgcGVyIHNodWZmbGU7IGl0IHJlZmlsbHMgb24gdGhlIHNhbWUgdHJpZ2dlciB0byBhdm9pZFxuICAvLyBhbiBvcnBoYW5lZC1UUCBzdGF0ZSAoaGFuZD1bMCwwLDAsMCwxXSkgd2hlcmUgdGhlIENQVSBpcyBmb3JjZWRcbiAgLy8gdG8gcGljayBUUCBldmVyeSBwbGF5LlxuICBjb25zdCByZWd1bGFyc0V4aGF1c3RlZCA9XG4gICAgaGFuZC5TUiA9PT0gMCAmJiBoYW5kLkxSID09PSAwICYmIGhhbmQuU1AgPT09IDAgJiYgaGFuZC5MUCA9PT0gMDtcblxuICBpZiAocmVndWxhcnNFeGhhdXN0ZWQpIHtcbiAgICByZXR1cm4ge1xuICAgICAgLi4ucGxheWVyLFxuICAgICAgaGFuZDogeyBTUjogMywgTFI6IDMsIFNQOiAzLCBMUDogMywgVFA6IDEsIEhNOiBoYW5kLkhNIH0sXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB7IC4uLnBsYXllciwgaGFuZCB9O1xufVxuIiwgIi8qKlxuICogU2hhcmVkIHByaW1pdGl2ZXMgdXNlZCBieSBtdWx0aXBsZSBzcGVjaWFsLXBsYXkgcmVzb2x2ZXJzLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgUGxheWVySWQgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi8uLi9zdGF0ZS5qc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgc3RhdGU6IEdhbWVTdGF0ZTtcbiAgZXZlbnRzOiBFdmVudFtdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYmxhbmtQaWNrKCk6IEdhbWVTdGF0ZVtcInBlbmRpbmdQaWNrXCJdIHtcbiAgcmV0dXJuIHsgb2ZmZW5zZVBsYXk6IG51bGwsIGRlZmVuc2VQbGF5OiBudWxsIH07XG59XG5cbi8qKlxuICogQXdhcmQgcG9pbnRzLCBmbGlwIHRvIFBBVF9DSE9JQ0UuIENhbGxlciBlbWl0cyBUT1VDSERPV04uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhcHBseVRvdWNoZG93bihcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgc2NvcmVyOiBQbGF5ZXJJZCxcbiAgZXZlbnRzOiBFdmVudFtdLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgW3Njb3Jlcl06IHsgLi4uc3RhdGUucGxheWVyc1tzY29yZXJdLCBzY29yZTogc3RhdGUucGxheWVyc1tzY29yZXJdLnNjb3JlICsgNiB9LFxuICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUT1VDSERPV05cIiwgc2NvcmluZ1BsYXllcjogc2NvcmVyIH0pO1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBwaGFzZTogXCJQQVRfQ0hPSUNFXCIsXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcHBseVNhZmV0eShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgY29uY2VkZXI6IFBsYXllcklkLFxuICBldmVudHM6IEV2ZW50W10sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IHNjb3JlciA9IG9wcChjb25jZWRlcik7XG4gIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgLi4uc3RhdGUucGxheWVycyxcbiAgICBbc2NvcmVyXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0uc2NvcmUgKyAyIH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlNBRkVUWVwiLCBzY29yaW5nUGxheWVyOiBzY29yZXIgfSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIHBoYXNlOiBcIktJQ0tPRkZcIixcbiAgICAgIGlzU2FmZXR5S2ljazogdHJ1ZSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuLyoqXG4gKiBBcHBseSBhIHlhcmRhZ2Ugb3V0Y29tZSB3aXRoIGZ1bGwgZG93bi90dXJub3Zlci9zY29yZSBib29ra2VlcGluZy5cbiAqIFVzZWQgYnkgc3BlY2lhbHMgdGhhdCBwcm9kdWNlIHlhcmRhZ2UgZGlyZWN0bHkgKEhhaWwgTWFyeSwgQmlnIFBsYXkgcmV0dXJuKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5WWFyZGFnZU91dGNvbWUoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHlhcmRzOiBudW1iZXIsXG4gIGV2ZW50czogRXZlbnRbXSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IHByb2plY3RlZCA9IHN0YXRlLmZpZWxkLmJhbGxPbiArIHlhcmRzO1xuXG4gIGlmIChwcm9qZWN0ZWQgPj0gMTAwKSByZXR1cm4gYXBwbHlUb3VjaGRvd24oc3RhdGUsIG9mZmVuc2UsIGV2ZW50cyk7XG4gIGlmIChwcm9qZWN0ZWQgPD0gMCkgcmV0dXJuIGFwcGx5U2FmZXR5KHN0YXRlLCBvZmZlbnNlLCBldmVudHMpO1xuXG4gIGNvbnN0IHJlYWNoZWRGaXJzdERvd24gPSBwcm9qZWN0ZWQgPj0gc3RhdGUuZmllbGQuZmlyc3REb3duQXQ7XG4gIGxldCBuZXh0RG93biA9IHN0YXRlLmZpZWxkLmRvd247XG4gIGxldCBuZXh0Rmlyc3REb3duQXQgPSBzdGF0ZS5maWVsZC5maXJzdERvd25BdDtcbiAgbGV0IHBvc3Nlc3Npb25GbGlwcGVkID0gZmFsc2U7XG5cbiAgaWYgKHJlYWNoZWRGaXJzdERvd24pIHtcbiAgICBuZXh0RG93biA9IDE7XG4gICAgbmV4dEZpcnN0RG93bkF0ID0gTWF0aC5taW4oMTAwLCBwcm9qZWN0ZWQgKyAxMCk7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkZJUlNUX0RPV05cIiB9KTtcbiAgfSBlbHNlIGlmIChzdGF0ZS5maWVsZC5kb3duID09PSA0KSB7XG4gICAgcG9zc2Vzc2lvbkZsaXBwZWQgPSB0cnVlO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUl9PTl9ET1dOU1wiIH0pO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiZG93bnNcIiB9KTtcbiAgfSBlbHNlIHtcbiAgICBuZXh0RG93biA9IChzdGF0ZS5maWVsZC5kb3duICsgMSkgYXMgMSB8IDIgfCAzIHwgNDtcbiAgfVxuXG4gIGNvbnN0IG1pcnJvcmVkQmFsbE9uID0gcG9zc2Vzc2lvbkZsaXBwZWQgPyAxMDAgLSBwcm9qZWN0ZWQgOiBwcm9qZWN0ZWQ7XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IG1pcnJvcmVkQmFsbE9uLFxuICAgICAgICBmaXJzdERvd25BdDogcG9zc2Vzc2lvbkZsaXBwZWRcbiAgICAgICAgICA/IE1hdGgubWluKDEwMCwgbWlycm9yZWRCYWxsT24gKyAxMClcbiAgICAgICAgICA6IG5leHRGaXJzdERvd25BdCxcbiAgICAgICAgZG93bjogcG9zc2Vzc2lvbkZsaXBwZWQgPyAxIDogbmV4dERvd24sXG4gICAgICAgIG9mZmVuc2U6IHBvc3Nlc3Npb25GbGlwcGVkID8gb3BwKG9mZmVuc2UpIDogb2ZmZW5zZSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBCaWcgUGxheSByZXNvbHV0aW9uIChydW4uanM6MTkzMykuXG4gKlxuICogVHJpZ2dlcmVkIGJ5OlxuICogICAtIFRyaWNrIFBsYXkgZGllPTVcbiAqICAgLSBTYW1lIFBsYXkgS2luZyBvdXRjb21lXG4gKiAgIC0gT3RoZXIgZnV0dXJlIGhvb2tzXG4gKlxuICogVGhlIGJlbmVmaWNpYXJ5IGFyZ3VtZW50IHNheXMgd2hvIGJlbmVmaXRzIFx1MjAxNCB0aGlzIGNhbiBiZSBvZmZlbnNlIE9SXG4gKiBkZWZlbnNlIChkaWZmZXJlbnQgb3V0Y29tZSB0YWJsZXMpLlxuICpcbiAqIE9mZmVuc2l2ZSBCaWcgUGxheSAob2ZmZW5zZSBiZW5lZml0cyk6XG4gKiAgIGRpZSAxLTMgXHUyMTkyICsyNSB5YXJkc1xuICogICBkaWUgNC01IFx1MjE5MiBtYXgoaGFsZi10by1nb2FsLCA0MCkgeWFyZHNcbiAqICAgZGllIDYgICBcdTIxOTIgVG91Y2hkb3duXG4gKlxuICogRGVmZW5zaXZlIEJpZyBQbGF5IChkZWZlbnNlIGJlbmVmaXRzKTpcbiAqICAgZGllIDEtMyBcdTIxOTIgMTAteWFyZCBwZW5hbHR5IG9uIG9mZmVuc2UgKHJlcGVhdCBkb3duKSwgaGFsZi10by1nb2FsIGlmIHRpZ2h0XG4gKiAgIGRpZSA0LTUgXHUyMTkyIEZVTUJMRSBcdTIxOTIgdHVybm92ZXIgKyBkZWZlbnNlIHJldHVybnMgbWF4KGhhbGYsIDI1KVxuICogICBkaWUgNiAgIFx1MjE5MiBGVU1CTEUgXHUyMTkyIGRlZmVuc2l2ZSBURFxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBQbGF5ZXJJZCB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4uLy4uL3N0YXRlLmpzXCI7XG5pbXBvcnQge1xuICBhcHBseVNhZmV0eSxcbiAgYXBwbHlUb3VjaGRvd24sXG4gIGJsYW5rUGljayxcbiAgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbixcbn0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlQmlnUGxheShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgYmVuZWZpY2lhcnk6IFBsYXllcklkLFxuICBybmc6IFJuZyxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGRpZSA9IHJuZy5kNigpO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbeyB0eXBlOiBcIkJJR19QTEFZXCIsIGJlbmVmaWNpYXJ5LCBzdWJyb2xsOiBkaWUgfV07XG5cbiAgaWYgKGJlbmVmaWNpYXJ5ID09PSBvZmZlbnNlKSB7XG4gICAgcmV0dXJuIG9mZmVuc2l2ZUJpZ1BsYXkoc3RhdGUsIG9mZmVuc2UsIGRpZSwgZXZlbnRzKTtcbiAgfVxuICByZXR1cm4gZGVmZW5zaXZlQmlnUGxheShzdGF0ZSwgb2ZmZW5zZSwgZGllLCBldmVudHMpO1xufVxuXG5mdW5jdGlvbiBvZmZlbnNpdmVCaWdQbGF5KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBvZmZlbnNlOiBQbGF5ZXJJZCxcbiAgZGllOiAxIHwgMiB8IDMgfCA0IHwgNSB8IDYsXG4gIGV2ZW50czogRXZlbnRbXSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgaWYgKGRpZSA9PT0gNikge1xuICAgIHJldHVybiBhcHBseVRvdWNoZG93bihzdGF0ZSwgb2ZmZW5zZSwgZXZlbnRzKTtcbiAgfVxuXG4gIC8vIGRpZSAxLTM6ICsyNTsgZGllIDQtNTogbWF4KGhhbGYtdG8tZ29hbCwgNDApXG4gIGxldCBnYWluOiBudW1iZXI7XG4gIGlmIChkaWUgPD0gMykge1xuICAgIGdhaW4gPSAyNTtcbiAgfSBlbHNlIHtcbiAgICBjb25zdCBoYWxmVG9Hb2FsID0gTWF0aC5yb3VuZCgoMTAwIC0gc3RhdGUuZmllbGQuYmFsbE9uKSAvIDIpO1xuICAgIGdhaW4gPSBoYWxmVG9Hb2FsID4gNDAgPyBoYWxmVG9Hb2FsIDogNDA7XG4gIH1cblxuICBjb25zdCBwcm9qZWN0ZWQgPSBzdGF0ZS5maWVsZC5iYWxsT24gKyBnYWluO1xuICBpZiAocHJvamVjdGVkID49IDEwMCkge1xuICAgIHJldHVybiBhcHBseVRvdWNoZG93bihzdGF0ZSwgb2ZmZW5zZSwgZXZlbnRzKTtcbiAgfVxuXG4gIC8vIEFwcGx5IGdhaW4sIGNoZWNrIGZvciBmaXJzdCBkb3duLlxuICBjb25zdCByZWFjaGVkRmlyc3REb3duID0gcHJvamVjdGVkID49IHN0YXRlLmZpZWxkLmZpcnN0RG93bkF0O1xuICBjb25zdCBuZXh0RG93biA9IHJlYWNoZWRGaXJzdERvd24gPyAxIDogc3RhdGUuZmllbGQuZG93bjtcbiAgY29uc3QgbmV4dEZpcnN0RG93bkF0ID0gcmVhY2hlZEZpcnN0RG93blxuICAgID8gTWF0aC5taW4oMTAwLCBwcm9qZWN0ZWQgKyAxMClcbiAgICA6IHN0YXRlLmZpZWxkLmZpcnN0RG93bkF0O1xuXG4gIGlmIChyZWFjaGVkRmlyc3REb3duKSBldmVudHMucHVzaCh7IHR5cGU6IFwiRklSU1RfRE9XTlwiIH0pO1xuXG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgLi4uc3RhdGUuZmllbGQsXG4gICAgICAgIGJhbGxPbjogcHJvamVjdGVkLFxuICAgICAgICBkb3duOiBuZXh0RG93bixcbiAgICAgICAgZmlyc3REb3duQXQ6IG5leHRGaXJzdERvd25BdCxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGRlZmVuc2l2ZUJpZ1BsYXkoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIG9mZmVuc2U6IFBsYXllcklkLFxuICBkaWU6IDEgfCAyIHwgMyB8IDQgfCA1IHwgNixcbiAgZXZlbnRzOiBFdmVudFtdLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICAvLyAxLTM6IDEwLXlhcmQgcGVuYWx0eSwgcmVwZWF0IGRvd24gKG5vIGRvd24gY29uc3VtZWQpLlxuICBpZiAoZGllIDw9IDMpIHtcbiAgICBjb25zdCBuYWl2ZVBlbmFsdHkgPSAtMTA7XG4gICAgY29uc3QgaGFsZlRvR29hbCA9IC1NYXRoLmZsb29yKHN0YXRlLmZpZWxkLmJhbGxPbiAvIDIpO1xuICAgIGNvbnN0IHBlbmFsdHlZYXJkcyA9XG4gICAgICBzdGF0ZS5maWVsZC5iYWxsT24gLSAxMCA8IDEgPyBoYWxmVG9Hb2FsIDogbmFpdmVQZW5hbHR5O1xuXG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlBFTkFMVFlcIiwgYWdhaW5zdDogb2ZmZW5zZSwgeWFyZHM6IHBlbmFsdHlZYXJkcywgbG9zc09mRG93bjogZmFsc2UgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgLi4uc3RhdGUuZmllbGQsXG4gICAgICAgICAgYmFsbE9uOiBNYXRoLm1heCgwLCBzdGF0ZS5maWVsZC5iYWxsT24gKyBwZW5hbHR5WWFyZHMpLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gNC01OiB0dXJub3ZlciB3aXRoIHJldHVybiBvZiBtYXgoaGFsZiwgMjUpLiA2OiBkZWZlbnNpdmUgVEQuXG4gIGNvbnN0IGRlZmVuZGVyID0gb3BwKG9mZmVuc2UpO1xuXG4gIGlmIChkaWUgPT09IDYpIHtcbiAgICAvLyBEZWZlbnNlIHNjb3JlcyB0aGUgVEQuXG4gICAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICBbZGVmZW5kZXJdOiB7IC4uLnN0YXRlLnBsYXllcnNbZGVmZW5kZXJdLCBzY29yZTogc3RhdGUucGxheWVyc1tkZWZlbmRlcl0uc2NvcmUgKyA2IH0sXG4gICAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiZnVtYmxlXCIgfSk7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRPVUNIRE9XTlwiLCBzY29yaW5nUGxheWVyOiBkZWZlbmRlciB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgcGhhc2U6IFwiUEFUX0NIT0lDRVwiLFxuICAgICAgICBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogZGVmZW5kZXIgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIGRpZSA0LTU6IHR1cm5vdmVyIHdpdGggcmV0dXJuLlxuICBjb25zdCBoYWxmVG9Hb2FsID0gTWF0aC5yb3VuZCgoMTAwIC0gc3RhdGUuZmllbGQuYmFsbE9uKSAvIDIpO1xuICBjb25zdCByZXR1cm5ZYXJkcyA9IGhhbGZUb0dvYWwgPiAyNSA/IGhhbGZUb0dvYWwgOiAyNTtcblxuICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcImZ1bWJsZVwiIH0pO1xuXG4gIC8vIERlZmVuc2UgYmVjb21lcyBuZXcgb2ZmZW5zZS4gQmFsbCBwb3NpdGlvbjogb2ZmZW5zZSBnYWluZWQgcmV0dXJuWWFyZHMsXG4gIC8vIHRoZW4gZmxpcCBwZXJzcGVjdGl2ZS5cbiAgY29uc3QgcHJvamVjdGVkID0gc3RhdGUuZmllbGQuYmFsbE9uICsgcmV0dXJuWWFyZHM7XG4gIGlmIChwcm9qZWN0ZWQgPj0gMTAwKSB7XG4gICAgLy8gUmV0dXJuZWQgYWxsIHRoZSB3YXkgXHUyMDE0IFREIGZvciBkZWZlbmRlci5cbiAgICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgIFtkZWZlbmRlcl06IHsgLi4uc3RhdGUucGxheWVyc1tkZWZlbmRlcl0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW2RlZmVuZGVyXS5zY29yZSArIDYgfSxcbiAgICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRPVUNIRE9XTlwiLCBzY29yaW5nUGxheWVyOiBkZWZlbmRlciB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgcGhhc2U6IFwiUEFUX0NIT0lDRVwiLFxuICAgICAgICBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogZGVmZW5kZXIgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuICBpZiAocHJvamVjdGVkIDw9IDApIHtcbiAgICByZXR1cm4gYXBwbHlTYWZldHkoc3RhdGUsIG9mZmVuc2UsIGV2ZW50cyk7XG4gIH1cblxuICAvLyBGbGlwIHBvc3Nlc3Npb24sIG1pcnJvciBiYWxsIHBvc2l0aW9uLlxuICBjb25zdCBtaXJyb3JlZEJhbGxPbiA9IDEwMCAtIHByb2plY3RlZDtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IG1pcnJvcmVkQmFsbE9uLFxuICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBtaXJyb3JlZEJhbGxPbiArIDEwKSxcbiAgICAgICAgZG93bjogMSxcbiAgICAgICAgb2ZmZW5zZTogZGVmZW5kZXIsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuIiwgIi8qKlxuICogUHVudCAocnVuLmpzOjIwOTApLiBBbHNvIHNlcnZlcyBmb3Igc2FmZXR5IGtpY2tzLlxuICpcbiAqIFNlcXVlbmNlIChhbGwgcmFuZG9tbmVzcyB0aHJvdWdoIHJuZyk6XG4gKiAgIDEuIEJsb2NrIGNoZWNrOiBpZiBpbml0aWFsIGQ2IGlzIDYsIHJvbGwgYWdhaW4gXHUyMDE0IDItc2l4ZXMgPSBibG9ja2VkICgxLzM2KS5cbiAqICAgMi4gSWYgbm90IGJsb2NrZWQsIGRyYXcgeWFyZHMgY2FyZCArIGNvaW4gZmxpcDpcbiAqICAgICAgICBraWNrRGlzdCA9IDEwICogeWFyZHNDYXJkIC8gMiArIDIwICogKGNvaW49aGVhZHMgPyAxIDogMClcbiAqICAgICAgUmVzdWx0aW5nIHJhbmdlOiBbNSwgNzBdIHlhcmRzLlxuICogICAzLiBJZiBiYWxsIGxhbmRzIHBhc3QgMTAwIFx1MjE5MiB0b3VjaGJhY2ssIHBsYWNlIGF0IHJlY2VpdmVyJ3MgMjAuXG4gKiAgIDQuIE11ZmYgY2hlY2sgKG5vdCBvbiB0b3VjaGJhY2svYmxvY2svc2FmZXR5IGtpY2spOiAyLXNpeGVzID0gcmVjZWl2ZXJcbiAqICAgICAgbXVmZnMsIGtpY2tpbmcgdGVhbSByZWNvdmVycy5cbiAqICAgNS4gUmV0dXJuOiBpZiBwb3NzZXNzaW9uLCBkcmF3IG11bHRDYXJkICsgeWFyZHMuXG4gKiAgICAgICAgS2luZz03eCwgUXVlZW49NHgsIEphY2s9MXgsIDEwPS0wLjV4XG4gKiAgICAgICAgcmV0dXJuID0gcm91bmQobXVsdCAqIHlhcmRzQ2FyZClcbiAqICAgICAgUmV0dXJuIGNhbiBzY29yZSBURCBvciBjb25jZWRlIHNhZmV0eS5cbiAqXG4gKiBGb3IgdGhlIGVuZ2luZSBwb3J0OiB0aGlzIGlzIHRoZSBtb3N0IHByb2NlZHVyYWwgb2YgdGhlIHNwZWNpYWxzLiBXZVxuICogY29sbGVjdCBldmVudHMgaW4gb3JkZXIgYW5kIHByb2R1Y2Ugb25lIGZpbmFsIHN0YXRlLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7IGRyYXdNdWx0aXBsaWVyLCBkcmF3WWFyZHMgfSBmcm9tIFwiLi4vZGVjay5qc1wiO1xuaW1wb3J0IHtcbiAgYXBwbHlTYWZldHksXG4gIGFwcGx5VG91Y2hkb3duLFxuICBibGFua1BpY2ssXG4gIHR5cGUgU3BlY2lhbFJlc29sdXRpb24sXG59IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5jb25zdCBSRVRVUk5fTVVMVElQTElFUlM6IFJlY29yZDxcIktpbmdcIiB8IFwiUXVlZW5cIiB8IFwiSmFja1wiIHwgXCIxMFwiLCBudW1iZXI+ID0ge1xuICBLaW5nOiA3LFxuICBRdWVlbjogNCxcbiAgSmFjazogMSxcbiAgXCIxMFwiOiAtMC41LFxufTtcblxuZXhwb3J0IGludGVyZmFjZSBQdW50T3B0aW9ucyB7XG4gIC8qKiB0cnVlIGlmIHRoaXMgaXMgYSBzYWZldHkga2ljayAobm8gYmxvY2svbXVmZiBjaGVja3MpLiAqL1xuICBzYWZldHlLaWNrPzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVQdW50KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBybmc6IFJuZyxcbiAgb3B0czogUHVudE9wdGlvbnMgPSB7fSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGRlZmVuZGVyID0gb3BwKG9mZmVuc2UpO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcbiAgbGV0IGRlY2sgPSBzdGF0ZS5kZWNrO1xuXG4gIC8vIEJsb2NrIGNoZWNrIChub3Qgb24gc2FmZXR5IGtpY2spLlxuICBsZXQgYmxvY2tlZCA9IGZhbHNlO1xuICBpZiAoIW9wdHMuc2FmZXR5S2ljaykge1xuICAgIGlmIChybmcuZDYoKSA9PT0gNiAmJiBybmcuZDYoKSA9PT0gNikge1xuICAgICAgYmxvY2tlZCA9IHRydWU7XG4gICAgfVxuICB9XG5cbiAgaWYgKGJsb2NrZWQpIHtcbiAgICAvLyBLaWNraW5nIHRlYW0gbG9zZXMgcG9zc2Vzc2lvbiBhdCB0aGUgbGluZSBvZiBzY3JpbW1hZ2UuXG4gICAgY29uc3QgbWlycm9yZWRCYWxsT24gPSAxMDAgLSBzdGF0ZS5maWVsZC5iYWxsT247XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlBVTlRcIiwgcGxheWVyOiBvZmZlbnNlLCBsYW5kaW5nU3BvdDogc3RhdGUuZmllbGQuYmFsbE9uIH0pO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiZnVtYmxlXCIgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgYmFsbE9uOiBtaXJyb3JlZEJhbGxPbixcbiAgICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBtaXJyb3JlZEJhbGxPbiArIDEwKSxcbiAgICAgICAgICBkb3duOiAxLFxuICAgICAgICAgIG9mZmVuc2U6IGRlZmVuZGVyLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gRHJhdyB5YXJkcyArIGNvaW4gZm9yIGtpY2sgZGlzdGFuY2UuXG4gIGNvbnN0IGNvaW4gPSBybmcuY29pbkZsaXAoKTtcbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKGRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuICBkZWNrID0geWFyZHNEcmF3LmRlY2s7XG5cbiAgY29uc3Qga2lja0Rpc3QgPSAoMTAgKiB5YXJkc0RyYXcuY2FyZCkgLyAyICsgKGNvaW4gPT09IFwiaGVhZHNcIiA/IDIwIDogMCk7XG4gIGNvbnN0IGxhbmRpbmdTcG90ID0gc3RhdGUuZmllbGQuYmFsbE9uICsga2lja0Rpc3Q7XG4gIGNvbnN0IHRvdWNoYmFjayA9IGxhbmRpbmdTcG90ID4gMTAwO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiUFVOVFwiLCBwbGF5ZXI6IG9mZmVuc2UsIGxhbmRpbmdTcG90IH0pO1xuXG4gIC8vIE11ZmYgY2hlY2sgKG5vdCBvbiB0b3VjaGJhY2ssIGJsb2NrLCBzYWZldHkga2ljaykuXG4gIGxldCBtdWZmZWQgPSBmYWxzZTtcbiAgaWYgKCF0b3VjaGJhY2sgJiYgIW9wdHMuc2FmZXR5S2ljaykge1xuICAgIGlmIChybmcuZDYoKSA9PT0gNiAmJiBybmcuZDYoKSA9PT0gNikge1xuICAgICAgbXVmZmVkID0gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICBpZiAobXVmZmVkKSB7XG4gICAgLy8gUmVjZWl2ZXIgbXVmZnMsIGtpY2tpbmcgdGVhbSByZWNvdmVycyB3aGVyZSB0aGUgYmFsbCBsYW5kZWQuXG4gICAgLy8gS2lja2luZyB0ZWFtIHJldGFpbnMgcG9zc2Vzc2lvbiAoc3RpbGwgb2ZmZW5zZSkuXG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJmdW1ibGVcIiB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIGRlY2ssXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICBiYWxsT246IE1hdGgubWluKDk5LCBsYW5kaW5nU3BvdCksXG4gICAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgbGFuZGluZ1Nwb3QgKyAxMCksXG4gICAgICAgICAgZG93bjogMSxcbiAgICAgICAgICBvZmZlbnNlLCAvLyBraWNrZXIgcmV0YWluc1xuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gVG91Y2hiYWNrOiByZWNlaXZlciBnZXRzIGJhbGwgYXQgdGhlaXIgb3duIDIwICg9IDgwIGZyb20gdGhlaXIgcGVyc3BlY3RpdmUsXG4gIC8vIGJ1dCBiYWxsIHBvc2l0aW9uIGlzIHRyYWNrZWQgZnJvbSBvZmZlbnNlIFBPViwgc28gZm9yIHRoZSBORVcgb2ZmZW5zZSB0aGF0XG4gIC8vIGlzIDEwMC04MCA9IDIwKS5cbiAgaWYgKHRvdWNoYmFjaykge1xuICAgIGNvbnN0IHN0YXRlQWZ0ZXJLaWNrOiBHYW1lU3RhdGUgPSB7IC4uLnN0YXRlLCBkZWNrIH07XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlQWZ0ZXJLaWNrLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgYmFsbE9uOiAyMCxcbiAgICAgICAgICBmaXJzdERvd25BdDogMzAsXG4gICAgICAgICAgZG93bjogMSxcbiAgICAgICAgICBvZmZlbnNlOiBkZWZlbmRlcixcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIE5vcm1hbCBwdW50IHJldHVybjogZHJhdyBtdWx0Q2FyZCArIHlhcmRzLiBSZXR1cm4gbWVhc3VyZWQgZnJvbSBsYW5kaW5nU3BvdC5cbiAgY29uc3QgbXVsdERyYXcgPSBkcmF3TXVsdGlwbGllcihkZWNrLCBybmcpO1xuICBpZiAobXVsdERyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJtdWx0aXBsaWVyXCIgfSk7XG4gIGRlY2sgPSBtdWx0RHJhdy5kZWNrO1xuXG4gIGNvbnN0IHJldHVybkRyYXcgPSBkcmF3WWFyZHMoZGVjaywgcm5nKTtcbiAgaWYgKHJldHVybkRyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuICBkZWNrID0gcmV0dXJuRHJhdy5kZWNrO1xuXG4gIGNvbnN0IG11bHQgPSBSRVRVUk5fTVVMVElQTElFUlNbbXVsdERyYXcuY2FyZF07XG4gIGNvbnN0IHJldHVybllhcmRzID0gTWF0aC5yb3VuZChtdWx0ICogcmV0dXJuRHJhdy5jYXJkKTtcblxuICAvLyBCYWxsIGVuZHMgdXAgYXQgbGFuZGluZ1Nwb3QgLSByZXR1cm5ZYXJkcyAoZnJvbSBraWNraW5nIHRlYW0ncyBQT1YpLlxuICAvLyBFcXVpdmFsZW50bHksIGZyb20gdGhlIHJlY2VpdmluZyB0ZWFtJ3MgUE9WOiAoMTAwIC0gbGFuZGluZ1Nwb3QpICsgcmV0dXJuWWFyZHMuXG4gIGNvbnN0IHJlY2VpdmVyQmFsbE9uID0gMTAwIC0gbGFuZGluZ1Nwb3QgKyByZXR1cm5ZYXJkcztcblxuICBjb25zdCBzdGF0ZUFmdGVyUmV0dXJuOiBHYW1lU3RhdGUgPSB7IC4uLnN0YXRlLCBkZWNrIH07XG5cbiAgLy8gUmV0dXJuIFREIFx1MjAxNCByZWNlaXZlciBzY29yZXMuXG4gIGlmIChyZWNlaXZlckJhbGxPbiA+PSAxMDApIHtcbiAgICBjb25zdCByZWNlaXZlckJhbGxDbGFtcGVkID0gMTAwO1xuICAgIHZvaWQgcmVjZWl2ZXJCYWxsQ2xhbXBlZDtcbiAgICByZXR1cm4gYXBwbHlUb3VjaGRvd24oXG4gICAgICB7IC4uLnN0YXRlQWZ0ZXJSZXR1cm4sIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiBkZWZlbmRlciB9IH0sXG4gICAgICBkZWZlbmRlcixcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgLy8gUmV0dXJuIHNhZmV0eSBcdTIwMTQgcmVjZWl2ZXIgdGFja2xlZCBpbiB0aGVpciBvd24gZW5kem9uZSAoY2FuJ3QgYWN0dWFsbHlcbiAgLy8gaGFwcGVuIGZyb20gYSBuZWdhdGl2ZS1yZXR1cm4teWFyZGFnZSBzdGFuZHBvaW50IGluIHY1LjEgc2luY2Ugc3RhcnQgaXNcbiAgLy8gMTAwLWxhbmRpbmdTcG90IHdoaWNoIGlzID4gMCwgYnV0IG1vZGVsIGl0IGFueXdheSBmb3IgY29tcGxldGVuZXNzKS5cbiAgaWYgKHJlY2VpdmVyQmFsbE9uIDw9IDApIHtcbiAgICByZXR1cm4gYXBwbHlTYWZldHkoXG4gICAgICB7IC4uLnN0YXRlQWZ0ZXJSZXR1cm4sIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiBkZWZlbmRlciB9IH0sXG4gICAgICBkZWZlbmRlcixcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGVBZnRlclJldHVybixcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogcmVjZWl2ZXJCYWxsT24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIHJlY2VpdmVyQmFsbE9uICsgMTApLFxuICAgICAgICBkb3duOiAxLFxuICAgICAgICBvZmZlbnNlOiBkZWZlbmRlcixcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBLaWNrb2ZmLiB2NiByZXN0b3JlcyB2NS4xJ3Mga2ljay10eXBlIC8gcmV0dXJuLXR5cGUgcGlja3MuXG4gKlxuICogVGhlIGtpY2tlciAoc3RhdGUuZmllbGQub2ZmZW5zZSkgY2hvb3NlcyBvbmUgb2Y6XG4gKiAgIFJLIFx1MjAxNCBSZWd1bGFyIEtpY2s6IGxvbmcga2ljaywgbXVsdCt5YXJkcyByZXR1cm5cbiAqICAgT0sgXHUyMDE0IE9uc2lkZSBLaWNrOiAgc2hvcnQga2ljaywgMS1pbi02IHJlY292ZXJ5IHJvbGwgKDEtaW4tMTIgdnMgT1IpXG4gKiAgIFNLIFx1MjAxNCBTcXVpYiBLaWNrOiAgIG1lZGl1bSBraWNrLCAyZDYgcmV0dXJuIGlmIHJlY2VpdmVyIGNob3NlIFJSXG4gKlxuICogVGhlIHJldHVybmVyIGNob29zZXMgb25lIG9mOlxuICogICBSUiBcdTIwMTQgUmVndWxhciBSZXR1cm46IG5vcm1hbCByZXR1cm5cbiAqICAgT1IgXHUyMDE0IE9uc2lkZSBjb3VudGVyOiBkZWZlbmRzIHRoZSBvbnNpZGUgKGhhcmRlciBmb3Iga2lja2VyIHRvIHJlY292ZXIpXG4gKiAgIFRCIFx1MjAxNCBUb3VjaGJhY2s6ICAgICAgdGFrZSB0aGUgYmFsbCBhdCB0aGUgMjVcbiAqXG4gKiBTYWZldHkga2lja3MgKHN0YXRlLmlzU2FmZXR5S2ljaz10cnVlKSBza2lwIHRoZSBwaWNrcyBhbmQgdXNlIHRoZVxuICogZXhpc3Rpbmcgc2ltcGxpZmllZCBwdW50IHBhdGguXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIEtpY2tUeXBlLCBSZXR1cm5UeXBlIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7IGRyYXdNdWx0aXBsaWVyLCBkcmF3WWFyZHMgfSBmcm9tIFwiLi4vZGVjay5qc1wiO1xuaW1wb3J0IHsgcmVzb2x2ZVB1bnQgfSBmcm9tIFwiLi9wdW50LmpzXCI7XG5pbXBvcnQge1xuICBhcHBseVNhZmV0eSxcbiAgYXBwbHlUb3VjaGRvd24sXG4gIGJsYW5rUGljayxcbiAgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbixcbn0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmNvbnN0IEtJQ0tPRkZfTVVMVElQTElFUlM6IFJlY29yZDxcIktpbmdcIiB8IFwiUXVlZW5cIiB8IFwiSmFja1wiIHwgXCIxMFwiLCBudW1iZXI+ID0ge1xuICBLaW5nOiAxMCxcbiAgUXVlZW46IDUsXG4gIEphY2s6IDEsXG4gIFwiMTBcIjogMCxcbn07XG5cbmV4cG9ydCBpbnRlcmZhY2UgS2lja29mZk9wdGlvbnMge1xuICBraWNrVHlwZT86IEtpY2tUeXBlO1xuICByZXR1cm5UeXBlPzogUmV0dXJuVHlwZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVLaWNrb2ZmKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBybmc6IFJuZyxcbiAgb3B0czogS2lja29mZk9wdGlvbnMgPSB7fSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qga2lja2VyID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgcmVjZWl2ZXIgPSBvcHAoa2lja2VyKTtcblxuICAvLyBTYWZldHkta2ljayBwYXRoOiB2NS4xIGNhcnZlLW91dCB0cmVhdHMgaXQgbGlrZSBhIHB1bnQgZnJvbSB0aGUgMzUuXG4gIC8vIE5vIHBpY2tzIGFyZSBwcm9tcHRlZCBmb3IsIHNvIGBraWNrVHlwZWAgd2lsbCBiZSB1bmRlZmluZWQgaGVyZS5cbiAgaWYgKHN0YXRlLmlzU2FmZXR5S2ljayB8fCAhb3B0cy5raWNrVHlwZSkge1xuICAgIGNvbnN0IGtpY2tpbmdTdGF0ZTogR2FtZVN0YXRlID0ge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgYmFsbE9uOiAzNSB9LFxuICAgIH07XG4gICAgY29uc3QgcmVzdWx0ID0gcmVzb2x2ZVB1bnQoa2lja2luZ1N0YXRlLCBybmcsIHsgc2FmZXR5S2ljazogdHJ1ZSB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHsgLi4ucmVzdWx0LnN0YXRlLCBwaGFzZTogXCJSRUdfUExBWVwiLCBpc1NhZmV0eUtpY2s6IGZhbHNlIH0sXG4gICAgICBldmVudHM6IHJlc3VsdC5ldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIGNvbnN0IHsga2lja1R5cGUsIHJldHVyblR5cGUgfSA9IG9wdHM7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiS0lDS19UWVBFX0NIT1NFTlwiLCBwbGF5ZXI6IGtpY2tlciwgY2hvaWNlOiBraWNrVHlwZSB9KTtcbiAgaWYgKHJldHVyblR5cGUpIHtcbiAgICBldmVudHMucHVzaCh7XG4gICAgICB0eXBlOiBcIlJFVFVSTl9UWVBFX0NIT1NFTlwiLFxuICAgICAgcGxheWVyOiByZWNlaXZlcixcbiAgICAgIGNob2ljZTogcmV0dXJuVHlwZSxcbiAgICB9KTtcbiAgfVxuXG4gIGlmIChraWNrVHlwZSA9PT0gXCJSS1wiKSB7XG4gICAgcmV0dXJuIHJlc29sdmVSZWd1bGFyS2ljayhzdGF0ZSwgcm5nLCBldmVudHMsIGtpY2tlciwgcmVjZWl2ZXIsIHJldHVyblR5cGUpO1xuICB9XG4gIGlmIChraWNrVHlwZSA9PT0gXCJPS1wiKSB7XG4gICAgcmV0dXJuIHJlc29sdmVPbnNpZGVLaWNrKHN0YXRlLCBybmcsIGV2ZW50cywga2lja2VyLCByZWNlaXZlciwgcmV0dXJuVHlwZSk7XG4gIH1cbiAgcmV0dXJuIHJlc29sdmVTcXVpYktpY2soc3RhdGUsIHJuZywgZXZlbnRzLCBraWNrZXIsIHJlY2VpdmVyLCByZXR1cm5UeXBlKTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZVJlZ3VsYXJLaWNrKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBybmc6IFJuZyxcbiAgZXZlbnRzOiBFdmVudFtdLFxuICBraWNrZXI6IEdhbWVTdGF0ZVtcImZpZWxkXCJdW1wib2ZmZW5zZVwiXSxcbiAgcmVjZWl2ZXI6IEdhbWVTdGF0ZVtcImZpZWxkXCJdW1wib2ZmZW5zZVwiXSxcbiAgcmV0dXJuVHlwZTogUmV0dXJuVHlwZSB8IHVuZGVmaW5lZCxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgLy8gUmV0dXJuZXIgY2hvc2UgdG91Y2hiYWNrIChvciBtaXNtYXRjaGVkIE9SKTogYmFsbCBhdCB0aGUgcmVjZWl2ZXIncyAyNS5cbiAgaWYgKHJldHVyblR5cGUgPT09IFwiVEJcIiB8fCByZXR1cm5UeXBlID09PSBcIk9SXCIpIHtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVE9VQ0hCQUNLXCIsIHJlY2VpdmluZ1BsYXllcjogcmVjZWl2ZXIgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwaGFzZTogXCJSRUdfUExBWVwiLFxuICAgICAgICBpc1NhZmV0eUtpY2s6IGZhbHNlLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgYmFsbE9uOiAyNSxcbiAgICAgICAgICBmaXJzdERvd25BdDogMzUsXG4gICAgICAgICAgZG93bjogMSxcbiAgICAgICAgICBvZmZlbnNlOiByZWNlaXZlcixcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIFJLICsgUlI6IGtpY2sgZGlzdGFuY2UgMzUuLjYwLCB0aGVuIG11bHQreWFyZHMgcmV0dXJuLlxuICBjb25zdCBraWNrUm9sbCA9IHJuZy5kNigpO1xuICBjb25zdCBraWNrWWFyZHMgPSAzNSArIDUgKiAoa2lja1JvbGwgLSAxKTsgLy8gMzUsIDQwLCA0NSwgNTAsIDU1LCA2MCBcdTIwMTQgMzUuLjYwXG4gIGNvbnN0IGtpY2tFbmRGcm9tS2lja2VyID0gMzUgKyBraWNrWWFyZHM7IC8vIDcwLi45NSwgYm91bmRlZCB0byAxMDBcbiAgY29uc3QgYm91bmRlZEVuZCA9IE1hdGgubWluKDEwMCwga2lja0VuZEZyb21LaWNrZXIpO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiS0lDS09GRlwiLCByZWNlaXZpbmdQbGF5ZXI6IHJlY2VpdmVyLCBiYWxsT246IGJvdW5kZWRFbmQgfSk7XG5cbiAgLy8gUmVjZWl2ZXIncyBzdGFydGluZyBiYWxsT24gKHBvc3Nlc3Npb24gZmxpcHBlZCkuXG4gIGNvbnN0IHJlY2VpdmVyU3RhcnQgPSAxMDAgLSBib3VuZGVkRW5kOyAvLyAwLi4zMFxuXG4gIGxldCBkZWNrID0gc3RhdGUuZGVjaztcbiAgY29uc3QgbXVsdERyYXcgPSBkcmF3TXVsdGlwbGllcihkZWNrLCBybmcpO1xuICBpZiAobXVsdERyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJtdWx0aXBsaWVyXCIgfSk7XG4gIGRlY2sgPSBtdWx0RHJhdy5kZWNrO1xuXG4gIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhkZWNrLCBybmcpO1xuICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcbiAgZGVjayA9IHlhcmRzRHJhdy5kZWNrO1xuXG4gIGNvbnN0IG11bHQgPSBLSUNLT0ZGX01VTFRJUExJRVJTW211bHREcmF3LmNhcmRdO1xuICBjb25zdCByZXRZYXJkcyA9IG11bHQgKiB5YXJkc0RyYXcuY2FyZDtcbiAgaWYgKHJldFlhcmRzICE9PSAwKSB7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIktJQ0tPRkZfUkVUVVJOXCIsIHJldHVybmVyUGxheWVyOiByZWNlaXZlciwgeWFyZHM6IHJldFlhcmRzIH0pO1xuICB9XG5cbiAgY29uc3QgZmluYWxCYWxsT24gPSByZWNlaXZlclN0YXJ0ICsgcmV0WWFyZHM7XG5cbiAgaWYgKGZpbmFsQmFsbE9uID49IDEwMCkge1xuICAgIHJldHVybiBhcHBseVRvdWNoZG93bihcbiAgICAgIHsgLi4uc3RhdGUsIGRlY2ssIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiByZWNlaXZlciB9LCBpc1NhZmV0eUtpY2s6IGZhbHNlIH0sXG4gICAgICByZWNlaXZlcixcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG4gIGlmIChmaW5hbEJhbGxPbiA8PSAwKSB7XG4gICAgLy8gUmV0dXJuIGJhY2t3YXJkIGludG8gb3duIGVuZCB6b25lIFx1MjAxNCB1bmxpa2VseSB3aXRoIHY1LjEgbXVsdGlwbGllcnMgYnV0IG1vZGVsIGl0LlxuICAgIHJldHVybiBhcHBseVNhZmV0eShcbiAgICAgIHsgLi4uc3RhdGUsIGRlY2ssIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiByZWNlaXZlciB9LCBpc1NhZmV0eUtpY2s6IGZhbHNlIH0sXG4gICAgICByZWNlaXZlcixcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBkZWNrLFxuICAgICAgcGhhc2U6IFwiUkVHX1BMQVlcIixcbiAgICAgIGlzU2FmZXR5S2ljazogZmFsc2UsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IGZpbmFsQmFsbE9uLFxuICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBmaW5hbEJhbGxPbiArIDEwKSxcbiAgICAgICAgZG93bjogMSxcbiAgICAgICAgb2ZmZW5zZTogcmVjZWl2ZXIsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG5mdW5jdGlvbiByZXNvbHZlT25zaWRlS2ljayhcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgcm5nOiBSbmcsXG4gIGV2ZW50czogRXZlbnRbXSxcbiAga2lja2VyOiBHYW1lU3RhdGVbXCJmaWVsZFwiXVtcIm9mZmVuc2VcIl0sXG4gIHJlY2VpdmVyOiBHYW1lU3RhdGVbXCJmaWVsZFwiXVtcIm9mZmVuc2VcIl0sXG4gIHJldHVyblR5cGU6IFJldHVyblR5cGUgfCB1bmRlZmluZWQsXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIC8vIFJldHVybmVyJ3MgT1IgY2hvaWNlIGNvcnJlY3RseSByZWFkcyB0aGUgb25zaWRlIFx1MjAxNCBtYWtlcyByZWNvdmVyeSBoYXJkZXIuXG4gIGNvbnN0IG9kZHMgPSByZXR1cm5UeXBlID09PSBcIk9SXCIgPyAxMiA6IDY7XG4gIGNvbnN0IHRtcCA9IHJuZy5pbnRCZXR3ZWVuKDEsIG9kZHMpO1xuICBjb25zdCByZWNvdmVyZWQgPSB0bXAgPT09IDE7XG4gIGNvbnN0IGtpY2tZYXJkcyA9IDEwICsgdG1wOyAvLyBzaG9ydCBraWNrIDExLi4xNiAob3IgMTEuLjIyIHZzIE9SKVxuICBjb25zdCBraWNrRW5kID0gMzUgKyBraWNrWWFyZHM7XG5cbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIktJQ0tPRkZcIiwgcmVjZWl2aW5nUGxheWVyOiByZWNlaXZlciwgYmFsbE9uOiBraWNrRW5kIH0pO1xuICBldmVudHMucHVzaCh7XG4gICAgdHlwZTogXCJPTlNJREVfS0lDS1wiLFxuICAgIHJlY292ZXJlZCxcbiAgICByZWNvdmVyaW5nUGxheWVyOiByZWNvdmVyZWQgPyBraWNrZXIgOiByZWNlaXZlcixcbiAgfSk7XG5cbiAgY29uc3QgcmV0dXJuUm9sbCA9IHJuZy5kNigpICsgdG1wOyAvLyB2NS4xOiB0bXAgKyBkNlxuXG4gIGlmIChyZWNvdmVyZWQpIHtcbiAgICAvLyBLaWNrZXIgcmV0YWlucy4gdjUuMSBmbGlwcyByZXR1cm4gZGlyZWN0aW9uIFx1MjAxNCBtb2RlbHMgXCJraWNrZXIgcmVjb3ZlcnNcbiAgICAvLyBzbGlnaHRseSBiYWNrIG9mIHRoZSBraWNrIHNwb3QuXCJcbiAgICBjb25zdCBraWNrZXJCYWxsT24gPSBNYXRoLm1heCgxLCBraWNrRW5kIC0gcmV0dXJuUm9sbCk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwaGFzZTogXCJSRUdfUExBWVwiLFxuICAgICAgICBpc1NhZmV0eUtpY2s6IGZhbHNlLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgYmFsbE9uOiBraWNrZXJCYWxsT24sXG4gICAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwga2lja2VyQmFsbE9uICsgMTApLFxuICAgICAgICAgIGRvd246IDEsXG4gICAgICAgICAgb2ZmZW5zZToga2lja2VyLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gUmVjZWl2ZXIgcmVjb3ZlcnMgYXQgdGhlIGtpY2sgc3BvdCwgcmV0dXJucyBmb3J3YXJkLlxuICBjb25zdCByZWNlaXZlclN0YXJ0ID0gMTAwIC0ga2lja0VuZDtcbiAgY29uc3QgZmluYWxCYWxsT24gPSByZWNlaXZlclN0YXJ0ICsgcmV0dXJuUm9sbDtcbiAgaWYgKHJldHVyblJvbGwgIT09IDApIHtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiS0lDS09GRl9SRVRVUk5cIiwgcmV0dXJuZXJQbGF5ZXI6IHJlY2VpdmVyLCB5YXJkczogcmV0dXJuUm9sbCB9KTtcbiAgfVxuXG4gIGlmIChmaW5hbEJhbGxPbiA+PSAxMDApIHtcbiAgICByZXR1cm4gYXBwbHlUb3VjaGRvd24oXG4gICAgICB7IC4uLnN0YXRlLCBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogcmVjZWl2ZXIgfSwgaXNTYWZldHlLaWNrOiBmYWxzZSB9LFxuICAgICAgcmVjZWl2ZXIsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGhhc2U6IFwiUkVHX1BMQVlcIixcbiAgICAgIGlzU2FmZXR5S2ljazogZmFsc2UsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IGZpbmFsQmFsbE9uLFxuICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBmaW5hbEJhbGxPbiArIDEwKSxcbiAgICAgICAgZG93bjogMSxcbiAgICAgICAgb2ZmZW5zZTogcmVjZWl2ZXIsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG5mdW5jdGlvbiByZXNvbHZlU3F1aWJLaWNrKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBybmc6IFJuZyxcbiAgZXZlbnRzOiBFdmVudFtdLFxuICBraWNrZXI6IEdhbWVTdGF0ZVtcImZpZWxkXCJdW1wib2ZmZW5zZVwiXSxcbiAgcmVjZWl2ZXI6IEdhbWVTdGF0ZVtcImZpZWxkXCJdW1wib2ZmZW5zZVwiXSxcbiAgcmV0dXJuVHlwZTogUmV0dXJuVHlwZSB8IHVuZGVmaW5lZCxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qga2lja1JvbGwgPSBybmcuZDYoKTtcbiAgY29uc3Qga2lja1lhcmRzID0gMTUgKyA1ICoga2lja1JvbGw7IC8vIDIwLi40NVxuICBjb25zdCBraWNrRW5kID0gTWF0aC5taW4oMTAwLCAzNSArIGtpY2tZYXJkcyk7XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJLSUNLT0ZGXCIsIHJlY2VpdmluZ1BsYXllcjogcmVjZWl2ZXIsIGJhbGxPbjoga2lja0VuZCB9KTtcblxuICAvLyBPbmx5IHJldHVybmFibGUgaWYgcmVjZWl2ZXIgY2hvc2UgUlI7IG90aGVyd2lzZSBubyByZXR1cm4uXG4gIGNvbnN0IHJldFlhcmRzID0gcmV0dXJuVHlwZSA9PT0gXCJSUlwiID8gcm5nLmQ2KCkgKyBybmcuZDYoKSA6IDA7XG4gIGlmIChyZXRZYXJkcyA+IDApIHtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiS0lDS09GRl9SRVRVUk5cIiwgcmV0dXJuZXJQbGF5ZXI6IHJlY2VpdmVyLCB5YXJkczogcmV0WWFyZHMgfSk7XG4gIH1cblxuICBjb25zdCByZWNlaXZlclN0YXJ0ID0gMTAwIC0ga2lja0VuZDtcbiAgY29uc3QgZmluYWxCYWxsT24gPSByZWNlaXZlclN0YXJ0ICsgcmV0WWFyZHM7XG5cbiAgaWYgKGZpbmFsQmFsbE9uID49IDEwMCkge1xuICAgIHJldHVybiBhcHBseVRvdWNoZG93bihcbiAgICAgIHsgLi4uc3RhdGUsIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiByZWNlaXZlciB9LCBpc1NhZmV0eUtpY2s6IGZhbHNlIH0sXG4gICAgICByZWNlaXZlcixcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwaGFzZTogXCJSRUdfUExBWVwiLFxuICAgICAgaXNTYWZldHlLaWNrOiBmYWxzZSxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogZmluYWxCYWxsT24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIGZpbmFsQmFsbE9uICsgMTApLFxuICAgICAgICBkb3duOiAxLFxuICAgICAgICBvZmZlbnNlOiByZWNlaXZlcixcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBIYWlsIE1hcnkgb3V0Y29tZXMgKHJ1bi5qczoyMjQyKS4gRGllIHZhbHVlIFx1MjE5MiByZXN1bHQsIGZyb20gb2ZmZW5zZSdzIFBPVjpcbiAqICAgMSBcdTIxOTIgQklHIFNBQ0ssIC0xMCB5YXJkc1xuICogICAyIFx1MjE5MiArMjAgeWFyZHNcbiAqICAgMyBcdTIxOTIgICAwIHlhcmRzXG4gKiAgIDQgXHUyMTkyICs0MCB5YXJkc1xuICogICA1IFx1MjE5MiBJTlRFUkNFUFRJT04gKHR1cm5vdmVyIGF0IHNwb3QpXG4gKiAgIDYgXHUyMTkyIFRPVUNIRE9XTlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7XG4gIGFwcGx5U2FmZXR5LFxuICBhcHBseVRvdWNoZG93bixcbiAgYXBwbHlZYXJkYWdlT3V0Y29tZSxcbiAgYmxhbmtQaWNrLFxuICB0eXBlIFNwZWNpYWxSZXNvbHV0aW9uLFxufSBmcm9tIFwiLi9zaGFyZWQuanNcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVIYWlsTWFyeShzdGF0ZTogR2FtZVN0YXRlLCBybmc6IFJuZyk6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGRpZSA9IHJuZy5kNigpO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbeyB0eXBlOiBcIkhBSUxfTUFSWV9ST0xMXCIsIG91dGNvbWU6IGRpZSB9XTtcblxuICAvLyBEZWNyZW1lbnQgSE0gY291bnQgcmVnYXJkbGVzcyBvZiBvdXRjb21lLlxuICBjb25zdCB1cGRhdGVkUGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtvZmZlbnNlXToge1xuICAgICAgLi4uc3RhdGUucGxheWVyc1tvZmZlbnNlXSxcbiAgICAgIGhhbmQ6IHsgLi4uc3RhdGUucGxheWVyc1tvZmZlbnNlXS5oYW5kLCBITTogTWF0aC5tYXgoMCwgc3RhdGUucGxheWVyc1tvZmZlbnNlXS5oYW5kLkhNIC0gMSkgfSxcbiAgICB9LFxuICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gIGNvbnN0IHN0YXRlV2l0aEhtOiBHYW1lU3RhdGUgPSB7IC4uLnN0YXRlLCBwbGF5ZXJzOiB1cGRhdGVkUGxheWVycyB9O1xuXG4gIC8vIEludGVyY2VwdGlvbiAoZGllIDUpIFx1MjAxNCB0dXJub3ZlciBhdCB0aGUgc3BvdCwgcG9zc2Vzc2lvbiBmbGlwcy5cbiAgaWYgKGRpZSA9PT0gNSkge1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiaW50ZXJjZXB0aW9uXCIgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlV2l0aEhtLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgLi4uc3RhdGVXaXRoSG0uZmllbGQsXG4gICAgICAgICAgb2ZmZW5zZTogb3BwKG9mZmVuc2UpLFxuICAgICAgICAgIGJhbGxPbjogMTAwIC0gc3RhdGVXaXRoSG0uZmllbGQuYmFsbE9uLFxuICAgICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIDEwMCAtIHN0YXRlV2l0aEhtLmZpZWxkLmJhbGxPbiArIDEwKSxcbiAgICAgICAgICBkb3duOiAxLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gVG91Y2hkb3duIChkaWUgNikuXG4gIGlmIChkaWUgPT09IDYpIHtcbiAgICByZXR1cm4gYXBwbHlUb3VjaGRvd24oc3RhdGVXaXRoSG0sIG9mZmVuc2UsIGV2ZW50cyk7XG4gIH1cblxuICAvLyBZYXJkYWdlIG91dGNvbWVzIChkaWUgMSwgMiwgMywgNCkuXG4gIGNvbnN0IHlhcmRzID0gZGllID09PSAxID8gLTEwIDogZGllID09PSAyID8gMjAgOiBkaWUgPT09IDMgPyAwIDogNDA7XG4gIGNvbnN0IHByb2plY3RlZCA9IHN0YXRlV2l0aEhtLmZpZWxkLmJhbGxPbiArIHlhcmRzO1xuXG4gIGlmIChwcm9qZWN0ZWQgPj0gMTAwKSByZXR1cm4gYXBwbHlUb3VjaGRvd24oc3RhdGVXaXRoSG0sIG9mZmVuc2UsIGV2ZW50cyk7XG4gIGlmIChwcm9qZWN0ZWQgPD0gMCkgcmV0dXJuIGFwcGx5U2FmZXR5KHN0YXRlV2l0aEhtLCBvZmZlbnNlLCBldmVudHMpO1xuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICBvZmZlbnNlUGxheTogXCJITVwiLFxuICAgIGRlZmVuc2VQbGF5OiBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA/PyBcIlNSXCIsXG4gICAgbWF0Y2h1cFF1YWxpdHk6IDAsXG4gICAgbXVsdGlwbGllcjogeyBjYXJkOiBcIjEwXCIsIHZhbHVlOiAwIH0sXG4gICAgeWFyZHNDYXJkOiAwLFxuICAgIHlhcmRzR2FpbmVkOiB5YXJkcyxcbiAgICBuZXdCYWxsT246IHByb2plY3RlZCxcbiAgfSk7XG5cbiAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoc3RhdGVXaXRoSG0sIHlhcmRzLCBldmVudHMpO1xufVxuIiwgIi8qKlxuICogU2FtZSBQbGF5IG1lY2hhbmlzbSAocnVuLmpzOjE4OTkpLlxuICpcbiAqIFRyaWdnZXJlZCB3aGVuIGJvdGggdGVhbXMgcGljayB0aGUgc2FtZSByZWd1bGFyIHBsYXkgQU5EIGEgY29pbi1mbGlwIGxhbmRzXG4gKiBoZWFkcyAoYWxzbyB1bmNvbmRpdGlvbmFsbHkgd2hlbiBib3RoIHBpY2sgVHJpY2sgUGxheSkuIFJ1bnMgaXRzIG93blxuICogY29pbiArIG11bHRpcGxpZXItY2FyZCBjaGFpbjpcbiAqXG4gKiAgIG11bHRDYXJkID0gS2luZyAgXHUyMTkyIEJpZyBQbGF5IChvZmZlbnNlIGlmIGNvaW49aGVhZHMsIGRlZmVuc2UgaWYgdGFpbHMpXG4gKiAgIG11bHRDYXJkID0gUXVlZW4gKyBoZWFkcyBcdTIxOTIgbXVsdGlwbGllciA9ICszLCBkcmF3IHlhcmRzIGNhcmRcbiAqICAgbXVsdENhcmQgPSBRdWVlbiArIHRhaWxzIFx1MjE5MiBtdWx0aXBsaWVyID0gIDAsIG5vIHlhcmRzIChkaXN0ID0gMClcbiAqICAgbXVsdENhcmQgPSBKYWNrICArIGhlYWRzIFx1MjE5MiBtdWx0aXBsaWVyID0gIDAsIG5vIHlhcmRzIChkaXN0ID0gMClcbiAqICAgbXVsdENhcmQgPSBKYWNrICArIHRhaWxzIFx1MjE5MiBtdWx0aXBsaWVyID0gLTMsIGRyYXcgeWFyZHMgY2FyZFxuICogICBtdWx0Q2FyZCA9IDEwICAgICsgaGVhZHMgXHUyMTkyIElOVEVSQ0VQVElPTiAodHVybm92ZXIgYXQgc3BvdClcbiAqICAgbXVsdENhcmQgPSAxMCAgICArIHRhaWxzIFx1MjE5MiAwIHlhcmRzXG4gKlxuICogTm90ZTogdGhlIGNvaW4gZmxpcCBpbnNpZGUgdGhpcyBmdW5jdGlvbiBpcyBhIFNFQ09ORCBjb2luIGZsaXAgXHUyMDE0IHRoZVxuICogbWVjaGFuaXNtLXRyaWdnZXIgY29pbiBmbGlwIGlzIGhhbmRsZWQgYnkgdGhlIHJlZHVjZXIgYmVmb3JlIGNhbGxpbmcgaGVyZS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4uLy4uL3N0YXRlLmpzXCI7XG5pbXBvcnQgeyBkcmF3TXVsdGlwbGllciwgZHJhd1lhcmRzIH0gZnJvbSBcIi4uL2RlY2suanNcIjtcbmltcG9ydCB7IHJlc29sdmVCaWdQbGF5IH0gZnJvbSBcIi4vYmlnUGxheS5qc1wiO1xuaW1wb3J0IHtcbiAgYXBwbHlZYXJkYWdlT3V0Y29tZSxcbiAgYmxhbmtQaWNrLFxuICB0eXBlIFNwZWNpYWxSZXNvbHV0aW9uLFxufSBmcm9tIFwiLi9zaGFyZWQuanNcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVTYW1lUGxheShzdGF0ZTogR2FtZVN0YXRlLCBybmc6IFJuZyk6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuXG4gIGNvbnN0IGNvaW4gPSBybmcuY29pbkZsaXAoKTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlNBTUVfUExBWV9DT0lOXCIsIG91dGNvbWU6IGNvaW4gfSk7XG5cbiAgY29uc3QgbXVsdERyYXcgPSBkcmF3TXVsdGlwbGllcihzdGF0ZS5kZWNrLCBybmcpO1xuICBpZiAobXVsdERyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJtdWx0aXBsaWVyXCIgfSk7XG5cbiAgY29uc3Qgc3RhdGVBZnRlck11bHQ6IEdhbWVTdGF0ZSA9IHsgLi4uc3RhdGUsIGRlY2s6IG11bHREcmF3LmRlY2sgfTtcbiAgY29uc3QgaGVhZHMgPSBjb2luID09PSBcImhlYWRzXCI7XG5cbiAgLy8gS2luZyBcdTIxOTIgQmlnIFBsYXkgZm9yIHdoaWNoZXZlciBzaWRlIHdpbnMgdGhlIGNvaW4uXG4gIGlmIChtdWx0RHJhdy5jYXJkID09PSBcIktpbmdcIikge1xuICAgIGNvbnN0IGJlbmVmaWNpYXJ5ID0gaGVhZHMgPyBvZmZlbnNlIDogb3BwKG9mZmVuc2UpO1xuICAgIGNvbnN0IGJwID0gcmVzb2x2ZUJpZ1BsYXkoc3RhdGVBZnRlck11bHQsIGJlbmVmaWNpYXJ5LCBybmcpO1xuICAgIHJldHVybiB7IHN0YXRlOiBicC5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi5icC5ldmVudHNdIH07XG4gIH1cblxuICAvLyAxMCBcdTIxOTIgaW50ZXJjZXB0aW9uIChoZWFkcykgb3IgMCB5YXJkcyAodGFpbHMpLlxuICBpZiAobXVsdERyYXcuY2FyZCA9PT0gXCIxMFwiKSB7XG4gICAgaWYgKGhlYWRzKSB7XG4gICAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcImludGVyY2VwdGlvblwiIH0pO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGU6IHtcbiAgICAgICAgICAuLi5zdGF0ZUFmdGVyTXVsdCxcbiAgICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICAgIC4uLnN0YXRlQWZ0ZXJNdWx0LmZpZWxkLFxuICAgICAgICAgICAgb2ZmZW5zZTogb3BwKG9mZmVuc2UpLFxuICAgICAgICAgICAgYmFsbE9uOiAxMDAgLSBzdGF0ZUFmdGVyTXVsdC5maWVsZC5iYWxsT24sXG4gICAgICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCAxMDAgLSBzdGF0ZUFmdGVyTXVsdC5maWVsZC5iYWxsT24gKyAxMCksXG4gICAgICAgICAgICBkb3duOiAxLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGV2ZW50cyxcbiAgICAgIH07XG4gICAgfVxuICAgIC8vIDAgeWFyZHMsIGRvd24gY29uc3VtZWQuXG4gICAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoc3RhdGVBZnRlck11bHQsIDAsIGV2ZW50cyk7XG4gIH1cblxuICAvLyBRdWVlbiBvciBKYWNrIFx1MjE5MiBtdWx0aXBsaWVyLCB0aGVuIGRyYXcgeWFyZHMgY2FyZC5cbiAgbGV0IG11bHRpcGxpZXIgPSAwO1xuICBpZiAobXVsdERyYXcuY2FyZCA9PT0gXCJRdWVlblwiKSBtdWx0aXBsaWVyID0gaGVhZHMgPyAzIDogMDtcbiAgaWYgKG11bHREcmF3LmNhcmQgPT09IFwiSmFja1wiKSBtdWx0aXBsaWVyID0gaGVhZHMgPyAwIDogLTM7XG5cbiAgaWYgKG11bHRpcGxpZXIgPT09IDApIHtcbiAgICAvLyAwIHlhcmRzLCBkb3duIGNvbnN1bWVkLlxuICAgIHJldHVybiBhcHBseVlhcmRhZ2VPdXRjb21lKHN0YXRlQWZ0ZXJNdWx0LCAwLCBldmVudHMpO1xuICB9XG5cbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKHN0YXRlQWZ0ZXJNdWx0LmRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuXG4gIGNvbnN0IHlhcmRzID0gTWF0aC5yb3VuZChtdWx0aXBsaWVyICogeWFyZHNEcmF3LmNhcmQpO1xuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICBvZmZlbnNlUGxheTogc3RhdGUucGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPz8gXCJTUlwiLFxuICAgIGRlZmVuc2VQbGF5OiBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA/PyBcIlNSXCIsXG4gICAgbWF0Y2h1cFF1YWxpdHk6IDAsXG4gICAgbXVsdGlwbGllcjogeyBjYXJkOiBtdWx0RHJhdy5jYXJkLCB2YWx1ZTogbXVsdGlwbGllciB9LFxuICAgIHlhcmRzQ2FyZDogeWFyZHNEcmF3LmNhcmQsXG4gICAgeWFyZHNHYWluZWQ6IHlhcmRzLFxuICAgIG5ld0JhbGxPbjogTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBzdGF0ZUFmdGVyTXVsdC5maWVsZC5iYWxsT24gKyB5YXJkcykpLFxuICB9KTtcblxuICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShcbiAgICB7IC4uLnN0YXRlQWZ0ZXJNdWx0LCBkZWNrOiB5YXJkc0RyYXcuZGVjayB9LFxuICAgIHlhcmRzLFxuICAgIGV2ZW50cyxcbiAgKTtcbn1cbiIsICIvKipcbiAqIFRyaWNrIFBsYXkgcmVzb2x1dGlvbiAocnVuLmpzOjE5ODcpLiBPbmUgcGVyIHNodWZmbGUsIGNhbGxlZCBieSBlaXRoZXJcbiAqIG9mZmVuc2Ugb3IgZGVmZW5zZS4gRGllIHJvbGwgb3V0Y29tZXMgKGZyb20gdGhlICpjYWxsZXIncyogcGVyc3BlY3RpdmUpOlxuICpcbiAqICAgMSBcdTIxOTIgTG9uZyBQYXNzIHdpdGggKzUgYm9udXMgICAobWF0Y2h1cCB1c2VzIExQIHZzIHRoZSBvdGhlciBzaWRlJ3MgcGljaylcbiAqICAgMiBcdTIxOTIgMTUteWFyZCBwZW5hbHR5IG9uIG9wcG9zaW5nIHNpZGUgKGhhbGYtdG8tZ29hbCBpZiB0aWdodClcbiAqICAgMyBcdTIxOTIgZml4ZWQgLTN4IG11bHRpcGxpZXIsIGRyYXcgeWFyZHMgY2FyZFxuICogICA0IFx1MjE5MiBmaXhlZCArNHggbXVsdGlwbGllciwgZHJhdyB5YXJkcyBjYXJkXG4gKiAgIDUgXHUyMTkyIEJpZyBQbGF5IChiZW5lZmljaWFyeSA9IGNhbGxlcilcbiAqICAgNiBcdTIxOTIgTG9uZyBSdW4gd2l0aCArNSBib251c1xuICpcbiAqIFdoZW4gdGhlIGNhbGxlciBpcyB0aGUgZGVmZW5zZSwgdGhlIHlhcmRhZ2Ugc2lnbnMgaW52ZXJ0IChkZWZlbnNlIGdhaW5zID1cbiAqIG9mZmVuc2UgbG9zZXMpLCB0aGUgTFIvTFAgb3ZlcmxheSBpcyBhcHBsaWVkIHRvIHRoZSBkZWZlbnNpdmUgY2FsbCwgYW5kXG4gKiB0aGUgQmlnIFBsYXkgYmVuZWZpY2lhcnkgaXMgZGVmZW5zZS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgUGxheWVySWQsIFJlZ3VsYXJQbGF5IH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBkcmF3TXVsdGlwbGllciwgZHJhd1lhcmRzIH0gZnJvbSBcIi4uL2RlY2suanNcIjtcbmltcG9ydCB7IE1VTFRJLCBtYXRjaHVwUXVhbGl0eSB9IGZyb20gXCIuLi9tYXRjaHVwLmpzXCI7XG5pbXBvcnQgeyByZXNvbHZlQmlnUGxheSB9IGZyb20gXCIuL2JpZ1BsYXkuanNcIjtcbmltcG9ydCB7XG4gIGFwcGx5WWFyZGFnZU91dGNvbWUsXG4gIGJsYW5rUGljayxcbiAgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbixcbn0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlT2ZmZW5zaXZlVHJpY2tQbGF5KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBybmc6IFJuZyxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGRpZSA9IHJuZy5kNigpO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbeyB0eXBlOiBcIlRSSUNLX1BMQVlfUk9MTFwiLCBvdXRjb21lOiBkaWUgfV07XG5cbiAgLy8gNSBcdTIxOTIgQmlnIFBsYXkgZm9yIG9mZmVuc2UgKGNhbGxlcikuXG4gIGlmIChkaWUgPT09IDUpIHtcbiAgICBjb25zdCBicCA9IHJlc29sdmVCaWdQbGF5KHN0YXRlLCBvZmZlbnNlLCBybmcpO1xuICAgIHJldHVybiB7IHN0YXRlOiBicC5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi5icC5ldmVudHNdIH07XG4gIH1cblxuICAvLyAyIFx1MjE5MiAxNS15YXJkIHBlbmFsdHkgb24gZGVmZW5zZSAoPSBvZmZlbnNlIGdhaW5zIDE1IG9yIGhhbGYtdG8tZ29hbCkuXG4gIGlmIChkaWUgPT09IDIpIHtcbiAgICBjb25zdCByYXdHYWluID0gMTU7XG4gICAgY29uc3QgZ2FpbiA9XG4gICAgICBzdGF0ZS5maWVsZC5iYWxsT24gKyByYXdHYWluID4gOTlcbiAgICAgICAgPyBNYXRoLnRydW5jKCgxMDAgLSBzdGF0ZS5maWVsZC5iYWxsT24pIC8gMilcbiAgICAgICAgOiByYXdHYWluO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJQRU5BTFRZXCIsIGFnYWluc3Q6IG9wcG9uZW50KG9mZmVuc2UpLCB5YXJkczogZ2FpbiwgbG9zc09mRG93bjogZmFsc2UgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgLi4uc3RhdGUuZmllbGQsXG4gICAgICAgICAgYmFsbE9uOiBNYXRoLm1pbigxMDAsIHN0YXRlLmZpZWxkLmJhbGxPbiArIGdhaW4pLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gMyBvciA0IFx1MjE5MiBmaXhlZCBtdWx0aXBsaWVyLCBkcmF3IHlhcmRzIGNhcmQuXG4gIGlmIChkaWUgPT09IDMgfHwgZGllID09PSA0KSB7XG4gICAgY29uc3QgbXVsdGlwbGllciA9IGRpZSA9PT0gMyA/IC0zIDogNDtcbiAgICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMoc3RhdGUuZGVjaywgcm5nKTtcbiAgICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcbiAgICBjb25zdCB5YXJkcyA9IE1hdGgucm91bmQobXVsdGlwbGllciAqIHlhcmRzRHJhdy5jYXJkKTtcblxuICAgIGV2ZW50cy5wdXNoKHtcbiAgICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgICAgb2ZmZW5zZVBsYXk6IFwiVFBcIixcbiAgICAgIGRlZmVuc2VQbGF5OiBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA/PyBcIlNSXCIsXG4gICAgICBtYXRjaHVwUXVhbGl0eTogMCxcbiAgICAgIG11bHRpcGxpZXI6IHsgY2FyZDogXCJLaW5nXCIsIHZhbHVlOiBtdWx0aXBsaWVyIH0sXG4gICAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgICAgeWFyZHNHYWluZWQ6IHlhcmRzLFxuICAgICAgbmV3QmFsbE9uOiBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHN0YXRlLmZpZWxkLmJhbGxPbiArIHlhcmRzKSksXG4gICAgfSk7XG5cbiAgICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShcbiAgICAgIHsgLi4uc3RhdGUsIGRlY2s6IHlhcmRzRHJhdy5kZWNrIH0sXG4gICAgICB5YXJkcyxcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgLy8gMSBvciA2IFx1MjE5MiByZWd1bGFyIHBsYXkgcmVzb2x1dGlvbiB3aXRoIGZvcmNlZCBvZmZlbnNlIHBsYXkgKyBib251cy5cbiAgY29uc3QgZm9yY2VkUGxheTogUmVndWxhclBsYXkgPSBkaWUgPT09IDEgPyBcIkxQXCIgOiBcIkxSXCI7XG4gIGNvbnN0IGJvbnVzID0gNTtcbiAgY29uc3QgZGVmZW5zZVBsYXkgPSBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA/PyBcIlNSXCI7XG5cbiAgLy8gTXVzdCBiZSBhIHJlZ3VsYXIgcGxheSBmb3IgbWF0Y2h1cCB0byBiZSBtZWFuaW5nZnVsLiBJZiBkZWZlbnNlIGFsc28gcGlja2VkXG4gIC8vIHNvbWV0aGluZyB3ZWlyZCwgZmFsbCBiYWNrIHRvIHF1YWxpdHkgMyAobmV1dHJhbCkuXG4gIGNvbnN0IGRlZlBsYXkgPSBpc1JlZ3VsYXIoZGVmZW5zZVBsYXkpID8gZGVmZW5zZVBsYXkgOiBcIlNSXCI7XG4gIGNvbnN0IHF1YWxpdHkgPSBtYXRjaHVwUXVhbGl0eShmb3JjZWRQbGF5LCBkZWZQbGF5KTtcblxuICBjb25zdCBtdWx0RHJhdyA9IGRyYXdNdWx0aXBsaWVyKHN0YXRlLmRlY2ssIHJuZyk7XG4gIGlmIChtdWx0RHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcIm11bHRpcGxpZXJcIiB9KTtcbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKG11bHREcmF3LmRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuXG4gIGNvbnN0IG11bHRSb3cgPSBNVUxUSVttdWx0RHJhdy5pbmRleF07XG4gIGNvbnN0IG11bHRpcGxpZXIgPSBtdWx0Um93Py5bcXVhbGl0eSAtIDFdID8/IDA7XG4gIGNvbnN0IHlhcmRzID0gTWF0aC5yb3VuZChtdWx0aXBsaWVyICogeWFyZHNEcmF3LmNhcmQpICsgYm9udXM7XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgIG9mZmVuc2VQbGF5OiBmb3JjZWRQbGF5LFxuICAgIGRlZmVuc2VQbGF5OiBkZWZQbGF5LFxuICAgIG1hdGNodXBRdWFsaXR5OiBxdWFsaXR5LFxuICAgIG11bHRpcGxpZXI6IHsgY2FyZDogbXVsdERyYXcuY2FyZCwgdmFsdWU6IG11bHRpcGxpZXIgfSxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgIHlhcmRzR2FpbmVkOiB5YXJkcyxcbiAgICBuZXdCYWxsT246IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgc3RhdGUuZmllbGQuYmFsbE9uICsgeWFyZHMpKSxcbiAgfSk7XG5cbiAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoXG4gICAgeyAuLi5zdGF0ZSwgZGVjazogeWFyZHNEcmF3LmRlY2sgfSxcbiAgICB5YXJkcyxcbiAgICBldmVudHMsXG4gICk7XG59XG5cbmZ1bmN0aW9uIGlzUmVndWxhcihwOiBzdHJpbmcpOiBwIGlzIFJlZ3VsYXJQbGF5IHtcbiAgcmV0dXJuIHAgPT09IFwiU1JcIiB8fCBwID09PSBcIkxSXCIgfHwgcCA9PT0gXCJTUFwiIHx8IHAgPT09IFwiTFBcIjtcbn1cblxuZnVuY3Rpb24gb3Bwb25lbnQocDogUGxheWVySWQpOiBQbGF5ZXJJZCB7XG4gIHJldHVybiBwID09PSAxID8gMiA6IDE7XG59XG5cbi8qKlxuICogRGVmZW5zZSBjYWxscyBUcmljayBQbGF5LiBTeW1tZXRyaWMgdG8gdGhlIG9mZmVuc2l2ZSB2ZXJzaW9uIHdpdGggdGhlXG4gKiB5YXJkYWdlIHNpZ24gaW52ZXJ0ZWQgb24gdGhlIExSL0xQIGFuZCBwZW5hbHR5IGJyYW5jaGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZURlZmVuc2l2ZVRyaWNrUGxheShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgcm5nOiBSbmcsXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBkZWZlbmRlciA9IG9wcG9uZW50KG9mZmVuc2UpO1xuICBjb25zdCBkaWUgPSBybmcuZDYoKTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW3sgdHlwZTogXCJUUklDS19QTEFZX1JPTExcIiwgb3V0Y29tZTogZGllIH1dO1xuXG4gIC8vIDUgXHUyMTkyIEJpZyBQbGF5IGZvciBkZWZlbnNlIChjYWxsZXIpLlxuICBpZiAoZGllID09PSA1KSB7XG4gICAgY29uc3QgYnAgPSByZXNvbHZlQmlnUGxheShzdGF0ZSwgZGVmZW5kZXIsIHJuZyk7XG4gICAgcmV0dXJuIHsgc3RhdGU6IGJwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLmJwLmV2ZW50c10gfTtcbiAgfVxuXG4gIC8vIDIgXHUyMTkyIDE1LXlhcmQgcGVuYWx0eSBvbiBvZmZlbnNlICg9IG9mZmVuc2UgbG9zZXMgMTUgb3IgaGFsZi10by1vd24tZ29hbCkuXG4gIGlmIChkaWUgPT09IDIpIHtcbiAgICBjb25zdCByYXdMb3NzID0gLTE1O1xuICAgIGNvbnN0IGxvc3MgPVxuICAgICAgc3RhdGUuZmllbGQuYmFsbE9uICsgcmF3TG9zcyA8IDFcbiAgICAgICAgPyAtTWF0aC50cnVuYyhzdGF0ZS5maWVsZC5iYWxsT24gLyAyKVxuICAgICAgICA6IHJhd0xvc3M7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlBFTkFMVFlcIiwgYWdhaW5zdDogb2ZmZW5zZSwgeWFyZHM6IGxvc3MsIGxvc3NPZkRvd246IGZhbHNlIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGVuZGluZ1BpY2s6IHsgb2ZmZW5zZVBsYXk6IG51bGwsIGRlZmVuc2VQbGF5OiBudWxsIH0sXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgLi4uc3RhdGUuZmllbGQsXG4gICAgICAgICAgYmFsbE9uOiBNYXRoLm1heCgwLCBzdGF0ZS5maWVsZC5iYWxsT24gKyBsb3NzKSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIDMgb3IgNCBcdTIxOTIgZml4ZWQgbXVsdGlwbGllciB3aXRoIHRoZSAqZGVmZW5zZSdzKiBzaWduIGNvbnZlbnRpb24uIHY1LjFcbiAgLy8gYXBwbGllcyB0aGUgc2FtZSArLy0gbXVsdGlwbGllcnMgYXMgb2ZmZW5zaXZlIFRyaWNrIFBsYXk7IHRoZSBpbnZlcnNpb25cbiAgLy8gaXMgaW1wbGljaXQgaW4gZGVmZW5zZSBiZWluZyB0aGUgY2FsbGVyLiBZYXJkYWdlIGlzIGZyb20gb2ZmZW5zZSBQT1YuXG4gIGlmIChkaWUgPT09IDMgfHwgZGllID09PSA0KSB7XG4gICAgY29uc3QgbXVsdGlwbGllciA9IGRpZSA9PT0gMyA/IC0zIDogNDtcbiAgICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMoc3RhdGUuZGVjaywgcm5nKTtcbiAgICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcbiAgICBjb25zdCB5YXJkcyA9IE1hdGgucm91bmQobXVsdGlwbGllciAqIHlhcmRzRHJhdy5jYXJkKTtcblxuICAgIGV2ZW50cy5wdXNoKHtcbiAgICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgICAgb2ZmZW5zZVBsYXk6IHN0YXRlLnBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ID8/IFwiU1JcIixcbiAgICAgIGRlZmVuc2VQbGF5OiBcIlRQXCIsXG4gICAgICBtYXRjaHVwUXVhbGl0eTogMCxcbiAgICAgIG11bHRpcGxpZXI6IHsgY2FyZDogXCJLaW5nXCIsIHZhbHVlOiBtdWx0aXBsaWVyIH0sXG4gICAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgICAgeWFyZHNHYWluZWQ6IHlhcmRzLFxuICAgICAgbmV3QmFsbE9uOiBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHN0YXRlLmZpZWxkLmJhbGxPbiArIHlhcmRzKSksXG4gICAgfSk7XG5cbiAgICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShcbiAgICAgIHsgLi4uc3RhdGUsIGRlY2s6IHlhcmRzRHJhdy5kZWNrIH0sXG4gICAgICB5YXJkcyxcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgLy8gMSBvciA2IFx1MjE5MiBkZWZlbnNlJ3MgcGljayBiZWNvbWVzIExQIC8gTFIgd2l0aCAtNSBib251cyB0byBvZmZlbnNlLlxuICBjb25zdCBmb3JjZWREZWZQbGF5OiBSZWd1bGFyUGxheSA9IGRpZSA9PT0gMSA/IFwiTFBcIiA6IFwiTFJcIjtcbiAgY29uc3QgYm9udXMgPSAtNTtcbiAgY29uc3Qgb2ZmZW5zZVBsYXkgPSBzdGF0ZS5wZW5kaW5nUGljay5vZmZlbnNlUGxheSA/PyBcIlNSXCI7XG4gIGNvbnN0IG9mZlBsYXkgPSBpc1JlZ3VsYXIob2ZmZW5zZVBsYXkpID8gb2ZmZW5zZVBsYXkgOiBcIlNSXCI7XG4gIGNvbnN0IHF1YWxpdHkgPSBtYXRjaHVwUXVhbGl0eShvZmZQbGF5LCBmb3JjZWREZWZQbGF5KTtcblxuICBjb25zdCBtdWx0RHJhdyA9IGRyYXdNdWx0aXBsaWVyKHN0YXRlLmRlY2ssIHJuZyk7XG4gIGlmIChtdWx0RHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcIm11bHRpcGxpZXJcIiB9KTtcbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKG11bHREcmF3LmRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuXG4gIGNvbnN0IG11bHRSb3cgPSBNVUxUSVttdWx0RHJhdy5pbmRleF07XG4gIGNvbnN0IG11bHRpcGxpZXIgPSBtdWx0Um93Py5bcXVhbGl0eSAtIDFdID8/IDA7XG4gIGNvbnN0IHlhcmRzID0gTWF0aC5yb3VuZChtdWx0aXBsaWVyICogeWFyZHNEcmF3LmNhcmQpICsgYm9udXM7XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgIG9mZmVuc2VQbGF5OiBvZmZQbGF5LFxuICAgIGRlZmVuc2VQbGF5OiBmb3JjZWREZWZQbGF5LFxuICAgIG1hdGNodXBRdWFsaXR5OiBxdWFsaXR5LFxuICAgIG11bHRpcGxpZXI6IHsgY2FyZDogbXVsdERyYXcuY2FyZCwgdmFsdWU6IG11bHRpcGxpZXIgfSxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgIHlhcmRzR2FpbmVkOiB5YXJkcyxcbiAgICBuZXdCYWxsT246IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgc3RhdGUuZmllbGQuYmFsbE9uICsgeWFyZHMpKSxcbiAgfSk7XG5cbiAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoXG4gICAgeyAuLi5zdGF0ZSwgZGVjazogeWFyZHNEcmF3LmRlY2sgfSxcbiAgICB5YXJkcyxcbiAgICBldmVudHMsXG4gICk7XG59XG4iLCAiLyoqXG4gKiBGaWVsZCBHb2FsIChydW4uanM6MjA0MCkuXG4gKlxuICogRGlzdGFuY2UgPSAoMTAwIC0gYmFsbE9uKSArIDE3LiBTbyBmcm9tIHRoZSA1MCwgRkcgPSA2Ny15YXJkIGF0dGVtcHQuXG4gKlxuICogRGllIHJvbGwgZGV0ZXJtaW5lcyBzdWNjZXNzIGJ5IGRpc3RhbmNlIGJhbmQ6XG4gKiAgIGRpc3RhbmNlID4gNjUgICAgICAgIFx1MjE5MiAxLWluLTEwMDAgY2hhbmNlIChlZmZlY3RpdmVseSBhdXRvLW1pc3MpXG4gKiAgIGRpc3RhbmNlID49IDYwICAgICAgIFx1MjE5MiBuZWVkcyBkaWUgPSA2XG4gKiAgIGRpc3RhbmNlID49IDUwICAgICAgIFx1MjE5MiBuZWVkcyBkaWUgPj0gNVxuICogICBkaXN0YW5jZSA+PSA0MCAgICAgICBcdTIxOTIgbmVlZHMgZGllID49IDRcbiAqICAgZGlzdGFuY2UgPj0gMzAgICAgICAgXHUyMTkyIG5lZWRzIGRpZSA+PSAzXG4gKiAgIGRpc3RhbmNlID49IDIwICAgICAgIFx1MjE5MiBuZWVkcyBkaWUgPj0gMlxuICogICBkaXN0YW5jZSA8ICAyMCAgICAgICBcdTIxOTIgYXV0by1tYWtlXG4gKlxuICogSWYgYSB0aW1lb3V0IHdhcyBjYWxsZWQgYnkgdGhlIGRlZmVuc2UganVzdCBwcmlvciAoa2lja2VyIGljaW5nKSwgZGllKysuXG4gKlxuICogU3VjY2VzcyBcdTIxOTIgKzMgcG9pbnRzLCBraWNrb2ZmIHRvIG9wcG9uZW50LlxuICogTWlzcyAgICBcdTIxOTIgcG9zc2Vzc2lvbiBmbGlwcyBhdCB0aGUgU1BPVCBPRiBUSEUgS0lDSyAobm90IHRoZSBsaW5lIG9mIHNjcmltbWFnZSkuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi8uLi9zdGF0ZS5qc1wiO1xuaW1wb3J0IHsgYmxhbmtQaWNrLCB0eXBlIFNwZWNpYWxSZXNvbHV0aW9uIH0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRmllbGRHb2FsT3B0aW9ucyB7XG4gIC8qKiB0cnVlIGlmIHRoZSBvcHBvc2luZyB0ZWFtIGNhbGxlZCBhIHRpbWVvdXQgdGhhdCBzaG91bGQgaWNlIHRoZSBraWNrZXIuICovXG4gIGljZWQ/OiBib29sZWFuO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUZpZWxkR29hbChcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgcm5nOiBSbmcsXG4gIG9wdHM6IEZpZWxkR29hbE9wdGlvbnMgPSB7fSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGRpc3RhbmNlID0gMTAwIC0gc3RhdGUuZmllbGQuYmFsbE9uICsgMTc7XG4gIGNvbnN0IHJhd0RpZSA9IHJuZy5kNigpO1xuICBjb25zdCBkaWUgPSBvcHRzLmljZWQgPyBNYXRoLm1pbig2LCByYXdEaWUgKyAxKSA6IHJhd0RpZTtcblxuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcblxuICBsZXQgbWFrZTogYm9vbGVhbjtcbiAgaWYgKGRpc3RhbmNlID4gNjUpIHtcbiAgICAvLyBFc3NlbnRpYWxseSBpbXBvc3NpYmxlIFx1MjAxNCByb2xsZWQgMS0xMDAwLCBtYWtlIG9ubHkgb24gZXhhY3QgaGl0LlxuICAgIG1ha2UgPSBybmcuaW50QmV0d2VlbigxLCAxMDAwKSA9PT0gZGlzdGFuY2U7XG4gIH0gZWxzZSBpZiAoZGlzdGFuY2UgPj0gNjApIG1ha2UgPSBkaWUgPj0gNjtcbiAgZWxzZSBpZiAoZGlzdGFuY2UgPj0gNTApIG1ha2UgPSBkaWUgPj0gNTtcbiAgZWxzZSBpZiAoZGlzdGFuY2UgPj0gNDApIG1ha2UgPSBkaWUgPj0gNDtcbiAgZWxzZSBpZiAoZGlzdGFuY2UgPj0gMzApIG1ha2UgPSBkaWUgPj0gMztcbiAgZWxzZSBpZiAoZGlzdGFuY2UgPj0gMjApIG1ha2UgPSBkaWUgPj0gMjtcbiAgZWxzZSBtYWtlID0gdHJ1ZTtcblxuICBpZiAobWFrZSkge1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJGSUVMRF9HT0FMX0dPT0RcIiwgcGxheWVyOiBvZmZlbnNlIH0pO1xuICAgIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgW29mZmVuc2VdOiB7IC4uLnN0YXRlLnBsYXllcnNbb2ZmZW5zZV0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLnNjb3JlICsgMyB9LFxuICAgIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkZJRUxEX0dPQUxfTUlTU0VEXCIsIHBsYXllcjogb2ZmZW5zZSB9KTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJtaXNzZWRfZmdcIiB9KTtcblxuICAvLyBQb3NzZXNzaW9uIGZsaXBzIGF0IGxpbmUgb2Ygc2NyaW1tYWdlIChiYWxsIHN0YXlzIHdoZXJlIGtpY2tlZCBmcm9tKS5cbiAgY29uc3QgZGVmZW5kZXIgPSBvcHAob2ZmZW5zZSk7XG4gIGNvbnN0IG1pcnJvcmVkQmFsbE9uID0gMTAwIC0gc3RhdGUuZmllbGQuYmFsbE9uO1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogbWlycm9yZWRCYWxsT24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIG1pcnJvcmVkQmFsbE9uICsgMTApLFxuICAgICAgICBkb3duOiAxLFxuICAgICAgICBvZmZlbnNlOiBkZWZlbmRlcixcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBUd28tUG9pbnQgQ29udmVyc2lvbiAoVFdPX1BUIHBoYXNlKS5cbiAqXG4gKiBCYWxsIGlzIHBsYWNlZCBhdCBvZmZlbnNlJ3MgOTcgKD0gMy15YXJkIGxpbmUpLiBBIHNpbmdsZSByZWd1bGFyIHBsYXkgaXNcbiAqIHJlc29sdmVkLiBJZiB0aGUgcmVzdWx0aW5nIHlhcmRhZ2UgY3Jvc3NlcyB0aGUgZ29hbCBsaW5lLCBUV09fUE9JTlRfR09PRC5cbiAqIE90aGVyd2lzZSwgVFdPX1BPSU5UX0ZBSUxFRC4gRWl0aGVyIHdheSwga2lja29mZiBmb2xsb3dzLlxuICpcbiAqIFVubGlrZSBhIG5vcm1hbCBwbGF5LCBhIDJwdCBkb2VzIE5PVCBjaGFuZ2UgZG93bi9kaXN0YW5jZS4gSXQncyBhIG9uZS1zaG90LlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBSZWd1bGFyUGxheSB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgZHJhd011bHRpcGxpZXIsIGRyYXdZYXJkcyB9IGZyb20gXCIuLi9kZWNrLmpzXCI7XG5pbXBvcnQgeyBjb21wdXRlWWFyZGFnZSB9IGZyb20gXCIuLi95YXJkYWdlLmpzXCI7XG5pbXBvcnQgeyBibGFua1BpY2ssIHR5cGUgU3BlY2lhbFJlc29sdXRpb24gfSBmcm9tIFwiLi9zaGFyZWQuanNcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVUd29Qb2ludENvbnZlcnNpb24oXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIG9mZmVuc2VQbGF5OiBSZWd1bGFyUGxheSxcbiAgZGVmZW5zZVBsYXk6IFJlZ3VsYXJQbGF5LFxuICBybmc6IFJuZyxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuXG4gIGNvbnN0IG11bHREcmF3ID0gZHJhd011bHRpcGxpZXIoc3RhdGUuZGVjaywgcm5nKTtcbiAgaWYgKG11bHREcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwibXVsdGlwbGllclwiIH0pO1xuICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMobXVsdERyYXcuZGVjaywgcm5nKTtcbiAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG5cbiAgY29uc3Qgb3V0Y29tZSA9IGNvbXB1dGVZYXJkYWdlKHtcbiAgICBvZmZlbnNlOiBvZmZlbnNlUGxheSxcbiAgICBkZWZlbnNlOiBkZWZlbnNlUGxheSxcbiAgICBtdWx0aXBsaWVyQ2FyZDogbXVsdERyYXcuaW5kZXgsXG4gICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgfSk7XG5cbiAgLy8gMnB0IHN0YXJ0cyBhdCA5Ny4gQ3Jvc3NpbmcgdGhlIGdvYWwgPSBnb29kLlxuICBjb25zdCBzdGFydEJhbGxPbiA9IDk3O1xuICBjb25zdCBwcm9qZWN0ZWQgPSBzdGFydEJhbGxPbiArIG91dGNvbWUueWFyZHNHYWluZWQ7XG4gIGNvbnN0IGdvb2QgPSBwcm9qZWN0ZWQgPj0gMTAwO1xuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICBvZmZlbnNlUGxheSxcbiAgICBkZWZlbnNlUGxheSxcbiAgICBtYXRjaHVwUXVhbGl0eTogb3V0Y29tZS5tYXRjaHVwUXVhbGl0eSxcbiAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IG91dGNvbWUubXVsdGlwbGllckNhcmROYW1lLCB2YWx1ZTogb3V0Y29tZS5tdWx0aXBsaWVyIH0sXG4gICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgICB5YXJkc0dhaW5lZDogb3V0Y29tZS55YXJkc0dhaW5lZCxcbiAgICBuZXdCYWxsT246IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgcHJvamVjdGVkKSksXG4gIH0pO1xuXG4gIGNvbnN0IG5ld1BsYXllcnMgPSBnb29kXG4gICAgPyAoe1xuICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICBbb2ZmZW5zZV06IHsgLi4uc3RhdGUucGxheWVyc1tvZmZlbnNlXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbb2ZmZW5zZV0uc2NvcmUgKyAyIH0sXG4gICAgICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl0pXG4gICAgOiBzdGF0ZS5wbGF5ZXJzO1xuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBnb29kID8gXCJUV09fUE9JTlRfR09PRFwiIDogXCJUV09fUE9JTlRfRkFJTEVEXCIsXG4gICAgcGxheWVyOiBvZmZlbnNlLFxuICB9KTtcblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIGRlY2s6IHlhcmRzRHJhdy5kZWNrLFxuICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIHBoYXNlOiBcIktJQ0tPRkZcIixcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cbiIsICIvKipcbiAqIE92ZXJ0aW1lIG1lY2hhbmljcy5cbiAqXG4gKiBDb2xsZWdlLWZvb3RiYWxsIHN0eWxlOlxuICogICAtIEVhY2ggcGVyaW9kOiBlYWNoIHRlYW0gZ2V0cyBvbmUgcG9zc2Vzc2lvbiBmcm9tIHRoZSBvcHBvbmVudCdzIDI1XG4gKiAgICAgKG9mZmVuc2UgUE9WOiBiYWxsT24gPSA3NSkuXG4gKiAgIC0gQSBwb3NzZXNzaW9uIGVuZHMgd2l0aDogVEQgKGZvbGxvd2VkIGJ5IFBBVC8ycHQpLCBGRyAobWFkZSBvciBtaXNzZWQpLFxuICogICAgIHR1cm5vdmVyLCB0dXJub3Zlci1vbi1kb3ducywgb3Igc2FmZXR5LlxuICogICAtIEFmdGVyIGJvdGggcG9zc2Vzc2lvbnMsIGlmIHNjb3JlcyBkaWZmZXIgXHUyMTkyIEdBTUVfT1ZFUi4gSWYgdGllZCBcdTIxOTIgbmV4dFxuICogICAgIHBlcmlvZC5cbiAqICAgLSBQZXJpb2RzIGFsdGVybmF0ZSB3aG8gcG9zc2Vzc2VzIGZpcnN0LlxuICogICAtIFBlcmlvZCAzKzogMi1wb2ludCBjb252ZXJzaW9uIG1hbmRhdG9yeSBhZnRlciBhIFREIChubyBQQVQga2ljaykuXG4gKiAgIC0gSGFpbCBNYXJ5czogMiBwZXIgcGVyaW9kLCByZWZpbGxlZCBhdCBzdGFydCBvZiBlYWNoIHBlcmlvZC5cbiAqICAgLSBUaW1lb3V0czogMSBwZXIgcGFpciBvZiBwZXJpb2RzLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgT3ZlcnRpbWVTdGF0ZSwgUGxheWVySWQgfSBmcm9tIFwiLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IGVtcHR5SGFuZCwgb3BwIH0gZnJvbSBcIi4uL3N0YXRlLmpzXCI7XG5pbXBvcnQgeyBmcmVzaERlY2tNdWx0aXBsaWVycywgZnJlc2hEZWNrWWFyZHMgfSBmcm9tIFwiLi4vc3RhdGUuanNcIjtcblxuY29uc3QgT1RfQkFMTF9PTiA9IDc1OyAvLyBvcHBvbmVudCdzIDI1LXlhcmQgbGluZSwgZnJvbSBvZmZlbnNlIFBPVlxuXG4vKipcbiAqIEluaXRpYWxpemUgT1Qgc3RhdGUsIHJlZnJlc2ggZGVja3MvaGFuZHMsIHNldCBiYWxsIGF0IHRoZSAyNS5cbiAqIENhbGxlZCBvbmNlIHRpZWQgcmVndWxhdGlvbiBlbmRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3RhcnRPdmVydGltZShzdGF0ZTogR2FtZVN0YXRlKTogeyBzdGF0ZTogR2FtZVN0YXRlOyBldmVudHM6IEV2ZW50W10gfSB7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuICBjb25zdCBmaXJzdFJlY2VpdmVyOiBQbGF5ZXJJZCA9IHN0YXRlLm9wZW5pbmdSZWNlaXZlciA9PT0gMSA/IDIgOiAxO1xuICBjb25zdCBvdmVydGltZTogT3ZlcnRpbWVTdGF0ZSA9IHtcbiAgICBwZXJpb2Q6IDEsXG4gICAgcG9zc2Vzc2lvbjogZmlyc3RSZWNlaXZlcixcbiAgICBmaXJzdFJlY2VpdmVyLFxuICAgIHBvc3Nlc3Npb25zUmVtYWluaW5nOiAyLFxuICB9O1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiT1ZFUlRJTUVfU1RBUlRFRFwiLCBwZXJpb2Q6IDEsIHBvc3Nlc3Npb246IGZpcnN0UmVjZWl2ZXIgfSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGhhc2U6IFwiT1RfU1RBUlRcIixcbiAgICAgIG92ZXJ0aW1lLFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG4vKiogQmVnaW4gKG9yIHJlc3VtZSkgdGhlIG5leHQgT1QgcG9zc2Vzc2lvbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGFydE92ZXJ0aW1lUG9zc2Vzc2lvbihzdGF0ZTogR2FtZVN0YXRlKTogeyBzdGF0ZTogR2FtZVN0YXRlOyBldmVudHM6IEV2ZW50W10gfSB7XG4gIGlmICghc3RhdGUub3ZlcnRpbWUpIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG5cbiAgY29uc3QgcG9zc2Vzc2lvbiA9IHN0YXRlLm92ZXJ0aW1lLnBvc3Nlc3Npb247XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuXG4gIC8vIFJlZmlsbCBITSBjb3VudCBmb3IgdGhlIHBvc3Nlc3Npb24ncyBvZmZlbnNlIChtYXRjaGVzIHY1LjE6IEhNIHJlc2V0c1xuICAvLyBwZXIgT1QgcGVyaW9kKS4gUGVyaW9kIDMrIHBsYXllcnMgaGF2ZSBvbmx5IDIgSE1zIGFueXdheS5cbiAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtwb3NzZXNzaW9uXToge1xuICAgICAgLi4uc3RhdGUucGxheWVyc1twb3NzZXNzaW9uXSxcbiAgICAgIGhhbmQ6IHsgLi4uc3RhdGUucGxheWVyc1twb3NzZXNzaW9uXS5oYW5kLCBITTogc3RhdGUub3ZlcnRpbWUucGVyaW9kID49IDMgPyAyIDogMiB9LFxuICAgIH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICBwaGFzZTogXCJPVF9QTEFZXCIsXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IE9UX0JBTExfT04sXG4gICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIE9UX0JBTExfT04gKyAxMCksXG4gICAgICAgIGRvd246IDEsXG4gICAgICAgIG9mZmVuc2U6IHBvc3Nlc3Npb24sXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG4vKipcbiAqIEVuZCB0aGUgY3VycmVudCBPVCBwb3NzZXNzaW9uLiBEZWNyZW1lbnRzIHBvc3Nlc3Npb25zUmVtYWluaW5nOyBpZiAwLFxuICogY2hlY2tzIGZvciBnYW1lIGVuZC4gT3RoZXJ3aXNlIGZsaXBzIHBvc3Nlc3Npb24uXG4gKlxuICogQ2FsbGVyIGlzIHJlc3BvbnNpYmxlIGZvciBkZXRlY3RpbmcgXCJ0aGlzIHdhcyBhIHBvc3Nlc3Npb24tZW5kaW5nIGV2ZW50XCJcbiAqIChURCtQQVQsIEZHIGRlY2lzaW9uLCB0dXJub3ZlciwgZXRjKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuZE92ZXJ0aW1lUG9zc2Vzc2lvbihzdGF0ZTogR2FtZVN0YXRlKTogeyBzdGF0ZTogR2FtZVN0YXRlOyBldmVudHM6IEV2ZW50W10gfSB7XG4gIGlmICghc3RhdGUub3ZlcnRpbWUpIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG5cbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG4gIGNvbnN0IHJlbWFpbmluZyA9IHN0YXRlLm92ZXJ0aW1lLnBvc3Nlc3Npb25zUmVtYWluaW5nO1xuXG4gIGlmIChyZW1haW5pbmcgPT09IDIpIHtcbiAgICAvLyBGaXJzdCBwb3NzZXNzaW9uIGVuZGVkLiBGbGlwIHRvIHNlY29uZCB0ZWFtLCBmcmVzaCBiYWxsLlxuICAgIGNvbnN0IG5leHRQb3NzZXNzaW9uID0gb3BwKHN0YXRlLm92ZXJ0aW1lLnBvc3Nlc3Npb24pO1xuICAgIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgW25leHRQb3NzZXNzaW9uXToge1xuICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzW25leHRQb3NzZXNzaW9uXSxcbiAgICAgICAgaGFuZDogeyAuLi5zdGF0ZS5wbGF5ZXJzW25leHRQb3NzZXNzaW9uXS5oYW5kLCBITTogMiB9LFxuICAgICAgfSxcbiAgICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgICBwaGFzZTogXCJPVF9QTEFZXCIsXG4gICAgICAgIG92ZXJ0aW1lOiB7IC4uLnN0YXRlLm92ZXJ0aW1lLCBwb3NzZXNzaW9uOiBuZXh0UG9zc2Vzc2lvbiwgcG9zc2Vzc2lvbnNSZW1haW5pbmc6IDEgfSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICBiYWxsT246IE9UX0JBTExfT04sXG4gICAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgT1RfQkFMTF9PTiArIDEwKSxcbiAgICAgICAgICBkb3duOiAxLFxuICAgICAgICAgIG9mZmVuc2U6IG5leHRQb3NzZXNzaW9uLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gU2Vjb25kIHBvc3Nlc3Npb24gZW5kZWQuIENvbXBhcmUgc2NvcmVzLlxuICBjb25zdCBwMSA9IHN0YXRlLnBsYXllcnNbMV0uc2NvcmU7XG4gIGNvbnN0IHAyID0gc3RhdGUucGxheWVyc1syXS5zY29yZTtcbiAgaWYgKHAxICE9PSBwMikge1xuICAgIGNvbnN0IHdpbm5lcjogUGxheWVySWQgPSBwMSA+IHAyID8gMSA6IDI7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkdBTUVfT1ZFUlwiLCB3aW5uZXIgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwaGFzZTogXCJHQU1FX09WRVJcIixcbiAgICAgICAgb3ZlcnRpbWU6IHsgLi4uc3RhdGUub3ZlcnRpbWUsIHBvc3Nlc3Npb25zUmVtYWluaW5nOiAwIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBUaWVkIFx1MjAxNCBzdGFydCBuZXh0IHBlcmlvZC4gQWx0ZXJuYXRlcyBmaXJzdC1wb3NzZXNzb3IuXG4gIGNvbnN0IG5leHRQZXJpb2QgPSBzdGF0ZS5vdmVydGltZS5wZXJpb2QgKyAxO1xuICBjb25zdCBuZXh0Rmlyc3QgPSBvcHAoc3RhdGUub3ZlcnRpbWUuZmlyc3RSZWNlaXZlcik7XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJPVkVSVElNRV9TVEFSVEVEXCIsIHBlcmlvZDogbmV4dFBlcmlvZCwgcG9zc2Vzc2lvbjogbmV4dEZpcnN0IH0pO1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBoYXNlOiBcIk9UX1NUQVJUXCIsXG4gICAgICBvdmVydGltZToge1xuICAgICAgICBwZXJpb2Q6IG5leHRQZXJpb2QsXG4gICAgICAgIHBvc3Nlc3Npb246IG5leHRGaXJzdCxcbiAgICAgICAgZmlyc3RSZWNlaXZlcjogbmV4dEZpcnN0LFxuICAgICAgICBwb3NzZXNzaW9uc1JlbWFpbmluZzogMixcbiAgICAgIH0sXG4gICAgICAvLyBGcmVzaCBkZWNrcyBmb3IgdGhlIG5ldyBwZXJpb2QuXG4gICAgICBkZWNrOiB7IG11bHRpcGxpZXJzOiBmcmVzaERlY2tNdWx0aXBsaWVycygpLCB5YXJkczogZnJlc2hEZWNrWWFyZHMoKSB9LFxuICAgICAgcGxheWVyczoge1xuICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICAxOiB7IC4uLnN0YXRlLnBsYXllcnNbMV0sIGhhbmQ6IGVtcHR5SGFuZCh0cnVlKSB9LFxuICAgICAgICAyOiB7IC4uLnN0YXRlLnBsYXllcnNbMl0sIGhhbmQ6IGVtcHR5SGFuZCh0cnVlKSB9LFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuLyoqXG4gKiBEZXRlY3Qgd2hldGhlciBhIHNlcXVlbmNlIG9mIGV2ZW50cyBmcm9tIGEgcGxheSByZXNvbHV0aW9uIHNob3VsZCBlbmRcbiAqIHRoZSBjdXJyZW50IE9UIHBvc3Nlc3Npb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1Bvc3Nlc3Npb25FbmRpbmdJbk9UKGV2ZW50czogUmVhZG9ubHlBcnJheTxFdmVudD4pOiBib29sZWFuIHtcbiAgZm9yIChjb25zdCBlIG9mIGV2ZW50cykge1xuICAgIHN3aXRjaCAoZS50eXBlKSB7XG4gICAgICBjYXNlIFwiUEFUX0dPT0RcIjpcbiAgICAgIGNhc2UgXCJUV09fUE9JTlRfR09PRFwiOlxuICAgICAgY2FzZSBcIlRXT19QT0lOVF9GQUlMRURcIjpcbiAgICAgIGNhc2UgXCJGSUVMRF9HT0FMX0dPT0RcIjpcbiAgICAgIGNhc2UgXCJGSUVMRF9HT0FMX01JU1NFRFwiOlxuICAgICAgY2FzZSBcIlRVUk5PVkVSXCI6XG4gICAgICBjYXNlIFwiVFVSTk9WRVJfT05fRE9XTlNcIjpcbiAgICAgIGNhc2UgXCJTQUZFVFlcIjpcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cbiIsICIvKipcbiAqIFRoZSBzaW5nbGUgdHJhbnNpdGlvbiBmdW5jdGlvbi4gVGFrZXMgKHN0YXRlLCBhY3Rpb24sIHJuZykgYW5kIHJldHVybnNcbiAqIGEgbmV3IHN0YXRlIHBsdXMgdGhlIGV2ZW50cyB0aGF0IGRlc2NyaWJlIHdoYXQgaGFwcGVuZWQuXG4gKlxuICogVGhpcyBmaWxlIGlzIHRoZSAqc2tlbGV0b24qIFx1MjAxNCB0aGUgZGlzcGF0Y2ggc2hhcGUgaXMgaGVyZSwgdGhlIGNhc2VzIGFyZVxuICogbW9zdGx5IHN0dWJzIG1hcmtlZCBgLy8gVE9ETzogcG9ydCBmcm9tIHJ1bi5qc2AuIEFzIHdlIHBvcnQsIGVhY2ggY2FzZVxuICogZ2V0cyB1bml0LXRlc3RlZC4gV2hlbiBldmVyeSBjYXNlIGlzIGltcGxlbWVudGVkIGFuZCB0ZXN0ZWQsIHY1LjEncyBydW4uanNcbiAqIGNhbiBiZSBkZWxldGVkLlxuICpcbiAqIFJ1bGVzIGZvciB0aGlzIGZpbGU6XG4gKiAgIDEuIE5FVkVSIGltcG9ydCBmcm9tIERPTSwgbmV0d29yaywgb3IgYW5pbWF0aW9uIG1vZHVsZXMuXG4gKiAgIDIuIE5FVkVSIG11dGF0ZSBgc3RhdGVgIFx1MjAxNCBhbHdheXMgcmV0dXJuIGEgbmV3IG9iamVjdC5cbiAqICAgMy4gTkVWRVIgY2FsbCBNYXRoLnJhbmRvbSBcdTIwMTQgdXNlIHRoZSBgcm5nYCBwYXJhbWV0ZXIuXG4gKiAgIDQuIE5FVkVSIHRocm93IG9uIGludmFsaWQgYWN0aW9ucyBcdTIwMTQgcmV0dXJuIGB7IHN0YXRlLCBldmVudHM6IFtdIH1gXG4gKiAgICAgIGFuZCBsZXQgdGhlIGNhbGxlciBkZWNpZGUuIChWYWxpZGF0aW9uIGlzIHRoZSBzZXJ2ZXIncyBqb2IuKVxuICovXG5cbmltcG9ydCB0eXBlIHsgQWN0aW9uIH0gZnJvbSBcIi4vYWN0aW9ucy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIEtpY2tUeXBlLCBSZXR1cm5UeXBlIH0gZnJvbSBcIi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IHZhbGlkYXRlQWN0aW9uIH0gZnJvbSBcIi4vdmFsaWRhdGUuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4vcm5nLmpzXCI7XG5pbXBvcnQgeyBpc1JlZ3VsYXJQbGF5LCByZXNvbHZlUmVndWxhclBsYXkgfSBmcm9tIFwiLi9ydWxlcy9wbGF5LmpzXCI7XG5pbXBvcnQge1xuICByZXNvbHZlRGVmZW5zaXZlVHJpY2tQbGF5LFxuICByZXNvbHZlRmllbGRHb2FsLFxuICByZXNvbHZlSGFpbE1hcnksXG4gIHJlc29sdmVLaWNrb2ZmLFxuICByZXNvbHZlT2ZmZW5zaXZlVHJpY2tQbGF5LFxuICByZXNvbHZlUHVudCxcbiAgcmVzb2x2ZVNhbWVQbGF5LFxuICByZXNvbHZlVHdvUG9pbnRDb252ZXJzaW9uLFxufSBmcm9tIFwiLi9ydWxlcy9zcGVjaWFscy9pbmRleC5qc1wiO1xuaW1wb3J0IHtcbiAgZW5kT3ZlcnRpbWVQb3NzZXNzaW9uLFxuICBpc1Bvc3Nlc3Npb25FbmRpbmdJbk9ULFxuICBzdGFydE92ZXJ0aW1lLFxuICBzdGFydE92ZXJ0aW1lUG9zc2Vzc2lvbixcbn0gZnJvbSBcIi4vcnVsZXMvb3ZlcnRpbWUuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuL3N0YXRlLmpzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVkdWNlUmVzdWx0IHtcbiAgc3RhdGU6IEdhbWVTdGF0ZTtcbiAgZXZlbnRzOiBFdmVudFtdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVkdWNlKHN0YXRlOiBHYW1lU3RhdGUsIGFjdGlvbjogQWN0aW9uLCBybmc6IFJuZyk6IFJlZHVjZVJlc3VsdCB7XG4gIC8vIEdhdGUgYXQgdGhlIHRvcDogaW52YWxpZCBhY3Rpb25zIGFyZSBzaWxlbnRseSBuby1vcGVkLiBTYW1lIGNvbnRyYWN0XG4gIC8vIGFzIHRoZSByZWR1Y2VyJ3MgcGVyLWNhc2Ugc2hhcGUgY2hlY2tzIChcIklsbGVnYWwgcGlja3MgYXJlIHNpbGVudGx5XG4gIC8vIG5vLW9wJ2Q7IHRoZSBvcmNoZXN0cmF0b3IgaXMgcmVzcG9uc2libGUgZm9yIHN1cmZhY2luZyBlcnJvcnNcIiksIGJ1dFxuICAvLyBjZW50cmFsaXplZCBzbyBhbiB1bmF1dGhlbnRpY2F0ZWQgRE8gY2xpZW50IGNhbid0IHNlbmQgYSBtYWxmb3JtZWRcbiAgLy8gcGF5bG9hZCB0aGF0IHNsaXBzIHBhc3QgYSBtaXNzaW5nIGNhc2UtbGV2ZWwgY2hlY2suXG4gIGlmICh2YWxpZGF0ZUFjdGlvbihzdGF0ZSwgYWN0aW9uKSAhPT0gbnVsbCkge1xuICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gIH1cbiAgY29uc3QgcmVzdWx0ID0gcmVkdWNlQ29yZShzdGF0ZSwgYWN0aW9uLCBybmcpO1xuICByZXR1cm4gYXBwbHlPdmVydGltZVJvdXRpbmcoc3RhdGUsIHJlc3VsdCk7XG59XG5cbi8qKlxuICogSWYgd2UncmUgaW4gT1QgYW5kIGEgcG9zc2Vzc2lvbi1lbmRpbmcgZXZlbnQganVzdCBmaXJlZCwgcm91dGUgdG8gdGhlXG4gKiBuZXh0IE9UIHBvc3Nlc3Npb24gKG9yIGdhbWUgZW5kKS4gU2tpcHMgd2hlbiB0aGUgYWN0aW9uIGlzIGl0c2VsZiBhbiBPVFxuICogaGVscGVyIChzbyB3ZSBkb24ndCBkb3VibGUtcm91dGUpLlxuICovXG5mdW5jdGlvbiBhcHBseU92ZXJ0aW1lUm91dGluZyhwcmV2U3RhdGU6IEdhbWVTdGF0ZSwgcmVzdWx0OiBSZWR1Y2VSZXN1bHQpOiBSZWR1Y2VSZXN1bHQge1xuICAvLyBPbmx5IGNvbnNpZGVyIHJvdXRpbmcgd2hlbiB3ZSAqd2VyZSogaW4gT1QuIChzdGFydE92ZXJ0aW1lIHNldHMgc3RhdGUub3ZlcnRpbWUuKVxuICBpZiAoIXByZXZTdGF0ZS5vdmVydGltZSAmJiAhcmVzdWx0LnN0YXRlLm92ZXJ0aW1lKSByZXR1cm4gcmVzdWx0O1xuICBpZiAoIXJlc3VsdC5zdGF0ZS5vdmVydGltZSkgcmV0dXJuIHJlc3VsdDtcbiAgaWYgKCFpc1Bvc3Nlc3Npb25FbmRpbmdJbk9UKHJlc3VsdC5ldmVudHMpKSByZXR1cm4gcmVzdWx0O1xuXG4gIC8vIFBBVCBpbiBPVDogYSBURCBzY29yZWQsIGJ1dCBwb3NzZXNzaW9uIGRvZXNuJ3QgZW5kIHVudGlsIFBBVC8ycHQgcmVzb2x2ZXMuXG4gIC8vIFBBVF9HT09EIC8gVFdPX1BPSU5UXyogYXJlIHRoZW1zZWx2ZXMgcG9zc2Vzc2lvbi1lbmRpbmcsIHNvIHRoZXkgRE8gcm91dGUuXG4gIC8vIEFmdGVyIHBvc3Nlc3Npb24gZW5kcywgZGVjaWRlIG5leHQuXG4gIGNvbnN0IGVuZGVkID0gZW5kT3ZlcnRpbWVQb3NzZXNzaW9uKHJlc3VsdC5zdGF0ZSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IGVuZGVkLnN0YXRlLFxuICAgIGV2ZW50czogWy4uLnJlc3VsdC5ldmVudHMsIC4uLmVuZGVkLmV2ZW50c10sXG4gIH07XG59XG5cbmZ1bmN0aW9uIHJlZHVjZUNvcmUoc3RhdGU6IEdhbWVTdGF0ZSwgYWN0aW9uOiBBY3Rpb24sIHJuZzogUm5nKTogUmVkdWNlUmVzdWx0IHtcbiAgc3dpdGNoIChhY3Rpb24udHlwZSkge1xuICAgIGNhc2UgXCJTVEFSVF9HQU1FXCI6XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0ZToge1xuICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgIHBoYXNlOiBcIkNPSU5fVE9TU1wiLFxuICAgICAgICAgIGNsb2NrOiB7XG4gICAgICAgICAgICAuLi5zdGF0ZS5jbG9jayxcbiAgICAgICAgICAgIHF1YXJ0ZXI6IDEsXG4gICAgICAgICAgICBxdWFydGVyTGVuZ3RoTWludXRlczogYWN0aW9uLnF1YXJ0ZXJMZW5ndGhNaW51dGVzLFxuICAgICAgICAgICAgc2Vjb25kc1JlbWFpbmluZzogYWN0aW9uLnF1YXJ0ZXJMZW5ndGhNaW51dGVzICogNjAsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBwbGF5ZXJzOiB7XG4gICAgICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICAgICAgMTogeyAuLi5zdGF0ZS5wbGF5ZXJzWzFdLCB0ZWFtOiB7IGlkOiBhY3Rpb24udGVhbXNbMV0gfSB9LFxuICAgICAgICAgICAgMjogeyAuLi5zdGF0ZS5wbGF5ZXJzWzJdLCB0ZWFtOiB7IGlkOiBhY3Rpb24udGVhbXNbMl0gfSB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGV2ZW50czogW3sgdHlwZTogXCJHQU1FX1NUQVJURURcIiB9XSxcbiAgICAgIH07XG5cbiAgICBjYXNlIFwiQ09JTl9UT1NTX0NBTExcIjoge1xuICAgICAgY29uc3QgYWN0dWFsID0gcm5nLmNvaW5GbGlwKCk7XG4gICAgICBjb25zdCB3aW5uZXIgPSBhY3Rpb24uY2FsbCA9PT0gYWN0dWFsID8gYWN0aW9uLnBsYXllciA6IG9wcChhY3Rpb24ucGxheWVyKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlLFxuICAgICAgICBldmVudHM6IFt7IHR5cGU6IFwiQ09JTl9UT1NTX1JFU1VMVFwiLCByZXN1bHQ6IGFjdHVhbCwgd2lubmVyIH1dLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiUkVDRUlWRV9DSE9JQ0VcIjoge1xuICAgICAgLy8gVGhlIGNhbGxlcidzIGNob2ljZSBkZXRlcm1pbmVzIHdobyByZWNlaXZlcyB0aGUgb3BlbmluZyBraWNrb2ZmLlxuICAgICAgLy8gXCJyZWNlaXZlXCIgXHUyMTkyIGNhbGxlciByZWNlaXZlczsgXCJkZWZlclwiIFx1MjE5MiBjYWxsZXIga2lja3MgKG9wcG9uZW50IHJlY2VpdmVzKS5cbiAgICAgIGNvbnN0IHJlY2VpdmVyID0gYWN0aW9uLmNob2ljZSA9PT0gXCJyZWNlaXZlXCIgPyBhY3Rpb24ucGxheWVyIDogb3BwKGFjdGlvbi5wbGF5ZXIpO1xuICAgICAgLy8gS2lja2VyIGlzIHRoZSBvcGVuaW5nIG9mZmVuc2UgKHRoZXkga2ljayBvZmYpOyByZWNlaXZlciBnZXRzIHRoZSBiYWxsIGFmdGVyLlxuICAgICAgY29uc3Qga2lja2VyID0gb3BwKHJlY2VpdmVyKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgICAgICAgIG9wZW5pbmdSZWNlaXZlcjogcmVjZWl2ZXIsXG4gICAgICAgICAgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IGtpY2tlciB9LFxuICAgICAgICB9LFxuICAgICAgICBldmVudHM6IFt7IHR5cGU6IFwiS0lDS09GRlwiLCByZWNlaXZpbmdQbGF5ZXI6IHJlY2VpdmVyLCBiYWxsT246IDM1IH1dLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiUkVTT0xWRV9LSUNLT0ZGXCI6IHtcbiAgICAgIGNvbnN0IG9wdHM6IHsga2lja1R5cGU/OiBLaWNrVHlwZTsgcmV0dXJuVHlwZT86IFJldHVyblR5cGUgfSA9IHt9O1xuICAgICAgaWYgKGFjdGlvbi5raWNrVHlwZSkgb3B0cy5raWNrVHlwZSA9IGFjdGlvbi5raWNrVHlwZTtcbiAgICAgIGlmIChhY3Rpb24ucmV0dXJuVHlwZSkgb3B0cy5yZXR1cm5UeXBlID0gYWN0aW9uLnJldHVyblR5cGU7XG4gICAgICBjb25zdCByZXN1bHQgPSByZXNvbHZlS2lja29mZihzdGF0ZSwgcm5nLCBvcHRzKTtcbiAgICAgIHJldHVybiB7IHN0YXRlOiByZXN1bHQuc3RhdGUsIGV2ZW50czogcmVzdWx0LmV2ZW50cyB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJTVEFSVF9PVF9QT1NTRVNTSU9OXCI6IHtcbiAgICAgIGNvbnN0IHIgPSBzdGFydE92ZXJ0aW1lUG9zc2Vzc2lvbihzdGF0ZSk7XG4gICAgICByZXR1cm4geyBzdGF0ZTogci5zdGF0ZSwgZXZlbnRzOiByLmV2ZW50cyB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJQSUNLX1BMQVlcIjoge1xuICAgICAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gICAgICBjb25zdCBpc09mZmVuc2l2ZUNhbGwgPSBhY3Rpb24ucGxheWVyID09PSBvZmZlbnNlO1xuXG4gICAgICAvLyBWYWxpZGF0ZS4gSWxsZWdhbCBwaWNrcyBhcmUgc2lsZW50bHkgbm8tb3AnZDsgdGhlIG9yY2hlc3RyYXRvclxuICAgICAgLy8gKHNlcnZlciAvIFVJKSBpcyByZXNwb25zaWJsZSBmb3Igc3VyZmFjaW5nIHRoZSBlcnJvciB0byB0aGUgdXNlci5cbiAgICAgIGlmIChhY3Rpb24ucGxheSA9PT0gXCJGR1wiIHx8IGFjdGlvbi5wbGF5ID09PSBcIlBVTlRcIiB8fCBhY3Rpb24ucGxheSA9PT0gXCJUV09fUFRcIikge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9OyAvLyB3cm9uZyBhY3Rpb24gdHlwZSBmb3IgdGhlc2VcbiAgICAgIH1cbiAgICAgIGlmIChhY3Rpb24ucGxheSA9PT0gXCJITVwiICYmICFpc09mZmVuc2l2ZUNhbGwpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTsgLy8gZGVmZW5zZSBjYW4ndCBjYWxsIEhhaWwgTWFyeVxuICAgICAgfVxuICAgICAgY29uc3QgaGFuZCA9IHN0YXRlLnBsYXllcnNbYWN0aW9uLnBsYXllcl0uaGFuZDtcbiAgICAgIGlmIChhY3Rpb24ucGxheSA9PT0gXCJITVwiICYmIGhhbmQuSE0gPD0gMCkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgfVxuICAgICAgaWYgKFxuICAgICAgICAoYWN0aW9uLnBsYXkgPT09IFwiU1JcIiB8fCBhY3Rpb24ucGxheSA9PT0gXCJMUlwiIHx8IGFjdGlvbi5wbGF5ID09PSBcIlNQXCIgfHwgYWN0aW9uLnBsYXkgPT09IFwiTFBcIiB8fCBhY3Rpb24ucGxheSA9PT0gXCJUUFwiKSAmJlxuICAgICAgICBoYW5kW2FjdGlvbi5wbGF5XSA8PSAwXG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcbiAgICAgIH1cbiAgICAgIC8vIFJlamVjdCByZS1waWNrcyBmb3IgdGhlIHNhbWUgc2lkZSBpbiB0aGUgc2FtZSBwbGF5LlxuICAgICAgaWYgKGlzT2ZmZW5zaXZlQ2FsbCAmJiBzdGF0ZS5wZW5kaW5nUGljay5vZmZlbnNlUGxheSkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgfVxuICAgICAgaWYgKCFpc09mZmVuc2l2ZUNhbGwgJiYgc3RhdGUucGVuZGluZ1BpY2suZGVmZW5zZVBsYXkpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW1xuICAgICAgICB7IHR5cGU6IFwiUExBWV9DQUxMRURcIiwgcGxheWVyOiBhY3Rpb24ucGxheWVyLCBwbGF5OiBhY3Rpb24ucGxheSB9LFxuICAgICAgXTtcblxuICAgICAgY29uc3QgcGVuZGluZ1BpY2sgPSB7XG4gICAgICAgIG9mZmVuc2VQbGF5OiBpc09mZmVuc2l2ZUNhbGwgPyBhY3Rpb24ucGxheSA6IHN0YXRlLnBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5LFxuICAgICAgICBkZWZlbnNlUGxheTogaXNPZmZlbnNpdmVDYWxsID8gc3RhdGUucGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgOiBhY3Rpb24ucGxheSxcbiAgICAgIH07XG5cbiAgICAgIC8vIEJvdGggdGVhbXMgaGF2ZSBwaWNrZWQgXHUyMDE0IHJlc29sdmUuXG4gICAgICBpZiAocGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgJiYgcGVuZGluZ1BpY2suZGVmZW5zZVBsYXkpIHtcbiAgICAgICAgLy8gMi1wb2ludCBjb252ZXJzaW9uOiBQSUNLX1BMQVkgaW4gVFdPX1BUX0NPTlYgcGhhc2Ugcm91dGVzIHRvIHRoZVxuICAgICAgICAvLyBkZWRpY2F0ZWQgMi1wdCByZXNvbHZlciAoc2NvcmluZyBjYXBwZWQgYXQgMiBwdHMsIG5vIFBBVCBjeWNsZSkuXG4gICAgICAgIC8vIFRQL0hNIG9uIGEgMi1wdCB0cnkgYXJlIGNvZXJjZWQgdG8gU1Igc28gdGhleSBjYW4ndCBtaXMtc2NvcmU6XG4gICAgICAgIC8vIG90aGVyd2lzZSBhIFRQIHRoYXQgZGVmYXVsdHMgdG8gTFIgYW5kIGNyb3NzZXMgdGhlIGdvYWwgbGluZSB3b3VsZFxuICAgICAgICAvLyBydW4gdGhyb3VnaCBhcHBseVlhcmRhZ2VPdXRjb21lIGFuZCBlbWl0IFRPVUNIRE9XTiArIHRyYW5zaXRpb24gdG9cbiAgICAgICAgLy8gUEFUX0NIT0lDRSwgZ3JhbnRpbmcgNiBwb2ludHMgYW5kIGEgZnVsbCBQQVQgaW5zdGVhZCBvZiAyLlxuICAgICAgICBpZiAoc3RhdGUucGhhc2UgPT09IFwiVFdPX1BUX0NPTlZcIikge1xuICAgICAgICAgIGNvbnN0IG9mZlBsYXkgPSBpc1JlZ3VsYXJQbGF5KHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5KVxuICAgICAgICAgICAgPyBwZW5kaW5nUGljay5vZmZlbnNlUGxheVxuICAgICAgICAgICAgOiBcIlNSXCI7XG4gICAgICAgICAgY29uc3QgZGVmUGxheSA9IGlzUmVndWxhclBsYXkocGVuZGluZ1BpY2suZGVmZW5zZVBsYXkpXG4gICAgICAgICAgICA/IHBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5XG4gICAgICAgICAgICA6IFwiU1JcIjtcbiAgICAgICAgICBjb25zdCBzdGF0ZVdpdGhQaWNrOiBHYW1lU3RhdGUgPSB7XG4gICAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICAgIHBlbmRpbmdQaWNrOiB7IG9mZmVuc2VQbGF5OiBvZmZQbGF5LCBkZWZlbnNlUGxheTogZGVmUGxheSB9LFxuICAgICAgICAgIH07XG4gICAgICAgICAgY29uc3QgdHAgPSByZXNvbHZlVHdvUG9pbnRDb252ZXJzaW9uKFxuICAgICAgICAgICAgc3RhdGVXaXRoUGljayxcbiAgICAgICAgICAgIG9mZlBsYXksXG4gICAgICAgICAgICBkZWZQbGF5LFxuICAgICAgICAgICAgcm5nLFxuICAgICAgICAgICk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHRwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLnRwLmV2ZW50c10gfTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHN0YXRlV2l0aFBpY2s6IEdhbWVTdGF0ZSA9IHsgLi4uc3RhdGUsIHBlbmRpbmdQaWNrIH07XG5cbiAgICAgICAgLy8gSGFpbCBNYXJ5IGJ5IG9mZmVuc2UgXHUyMDE0IHJlc29sdmVzIGltbWVkaWF0ZWx5LCBkZWZlbnNlIHBpY2sgaWdub3JlZC5cbiAgICAgICAgaWYgKHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ID09PSBcIkhNXCIpIHtcbiAgICAgICAgICBjb25zdCBobSA9IHJlc29sdmVIYWlsTWFyeShzdGF0ZVdpdGhQaWNrLCBybmcpO1xuICAgICAgICAgIHJldHVybiB7IHN0YXRlOiBobS5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi5obS5ldmVudHNdIH07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBUcmljayBQbGF5IGJ5IGVpdGhlciBzaWRlLiB2NS4xIChydW4uanM6MTg4Nik6IGlmIGJvdGggcGljayBUUCxcbiAgICAgICAgLy8gU2FtZSBQbGF5IGNvaW4gYWx3YXlzIHRyaWdnZXJzIFx1MjAxNCBmYWxscyB0aHJvdWdoIHRvIFNhbWUgUGxheSBiZWxvdy5cbiAgICAgICAgaWYgKFxuICAgICAgICAgIHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ID09PSBcIlRQXCIgJiZcbiAgICAgICAgICBwZW5kaW5nUGljay5kZWZlbnNlUGxheSAhPT0gXCJUUFwiXG4gICAgICAgICkge1xuICAgICAgICAgIGNvbnN0IHRwID0gcmVzb2x2ZU9mZmVuc2l2ZVRyaWNrUGxheShzdGF0ZVdpdGhQaWNrLCBybmcpO1xuICAgICAgICAgIHJldHVybiB7IHN0YXRlOiB0cC5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi50cC5ldmVudHNdIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKFxuICAgICAgICAgIHBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5ID09PSBcIlRQXCIgJiZcbiAgICAgICAgICBwZW5kaW5nUGljay5vZmZlbnNlUGxheSAhPT0gXCJUUFwiXG4gICAgICAgICkge1xuICAgICAgICAgIGNvbnN0IHRwID0gcmVzb2x2ZURlZmVuc2l2ZVRyaWNrUGxheShzdGF0ZVdpdGhQaWNrLCBybmcpO1xuICAgICAgICAgIHJldHVybiB7IHN0YXRlOiB0cC5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi50cC5ldmVudHNdIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ID09PSBcIlRQXCIgJiYgcGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgPT09IFwiVFBcIikge1xuICAgICAgICAgIC8vIEJvdGggVFAgXHUyMTkyIFNhbWUgUGxheSB1bmNvbmRpdGlvbmFsbHkuXG4gICAgICAgICAgY29uc3Qgc3AgPSByZXNvbHZlU2FtZVBsYXkoc3RhdGVXaXRoUGljaywgcm5nKTtcbiAgICAgICAgICByZXR1cm4geyBzdGF0ZTogc3Auc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4uc3AuZXZlbnRzXSB9O1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmVndWxhciB2cyByZWd1bGFyLlxuICAgICAgICBpZiAoXG4gICAgICAgICAgaXNSZWd1bGFyUGxheShwZW5kaW5nUGljay5vZmZlbnNlUGxheSkgJiZcbiAgICAgICAgICBpc1JlZ3VsYXJQbGF5KHBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5KVxuICAgICAgICApIHtcbiAgICAgICAgICAvLyBTYW1lIHBsYXk/IDUwLzUwIGNoYW5jZSB0byB0cmlnZ2VyIFNhbWUgUGxheSBtZWNoYW5pc20uXG4gICAgICAgICAgLy8gU291cmNlOiBydW4uanM6MTg4NiAoYGlmIChwbDEgPT09IHBsMilgKS5cbiAgICAgICAgICBpZiAocGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPT09IHBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5KSB7XG4gICAgICAgICAgICBjb25zdCB0cmlnZ2VyID0gcm5nLmNvaW5GbGlwKCk7XG4gICAgICAgICAgICBpZiAodHJpZ2dlciA9PT0gXCJoZWFkc1wiKSB7XG4gICAgICAgICAgICAgIGNvbnN0IHNwID0gcmVzb2x2ZVNhbWVQbGF5KHN0YXRlV2l0aFBpY2ssIHJuZyk7XG4gICAgICAgICAgICAgIHJldHVybiB7IHN0YXRlOiBzcC5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi5zcC5ldmVudHNdIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBUYWlsczogZmFsbCB0aHJvdWdoIHRvIHJlZ3VsYXIgcmVzb2x1dGlvbiAocXVhbGl0eSA1IG91dGNvbWUpLlxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHJlc29sdmVkID0gcmVzb2x2ZVJlZ3VsYXJQbGF5KFxuICAgICAgICAgICAgc3RhdGVXaXRoUGljayxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgb2ZmZW5zZVBsYXk6IHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5LFxuICAgICAgICAgICAgICBkZWZlbnNlUGxheTogcGVuZGluZ1BpY2suZGVmZW5zZVBsYXksXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcm5nLFxuICAgICAgICAgICk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHJlc29sdmVkLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLnJlc29sdmVkLmV2ZW50c10gfTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIERlZmVuc2l2ZSB0cmljayBwbGF5LCBGRywgUFVOVCwgVFdPX1BUIHBpY2tzIFx1MjAxNCBub3Qgcm91dGVkIGhlcmUgeWV0LlxuICAgICAgICAvLyBGRy9QVU5UL1RXT19QVCBhcmUgZHJpdmVuIGJ5IEZPVVJUSF9ET1dOX0NIT0lDRSAvIFBBVF9DSE9JQ0UgYWN0aW9ucyxcbiAgICAgICAgLy8gbm90IGJ5IFBJQ0tfUExBWS4gRGVmZW5zaXZlIFRQIGlzIGEgVE9ETy5cbiAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHN0YXRlV2l0aFBpY2ssIGV2ZW50cyB9O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4geyBzdGF0ZTogeyAuLi5zdGF0ZSwgcGVuZGluZ1BpY2sgfSwgZXZlbnRzIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIkNBTExfVElNRU9VVFwiOiB7XG4gICAgICBjb25zdCBwID0gc3RhdGUucGxheWVyc1thY3Rpb24ucGxheWVyXTtcbiAgICAgIGlmIChwLnRpbWVvdXRzIDw9IDApIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gICAgICBjb25zdCByZW1haW5pbmcgPSBwLnRpbWVvdXRzIC0gMTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgcGxheWVyczoge1xuICAgICAgICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgICAgICAgIFthY3Rpb24ucGxheWVyXTogeyAuLi5wLCB0aW1lb3V0czogcmVtYWluaW5nIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgZXZlbnRzOiBbeyB0eXBlOiBcIlRJTUVPVVRfQ0FMTEVEXCIsIHBsYXllcjogYWN0aW9uLnBsYXllciwgcmVtYWluaW5nIH1dLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiQUNDRVBUX1BFTkFMVFlcIjpcbiAgICBjYXNlIFwiREVDTElORV9QRU5BTFRZXCI6XG4gICAgICAvLyBQZW5hbHRpZXMgYXJlIGNhcHR1cmVkIGFzIGV2ZW50cyBhdCByZXNvbHV0aW9uIHRpbWUsIGJ1dCBhY2NlcHQvZGVjbGluZVxuICAgICAgLy8gZmxvdyByZXF1aXJlcyBzdGF0ZSBub3QgeWV0IG1vZGVsZWQgKHBlbmRpbmcgcGVuYWx0eSkuIFRPRE8gd2hlblxuICAgICAgLy8gcGVuYWx0eSBtZWNoYW5pY3MgYXJlIHBvcnRlZCBmcm9tIHJ1bi5qcy5cbiAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG5cbiAgICBjYXNlIFwiUEFUX0NIT0lDRVwiOiB7XG4gICAgICBjb25zdCBzY29yZXIgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICAgICAgLy8gM09UKyByZXF1aXJlcyAyLXBvaW50IGNvbnZlcnNpb24uIFNpbGVudGx5IHN1YnN0aXR1dGUgZXZlbiBpZiBcImtpY2tcIlxuICAgICAgLy8gd2FzIHNlbnQgKG1hdGNoZXMgdjUuMSdzIFwibXVzdFwiIGJlaGF2aW9yIGF0IHJ1bi5qczoxNjQxKS5cbiAgICAgIGNvbnN0IGVmZmVjdGl2ZUNob2ljZSA9XG4gICAgICAgIHN0YXRlLm92ZXJ0aW1lICYmIHN0YXRlLm92ZXJ0aW1lLnBlcmlvZCA+PSAzXG4gICAgICAgICAgPyBcInR3b19wb2ludFwiXG4gICAgICAgICAgOiBhY3Rpb24uY2hvaWNlO1xuICAgICAgaWYgKGVmZmVjdGl2ZUNob2ljZSA9PT0gXCJraWNrXCIpIHtcbiAgICAgICAgLy8gQXNzdW1lIGF1dG9tYXRpYyBpbiB2NS4xIFx1MjAxNCBubyBtZWNoYW5pYyByZWNvcmRlZCBmb3IgUEFUIGtpY2tzLlxuICAgICAgICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgICAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICAgICAgW3Njb3Jlcl06IHsgLi4uc3RhdGUucGxheWVyc1tzY29yZXJdLCBzY29yZTogc3RhdGUucGxheWVyc1tzY29yZXJdLnNjb3JlICsgMSB9LFxuICAgICAgICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgc3RhdGU6IHtcbiAgICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgICAgICAgIHBoYXNlOiBcIktJQ0tPRkZcIixcbiAgICAgICAgICB9LFxuICAgICAgICAgIGV2ZW50czogW3sgdHlwZTogXCJQQVRfR09PRFwiLCBwbGF5ZXI6IHNjb3JlciB9XSxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIC8vIHR3b19wb2ludCBcdTIxOTIgdHJhbnNpdGlvbiB0byBUV09fUFRfQ09OViBwaGFzZTsgYSBQSUNLX1BMQVkgcmVzb2x2ZXMgaXQuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0ZToge1xuICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgIHBoYXNlOiBcIlRXT19QVF9DT05WXCIsXG4gICAgICAgICAgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIGJhbGxPbjogOTcsIGZpcnN0RG93bkF0OiAxMDAsIGRvd246IDEgfSxcbiAgICAgICAgfSxcbiAgICAgICAgZXZlbnRzOiBbXSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIkZPVVJUSF9ET1dOX0NIT0lDRVwiOiB7XG4gICAgICBpZiAoYWN0aW9uLmNob2ljZSA9PT0gXCJnb1wiKSB7XG4gICAgICAgIC8vIE5vdGhpbmcgdG8gZG8gXHUyMDE0IHRoZSBuZXh0IFBJQ0tfUExBWSB3aWxsIHJlc29sdmUgbm9ybWFsbHkgZnJvbSA0dGggZG93bi5cbiAgICAgICAgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcbiAgICAgIH1cbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlID09PSBcInB1bnRcIikge1xuICAgICAgICBjb25zdCByZXN1bHQgPSByZXNvbHZlUHVudChzdGF0ZSwgcm5nKTtcbiAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHJlc3VsdC5zdGF0ZSwgZXZlbnRzOiByZXN1bHQuZXZlbnRzIH07XG4gICAgICB9XG4gICAgICAvLyBmZ1xuICAgICAgY29uc3QgcmVzdWx0ID0gcmVzb2x2ZUZpZWxkR29hbChzdGF0ZSwgcm5nKTtcbiAgICAgIHJldHVybiB7IHN0YXRlOiByZXN1bHQuc3RhdGUsIGV2ZW50czogcmVzdWx0LmV2ZW50cyB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJGT1JGRUlUXCI6IHtcbiAgICAgIGNvbnN0IHdpbm5lciA9IG9wcChhY3Rpb24ucGxheWVyKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7IC4uLnN0YXRlLCBwaGFzZTogXCJHQU1FX09WRVJcIiB9LFxuICAgICAgICBldmVudHM6IFt7IHR5cGU6IFwiR0FNRV9PVkVSXCIsIHdpbm5lciB9XSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIlRJQ0tfQ0xPQ0tcIjoge1xuICAgICAgY29uc3QgcHJldiA9IHN0YXRlLmNsb2NrLnNlY29uZHNSZW1haW5pbmc7XG4gICAgICBjb25zdCBuZXh0ID0gTWF0aC5tYXgoMCwgcHJldiAtIGFjdGlvbi5zZWNvbmRzKTtcbiAgICAgIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFt7IHR5cGU6IFwiQ0xPQ0tfVElDS0VEXCIsIHNlY29uZHM6IGFjdGlvbi5zZWNvbmRzIH1dO1xuXG4gICAgICAvLyBUd28tbWludXRlIHdhcm5pbmc6IGNyb3NzaW5nIDEyMCBzZWNvbmRzIGluIFEyIG9yIFE0IHRyaWdnZXJzIGFuIGV2ZW50LlxuICAgICAgaWYgKFxuICAgICAgICAoc3RhdGUuY2xvY2sucXVhcnRlciA9PT0gMiB8fCBzdGF0ZS5jbG9jay5xdWFydGVyID09PSA0KSAmJlxuICAgICAgICBwcmV2ID4gMTIwICYmXG4gICAgICAgIG5leHQgPD0gMTIwXG4gICAgICApIHtcbiAgICAgICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRXT19NSU5VVEVfV0FSTklOR1wiIH0pO1xuICAgICAgfVxuXG4gICAgICAvLyBSLTI4IFplcm8tc2Vjb25kIHBsYXk6IHdoZW4gdGhlIGNsb2NrIGZpcnN0IGhpdHMgMCAocHJldiA+IDAsXG4gICAgICAvLyBuZXh0ID09PSAwKSwgZW1pdCBMQVNUX0NIQU5DRV9UT19PRkZFUkVEIGFuZCBob2xkIHRoZSBxdWFydGVyXG4gICAgICAvLyBvcGVuLiBBIGZpbmFsIHBsYXkgcnVucyBhdCAwOjAwOyB0aGUgcXVhcnRlciBhY3R1YWxseSBlbmRzIG9uXG4gICAgICAvLyB0aGUgTkVYVCBub24temVybyB0aWNrIChwcmV2ID09PSAwICYmIGFjdGlvbi5zZWNvbmRzID4gMCkuXG4gICAgICAvLyBBIFRPIGNhbGxlZCBkdXJpbmcgdGhlIDA6MDAgcGxheSBkaXNwYXRjaGVzIFRJQ0tfQ0xPQ0soMCkgZnJvbVxuICAgICAgLy8gdGhlIGRyaXZlciwgd2hpY2ggbGVhdmVzIHRoZSBjbG9jayBhdCAwIHdpdGhvdXQgdHJhbnNpdGlvbmluZy5cbiAgICAgIGlmIChwcmV2ID4gMCAmJiBuZXh0ID09PSAwKSB7XG4gICAgICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJMQVNUX0NIQU5DRV9UT19PRkZFUkVEXCIsIHF1YXJ0ZXI6IHN0YXRlLmNsb2NrLnF1YXJ0ZXIgfSk7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgc3RhdGU6IHsgLi4uc3RhdGUsIGNsb2NrOiB7IC4uLnN0YXRlLmNsb2NrLCBzZWNvbmRzUmVtYWluaW5nOiAwIH0gfSxcbiAgICAgICAgICBldmVudHMsXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIC8vIENsb2NrIHdhcyBhbHJlYWR5IGF0IDAgYW5kIGEgbm9uLXplcm8gdGljayB3YXMgZGlzcGF0Y2hlZCBcdTIxOTIgdGhlXG4gICAgICAvLyBmaW5hbC1wbGF5IHdpbmRvdyBpcyBjbG9zZWQsIHF1YXJ0ZXIgYWN0dWFsbHkgZW5kcyBub3cuXG4gICAgICBpZiAocHJldiA9PT0gMCAmJiBhY3Rpb24uc2Vjb25kcyA+IDApIHtcbiAgICAgICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlFVQVJURVJfRU5ERURcIiwgcXVhcnRlcjogc3RhdGUuY2xvY2sucXVhcnRlciB9KTtcbiAgICAgICAgLy8gUTFcdTIxOTJRMiBhbmQgUTNcdTIxOTJRNDogcm9sbCBvdmVyIGNsb2NrLCBzYW1lIGhhbGYsIHNhbWUgcG9zc2Vzc2lvbiBjb250aW51ZXMuXG4gICAgICAgIGlmIChzdGF0ZS5jbG9jay5xdWFydGVyID09PSAxIHx8IHN0YXRlLmNsb2NrLnF1YXJ0ZXIgPT09IDMpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdGU6IHtcbiAgICAgICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgICAgIGNsb2NrOiB7XG4gICAgICAgICAgICAgICAgLi4uc3RhdGUuY2xvY2ssXG4gICAgICAgICAgICAgICAgcXVhcnRlcjogc3RhdGUuY2xvY2sucXVhcnRlciArIDEsXG4gICAgICAgICAgICAgICAgc2Vjb25kc1JlbWFpbmluZzogc3RhdGUuY2xvY2sucXVhcnRlckxlbmd0aE1pbnV0ZXMgKiA2MCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBldmVudHMsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICAvLyBFbmQgb2YgUTIgPSBoYWxmdGltZS4gUTQgZW5kID0gcmVndWxhdGlvbiBvdmVyLlxuICAgICAgICBpZiAoc3RhdGUuY2xvY2sucXVhcnRlciA9PT0gMikge1xuICAgICAgICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJIQUxGX0VOREVEXCIgfSk7XG4gICAgICAgICAgLy8gUmVjZWl2ZXIgb2Ygb3BlbmluZyBraWNrb2ZmIGtpY2tzIHRoZSBzZWNvbmQgaGFsZjsgZmxpcCBwb3NzZXNzaW9uLlxuICAgICAgICAgIGNvbnN0IHNlY29uZEhhbGZSZWNlaXZlciA9XG4gICAgICAgICAgICBzdGF0ZS5vcGVuaW5nUmVjZWl2ZXIgPT09IG51bGwgPyAxIDogb3BwKHN0YXRlLm9wZW5pbmdSZWNlaXZlcik7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgICAgICBwaGFzZTogXCJLSUNLT0ZGXCIsXG4gICAgICAgICAgICAgIGNsb2NrOiB7XG4gICAgICAgICAgICAgICAgLi4uc3RhdGUuY2xvY2ssXG4gICAgICAgICAgICAgICAgcXVhcnRlcjogMyxcbiAgICAgICAgICAgICAgICBzZWNvbmRzUmVtYWluaW5nOiBzdGF0ZS5jbG9jay5xdWFydGVyTGVuZ3RoTWludXRlcyAqIDYwLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogb3BwKHNlY29uZEhhbGZSZWNlaXZlcikgfSxcbiAgICAgICAgICAgICAgLy8gUmVmcmVzaCB0aW1lb3V0cyBmb3IgbmV3IGhhbGYuXG4gICAgICAgICAgICAgIHBsYXllcnM6IHtcbiAgICAgICAgICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICAgICAgICAgIDE6IHsgLi4uc3RhdGUucGxheWVyc1sxXSwgdGltZW91dHM6IDMgfSxcbiAgICAgICAgICAgICAgICAyOiB7IC4uLnN0YXRlLnBsYXllcnNbMl0sIHRpbWVvdXRzOiAzIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZXZlbnRzLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgLy8gUTQgZW5kZWQuXG4gICAgICAgIGNvbnN0IHAxID0gc3RhdGUucGxheWVyc1sxXS5zY29yZTtcbiAgICAgICAgY29uc3QgcDIgPSBzdGF0ZS5wbGF5ZXJzWzJdLnNjb3JlO1xuICAgICAgICBpZiAocDEgIT09IHAyKSB7XG4gICAgICAgICAgY29uc3Qgd2lubmVyID0gcDEgPiBwMiA/IDEgOiAyO1xuICAgICAgICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJHQU1FX09WRVJcIiwgd2lubmVyIH0pO1xuICAgICAgICAgIHJldHVybiB7IHN0YXRlOiB7IC4uLnN0YXRlLCBwaGFzZTogXCJHQU1FX09WRVJcIiB9LCBldmVudHMgfTtcbiAgICAgICAgfVxuICAgICAgICAvLyBUaWVkIFx1MjAxNCBoZWFkIHRvIG92ZXJ0aW1lLlxuICAgICAgICBjb25zdCBvdENsb2NrID0geyAuLi5zdGF0ZS5jbG9jaywgcXVhcnRlcjogNSwgc2Vjb25kc1JlbWFpbmluZzogMCB9O1xuICAgICAgICBjb25zdCBvdCA9IHN0YXJ0T3ZlcnRpbWUoeyAuLi5zdGF0ZSwgY2xvY2s6IG90Q2xvY2sgfSk7XG4gICAgICAgIGV2ZW50cy5wdXNoKC4uLm90LmV2ZW50cyk7XG4gICAgICAgIHJldHVybiB7IHN0YXRlOiBvdC5zdGF0ZSwgZXZlbnRzIH07XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7IC4uLnN0YXRlLCBjbG9jazogeyAuLi5zdGF0ZS5jbG9jaywgc2Vjb25kc1JlbWFpbmluZzogbmV4dCB9IH0sXG4gICAgICAgIGV2ZW50cyxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgZGVmYXVsdDoge1xuICAgICAgLy8gRXhoYXVzdGl2ZW5lc3MgY2hlY2sgXHUyMDE0IGFkZGluZyBhIG5ldyBBY3Rpb24gdmFyaWFudCB3aXRob3V0IGhhbmRsaW5nIGl0XG4gICAgICAvLyBoZXJlIHdpbGwgcHJvZHVjZSBhIGNvbXBpbGUgZXJyb3IuXG4gICAgICBjb25zdCBfZXhoYXVzdGl2ZTogbmV2ZXIgPSBhY3Rpb247XG4gICAgICB2b2lkIF9leGhhdXN0aXZlO1xuICAgICAgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBDb252ZW5pZW5jZSBmb3IgcmVwbGF5aW5nIGEgc2VxdWVuY2Ugb2YgYWN0aW9ucyBcdTIwMTQgdXNlZnVsIGZvciB0ZXN0cyBhbmRcbiAqIGZvciBzZXJ2ZXItc2lkZSBnYW1lIHJlcGxheSBmcm9tIGFjdGlvbiBsb2cuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWR1Y2VNYW55KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBhY3Rpb25zOiBBY3Rpb25bXSxcbiAgcm5nOiBSbmcsXG4pOiBSZWR1Y2VSZXN1bHQge1xuICBsZXQgY3VycmVudCA9IHN0YXRlO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcbiAgZm9yIChjb25zdCBhY3Rpb24gb2YgYWN0aW9ucykge1xuICAgIGNvbnN0IHJlc3VsdCA9IHJlZHVjZShjdXJyZW50LCBhY3Rpb24sIHJuZyk7XG4gICAgY3VycmVudCA9IHJlc3VsdC5zdGF0ZTtcbiAgICBldmVudHMucHVzaCguLi5yZXN1bHQuZXZlbnRzKTtcbiAgfVxuICByZXR1cm4geyBzdGF0ZTogY3VycmVudCwgZXZlbnRzIH07XG59XG4iLCAiLyoqXG4gKiBSTkcgYWJzdHJhY3Rpb24uXG4gKlxuICogVGhlIGVuZ2luZSBuZXZlciByZWFjaGVzIGZvciBgTWF0aC5yYW5kb20oKWAgZGlyZWN0bHkuIEFsbCByYW5kb21uZXNzIGlzXG4gKiBzb3VyY2VkIGZyb20gYW4gYFJuZ2AgaW5zdGFuY2UgcGFzc2VkIGludG8gYHJlZHVjZSgpYC4gVGhpcyBpcyB3aGF0IG1ha2VzXG4gKiB0aGUgZW5naW5lIGRldGVybWluaXN0aWMgYW5kIHRlc3RhYmxlLlxuICpcbiAqIEluIHByb2R1Y3Rpb24sIHRoZSBTdXBhYmFzZSBFZGdlIEZ1bmN0aW9uIGNyZWF0ZXMgYSBzZWVkZWQgUk5HIHBlciBnYW1lXG4gKiAoc2VlZCBzdG9yZWQgYWxvbmdzaWRlIGdhbWUgc3RhdGUpLCBzbyBhIGNvbXBsZXRlIGdhbWUgY2FuIGJlIHJlcGxheWVkXG4gKiBkZXRlcm1pbmlzdGljYWxseSBmcm9tIGl0cyBhY3Rpb24gbG9nIFx1MjAxNCB1c2VmdWwgZm9yIGJ1ZyByZXBvcnRzLCByZWNhcFxuICogZ2VuZXJhdGlvbiwgYW5kIFwid2F0Y2ggdGhlIGdhbWUgYmFja1wiIGZlYXR1cmVzLlxuICovXG5cbmV4cG9ydCBpbnRlcmZhY2UgUm5nIHtcbiAgLyoqIEluY2x1c2l2ZSBib3RoIGVuZHMuICovXG4gIGludEJldHdlZW4obWluSW5jbHVzaXZlOiBudW1iZXIsIG1heEluY2x1c2l2ZTogbnVtYmVyKTogbnVtYmVyO1xuICAvKiogUmV0dXJucyBcImhlYWRzXCIgb3IgXCJ0YWlsc1wiLiAqL1xuICBjb2luRmxpcCgpOiBcImhlYWRzXCIgfCBcInRhaWxzXCI7XG4gIC8qKiBSZXR1cm5zIDEtNi4gKi9cbiAgZDYoKTogMSB8IDIgfCAzIHwgNCB8IDUgfCA2O1xufVxuXG4vKipcbiAqIE11bGJlcnJ5MzIgXHUyMDE0IGEgc21hbGwsIGZhc3QsIHdlbGwtZGlzdHJpYnV0ZWQgc2VlZGVkIFBSTkcuIFN1ZmZpY2llbnQgZm9yXG4gKiBhIGNhcmQtZHJhd2luZyBmb290YmFsbCBnYW1lOyBub3QgZm9yIGNyeXB0b2dyYXBoeS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNlZWRlZFJuZyhzZWVkOiBudW1iZXIpOiBSbmcge1xuICBsZXQgc3RhdGUgPSBzZWVkID4+PiAwO1xuXG4gIGNvbnN0IG5leHQgPSAoKTogbnVtYmVyID0+IHtcbiAgICBzdGF0ZSA9IChzdGF0ZSArIDB4NmQyYjc5ZjUpID4+PiAwO1xuICAgIGxldCB0ID0gc3RhdGU7XG4gICAgdCA9IE1hdGguaW11bCh0IF4gKHQgPj4+IDE1KSwgdCB8IDEpO1xuICAgIHQgXj0gdCArIE1hdGguaW11bCh0IF4gKHQgPj4+IDcpLCB0IHwgNjEpO1xuICAgIHJldHVybiAoKHQgXiAodCA+Pj4gMTQpKSA+Pj4gMCkgLyA0Mjk0OTY3Mjk2O1xuICB9O1xuXG4gIHJldHVybiB7XG4gICAgaW50QmV0d2VlbihtaW4sIG1heCkge1xuICAgICAgcmV0dXJuIE1hdGguZmxvb3IobmV4dCgpICogKG1heCAtIG1pbiArIDEpKSArIG1pbjtcbiAgICB9LFxuICAgIGNvaW5GbGlwKCkge1xuICAgICAgcmV0dXJuIG5leHQoKSA8IDAuNSA/IFwiaGVhZHNcIiA6IFwidGFpbHNcIjtcbiAgICB9LFxuICAgIGQ2KCkge1xuICAgICAgcmV0dXJuIChNYXRoLmZsb29yKG5leHQoKSAqIDYpICsgMSkgYXMgMSB8IDIgfCAzIHwgNCB8IDUgfCA2O1xuICAgIH0sXG4gIH07XG59XG4iLCAiLyoqXG4gKiBQdXJlIG91dGNvbWUtdGFibGUgaGVscGVycyBmb3Igc3BlY2lhbCBwbGF5cy4gVGhlc2UgYXJlIGV4dHJhY3RlZFxuICogZnJvbSB0aGUgZnVsbCByZXNvbHZlcnMgc28gdGhhdCBjb25zdW1lcnMgKGxpa2UgdjUuMSdzIGFzeW5jIGNvZGVcbiAqIHBhdGhzKSBjYW4gbG9vayB1cCB0aGUgcnVsZSBvdXRjb21lIHdpdGhvdXQgcnVubmluZyB0aGUgZW5naW5lJ3NcbiAqIHN0YXRlIHRyYW5zaXRpb24uXG4gKlxuICogT25jZSBQaGFzZSAyIGNvbGxhcHNlcyB0aGUgb3JjaGVzdHJhdG9yIGludG8gYGVuZ2luZS5yZWR1Y2VgLCB0aGVzZVxuICogaGVscGVycyBiZWNvbWUgYW4gaW50ZXJuYWwgaW1wbGVtZW50YXRpb24gZGV0YWlsLiBVbnRpbCB0aGVuLCB0aGV5XG4gKiBsZXQgdjUuMSB1c2UgdGhlIGVuZ2luZSBhcyB0aGUgc291cmNlIG9mIHRydXRoIGZvciBnYW1lIHJ1bGVzIHdoaWxlXG4gKiBrZWVwaW5nIGl0cyBpbXBlcmF0aXZlIGZsb3cuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBNdWx0aXBsaWVyQ2FyZE5hbWUgfSBmcm9tIFwiLi4veWFyZGFnZS5qc1wiO1xuaW1wb3J0IHR5cGUgeyBQbGF5ZXJJZCB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuXG4vLyAtLS0tLS0tLS0tIFNhbWUgUGxheSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IHR5cGUgU2FtZVBsYXlPdXRjb21lID1cbiAgfCB7IGtpbmQ6IFwiYmlnX3BsYXlcIjsgYmVuZWZpY2lhcnk6IFwib2ZmZW5zZVwiIHwgXCJkZWZlbnNlXCIgfVxuICB8IHsga2luZDogXCJtdWx0aXBsaWVyXCI7IHZhbHVlOiBudW1iZXI7IGRyYXdZYXJkczogYm9vbGVhbiB9XG4gIHwgeyBraW5kOiBcImludGVyY2VwdGlvblwiIH1cbiAgfCB7IGtpbmQ6IFwibm9fZ2FpblwiIH07XG5cbi8qKlxuICogdjUuMSdzIFNhbWUgUGxheSB0YWJsZSAocnVuLmpzOjE4OTkpLlxuICpcbiAqICAgS2luZyAgICBcdTIxOTIgQmlnIFBsYXkgKG9mZmVuc2UgaWYgaGVhZHMsIGRlZmVuc2UgaWYgdGFpbHMpXG4gKiAgIFF1ZWVuICsgaGVhZHMgXHUyMTkyICszeCBtdWx0aXBsaWVyIChkcmF3IHlhcmRzKVxuICogICBRdWVlbiArIHRhaWxzIFx1MjE5MiAweCBtdWx0aXBsaWVyIChubyB5YXJkcywgbm8gZ2FpbilcbiAqICAgSmFjayAgKyBoZWFkcyBcdTIxOTIgMHggbXVsdGlwbGllclxuICogICBKYWNrICArIHRhaWxzIFx1MjE5MiAtM3ggbXVsdGlwbGllciAoZHJhdyB5YXJkcylcbiAqICAgMTAgICAgKyBoZWFkcyBcdTIxOTIgSU5URVJDRVBUSU9OXG4gKiAgIDEwICAgICsgdGFpbHMgXHUyMTkyIDAgeWFyZHMgKG5vIG1lY2hhbmljKVxuICovXG5leHBvcnQgZnVuY3Rpb24gc2FtZVBsYXlPdXRjb21lKFxuICBjYXJkOiBNdWx0aXBsaWVyQ2FyZE5hbWUsXG4gIGNvaW46IFwiaGVhZHNcIiB8IFwidGFpbHNcIixcbik6IFNhbWVQbGF5T3V0Y29tZSB7XG4gIGNvbnN0IGhlYWRzID0gY29pbiA9PT0gXCJoZWFkc1wiO1xuICBpZiAoY2FyZCA9PT0gXCJLaW5nXCIpIHJldHVybiB7IGtpbmQ6IFwiYmlnX3BsYXlcIiwgYmVuZWZpY2lhcnk6IGhlYWRzID8gXCJvZmZlbnNlXCIgOiBcImRlZmVuc2VcIiB9O1xuICBpZiAoY2FyZCA9PT0gXCIxMFwiKSByZXR1cm4gaGVhZHMgPyB7IGtpbmQ6IFwiaW50ZXJjZXB0aW9uXCIgfSA6IHsga2luZDogXCJub19nYWluXCIgfTtcbiAgaWYgKGNhcmQgPT09IFwiUXVlZW5cIikge1xuICAgIHJldHVybiBoZWFkc1xuICAgICAgPyB7IGtpbmQ6IFwibXVsdGlwbGllclwiLCB2YWx1ZTogMywgZHJhd1lhcmRzOiB0cnVlIH1cbiAgICAgIDogeyBraW5kOiBcIm11bHRpcGxpZXJcIiwgdmFsdWU6IDAsIGRyYXdZYXJkczogZmFsc2UgfTtcbiAgfVxuICAvLyBKYWNrXG4gIHJldHVybiBoZWFkc1xuICAgID8geyBraW5kOiBcIm11bHRpcGxpZXJcIiwgdmFsdWU6IDAsIGRyYXdZYXJkczogZmFsc2UgfVxuICAgIDogeyBraW5kOiBcIm11bHRpcGxpZXJcIiwgdmFsdWU6IC0zLCBkcmF3WWFyZHM6IHRydWUgfTtcbn1cblxuLy8gLS0tLS0tLS0tLSBUcmljayBQbGF5IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIFRyaWNrUGxheU91dGNvbWUgPVxuICB8IHsga2luZDogXCJiaWdfcGxheVwiOyBiZW5lZmljaWFyeTogUGxheWVySWQgfVxuICB8IHsga2luZDogXCJwZW5hbHR5XCI7IHJhd1lhcmRzOiBudW1iZXIgfVxuICB8IHsga2luZDogXCJtdWx0aXBsaWVyXCI7IHZhbHVlOiBudW1iZXIgfVxuICB8IHsga2luZDogXCJvdmVybGF5XCI7IHBsYXk6IFwiTFBcIiB8IFwiTFJcIjsgYm9udXM6IG51bWJlciB9O1xuXG4vKipcbiAqIHY1LjEncyBUcmljayBQbGF5IHRhYmxlIChydW4uanM6MTk4NykuIENhbGxlciA9IHBsYXllciB3aG8gY2FsbGVkIHRoZVxuICogVHJpY2sgUGxheSAob2ZmZW5zZSBvciBkZWZlbnNlKS4gRGllIHJvbGwgb3V0Y29tZXMgKGZyb20gY2FsbGVyJ3MgUE9WKTpcbiAqXG4gKiAgIDEgXHUyMTkyIG92ZXJsYXkgTFAgd2l0aCArNSBib251cyAoc2lnbnMgZmxpcCBmb3IgZGVmZW5zaXZlIGNhbGxlcilcbiAqICAgMiBcdTIxOTIgMTUteWFyZCBwZW5hbHR5IG9uIG9wcG9uZW50XG4gKiAgIDMgXHUyMTkyIGZpeGVkIC0zeCBtdWx0aXBsaWVyLCBkcmF3IHlhcmRzXG4gKiAgIDQgXHUyMTkyIGZpeGVkICs0eCBtdWx0aXBsaWVyLCBkcmF3IHlhcmRzXG4gKiAgIDUgXHUyMTkyIEJpZyBQbGF5IGZvciBjYWxsZXJcbiAqICAgNiBcdTIxOTIgb3ZlcmxheSBMUiB3aXRoICs1IGJvbnVzXG4gKlxuICogYHJhd1lhcmRzYCBvbiBwZW5hbHR5IGlzIHNpZ25lZCBmcm9tIG9mZmVuc2UgUE9WOiBwb3NpdGl2ZSA9IGdhaW4gZm9yXG4gKiBvZmZlbnNlIChvZmZlbnNpdmUgVHJpY2sgUGxheSByb2xsPTIpLCBuZWdhdGl2ZSA9IGxvc3MgKGRlZmVuc2l2ZSkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0cmlja1BsYXlPdXRjb21lKFxuICBjYWxsZXI6IFBsYXllcklkLFxuICBvZmZlbnNlOiBQbGF5ZXJJZCxcbiAgZGllOiAxIHwgMiB8IDMgfCA0IHwgNSB8IDYsXG4pOiBUcmlja1BsYXlPdXRjb21lIHtcbiAgY29uc3QgY2FsbGVySXNPZmZlbnNlID0gY2FsbGVyID09PSBvZmZlbnNlO1xuXG4gIGlmIChkaWUgPT09IDUpIHJldHVybiB7IGtpbmQ6IFwiYmlnX3BsYXlcIiwgYmVuZWZpY2lhcnk6IGNhbGxlciB9O1xuXG4gIGlmIChkaWUgPT09IDIpIHtcbiAgICBjb25zdCByYXdZYXJkcyA9IGNhbGxlcklzT2ZmZW5zZSA/IDE1IDogLTE1O1xuICAgIHJldHVybiB7IGtpbmQ6IFwicGVuYWx0eVwiLCByYXdZYXJkcyB9O1xuICB9XG5cbiAgaWYgKGRpZSA9PT0gMykgcmV0dXJuIHsga2luZDogXCJtdWx0aXBsaWVyXCIsIHZhbHVlOiAtMyB9O1xuICBpZiAoZGllID09PSA0KSByZXR1cm4geyBraW5kOiBcIm11bHRpcGxpZXJcIiwgdmFsdWU6IDQgfTtcblxuICAvLyBkaWUgMSBvciA2XG4gIGNvbnN0IHBsYXkgPSBkaWUgPT09IDEgPyBcIkxQXCIgOiBcIkxSXCI7XG4gIGNvbnN0IGJvbnVzID0gY2FsbGVySXNPZmZlbnNlID8gNSA6IC01O1xuICByZXR1cm4geyBraW5kOiBcIm92ZXJsYXlcIiwgcGxheSwgYm9udXMgfTtcbn1cblxuLy8gLS0tLS0tLS0tLSBCaWcgUGxheSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIEJpZ1BsYXlPdXRjb21lID1cbiAgfCB7IGtpbmQ6IFwib2ZmZW5zZV9nYWluXCI7IHlhcmRzOiBudW1iZXIgfVxuICB8IHsga2luZDogXCJvZmZlbnNlX3RkXCIgfVxuICB8IHsga2luZDogXCJkZWZlbnNlX3BlbmFsdHlcIjsgcmF3WWFyZHM6IG51bWJlciB9XG4gIHwgeyBraW5kOiBcImRlZmVuc2VfZnVtYmxlX3JldHVyblwiOyB5YXJkczogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6IFwiZGVmZW5zZV9mdW1ibGVfdGRcIiB9O1xuXG4vKipcbiAqIHY1LjEncyBCaWcgUGxheSB0YWJsZSAocnVuLmpzOjE5MzMpLiBiZW5lZmljaWFyeSA9IHdobyBiZW5lZml0c1xuICogKG9mZmVuc2Ugb3IgZGVmZW5zZSkuXG4gKlxuICogT2ZmZW5zZTpcbiAqICAgMS0zIFx1MjE5MiArMjUgeWFyZHNcbiAqICAgNC01IFx1MjE5MiBtYXgoaGFsZi10by1nb2FsLCA0MClcbiAqICAgNiAgIFx1MjE5MiBURFxuICogRGVmZW5zZTpcbiAqICAgMS0zIFx1MjE5MiAxMC15YXJkIHBlbmFsdHkgb24gb2ZmZW5zZSAocmVwZWF0IGRvd24pXG4gKiAgIDQtNSBcdTIxOTIgZnVtYmxlLCBkZWZlbnNlIHJldHVybnMgbWF4KGhhbGYtdG8tZ29hbCwgMjUpXG4gKiAgIDYgICBcdTIxOTIgZnVtYmxlLCBkZWZlbnNpdmUgVERcbiAqL1xuLy8gLS0tLS0tLS0tLSBQdW50IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFB1bnQgcmV0dXJuIG11bHRpcGxpZXIgYnkgZHJhd24gbXVsdGlwbGllciBjYXJkIChydW4uanM6MjE5NikuICovXG5leHBvcnQgZnVuY3Rpb24gcHVudFJldHVybk11bHRpcGxpZXIoY2FyZDogTXVsdGlwbGllckNhcmROYW1lKTogbnVtYmVyIHtcbiAgc3dpdGNoIChjYXJkKSB7XG4gICAgY2FzZSBcIktpbmdcIjogcmV0dXJuIDc7XG4gICAgY2FzZSBcIlF1ZWVuXCI6IHJldHVybiA0O1xuICAgIGNhc2UgXCJKYWNrXCI6IHJldHVybiAxO1xuICAgIGNhc2UgXCIxMFwiOiByZXR1cm4gLTAuNTtcbiAgfVxufVxuXG4vKipcbiAqIFB1bnQga2ljayBkaXN0YW5jZSBmb3JtdWxhIChydW4uanM6MjE0Myk6XG4gKiAgIDEwICogeWFyZHNDYXJkIC8gMiArIDIwICogKGNvaW4gPT09IFwiaGVhZHNcIiA/IDEgOiAwKVxuICogeWFyZHNDYXJkIGlzIHRoZSAxLTEwIGNhcmQuIFJhbmdlOiA1LTcwIHlhcmRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcHVudEtpY2tEaXN0YW5jZSh5YXJkc0NhcmQ6IG51bWJlciwgY29pbjogXCJoZWFkc1wiIHwgXCJ0YWlsc1wiKTogbnVtYmVyIHtcbiAgcmV0dXJuICgxMCAqIHlhcmRzQ2FyZCkgLyAyICsgKGNvaW4gPT09IFwiaGVhZHNcIiA/IDIwIDogMCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBiaWdQbGF5T3V0Y29tZShcbiAgYmVuZWZpY2lhcnk6IFBsYXllcklkLFxuICBvZmZlbnNlOiBQbGF5ZXJJZCxcbiAgZGllOiAxIHwgMiB8IDMgfCA0IHwgNSB8IDYsXG4gIC8qKiBiYWxsT24gZnJvbSBvZmZlbnNlIFBPViAoMC0xMDApLiAqL1xuICBiYWxsT246IG51bWJlcixcbik6IEJpZ1BsYXlPdXRjb21lIHtcbiAgY29uc3QgYmVuZWZpdHNPZmZlbnNlID0gYmVuZWZpY2lhcnkgPT09IG9mZmVuc2U7XG5cbiAgaWYgKGJlbmVmaXRzT2ZmZW5zZSkge1xuICAgIGlmIChkaWUgPT09IDYpIHJldHVybiB7IGtpbmQ6IFwib2ZmZW5zZV90ZFwiIH07XG4gICAgaWYgKGRpZSA8PSAzKSByZXR1cm4geyBraW5kOiBcIm9mZmVuc2VfZ2FpblwiLCB5YXJkczogMjUgfTtcbiAgICBjb25zdCBoYWxmVG9Hb2FsID0gTWF0aC5yb3VuZCgoMTAwIC0gYmFsbE9uKSAvIDIpO1xuICAgIHJldHVybiB7IGtpbmQ6IFwib2ZmZW5zZV9nYWluXCIsIHlhcmRzOiBoYWxmVG9Hb2FsID4gNDAgPyBoYWxmVG9Hb2FsIDogNDAgfTtcbiAgfVxuXG4gIC8vIERlZmVuc2UgYmVuZWZpY2lhcnlcbiAgaWYgKGRpZSA8PSAzKSB7XG4gICAgY29uc3QgcmF3WWFyZHMgPSBiYWxsT24gLSAxMCA8IDEgPyAtTWF0aC5mbG9vcihiYWxsT24gLyAyKSA6IC0xMDtcbiAgICByZXR1cm4geyBraW5kOiBcImRlZmVuc2VfcGVuYWx0eVwiLCByYXdZYXJkcyB9O1xuICB9XG4gIGlmIChkaWUgPT09IDYpIHJldHVybiB7IGtpbmQ6IFwiZGVmZW5zZV9mdW1ibGVfdGRcIiB9O1xuICBjb25zdCBoYWxmVG9Hb2FsID0gTWF0aC5yb3VuZCgoMTAwIC0gYmFsbE9uKSAvIDIpO1xuICByZXR1cm4geyBraW5kOiBcImRlZmVuc2VfZnVtYmxlX3JldHVyblwiLCB5YXJkczogaGFsZlRvR29hbCA+IDI1ID8gaGFsZlRvR29hbCA6IDI1IH07XG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBb0JBLElBQU0sYUFBeUIsQ0FBQyxNQUFNLE1BQU0sSUFBSTtBQUNoRCxJQUFNLGVBQTZCLENB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O0FBRXhDLE1BQUksaUJBQWlCO0FBQ25CLFFBQUksUUFBUSxFQUFHLFFBQU8sRUFBRSxNQUFNLGFBQWE7QUFDM0MsUUFBSSxPQUFPLEVBQUcsUUFBTyxFQUFFLE1BQU0sZ0JBQWdCLE9BQU8sR0FBRztBQUN2RCxVQUFNQyxjQUFhLEtBQUssT0FBTyxNQUFNLFVBQVUsQ0FBQztBQUNoRCxXQUFPLEVBQUUsTUFBTSxnQkFBZ0IsT0FBT0EsY0FBYSxLQUFLQSxjQUFhLEdBQUc7QUFBQSxFQUMxRTtBQUdBLE1BQUksT0FBTyxHQUFHO0FBQ1osVUFBTSxXQUFXLFNBQVMsS0FBSyxJQUFJLENBQUMsS0FBSyxNQUFNLFNBQVMsQ0FBQyxJQUFJO0FBQzdELFdBQU8sRUFBRSxNQUFNLG1CQUFtQixTQUFTO0FBQUEsRUFDN0M7QUFDQSxNQUFJLFFBQVEsRUFBRyxRQUFPLEVBQUUsTUFBTSxvQkFBb0I7QUFDbEQsUUFBTSxhQUFhLEtBQUssT0FBTyxNQUFNLFVBQVUsQ0FBQztBQUNoRCxTQUFPLEVBQUUsTUFBTSx5QkFBeUIsT0FBTyxhQUFhLEtBQUssYUFBYSxHQUFHO0FBQ25GOyIsCiAgIm5hbWVzIjogWyJibGFua1BpY2siLCAiYmxhbmtQaWNrIiwgImhhbGZUb0dvYWwiLCAiYmxhbmtQaWNrIiwgImJsYW5rUGljayIsICJibGFua1BpY2siLCAiYmxhbmtQaWNrIiwgImJsYW5rUGljayIsICJtdWx0aXBsaWVyIiwgInlhcmRzRHJhdyIsICJ5YXJkcyIsICJibGFua1BpY2siLCAiYmxhbmtQaWNrIiwgInN0YXRlV2l0aFBpY2siLCAicmVzdWx0IiwgImhhbGZUb0dvYWwiXQp9Cg==
