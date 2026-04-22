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
  const regularExhausted = hand.SR === 0 && hand.LR === 0 && hand.SP === 0 && hand.LP === 0 && hand.TP === 0;
  if (regularExhausted) {
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
      if (next === 0) {
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy92YWxpZGF0ZS50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3N0YXRlLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvbWF0Y2h1cC50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3lhcmRhZ2UudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9kZWNrLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvcGxheS50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL3NoYXJlZC50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL2JpZ1BsYXkudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9wdW50LnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMva2lja29mZi50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL2hhaWxNYXJ5LnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvc2FtZVBsYXkudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy90cmlja1BsYXkudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9maWVsZEdvYWwudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy90d29Qb2ludC50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL292ZXJ0aW1lLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcmVkdWNlci50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3JuZy50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL291dGNvbWVzLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvKipcbiAqIEFjdGlvbiB2YWxpZGF0aW9uIGxheWVyLiBSdW5zICpiZWZvcmUqIGByZWR1Y2VgIHRvdWNoZXMgc3RhdGUuXG4gKlxuICogVGhlIGVuZ2luZSBwcmV2aW91c2x5IHJlbGllZCBvbiB0aGUgcmVkdWNlcidzIHBlci1jYXNlIHNoYXBlIGNoZWNrcyBhbmRcbiAqIHNpbGVudGx5IGlnbm9yZWQgYW55dGhpbmcgaXQgY291bGRuJ3QgcmVjb2duaXplLiBUaGF0IHdhcyBmaW5lIGZvciBhXG4gKiB0cnVzdGVkIHNpbmdsZS10YWIgZ2FtZSBidXQgdW5zYWZlIGFzIHNvb24gYXMgdGhlIER1cmFibGUgT2JqZWN0XG4gKiBhY2NlcHRzIGFjdGlvbnMgZnJvbSB1bmF1dGhlbnRpY2F0ZWQgV2ViU29ja2V0IGNsaWVudHMgXHUyMDE0IGEgaG9zdGlsZSAob3JcbiAqIGp1c3QgYnVnZ3kpIGNsaWVudCBjb3VsZCBzZW5kIGB7IHR5cGU6ICdSRVNPTFZFX0tJQ0tPRkYnLCBraWNrVHlwZTogJ0ZHJyB9YFxuICogYW5kIGNvcnJ1cHQgc3RhdGUuXG4gKlxuICogYHZhbGlkYXRlQWN0aW9uYCByZXR1cm5zIG51bGwgd2hlbiB0aGUgYWN0aW9uIGlzIGxlZ2FsIGZvciB0aGUgY3VycmVudFxuICogc3RhdGUsIG9yIGEgc3RyaW5nIGV4cGxhaW5pbmcgdGhlIHJlamVjdGlvbi4gSW52YWxpZCBhY3Rpb25zIHNob3VsZCBiZVxuICogbm8tb3BlZCBieSB0aGUgY2FsbGVyIChyZWR1Y2VyIG9yIHNlcnZlciksIG5vdCB0aHJvd24gb24gXHUyMDE0IHRoYXQgbWF0Y2hlc1xuICogdGhlIHJlc3Qgb2YgdGhlIGVuZ2luZSdzIFwiaWxsZWdhbCBwaWNrcyBhcmUgc2lsZW50bHkgZHJvcHBlZFwiIGNvbnRyYWN0XG4gKiBhbmQgYXZvaWRzIGNyYXNoaW5nIG9uIGFuIHVudHJ1c3RlZCBjbGllbnQuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBBY3Rpb24gfSBmcm9tIFwiLi9hY3Rpb25zLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgS2lja1R5cGUsIFJldHVyblR5cGUgfSBmcm9tIFwiLi90eXBlcy5qc1wiO1xuXG5jb25zdCBLSUNLX1RZUEVTOiBLaWNrVHlwZVtdID0gW1wiUktcIiwgXCJPS1wiLCBcIlNLXCJdO1xuY29uc3QgUkVUVVJOX1RZUEVTOiBSZXR1cm5UeXBlW10gPSBbXCJSUlwiLCBcIk9SXCIsIFwiVEJcIl07XG5cbmNvbnN0IFBMQVlfUEhBU0VTID0gbmV3IFNldChbXCJSRUdfUExBWVwiLCBcIk9UX1BMQVlcIiwgXCJUV09fUFRfQ09OVlwiXSk7XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUFjdGlvbihzdGF0ZTogR2FtZVN0YXRlLCBhY3Rpb246IEFjdGlvbik6IHN0cmluZyB8IG51bGwge1xuICBzd2l0Y2ggKGFjdGlvbi50eXBlKSB7XG4gICAgY2FzZSBcIlNUQVJUX0dBTUVcIjpcbiAgICAgIGlmIChzdGF0ZS5waGFzZSAhPT0gXCJJTklUXCIpIHJldHVybiBcIlNUQVJUX0dBTUUgb25seSB2YWxpZCBpbiBJTklUXCI7XG4gICAgICBpZiAodHlwZW9mIGFjdGlvbi5xdWFydGVyTGVuZ3RoTWludXRlcyAhPT0gXCJudW1iZXJcIikgcmV0dXJuIFwiYmFkIHF0ckxlblwiO1xuICAgICAgaWYgKGFjdGlvbi5xdWFydGVyTGVuZ3RoTWludXRlcyA8IDEgfHwgYWN0aW9uLnF1YXJ0ZXJMZW5ndGhNaW51dGVzID4gMTUpIHtcbiAgICAgICAgcmV0dXJuIFwicXRyTGVuIG11c3QgYmUgMS4uMTVcIjtcbiAgICAgIH1cbiAgICAgIGlmICghYWN0aW9uLnRlYW1zIHx8IHR5cGVvZiBhY3Rpb24udGVhbXNbMV0gIT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIGFjdGlvbi50ZWFtc1syXSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICByZXR1cm4gXCJ0ZWFtcyBtaXNzaW5nXCI7XG4gICAgICB9XG4gICAgICByZXR1cm4gbnVsbDtcblxuICAgIGNhc2UgXCJDT0lOX1RPU1NfQ0FMTFwiOlxuICAgICAgaWYgKHN0YXRlLnBoYXNlICE9PSBcIkNPSU5fVE9TU1wiKSByZXR1cm4gXCJub3QgaW4gQ09JTl9UT1NTXCI7XG4gICAgICBpZiAoIWlzUGxheWVyKGFjdGlvbi5wbGF5ZXIpKSByZXR1cm4gXCJiYWQgcGxheWVyXCI7XG4gICAgICBpZiAoYWN0aW9uLmNhbGwgIT09IFwiaGVhZHNcIiAmJiBhY3Rpb24uY2FsbCAhPT0gXCJ0YWlsc1wiKSByZXR1cm4gXCJiYWQgY2FsbFwiO1xuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICBjYXNlIFwiUkVDRUlWRV9DSE9JQ0VcIjpcbiAgICAgIC8vIEFsbG93ZWQgb25seSBhZnRlciB0aGUgY29pbiB0b3NzIHJlc29sdmVzOyBlbmdpbmUncyByZWR1Y2VyIGxlYXZlc1xuICAgICAgLy8gc3RhdGUucGhhc2UgYXQgQ09JTl9UT1NTIHVudGlsIFJFQ0VJVkVfQ0hPSUNFIHRyYW5zaXRpb25zIHRvIEtJQ0tPRkYuXG4gICAgICBpZiAoc3RhdGUucGhhc2UgIT09IFwiQ09JTl9UT1NTXCIpIHJldHVybiBcIm5vdCBpbiBDT0lOX1RPU1NcIjtcbiAgICAgIGlmICghaXNQbGF5ZXIoYWN0aW9uLnBsYXllcikpIHJldHVybiBcImJhZCBwbGF5ZXJcIjtcbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlICE9PSBcInJlY2VpdmVcIiAmJiBhY3Rpb24uY2hvaWNlICE9PSBcImRlZmVyXCIpIHJldHVybiBcImJhZCBjaG9pY2VcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIlBJQ0tfUExBWVwiOlxuICAgICAgaWYgKCFQTEFZX1BIQVNFUy5oYXMoc3RhdGUucGhhc2UpKSByZXR1cm4gXCJub3QgaW4gYSBwbGF5IHBoYXNlXCI7XG4gICAgICBpZiAoIWlzUGxheWVyKGFjdGlvbi5wbGF5ZXIpKSByZXR1cm4gXCJiYWQgcGxheWVyXCI7XG4gICAgICBpZiAoIWlzUGxheUNhbGwoYWN0aW9uLnBsYXkpKSByZXR1cm4gXCJiYWQgcGxheVwiO1xuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICBjYXNlIFwiQ0FMTF9USU1FT1VUXCI6XG4gICAgICBpZiAoIWlzUGxheWVyKGFjdGlvbi5wbGF5ZXIpKSByZXR1cm4gXCJiYWQgcGxheWVyXCI7XG4gICAgICBpZiAoc3RhdGUucGxheWVyc1thY3Rpb24ucGxheWVyXS50aW1lb3V0cyA8PSAwKSByZXR1cm4gXCJubyB0aW1lb3V0cyByZW1haW5pbmdcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIkFDQ0VQVF9QRU5BTFRZXCI6XG4gICAgY2FzZSBcIkRFQ0xJTkVfUEVOQUxUWVwiOlxuICAgICAgaWYgKCFpc1BsYXllcihhY3Rpb24ucGxheWVyKSkgcmV0dXJuIFwiYmFkIHBsYXllclwiO1xuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICBjYXNlIFwiUEFUX0NIT0lDRVwiOlxuICAgICAgaWYgKHN0YXRlLnBoYXNlICE9PSBcIlBBVF9DSE9JQ0VcIikgcmV0dXJuIFwibm90IGluIFBBVF9DSE9JQ0VcIjtcbiAgICAgIGlmICghaXNQbGF5ZXIoYWN0aW9uLnBsYXllcikpIHJldHVybiBcImJhZCBwbGF5ZXJcIjtcbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlICE9PSBcImtpY2tcIiAmJiBhY3Rpb24uY2hvaWNlICE9PSBcInR3b19wb2ludFwiKSByZXR1cm4gXCJiYWQgY2hvaWNlXCI7XG4gICAgICByZXR1cm4gbnVsbDtcblxuICAgIGNhc2UgXCJGT1VSVEhfRE9XTl9DSE9JQ0VcIjpcbiAgICAgIGlmIChzdGF0ZS5waGFzZSAhPT0gXCJSRUdfUExBWVwiICYmIHN0YXRlLnBoYXNlICE9PSBcIk9UX1BMQVlcIikgcmV0dXJuIFwid3JvbmcgcGhhc2VcIjtcbiAgICAgIGlmIChzdGF0ZS5maWVsZC5kb3duICE9PSA0KSByZXR1cm4gXCJub3QgNHRoIGRvd25cIjtcbiAgICAgIGlmICghaXNQbGF5ZXIoYWN0aW9uLnBsYXllcikpIHJldHVybiBcImJhZCBwbGF5ZXJcIjtcbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlICE9PSBcImdvXCIgJiYgYWN0aW9uLmNob2ljZSAhPT0gXCJwdW50XCIgJiYgYWN0aW9uLmNob2ljZSAhPT0gXCJmZ1wiKSB7XG4gICAgICAgIHJldHVybiBcImJhZCBjaG9pY2VcIjtcbiAgICAgIH1cbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlID09PSBcInB1bnRcIiAmJiBzdGF0ZS5waGFzZSA9PT0gXCJPVF9QTEFZXCIpIHJldHVybiBcIm5vIHB1bnRzIGluIE9UXCI7XG4gICAgICBpZiAoYWN0aW9uLmNob2ljZSA9PT0gXCJmZ1wiICYmIHN0YXRlLmZpZWxkLmJhbGxPbiA8IDQ1KSByZXR1cm4gXCJvdXQgb2YgRkcgcmFuZ2VcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIkZPUkZFSVRcIjpcbiAgICAgIGlmICghaXNQbGF5ZXIoYWN0aW9uLnBsYXllcikpIHJldHVybiBcImJhZCBwbGF5ZXJcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIlJFU09MVkVfS0lDS09GRlwiOlxuICAgICAgaWYgKHN0YXRlLnBoYXNlICE9PSBcIktJQ0tPRkZcIikgcmV0dXJuIFwibm90IGluIEtJQ0tPRkZcIjtcbiAgICAgIC8vIFBpY2tzIGFyZSBvcHRpb25hbCAoc2FmZXR5IGtpY2tzIHNraXAgdGhlbSksIGJ1dCB3aGVuIHByZXNlbnQgdGhleVxuICAgICAgLy8gbXVzdCBiZSBsZWdhbCBlbnVtIHZhbHVlcy5cbiAgICAgIGlmIChhY3Rpb24ua2lja1R5cGUgIT09IHVuZGVmaW5lZCAmJiAhS0lDS19UWVBFUy5pbmNsdWRlcyhhY3Rpb24ua2lja1R5cGUpKSB7XG4gICAgICAgIHJldHVybiBcImJhZCBraWNrVHlwZVwiO1xuICAgICAgfVxuICAgICAgaWYgKGFjdGlvbi5yZXR1cm5UeXBlICE9PSB1bmRlZmluZWQgJiYgIVJFVFVSTl9UWVBFUy5pbmNsdWRlcyhhY3Rpb24ucmV0dXJuVHlwZSkpIHtcbiAgICAgICAgcmV0dXJuIFwiYmFkIHJldHVyblR5cGVcIjtcbiAgICAgIH1cbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIlNUQVJUX09UX1BPU1NFU1NJT05cIjpcbiAgICAgIGlmIChzdGF0ZS5waGFzZSAhPT0gXCJPVF9TVEFSVFwiKSByZXR1cm4gXCJub3QgaW4gT1RfU1RBUlRcIjtcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgY2FzZSBcIlRJQ0tfQ0xPQ0tcIjpcbiAgICAgIGlmICh0eXBlb2YgYWN0aW9uLnNlY29uZHMgIT09IFwibnVtYmVyXCIpIHJldHVybiBcImJhZCBzZWNvbmRzXCI7XG4gICAgICBpZiAoYWN0aW9uLnNlY29uZHMgPCAwIHx8IGFjdGlvbi5zZWNvbmRzID4gMzAwKSByZXR1cm4gXCJzZWNvbmRzIG91dCBvZiByYW5nZVwiO1xuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICBkZWZhdWx0OiB7XG4gICAgICBjb25zdCBfZXhoYXVzdGl2ZTogbmV2ZXIgPSBhY3Rpb247XG4gICAgICB2b2lkIF9leGhhdXN0aXZlO1xuICAgICAgcmV0dXJuIFwidW5rbm93biBhY3Rpb24gdHlwZVwiO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBpc1BsYXllcihwOiB1bmtub3duKTogcCBpcyAxIHwgMiB7XG4gIHJldHVybiBwID09PSAxIHx8IHAgPT09IDI7XG59XG5cbmZ1bmN0aW9uIGlzUGxheUNhbGwocDogdW5rbm93bik6IGJvb2xlYW4ge1xuICByZXR1cm4gKFxuICAgIHAgPT09IFwiU1JcIiB8fFxuICAgIHAgPT09IFwiTFJcIiB8fFxuICAgIHAgPT09IFwiU1BcIiB8fFxuICAgIHAgPT09IFwiTFBcIiB8fFxuICAgIHAgPT09IFwiVFBcIiB8fFxuICAgIHAgPT09IFwiSE1cIiB8fFxuICAgIHAgPT09IFwiRkdcIiB8fFxuICAgIHAgPT09IFwiUFVOVFwiIHx8XG4gICAgcCA9PT0gXCJUV09fUFRcIlxuICApO1xufVxuIiwgIi8qKlxuICogU3RhdGUgZmFjdG9yaWVzLlxuICpcbiAqIGBpbml0aWFsU3RhdGUoKWAgcHJvZHVjZXMgYSBmcmVzaCBHYW1lU3RhdGUgaW4gSU5JVCBwaGFzZS4gRXZlcnl0aGluZyBlbHNlXG4gKiBmbG93cyBmcm9tIHJlZHVjaW5nIGFjdGlvbnMgb3ZlciB0aGlzIHN0YXJ0aW5nIHBvaW50LlxuICovXG5cbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBIYW5kLCBQbGF5ZXJJZCwgU3RhdHMsIFRlYW1SZWYgfSBmcm9tIFwiLi90eXBlcy5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gZW1wdHlIYW5kKGlzT3ZlcnRpbWUgPSBmYWxzZSk6IEhhbmQge1xuICByZXR1cm4ge1xuICAgIFNSOiAzLFxuICAgIExSOiAzLFxuICAgIFNQOiAzLFxuICAgIExQOiAzLFxuICAgIFRQOiAxLFxuICAgIEhNOiBpc092ZXJ0aW1lID8gMiA6IDMsXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBlbXB0eVN0YXRzKCk6IFN0YXRzIHtcbiAgcmV0dXJuIHsgcGFzc1lhcmRzOiAwLCBydXNoWWFyZHM6IDAsIHR1cm5vdmVyczogMCwgc2Fja3M6IDAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZyZXNoRGVja011bHRpcGxpZXJzKCk6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdIHtcbiAgcmV0dXJuIFs0LCA0LCA0LCAzXTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZyZXNoRGVja1lhcmRzKCk6IG51bWJlcltdIHtcbiAgcmV0dXJuIFsxLCAxLCAxLCAxLCAxLCAxLCAxLCAxLCAxLCAxXTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBJbml0aWFsU3RhdGVBcmdzIHtcbiAgdGVhbTE6IFRlYW1SZWY7XG4gIHRlYW0yOiBUZWFtUmVmO1xuICBxdWFydGVyTGVuZ3RoTWludXRlczogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaW5pdGlhbFN0YXRlKGFyZ3M6IEluaXRpYWxTdGF0ZUFyZ3MpOiBHYW1lU3RhdGUge1xuICByZXR1cm4ge1xuICAgIHBoYXNlOiBcIklOSVRcIixcbiAgICBzY2hlbWFWZXJzaW9uOiAxLFxuICAgIGNsb2NrOiB7XG4gICAgICBxdWFydGVyOiAwLFxuICAgICAgc2Vjb25kc1JlbWFpbmluZzogYXJncy5xdWFydGVyTGVuZ3RoTWludXRlcyAqIDYwLFxuICAgICAgcXVhcnRlckxlbmd0aE1pbnV0ZXM6IGFyZ3MucXVhcnRlckxlbmd0aE1pbnV0ZXMsXG4gICAgfSxcbiAgICBmaWVsZDoge1xuICAgICAgYmFsbE9uOiAzNSxcbiAgICAgIGZpcnN0RG93bkF0OiA0NSxcbiAgICAgIGRvd246IDEsXG4gICAgICBvZmZlbnNlOiAxLFxuICAgIH0sXG4gICAgZGVjazoge1xuICAgICAgbXVsdGlwbGllcnM6IGZyZXNoRGVja011bHRpcGxpZXJzKCksXG4gICAgICB5YXJkczogZnJlc2hEZWNrWWFyZHMoKSxcbiAgICB9LFxuICAgIHBsYXllcnM6IHtcbiAgICAgIDE6IHtcbiAgICAgICAgdGVhbTogYXJncy50ZWFtMSxcbiAgICAgICAgc2NvcmU6IDAsXG4gICAgICAgIHRpbWVvdXRzOiAzLFxuICAgICAgICBoYW5kOiBlbXB0eUhhbmQoKSxcbiAgICAgICAgc3RhdHM6IGVtcHR5U3RhdHMoKSxcbiAgICAgIH0sXG4gICAgICAyOiB7XG4gICAgICAgIHRlYW06IGFyZ3MudGVhbTIsXG4gICAgICAgIHNjb3JlOiAwLFxuICAgICAgICB0aW1lb3V0czogMyxcbiAgICAgICAgaGFuZDogZW1wdHlIYW5kKCksXG4gICAgICAgIHN0YXRzOiBlbXB0eVN0YXRzKCksXG4gICAgICB9LFxuICAgIH0sXG4gICAgb3BlbmluZ1JlY2VpdmVyOiBudWxsLFxuICAgIG92ZXJ0aW1lOiBudWxsLFxuICAgIHBlbmRpbmdQaWNrOiB7IG9mZmVuc2VQbGF5OiBudWxsLCBkZWZlbnNlUGxheTogbnVsbCB9LFxuICAgIGxhc3RQbGF5RGVzY3JpcHRpb246IFwiU3RhcnQgb2YgZ2FtZVwiLFxuICAgIGlzU2FmZXR5S2ljazogZmFsc2UsXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBvcHAocDogUGxheWVySWQpOiBQbGF5ZXJJZCB7XG4gIHJldHVybiBwID09PSAxID8gMiA6IDE7XG59XG4iLCAiLyoqXG4gKiBUaGUgcGxheSBtYXRjaHVwIG1hdHJpeCBcdTIwMTQgdGhlIGhlYXJ0IG9mIEZvb3RCb3JlZC5cbiAqXG4gKiBCb3RoIHRlYW1zIHBpY2sgYSBwbGF5LiBUaGUgbWF0cml4IHNjb3JlcyBob3cgKmNsb3NlbHkqIHRoZSBkZWZlbnNlXG4gKiBwcmVkaWN0ZWQgdGhlIG9mZmVuc2l2ZSBjYWxsOlxuICogICAtIDEgPSBkZWZlbnNlIHdheSBvZmYgXHUyMTkyIGdyZWF0IGZvciBvZmZlbnNlXG4gKiAgIC0gNSA9IGRlZmVuc2UgbWF0Y2hlZCBcdTIxOTIgdGVycmlibGUgZm9yIG9mZmVuc2UgKGNvbWJpbmVkIHdpdGggYSBsb3dcbiAqICAgICAgICAgbXVsdGlwbGllciBjYXJkLCB0aGlzIGJlY29tZXMgYSBsb3NzIC8gdHVybm92ZXIgcmlzaylcbiAqXG4gKiBSb3dzID0gb2ZmZW5zaXZlIGNhbGwsIENvbHMgPSBkZWZlbnNpdmUgY2FsbC4gT3JkZXI6IFtTUiwgTFIsIFNQLCBMUF0uXG4gKlxuICogICAgICAgICAgIERFRjogU1IgIExSICBTUCAgTFBcbiAqICAgT0ZGOiBTUiAgICAgWyA1LCAgMywgIDMsICAyIF1cbiAqICAgT0ZGOiBMUiAgICAgWyAyLCAgNCwgIDEsICAyIF1cbiAqICAgT0ZGOiBTUCAgICAgWyAzLCAgMiwgIDUsICAzIF1cbiAqICAgT0ZGOiBMUCAgICAgWyAxLCAgMiwgIDIsICA0IF1cbiAqXG4gKiBQb3J0ZWQgdmVyYmF0aW0gZnJvbSBwdWJsaWMvanMvZGVmYXVsdHMuanMgTUFUQ0hVUC4gSW5kZXhpbmcgY29uZmlybWVkXG4gKiBhZ2FpbnN0IHBsYXlNZWNoYW5pc20gLyBjYWxjVGltZXMgaW4gcnVuLmpzOjIzNjguXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBSZWd1bGFyUGxheSB9IGZyb20gXCIuLi90eXBlcy5qc1wiO1xuXG5leHBvcnQgY29uc3QgTUFUQ0hVUDogUmVhZG9ubHlBcnJheTxSZWFkb25seUFycmF5PE1hdGNodXBRdWFsaXR5Pj4gPSBbXG4gIFs1LCAzLCAzLCAyXSxcbiAgWzIsIDQsIDEsIDJdLFxuICBbMywgMiwgNSwgM10sXG4gIFsxLCAyLCAyLCA0XSxcbl0gYXMgY29uc3Q7XG5cbmV4cG9ydCB0eXBlIE1hdGNodXBRdWFsaXR5ID0gMSB8IDIgfCAzIHwgNCB8IDU7XG5cbmNvbnN0IFBMQVlfSU5ERVg6IFJlY29yZDxSZWd1bGFyUGxheSwgMCB8IDEgfCAyIHwgMz4gPSB7XG4gIFNSOiAwLFxuICBMUjogMSxcbiAgU1A6IDIsXG4gIExQOiAzLFxufTtcblxuLyoqXG4gKiBNdWx0aXBsaWVyIGNhcmQgdmFsdWVzLiBJbmRleGluZyAoY29uZmlybWVkIGluIHJ1bi5qczoyMzc3KTpcbiAqICAgcm93ICAgID0gbXVsdGlwbGllciBjYXJkICgwPUtpbmcsIDE9UXVlZW4sIDI9SmFjaywgMz0xMClcbiAqICAgY29sdW1uID0gbWF0Y2h1cCBxdWFsaXR5IC0gMSAoc28gY29sdW1uIDAgPSBxdWFsaXR5IDEsIGNvbHVtbiA0ID0gcXVhbGl0eSA1KVxuICpcbiAqIFF1YWxpdHkgMSAob2ZmZW5zZSBvdXRndWVzc2VkIGRlZmVuc2UpICsgS2luZyA9IDR4LiBCZXN0IHBvc3NpYmxlIHBsYXkuXG4gKiBRdWFsaXR5IDUgKGRlZmVuc2UgbWF0Y2hlZCkgKyAxMCAgICAgICAgPSAtMXguIFdvcnN0IHJlZ3VsYXIgcGxheS5cbiAqXG4gKiAgICAgICAgICAgICAgICAgIHF1YWwgMSAgcXVhbCAyICBxdWFsIDMgIHF1YWwgNCAgcXVhbCA1XG4gKiAgIEtpbmcgICAgKDApICBbICAgNCwgICAgICAzLCAgICAgIDIsICAgICAxLjUsICAgICAxICAgXVxuICogICBRdWVlbiAgICgxKSAgWyAgIDMsICAgICAgMiwgICAgICAxLCAgICAgIDEsICAgICAwLjUgIF1cbiAqICAgSmFjayAgICAoMikgIFsgICAyLCAgICAgIDEsICAgICAwLjUsICAgICAwLCAgICAgIDAgICBdXG4gKiAgIDEwICAgICAgKDMpICBbICAgMCwgICAgICAwLCAgICAgIDAsICAgICAtMSwgICAgIC0xICAgXVxuICpcbiAqIFBvcnRlZCB2ZXJiYXRpbSBmcm9tIHB1YmxpYy9qcy9kZWZhdWx0cy5qcyBNVUxUSS5cbiAqL1xuZXhwb3J0IGNvbnN0IE1VTFRJOiBSZWFkb25seUFycmF5PFJlYWRvbmx5QXJyYXk8bnVtYmVyPj4gPSBbXG4gIFs0LCAzLCAyLCAxLjUsIDFdLFxuICBbMywgMiwgMSwgMSwgMC41XSxcbiAgWzIsIDEsIDAuNSwgMCwgMF0sXG4gIFswLCAwLCAwLCAtMSwgLTFdLFxuXSBhcyBjb25zdDtcblxuZXhwb3J0IGZ1bmN0aW9uIG1hdGNodXBRdWFsaXR5KG9mZjogUmVndWxhclBsYXksIGRlZjogUmVndWxhclBsYXkpOiBNYXRjaHVwUXVhbGl0eSB7XG4gIGNvbnN0IHJvdyA9IE1BVENIVVBbUExBWV9JTkRFWFtvZmZdXTtcbiAgaWYgKCFyb3cpIHRocm93IG5ldyBFcnJvcihgdW5yZWFjaGFibGU6IGJhZCBvZmYgcGxheSAke29mZn1gKTtcbiAgY29uc3QgcSA9IHJvd1tQTEFZX0lOREVYW2RlZl1dO1xuICBpZiAocSA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoYHVucmVhY2hhYmxlOiBiYWQgZGVmIHBsYXkgJHtkZWZ9YCk7XG4gIHJldHVybiBxO1xufVxuIiwgIi8qKlxuICogUHVyZSB5YXJkYWdlIGNhbGN1bGF0aW9uIGZvciBhIHJlZ3VsYXIgcGxheSAoU1IvTFIvU1AvTFApLlxuICpcbiAqIEZvcm11bGEgKHJ1bi5qczoyMzM3KTpcbiAqICAgeWFyZHMgPSByb3VuZChtdWx0aXBsaWVyICogeWFyZHNDYXJkKSArIGJvbnVzXG4gKlxuICogV2hlcmU6XG4gKiAgIC0gbXVsdGlwbGllciA9IE1VTFRJW211bHRpcGxpZXJDYXJkXVtxdWFsaXR5IC0gMV1cbiAqICAgLSBxdWFsaXR5ICAgID0gTUFUQ0hVUFtvZmZlbnNlXVtkZWZlbnNlXSAgIC8vIDEtNVxuICogICAtIGJvbnVzICAgICAgPSBzcGVjaWFsLXBsYXkgYm9udXMgKGUuZy4gVHJpY2sgUGxheSArNSBvbiBMUi9MUCBvdXRjb21lcylcbiAqXG4gKiBTcGVjaWFsIHBsYXlzIChUUCwgSE0sIEZHLCBQVU5ULCBUV09fUFQpIHVzZSBkaWZmZXJlbnQgZm9ybXVsYXMgXHUyMDE0IHRoZXlcbiAqIGxpdmUgaW4gcnVsZXMvc3BlY2lhbC50cyAoVE9ETykgYW5kIHByb2R1Y2UgZXZlbnRzIGRpcmVjdGx5LlxuICovXG5cbmltcG9ydCB0eXBlIHsgUmVndWxhclBsYXkgfSBmcm9tIFwiLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IE1VTFRJLCBtYXRjaHVwUXVhbGl0eSB9IGZyb20gXCIuL21hdGNodXAuanNcIjtcblxuZXhwb3J0IHR5cGUgTXVsdGlwbGllckNhcmRJbmRleCA9IDAgfCAxIHwgMiB8IDM7XG5leHBvcnQgY29uc3QgTVVMVElQTElFUl9DQVJEX05BTUVTID0gW1wiS2luZ1wiLCBcIlF1ZWVuXCIsIFwiSmFja1wiLCBcIjEwXCJdIGFzIGNvbnN0O1xuZXhwb3J0IHR5cGUgTXVsdGlwbGllckNhcmROYW1lID0gKHR5cGVvZiBNVUxUSVBMSUVSX0NBUkRfTkFNRVMpW251bWJlcl07XG5cbmV4cG9ydCBpbnRlcmZhY2UgWWFyZGFnZUlucHV0cyB7XG4gIG9mZmVuc2U6IFJlZ3VsYXJQbGF5O1xuICBkZWZlbnNlOiBSZWd1bGFyUGxheTtcbiAgLyoqIE11bHRpcGxpZXIgY2FyZCBpbmRleDogMD1LaW5nLCAxPVF1ZWVuLCAyPUphY2ssIDM9MTAuICovXG4gIG11bHRpcGxpZXJDYXJkOiBNdWx0aXBsaWVyQ2FyZEluZGV4O1xuICAvKiogWWFyZHMgY2FyZCBkcmF3biwgMS0xMC4gKi9cbiAgeWFyZHNDYXJkOiBudW1iZXI7XG4gIC8qKiBCb251cyB5YXJkcyBmcm9tIHNwZWNpYWwtcGxheSBvdmVybGF5cyAoZS5nLiBUcmljayBQbGF5ICs1KS4gKi9cbiAgYm9udXM/OiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgWWFyZGFnZU91dGNvbWUge1xuICBtYXRjaHVwUXVhbGl0eTogbnVtYmVyO1xuICBtdWx0aXBsaWVyOiBudW1iZXI7XG4gIG11bHRpcGxpZXJDYXJkTmFtZTogTXVsdGlwbGllckNhcmROYW1lO1xuICB5YXJkc0dhaW5lZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY29tcHV0ZVlhcmRhZ2UoaW5wdXRzOiBZYXJkYWdlSW5wdXRzKTogWWFyZGFnZU91dGNvbWUge1xuICBjb25zdCBxdWFsaXR5ID0gbWF0Y2h1cFF1YWxpdHkoaW5wdXRzLm9mZmVuc2UsIGlucHV0cy5kZWZlbnNlKTtcbiAgY29uc3QgbXVsdGlSb3cgPSBNVUxUSVtpbnB1dHMubXVsdGlwbGllckNhcmRdO1xuICBpZiAoIW11bHRpUm93KSB0aHJvdyBuZXcgRXJyb3IoYHVucmVhY2hhYmxlOiBiYWQgbXVsdGkgY2FyZCAke2lucHV0cy5tdWx0aXBsaWVyQ2FyZH1gKTtcbiAgY29uc3QgbXVsdGlwbGllciA9IG11bHRpUm93W3F1YWxpdHkgLSAxXTtcbiAgaWYgKG11bHRpcGxpZXIgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKGB1bnJlYWNoYWJsZTogYmFkIHF1YWxpdHkgJHtxdWFsaXR5fWApO1xuXG4gIGNvbnN0IGJvbnVzID0gaW5wdXRzLmJvbnVzID8/IDA7XG4gIGNvbnN0IHlhcmRzR2FpbmVkID0gTWF0aC5yb3VuZChtdWx0aXBsaWVyICogaW5wdXRzLnlhcmRzQ2FyZCkgKyBib251cztcblxuICByZXR1cm4ge1xuICAgIG1hdGNodXBRdWFsaXR5OiBxdWFsaXR5LFxuICAgIG11bHRpcGxpZXIsXG4gICAgbXVsdGlwbGllckNhcmROYW1lOiBNVUxUSVBMSUVSX0NBUkRfTkFNRVNbaW5wdXRzLm11bHRpcGxpZXJDYXJkXSxcbiAgICB5YXJkc0dhaW5lZCxcbiAgfTtcbn1cbiIsICIvKipcbiAqIENhcmQtZGVjayBkcmF3cyBcdTIwMTQgcHVyZSB2ZXJzaW9ucyBvZiB2NS4xJ3MgYEdhbWUuZGVjTXVsdHNgIGFuZCBgR2FtZS5kZWNZYXJkc2AuXG4gKlxuICogVGhlIGRlY2sgaXMgcmVwcmVzZW50ZWQgYXMgYW4gYXJyYXkgb2YgcmVtYWluaW5nIGNvdW50cyBwZXIgY2FyZCBzbG90LlxuICogVG8gZHJhdywgd2UgcGljayBhIHVuaWZvcm0gcmFuZG9tIHNsb3Q7IGlmIHRoYXQgc2xvdCBpcyBlbXB0eSwgd2UgcmV0cnkuXG4gKiBUaGlzIGlzIG1hdGhlbWF0aWNhbGx5IGVxdWl2YWxlbnQgdG8gc2h1ZmZsaW5nIHRoZSByZW1haW5pbmcgY2FyZHMgYW5kXG4gKiBkcmF3aW5nIG9uZSBcdTIwMTQgYW5kIG1hdGNoZXMgdjUuMSdzIGJlaGF2aW9yIHZlcmJhdGltLlxuICpcbiAqIFdoZW4gdGhlIGRlY2sgaXMgZXhoYXVzdGVkLCB0aGUgY29uc3VtZXIgKHRoZSByZWR1Y2VyKSByZWZpbGxzIGl0IGFuZFxuICogZW1pdHMgYSBERUNLX1NIVUZGTEVEIGV2ZW50LlxuICovXG5cbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBEZWNrU3RhdGUgfSBmcm9tIFwiLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7XG4gIGZyZXNoRGVja011bHRpcGxpZXJzLFxuICBmcmVzaERlY2tZYXJkcyxcbn0gZnJvbSBcIi4uL3N0YXRlLmpzXCI7XG5pbXBvcnQge1xuICBNVUxUSVBMSUVSX0NBUkRfTkFNRVMsXG4gIHR5cGUgTXVsdGlwbGllckNhcmRJbmRleCxcbiAgdHlwZSBNdWx0aXBsaWVyQ2FyZE5hbWUsXG59IGZyb20gXCIuL3lhcmRhZ2UuanNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBNdWx0aXBsaWVyRHJhdyB7XG4gIGNhcmQ6IE11bHRpcGxpZXJDYXJkTmFtZTtcbiAgaW5kZXg6IE11bHRpcGxpZXJDYXJkSW5kZXg7XG4gIGRlY2s6IERlY2tTdGF0ZTtcbiAgcmVzaHVmZmxlZDogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRyYXdNdWx0aXBsaWVyKGRlY2s6IERlY2tTdGF0ZSwgcm5nOiBSbmcpOiBNdWx0aXBsaWVyRHJhdyB7XG4gIGNvbnN0IG11bHRzID0gWy4uLmRlY2subXVsdGlwbGllcnNdIGFzIFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdO1xuXG4gIGxldCBpbmRleDogTXVsdGlwbGllckNhcmRJbmRleDtcbiAgLy8gUmVqZWN0aW9uLXNhbXBsZSB0byBkcmF3IHVuaWZvcm1seSBhY3Jvc3MgcmVtYWluaW5nIGNhcmRzLlxuICAvLyBMb29wIGlzIGJvdW5kZWQgXHUyMDE0IHRvdGFsIGNhcmRzIGluIGZyZXNoIGRlY2sgaXMgMTUuXG4gIGZvciAoOzspIHtcbiAgICBjb25zdCBpID0gcm5nLmludEJldHdlZW4oMCwgMykgYXMgTXVsdGlwbGllckNhcmRJbmRleDtcbiAgICBpZiAobXVsdHNbaV0gPiAwKSB7XG4gICAgICBpbmRleCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICBtdWx0c1tpbmRleF0tLTtcblxuICBsZXQgcmVzaHVmZmxlZCA9IGZhbHNlO1xuICBsZXQgbmV4dERlY2s6IERlY2tTdGF0ZSA9IHsgLi4uZGVjaywgbXVsdGlwbGllcnM6IG11bHRzIH07XG4gIGlmIChtdWx0cy5ldmVyeSgoYykgPT4gYyA9PT0gMCkpIHtcbiAgICByZXNodWZmbGVkID0gdHJ1ZTtcbiAgICBuZXh0RGVjayA9IHsgLi4ubmV4dERlY2ssIG11bHRpcGxpZXJzOiBmcmVzaERlY2tNdWx0aXBsaWVycygpIH07XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGNhcmQ6IE1VTFRJUExJRVJfQ0FSRF9OQU1FU1tpbmRleF0sXG4gICAgaW5kZXgsXG4gICAgZGVjazogbmV4dERlY2ssXG4gICAgcmVzaHVmZmxlZCxcbiAgfTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBZYXJkc0RyYXcge1xuICAvKiogWWFyZHMgY2FyZCB2YWx1ZSwgMS0xMC4gKi9cbiAgY2FyZDogbnVtYmVyO1xuICBkZWNrOiBEZWNrU3RhdGU7XG4gIHJlc2h1ZmZsZWQ6IGJvb2xlYW47XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkcmF3WWFyZHMoZGVjazogRGVja1N0YXRlLCBybmc6IFJuZyk6IFlhcmRzRHJhdyB7XG4gIGNvbnN0IHlhcmRzID0gWy4uLmRlY2sueWFyZHNdO1xuXG4gIGxldCBpbmRleDogbnVtYmVyO1xuICBmb3IgKDs7KSB7XG4gICAgY29uc3QgaSA9IHJuZy5pbnRCZXR3ZWVuKDAsIHlhcmRzLmxlbmd0aCAtIDEpO1xuICAgIGNvbnN0IHNsb3QgPSB5YXJkc1tpXTtcbiAgICBpZiAoc2xvdCAhPT0gdW5kZWZpbmVkICYmIHNsb3QgPiAwKSB7XG4gICAgICBpbmRleCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICB5YXJkc1tpbmRleF0gPSAoeWFyZHNbaW5kZXhdID8/IDApIC0gMTtcblxuICBsZXQgcmVzaHVmZmxlZCA9IGZhbHNlO1xuICBsZXQgbmV4dERlY2s6IERlY2tTdGF0ZSA9IHsgLi4uZGVjaywgeWFyZHMgfTtcbiAgaWYgKHlhcmRzLmV2ZXJ5KChjKSA9PiBjID09PSAwKSkge1xuICAgIHJlc2h1ZmZsZWQgPSB0cnVlO1xuICAgIG5leHREZWNrID0geyAuLi5uZXh0RGVjaywgeWFyZHM6IGZyZXNoRGVja1lhcmRzKCkgfTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgY2FyZDogaW5kZXggKyAxLFxuICAgIGRlY2s6IG5leHREZWNrLFxuICAgIHJlc2h1ZmZsZWQsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBSZWd1bGFyLXBsYXkgcmVzb2x1dGlvbi4gU3BlY2lhbCBwbGF5cyAoVFAsIEhNLCBGRywgUFVOVCwgVFdPX1BUKSBicmFuY2hcbiAqIGVsc2V3aGVyZSBcdTIwMTQgc2VlIHJ1bGVzL3NwZWNpYWwudHMgKFRPRE8pLlxuICpcbiAqIEdpdmVuIHR3byBwaWNrcyAob2ZmZW5zZSArIGRlZmVuc2UpIGFuZCB0aGUgY3VycmVudCBzdGF0ZSwgcHJvZHVjZSBhIG5ld1xuICogc3RhdGUgYW5kIHRoZSBldmVudCBzdHJlYW0gZm9yIHRoZSBwbGF5LlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBQbGF5Q2FsbCwgUmVndWxhclBsYXkgfSBmcm9tIFwiLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IGRyYXdNdWx0aXBsaWVyLCBkcmF3WWFyZHMgfSBmcm9tIFwiLi9kZWNrLmpzXCI7XG5pbXBvcnQgeyBjb21wdXRlWWFyZGFnZSB9IGZyb20gXCIuL3lhcmRhZ2UuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi9zdGF0ZS5qc1wiO1xuXG5jb25zdCBSRUdVTEFSOiBSZWFkb25seVNldDxQbGF5Q2FsbD4gPSBuZXcgU2V0KFtcIlNSXCIsIFwiTFJcIiwgXCJTUFwiLCBcIkxQXCJdKTtcblxuZXhwb3J0IGZ1bmN0aW9uIGlzUmVndWxhclBsYXkocDogUGxheUNhbGwpOiBwIGlzIFJlZ3VsYXJQbGF5IHtcbiAgcmV0dXJuIFJFR1VMQVIuaGFzKHApO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJlc29sdmVJbnB1dCB7XG4gIG9mZmVuc2VQbGF5OiBQbGF5Q2FsbDtcbiAgZGVmZW5zZVBsYXk6IFBsYXlDYWxsO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFBsYXlSZXNvbHV0aW9uIHtcbiAgc3RhdGU6IEdhbWVTdGF0ZTtcbiAgZXZlbnRzOiBFdmVudFtdO1xufVxuXG4vKipcbiAqIFJlc29sdmUgYSByZWd1bGFyIHZzIHJlZ3VsYXIgcGxheS4gQ2FsbGVyICh0aGUgcmVkdWNlcikgcm91dGVzIHRvIHNwZWNpYWxcbiAqIHBsYXkgaGFuZGxlcnMgaWYgZWl0aGVyIHBpY2sgaXMgbm9uLXJlZ3VsYXIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUmVndWxhclBsYXkoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIGlucHV0OiBSZXNvbHZlSW5wdXQsXG4gIHJuZzogUm5nLFxuKTogUGxheVJlc29sdXRpb24ge1xuICBpZiAoIWlzUmVndWxhclBsYXkoaW5wdXQub2ZmZW5zZVBsYXkpIHx8ICFpc1JlZ3VsYXJQbGF5KGlucHV0LmRlZmVuc2VQbGF5KSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcInJlc29sdmVSZWd1bGFyUGxheSBjYWxsZWQgd2l0aCBhIG5vbi1yZWd1bGFyIHBsYXlcIik7XG4gIH1cblxuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcblxuICAvLyBEcmF3IGNhcmRzLlxuICBjb25zdCBtdWx0RHJhdyA9IGRyYXdNdWx0aXBsaWVyKHN0YXRlLmRlY2ssIHJuZyk7XG4gIGlmIChtdWx0RHJhdy5yZXNodWZmbGVkKSB7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJtdWx0aXBsaWVyXCIgfSk7XG4gIH1cbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKG11bHREcmF3LmRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkge1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcbiAgfVxuXG4gIC8vIENvbXB1dGUgeWFyZGFnZS5cbiAgY29uc3Qgb3V0Y29tZSA9IGNvbXB1dGVZYXJkYWdlKHtcbiAgICBvZmZlbnNlOiBpbnB1dC5vZmZlbnNlUGxheSxcbiAgICBkZWZlbnNlOiBpbnB1dC5kZWZlbnNlUGxheSxcbiAgICBtdWx0aXBsaWVyQ2FyZDogbXVsdERyYXcuaW5kZXgsXG4gICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgfSk7XG5cbiAgLy8gRGVjcmVtZW50IG9mZmVuc2UncyBoYW5kIGZvciB0aGUgcGxheSB0aGV5IHVzZWQuIFJlZmlsbCBhdCB6ZXJvIFx1MjAxNCB0aGVcbiAgLy8gZXhhY3QgMTItY2FyZCByZXNodWZmbGUgYmVoYXZpb3IgbGl2ZXMgaW4gYGRlY3JlbWVudEhhbmRgLlxuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtvZmZlbnNlXTogZGVjcmVtZW50SGFuZChzdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLCBpbnB1dC5vZmZlbnNlUGxheSksXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcblxuICAvLyBBcHBseSB5YXJkYWdlIHRvIGJhbGwgcG9zaXRpb24uIENsYW1wIGF0IDEwMCAoVEQpIGFuZCAwIChzYWZldHkpLlxuICBjb25zdCBwcm9qZWN0ZWQgPSBzdGF0ZS5maWVsZC5iYWxsT24gKyBvdXRjb21lLnlhcmRzR2FpbmVkO1xuICBsZXQgbmV3QmFsbE9uID0gcHJvamVjdGVkO1xuICBsZXQgc2NvcmVkOiBcInRkXCIgfCBcInNhZmV0eVwiIHwgbnVsbCA9IG51bGw7XG4gIGlmIChwcm9qZWN0ZWQgPj0gMTAwKSB7XG4gICAgbmV3QmFsbE9uID0gMTAwO1xuICAgIHNjb3JlZCA9IFwidGRcIjtcbiAgfSBlbHNlIGlmIChwcm9qZWN0ZWQgPD0gMCkge1xuICAgIG5ld0JhbGxPbiA9IDA7XG4gICAgc2NvcmVkID0gXCJzYWZldHlcIjtcbiAgfVxuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICBvZmZlbnNlUGxheTogaW5wdXQub2ZmZW5zZVBsYXksXG4gICAgZGVmZW5zZVBsYXk6IGlucHV0LmRlZmVuc2VQbGF5LFxuICAgIG1hdGNodXBRdWFsaXR5OiBvdXRjb21lLm1hdGNodXBRdWFsaXR5LFxuICAgIG11bHRpcGxpZXI6IHsgY2FyZDogb3V0Y29tZS5tdWx0aXBsaWVyQ2FyZE5hbWUsIHZhbHVlOiBvdXRjb21lLm11bHRpcGxpZXIgfSxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgIHlhcmRzR2FpbmVkOiBvdXRjb21lLnlhcmRzR2FpbmVkLFxuICAgIG5ld0JhbGxPbixcbiAgfSk7XG5cbiAgLy8gU2NvcmUgaGFuZGxpbmcuXG4gIGlmIChzY29yZWQgPT09IFwidGRcIikge1xuICAgIHJldHVybiB0b3VjaGRvd25TdGF0ZShcbiAgICAgIHsgLi4uc3RhdGUsIGRlY2s6IHlhcmRzRHJhdy5kZWNrLCBwbGF5ZXJzOiBuZXdQbGF5ZXJzLCBwZW5kaW5nUGljazogYmxhbmtQaWNrKCkgfSxcbiAgICAgIG9mZmVuc2UsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuICBpZiAoc2NvcmVkID09PSBcInNhZmV0eVwiKSB7XG4gICAgcmV0dXJuIHNhZmV0eVN0YXRlKFxuICAgICAgeyAuLi5zdGF0ZSwgZGVjazogeWFyZHNEcmF3LmRlY2ssIHBsYXllcnM6IG5ld1BsYXllcnMsIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSB9LFxuICAgICAgb2ZmZW5zZSxcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgLy8gRG93bi9kaXN0YW5jZSBoYW5kbGluZy5cbiAgY29uc3QgcmVhY2hlZEZpcnN0RG93biA9IG5ld0JhbGxPbiA+PSBzdGF0ZS5maWVsZC5maXJzdERvd25BdDtcbiAgbGV0IG5leHREb3duID0gc3RhdGUuZmllbGQuZG93bjtcbiAgbGV0IG5leHRGaXJzdERvd25BdCA9IHN0YXRlLmZpZWxkLmZpcnN0RG93bkF0O1xuICBsZXQgcG9zc2Vzc2lvbkZsaXBwZWQgPSBmYWxzZTtcblxuICBpZiAocmVhY2hlZEZpcnN0RG93bikge1xuICAgIG5leHREb3duID0gMTtcbiAgICBuZXh0Rmlyc3REb3duQXQgPSBNYXRoLm1pbigxMDAsIG5ld0JhbGxPbiArIDEwKTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiRklSU1RfRE9XTlwiIH0pO1xuICB9IGVsc2UgaWYgKHN0YXRlLmZpZWxkLmRvd24gPT09IDQpIHtcbiAgICAvLyBUdXJub3ZlciBvbiBkb3ducyBcdTIwMTQgcG9zc2Vzc2lvbiBmbGlwcywgYmFsbCBzdGF5cy5cbiAgICBuZXh0RG93biA9IDE7XG4gICAgcG9zc2Vzc2lvbkZsaXBwZWQgPSB0cnVlO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUl9PTl9ET1dOU1wiIH0pO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiZG93bnNcIiB9KTtcbiAgfSBlbHNlIHtcbiAgICBuZXh0RG93biA9IChzdGF0ZS5maWVsZC5kb3duICsgMSkgYXMgMSB8IDIgfCAzIHwgNDtcbiAgfVxuXG4gIGNvbnN0IG5leHRPZmZlbnNlID0gcG9zc2Vzc2lvbkZsaXBwZWQgPyBvcHAob2ZmZW5zZSkgOiBvZmZlbnNlO1xuICBjb25zdCBuZXh0QmFsbE9uID0gcG9zc2Vzc2lvbkZsaXBwZWQgPyAxMDAgLSBuZXdCYWxsT24gOiBuZXdCYWxsT247XG4gIGNvbnN0IG5leHRGaXJzdERvd24gPSBwb3NzZXNzaW9uRmxpcHBlZFxuICAgID8gTWF0aC5taW4oMTAwLCBuZXh0QmFsbE9uICsgMTApXG4gICAgOiBuZXh0Rmlyc3REb3duQXQ7XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBkZWNrOiB5YXJkc0RyYXcuZGVjayxcbiAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IG5leHRCYWxsT24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBuZXh0Rmlyc3REb3duLFxuICAgICAgICBkb3duOiBuZXh0RG93bixcbiAgICAgICAgb2ZmZW5zZTogbmV4dE9mZmVuc2UsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG5mdW5jdGlvbiBibGFua1BpY2soKTogR2FtZVN0YXRlW1wicGVuZGluZ1BpY2tcIl0ge1xuICByZXR1cm4geyBvZmZlbnNlUGxheTogbnVsbCwgZGVmZW5zZVBsYXk6IG51bGwgfTtcbn1cblxuLyoqXG4gKiBUb3VjaGRvd24gYm9va2tlZXBpbmcgXHUyMDE0IDYgcG9pbnRzLCB0cmFuc2l0aW9uIHRvIFBBVF9DSE9JQ0UgcGhhc2UuXG4gKiAoUEFULzJwdCByZXNvbHV0aW9uIGFuZCBlbnN1aW5nIGtpY2tvZmYgaGFwcGVuIGluIHN1YnNlcXVlbnQgYWN0aW9ucy4pXG4gKi9cbmZ1bmN0aW9uIHRvdWNoZG93blN0YXRlKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBzY29yZXI6IEdhbWVTdGF0ZVtcImZpZWxkXCJdW1wib2ZmZW5zZVwiXSxcbiAgZXZlbnRzOiBFdmVudFtdLFxuKTogUGxheVJlc29sdXRpb24ge1xuICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgW3Njb3Jlcl06IHsgLi4uc3RhdGUucGxheWVyc1tzY29yZXJdLCBzY29yZTogc3RhdGUucGxheWVyc1tzY29yZXJdLnNjb3JlICsgNiB9LFxuICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUT1VDSERPV05cIiwgc2NvcmluZ1BsYXllcjogc2NvcmVyIH0pO1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7IC4uLnN0YXRlLCBwbGF5ZXJzOiBuZXdQbGF5ZXJzLCBwaGFzZTogXCJQQVRfQ0hPSUNFXCIgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbi8qKlxuICogU2FmZXR5IFx1MjAxNCBkZWZlbnNlIHNjb3JlcyAyLCBvZmZlbnNlIGtpY2tzIGZyZWUga2ljay5cbiAqIEZvciB0aGUgc2tldGNoIHdlIHNjb3JlIGFuZCBlbWl0OyB0aGUga2lja29mZiB0cmFuc2l0aW9uIGlzIFRPRE8uXG4gKi9cbmZ1bmN0aW9uIHNhZmV0eVN0YXRlKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBjb25jZWRlcjogR2FtZVN0YXRlW1wiZmllbGRcIl1bXCJvZmZlbnNlXCJdLFxuICBldmVudHM6IEV2ZW50W10sXG4pOiBQbGF5UmVzb2x1dGlvbiB7XG4gIGNvbnN0IHNjb3JlciA9IG9wcChjb25jZWRlcik7XG4gIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgLi4uc3RhdGUucGxheWVycyxcbiAgICBbc2NvcmVyXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0uc2NvcmUgKyAyIH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlNBRkVUWVwiLCBzY29yaW5nUGxheWVyOiBzY29yZXIgfSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHsgLi4uc3RhdGUsIHBsYXllcnM6IG5ld1BsYXllcnMsIHBoYXNlOiBcIktJQ0tPRkZcIiB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuLyoqXG4gKiBEZWNyZW1lbnQgdGhlIGNob3NlbiBwbGF5IGluIGEgcGxheWVyJ3MgaGFuZC4gSWYgdGhlIHJlZ3VsYXItcGxheSBjYXJkc1xuICogKFNSL0xSL1NQL0xQKSBhcmUgYWxsIGV4aGF1c3RlZCwgcmVmaWxsIHRoZW0gXHUyMDE0IEhhaWwgTWFyeSBjb3VudCBpc1xuICogcHJlc2VydmVkIGFjcm9zcyByZWZpbGxzIChtYXRjaGVzIHY1LjEgUGxheWVyLmZpbGxQbGF5cygncCcpKS5cbiAqL1xuZnVuY3Rpb24gZGVjcmVtZW50SGFuZChcbiAgcGxheWVyOiBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdWzFdLFxuICBwbGF5OiBQbGF5Q2FsbCxcbik6IEdhbWVTdGF0ZVtcInBsYXllcnNcIl1bMV0ge1xuICBjb25zdCBoYW5kID0geyAuLi5wbGF5ZXIuaGFuZCB9O1xuXG4gIGlmIChwbGF5ID09PSBcIkhNXCIpIHtcbiAgICBoYW5kLkhNID0gTWF0aC5tYXgoMCwgaGFuZC5ITSAtIDEpO1xuICAgIHJldHVybiB7IC4uLnBsYXllciwgaGFuZCB9O1xuICB9XG5cbiAgaWYgKHBsYXkgPT09IFwiRkdcIiB8fCBwbGF5ID09PSBcIlBVTlRcIiB8fCBwbGF5ID09PSBcIlRXT19QVFwiKSB7XG4gICAgLy8gTm8gY2FyZCBjb25zdW1lZCBcdTIwMTQgdGhlc2UgYXJlIHNpdHVhdGlvbmFsIGRlY2lzaW9ucywgbm90IGRyYXdzLlxuICAgIHJldHVybiBwbGF5ZXI7XG4gIH1cblxuICBoYW5kW3BsYXldID0gTWF0aC5tYXgoMCwgaGFuZFtwbGF5XSAtIDEpO1xuXG4gIGNvbnN0IHJlZ3VsYXJFeGhhdXN0ZWQgPVxuICAgIGhhbmQuU1IgPT09IDAgJiYgaGFuZC5MUiA9PT0gMCAmJiBoYW5kLlNQID09PSAwICYmIGhhbmQuTFAgPT09IDAgJiYgaGFuZC5UUCA9PT0gMDtcblxuICBpZiAocmVndWxhckV4aGF1c3RlZCkge1xuICAgIHJldHVybiB7XG4gICAgICAuLi5wbGF5ZXIsXG4gICAgICBoYW5kOiB7IFNSOiAzLCBMUjogMywgU1A6IDMsIExQOiAzLCBUUDogMSwgSE06IGhhbmQuSE0gfSxcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIHsgLi4ucGxheWVyLCBoYW5kIH07XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgcHJpbWl0aXZlcyB1c2VkIGJ5IG11bHRpcGxlIHNwZWNpYWwtcGxheSByZXNvbHZlcnMuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBQbGF5ZXJJZCB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4uLy4uL3N0YXRlLmpzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3BlY2lhbFJlc29sdXRpb24ge1xuICBzdGF0ZTogR2FtZVN0YXRlO1xuICBldmVudHM6IEV2ZW50W107XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBibGFua1BpY2soKTogR2FtZVN0YXRlW1wicGVuZGluZ1BpY2tcIl0ge1xuICByZXR1cm4geyBvZmZlbnNlUGxheTogbnVsbCwgZGVmZW5zZVBsYXk6IG51bGwgfTtcbn1cblxuLyoqXG4gKiBBd2FyZCBwb2ludHMsIGZsaXAgdG8gUEFUX0NIT0lDRS4gQ2FsbGVyIGVtaXRzIFRPVUNIRE9XTi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5VG91Y2hkb3duKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBzY29yZXI6IFBsYXllcklkLFxuICBldmVudHM6IEV2ZW50W10sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgLi4uc3RhdGUucGxheWVycyxcbiAgICBbc2NvcmVyXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0uc2NvcmUgKyA2IH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRPVUNIRE9XTlwiLCBzY29yaW5nUGxheWVyOiBzY29yZXIgfSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIHBoYXNlOiBcIlBBVF9DSE9JQ0VcIixcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5U2FmZXR5KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBjb25jZWRlcjogUGxheWVySWQsXG4gIGV2ZW50czogRXZlbnRbXSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgc2NvcmVyID0gb3BwKGNvbmNlZGVyKTtcbiAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtzY29yZXJdOiB7IC4uLnN0YXRlLnBsYXllcnNbc2NvcmVyXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbc2NvcmVyXS5zY29yZSArIDIgfSxcbiAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiU0FGRVRZXCIsIHNjb3JpbmdQbGF5ZXI6IHNjb3JlciB9KTtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgICAgaXNTYWZldHlLaWNrOiB0cnVlLFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG4vKipcbiAqIEFwcGx5IGEgeWFyZGFnZSBvdXRjb21lIHdpdGggZnVsbCBkb3duL3R1cm5vdmVyL3Njb3JlIGJvb2trZWVwaW5nLlxuICogVXNlZCBieSBzcGVjaWFscyB0aGF0IHByb2R1Y2UgeWFyZGFnZSBkaXJlY3RseSAoSGFpbCBNYXJ5LCBCaWcgUGxheSByZXR1cm4pLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlZYXJkYWdlT3V0Y29tZShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgeWFyZHM6IG51bWJlcixcbiAgZXZlbnRzOiBFdmVudFtdLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgcHJvamVjdGVkID0gc3RhdGUuZmllbGQuYmFsbE9uICsgeWFyZHM7XG5cbiAgaWYgKHByb2plY3RlZCA+PSAxMDApIHJldHVybiBhcHBseVRvdWNoZG93bihzdGF0ZSwgb2ZmZW5zZSwgZXZlbnRzKTtcbiAgaWYgKHByb2plY3RlZCA8PSAwKSByZXR1cm4gYXBwbHlTYWZldHkoc3RhdGUsIG9mZmVuc2UsIGV2ZW50cyk7XG5cbiAgY29uc3QgcmVhY2hlZEZpcnN0RG93biA9IHByb2plY3RlZCA+PSBzdGF0ZS5maWVsZC5maXJzdERvd25BdDtcbiAgbGV0IG5leHREb3duID0gc3RhdGUuZmllbGQuZG93bjtcbiAgbGV0IG5leHRGaXJzdERvd25BdCA9IHN0YXRlLmZpZWxkLmZpcnN0RG93bkF0O1xuICBsZXQgcG9zc2Vzc2lvbkZsaXBwZWQgPSBmYWxzZTtcblxuICBpZiAocmVhY2hlZEZpcnN0RG93bikge1xuICAgIG5leHREb3duID0gMTtcbiAgICBuZXh0Rmlyc3REb3duQXQgPSBNYXRoLm1pbigxMDAsIHByb2plY3RlZCArIDEwKTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiRklSU1RfRE9XTlwiIH0pO1xuICB9IGVsc2UgaWYgKHN0YXRlLmZpZWxkLmRvd24gPT09IDQpIHtcbiAgICBwb3NzZXNzaW9uRmxpcHBlZCA9IHRydWU7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSX09OX0RPV05TXCIgfSk7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJkb3duc1wiIH0pO1xuICB9IGVsc2Uge1xuICAgIG5leHREb3duID0gKHN0YXRlLmZpZWxkLmRvd24gKyAxKSBhcyAxIHwgMiB8IDMgfCA0O1xuICB9XG5cbiAgY29uc3QgbWlycm9yZWRCYWxsT24gPSBwb3NzZXNzaW9uRmxpcHBlZCA/IDEwMCAtIHByb2plY3RlZCA6IHByb2plY3RlZDtcblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogbWlycm9yZWRCYWxsT24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBwb3NzZXNzaW9uRmxpcHBlZFxuICAgICAgICAgID8gTWF0aC5taW4oMTAwLCBtaXJyb3JlZEJhbGxPbiArIDEwKVxuICAgICAgICAgIDogbmV4dEZpcnN0RG93bkF0LFxuICAgICAgICBkb3duOiBwb3NzZXNzaW9uRmxpcHBlZCA/IDEgOiBuZXh0RG93bixcbiAgICAgICAgb2ZmZW5zZTogcG9zc2Vzc2lvbkZsaXBwZWQgPyBvcHAob2ZmZW5zZSkgOiBvZmZlbnNlLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cbiIsICIvKipcbiAqIEJpZyBQbGF5IHJlc29sdXRpb24gKHJ1bi5qczoxOTMzKS5cbiAqXG4gKiBUcmlnZ2VyZWQgYnk6XG4gKiAgIC0gVHJpY2sgUGxheSBkaWU9NVxuICogICAtIFNhbWUgUGxheSBLaW5nIG91dGNvbWVcbiAqICAgLSBPdGhlciBmdXR1cmUgaG9va3NcbiAqXG4gKiBUaGUgYmVuZWZpY2lhcnkgYXJndW1lbnQgc2F5cyB3aG8gYmVuZWZpdHMgXHUyMDE0IHRoaXMgY2FuIGJlIG9mZmVuc2UgT1JcbiAqIGRlZmVuc2UgKGRpZmZlcmVudCBvdXRjb21lIHRhYmxlcykuXG4gKlxuICogT2ZmZW5zaXZlIEJpZyBQbGF5IChvZmZlbnNlIGJlbmVmaXRzKTpcbiAqICAgZGllIDEtMyBcdTIxOTIgKzI1IHlhcmRzXG4gKiAgIGRpZSA0LTUgXHUyMTkyIG1heChoYWxmLXRvLWdvYWwsIDQwKSB5YXJkc1xuICogICBkaWUgNiAgIFx1MjE5MiBUb3VjaGRvd25cbiAqXG4gKiBEZWZlbnNpdmUgQmlnIFBsYXkgKGRlZmVuc2UgYmVuZWZpdHMpOlxuICogICBkaWUgMS0zIFx1MjE5MiAxMC15YXJkIHBlbmFsdHkgb24gb2ZmZW5zZSAocmVwZWF0IGRvd24pLCBoYWxmLXRvLWdvYWwgaWYgdGlnaHRcbiAqICAgZGllIDQtNSBcdTIxOTIgRlVNQkxFIFx1MjE5MiB0dXJub3ZlciArIGRlZmVuc2UgcmV0dXJucyBtYXgoaGFsZiwgMjUpXG4gKiAgIGRpZSA2ICAgXHUyMTkyIEZVTUJMRSBcdTIxOTIgZGVmZW5zaXZlIFREXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIFBsYXllcklkIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7XG4gIGFwcGx5U2FmZXR5LFxuICBhcHBseVRvdWNoZG93bixcbiAgYmxhbmtQaWNrLFxuICB0eXBlIFNwZWNpYWxSZXNvbHV0aW9uLFxufSBmcm9tIFwiLi9zaGFyZWQuanNcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVCaWdQbGF5KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBiZW5lZmljaWFyeTogUGxheWVySWQsXG4gIHJuZzogUm5nLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgZGllID0gcm5nLmQ2KCk7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFt7IHR5cGU6IFwiQklHX1BMQVlcIiwgYmVuZWZpY2lhcnksIHN1YnJvbGw6IGRpZSB9XTtcblxuICBpZiAoYmVuZWZpY2lhcnkgPT09IG9mZmVuc2UpIHtcbiAgICByZXR1cm4gb2ZmZW5zaXZlQmlnUGxheShzdGF0ZSwgb2ZmZW5zZSwgZGllLCBldmVudHMpO1xuICB9XG4gIHJldHVybiBkZWZlbnNpdmVCaWdQbGF5KHN0YXRlLCBvZmZlbnNlLCBkaWUsIGV2ZW50cyk7XG59XG5cbmZ1bmN0aW9uIG9mZmVuc2l2ZUJpZ1BsYXkoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIG9mZmVuc2U6IFBsYXllcklkLFxuICBkaWU6IDEgfCAyIHwgMyB8IDQgfCA1IHwgNixcbiAgZXZlbnRzOiBFdmVudFtdLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBpZiAoZGllID09PSA2KSB7XG4gICAgcmV0dXJuIGFwcGx5VG91Y2hkb3duKHN0YXRlLCBvZmZlbnNlLCBldmVudHMpO1xuICB9XG5cbiAgLy8gZGllIDEtMzogKzI1OyBkaWUgNC01OiBtYXgoaGFsZi10by1nb2FsLCA0MClcbiAgbGV0IGdhaW46IG51bWJlcjtcbiAgaWYgKGRpZSA8PSAzKSB7XG4gICAgZ2FpbiA9IDI1O1xuICB9IGVsc2Uge1xuICAgIGNvbnN0IGhhbGZUb0dvYWwgPSBNYXRoLnJvdW5kKCgxMDAgLSBzdGF0ZS5maWVsZC5iYWxsT24pIC8gMik7XG4gICAgZ2FpbiA9IGhhbGZUb0dvYWwgPiA0MCA/IGhhbGZUb0dvYWwgOiA0MDtcbiAgfVxuXG4gIGNvbnN0IHByb2plY3RlZCA9IHN0YXRlLmZpZWxkLmJhbGxPbiArIGdhaW47XG4gIGlmIChwcm9qZWN0ZWQgPj0gMTAwKSB7XG4gICAgcmV0dXJuIGFwcGx5VG91Y2hkb3duKHN0YXRlLCBvZmZlbnNlLCBldmVudHMpO1xuICB9XG5cbiAgLy8gQXBwbHkgZ2FpbiwgY2hlY2sgZm9yIGZpcnN0IGRvd24uXG4gIGNvbnN0IHJlYWNoZWRGaXJzdERvd24gPSBwcm9qZWN0ZWQgPj0gc3RhdGUuZmllbGQuZmlyc3REb3duQXQ7XG4gIGNvbnN0IG5leHREb3duID0gcmVhY2hlZEZpcnN0RG93biA/IDEgOiBzdGF0ZS5maWVsZC5kb3duO1xuICBjb25zdCBuZXh0Rmlyc3REb3duQXQgPSByZWFjaGVkRmlyc3REb3duXG4gICAgPyBNYXRoLm1pbigxMDAsIHByb2plY3RlZCArIDEwKVxuICAgIDogc3RhdGUuZmllbGQuZmlyc3REb3duQXQ7XG5cbiAgaWYgKHJlYWNoZWRGaXJzdERvd24pIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJGSVJTVF9ET1dOXCIgfSk7XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICAuLi5zdGF0ZS5maWVsZCxcbiAgICAgICAgYmFsbE9uOiBwcm9qZWN0ZWQsXG4gICAgICAgIGRvd246IG5leHREb3duLFxuICAgICAgICBmaXJzdERvd25BdDogbmV4dEZpcnN0RG93bkF0LFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gZGVmZW5zaXZlQmlnUGxheShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgb2ZmZW5zZTogUGxheWVySWQsXG4gIGRpZTogMSB8IDIgfCAzIHwgNCB8IDUgfCA2LFxuICBldmVudHM6IEV2ZW50W10sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIC8vIDEtMzogMTAteWFyZCBwZW5hbHR5LCByZXBlYXQgZG93biAobm8gZG93biBjb25zdW1lZCkuXG4gIGlmIChkaWUgPD0gMykge1xuICAgIGNvbnN0IG5haXZlUGVuYWx0eSA9IC0xMDtcbiAgICBjb25zdCBoYWxmVG9Hb2FsID0gLU1hdGguZmxvb3Ioc3RhdGUuZmllbGQuYmFsbE9uIC8gMik7XG4gICAgY29uc3QgcGVuYWx0eVlhcmRzID1cbiAgICAgIHN0YXRlLmZpZWxkLmJhbGxPbiAtIDEwIDwgMSA/IGhhbGZUb0dvYWwgOiBuYWl2ZVBlbmFsdHk7XG5cbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiUEVOQUxUWVwiLCBhZ2FpbnN0OiBvZmZlbnNlLCB5YXJkczogcGVuYWx0eVlhcmRzLCBsb3NzT2ZEb3duOiBmYWxzZSB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICAuLi5zdGF0ZS5maWVsZCxcbiAgICAgICAgICBiYWxsT246IE1hdGgubWF4KDAsIHN0YXRlLmZpZWxkLmJhbGxPbiArIHBlbmFsdHlZYXJkcyksXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyA0LTU6IHR1cm5vdmVyIHdpdGggcmV0dXJuIG9mIG1heChoYWxmLCAyNSkuIDY6IGRlZmVuc2l2ZSBURC5cbiAgY29uc3QgZGVmZW5kZXIgPSBvcHAob2ZmZW5zZSk7XG5cbiAgaWYgKGRpZSA9PT0gNikge1xuICAgIC8vIERlZmVuc2Ugc2NvcmVzIHRoZSBURC5cbiAgICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgIFtkZWZlbmRlcl06IHsgLi4uc3RhdGUucGxheWVyc1tkZWZlbmRlcl0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW2RlZmVuZGVyXS5zY29yZSArIDYgfSxcbiAgICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJmdW1ibGVcIiB9KTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVE9VQ0hET1dOXCIsIHNjb3JpbmdQbGF5ZXI6IGRlZmVuZGVyIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBwaGFzZTogXCJQQVRfQ0hPSUNFXCIsXG4gICAgICAgIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiBkZWZlbmRlciB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gZGllIDQtNTogdHVybm92ZXIgd2l0aCByZXR1cm4uXG4gIGNvbnN0IGhhbGZUb0dvYWwgPSBNYXRoLnJvdW5kKCgxMDAgLSBzdGF0ZS5maWVsZC5iYWxsT24pIC8gMik7XG4gIGNvbnN0IHJldHVybllhcmRzID0gaGFsZlRvR29hbCA+IDI1ID8gaGFsZlRvR29hbCA6IDI1O1xuXG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiZnVtYmxlXCIgfSk7XG5cbiAgLy8gRGVmZW5zZSBiZWNvbWVzIG5ldyBvZmZlbnNlLiBCYWxsIHBvc2l0aW9uOiBvZmZlbnNlIGdhaW5lZCByZXR1cm5ZYXJkcyxcbiAgLy8gdGhlbiBmbGlwIHBlcnNwZWN0aXZlLlxuICBjb25zdCBwcm9qZWN0ZWQgPSBzdGF0ZS5maWVsZC5iYWxsT24gKyByZXR1cm5ZYXJkcztcbiAgaWYgKHByb2plY3RlZCA+PSAxMDApIHtcbiAgICAvLyBSZXR1cm5lZCBhbGwgdGhlIHdheSBcdTIwMTQgVEQgZm9yIGRlZmVuZGVyLlxuICAgIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgW2RlZmVuZGVyXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW2RlZmVuZGVyXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbZGVmZW5kZXJdLnNjb3JlICsgNiB9LFxuICAgIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVE9VQ0hET1dOXCIsIHNjb3JpbmdQbGF5ZXI6IGRlZmVuZGVyIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBwaGFzZTogXCJQQVRfQ0hPSUNFXCIsXG4gICAgICAgIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiBkZWZlbmRlciB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG4gIGlmIChwcm9qZWN0ZWQgPD0gMCkge1xuICAgIHJldHVybiBhcHBseVNhZmV0eShzdGF0ZSwgb2ZmZW5zZSwgZXZlbnRzKTtcbiAgfVxuXG4gIC8vIEZsaXAgcG9zc2Vzc2lvbiwgbWlycm9yIGJhbGwgcG9zaXRpb24uXG4gIGNvbnN0IG1pcnJvcmVkQmFsbE9uID0gMTAwIC0gcHJvamVjdGVkO1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogbWlycm9yZWRCYWxsT24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIG1pcnJvcmVkQmFsbE9uICsgMTApLFxuICAgICAgICBkb3duOiAxLFxuICAgICAgICBvZmZlbnNlOiBkZWZlbmRlcixcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBQdW50IChydW4uanM6MjA5MCkuIEFsc28gc2VydmVzIGZvciBzYWZldHkga2lja3MuXG4gKlxuICogU2VxdWVuY2UgKGFsbCByYW5kb21uZXNzIHRocm91Z2ggcm5nKTpcbiAqICAgMS4gQmxvY2sgY2hlY2s6IGlmIGluaXRpYWwgZDYgaXMgNiwgcm9sbCBhZ2FpbiBcdTIwMTQgMi1zaXhlcyA9IGJsb2NrZWQgKDEvMzYpLlxuICogICAyLiBJZiBub3QgYmxvY2tlZCwgZHJhdyB5YXJkcyBjYXJkICsgY29pbiBmbGlwOlxuICogICAgICAgIGtpY2tEaXN0ID0gMTAgKiB5YXJkc0NhcmQgLyAyICsgMjAgKiAoY29pbj1oZWFkcyA/IDEgOiAwKVxuICogICAgICBSZXN1bHRpbmcgcmFuZ2U6IFs1LCA3MF0geWFyZHMuXG4gKiAgIDMuIElmIGJhbGwgbGFuZHMgcGFzdCAxMDAgXHUyMTkyIHRvdWNoYmFjaywgcGxhY2UgYXQgcmVjZWl2ZXIncyAyMC5cbiAqICAgNC4gTXVmZiBjaGVjayAobm90IG9uIHRvdWNoYmFjay9ibG9jay9zYWZldHkga2ljayk6IDItc2l4ZXMgPSByZWNlaXZlclxuICogICAgICBtdWZmcywga2lja2luZyB0ZWFtIHJlY292ZXJzLlxuICogICA1LiBSZXR1cm46IGlmIHBvc3Nlc3Npb24sIGRyYXcgbXVsdENhcmQgKyB5YXJkcy5cbiAqICAgICAgICBLaW5nPTd4LCBRdWVlbj00eCwgSmFjaz0xeCwgMTA9LTAuNXhcbiAqICAgICAgICByZXR1cm4gPSByb3VuZChtdWx0ICogeWFyZHNDYXJkKVxuICogICAgICBSZXR1cm4gY2FuIHNjb3JlIFREIG9yIGNvbmNlZGUgc2FmZXR5LlxuICpcbiAqIEZvciB0aGUgZW5naW5lIHBvcnQ6IHRoaXMgaXMgdGhlIG1vc3QgcHJvY2VkdXJhbCBvZiB0aGUgc3BlY2lhbHMuIFdlXG4gKiBjb2xsZWN0IGV2ZW50cyBpbiBvcmRlciBhbmQgcHJvZHVjZSBvbmUgZmluYWwgc3RhdGUuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi8uLi9zdGF0ZS5qc1wiO1xuaW1wb3J0IHsgZHJhd011bHRpcGxpZXIsIGRyYXdZYXJkcyB9IGZyb20gXCIuLi9kZWNrLmpzXCI7XG5pbXBvcnQge1xuICBhcHBseVNhZmV0eSxcbiAgYXBwbHlUb3VjaGRvd24sXG4gIGJsYW5rUGljayxcbiAgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbixcbn0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmNvbnN0IFJFVFVSTl9NVUxUSVBMSUVSUzogUmVjb3JkPFwiS2luZ1wiIHwgXCJRdWVlblwiIHwgXCJKYWNrXCIgfCBcIjEwXCIsIG51bWJlcj4gPSB7XG4gIEtpbmc6IDcsXG4gIFF1ZWVuOiA0LFxuICBKYWNrOiAxLFxuICBcIjEwXCI6IC0wLjUsXG59O1xuXG5leHBvcnQgaW50ZXJmYWNlIFB1bnRPcHRpb25zIHtcbiAgLyoqIHRydWUgaWYgdGhpcyBpcyBhIHNhZmV0eSBraWNrIChubyBibG9jay9tdWZmIGNoZWNrcykuICovXG4gIHNhZmV0eUtpY2s/OiBib29sZWFuO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVB1bnQoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHJuZzogUm5nLFxuICBvcHRzOiBQdW50T3B0aW9ucyA9IHt9LFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgZGVmZW5kZXIgPSBvcHAob2ZmZW5zZSk7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuICBsZXQgZGVjayA9IHN0YXRlLmRlY2s7XG5cbiAgLy8gQmxvY2sgY2hlY2sgKG5vdCBvbiBzYWZldHkga2ljaykuXG4gIGxldCBibG9ja2VkID0gZmFsc2U7XG4gIGlmICghb3B0cy5zYWZldHlLaWNrKSB7XG4gICAgaWYgKHJuZy5kNigpID09PSA2ICYmIHJuZy5kNigpID09PSA2KSB7XG4gICAgICBibG9ja2VkID0gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICBpZiAoYmxvY2tlZCkge1xuICAgIC8vIEtpY2tpbmcgdGVhbSBsb3NlcyBwb3NzZXNzaW9uIGF0IHRoZSBsaW5lIG9mIHNjcmltbWFnZS5cbiAgICBjb25zdCBtaXJyb3JlZEJhbGxPbiA9IDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbjtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiUFVOVFwiLCBwbGF5ZXI6IG9mZmVuc2UsIGxhbmRpbmdTcG90OiBzdGF0ZS5maWVsZC5iYWxsT24gfSk7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJmdW1ibGVcIiB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICBiYWxsT246IG1pcnJvcmVkQmFsbE9uLFxuICAgICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIG1pcnJvcmVkQmFsbE9uICsgMTApLFxuICAgICAgICAgIGRvd246IDEsXG4gICAgICAgICAgb2ZmZW5zZTogZGVmZW5kZXIsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBEcmF3IHlhcmRzICsgY29pbiBmb3Iga2ljayBkaXN0YW5jZS5cbiAgY29uc3QgY29pbiA9IHJuZy5jb2luRmxpcCgpO1xuICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMoZGVjaywgcm5nKTtcbiAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG4gIGRlY2sgPSB5YXJkc0RyYXcuZGVjaztcblxuICBjb25zdCBraWNrRGlzdCA9ICgxMCAqIHlhcmRzRHJhdy5jYXJkKSAvIDIgKyAoY29pbiA9PT0gXCJoZWFkc1wiID8gMjAgOiAwKTtcbiAgY29uc3QgbGFuZGluZ1Nwb3QgPSBzdGF0ZS5maWVsZC5iYWxsT24gKyBraWNrRGlzdDtcbiAgY29uc3QgdG91Y2hiYWNrID0gbGFuZGluZ1Nwb3QgPiAxMDA7XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJQVU5UXCIsIHBsYXllcjogb2ZmZW5zZSwgbGFuZGluZ1Nwb3QgfSk7XG5cbiAgLy8gTXVmZiBjaGVjayAobm90IG9uIHRvdWNoYmFjaywgYmxvY2ssIHNhZmV0eSBraWNrKS5cbiAgbGV0IG11ZmZlZCA9IGZhbHNlO1xuICBpZiAoIXRvdWNoYmFjayAmJiAhb3B0cy5zYWZldHlLaWNrKSB7XG4gICAgaWYgKHJuZy5kNigpID09PSA2ICYmIHJuZy5kNigpID09PSA2KSB7XG4gICAgICBtdWZmZWQgPSB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIGlmIChtdWZmZWQpIHtcbiAgICAvLyBSZWNlaXZlciBtdWZmcywga2lja2luZyB0ZWFtIHJlY292ZXJzIHdoZXJlIHRoZSBiYWxsIGxhbmRlZC5cbiAgICAvLyBLaWNraW5nIHRlYW0gcmV0YWlucyBwb3NzZXNzaW9uIChzdGlsbCBvZmZlbnNlKS5cbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcImZ1bWJsZVwiIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgZGVjayxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIGJhbGxPbjogTWF0aC5taW4oOTksIGxhbmRpbmdTcG90KSxcbiAgICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBsYW5kaW5nU3BvdCArIDEwKSxcbiAgICAgICAgICBkb3duOiAxLFxuICAgICAgICAgIG9mZmVuc2UsIC8vIGtpY2tlciByZXRhaW5zXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBUb3VjaGJhY2s6IHJlY2VpdmVyIGdldHMgYmFsbCBhdCB0aGVpciBvd24gMjAgKD0gODAgZnJvbSB0aGVpciBwZXJzcGVjdGl2ZSxcbiAgLy8gYnV0IGJhbGwgcG9zaXRpb24gaXMgdHJhY2tlZCBmcm9tIG9mZmVuc2UgUE9WLCBzbyBmb3IgdGhlIE5FVyBvZmZlbnNlIHRoYXRcbiAgLy8gaXMgMTAwLTgwID0gMjApLlxuICBpZiAodG91Y2hiYWNrKSB7XG4gICAgY29uc3Qgc3RhdGVBZnRlcktpY2s6IEdhbWVTdGF0ZSA9IHsgLi4uc3RhdGUsIGRlY2sgfTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGVBZnRlcktpY2ssXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICBiYWxsT246IDIwLFxuICAgICAgICAgIGZpcnN0RG93bkF0OiAzMCxcbiAgICAgICAgICBkb3duOiAxLFxuICAgICAgICAgIG9mZmVuc2U6IGRlZmVuZGVyLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gTm9ybWFsIHB1bnQgcmV0dXJuOiBkcmF3IG11bHRDYXJkICsgeWFyZHMuIFJldHVybiBtZWFzdXJlZCBmcm9tIGxhbmRpbmdTcG90LlxuICBjb25zdCBtdWx0RHJhdyA9IGRyYXdNdWx0aXBsaWVyKGRlY2ssIHJuZyk7XG4gIGlmIChtdWx0RHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcIm11bHRpcGxpZXJcIiB9KTtcbiAgZGVjayA9IG11bHREcmF3LmRlY2s7XG5cbiAgY29uc3QgcmV0dXJuRHJhdyA9IGRyYXdZYXJkcyhkZWNrLCBybmcpO1xuICBpZiAocmV0dXJuRHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG4gIGRlY2sgPSByZXR1cm5EcmF3LmRlY2s7XG5cbiAgY29uc3QgbXVsdCA9IFJFVFVSTl9NVUxUSVBMSUVSU1ttdWx0RHJhdy5jYXJkXTtcbiAgY29uc3QgcmV0dXJuWWFyZHMgPSBNYXRoLnJvdW5kKG11bHQgKiByZXR1cm5EcmF3LmNhcmQpO1xuXG4gIC8vIEJhbGwgZW5kcyB1cCBhdCBsYW5kaW5nU3BvdCAtIHJldHVybllhcmRzIChmcm9tIGtpY2tpbmcgdGVhbSdzIFBPVikuXG4gIC8vIEVxdWl2YWxlbnRseSwgZnJvbSB0aGUgcmVjZWl2aW5nIHRlYW0ncyBQT1Y6ICgxMDAgLSBsYW5kaW5nU3BvdCkgKyByZXR1cm5ZYXJkcy5cbiAgY29uc3QgcmVjZWl2ZXJCYWxsT24gPSAxMDAgLSBsYW5kaW5nU3BvdCArIHJldHVybllhcmRzO1xuXG4gIGNvbnN0IHN0YXRlQWZ0ZXJSZXR1cm46IEdhbWVTdGF0ZSA9IHsgLi4uc3RhdGUsIGRlY2sgfTtcblxuICAvLyBSZXR1cm4gVEQgXHUyMDE0IHJlY2VpdmVyIHNjb3Jlcy5cbiAgaWYgKHJlY2VpdmVyQmFsbE9uID49IDEwMCkge1xuICAgIGNvbnN0IHJlY2VpdmVyQmFsbENsYW1wZWQgPSAxMDA7XG4gICAgdm9pZCByZWNlaXZlckJhbGxDbGFtcGVkO1xuICAgIHJldHVybiBhcHBseVRvdWNoZG93bihcbiAgICAgIHsgLi4uc3RhdGVBZnRlclJldHVybiwgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IGRlZmVuZGVyIH0gfSxcbiAgICAgIGRlZmVuZGVyLFxuICAgICAgZXZlbnRzLFxuICAgICk7XG4gIH1cblxuICAvLyBSZXR1cm4gc2FmZXR5IFx1MjAxNCByZWNlaXZlciB0YWNrbGVkIGluIHRoZWlyIG93biBlbmR6b25lIChjYW4ndCBhY3R1YWxseVxuICAvLyBoYXBwZW4gZnJvbSBhIG5lZ2F0aXZlLXJldHVybi15YXJkYWdlIHN0YW5kcG9pbnQgaW4gdjUuMSBzaW5jZSBzdGFydCBpc1xuICAvLyAxMDAtbGFuZGluZ1Nwb3Qgd2hpY2ggaXMgPiAwLCBidXQgbW9kZWwgaXQgYW55d2F5IGZvciBjb21wbGV0ZW5lc3MpLlxuICBpZiAocmVjZWl2ZXJCYWxsT24gPD0gMCkge1xuICAgIHJldHVybiBhcHBseVNhZmV0eShcbiAgICAgIHsgLi4uc3RhdGVBZnRlclJldHVybiwgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IGRlZmVuZGVyIH0gfSxcbiAgICAgIGRlZmVuZGVyLFxuICAgICAgZXZlbnRzLFxuICAgICk7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZUFmdGVyUmV0dXJuLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgYmFsbE9uOiByZWNlaXZlckJhbGxPbixcbiAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgcmVjZWl2ZXJCYWxsT24gKyAxMCksXG4gICAgICAgIGRvd246IDEsXG4gICAgICAgIG9mZmVuc2U6IGRlZmVuZGVyLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cbiIsICIvKipcbiAqIEtpY2tvZmYuIHY2IHJlc3RvcmVzIHY1LjEncyBraWNrLXR5cGUgLyByZXR1cm4tdHlwZSBwaWNrcy5cbiAqXG4gKiBUaGUga2lja2VyIChzdGF0ZS5maWVsZC5vZmZlbnNlKSBjaG9vc2VzIG9uZSBvZjpcbiAqICAgUksgXHUyMDE0IFJlZ3VsYXIgS2ljazogbG9uZyBraWNrLCBtdWx0K3lhcmRzIHJldHVyblxuICogICBPSyBcdTIwMTQgT25zaWRlIEtpY2s6ICBzaG9ydCBraWNrLCAxLWluLTYgcmVjb3Zlcnkgcm9sbCAoMS1pbi0xMiB2cyBPUilcbiAqICAgU0sgXHUyMDE0IFNxdWliIEtpY2s6ICAgbWVkaXVtIGtpY2ssIDJkNiByZXR1cm4gaWYgcmVjZWl2ZXIgY2hvc2UgUlJcbiAqXG4gKiBUaGUgcmV0dXJuZXIgY2hvb3NlcyBvbmUgb2Y6XG4gKiAgIFJSIFx1MjAxNCBSZWd1bGFyIFJldHVybjogbm9ybWFsIHJldHVyblxuICogICBPUiBcdTIwMTQgT25zaWRlIGNvdW50ZXI6IGRlZmVuZHMgdGhlIG9uc2lkZSAoaGFyZGVyIGZvciBraWNrZXIgdG8gcmVjb3ZlcilcbiAqICAgVEIgXHUyMDE0IFRvdWNoYmFjazogICAgICB0YWtlIHRoZSBiYWxsIGF0IHRoZSAyNVxuICpcbiAqIFNhZmV0eSBraWNrcyAoc3RhdGUuaXNTYWZldHlLaWNrPXRydWUpIHNraXAgdGhlIHBpY2tzIGFuZCB1c2UgdGhlXG4gKiBleGlzdGluZyBzaW1wbGlmaWVkIHB1bnQgcGF0aC5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgS2lja1R5cGUsIFJldHVyblR5cGUgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi8uLi9zdGF0ZS5qc1wiO1xuaW1wb3J0IHsgZHJhd011bHRpcGxpZXIsIGRyYXdZYXJkcyB9IGZyb20gXCIuLi9kZWNrLmpzXCI7XG5pbXBvcnQgeyByZXNvbHZlUHVudCB9IGZyb20gXCIuL3B1bnQuanNcIjtcbmltcG9ydCB7XG4gIGFwcGx5U2FmZXR5LFxuICBhcHBseVRvdWNoZG93bixcbiAgYmxhbmtQaWNrLFxuICB0eXBlIFNwZWNpYWxSZXNvbHV0aW9uLFxufSBmcm9tIFwiLi9zaGFyZWQuanNcIjtcblxuY29uc3QgS0lDS09GRl9NVUxUSVBMSUVSUzogUmVjb3JkPFwiS2luZ1wiIHwgXCJRdWVlblwiIHwgXCJKYWNrXCIgfCBcIjEwXCIsIG51bWJlcj4gPSB7XG4gIEtpbmc6IDEwLFxuICBRdWVlbjogNSxcbiAgSmFjazogMSxcbiAgXCIxMFwiOiAwLFxufTtcblxuZXhwb3J0IGludGVyZmFjZSBLaWNrb2ZmT3B0aW9ucyB7XG4gIGtpY2tUeXBlPzogS2lja1R5cGU7XG4gIHJldHVyblR5cGU/OiBSZXR1cm5UeXBlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUtpY2tvZmYoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHJuZzogUm5nLFxuICBvcHRzOiBLaWNrb2ZmT3B0aW9ucyA9IHt9LFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBraWNrZXIgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCByZWNlaXZlciA9IG9wcChraWNrZXIpO1xuXG4gIC8vIFNhZmV0eS1raWNrIHBhdGg6IHY1LjEgY2FydmUtb3V0IHRyZWF0cyBpdCBsaWtlIGEgcHVudCBmcm9tIHRoZSAzNS5cbiAgLy8gTm8gcGlja3MgYXJlIHByb21wdGVkIGZvciwgc28gYGtpY2tUeXBlYCB3aWxsIGJlIHVuZGVmaW5lZCBoZXJlLlxuICBpZiAoc3RhdGUuaXNTYWZldHlLaWNrIHx8ICFvcHRzLmtpY2tUeXBlKSB7XG4gICAgY29uc3Qga2lja2luZ1N0YXRlOiBHYW1lU3RhdGUgPSB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBiYWxsT246IDM1IH0sXG4gICAgfTtcbiAgICBjb25zdCByZXN1bHQgPSByZXNvbHZlUHVudChraWNraW5nU3RhdGUsIHJuZywgeyBzYWZldHlLaWNrOiB0cnVlIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZTogeyAuLi5yZXN1bHQuc3RhdGUsIHBoYXNlOiBcIlJFR19QTEFZXCIsIGlzU2FmZXR5S2ljazogZmFsc2UgfSxcbiAgICAgIGV2ZW50czogcmVzdWx0LmV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgY29uc3QgeyBraWNrVHlwZSwgcmV0dXJuVHlwZSB9ID0gb3B0cztcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJLSUNLX1RZUEVfQ0hPU0VOXCIsIHBsYXllcjoga2lja2VyLCBjaG9pY2U6IGtpY2tUeXBlIH0pO1xuICBpZiAocmV0dXJuVHlwZSkge1xuICAgIGV2ZW50cy5wdXNoKHtcbiAgICAgIHR5cGU6IFwiUkVUVVJOX1RZUEVfQ0hPU0VOXCIsXG4gICAgICBwbGF5ZXI6IHJlY2VpdmVyLFxuICAgICAgY2hvaWNlOiByZXR1cm5UeXBlLFxuICAgIH0pO1xuICB9XG5cbiAgaWYgKGtpY2tUeXBlID09PSBcIlJLXCIpIHtcbiAgICByZXR1cm4gcmVzb2x2ZVJlZ3VsYXJLaWNrKHN0YXRlLCBybmcsIGV2ZW50cywga2lja2VyLCByZWNlaXZlciwgcmV0dXJuVHlwZSk7XG4gIH1cbiAgaWYgKGtpY2tUeXBlID09PSBcIk9LXCIpIHtcbiAgICByZXR1cm4gcmVzb2x2ZU9uc2lkZUtpY2soc3RhdGUsIHJuZywgZXZlbnRzLCBraWNrZXIsIHJlY2VpdmVyLCByZXR1cm5UeXBlKTtcbiAgfVxuICByZXR1cm4gcmVzb2x2ZVNxdWliS2ljayhzdGF0ZSwgcm5nLCBldmVudHMsIGtpY2tlciwgcmVjZWl2ZXIsIHJldHVyblR5cGUpO1xufVxuXG5mdW5jdGlvbiByZXNvbHZlUmVndWxhcktpY2soXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHJuZzogUm5nLFxuICBldmVudHM6IEV2ZW50W10sXG4gIGtpY2tlcjogR2FtZVN0YXRlW1wiZmllbGRcIl1bXCJvZmZlbnNlXCJdLFxuICByZWNlaXZlcjogR2FtZVN0YXRlW1wiZmllbGRcIl1bXCJvZmZlbnNlXCJdLFxuICByZXR1cm5UeXBlOiBSZXR1cm5UeXBlIHwgdW5kZWZpbmVkLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICAvLyBSZXR1cm5lciBjaG9zZSB0b3VjaGJhY2sgKG9yIG1pc21hdGNoZWQgT1IpOiBiYWxsIGF0IHRoZSByZWNlaXZlcidzIDI1LlxuICBpZiAocmV0dXJuVHlwZSA9PT0gXCJUQlwiIHx8IHJldHVyblR5cGUgPT09IFwiT1JcIikge1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUT1VDSEJBQ0tcIiwgcmVjZWl2aW5nUGxheWVyOiByZWNlaXZlciB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBoYXNlOiBcIlJFR19QTEFZXCIsXG4gICAgICAgIGlzU2FmZXR5S2ljazogZmFsc2UsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICBiYWxsT246IDI1LFxuICAgICAgICAgIGZpcnN0RG93bkF0OiAzNSxcbiAgICAgICAgICBkb3duOiAxLFxuICAgICAgICAgIG9mZmVuc2U6IHJlY2VpdmVyLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gUksgKyBSUjoga2ljayBkaXN0YW5jZSAzNS4uNjAsIHRoZW4gbXVsdCt5YXJkcyByZXR1cm4uXG4gIGNvbnN0IGtpY2tSb2xsID0gcm5nLmQ2KCk7XG4gIGNvbnN0IGtpY2tZYXJkcyA9IDM1ICsgNSAqIChraWNrUm9sbCAtIDEpOyAvLyAzNSwgNDAsIDQ1LCA1MCwgNTUsIDYwIFx1MjAxNCAzNS4uNjBcbiAgY29uc3Qga2lja0VuZEZyb21LaWNrZXIgPSAzNSArIGtpY2tZYXJkczsgLy8gNzAuLjk1LCBib3VuZGVkIHRvIDEwMFxuICBjb25zdCBib3VuZGVkRW5kID0gTWF0aC5taW4oMTAwLCBraWNrRW5kRnJvbUtpY2tlcik7XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJLSUNLT0ZGXCIsIHJlY2VpdmluZ1BsYXllcjogcmVjZWl2ZXIsIGJhbGxPbjogYm91bmRlZEVuZCB9KTtcblxuICAvLyBSZWNlaXZlcidzIHN0YXJ0aW5nIGJhbGxPbiAocG9zc2Vzc2lvbiBmbGlwcGVkKS5cbiAgY29uc3QgcmVjZWl2ZXJTdGFydCA9IDEwMCAtIGJvdW5kZWRFbmQ7IC8vIDAuLjMwXG5cbiAgbGV0IGRlY2sgPSBzdGF0ZS5kZWNrO1xuICBjb25zdCBtdWx0RHJhdyA9IGRyYXdNdWx0aXBsaWVyKGRlY2ssIHJuZyk7XG4gIGlmIChtdWx0RHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcIm11bHRpcGxpZXJcIiB9KTtcbiAgZGVjayA9IG11bHREcmF3LmRlY2s7XG5cbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKGRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuICBkZWNrID0geWFyZHNEcmF3LmRlY2s7XG5cbiAgY29uc3QgbXVsdCA9IEtJQ0tPRkZfTVVMVElQTElFUlNbbXVsdERyYXcuY2FyZF07XG4gIGNvbnN0IHJldFlhcmRzID0gbXVsdCAqIHlhcmRzRHJhdy5jYXJkO1xuICBpZiAocmV0WWFyZHMgIT09IDApIHtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiS0lDS09GRl9SRVRVUk5cIiwgcmV0dXJuZXJQbGF5ZXI6IHJlY2VpdmVyLCB5YXJkczogcmV0WWFyZHMgfSk7XG4gIH1cblxuICBjb25zdCBmaW5hbEJhbGxPbiA9IHJlY2VpdmVyU3RhcnQgKyByZXRZYXJkcztcblxuICBpZiAoZmluYWxCYWxsT24gPj0gMTAwKSB7XG4gICAgcmV0dXJuIGFwcGx5VG91Y2hkb3duKFxuICAgICAgeyAuLi5zdGF0ZSwgZGVjaywgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IHJlY2VpdmVyIH0sIGlzU2FmZXR5S2ljazogZmFsc2UgfSxcbiAgICAgIHJlY2VpdmVyLFxuICAgICAgZXZlbnRzLFxuICAgICk7XG4gIH1cbiAgaWYgKGZpbmFsQmFsbE9uIDw9IDApIHtcbiAgICAvLyBSZXR1cm4gYmFja3dhcmQgaW50byBvd24gZW5kIHpvbmUgXHUyMDE0IHVubGlrZWx5IHdpdGggdjUuMSBtdWx0aXBsaWVycyBidXQgbW9kZWwgaXQuXG4gICAgcmV0dXJuIGFwcGx5U2FmZXR5KFxuICAgICAgeyAuLi5zdGF0ZSwgZGVjaywgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IHJlY2VpdmVyIH0sIGlzU2FmZXR5S2ljazogZmFsc2UgfSxcbiAgICAgIHJlY2VpdmVyLFxuICAgICAgZXZlbnRzLFxuICAgICk7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIGRlY2ssXG4gICAgICBwaGFzZTogXCJSRUdfUExBWVwiLFxuICAgICAgaXNTYWZldHlLaWNrOiBmYWxzZSxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogZmluYWxCYWxsT24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIGZpbmFsQmFsbE9uICsgMTApLFxuICAgICAgICBkb3duOiAxLFxuICAgICAgICBvZmZlbnNlOiByZWNlaXZlcixcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVPbnNpZGVLaWNrKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBybmc6IFJuZyxcbiAgZXZlbnRzOiBFdmVudFtdLFxuICBraWNrZXI6IEdhbWVTdGF0ZVtcImZpZWxkXCJdW1wib2ZmZW5zZVwiXSxcbiAgcmVjZWl2ZXI6IEdhbWVTdGF0ZVtcImZpZWxkXCJdW1wib2ZmZW5zZVwiXSxcbiAgcmV0dXJuVHlwZTogUmV0dXJuVHlwZSB8IHVuZGVmaW5lZCxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgLy8gUmV0dXJuZXIncyBPUiBjaG9pY2UgY29ycmVjdGx5IHJlYWRzIHRoZSBvbnNpZGUgXHUyMDE0IG1ha2VzIHJlY292ZXJ5IGhhcmRlci5cbiAgY29uc3Qgb2RkcyA9IHJldHVyblR5cGUgPT09IFwiT1JcIiA/IDEyIDogNjtcbiAgY29uc3QgdG1wID0gcm5nLmludEJldHdlZW4oMSwgb2Rkcyk7XG4gIGNvbnN0IHJlY292ZXJlZCA9IHRtcCA9PT0gMTtcbiAgY29uc3Qga2lja1lhcmRzID0gMTAgKyB0bXA7IC8vIHNob3J0IGtpY2sgMTEuLjE2IChvciAxMS4uMjIgdnMgT1IpXG4gIGNvbnN0IGtpY2tFbmQgPSAzNSArIGtpY2tZYXJkcztcblxuICBldmVudHMucHVzaCh7IHR5cGU6IFwiS0lDS09GRlwiLCByZWNlaXZpbmdQbGF5ZXI6IHJlY2VpdmVyLCBiYWxsT246IGtpY2tFbmQgfSk7XG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIk9OU0lERV9LSUNLXCIsXG4gICAgcmVjb3ZlcmVkLFxuICAgIHJlY292ZXJpbmdQbGF5ZXI6IHJlY292ZXJlZCA/IGtpY2tlciA6IHJlY2VpdmVyLFxuICB9KTtcblxuICBjb25zdCByZXR1cm5Sb2xsID0gcm5nLmQ2KCkgKyB0bXA7IC8vIHY1LjE6IHRtcCArIGQ2XG5cbiAgaWYgKHJlY292ZXJlZCkge1xuICAgIC8vIEtpY2tlciByZXRhaW5zLiB2NS4xIGZsaXBzIHJldHVybiBkaXJlY3Rpb24gXHUyMDE0IG1vZGVscyBcImtpY2tlciByZWNvdmVyc1xuICAgIC8vIHNsaWdodGx5IGJhY2sgb2YgdGhlIGtpY2sgc3BvdC5cIlxuICAgIGNvbnN0IGtpY2tlckJhbGxPbiA9IE1hdGgubWF4KDEsIGtpY2tFbmQgLSByZXR1cm5Sb2xsKTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBoYXNlOiBcIlJFR19QTEFZXCIsXG4gICAgICAgIGlzU2FmZXR5S2ljazogZmFsc2UsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICBiYWxsT246IGtpY2tlckJhbGxPbixcbiAgICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBraWNrZXJCYWxsT24gKyAxMCksXG4gICAgICAgICAgZG93bjogMSxcbiAgICAgICAgICBvZmZlbnNlOiBraWNrZXIsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBSZWNlaXZlciByZWNvdmVycyBhdCB0aGUga2ljayBzcG90LCByZXR1cm5zIGZvcndhcmQuXG4gIGNvbnN0IHJlY2VpdmVyU3RhcnQgPSAxMDAgLSBraWNrRW5kO1xuICBjb25zdCBmaW5hbEJhbGxPbiA9IHJlY2VpdmVyU3RhcnQgKyByZXR1cm5Sb2xsO1xuICBpZiAocmV0dXJuUm9sbCAhPT0gMCkge1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJLSUNLT0ZGX1JFVFVSTlwiLCByZXR1cm5lclBsYXllcjogcmVjZWl2ZXIsIHlhcmRzOiByZXR1cm5Sb2xsIH0pO1xuICB9XG5cbiAgaWYgKGZpbmFsQmFsbE9uID49IDEwMCkge1xuICAgIHJldHVybiBhcHBseVRvdWNoZG93bihcbiAgICAgIHsgLi4uc3RhdGUsIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiByZWNlaXZlciB9LCBpc1NhZmV0eUtpY2s6IGZhbHNlIH0sXG4gICAgICByZWNlaXZlcixcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwaGFzZTogXCJSRUdfUExBWVwiLFxuICAgICAgaXNTYWZldHlLaWNrOiBmYWxzZSxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogZmluYWxCYWxsT24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIGZpbmFsQmFsbE9uICsgMTApLFxuICAgICAgICBkb3duOiAxLFxuICAgICAgICBvZmZlbnNlOiByZWNlaXZlcixcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVTcXVpYktpY2soXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHJuZzogUm5nLFxuICBldmVudHM6IEV2ZW50W10sXG4gIGtpY2tlcjogR2FtZVN0YXRlW1wiZmllbGRcIl1bXCJvZmZlbnNlXCJdLFxuICByZWNlaXZlcjogR2FtZVN0YXRlW1wiZmllbGRcIl1bXCJvZmZlbnNlXCJdLFxuICByZXR1cm5UeXBlOiBSZXR1cm5UeXBlIHwgdW5kZWZpbmVkLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBraWNrUm9sbCA9IHJuZy5kNigpO1xuICBjb25zdCBraWNrWWFyZHMgPSAxNSArIDUgKiBraWNrUm9sbDsgLy8gMjAuLjQ1XG4gIGNvbnN0IGtpY2tFbmQgPSBNYXRoLm1pbigxMDAsIDM1ICsga2lja1lhcmRzKTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIktJQ0tPRkZcIiwgcmVjZWl2aW5nUGxheWVyOiByZWNlaXZlciwgYmFsbE9uOiBraWNrRW5kIH0pO1xuXG4gIC8vIE9ubHkgcmV0dXJuYWJsZSBpZiByZWNlaXZlciBjaG9zZSBSUjsgb3RoZXJ3aXNlIG5vIHJldHVybi5cbiAgY29uc3QgcmV0WWFyZHMgPSByZXR1cm5UeXBlID09PSBcIlJSXCIgPyBybmcuZDYoKSArIHJuZy5kNigpIDogMDtcbiAgaWYgKHJldFlhcmRzID4gMCkge1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJLSUNLT0ZGX1JFVFVSTlwiLCByZXR1cm5lclBsYXllcjogcmVjZWl2ZXIsIHlhcmRzOiByZXRZYXJkcyB9KTtcbiAgfVxuXG4gIGNvbnN0IHJlY2VpdmVyU3RhcnQgPSAxMDAgLSBraWNrRW5kO1xuICBjb25zdCBmaW5hbEJhbGxPbiA9IHJlY2VpdmVyU3RhcnQgKyByZXRZYXJkcztcblxuICBpZiAoZmluYWxCYWxsT24gPj0gMTAwKSB7XG4gICAgcmV0dXJuIGFwcGx5VG91Y2hkb3duKFxuICAgICAgeyAuLi5zdGF0ZSwgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IHJlY2VpdmVyIH0sIGlzU2FmZXR5S2ljazogZmFsc2UgfSxcbiAgICAgIHJlY2VpdmVyLFxuICAgICAgZXZlbnRzLFxuICAgICk7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBoYXNlOiBcIlJFR19QTEFZXCIsXG4gICAgICBpc1NhZmV0eUtpY2s6IGZhbHNlLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgYmFsbE9uOiBmaW5hbEJhbGxPbixcbiAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgZmluYWxCYWxsT24gKyAxMCksXG4gICAgICAgIGRvd246IDEsXG4gICAgICAgIG9mZmVuc2U6IHJlY2VpdmVyLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cbiIsICIvKipcbiAqIEhhaWwgTWFyeSBvdXRjb21lcyAocnVuLmpzOjIyNDIpLiBEaWUgdmFsdWUgXHUyMTkyIHJlc3VsdCwgZnJvbSBvZmZlbnNlJ3MgUE9WOlxuICogICAxIFx1MjE5MiBCSUcgU0FDSywgLTEwIHlhcmRzXG4gKiAgIDIgXHUyMTkyICsyMCB5YXJkc1xuICogICAzIFx1MjE5MiAgIDAgeWFyZHNcbiAqICAgNCBcdTIxOTIgKzQwIHlhcmRzXG4gKiAgIDUgXHUyMTkyIElOVEVSQ0VQVElPTiAodHVybm92ZXIgYXQgc3BvdClcbiAqICAgNiBcdTIxOTIgVE9VQ0hET1dOXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi8uLi9zdGF0ZS5qc1wiO1xuaW1wb3J0IHtcbiAgYXBwbHlTYWZldHksXG4gIGFwcGx5VG91Y2hkb3duLFxuICBhcHBseVlhcmRhZ2VPdXRjb21lLFxuICBibGFua1BpY2ssXG4gIHR5cGUgU3BlY2lhbFJlc29sdXRpb24sXG59IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUhhaWxNYXJ5KHN0YXRlOiBHYW1lU3RhdGUsIHJuZzogUm5nKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgZGllID0gcm5nLmQ2KCk7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFt7IHR5cGU6IFwiSEFJTF9NQVJZX1JPTExcIiwgb3V0Y29tZTogZGllIH1dO1xuXG4gIC8vIERlY3JlbWVudCBITSBjb3VudCByZWdhcmRsZXNzIG9mIG91dGNvbWUuXG4gIGNvbnN0IHVwZGF0ZWRQbGF5ZXJzID0ge1xuICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgW29mZmVuc2VdOiB7XG4gICAgICAuLi5zdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLFxuICAgICAgaGFuZDogeyAuLi5zdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLmhhbmQsIEhNOiBNYXRoLm1heCgwLCBzdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLmhhbmQuSE0gLSAxKSB9LFxuICAgIH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgY29uc3Qgc3RhdGVXaXRoSG06IEdhbWVTdGF0ZSA9IHsgLi4uc3RhdGUsIHBsYXllcnM6IHVwZGF0ZWRQbGF5ZXJzIH07XG5cbiAgLy8gSW50ZXJjZXB0aW9uIChkaWUgNSkgXHUyMDE0IHR1cm5vdmVyIGF0IHRoZSBzcG90LCBwb3NzZXNzaW9uIGZsaXBzLlxuICBpZiAoZGllID09PSA1KSB7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJpbnRlcmNlcHRpb25cIiB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGVXaXRoSG0sXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICAuLi5zdGF0ZVdpdGhIbS5maWVsZCxcbiAgICAgICAgICBvZmZlbnNlOiBvcHAob2ZmZW5zZSksXG4gICAgICAgICAgYmFsbE9uOiAxMDAgLSBzdGF0ZVdpdGhIbS5maWVsZC5iYWxsT24sXG4gICAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgMTAwIC0gc3RhdGVXaXRoSG0uZmllbGQuYmFsbE9uICsgMTApLFxuICAgICAgICAgIGRvd246IDEsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBUb3VjaGRvd24gKGRpZSA2KS5cbiAgaWYgKGRpZSA9PT0gNikge1xuICAgIHJldHVybiBhcHBseVRvdWNoZG93bihzdGF0ZVdpdGhIbSwgb2ZmZW5zZSwgZXZlbnRzKTtcbiAgfVxuXG4gIC8vIFlhcmRhZ2Ugb3V0Y29tZXMgKGRpZSAxLCAyLCAzLCA0KS5cbiAgY29uc3QgeWFyZHMgPSBkaWUgPT09IDEgPyAtMTAgOiBkaWUgPT09IDIgPyAyMCA6IGRpZSA9PT0gMyA/IDAgOiA0MDtcbiAgY29uc3QgcHJvamVjdGVkID0gc3RhdGVXaXRoSG0uZmllbGQuYmFsbE9uICsgeWFyZHM7XG5cbiAgaWYgKHByb2plY3RlZCA+PSAxMDApIHJldHVybiBhcHBseVRvdWNoZG93bihzdGF0ZVdpdGhIbSwgb2ZmZW5zZSwgZXZlbnRzKTtcbiAgaWYgKHByb2plY3RlZCA8PSAwKSByZXR1cm4gYXBwbHlTYWZldHkoc3RhdGVXaXRoSG0sIG9mZmVuc2UsIGV2ZW50cyk7XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgIG9mZmVuc2VQbGF5OiBcIkhNXCIsXG4gICAgZGVmZW5zZVBsYXk6IHN0YXRlLnBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5ID8/IFwiU1JcIixcbiAgICBtYXRjaHVwUXVhbGl0eTogMCxcbiAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IFwiMTBcIiwgdmFsdWU6IDAgfSxcbiAgICB5YXJkc0NhcmQ6IDAsXG4gICAgeWFyZHNHYWluZWQ6IHlhcmRzLFxuICAgIG5ld0JhbGxPbjogcHJvamVjdGVkLFxuICB9KTtcblxuICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShzdGF0ZVdpdGhIbSwgeWFyZHMsIGV2ZW50cyk7XG59XG4iLCAiLyoqXG4gKiBTYW1lIFBsYXkgbWVjaGFuaXNtIChydW4uanM6MTg5OSkuXG4gKlxuICogVHJpZ2dlcmVkIHdoZW4gYm90aCB0ZWFtcyBwaWNrIHRoZSBzYW1lIHJlZ3VsYXIgcGxheSBBTkQgYSBjb2luLWZsaXAgbGFuZHNcbiAqIGhlYWRzIChhbHNvIHVuY29uZGl0aW9uYWxseSB3aGVuIGJvdGggcGljayBUcmljayBQbGF5KS4gUnVucyBpdHMgb3duXG4gKiBjb2luICsgbXVsdGlwbGllci1jYXJkIGNoYWluOlxuICpcbiAqICAgbXVsdENhcmQgPSBLaW5nICBcdTIxOTIgQmlnIFBsYXkgKG9mZmVuc2UgaWYgY29pbj1oZWFkcywgZGVmZW5zZSBpZiB0YWlscylcbiAqICAgbXVsdENhcmQgPSBRdWVlbiArIGhlYWRzIFx1MjE5MiBtdWx0aXBsaWVyID0gKzMsIGRyYXcgeWFyZHMgY2FyZFxuICogICBtdWx0Q2FyZCA9IFF1ZWVuICsgdGFpbHMgXHUyMTkyIG11bHRpcGxpZXIgPSAgMCwgbm8geWFyZHMgKGRpc3QgPSAwKVxuICogICBtdWx0Q2FyZCA9IEphY2sgICsgaGVhZHMgXHUyMTkyIG11bHRpcGxpZXIgPSAgMCwgbm8geWFyZHMgKGRpc3QgPSAwKVxuICogICBtdWx0Q2FyZCA9IEphY2sgICsgdGFpbHMgXHUyMTkyIG11bHRpcGxpZXIgPSAtMywgZHJhdyB5YXJkcyBjYXJkXG4gKiAgIG11bHRDYXJkID0gMTAgICAgKyBoZWFkcyBcdTIxOTIgSU5URVJDRVBUSU9OICh0dXJub3ZlciBhdCBzcG90KVxuICogICBtdWx0Q2FyZCA9IDEwICAgICsgdGFpbHMgXHUyMTkyIDAgeWFyZHNcbiAqXG4gKiBOb3RlOiB0aGUgY29pbiBmbGlwIGluc2lkZSB0aGlzIGZ1bmN0aW9uIGlzIGEgU0VDT05EIGNvaW4gZmxpcCBcdTIwMTQgdGhlXG4gKiBtZWNoYW5pc20tdHJpZ2dlciBjb2luIGZsaXAgaXMgaGFuZGxlZCBieSB0aGUgcmVkdWNlciBiZWZvcmUgY2FsbGluZyBoZXJlLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7IGRyYXdNdWx0aXBsaWVyLCBkcmF3WWFyZHMgfSBmcm9tIFwiLi4vZGVjay5qc1wiO1xuaW1wb3J0IHsgcmVzb2x2ZUJpZ1BsYXkgfSBmcm9tIFwiLi9iaWdQbGF5LmpzXCI7XG5pbXBvcnQge1xuICBhcHBseVlhcmRhZ2VPdXRjb21lLFxuICBibGFua1BpY2ssXG4gIHR5cGUgU3BlY2lhbFJlc29sdXRpb24sXG59IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVNhbWVQbGF5KHN0YXRlOiBHYW1lU3RhdGUsIHJuZzogUm5nKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG5cbiAgY29uc3QgY29pbiA9IHJuZy5jb2luRmxpcCgpO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiU0FNRV9QTEFZX0NPSU5cIiwgb3V0Y29tZTogY29pbiB9KTtcblxuICBjb25zdCBtdWx0RHJhdyA9IGRyYXdNdWx0aXBsaWVyKHN0YXRlLmRlY2ssIHJuZyk7XG4gIGlmIChtdWx0RHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcIm11bHRpcGxpZXJcIiB9KTtcblxuICBjb25zdCBzdGF0ZUFmdGVyTXVsdDogR2FtZVN0YXRlID0geyAuLi5zdGF0ZSwgZGVjazogbXVsdERyYXcuZGVjayB9O1xuICBjb25zdCBoZWFkcyA9IGNvaW4gPT09IFwiaGVhZHNcIjtcblxuICAvLyBLaW5nIFx1MjE5MiBCaWcgUGxheSBmb3Igd2hpY2hldmVyIHNpZGUgd2lucyB0aGUgY29pbi5cbiAgaWYgKG11bHREcmF3LmNhcmQgPT09IFwiS2luZ1wiKSB7XG4gICAgY29uc3QgYmVuZWZpY2lhcnkgPSBoZWFkcyA/IG9mZmVuc2UgOiBvcHAob2ZmZW5zZSk7XG4gICAgY29uc3QgYnAgPSByZXNvbHZlQmlnUGxheShzdGF0ZUFmdGVyTXVsdCwgYmVuZWZpY2lhcnksIHJuZyk7XG4gICAgcmV0dXJuIHsgc3RhdGU6IGJwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLmJwLmV2ZW50c10gfTtcbiAgfVxuXG4gIC8vIDEwIFx1MjE5MiBpbnRlcmNlcHRpb24gKGhlYWRzKSBvciAwIHlhcmRzICh0YWlscykuXG4gIGlmIChtdWx0RHJhdy5jYXJkID09PSBcIjEwXCIpIHtcbiAgICBpZiAoaGVhZHMpIHtcbiAgICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiaW50ZXJjZXB0aW9uXCIgfSk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0ZToge1xuICAgICAgICAgIC4uLnN0YXRlQWZ0ZXJNdWx0LFxuICAgICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgICBmaWVsZDoge1xuICAgICAgICAgICAgLi4uc3RhdGVBZnRlck11bHQuZmllbGQsXG4gICAgICAgICAgICBvZmZlbnNlOiBvcHAob2ZmZW5zZSksXG4gICAgICAgICAgICBiYWxsT246IDEwMCAtIHN0YXRlQWZ0ZXJNdWx0LmZpZWxkLmJhbGxPbixcbiAgICAgICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIDEwMCAtIHN0YXRlQWZ0ZXJNdWx0LmZpZWxkLmJhbGxPbiArIDEwKSxcbiAgICAgICAgICAgIGRvd246IDEsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgZXZlbnRzLFxuICAgICAgfTtcbiAgICB9XG4gICAgLy8gMCB5YXJkcywgZG93biBjb25zdW1lZC5cbiAgICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShzdGF0ZUFmdGVyTXVsdCwgMCwgZXZlbnRzKTtcbiAgfVxuXG4gIC8vIFF1ZWVuIG9yIEphY2sgXHUyMTkyIG11bHRpcGxpZXIsIHRoZW4gZHJhdyB5YXJkcyBjYXJkLlxuICBsZXQgbXVsdGlwbGllciA9IDA7XG4gIGlmIChtdWx0RHJhdy5jYXJkID09PSBcIlF1ZWVuXCIpIG11bHRpcGxpZXIgPSBoZWFkcyA/IDMgOiAwO1xuICBpZiAobXVsdERyYXcuY2FyZCA9PT0gXCJKYWNrXCIpIG11bHRpcGxpZXIgPSBoZWFkcyA/IDAgOiAtMztcblxuICBpZiAobXVsdGlwbGllciA9PT0gMCkge1xuICAgIC8vIDAgeWFyZHMsIGRvd24gY29uc3VtZWQuXG4gICAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoc3RhdGVBZnRlck11bHQsIDAsIGV2ZW50cyk7XG4gIH1cblxuICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMoc3RhdGVBZnRlck11bHQuZGVjaywgcm5nKTtcbiAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG5cbiAgY29uc3QgeWFyZHMgPSBNYXRoLnJvdW5kKG11bHRpcGxpZXIgKiB5YXJkc0RyYXcuY2FyZCk7XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgIG9mZmVuc2VQbGF5OiBzdGF0ZS5wZW5kaW5nUGljay5vZmZlbnNlUGxheSA/PyBcIlNSXCIsXG4gICAgZGVmZW5zZVBsYXk6IHN0YXRlLnBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5ID8/IFwiU1JcIixcbiAgICBtYXRjaHVwUXVhbGl0eTogMCxcbiAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IG11bHREcmF3LmNhcmQsIHZhbHVlOiBtdWx0aXBsaWVyIH0sXG4gICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgICB5YXJkc0dhaW5lZDogeWFyZHMsXG4gICAgbmV3QmFsbE9uOiBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHN0YXRlQWZ0ZXJNdWx0LmZpZWxkLmJhbGxPbiArIHlhcmRzKSksXG4gIH0pO1xuXG4gIHJldHVybiBhcHBseVlhcmRhZ2VPdXRjb21lKFxuICAgIHsgLi4uc3RhdGVBZnRlck11bHQsIGRlY2s6IHlhcmRzRHJhdy5kZWNrIH0sXG4gICAgeWFyZHMsXG4gICAgZXZlbnRzLFxuICApO1xufVxuIiwgIi8qKlxuICogVHJpY2sgUGxheSByZXNvbHV0aW9uIChydW4uanM6MTk4NykuIE9uZSBwZXIgc2h1ZmZsZSwgY2FsbGVkIGJ5IGVpdGhlclxuICogb2ZmZW5zZSBvciBkZWZlbnNlLiBEaWUgcm9sbCBvdXRjb21lcyAoZnJvbSB0aGUgKmNhbGxlcidzKiBwZXJzcGVjdGl2ZSk6XG4gKlxuICogICAxIFx1MjE5MiBMb25nIFBhc3Mgd2l0aCArNSBib251cyAgIChtYXRjaHVwIHVzZXMgTFAgdnMgdGhlIG90aGVyIHNpZGUncyBwaWNrKVxuICogICAyIFx1MjE5MiAxNS15YXJkIHBlbmFsdHkgb24gb3Bwb3Npbmcgc2lkZSAoaGFsZi10by1nb2FsIGlmIHRpZ2h0KVxuICogICAzIFx1MjE5MiBmaXhlZCAtM3ggbXVsdGlwbGllciwgZHJhdyB5YXJkcyBjYXJkXG4gKiAgIDQgXHUyMTkyIGZpeGVkICs0eCBtdWx0aXBsaWVyLCBkcmF3IHlhcmRzIGNhcmRcbiAqICAgNSBcdTIxOTIgQmlnIFBsYXkgKGJlbmVmaWNpYXJ5ID0gY2FsbGVyKVxuICogICA2IFx1MjE5MiBMb25nIFJ1biB3aXRoICs1IGJvbnVzXG4gKlxuICogV2hlbiB0aGUgY2FsbGVyIGlzIHRoZSBkZWZlbnNlLCB0aGUgeWFyZGFnZSBzaWducyBpbnZlcnQgKGRlZmVuc2UgZ2FpbnMgPVxuICogb2ZmZW5zZSBsb3NlcyksIHRoZSBMUi9MUCBvdmVybGF5IGlzIGFwcGxpZWQgdG8gdGhlIGRlZmVuc2l2ZSBjYWxsLCBhbmRcbiAqIHRoZSBCaWcgUGxheSBiZW5lZmljaWFyeSBpcyBkZWZlbnNlLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBQbGF5ZXJJZCwgUmVndWxhclBsYXkgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IGRyYXdNdWx0aXBsaWVyLCBkcmF3WWFyZHMgfSBmcm9tIFwiLi4vZGVjay5qc1wiO1xuaW1wb3J0IHsgTVVMVEksIG1hdGNodXBRdWFsaXR5IH0gZnJvbSBcIi4uL21hdGNodXAuanNcIjtcbmltcG9ydCB7IHJlc29sdmVCaWdQbGF5IH0gZnJvbSBcIi4vYmlnUGxheS5qc1wiO1xuaW1wb3J0IHtcbiAgYXBwbHlZYXJkYWdlT3V0Y29tZSxcbiAgYmxhbmtQaWNrLFxuICB0eXBlIFNwZWNpYWxSZXNvbHV0aW9uLFxufSBmcm9tIFwiLi9zaGFyZWQuanNcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVPZmZlbnNpdmVUcmlja1BsYXkoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHJuZzogUm5nLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgZGllID0gcm5nLmQ2KCk7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFt7IHR5cGU6IFwiVFJJQ0tfUExBWV9ST0xMXCIsIG91dGNvbWU6IGRpZSB9XTtcblxuICAvLyA1IFx1MjE5MiBCaWcgUGxheSBmb3Igb2ZmZW5zZSAoY2FsbGVyKS5cbiAgaWYgKGRpZSA9PT0gNSkge1xuICAgIGNvbnN0IGJwID0gcmVzb2x2ZUJpZ1BsYXkoc3RhdGUsIG9mZmVuc2UsIHJuZyk7XG4gICAgcmV0dXJuIHsgc3RhdGU6IGJwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLmJwLmV2ZW50c10gfTtcbiAgfVxuXG4gIC8vIDIgXHUyMTkyIDE1LXlhcmQgcGVuYWx0eSBvbiBkZWZlbnNlICg9IG9mZmVuc2UgZ2FpbnMgMTUgb3IgaGFsZi10by1nb2FsKS5cbiAgaWYgKGRpZSA9PT0gMikge1xuICAgIGNvbnN0IHJhd0dhaW4gPSAxNTtcbiAgICBjb25zdCBnYWluID1cbiAgICAgIHN0YXRlLmZpZWxkLmJhbGxPbiArIHJhd0dhaW4gPiA5OVxuICAgICAgICA/IE1hdGgudHJ1bmMoKDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbikgLyAyKVxuICAgICAgICA6IHJhd0dhaW47XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlBFTkFMVFlcIiwgYWdhaW5zdDogb3Bwb25lbnQob2ZmZW5zZSksIHlhcmRzOiBnYWluLCBsb3NzT2ZEb3duOiBmYWxzZSB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICAuLi5zdGF0ZS5maWVsZCxcbiAgICAgICAgICBiYWxsT246IE1hdGgubWluKDEwMCwgc3RhdGUuZmllbGQuYmFsbE9uICsgZ2FpbiksXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyAzIG9yIDQgXHUyMTkyIGZpeGVkIG11bHRpcGxpZXIsIGRyYXcgeWFyZHMgY2FyZC5cbiAgaWYgKGRpZSA9PT0gMyB8fCBkaWUgPT09IDQpIHtcbiAgICBjb25zdCBtdWx0aXBsaWVyID0gZGllID09PSAzID8gLTMgOiA0O1xuICAgIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhzdGF0ZS5kZWNrLCBybmcpO1xuICAgIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuICAgIGNvbnN0IHlhcmRzID0gTWF0aC5yb3VuZChtdWx0aXBsaWVyICogeWFyZHNEcmF3LmNhcmQpO1xuXG4gICAgZXZlbnRzLnB1c2goe1xuICAgICAgdHlwZTogXCJQTEFZX1JFU09MVkVEXCIsXG4gICAgICBvZmZlbnNlUGxheTogXCJUUFwiLFxuICAgICAgZGVmZW5zZVBsYXk6IHN0YXRlLnBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5ID8/IFwiU1JcIixcbiAgICAgIG1hdGNodXBRdWFsaXR5OiAwLFxuICAgICAgbXVsdGlwbGllcjogeyBjYXJkOiBcIktpbmdcIiwgdmFsdWU6IG11bHRpcGxpZXIgfSxcbiAgICAgIHlhcmRzQ2FyZDogeWFyZHNEcmF3LmNhcmQsXG4gICAgICB5YXJkc0dhaW5lZDogeWFyZHMsXG4gICAgICBuZXdCYWxsT246IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgc3RhdGUuZmllbGQuYmFsbE9uICsgeWFyZHMpKSxcbiAgICB9KTtcblxuICAgIHJldHVybiBhcHBseVlhcmRhZ2VPdXRjb21lKFxuICAgICAgeyAuLi5zdGF0ZSwgZGVjazogeWFyZHNEcmF3LmRlY2sgfSxcbiAgICAgIHlhcmRzLFxuICAgICAgZXZlbnRzLFxuICAgICk7XG4gIH1cblxuICAvLyAxIG9yIDYgXHUyMTkyIHJlZ3VsYXIgcGxheSByZXNvbHV0aW9uIHdpdGggZm9yY2VkIG9mZmVuc2UgcGxheSArIGJvbnVzLlxuICBjb25zdCBmb3JjZWRQbGF5OiBSZWd1bGFyUGxheSA9IGRpZSA9PT0gMSA/IFwiTFBcIiA6IFwiTFJcIjtcbiAgY29uc3QgYm9udXMgPSA1O1xuICBjb25zdCBkZWZlbnNlUGxheSA9IHN0YXRlLnBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5ID8/IFwiU1JcIjtcblxuICAvLyBNdXN0IGJlIGEgcmVndWxhciBwbGF5IGZvciBtYXRjaHVwIHRvIGJlIG1lYW5pbmdmdWwuIElmIGRlZmVuc2UgYWxzbyBwaWNrZWRcbiAgLy8gc29tZXRoaW5nIHdlaXJkLCBmYWxsIGJhY2sgdG8gcXVhbGl0eSAzIChuZXV0cmFsKS5cbiAgY29uc3QgZGVmUGxheSA9IGlzUmVndWxhcihkZWZlbnNlUGxheSkgPyBkZWZlbnNlUGxheSA6IFwiU1JcIjtcbiAgY29uc3QgcXVhbGl0eSA9IG1hdGNodXBRdWFsaXR5KGZvcmNlZFBsYXksIGRlZlBsYXkpO1xuXG4gIGNvbnN0IG11bHREcmF3ID0gZHJhd011bHRpcGxpZXIoc3RhdGUuZGVjaywgcm5nKTtcbiAgaWYgKG11bHREcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwibXVsdGlwbGllclwiIH0pO1xuICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMobXVsdERyYXcuZGVjaywgcm5nKTtcbiAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG5cbiAgY29uc3QgbXVsdFJvdyA9IE1VTFRJW211bHREcmF3LmluZGV4XTtcbiAgY29uc3QgbXVsdGlwbGllciA9IG11bHRSb3c/LltxdWFsaXR5IC0gMV0gPz8gMDtcbiAgY29uc3QgeWFyZHMgPSBNYXRoLnJvdW5kKG11bHRpcGxpZXIgKiB5YXJkc0RyYXcuY2FyZCkgKyBib251cztcblxuICBldmVudHMucHVzaCh7XG4gICAgdHlwZTogXCJQTEFZX1JFU09MVkVEXCIsXG4gICAgb2ZmZW5zZVBsYXk6IGZvcmNlZFBsYXksXG4gICAgZGVmZW5zZVBsYXk6IGRlZlBsYXksXG4gICAgbWF0Y2h1cFF1YWxpdHk6IHF1YWxpdHksXG4gICAgbXVsdGlwbGllcjogeyBjYXJkOiBtdWx0RHJhdy5jYXJkLCB2YWx1ZTogbXVsdGlwbGllciB9LFxuICAgIHlhcmRzQ2FyZDogeWFyZHNEcmF3LmNhcmQsXG4gICAgeWFyZHNHYWluZWQ6IHlhcmRzLFxuICAgIG5ld0JhbGxPbjogTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBzdGF0ZS5maWVsZC5iYWxsT24gKyB5YXJkcykpLFxuICB9KTtcblxuICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShcbiAgICB7IC4uLnN0YXRlLCBkZWNrOiB5YXJkc0RyYXcuZGVjayB9LFxuICAgIHlhcmRzLFxuICAgIGV2ZW50cyxcbiAgKTtcbn1cblxuZnVuY3Rpb24gaXNSZWd1bGFyKHA6IHN0cmluZyk6IHAgaXMgUmVndWxhclBsYXkge1xuICByZXR1cm4gcCA9PT0gXCJTUlwiIHx8IHAgPT09IFwiTFJcIiB8fCBwID09PSBcIlNQXCIgfHwgcCA9PT0gXCJMUFwiO1xufVxuXG5mdW5jdGlvbiBvcHBvbmVudChwOiBQbGF5ZXJJZCk6IFBsYXllcklkIHtcbiAgcmV0dXJuIHAgPT09IDEgPyAyIDogMTtcbn1cblxuLyoqXG4gKiBEZWZlbnNlIGNhbGxzIFRyaWNrIFBsYXkuIFN5bW1ldHJpYyB0byB0aGUgb2ZmZW5zaXZlIHZlcnNpb24gd2l0aCB0aGVcbiAqIHlhcmRhZ2Ugc2lnbiBpbnZlcnRlZCBvbiB0aGUgTFIvTFAgYW5kIHBlbmFsdHkgYnJhbmNoZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlRGVmZW5zaXZlVHJpY2tQbGF5KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBybmc6IFJuZyxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGRlZmVuZGVyID0gb3Bwb25lbnQob2ZmZW5zZSk7XG4gIGNvbnN0IGRpZSA9IHJuZy5kNigpO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbeyB0eXBlOiBcIlRSSUNLX1BMQVlfUk9MTFwiLCBvdXRjb21lOiBkaWUgfV07XG5cbiAgLy8gNSBcdTIxOTIgQmlnIFBsYXkgZm9yIGRlZmVuc2UgKGNhbGxlcikuXG4gIGlmIChkaWUgPT09IDUpIHtcbiAgICBjb25zdCBicCA9IHJlc29sdmVCaWdQbGF5KHN0YXRlLCBkZWZlbmRlciwgcm5nKTtcbiAgICByZXR1cm4geyBzdGF0ZTogYnAuc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4uYnAuZXZlbnRzXSB9O1xuICB9XG5cbiAgLy8gMiBcdTIxOTIgMTUteWFyZCBwZW5hbHR5IG9uIG9mZmVuc2UgKD0gb2ZmZW5zZSBsb3NlcyAxNSBvciBoYWxmLXRvLW93bi1nb2FsKS5cbiAgaWYgKGRpZSA9PT0gMikge1xuICAgIGNvbnN0IHJhd0xvc3MgPSAtMTU7XG4gICAgY29uc3QgbG9zcyA9XG4gICAgICBzdGF0ZS5maWVsZC5iYWxsT24gKyByYXdMb3NzIDwgMVxuICAgICAgICA/IC1NYXRoLnRydW5jKHN0YXRlLmZpZWxkLmJhbGxPbiAvIDIpXG4gICAgICAgIDogcmF3TG9zcztcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiUEVOQUxUWVwiLCBhZ2FpbnN0OiBvZmZlbnNlLCB5YXJkczogbG9zcywgbG9zc09mRG93bjogZmFsc2UgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwZW5kaW5nUGljazogeyBvZmZlbnNlUGxheTogbnVsbCwgZGVmZW5zZVBsYXk6IG51bGwgfSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICAuLi5zdGF0ZS5maWVsZCxcbiAgICAgICAgICBiYWxsT246IE1hdGgubWF4KDAsIHN0YXRlLmZpZWxkLmJhbGxPbiArIGxvc3MpLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gMyBvciA0IFx1MjE5MiBmaXhlZCBtdWx0aXBsaWVyIHdpdGggdGhlICpkZWZlbnNlJ3MqIHNpZ24gY29udmVudGlvbi4gdjUuMVxuICAvLyBhcHBsaWVzIHRoZSBzYW1lICsvLSBtdWx0aXBsaWVycyBhcyBvZmZlbnNpdmUgVHJpY2sgUGxheTsgdGhlIGludmVyc2lvblxuICAvLyBpcyBpbXBsaWNpdCBpbiBkZWZlbnNlIGJlaW5nIHRoZSBjYWxsZXIuIFlhcmRhZ2UgaXMgZnJvbSBvZmZlbnNlIFBPVi5cbiAgaWYgKGRpZSA9PT0gMyB8fCBkaWUgPT09IDQpIHtcbiAgICBjb25zdCBtdWx0aXBsaWVyID0gZGllID09PSAzID8gLTMgOiA0O1xuICAgIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhzdGF0ZS5kZWNrLCBybmcpO1xuICAgIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuICAgIGNvbnN0IHlhcmRzID0gTWF0aC5yb3VuZChtdWx0aXBsaWVyICogeWFyZHNEcmF3LmNhcmQpO1xuXG4gICAgZXZlbnRzLnB1c2goe1xuICAgICAgdHlwZTogXCJQTEFZX1JFU09MVkVEXCIsXG4gICAgICBvZmZlbnNlUGxheTogc3RhdGUucGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPz8gXCJTUlwiLFxuICAgICAgZGVmZW5zZVBsYXk6IFwiVFBcIixcbiAgICAgIG1hdGNodXBRdWFsaXR5OiAwLFxuICAgICAgbXVsdGlwbGllcjogeyBjYXJkOiBcIktpbmdcIiwgdmFsdWU6IG11bHRpcGxpZXIgfSxcbiAgICAgIHlhcmRzQ2FyZDogeWFyZHNEcmF3LmNhcmQsXG4gICAgICB5YXJkc0dhaW5lZDogeWFyZHMsXG4gICAgICBuZXdCYWxsT246IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgc3RhdGUuZmllbGQuYmFsbE9uICsgeWFyZHMpKSxcbiAgICB9KTtcblxuICAgIHJldHVybiBhcHBseVlhcmRhZ2VPdXRjb21lKFxuICAgICAgeyAuLi5zdGF0ZSwgZGVjazogeWFyZHNEcmF3LmRlY2sgfSxcbiAgICAgIHlhcmRzLFxuICAgICAgZXZlbnRzLFxuICAgICk7XG4gIH1cblxuICAvLyAxIG9yIDYgXHUyMTkyIGRlZmVuc2UncyBwaWNrIGJlY29tZXMgTFAgLyBMUiB3aXRoIC01IGJvbnVzIHRvIG9mZmVuc2UuXG4gIGNvbnN0IGZvcmNlZERlZlBsYXk6IFJlZ3VsYXJQbGF5ID0gZGllID09PSAxID8gXCJMUFwiIDogXCJMUlwiO1xuICBjb25zdCBib251cyA9IC01O1xuICBjb25zdCBvZmZlbnNlUGxheSA9IHN0YXRlLnBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ID8/IFwiU1JcIjtcbiAgY29uc3Qgb2ZmUGxheSA9IGlzUmVndWxhcihvZmZlbnNlUGxheSkgPyBvZmZlbnNlUGxheSA6IFwiU1JcIjtcbiAgY29uc3QgcXVhbGl0eSA9IG1hdGNodXBRdWFsaXR5KG9mZlBsYXksIGZvcmNlZERlZlBsYXkpO1xuXG4gIGNvbnN0IG11bHREcmF3ID0gZHJhd011bHRpcGxpZXIoc3RhdGUuZGVjaywgcm5nKTtcbiAgaWYgKG11bHREcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwibXVsdGlwbGllclwiIH0pO1xuICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMobXVsdERyYXcuZGVjaywgcm5nKTtcbiAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG5cbiAgY29uc3QgbXVsdFJvdyA9IE1VTFRJW211bHREcmF3LmluZGV4XTtcbiAgY29uc3QgbXVsdGlwbGllciA9IG11bHRSb3c/LltxdWFsaXR5IC0gMV0gPz8gMDtcbiAgY29uc3QgeWFyZHMgPSBNYXRoLnJvdW5kKG11bHRpcGxpZXIgKiB5YXJkc0RyYXcuY2FyZCkgKyBib251cztcblxuICBldmVudHMucHVzaCh7XG4gICAgdHlwZTogXCJQTEFZX1JFU09MVkVEXCIsXG4gICAgb2ZmZW5zZVBsYXk6IG9mZlBsYXksXG4gICAgZGVmZW5zZVBsYXk6IGZvcmNlZERlZlBsYXksXG4gICAgbWF0Y2h1cFF1YWxpdHk6IHF1YWxpdHksXG4gICAgbXVsdGlwbGllcjogeyBjYXJkOiBtdWx0RHJhdy5jYXJkLCB2YWx1ZTogbXVsdGlwbGllciB9LFxuICAgIHlhcmRzQ2FyZDogeWFyZHNEcmF3LmNhcmQsXG4gICAgeWFyZHNHYWluZWQ6IHlhcmRzLFxuICAgIG5ld0JhbGxPbjogTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBzdGF0ZS5maWVsZC5iYWxsT24gKyB5YXJkcykpLFxuICB9KTtcblxuICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShcbiAgICB7IC4uLnN0YXRlLCBkZWNrOiB5YXJkc0RyYXcuZGVjayB9LFxuICAgIHlhcmRzLFxuICAgIGV2ZW50cyxcbiAgKTtcbn1cbiIsICIvKipcbiAqIEZpZWxkIEdvYWwgKHJ1bi5qczoyMDQwKS5cbiAqXG4gKiBEaXN0YW5jZSA9ICgxMDAgLSBiYWxsT24pICsgMTcuIFNvIGZyb20gdGhlIDUwLCBGRyA9IDY3LXlhcmQgYXR0ZW1wdC5cbiAqXG4gKiBEaWUgcm9sbCBkZXRlcm1pbmVzIHN1Y2Nlc3MgYnkgZGlzdGFuY2UgYmFuZDpcbiAqICAgZGlzdGFuY2UgPiA2NSAgICAgICAgXHUyMTkyIDEtaW4tMTAwMCBjaGFuY2UgKGVmZmVjdGl2ZWx5IGF1dG8tbWlzcylcbiAqICAgZGlzdGFuY2UgPj0gNjAgICAgICAgXHUyMTkyIG5lZWRzIGRpZSA9IDZcbiAqICAgZGlzdGFuY2UgPj0gNTAgICAgICAgXHUyMTkyIG5lZWRzIGRpZSA+PSA1XG4gKiAgIGRpc3RhbmNlID49IDQwICAgICAgIFx1MjE5MiBuZWVkcyBkaWUgPj0gNFxuICogICBkaXN0YW5jZSA+PSAzMCAgICAgICBcdTIxOTIgbmVlZHMgZGllID49IDNcbiAqICAgZGlzdGFuY2UgPj0gMjAgICAgICAgXHUyMTkyIG5lZWRzIGRpZSA+PSAyXG4gKiAgIGRpc3RhbmNlIDwgIDIwICAgICAgIFx1MjE5MiBhdXRvLW1ha2VcbiAqXG4gKiBJZiBhIHRpbWVvdXQgd2FzIGNhbGxlZCBieSB0aGUgZGVmZW5zZSBqdXN0IHByaW9yIChraWNrZXIgaWNpbmcpLCBkaWUrKy5cbiAqXG4gKiBTdWNjZXNzIFx1MjE5MiArMyBwb2ludHMsIGtpY2tvZmYgdG8gb3Bwb25lbnQuXG4gKiBNaXNzICAgIFx1MjE5MiBwb3NzZXNzaW9uIGZsaXBzIGF0IHRoZSBTUE9UIE9GIFRIRSBLSUNLIChub3QgdGhlIGxpbmUgb2Ygc2NyaW1tYWdlKS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4uLy4uL3N0YXRlLmpzXCI7XG5pbXBvcnQgeyBibGFua1BpY2ssIHR5cGUgU3BlY2lhbFJlc29sdXRpb24gfSBmcm9tIFwiLi9zaGFyZWQuanNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBGaWVsZEdvYWxPcHRpb25zIHtcbiAgLyoqIHRydWUgaWYgdGhlIG9wcG9zaW5nIHRlYW0gY2FsbGVkIGEgdGltZW91dCB0aGF0IHNob3VsZCBpY2UgdGhlIGtpY2tlci4gKi9cbiAgaWNlZD86IGJvb2xlYW47XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlRmllbGRHb2FsKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBybmc6IFJuZyxcbiAgb3B0czogRmllbGRHb2FsT3B0aW9ucyA9IHt9LFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgZGlzdGFuY2UgPSAxMDAgLSBzdGF0ZS5maWVsZC5iYWxsT24gKyAxNztcbiAgY29uc3QgcmF3RGllID0gcm5nLmQ2KCk7XG4gIGNvbnN0IGRpZSA9IG9wdHMuaWNlZCA/IE1hdGgubWluKDYsIHJhd0RpZSArIDEpIDogcmF3RGllO1xuXG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuXG4gIGxldCBtYWtlOiBib29sZWFuO1xuICBpZiAoZGlzdGFuY2UgPiA2NSkge1xuICAgIC8vIEVzc2VudGlhbGx5IGltcG9zc2libGUgXHUyMDE0IHJvbGxlZCAxLTEwMDAsIG1ha2Ugb25seSBvbiBleGFjdCBoaXQuXG4gICAgbWFrZSA9IHJuZy5pbnRCZXR3ZWVuKDEsIDEwMDApID09PSBkaXN0YW5jZTtcbiAgfSBlbHNlIGlmIChkaXN0YW5jZSA+PSA2MCkgbWFrZSA9IGRpZSA+PSA2O1xuICBlbHNlIGlmIChkaXN0YW5jZSA+PSA1MCkgbWFrZSA9IGRpZSA+PSA1O1xuICBlbHNlIGlmIChkaXN0YW5jZSA+PSA0MCkgbWFrZSA9IGRpZSA+PSA0O1xuICBlbHNlIGlmIChkaXN0YW5jZSA+PSAzMCkgbWFrZSA9IGRpZSA+PSAzO1xuICBlbHNlIGlmIChkaXN0YW5jZSA+PSAyMCkgbWFrZSA9IGRpZSA+PSAyO1xuICBlbHNlIG1ha2UgPSB0cnVlO1xuXG4gIGlmIChtYWtlKSB7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkZJRUxEX0dPQUxfR09PRFwiLCBwbGF5ZXI6IG9mZmVuc2UgfSk7XG4gICAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICBbb2ZmZW5zZV06IHsgLi4uc3RhdGUucGxheWVyc1tvZmZlbnNlXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbb2ZmZW5zZV0uc2NvcmUgKyAzIH0sXG4gICAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBwaGFzZTogXCJLSUNLT0ZGXCIsXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICBldmVudHMucHVzaCh7IHR5cGU6IFwiRklFTERfR09BTF9NSVNTRURcIiwgcGxheWVyOiBvZmZlbnNlIH0pO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcIm1pc3NlZF9mZ1wiIH0pO1xuXG4gIC8vIFBvc3Nlc3Npb24gZmxpcHMgYXQgbGluZSBvZiBzY3JpbW1hZ2UgKGJhbGwgc3RheXMgd2hlcmUga2lja2VkIGZyb20pLlxuICBjb25zdCBkZWZlbmRlciA9IG9wcChvZmZlbnNlKTtcbiAgY29uc3QgbWlycm9yZWRCYWxsT24gPSAxMDAgLSBzdGF0ZS5maWVsZC5iYWxsT247XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgYmFsbE9uOiBtaXJyb3JlZEJhbGxPbixcbiAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgbWlycm9yZWRCYWxsT24gKyAxMCksXG4gICAgICAgIGRvd246IDEsXG4gICAgICAgIG9mZmVuc2U6IGRlZmVuZGVyLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cbiIsICIvKipcbiAqIFR3by1Qb2ludCBDb252ZXJzaW9uIChUV09fUFQgcGhhc2UpLlxuICpcbiAqIEJhbGwgaXMgcGxhY2VkIGF0IG9mZmVuc2UncyA5NyAoPSAzLXlhcmQgbGluZSkuIEEgc2luZ2xlIHJlZ3VsYXIgcGxheSBpc1xuICogcmVzb2x2ZWQuIElmIHRoZSByZXN1bHRpbmcgeWFyZGFnZSBjcm9zc2VzIHRoZSBnb2FsIGxpbmUsIFRXT19QT0lOVF9HT09ELlxuICogT3RoZXJ3aXNlLCBUV09fUE9JTlRfRkFJTEVELiBFaXRoZXIgd2F5LCBraWNrb2ZmIGZvbGxvd3MuXG4gKlxuICogVW5saWtlIGEgbm9ybWFsIHBsYXksIGEgMnB0IGRvZXMgTk9UIGNoYW5nZSBkb3duL2Rpc3RhbmNlLiBJdCdzIGEgb25lLXNob3QuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIFJlZ3VsYXJQbGF5IH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBkcmF3TXVsdGlwbGllciwgZHJhd1lhcmRzIH0gZnJvbSBcIi4uL2RlY2suanNcIjtcbmltcG9ydCB7IGNvbXB1dGVZYXJkYWdlIH0gZnJvbSBcIi4uL3lhcmRhZ2UuanNcIjtcbmltcG9ydCB7IGJsYW5rUGljaywgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbiB9IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVR3b1BvaW50Q29udmVyc2lvbihcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgb2ZmZW5zZVBsYXk6IFJlZ3VsYXJQbGF5LFxuICBkZWZlbnNlUGxheTogUmVndWxhclBsYXksXG4gIHJuZzogUm5nLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG5cbiAgY29uc3QgbXVsdERyYXcgPSBkcmF3TXVsdGlwbGllcihzdGF0ZS5kZWNrLCBybmcpO1xuICBpZiAobXVsdERyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJtdWx0aXBsaWVyXCIgfSk7XG4gIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhtdWx0RHJhdy5kZWNrLCBybmcpO1xuICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcblxuICBjb25zdCBvdXRjb21lID0gY29tcHV0ZVlhcmRhZ2Uoe1xuICAgIG9mZmVuc2U6IG9mZmVuc2VQbGF5LFxuICAgIGRlZmVuc2U6IGRlZmVuc2VQbGF5LFxuICAgIG11bHRpcGxpZXJDYXJkOiBtdWx0RHJhdy5pbmRleCxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICB9KTtcblxuICAvLyAycHQgc3RhcnRzIGF0IDk3LiBDcm9zc2luZyB0aGUgZ29hbCA9IGdvb2QuXG4gIGNvbnN0IHN0YXJ0QmFsbE9uID0gOTc7XG4gIGNvbnN0IHByb2plY3RlZCA9IHN0YXJ0QmFsbE9uICsgb3V0Y29tZS55YXJkc0dhaW5lZDtcbiAgY29uc3QgZ29vZCA9IHByb2plY3RlZCA+PSAxMDA7XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgIG9mZmVuc2VQbGF5LFxuICAgIGRlZmVuc2VQbGF5LFxuICAgIG1hdGNodXBRdWFsaXR5OiBvdXRjb21lLm1hdGNodXBRdWFsaXR5LFxuICAgIG11bHRpcGxpZXI6IHsgY2FyZDogb3V0Y29tZS5tdWx0aXBsaWVyQ2FyZE5hbWUsIHZhbHVlOiBvdXRjb21lLm11bHRpcGxpZXIgfSxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgIHlhcmRzR2FpbmVkOiBvdXRjb21lLnlhcmRzR2FpbmVkLFxuICAgIG5ld0JhbGxPbjogTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBwcm9qZWN0ZWQpKSxcbiAgfSk7XG5cbiAgY29uc3QgbmV3UGxheWVycyA9IGdvb2RcbiAgICA/ICh7XG4gICAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICAgIFtvZmZlbnNlXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLCBzY29yZTogc3RhdGUucGxheWVyc1tvZmZlbnNlXS5zY29yZSArIDIgfSxcbiAgICAgIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXSlcbiAgICA6IHN0YXRlLnBsYXllcnM7XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IGdvb2QgPyBcIlRXT19QT0lOVF9HT09EXCIgOiBcIlRXT19QT0lOVF9GQUlMRURcIixcbiAgICBwbGF5ZXI6IG9mZmVuc2UsXG4gIH0pO1xuXG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgZGVjazogeWFyZHNEcmF3LmRlY2ssXG4gICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuIiwgIi8qKlxuICogT3ZlcnRpbWUgbWVjaGFuaWNzLlxuICpcbiAqIENvbGxlZ2UtZm9vdGJhbGwgc3R5bGU6XG4gKiAgIC0gRWFjaCBwZXJpb2Q6IGVhY2ggdGVhbSBnZXRzIG9uZSBwb3NzZXNzaW9uIGZyb20gdGhlIG9wcG9uZW50J3MgMjVcbiAqICAgICAob2ZmZW5zZSBQT1Y6IGJhbGxPbiA9IDc1KS5cbiAqICAgLSBBIHBvc3Nlc3Npb24gZW5kcyB3aXRoOiBURCAoZm9sbG93ZWQgYnkgUEFULzJwdCksIEZHIChtYWRlIG9yIG1pc3NlZCksXG4gKiAgICAgdHVybm92ZXIsIHR1cm5vdmVyLW9uLWRvd25zLCBvciBzYWZldHkuXG4gKiAgIC0gQWZ0ZXIgYm90aCBwb3NzZXNzaW9ucywgaWYgc2NvcmVzIGRpZmZlciBcdTIxOTIgR0FNRV9PVkVSLiBJZiB0aWVkIFx1MjE5MiBuZXh0XG4gKiAgICAgcGVyaW9kLlxuICogICAtIFBlcmlvZHMgYWx0ZXJuYXRlIHdobyBwb3NzZXNzZXMgZmlyc3QuXG4gKiAgIC0gUGVyaW9kIDMrOiAyLXBvaW50IGNvbnZlcnNpb24gbWFuZGF0b3J5IGFmdGVyIGEgVEQgKG5vIFBBVCBraWNrKS5cbiAqICAgLSBIYWlsIE1hcnlzOiAyIHBlciBwZXJpb2QsIHJlZmlsbGVkIGF0IHN0YXJ0IG9mIGVhY2ggcGVyaW9kLlxuICogICAtIFRpbWVvdXRzOiAxIHBlciBwYWlyIG9mIHBlcmlvZHMuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBPdmVydGltZVN0YXRlLCBQbGF5ZXJJZCB9IGZyb20gXCIuLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgZW1wdHlIYW5kLCBvcHAgfSBmcm9tIFwiLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7IGZyZXNoRGVja011bHRpcGxpZXJzLCBmcmVzaERlY2tZYXJkcyB9IGZyb20gXCIuLi9zdGF0ZS5qc1wiO1xuXG5jb25zdCBPVF9CQUxMX09OID0gNzU7IC8vIG9wcG9uZW50J3MgMjUteWFyZCBsaW5lLCBmcm9tIG9mZmVuc2UgUE9WXG5cbi8qKlxuICogSW5pdGlhbGl6ZSBPVCBzdGF0ZSwgcmVmcmVzaCBkZWNrcy9oYW5kcywgc2V0IGJhbGwgYXQgdGhlIDI1LlxuICogQ2FsbGVkIG9uY2UgdGllZCByZWd1bGF0aW9uIGVuZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGFydE92ZXJ0aW1lKHN0YXRlOiBHYW1lU3RhdGUpOiB7IHN0YXRlOiBHYW1lU3RhdGU7IGV2ZW50czogRXZlbnRbXSB9IHtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG4gIGNvbnN0IGZpcnN0UmVjZWl2ZXI6IFBsYXllcklkID0gc3RhdGUub3BlbmluZ1JlY2VpdmVyID09PSAxID8gMiA6IDE7XG4gIGNvbnN0IG92ZXJ0aW1lOiBPdmVydGltZVN0YXRlID0ge1xuICAgIHBlcmlvZDogMSxcbiAgICBwb3NzZXNzaW9uOiBmaXJzdFJlY2VpdmVyLFxuICAgIGZpcnN0UmVjZWl2ZXIsXG4gICAgcG9zc2Vzc2lvbnNSZW1haW5pbmc6IDIsXG4gIH07XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJPVkVSVElNRV9TVEFSVEVEXCIsIHBlcmlvZDogMSwgcG9zc2Vzc2lvbjogZmlyc3RSZWNlaXZlciB9KTtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwaGFzZTogXCJPVF9TVEFSVFwiLFxuICAgICAgb3ZlcnRpbWUsXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbi8qKiBCZWdpbiAob3IgcmVzdW1lKSB0aGUgbmV4dCBPVCBwb3NzZXNzaW9uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0YXJ0T3ZlcnRpbWVQb3NzZXNzaW9uKHN0YXRlOiBHYW1lU3RhdGUpOiB7IHN0YXRlOiBHYW1lU3RhdGU7IGV2ZW50czogRXZlbnRbXSB9IHtcbiAgaWYgKCFzdGF0ZS5vdmVydGltZSkgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcblxuICBjb25zdCBwb3NzZXNzaW9uID0gc3RhdGUub3ZlcnRpbWUucG9zc2Vzc2lvbjtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG5cbiAgLy8gUmVmaWxsIEhNIGNvdW50IGZvciB0aGUgcG9zc2Vzc2lvbidzIG9mZmVuc2UgKG1hdGNoZXMgdjUuMTogSE0gcmVzZXRzXG4gIC8vIHBlciBPVCBwZXJpb2QpLiBQZXJpb2QgMysgcGxheWVycyBoYXZlIG9ubHkgMiBITXMgYW55d2F5LlxuICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgW3Bvc3Nlc3Npb25dOiB7XG4gICAgICAuLi5zdGF0ZS5wbGF5ZXJzW3Bvc3Nlc3Npb25dLFxuICAgICAgaGFuZDogeyAuLi5zdGF0ZS5wbGF5ZXJzW3Bvc3Nlc3Npb25dLmhhbmQsIEhNOiBzdGF0ZS5vdmVydGltZS5wZXJpb2QgPj0gMyA/IDIgOiAyIH0sXG4gICAgfSxcbiAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuXG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgIHBoYXNlOiBcIk9UX1BMQVlcIixcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogT1RfQkFMTF9PTixcbiAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgT1RfQkFMTF9PTiArIDEwKSxcbiAgICAgICAgZG93bjogMSxcbiAgICAgICAgb2ZmZW5zZTogcG9zc2Vzc2lvbixcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbi8qKlxuICogRW5kIHRoZSBjdXJyZW50IE9UIHBvc3Nlc3Npb24uIERlY3JlbWVudHMgcG9zc2Vzc2lvbnNSZW1haW5pbmc7IGlmIDAsXG4gKiBjaGVja3MgZm9yIGdhbWUgZW5kLiBPdGhlcndpc2UgZmxpcHMgcG9zc2Vzc2lvbi5cbiAqXG4gKiBDYWxsZXIgaXMgcmVzcG9uc2libGUgZm9yIGRldGVjdGluZyBcInRoaXMgd2FzIGEgcG9zc2Vzc2lvbi1lbmRpbmcgZXZlbnRcIlxuICogKFREK1BBVCwgRkcgZGVjaXNpb24sIHR1cm5vdmVyLCBldGMpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZW5kT3ZlcnRpbWVQb3NzZXNzaW9uKHN0YXRlOiBHYW1lU3RhdGUpOiB7IHN0YXRlOiBHYW1lU3RhdGU7IGV2ZW50czogRXZlbnRbXSB9IHtcbiAgaWYgKCFzdGF0ZS5vdmVydGltZSkgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcblxuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcbiAgY29uc3QgcmVtYWluaW5nID0gc3RhdGUub3ZlcnRpbWUucG9zc2Vzc2lvbnNSZW1haW5pbmc7XG5cbiAgaWYgKHJlbWFpbmluZyA9PT0gMikge1xuICAgIC8vIEZpcnN0IHBvc3Nlc3Npb24gZW5kZWQuIEZsaXAgdG8gc2Vjb25kIHRlYW0sIGZyZXNoIGJhbGwuXG4gICAgY29uc3QgbmV4dFBvc3Nlc3Npb24gPSBvcHAoc3RhdGUub3ZlcnRpbWUucG9zc2Vzc2lvbik7XG4gICAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICBbbmV4dFBvc3Nlc3Npb25dOiB7XG4gICAgICAgIC4uLnN0YXRlLnBsYXllcnNbbmV4dFBvc3Nlc3Npb25dLFxuICAgICAgICBoYW5kOiB7IC4uLnN0YXRlLnBsYXllcnNbbmV4dFBvc3Nlc3Npb25dLmhhbmQsIEhNOiAyIH0sXG4gICAgICB9LFxuICAgIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICAgIHBoYXNlOiBcIk9UX1BMQVlcIixcbiAgICAgICAgb3ZlcnRpbWU6IHsgLi4uc3RhdGUub3ZlcnRpbWUsIHBvc3Nlc3Npb246IG5leHRQb3NzZXNzaW9uLCBwb3NzZXNzaW9uc1JlbWFpbmluZzogMSB9LFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIGJhbGxPbjogT1RfQkFMTF9PTixcbiAgICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBPVF9CQUxMX09OICsgMTApLFxuICAgICAgICAgIGRvd246IDEsXG4gICAgICAgICAgb2ZmZW5zZTogbmV4dFBvc3Nlc3Npb24sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBTZWNvbmQgcG9zc2Vzc2lvbiBlbmRlZC4gQ29tcGFyZSBzY29yZXMuXG4gIGNvbnN0IHAxID0gc3RhdGUucGxheWVyc1sxXS5zY29yZTtcbiAgY29uc3QgcDIgPSBzdGF0ZS5wbGF5ZXJzWzJdLnNjb3JlO1xuICBpZiAocDEgIT09IHAyKSB7XG4gICAgY29uc3Qgd2lubmVyOiBQbGF5ZXJJZCA9IHAxID4gcDIgPyAxIDogMjtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiR0FNRV9PVkVSXCIsIHdpbm5lciB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBoYXNlOiBcIkdBTUVfT1ZFUlwiLFxuICAgICAgICBvdmVydGltZTogeyAuLi5zdGF0ZS5vdmVydGltZSwgcG9zc2Vzc2lvbnNSZW1haW5pbmc6IDAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIFRpZWQgXHUyMDE0IHN0YXJ0IG5leHQgcGVyaW9kLiBBbHRlcm5hdGVzIGZpcnN0LXBvc3Nlc3Nvci5cbiAgY29uc3QgbmV4dFBlcmlvZCA9IHN0YXRlLm92ZXJ0aW1lLnBlcmlvZCArIDE7XG4gIGNvbnN0IG5leHRGaXJzdCA9IG9wcChzdGF0ZS5vdmVydGltZS5maXJzdFJlY2VpdmVyKTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIk9WRVJUSU1FX1NUQVJURURcIiwgcGVyaW9kOiBuZXh0UGVyaW9kLCBwb3NzZXNzaW9uOiBuZXh0Rmlyc3QgfSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGhhc2U6IFwiT1RfU1RBUlRcIixcbiAgICAgIG92ZXJ0aW1lOiB7XG4gICAgICAgIHBlcmlvZDogbmV4dFBlcmlvZCxcbiAgICAgICAgcG9zc2Vzc2lvbjogbmV4dEZpcnN0LFxuICAgICAgICBmaXJzdFJlY2VpdmVyOiBuZXh0Rmlyc3QsXG4gICAgICAgIHBvc3Nlc3Npb25zUmVtYWluaW5nOiAyLFxuICAgICAgfSxcbiAgICAgIC8vIEZyZXNoIGRlY2tzIGZvciB0aGUgbmV3IHBlcmlvZC5cbiAgICAgIGRlY2s6IHsgbXVsdGlwbGllcnM6IGZyZXNoRGVja011bHRpcGxpZXJzKCksIHlhcmRzOiBmcmVzaERlY2tZYXJkcygpIH0sXG4gICAgICBwbGF5ZXJzOiB7XG4gICAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICAgIDE6IHsgLi4uc3RhdGUucGxheWVyc1sxXSwgaGFuZDogZW1wdHlIYW5kKHRydWUpIH0sXG4gICAgICAgIDI6IHsgLi4uc3RhdGUucGxheWVyc1syXSwgaGFuZDogZW1wdHlIYW5kKHRydWUpIH0sXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG4vKipcbiAqIERldGVjdCB3aGV0aGVyIGEgc2VxdWVuY2Ugb2YgZXZlbnRzIGZyb20gYSBwbGF5IHJlc29sdXRpb24gc2hvdWxkIGVuZFxuICogdGhlIGN1cnJlbnQgT1QgcG9zc2Vzc2lvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzUG9zc2Vzc2lvbkVuZGluZ0luT1QoZXZlbnRzOiBSZWFkb25seUFycmF5PEV2ZW50Pik6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IGUgb2YgZXZlbnRzKSB7XG4gICAgc3dpdGNoIChlLnR5cGUpIHtcbiAgICAgIGNhc2UgXCJQQVRfR09PRFwiOlxuICAgICAgY2FzZSBcIlRXT19QT0lOVF9HT09EXCI6XG4gICAgICBjYXNlIFwiVFdPX1BPSU5UX0ZBSUxFRFwiOlxuICAgICAgY2FzZSBcIkZJRUxEX0dPQUxfR09PRFwiOlxuICAgICAgY2FzZSBcIkZJRUxEX0dPQUxfTUlTU0VEXCI6XG4gICAgICBjYXNlIFwiVFVSTk9WRVJcIjpcbiAgICAgIGNhc2UgXCJUVVJOT1ZFUl9PTl9ET1dOU1wiOlxuICAgICAgY2FzZSBcIlNBRkVUWVwiOlxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuIiwgIi8qKlxuICogVGhlIHNpbmdsZSB0cmFuc2l0aW9uIGZ1bmN0aW9uLiBUYWtlcyAoc3RhdGUsIGFjdGlvbiwgcm5nKSBhbmQgcmV0dXJuc1xuICogYSBuZXcgc3RhdGUgcGx1cyB0aGUgZXZlbnRzIHRoYXQgZGVzY3JpYmUgd2hhdCBoYXBwZW5lZC5cbiAqXG4gKiBUaGlzIGZpbGUgaXMgdGhlICpza2VsZXRvbiogXHUyMDE0IHRoZSBkaXNwYXRjaCBzaGFwZSBpcyBoZXJlLCB0aGUgY2FzZXMgYXJlXG4gKiBtb3N0bHkgc3R1YnMgbWFya2VkIGAvLyBUT0RPOiBwb3J0IGZyb20gcnVuLmpzYC4gQXMgd2UgcG9ydCwgZWFjaCBjYXNlXG4gKiBnZXRzIHVuaXQtdGVzdGVkLiBXaGVuIGV2ZXJ5IGNhc2UgaXMgaW1wbGVtZW50ZWQgYW5kIHRlc3RlZCwgdjUuMSdzIHJ1bi5qc1xuICogY2FuIGJlIGRlbGV0ZWQuXG4gKlxuICogUnVsZXMgZm9yIHRoaXMgZmlsZTpcbiAqICAgMS4gTkVWRVIgaW1wb3J0IGZyb20gRE9NLCBuZXR3b3JrLCBvciBhbmltYXRpb24gbW9kdWxlcy5cbiAqICAgMi4gTkVWRVIgbXV0YXRlIGBzdGF0ZWAgXHUyMDE0IGFsd2F5cyByZXR1cm4gYSBuZXcgb2JqZWN0LlxuICogICAzLiBORVZFUiBjYWxsIE1hdGgucmFuZG9tIFx1MjAxNCB1c2UgdGhlIGBybmdgIHBhcmFtZXRlci5cbiAqICAgNC4gTkVWRVIgdGhyb3cgb24gaW52YWxpZCBhY3Rpb25zIFx1MjAxNCByZXR1cm4gYHsgc3RhdGUsIGV2ZW50czogW10gfWBcbiAqICAgICAgYW5kIGxldCB0aGUgY2FsbGVyIGRlY2lkZS4gKFZhbGlkYXRpb24gaXMgdGhlIHNlcnZlcidzIGpvYi4pXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBBY3Rpb24gfSBmcm9tIFwiLi9hY3Rpb25zLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgS2lja1R5cGUsIFJldHVyblR5cGUgfSBmcm9tIFwiLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgdmFsaWRhdGVBY3Rpb24gfSBmcm9tIFwiLi92YWxpZGF0ZS5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi9ybmcuanNcIjtcbmltcG9ydCB7IGlzUmVndWxhclBsYXksIHJlc29sdmVSZWd1bGFyUGxheSB9IGZyb20gXCIuL3J1bGVzL3BsYXkuanNcIjtcbmltcG9ydCB7XG4gIHJlc29sdmVEZWZlbnNpdmVUcmlja1BsYXksXG4gIHJlc29sdmVGaWVsZEdvYWwsXG4gIHJlc29sdmVIYWlsTWFyeSxcbiAgcmVzb2x2ZUtpY2tvZmYsXG4gIHJlc29sdmVPZmZlbnNpdmVUcmlja1BsYXksXG4gIHJlc29sdmVQdW50LFxuICByZXNvbHZlU2FtZVBsYXksXG4gIHJlc29sdmVUd29Qb2ludENvbnZlcnNpb24sXG59IGZyb20gXCIuL3J1bGVzL3NwZWNpYWxzL2luZGV4LmpzXCI7XG5pbXBvcnQge1xuICBlbmRPdmVydGltZVBvc3Nlc3Npb24sXG4gIGlzUG9zc2Vzc2lvbkVuZGluZ0luT1QsXG4gIHN0YXJ0T3ZlcnRpbWUsXG4gIHN0YXJ0T3ZlcnRpbWVQb3NzZXNzaW9uLFxufSBmcm9tIFwiLi9ydWxlcy9vdmVydGltZS5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4vc3RhdGUuanNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBSZWR1Y2VSZXN1bHQge1xuICBzdGF0ZTogR2FtZVN0YXRlO1xuICBldmVudHM6IEV2ZW50W107XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWR1Y2Uoc3RhdGU6IEdhbWVTdGF0ZSwgYWN0aW9uOiBBY3Rpb24sIHJuZzogUm5nKTogUmVkdWNlUmVzdWx0IHtcbiAgLy8gR2F0ZSBhdCB0aGUgdG9wOiBpbnZhbGlkIGFjdGlvbnMgYXJlIHNpbGVudGx5IG5vLW9wZWQuIFNhbWUgY29udHJhY3RcbiAgLy8gYXMgdGhlIHJlZHVjZXIncyBwZXItY2FzZSBzaGFwZSBjaGVja3MgKFwiSWxsZWdhbCBwaWNrcyBhcmUgc2lsZW50bHlcbiAgLy8gbm8tb3AnZDsgdGhlIG9yY2hlc3RyYXRvciBpcyByZXNwb25zaWJsZSBmb3Igc3VyZmFjaW5nIGVycm9yc1wiKSwgYnV0XG4gIC8vIGNlbnRyYWxpemVkIHNvIGFuIHVuYXV0aGVudGljYXRlZCBETyBjbGllbnQgY2FuJ3Qgc2VuZCBhIG1hbGZvcm1lZFxuICAvLyBwYXlsb2FkIHRoYXQgc2xpcHMgcGFzdCBhIG1pc3NpbmcgY2FzZS1sZXZlbCBjaGVjay5cbiAgaWYgKHZhbGlkYXRlQWN0aW9uKHN0YXRlLCBhY3Rpb24pICE9PSBudWxsKSB7XG4gICAgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcbiAgfVxuICBjb25zdCByZXN1bHQgPSByZWR1Y2VDb3JlKHN0YXRlLCBhY3Rpb24sIHJuZyk7XG4gIHJldHVybiBhcHBseU92ZXJ0aW1lUm91dGluZyhzdGF0ZSwgcmVzdWx0KTtcbn1cblxuLyoqXG4gKiBJZiB3ZSdyZSBpbiBPVCBhbmQgYSBwb3NzZXNzaW9uLWVuZGluZyBldmVudCBqdXN0IGZpcmVkLCByb3V0ZSB0byB0aGVcbiAqIG5leHQgT1QgcG9zc2Vzc2lvbiAob3IgZ2FtZSBlbmQpLiBTa2lwcyB3aGVuIHRoZSBhY3Rpb24gaXMgaXRzZWxmIGFuIE9UXG4gKiBoZWxwZXIgKHNvIHdlIGRvbid0IGRvdWJsZS1yb3V0ZSkuXG4gKi9cbmZ1bmN0aW9uIGFwcGx5T3ZlcnRpbWVSb3V0aW5nKHByZXZTdGF0ZTogR2FtZVN0YXRlLCByZXN1bHQ6IFJlZHVjZVJlc3VsdCk6IFJlZHVjZVJlc3VsdCB7XG4gIC8vIE9ubHkgY29uc2lkZXIgcm91dGluZyB3aGVuIHdlICp3ZXJlKiBpbiBPVC4gKHN0YXJ0T3ZlcnRpbWUgc2V0cyBzdGF0ZS5vdmVydGltZS4pXG4gIGlmICghcHJldlN0YXRlLm92ZXJ0aW1lICYmICFyZXN1bHQuc3RhdGUub3ZlcnRpbWUpIHJldHVybiByZXN1bHQ7XG4gIGlmICghcmVzdWx0LnN0YXRlLm92ZXJ0aW1lKSByZXR1cm4gcmVzdWx0O1xuICBpZiAoIWlzUG9zc2Vzc2lvbkVuZGluZ0luT1QocmVzdWx0LmV2ZW50cykpIHJldHVybiByZXN1bHQ7XG5cbiAgLy8gUEFUIGluIE9UOiBhIFREIHNjb3JlZCwgYnV0IHBvc3Nlc3Npb24gZG9lc24ndCBlbmQgdW50aWwgUEFULzJwdCByZXNvbHZlcy5cbiAgLy8gUEFUX0dPT0QgLyBUV09fUE9JTlRfKiBhcmUgdGhlbXNlbHZlcyBwb3NzZXNzaW9uLWVuZGluZywgc28gdGhleSBETyByb3V0ZS5cbiAgLy8gQWZ0ZXIgcG9zc2Vzc2lvbiBlbmRzLCBkZWNpZGUgbmV4dC5cbiAgY29uc3QgZW5kZWQgPSBlbmRPdmVydGltZVBvc3Nlc3Npb24ocmVzdWx0LnN0YXRlKTtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZTogZW5kZWQuc3RhdGUsXG4gICAgZXZlbnRzOiBbLi4ucmVzdWx0LmV2ZW50cywgLi4uZW5kZWQuZXZlbnRzXSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVkdWNlQ29yZShzdGF0ZTogR2FtZVN0YXRlLCBhY3Rpb246IEFjdGlvbiwgcm5nOiBSbmcpOiBSZWR1Y2VSZXN1bHQge1xuICBzd2l0Y2ggKGFjdGlvbi50eXBlKSB7XG4gICAgY2FzZSBcIlNUQVJUX0dBTUVcIjpcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgcGhhc2U6IFwiQ09JTl9UT1NTXCIsXG4gICAgICAgICAgY2xvY2s6IHtcbiAgICAgICAgICAgIC4uLnN0YXRlLmNsb2NrLFxuICAgICAgICAgICAgcXVhcnRlcjogMSxcbiAgICAgICAgICAgIHF1YXJ0ZXJMZW5ndGhNaW51dGVzOiBhY3Rpb24ucXVhcnRlckxlbmd0aE1pbnV0ZXMsXG4gICAgICAgICAgICBzZWNvbmRzUmVtYWluaW5nOiBhY3Rpb24ucXVhcnRlckxlbmd0aE1pbnV0ZXMgKiA2MCxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHBsYXllcnM6IHtcbiAgICAgICAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICAgICAgICAxOiB7IC4uLnN0YXRlLnBsYXllcnNbMV0sIHRlYW06IHsgaWQ6IGFjdGlvbi50ZWFtc1sxXSB9IH0sXG4gICAgICAgICAgICAyOiB7IC4uLnN0YXRlLnBsYXllcnNbMl0sIHRlYW06IHsgaWQ6IGFjdGlvbi50ZWFtc1syXSB9IH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgZXZlbnRzOiBbeyB0eXBlOiBcIkdBTUVfU1RBUlRFRFwiIH1dLFxuICAgICAgfTtcblxuICAgIGNhc2UgXCJDT0lOX1RPU1NfQ0FMTFwiOiB7XG4gICAgICBjb25zdCBhY3R1YWwgPSBybmcuY29pbkZsaXAoKTtcbiAgICAgIGNvbnN0IHdpbm5lciA9IGFjdGlvbi5jYWxsID09PSBhY3R1YWwgPyBhY3Rpb24ucGxheWVyIDogb3BwKGFjdGlvbi5wbGF5ZXIpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGUsXG4gICAgICAgIGV2ZW50czogW3sgdHlwZTogXCJDT0lOX1RPU1NfUkVTVUxUXCIsIHJlc3VsdDogYWN0dWFsLCB3aW5uZXIgfV0sXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJSRUNFSVZFX0NIT0lDRVwiOiB7XG4gICAgICAvLyBUaGUgY2FsbGVyJ3MgY2hvaWNlIGRldGVybWluZXMgd2hvIHJlY2VpdmVzIHRoZSBvcGVuaW5nIGtpY2tvZmYuXG4gICAgICAvLyBcInJlY2VpdmVcIiBcdTIxOTIgY2FsbGVyIHJlY2VpdmVzOyBcImRlZmVyXCIgXHUyMTkyIGNhbGxlciBraWNrcyAob3Bwb25lbnQgcmVjZWl2ZXMpLlxuICAgICAgY29uc3QgcmVjZWl2ZXIgPSBhY3Rpb24uY2hvaWNlID09PSBcInJlY2VpdmVcIiA/IGFjdGlvbi5wbGF5ZXIgOiBvcHAoYWN0aW9uLnBsYXllcik7XG4gICAgICAvLyBLaWNrZXIgaXMgdGhlIG9wZW5pbmcgb2ZmZW5zZSAodGhleSBraWNrIG9mZik7IHJlY2VpdmVyIGdldHMgdGhlIGJhbGwgYWZ0ZXIuXG4gICAgICBjb25zdCBraWNrZXIgPSBvcHAocmVjZWl2ZXIpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGU6IHtcbiAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICBwaGFzZTogXCJLSUNLT0ZGXCIsXG4gICAgICAgICAgb3BlbmluZ1JlY2VpdmVyOiByZWNlaXZlcixcbiAgICAgICAgICBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZToga2lja2VyIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGV2ZW50czogW3sgdHlwZTogXCJLSUNLT0ZGXCIsIHJlY2VpdmluZ1BsYXllcjogcmVjZWl2ZXIsIGJhbGxPbjogMzUgfV0sXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJSRVNPTFZFX0tJQ0tPRkZcIjoge1xuICAgICAgY29uc3Qgb3B0czogeyBraWNrVHlwZT86IEtpY2tUeXBlOyByZXR1cm5UeXBlPzogUmV0dXJuVHlwZSB9ID0ge307XG4gICAgICBpZiAoYWN0aW9uLmtpY2tUeXBlKSBvcHRzLmtpY2tUeXBlID0gYWN0aW9uLmtpY2tUeXBlO1xuICAgICAgaWYgKGFjdGlvbi5yZXR1cm5UeXBlKSBvcHRzLnJldHVyblR5cGUgPSBhY3Rpb24ucmV0dXJuVHlwZTtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHJlc29sdmVLaWNrb2ZmKHN0YXRlLCBybmcsIG9wdHMpO1xuICAgICAgcmV0dXJuIHsgc3RhdGU6IHJlc3VsdC5zdGF0ZSwgZXZlbnRzOiByZXN1bHQuZXZlbnRzIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIlNUQVJUX09UX1BPU1NFU1NJT05cIjoge1xuICAgICAgY29uc3QgciA9IHN0YXJ0T3ZlcnRpbWVQb3NzZXNzaW9uKHN0YXRlKTtcbiAgICAgIHJldHVybiB7IHN0YXRlOiByLnN0YXRlLCBldmVudHM6IHIuZXZlbnRzIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIlBJQ0tfUExBWVwiOiB7XG4gICAgICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgICAgIGNvbnN0IGlzT2ZmZW5zaXZlQ2FsbCA9IGFjdGlvbi5wbGF5ZXIgPT09IG9mZmVuc2U7XG5cbiAgICAgIC8vIFZhbGlkYXRlLiBJbGxlZ2FsIHBpY2tzIGFyZSBzaWxlbnRseSBuby1vcCdkOyB0aGUgb3JjaGVzdHJhdG9yXG4gICAgICAvLyAoc2VydmVyIC8gVUkpIGlzIHJlc3BvbnNpYmxlIGZvciBzdXJmYWNpbmcgdGhlIGVycm9yIHRvIHRoZSB1c2VyLlxuICAgICAgaWYgKGFjdGlvbi5wbGF5ID09PSBcIkZHXCIgfHwgYWN0aW9uLnBsYXkgPT09IFwiUFVOVFwiIHx8IGFjdGlvbi5wbGF5ID09PSBcIlRXT19QVFwiKSB7XG4gICAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07IC8vIHdyb25nIGFjdGlvbiB0eXBlIGZvciB0aGVzZVxuICAgICAgfVxuICAgICAgaWYgKGFjdGlvbi5wbGF5ID09PSBcIkhNXCIgJiYgIWlzT2ZmZW5zaXZlQ2FsbCkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9OyAvLyBkZWZlbnNlIGNhbid0IGNhbGwgSGFpbCBNYXJ5XG4gICAgICB9XG4gICAgICBjb25zdCBoYW5kID0gc3RhdGUucGxheWVyc1thY3Rpb24ucGxheWVyXS5oYW5kO1xuICAgICAgaWYgKGFjdGlvbi5wbGF5ID09PSBcIkhNXCIgJiYgaGFuZC5ITSA8PSAwKSB7XG4gICAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gICAgICB9XG4gICAgICBpZiAoXG4gICAgICAgIChhY3Rpb24ucGxheSA9PT0gXCJTUlwiIHx8IGFjdGlvbi5wbGF5ID09PSBcIkxSXCIgfHwgYWN0aW9uLnBsYXkgPT09IFwiU1BcIiB8fCBhY3Rpb24ucGxheSA9PT0gXCJMUFwiIHx8IGFjdGlvbi5wbGF5ID09PSBcIlRQXCIpICYmXG4gICAgICAgIGhhbmRbYWN0aW9uLnBsYXldIDw9IDBcbiAgICAgICkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgfVxuICAgICAgLy8gUmVqZWN0IHJlLXBpY2tzIGZvciB0aGUgc2FtZSBzaWRlIGluIHRoZSBzYW1lIHBsYXkuXG4gICAgICBpZiAoaXNPZmZlbnNpdmVDYWxsICYmIHN0YXRlLnBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5KSB7XG4gICAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gICAgICB9XG4gICAgICBpZiAoIWlzT2ZmZW5zaXZlQ2FsbCAmJiBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgfVxuXG4gICAgICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXG4gICAgICAgIHsgdHlwZTogXCJQTEFZX0NBTExFRFwiLCBwbGF5ZXI6IGFjdGlvbi5wbGF5ZXIsIHBsYXk6IGFjdGlvbi5wbGF5IH0sXG4gICAgICBdO1xuXG4gICAgICBjb25zdCBwZW5kaW5nUGljayA9IHtcbiAgICAgICAgb2ZmZW5zZVBsYXk6IGlzT2ZmZW5zaXZlQ2FsbCA/IGFjdGlvbi5wbGF5IDogc3RhdGUucGVuZGluZ1BpY2sub2ZmZW5zZVBsYXksXG4gICAgICAgIGRlZmVuc2VQbGF5OiBpc09mZmVuc2l2ZUNhbGwgPyBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA6IGFjdGlvbi5wbGF5LFxuICAgICAgfTtcblxuICAgICAgLy8gQm90aCB0ZWFtcyBoYXZlIHBpY2tlZCBcdTIwMTQgcmVzb2x2ZS5cbiAgICAgIGlmIChwZW5kaW5nUGljay5vZmZlbnNlUGxheSAmJiBwZW5kaW5nUGljay5kZWZlbnNlUGxheSkge1xuICAgICAgICAvLyAyLXBvaW50IGNvbnZlcnNpb246IFBJQ0tfUExBWSBpbiBUV09fUFRfQ09OViBwaGFzZSByb3V0ZXMgdG8gdGhlXG4gICAgICAgIC8vIGRlZGljYXRlZCAyLXB0IHJlc29sdmVyIChzY29yaW5nIGNhcHBlZCBhdCAyIHB0cywgbm8gUEFUIGN5Y2xlKS5cbiAgICAgICAgLy8gVFAvSE0gb24gYSAyLXB0IHRyeSBhcmUgY29lcmNlZCB0byBTUiBzbyB0aGV5IGNhbid0IG1pcy1zY29yZTpcbiAgICAgICAgLy8gb3RoZXJ3aXNlIGEgVFAgdGhhdCBkZWZhdWx0cyB0byBMUiBhbmQgY3Jvc3NlcyB0aGUgZ29hbCBsaW5lIHdvdWxkXG4gICAgICAgIC8vIHJ1biB0aHJvdWdoIGFwcGx5WWFyZGFnZU91dGNvbWUgYW5kIGVtaXQgVE9VQ0hET1dOICsgdHJhbnNpdGlvbiB0b1xuICAgICAgICAvLyBQQVRfQ0hPSUNFLCBncmFudGluZyA2IHBvaW50cyBhbmQgYSBmdWxsIFBBVCBpbnN0ZWFkIG9mIDIuXG4gICAgICAgIGlmIChzdGF0ZS5waGFzZSA9PT0gXCJUV09fUFRfQ09OVlwiKSB7XG4gICAgICAgICAgY29uc3Qgb2ZmUGxheSA9IGlzUmVndWxhclBsYXkocGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkpXG4gICAgICAgICAgICA/IHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5XG4gICAgICAgICAgICA6IFwiU1JcIjtcbiAgICAgICAgICBjb25zdCBkZWZQbGF5ID0gaXNSZWd1bGFyUGxheShwZW5kaW5nUGljay5kZWZlbnNlUGxheSlcbiAgICAgICAgICAgID8gcGVuZGluZ1BpY2suZGVmZW5zZVBsYXlcbiAgICAgICAgICAgIDogXCJTUlwiO1xuICAgICAgICAgIGNvbnN0IHN0YXRlV2l0aFBpY2s6IEdhbWVTdGF0ZSA9IHtcbiAgICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgICAgcGVuZGluZ1BpY2s6IHsgb2ZmZW5zZVBsYXk6IG9mZlBsYXksIGRlZmVuc2VQbGF5OiBkZWZQbGF5IH0sXG4gICAgICAgICAgfTtcbiAgICAgICAgICBjb25zdCB0cCA9IHJlc29sdmVUd29Qb2ludENvbnZlcnNpb24oXG4gICAgICAgICAgICBzdGF0ZVdpdGhQaWNrLFxuICAgICAgICAgICAgb2ZmUGxheSxcbiAgICAgICAgICAgIGRlZlBsYXksXG4gICAgICAgICAgICBybmcsXG4gICAgICAgICAgKTtcbiAgICAgICAgICByZXR1cm4geyBzdGF0ZTogdHAuc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4udHAuZXZlbnRzXSB9O1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc3RhdGVXaXRoUGljazogR2FtZVN0YXRlID0geyAuLi5zdGF0ZSwgcGVuZGluZ1BpY2sgfTtcblxuICAgICAgICAvLyBIYWlsIE1hcnkgYnkgb2ZmZW5zZSBcdTIwMTQgcmVzb2x2ZXMgaW1tZWRpYXRlbHksIGRlZmVuc2UgcGljayBpZ25vcmVkLlxuICAgICAgICBpZiAocGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPT09IFwiSE1cIikge1xuICAgICAgICAgIGNvbnN0IGhtID0gcmVzb2x2ZUhhaWxNYXJ5KHN0YXRlV2l0aFBpY2ssIHJuZyk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IGhtLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLmhtLmV2ZW50c10gfTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFRyaWNrIFBsYXkgYnkgZWl0aGVyIHNpZGUuIHY1LjEgKHJ1bi5qczoxODg2KTogaWYgYm90aCBwaWNrIFRQLFxuICAgICAgICAvLyBTYW1lIFBsYXkgY29pbiBhbHdheXMgdHJpZ2dlcnMgXHUyMDE0IGZhbGxzIHRocm91Z2ggdG8gU2FtZSBQbGF5IGJlbG93LlxuICAgICAgICBpZiAoXG4gICAgICAgICAgcGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPT09IFwiVFBcIiAmJlxuICAgICAgICAgIHBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5ICE9PSBcIlRQXCJcbiAgICAgICAgKSB7XG4gICAgICAgICAgY29uc3QgdHAgPSByZXNvbHZlT2ZmZW5zaXZlVHJpY2tQbGF5KHN0YXRlV2l0aFBpY2ssIHJuZyk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHRwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLnRwLmV2ZW50c10gfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoXG4gICAgICAgICAgcGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgPT09IFwiVFBcIiAmJlxuICAgICAgICAgIHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ICE9PSBcIlRQXCJcbiAgICAgICAgKSB7XG4gICAgICAgICAgY29uc3QgdHAgPSByZXNvbHZlRGVmZW5zaXZlVHJpY2tQbGF5KHN0YXRlV2l0aFBpY2ssIHJuZyk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHRwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLnRwLmV2ZW50c10gfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPT09IFwiVFBcIiAmJiBwZW5kaW5nUGljay5kZWZlbnNlUGxheSA9PT0gXCJUUFwiKSB7XG4gICAgICAgICAgLy8gQm90aCBUUCBcdTIxOTIgU2FtZSBQbGF5IHVuY29uZGl0aW9uYWxseS5cbiAgICAgICAgICBjb25zdCBzcCA9IHJlc29sdmVTYW1lUGxheShzdGF0ZVdpdGhQaWNrLCBybmcpO1xuICAgICAgICAgIHJldHVybiB7IHN0YXRlOiBzcC5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi5zcC5ldmVudHNdIH07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZWd1bGFyIHZzIHJlZ3VsYXIuXG4gICAgICAgIGlmIChcbiAgICAgICAgICBpc1JlZ3VsYXJQbGF5KHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5KSAmJlxuICAgICAgICAgIGlzUmVndWxhclBsYXkocGVuZGluZ1BpY2suZGVmZW5zZVBsYXkpXG4gICAgICAgICkge1xuICAgICAgICAgIC8vIFNhbWUgcGxheT8gNTAvNTAgY2hhbmNlIHRvIHRyaWdnZXIgU2FtZSBQbGF5IG1lY2hhbmlzbS5cbiAgICAgICAgICAvLyBTb3VyY2U6IHJ1bi5qczoxODg2IChgaWYgKHBsMSA9PT0gcGwyKWApLlxuICAgICAgICAgIGlmIChwZW5kaW5nUGljay5vZmZlbnNlUGxheSA9PT0gcGVuZGluZ1BpY2suZGVmZW5zZVBsYXkpIHtcbiAgICAgICAgICAgIGNvbnN0IHRyaWdnZXIgPSBybmcuY29pbkZsaXAoKTtcbiAgICAgICAgICAgIGlmICh0cmlnZ2VyID09PSBcImhlYWRzXCIpIHtcbiAgICAgICAgICAgICAgY29uc3Qgc3AgPSByZXNvbHZlU2FtZVBsYXkoc3RhdGVXaXRoUGljaywgcm5nKTtcbiAgICAgICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHNwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLnNwLmV2ZW50c10gfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIFRhaWxzOiBmYWxsIHRocm91Z2ggdG8gcmVndWxhciByZXNvbHV0aW9uIChxdWFsaXR5IDUgb3V0Y29tZSkuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgcmVzb2x2ZWQgPSByZXNvbHZlUmVndWxhclBsYXkoXG4gICAgICAgICAgICBzdGF0ZVdpdGhQaWNrLFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBvZmZlbnNlUGxheTogcGVuZGluZ1BpY2sub2ZmZW5zZVBsYXksXG4gICAgICAgICAgICAgIGRlZmVuc2VQbGF5OiBwZW5kaW5nUGljay5kZWZlbnNlUGxheSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBybmcsXG4gICAgICAgICAgKTtcbiAgICAgICAgICByZXR1cm4geyBzdGF0ZTogcmVzb2x2ZWQuc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4ucmVzb2x2ZWQuZXZlbnRzXSB9O1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRGVmZW5zaXZlIHRyaWNrIHBsYXksIEZHLCBQVU5ULCBUV09fUFQgcGlja3MgXHUyMDE0IG5vdCByb3V0ZWQgaGVyZSB5ZXQuXG4gICAgICAgIC8vIEZHL1BVTlQvVFdPX1BUIGFyZSBkcml2ZW4gYnkgRk9VUlRIX0RPV05fQ0hPSUNFIC8gUEFUX0NIT0lDRSBhY3Rpb25zLFxuICAgICAgICAvLyBub3QgYnkgUElDS19QTEFZLiBEZWZlbnNpdmUgVFAgaXMgYSBUT0RPLlxuICAgICAgICByZXR1cm4geyBzdGF0ZTogc3RhdGVXaXRoUGljaywgZXZlbnRzIH07XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7IHN0YXRlOiB7IC4uLnN0YXRlLCBwZW5kaW5nUGljayB9LCBldmVudHMgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiQ0FMTF9USU1FT1VUXCI6IHtcbiAgICAgIGNvbnN0IHAgPSBzdGF0ZS5wbGF5ZXJzW2FjdGlvbi5wbGF5ZXJdO1xuICAgICAgaWYgKHAudGltZW91dHMgPD0gMCkgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcbiAgICAgIGNvbnN0IHJlbWFpbmluZyA9IHAudGltZW91dHMgLSAxO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGU6IHtcbiAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICBwbGF5ZXJzOiB7XG4gICAgICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICAgICAgW2FjdGlvbi5wbGF5ZXJdOiB7IC4uLnAsIHRpbWVvdXRzOiByZW1haW5pbmcgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBldmVudHM6IFt7IHR5cGU6IFwiVElNRU9VVF9DQUxMRURcIiwgcGxheWVyOiBhY3Rpb24ucGxheWVyLCByZW1haW5pbmcgfV0sXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJBQ0NFUFRfUEVOQUxUWVwiOlxuICAgIGNhc2UgXCJERUNMSU5FX1BFTkFMVFlcIjpcbiAgICAgIC8vIFBlbmFsdGllcyBhcmUgY2FwdHVyZWQgYXMgZXZlbnRzIGF0IHJlc29sdXRpb24gdGltZSwgYnV0IGFjY2VwdC9kZWNsaW5lXG4gICAgICAvLyBmbG93IHJlcXVpcmVzIHN0YXRlIG5vdCB5ZXQgbW9kZWxlZCAocGVuZGluZyBwZW5hbHR5KS4gVE9ETyB3aGVuXG4gICAgICAvLyBwZW5hbHR5IG1lY2hhbmljcyBhcmUgcG9ydGVkIGZyb20gcnVuLmpzLlxuICAgICAgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcblxuICAgIGNhc2UgXCJQQVRfQ0hPSUNFXCI6IHtcbiAgICAgIGNvbnN0IHNjb3JlciA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gICAgICAvLyAzT1QrIHJlcXVpcmVzIDItcG9pbnQgY29udmVyc2lvbi4gU2lsZW50bHkgc3Vic3RpdHV0ZSBldmVuIGlmIFwia2lja1wiXG4gICAgICAvLyB3YXMgc2VudCAobWF0Y2hlcyB2NS4xJ3MgXCJtdXN0XCIgYmVoYXZpb3IgYXQgcnVuLmpzOjE2NDEpLlxuICAgICAgY29uc3QgZWZmZWN0aXZlQ2hvaWNlID1cbiAgICAgICAgc3RhdGUub3ZlcnRpbWUgJiYgc3RhdGUub3ZlcnRpbWUucGVyaW9kID49IDNcbiAgICAgICAgICA/IFwidHdvX3BvaW50XCJcbiAgICAgICAgICA6IGFjdGlvbi5jaG9pY2U7XG4gICAgICBpZiAoZWZmZWN0aXZlQ2hvaWNlID09PSBcImtpY2tcIikge1xuICAgICAgICAvLyBBc3N1bWUgYXV0b21hdGljIGluIHY1LjEgXHUyMDE0IG5vIG1lY2hhbmljIHJlY29yZGVkIGZvciBQQVQga2lja3MuXG4gICAgICAgIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgICAgICBbc2NvcmVyXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0uc2NvcmUgKyAxIH0sXG4gICAgICAgIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdGF0ZToge1xuICAgICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgZXZlbnRzOiBbeyB0eXBlOiBcIlBBVF9HT09EXCIsIHBsYXllcjogc2NvcmVyIH1dLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgLy8gdHdvX3BvaW50IFx1MjE5MiB0cmFuc2l0aW9uIHRvIFRXT19QVF9DT05WIHBoYXNlOyBhIFBJQ0tfUExBWSByZXNvbHZlcyBpdC5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgcGhhc2U6IFwiVFdPX1BUX0NPTlZcIixcbiAgICAgICAgICBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgYmFsbE9uOiA5NywgZmlyc3REb3duQXQ6IDEwMCwgZG93bjogMSB9LFxuICAgICAgICB9LFxuICAgICAgICBldmVudHM6IFtdLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiRk9VUlRIX0RPV05fQ0hPSUNFXCI6IHtcbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlID09PSBcImdvXCIpIHtcbiAgICAgICAgLy8gTm90aGluZyB0byBkbyBcdTIwMTQgdGhlIG5leHQgUElDS19QTEFZIHdpbGwgcmVzb2x2ZSBub3JtYWxseSBmcm9tIDR0aCBkb3duLlxuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgfVxuICAgICAgaWYgKGFjdGlvbi5jaG9pY2UgPT09IFwicHVudFwiKSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHJlc29sdmVQdW50KHN0YXRlLCBybmcpO1xuICAgICAgICByZXR1cm4geyBzdGF0ZTogcmVzdWx0LnN0YXRlLCBldmVudHM6IHJlc3VsdC5ldmVudHMgfTtcbiAgICAgIH1cbiAgICAgIC8vIGZnXG4gICAgICBjb25zdCByZXN1bHQgPSByZXNvbHZlRmllbGRHb2FsKHN0YXRlLCBybmcpO1xuICAgICAgcmV0dXJuIHsgc3RhdGU6IHJlc3VsdC5zdGF0ZSwgZXZlbnRzOiByZXN1bHQuZXZlbnRzIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIkZPUkZFSVRcIjoge1xuICAgICAgY29uc3Qgd2lubmVyID0gb3BwKGFjdGlvbi5wbGF5ZXIpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGU6IHsgLi4uc3RhdGUsIHBoYXNlOiBcIkdBTUVfT1ZFUlwiIH0sXG4gICAgICAgIGV2ZW50czogW3sgdHlwZTogXCJHQU1FX09WRVJcIiwgd2lubmVyIH1dLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiVElDS19DTE9DS1wiOiB7XG4gICAgICBjb25zdCBwcmV2ID0gc3RhdGUuY2xvY2suc2Vjb25kc1JlbWFpbmluZztcbiAgICAgIGNvbnN0IG5leHQgPSBNYXRoLm1heCgwLCBwcmV2IC0gYWN0aW9uLnNlY29uZHMpO1xuICAgICAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW3sgdHlwZTogXCJDTE9DS19USUNLRURcIiwgc2Vjb25kczogYWN0aW9uLnNlY29uZHMgfV07XG5cbiAgICAgIC8vIFR3by1taW51dGUgd2FybmluZzogY3Jvc3NpbmcgMTIwIHNlY29uZHMgaW4gUTIgb3IgUTQgdHJpZ2dlcnMgYW4gZXZlbnQuXG4gICAgICBpZiAoXG4gICAgICAgIChzdGF0ZS5jbG9jay5xdWFydGVyID09PSAyIHx8IHN0YXRlLmNsb2NrLnF1YXJ0ZXIgPT09IDQpICYmXG4gICAgICAgIHByZXYgPiAxMjAgJiZcbiAgICAgICAgbmV4dCA8PSAxMjBcbiAgICAgICkge1xuICAgICAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFdPX01JTlVURV9XQVJOSU5HXCIgfSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChuZXh0ID09PSAwKSB7XG4gICAgICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJRVUFSVEVSX0VOREVEXCIsIHF1YXJ0ZXI6IHN0YXRlLmNsb2NrLnF1YXJ0ZXIgfSk7XG4gICAgICAgIC8vIFExXHUyMTkyUTIgYW5kIFEzXHUyMTkyUTQ6IHJvbGwgb3ZlciBjbG9jaywgc2FtZSBoYWxmLCBzYW1lIHBvc3Nlc3Npb24gY29udGludWVzLlxuICAgICAgICBpZiAoc3RhdGUuY2xvY2sucXVhcnRlciA9PT0gMSB8fCBzdGF0ZS5jbG9jay5xdWFydGVyID09PSAzKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgICAgICBjbG9jazoge1xuICAgICAgICAgICAgICAgIC4uLnN0YXRlLmNsb2NrLFxuICAgICAgICAgICAgICAgIHF1YXJ0ZXI6IHN0YXRlLmNsb2NrLnF1YXJ0ZXIgKyAxLFxuICAgICAgICAgICAgICAgIHNlY29uZHNSZW1haW5pbmc6IHN0YXRlLmNsb2NrLnF1YXJ0ZXJMZW5ndGhNaW51dGVzICogNjAsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZXZlbnRzLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgLy8gRW5kIG9mIFEyID0gaGFsZnRpbWUuIFE0IGVuZCA9IHJlZ3VsYXRpb24gb3Zlci5cbiAgICAgICAgaWYgKHN0YXRlLmNsb2NrLnF1YXJ0ZXIgPT09IDIpIHtcbiAgICAgICAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiSEFMRl9FTkRFRFwiIH0pO1xuICAgICAgICAgIC8vIFJlY2VpdmVyIG9mIG9wZW5pbmcga2lja29mZiBraWNrcyB0aGUgc2Vjb25kIGhhbGY7IGZsaXAgcG9zc2Vzc2lvbi5cbiAgICAgICAgICBjb25zdCBzZWNvbmRIYWxmUmVjZWl2ZXIgPVxuICAgICAgICAgICAgc3RhdGUub3BlbmluZ1JlY2VpdmVyID09PSBudWxsID8gMSA6IG9wcChzdGF0ZS5vcGVuaW5nUmVjZWl2ZXIpO1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0ZToge1xuICAgICAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgICAgICAgICAgICBjbG9jazoge1xuICAgICAgICAgICAgICAgIC4uLnN0YXRlLmNsb2NrLFxuICAgICAgICAgICAgICAgIHF1YXJ0ZXI6IDMsXG4gICAgICAgICAgICAgICAgc2Vjb25kc1JlbWFpbmluZzogc3RhdGUuY2xvY2sucXVhcnRlckxlbmd0aE1pbnV0ZXMgKiA2MCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IG9wcChzZWNvbmRIYWxmUmVjZWl2ZXIpIH0sXG4gICAgICAgICAgICAgIC8vIFJlZnJlc2ggdGltZW91dHMgZm9yIG5ldyBoYWxmLlxuICAgICAgICAgICAgICBwbGF5ZXJzOiB7XG4gICAgICAgICAgICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgICAgICAgICAgICAxOiB7IC4uLnN0YXRlLnBsYXllcnNbMV0sIHRpbWVvdXRzOiAzIH0sXG4gICAgICAgICAgICAgICAgMjogeyAuLi5zdGF0ZS5wbGF5ZXJzWzJdLCB0aW1lb3V0czogMyB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGV2ZW50cyxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIC8vIFE0IGVuZGVkLlxuICAgICAgICBjb25zdCBwMSA9IHN0YXRlLnBsYXllcnNbMV0uc2NvcmU7XG4gICAgICAgIGNvbnN0IHAyID0gc3RhdGUucGxheWVyc1syXS5zY29yZTtcbiAgICAgICAgaWYgKHAxICE9PSBwMikge1xuICAgICAgICAgIGNvbnN0IHdpbm5lciA9IHAxID4gcDIgPyAxIDogMjtcbiAgICAgICAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiR0FNRV9PVkVSXCIsIHdpbm5lciB9KTtcbiAgICAgICAgICByZXR1cm4geyBzdGF0ZTogeyAuLi5zdGF0ZSwgcGhhc2U6IFwiR0FNRV9PVkVSXCIgfSwgZXZlbnRzIH07XG4gICAgICAgIH1cbiAgICAgICAgLy8gVGllZCBcdTIwMTQgaGVhZCB0byBvdmVydGltZS5cbiAgICAgICAgY29uc3Qgb3RDbG9jayA9IHsgLi4uc3RhdGUuY2xvY2ssIHF1YXJ0ZXI6IDUsIHNlY29uZHNSZW1haW5pbmc6IDAgfTtcbiAgICAgICAgY29uc3Qgb3QgPSBzdGFydE92ZXJ0aW1lKHsgLi4uc3RhdGUsIGNsb2NrOiBvdENsb2NrIH0pO1xuICAgICAgICBldmVudHMucHVzaCguLi5vdC5ldmVudHMpO1xuICAgICAgICByZXR1cm4geyBzdGF0ZTogb3Quc3RhdGUsIGV2ZW50cyB9O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0ZTogeyAuLi5zdGF0ZSwgY2xvY2s6IHsgLi4uc3RhdGUuY2xvY2ssIHNlY29uZHNSZW1haW5pbmc6IG5leHQgfSB9LFxuICAgICAgICBldmVudHMsXG4gICAgICB9O1xuICAgIH1cblxuICAgIGRlZmF1bHQ6IHtcbiAgICAgIC8vIEV4aGF1c3RpdmVuZXNzIGNoZWNrIFx1MjAxNCBhZGRpbmcgYSBuZXcgQWN0aW9uIHZhcmlhbnQgd2l0aG91dCBoYW5kbGluZyBpdFxuICAgICAgLy8gaGVyZSB3aWxsIHByb2R1Y2UgYSBjb21waWxlIGVycm9yLlxuICAgICAgY29uc3QgX2V4aGF1c3RpdmU6IG5ldmVyID0gYWN0aW9uO1xuICAgICAgdm9pZCBfZXhoYXVzdGl2ZTtcbiAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogQ29udmVuaWVuY2UgZm9yIHJlcGxheWluZyBhIHNlcXVlbmNlIG9mIGFjdGlvbnMgXHUyMDE0IHVzZWZ1bCBmb3IgdGVzdHMgYW5kXG4gKiBmb3Igc2VydmVyLXNpZGUgZ2FtZSByZXBsYXkgZnJvbSBhY3Rpb24gbG9nLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVkdWNlTWFueShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgYWN0aW9uczogQWN0aW9uW10sXG4gIHJuZzogUm5nLFxuKTogUmVkdWNlUmVzdWx0IHtcbiAgbGV0IGN1cnJlbnQgPSBzdGF0ZTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG4gIGZvciAoY29uc3QgYWN0aW9uIG9mIGFjdGlvbnMpIHtcbiAgICBjb25zdCByZXN1bHQgPSByZWR1Y2UoY3VycmVudCwgYWN0aW9uLCBybmcpO1xuICAgIGN1cnJlbnQgPSByZXN1bHQuc3RhdGU7XG4gICAgZXZlbnRzLnB1c2goLi4ucmVzdWx0LmV2ZW50cyk7XG4gIH1cbiAgcmV0dXJuIHsgc3RhdGU6IGN1cnJlbnQsIGV2ZW50cyB9O1xufVxuIiwgIi8qKlxuICogUk5HIGFic3RyYWN0aW9uLlxuICpcbiAqIFRoZSBlbmdpbmUgbmV2ZXIgcmVhY2hlcyBmb3IgYE1hdGgucmFuZG9tKClgIGRpcmVjdGx5LiBBbGwgcmFuZG9tbmVzcyBpc1xuICogc291cmNlZCBmcm9tIGFuIGBSbmdgIGluc3RhbmNlIHBhc3NlZCBpbnRvIGByZWR1Y2UoKWAuIFRoaXMgaXMgd2hhdCBtYWtlc1xuICogdGhlIGVuZ2luZSBkZXRlcm1pbmlzdGljIGFuZCB0ZXN0YWJsZS5cbiAqXG4gKiBJbiBwcm9kdWN0aW9uLCB0aGUgU3VwYWJhc2UgRWRnZSBGdW5jdGlvbiBjcmVhdGVzIGEgc2VlZGVkIFJORyBwZXIgZ2FtZVxuICogKHNlZWQgc3RvcmVkIGFsb25nc2lkZSBnYW1lIHN0YXRlKSwgc28gYSBjb21wbGV0ZSBnYW1lIGNhbiBiZSByZXBsYXllZFxuICogZGV0ZXJtaW5pc3RpY2FsbHkgZnJvbSBpdHMgYWN0aW9uIGxvZyBcdTIwMTQgdXNlZnVsIGZvciBidWcgcmVwb3J0cywgcmVjYXBcbiAqIGdlbmVyYXRpb24sIGFuZCBcIndhdGNoIHRoZSBnYW1lIGJhY2tcIiBmZWF0dXJlcy5cbiAqL1xuXG5leHBvcnQgaW50ZXJmYWNlIFJuZyB7XG4gIC8qKiBJbmNsdXNpdmUgYm90aCBlbmRzLiAqL1xuICBpbnRCZXR3ZWVuKG1pbkluY2x1c2l2ZTogbnVtYmVyLCBtYXhJbmNsdXNpdmU6IG51bWJlcik6IG51bWJlcjtcbiAgLyoqIFJldHVybnMgXCJoZWFkc1wiIG9yIFwidGFpbHNcIi4gKi9cbiAgY29pbkZsaXAoKTogXCJoZWFkc1wiIHwgXCJ0YWlsc1wiO1xuICAvKiogUmV0dXJucyAxLTYuICovXG4gIGQ2KCk6IDEgfCAyIHwgMyB8IDQgfCA1IHwgNjtcbn1cblxuLyoqXG4gKiBNdWxiZXJyeTMyIFx1MjAxNCBhIHNtYWxsLCBmYXN0LCB3ZWxsLWRpc3RyaWJ1dGVkIHNlZWRlZCBQUk5HLiBTdWZmaWNpZW50IGZvclxuICogYSBjYXJkLWRyYXdpbmcgZm9vdGJhbGwgZ2FtZTsgbm90IGZvciBjcnlwdG9ncmFwaHkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZWVkZWRSbmcoc2VlZDogbnVtYmVyKTogUm5nIHtcbiAgbGV0IHN0YXRlID0gc2VlZCA+Pj4gMDtcblxuICBjb25zdCBuZXh0ID0gKCk6IG51bWJlciA9PiB7XG4gICAgc3RhdGUgPSAoc3RhdGUgKyAweDZkMmI3OWY1KSA+Pj4gMDtcbiAgICBsZXQgdCA9IHN0YXRlO1xuICAgIHQgPSBNYXRoLmltdWwodCBeICh0ID4+PiAxNSksIHQgfCAxKTtcbiAgICB0IF49IHQgKyBNYXRoLmltdWwodCBeICh0ID4+PiA3KSwgdCB8IDYxKTtcbiAgICByZXR1cm4gKCh0IF4gKHQgPj4+IDE0KSkgPj4+IDApIC8gNDI5NDk2NzI5NjtcbiAgfTtcblxuICByZXR1cm4ge1xuICAgIGludEJldHdlZW4obWluLCBtYXgpIHtcbiAgICAgIHJldHVybiBNYXRoLmZsb29yKG5leHQoKSAqIChtYXggLSBtaW4gKyAxKSkgKyBtaW47XG4gICAgfSxcbiAgICBjb2luRmxpcCgpIHtcbiAgICAgIHJldHVybiBuZXh0KCkgPCAwLjUgPyBcImhlYWRzXCIgOiBcInRhaWxzXCI7XG4gICAgfSxcbiAgICBkNigpIHtcbiAgICAgIHJldHVybiAoTWF0aC5mbG9vcihuZXh0KCkgKiA2KSArIDEpIGFzIDEgfCAyIHwgMyB8IDQgfCA1IHwgNjtcbiAgICB9LFxuICB9O1xufVxuIiwgIi8qKlxuICogUHVyZSBvdXRjb21lLXRhYmxlIGhlbHBlcnMgZm9yIHNwZWNpYWwgcGxheXMuIFRoZXNlIGFyZSBleHRyYWN0ZWRcbiAqIGZyb20gdGhlIGZ1bGwgcmVzb2x2ZXJzIHNvIHRoYXQgY29uc3VtZXJzIChsaWtlIHY1LjEncyBhc3luYyBjb2RlXG4gKiBwYXRocykgY2FuIGxvb2sgdXAgdGhlIHJ1bGUgb3V0Y29tZSB3aXRob3V0IHJ1bm5pbmcgdGhlIGVuZ2luZSdzXG4gKiBzdGF0ZSB0cmFuc2l0aW9uLlxuICpcbiAqIE9uY2UgUGhhc2UgMiBjb2xsYXBzZXMgdGhlIG9yY2hlc3RyYXRvciBpbnRvIGBlbmdpbmUucmVkdWNlYCwgdGhlc2VcbiAqIGhlbHBlcnMgYmVjb21lIGFuIGludGVybmFsIGltcGxlbWVudGF0aW9uIGRldGFpbC4gVW50aWwgdGhlbiwgdGhleVxuICogbGV0IHY1LjEgdXNlIHRoZSBlbmdpbmUgYXMgdGhlIHNvdXJjZSBvZiB0cnV0aCBmb3IgZ2FtZSBydWxlcyB3aGlsZVxuICoga2VlcGluZyBpdHMgaW1wZXJhdGl2ZSBmbG93LlxuICovXG5cbmltcG9ydCB0eXBlIHsgTXVsdGlwbGllckNhcmROYW1lIH0gZnJvbSBcIi4uL3lhcmRhZ2UuanNcIjtcbmltcG9ydCB0eXBlIHsgUGxheWVySWQgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcblxuLy8gLS0tLS0tLS0tLSBTYW1lIFBsYXkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIFNhbWVQbGF5T3V0Y29tZSA9XG4gIHwgeyBraW5kOiBcImJpZ19wbGF5XCI7IGJlbmVmaWNpYXJ5OiBcIm9mZmVuc2VcIiB8IFwiZGVmZW5zZVwiIH1cbiAgfCB7IGtpbmQ6IFwibXVsdGlwbGllclwiOyB2YWx1ZTogbnVtYmVyOyBkcmF3WWFyZHM6IGJvb2xlYW4gfVxuICB8IHsga2luZDogXCJpbnRlcmNlcHRpb25cIiB9XG4gIHwgeyBraW5kOiBcIm5vX2dhaW5cIiB9O1xuXG4vKipcbiAqIHY1LjEncyBTYW1lIFBsYXkgdGFibGUgKHJ1bi5qczoxODk5KS5cbiAqXG4gKiAgIEtpbmcgICAgXHUyMTkyIEJpZyBQbGF5IChvZmZlbnNlIGlmIGhlYWRzLCBkZWZlbnNlIGlmIHRhaWxzKVxuICogICBRdWVlbiArIGhlYWRzIFx1MjE5MiArM3ggbXVsdGlwbGllciAoZHJhdyB5YXJkcylcbiAqICAgUXVlZW4gKyB0YWlscyBcdTIxOTIgMHggbXVsdGlwbGllciAobm8geWFyZHMsIG5vIGdhaW4pXG4gKiAgIEphY2sgICsgaGVhZHMgXHUyMTkyIDB4IG11bHRpcGxpZXJcbiAqICAgSmFjayAgKyB0YWlscyBcdTIxOTIgLTN4IG11bHRpcGxpZXIgKGRyYXcgeWFyZHMpXG4gKiAgIDEwICAgICsgaGVhZHMgXHUyMTkyIElOVEVSQ0VQVElPTlxuICogICAxMCAgICArIHRhaWxzIFx1MjE5MiAwIHlhcmRzIChubyBtZWNoYW5pYylcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbWVQbGF5T3V0Y29tZShcbiAgY2FyZDogTXVsdGlwbGllckNhcmROYW1lLFxuICBjb2luOiBcImhlYWRzXCIgfCBcInRhaWxzXCIsXG4pOiBTYW1lUGxheU91dGNvbWUge1xuICBjb25zdCBoZWFkcyA9IGNvaW4gPT09IFwiaGVhZHNcIjtcbiAgaWYgKGNhcmQgPT09IFwiS2luZ1wiKSByZXR1cm4geyBraW5kOiBcImJpZ19wbGF5XCIsIGJlbmVmaWNpYXJ5OiBoZWFkcyA/IFwib2ZmZW5zZVwiIDogXCJkZWZlbnNlXCIgfTtcbiAgaWYgKGNhcmQgPT09IFwiMTBcIikgcmV0dXJuIGhlYWRzID8geyBraW5kOiBcImludGVyY2VwdGlvblwiIH0gOiB7IGtpbmQ6IFwibm9fZ2FpblwiIH07XG4gIGlmIChjYXJkID09PSBcIlF1ZWVuXCIpIHtcbiAgICByZXR1cm4gaGVhZHNcbiAgICAgID8geyBraW5kOiBcIm11bHRpcGxpZXJcIiwgdmFsdWU6IDMsIGRyYXdZYXJkczogdHJ1ZSB9XG4gICAgICA6IHsga2luZDogXCJtdWx0aXBsaWVyXCIsIHZhbHVlOiAwLCBkcmF3WWFyZHM6IGZhbHNlIH07XG4gIH1cbiAgLy8gSmFja1xuICByZXR1cm4gaGVhZHNcbiAgICA/IHsga2luZDogXCJtdWx0aXBsaWVyXCIsIHZhbHVlOiAwLCBkcmF3WWFyZHM6IGZhbHNlIH1cbiAgICA6IHsga2luZDogXCJtdWx0aXBsaWVyXCIsIHZhbHVlOiAtMywgZHJhd1lhcmRzOiB0cnVlIH07XG59XG5cbi8vIC0tLS0tLS0tLS0gVHJpY2sgUGxheSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgdHlwZSBUcmlja1BsYXlPdXRjb21lID1cbiAgfCB7IGtpbmQ6IFwiYmlnX3BsYXlcIjsgYmVuZWZpY2lhcnk6IFBsYXllcklkIH1cbiAgfCB7IGtpbmQ6IFwicGVuYWx0eVwiOyByYXdZYXJkczogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6IFwibXVsdGlwbGllclwiOyB2YWx1ZTogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6IFwib3ZlcmxheVwiOyBwbGF5OiBcIkxQXCIgfCBcIkxSXCI7IGJvbnVzOiBudW1iZXIgfTtcblxuLyoqXG4gKiB2NS4xJ3MgVHJpY2sgUGxheSB0YWJsZSAocnVuLmpzOjE5ODcpLiBDYWxsZXIgPSBwbGF5ZXIgd2hvIGNhbGxlZCB0aGVcbiAqIFRyaWNrIFBsYXkgKG9mZmVuc2Ugb3IgZGVmZW5zZSkuIERpZSByb2xsIG91dGNvbWVzIChmcm9tIGNhbGxlcidzIFBPVik6XG4gKlxuICogICAxIFx1MjE5MiBvdmVybGF5IExQIHdpdGggKzUgYm9udXMgKHNpZ25zIGZsaXAgZm9yIGRlZmVuc2l2ZSBjYWxsZXIpXG4gKiAgIDIgXHUyMTkyIDE1LXlhcmQgcGVuYWx0eSBvbiBvcHBvbmVudFxuICogICAzIFx1MjE5MiBmaXhlZCAtM3ggbXVsdGlwbGllciwgZHJhdyB5YXJkc1xuICogICA0IFx1MjE5MiBmaXhlZCArNHggbXVsdGlwbGllciwgZHJhdyB5YXJkc1xuICogICA1IFx1MjE5MiBCaWcgUGxheSBmb3IgY2FsbGVyXG4gKiAgIDYgXHUyMTkyIG92ZXJsYXkgTFIgd2l0aCArNSBib251c1xuICpcbiAqIGByYXdZYXJkc2Agb24gcGVuYWx0eSBpcyBzaWduZWQgZnJvbSBvZmZlbnNlIFBPVjogcG9zaXRpdmUgPSBnYWluIGZvclxuICogb2ZmZW5zZSAob2ZmZW5zaXZlIFRyaWNrIFBsYXkgcm9sbD0yKSwgbmVnYXRpdmUgPSBsb3NzIChkZWZlbnNpdmUpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gdHJpY2tQbGF5T3V0Y29tZShcbiAgY2FsbGVyOiBQbGF5ZXJJZCxcbiAgb2ZmZW5zZTogUGxheWVySWQsXG4gIGRpZTogMSB8IDIgfCAzIHwgNCB8IDUgfCA2LFxuKTogVHJpY2tQbGF5T3V0Y29tZSB7XG4gIGNvbnN0IGNhbGxlcklzT2ZmZW5zZSA9IGNhbGxlciA9PT0gb2ZmZW5zZTtcblxuICBpZiAoZGllID09PSA1KSByZXR1cm4geyBraW5kOiBcImJpZ19wbGF5XCIsIGJlbmVmaWNpYXJ5OiBjYWxsZXIgfTtcblxuICBpZiAoZGllID09PSAyKSB7XG4gICAgY29uc3QgcmF3WWFyZHMgPSBjYWxsZXJJc09mZmVuc2UgPyAxNSA6IC0xNTtcbiAgICByZXR1cm4geyBraW5kOiBcInBlbmFsdHlcIiwgcmF3WWFyZHMgfTtcbiAgfVxuXG4gIGlmIChkaWUgPT09IDMpIHJldHVybiB7IGtpbmQ6IFwibXVsdGlwbGllclwiLCB2YWx1ZTogLTMgfTtcbiAgaWYgKGRpZSA9PT0gNCkgcmV0dXJuIHsga2luZDogXCJtdWx0aXBsaWVyXCIsIHZhbHVlOiA0IH07XG5cbiAgLy8gZGllIDEgb3IgNlxuICBjb25zdCBwbGF5ID0gZGllID09PSAxID8gXCJMUFwiIDogXCJMUlwiO1xuICBjb25zdCBib251cyA9IGNhbGxlcklzT2ZmZW5zZSA/IDUgOiAtNTtcbiAgcmV0dXJuIHsga2luZDogXCJvdmVybGF5XCIsIHBsYXksIGJvbnVzIH07XG59XG5cbi8vIC0tLS0tLS0tLS0gQmlnIFBsYXkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgdHlwZSBCaWdQbGF5T3V0Y29tZSA9XG4gIHwgeyBraW5kOiBcIm9mZmVuc2VfZ2FpblwiOyB5YXJkczogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6IFwib2ZmZW5zZV90ZFwiIH1cbiAgfCB7IGtpbmQ6IFwiZGVmZW5zZV9wZW5hbHR5XCI7IHJhd1lhcmRzOiBudW1iZXIgfVxuICB8IHsga2luZDogXCJkZWZlbnNlX2Z1bWJsZV9yZXR1cm5cIjsgeWFyZHM6IG51bWJlciB9XG4gIHwgeyBraW5kOiBcImRlZmVuc2VfZnVtYmxlX3RkXCIgfTtcblxuLyoqXG4gKiB2NS4xJ3MgQmlnIFBsYXkgdGFibGUgKHJ1bi5qczoxOTMzKS4gYmVuZWZpY2lhcnkgPSB3aG8gYmVuZWZpdHNcbiAqIChvZmZlbnNlIG9yIGRlZmVuc2UpLlxuICpcbiAqIE9mZmVuc2U6XG4gKiAgIDEtMyBcdTIxOTIgKzI1IHlhcmRzXG4gKiAgIDQtNSBcdTIxOTIgbWF4KGhhbGYtdG8tZ29hbCwgNDApXG4gKiAgIDYgICBcdTIxOTIgVERcbiAqIERlZmVuc2U6XG4gKiAgIDEtMyBcdTIxOTIgMTAteWFyZCBwZW5hbHR5IG9uIG9mZmVuc2UgKHJlcGVhdCBkb3duKVxuICogICA0LTUgXHUyMTkyIGZ1bWJsZSwgZGVmZW5zZSByZXR1cm5zIG1heChoYWxmLXRvLWdvYWwsIDI1KVxuICogICA2ICAgXHUyMTkyIGZ1bWJsZSwgZGVmZW5zaXZlIFREXG4gKi9cbi8vIC0tLS0tLS0tLS0gUHVudCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBQdW50IHJldHVybiBtdWx0aXBsaWVyIGJ5IGRyYXduIG11bHRpcGxpZXIgY2FyZCAocnVuLmpzOjIxOTYpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHB1bnRSZXR1cm5NdWx0aXBsaWVyKGNhcmQ6IE11bHRpcGxpZXJDYXJkTmFtZSk6IG51bWJlciB7XG4gIHN3aXRjaCAoY2FyZCkge1xuICAgIGNhc2UgXCJLaW5nXCI6IHJldHVybiA3O1xuICAgIGNhc2UgXCJRdWVlblwiOiByZXR1cm4gNDtcbiAgICBjYXNlIFwiSmFja1wiOiByZXR1cm4gMTtcbiAgICBjYXNlIFwiMTBcIjogcmV0dXJuIC0wLjU7XG4gIH1cbn1cblxuLyoqXG4gKiBQdW50IGtpY2sgZGlzdGFuY2UgZm9ybXVsYSAocnVuLmpzOjIxNDMpOlxuICogICAxMCAqIHlhcmRzQ2FyZCAvIDIgKyAyMCAqIChjb2luID09PSBcImhlYWRzXCIgPyAxIDogMClcbiAqIHlhcmRzQ2FyZCBpcyB0aGUgMS0xMCBjYXJkLiBSYW5nZTogNS03MCB5YXJkcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHB1bnRLaWNrRGlzdGFuY2UoeWFyZHNDYXJkOiBudW1iZXIsIGNvaW46IFwiaGVhZHNcIiB8IFwidGFpbHNcIik6IG51bWJlciB7XG4gIHJldHVybiAoMTAgKiB5YXJkc0NhcmQpIC8gMiArIChjb2luID09PSBcImhlYWRzXCIgPyAyMCA6IDApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYmlnUGxheU91dGNvbWUoXG4gIGJlbmVmaWNpYXJ5OiBQbGF5ZXJJZCxcbiAgb2ZmZW5zZTogUGxheWVySWQsXG4gIGRpZTogMSB8IDIgfCAzIHwgNCB8IDUgfCA2LFxuICAvKiogYmFsbE9uIGZyb20gb2ZmZW5zZSBQT1YgKDAtMTAwKS4gKi9cbiAgYmFsbE9uOiBudW1iZXIsXG4pOiBCaWdQbGF5T3V0Y29tZSB7XG4gIGNvbnN0IGJlbmVmaXRzT2ZmZW5zZSA9IGJlbmVmaWNpYXJ5ID09PSBvZmZlbnNlO1xuXG4gIGlmIChiZW5lZml0c09mZmVuc2UpIHtcbiAgICBpZiAoZGllID09PSA2KSByZXR1cm4geyBraW5kOiBcIm9mZmVuc2VfdGRcIiB9O1xuICAgIGlmIChkaWUgPD0gMykgcmV0dXJuIHsga2luZDogXCJvZmZlbnNlX2dhaW5cIiwgeWFyZHM6IDI1IH07XG4gICAgY29uc3QgaGFsZlRvR29hbCA9IE1hdGgucm91bmQoKDEwMCAtIGJhbGxPbikgLyAyKTtcbiAgICByZXR1cm4geyBraW5kOiBcIm9mZmVuc2VfZ2FpblwiLCB5YXJkczogaGFsZlRvR29hbCA+IDQwID8gaGFsZlRvR29hbCA6IDQwIH07XG4gIH1cblxuICAvLyBEZWZlbnNlIGJlbmVmaWNpYXJ5XG4gIGlmIChkaWUgPD0gMykge1xuICAgIGNvbnN0IHJhd1lhcmRzID0gYmFsbE9uIC0gMTAgPCAxID8gLU1hdGguZmxvb3IoYmFsbE9uIC8gMikgOiAtMTA7XG4gICAgcmV0dXJuIHsga2luZDogXCJkZWZlbnNlX3BlbmFsdHlcIiwgcmF3WWFyZHMgfTtcbiAgfVxuICBpZiAoZGllID09PSA2KSByZXR1cm4geyBraW5kOiBcImRlZmVuc2VfZnVtYmxlX3RkXCIgfTtcbiAgY29uc3QgaGFsZlRvR29hbCA9IE1hdGgucm91bmQoKDEwMCAtIGJhbGxPbikgLyAyKTtcbiAgcmV0dXJuIHsga2luZDogXCJkZWZlbnNlX2Z1bWJsZV9yZXR1cm5cIiwgeWFyZHM6IGhhbGZUb0dvYWwgPiAyNSA/IGhhbGZUb0dvYWwgOiAyNSB9O1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQW9CQSxJQUFNLGFBQXlCLENBQUMsTUFBTSxNQUFNLElBQUk7QUFDaEQsSUFBTSxlQUE2QixDQUFDLE1BQU0sTUFBTSxJQUFJO0FBRXBELElBQU0sY0FBYyxvQkFBSSxJQUFJLENBQUMsWUFBWSxXQUFXLGFBQWEsQ0FBQztBQUUzRCxTQUFTLGVBQWUsT0FBa0IsUUFBK0I7QUFDOUUsVUFBUSxPQUFPLE1BQU07QUFBQSxJQUNuQixLQUFLO0FBQ0gsVUFBSSxNQUFNLFVBQVUsT0FBUSxRQUFPO0FBQ25DLFVBQUksT0FBTyxPQUFPLHlCQUF5QixTQUFVLFFBQU87QUFDNUQsVUFBSSxPQUFPLHVCQUF1QixLQUFLLE9BQU8sdUJBQXVCLElBQUk7QUFDdkUsZUFBTztBQUFBLE1B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RUFBRyxRQUFPLEVBQUUsTUFBTSxjQUFjLE9BQU8sRUFBRTtBQUdyRCxRQUFNLE9BQU8sUUFBUSxJQUFJLE9BQU87QUFDaEMsUUFBTSxRQUFRLGtCQUFrQixJQUFJO0FBQ3BDLFNBQU8sRUFBRSxNQUFNLFdBQVcsTUFBTSxNQUFNO0FBQ3hDO0FBMkJPLFNBQVMscUJBQXFCLE1BQWtDO0FBQ3JFLFVBQVEsTUFBTTtBQUFBLElBQ1osS0FBSztBQUFRLGFBQU87QUFBQSxJQUNwQixLQUFLO0FBQVMsYUFBTztBQUFBLElBQ3JCLEtBQUs7QUFBUSxhQUFPO0FBQUEsSUFDcEIsS0FBSztBQUFNLGFBQU87QUFBQSxFQUNwQjtBQUNGO0FBT08sU0FBUyxpQkFBaUIsV0FBbUIsTUFBaUM7QUFDbkYsU0FBUSxLQUFLLFlBQWEsS0FBSyxTQUFTLFVBQVUsS0FBSztBQUN6RDtBQUVPLFNBQVMsZUFDZCxhQUNBLFNBQ0EsS0FFQSxRQUNnQjtBQUNoQixRQUFNLGtCQUFrQixnQkFBZ0I7QUFFeEMsTUFBSSxpQkFBaUI7QUFDbkIsUUFBSSxRQUFRLEVBQUcsUUFBTyxFQUFFLE1BQU0sYUFBYTtBQUMzQyxRQUFJLE9BQU8sRUFBRyxRQUFPLEVBQUUsTUFBTSxnQkFBZ0IsT0FBTyxHQUFHO0FBQ3ZELFVBQU1DLGNBQWEsS0FBSyxPQUFPLE1BQU0sVUFBVSxDQUFDO0FBQ2hELFdBQU8sRUFBRSxNQUFNLGdCQUFnQixPQUFPQSxjQUFhLEtBQUtBLGNBQWEsR0FBRztBQUFBLEVBQzFFO0FBR0EsTUFBSSxPQUFPLEdBQUc7QUFDWixVQUFNLFdBQVcsU0FBUyxLQUFLLElBQUksQ0FBQyxLQUFLLE1BQU0sU0FBUyxDQUFDLElBQUk7QUFDN0QsV0FBTyxFQUFFLE1BQU0sbUJBQW1CLFNBQVM7QUFBQSxFQUM3QztBQUNBLE1BQUksUUFBUSxFQUFHLFFBQU8sRUFBRSxNQUFNLG9CQUFvQjtBQUNsRCxRQUFNLGFBQWEsS0FBSyxPQUFPLE1BQU0sVUFBVSxDQUFDO0FBQ2hELFNBQU8sRUFBRSxNQUFNLHlCQUF5QixPQUFPLGFBQWEsS0FBSyxhQUFhLEdBQUc7QUFDbkY7IiwKICAibmFtZXMiOiBbImJsYW5rUGljayIsICJibGFua1BpY2siLCAiaGFsZlRvR29hbCIsICJibGFua1BpY2siLCAiYmxhbmtQaWNrIiwgImJsYW5rUGljayIsICJibGFua1BpY2siLCAiYmxhbmtQaWNrIiwgIm11bHRpcGxpZXIiLCAieWFyZHNEcmF3IiwgInlhcmRzIiwgImJsYW5rUGljayIsICJibGFua1BpY2siLCAic3RhdGVXaXRoUGljayIsICJyZXN1bHQiLCAiaGFsZlRvR29hbCJdCn0K
