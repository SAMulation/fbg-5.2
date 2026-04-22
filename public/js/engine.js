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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9zdGF0ZS50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL21hdGNodXAudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy95YXJkYWdlLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvZGVjay50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3BsYXkudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9zaGFyZWQudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9iaWdQbGF5LnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvcHVudC50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL2tpY2tvZmYudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9oYWlsTWFyeS50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL3NhbWVQbGF5LnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvdHJpY2tQbGF5LnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvZmllbGRHb2FsLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvdHdvUG9pbnQudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9vdmVydGltZS50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3JlZHVjZXIudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ybmcudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9vdXRjb21lcy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLyoqXG4gKiBTdGF0ZSBmYWN0b3JpZXMuXG4gKlxuICogYGluaXRpYWxTdGF0ZSgpYCBwcm9kdWNlcyBhIGZyZXNoIEdhbWVTdGF0ZSBpbiBJTklUIHBoYXNlLiBFdmVyeXRoaW5nIGVsc2VcbiAqIGZsb3dzIGZyb20gcmVkdWNpbmcgYWN0aW9ucyBvdmVyIHRoaXMgc3RhcnRpbmcgcG9pbnQuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIEhhbmQsIFBsYXllcklkLCBTdGF0cywgVGVhbVJlZiB9IGZyb20gXCIuL3R5cGVzLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBlbXB0eUhhbmQoaXNPdmVydGltZSA9IGZhbHNlKTogSGFuZCB7XG4gIHJldHVybiB7XG4gICAgU1I6IDMsXG4gICAgTFI6IDMsXG4gICAgU1A6IDMsXG4gICAgTFA6IDMsXG4gICAgVFA6IDEsXG4gICAgSE06IGlzT3ZlcnRpbWUgPyAyIDogMyxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGVtcHR5U3RhdHMoKTogU3RhdHMge1xuICByZXR1cm4geyBwYXNzWWFyZHM6IDAsIHJ1c2hZYXJkczogMCwgdHVybm92ZXJzOiAwLCBzYWNrczogMCB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZnJlc2hEZWNrTXVsdGlwbGllcnMoKTogW251bWJlciwgbnVtYmVyLCBudW1iZXIsIG51bWJlcl0ge1xuICByZXR1cm4gWzQsIDQsIDQsIDNdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZnJlc2hEZWNrWWFyZHMoKTogbnVtYmVyW10ge1xuICByZXR1cm4gWzEsIDEsIDEsIDEsIDEsIDEsIDEsIDEsIDEsIDFdO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEluaXRpYWxTdGF0ZUFyZ3Mge1xuICB0ZWFtMTogVGVhbVJlZjtcbiAgdGVhbTI6IFRlYW1SZWY7XG4gIHF1YXJ0ZXJMZW5ndGhNaW51dGVzOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpbml0aWFsU3RhdGUoYXJnczogSW5pdGlhbFN0YXRlQXJncyk6IEdhbWVTdGF0ZSB7XG4gIHJldHVybiB7XG4gICAgcGhhc2U6IFwiSU5JVFwiLFxuICAgIHNjaGVtYVZlcnNpb246IDEsXG4gICAgY2xvY2s6IHtcbiAgICAgIHF1YXJ0ZXI6IDAsXG4gICAgICBzZWNvbmRzUmVtYWluaW5nOiBhcmdzLnF1YXJ0ZXJMZW5ndGhNaW51dGVzICogNjAsXG4gICAgICBxdWFydGVyTGVuZ3RoTWludXRlczogYXJncy5xdWFydGVyTGVuZ3RoTWludXRlcyxcbiAgICB9LFxuICAgIGZpZWxkOiB7XG4gICAgICBiYWxsT246IDM1LFxuICAgICAgZmlyc3REb3duQXQ6IDQ1LFxuICAgICAgZG93bjogMSxcbiAgICAgIG9mZmVuc2U6IDEsXG4gICAgfSxcbiAgICBkZWNrOiB7XG4gICAgICBtdWx0aXBsaWVyczogZnJlc2hEZWNrTXVsdGlwbGllcnMoKSxcbiAgICAgIHlhcmRzOiBmcmVzaERlY2tZYXJkcygpLFxuICAgIH0sXG4gICAgcGxheWVyczoge1xuICAgICAgMToge1xuICAgICAgICB0ZWFtOiBhcmdzLnRlYW0xLFxuICAgICAgICBzY29yZTogMCxcbiAgICAgICAgdGltZW91dHM6IDMsXG4gICAgICAgIGhhbmQ6IGVtcHR5SGFuZCgpLFxuICAgICAgICBzdGF0czogZW1wdHlTdGF0cygpLFxuICAgICAgfSxcbiAgICAgIDI6IHtcbiAgICAgICAgdGVhbTogYXJncy50ZWFtMixcbiAgICAgICAgc2NvcmU6IDAsXG4gICAgICAgIHRpbWVvdXRzOiAzLFxuICAgICAgICBoYW5kOiBlbXB0eUhhbmQoKSxcbiAgICAgICAgc3RhdHM6IGVtcHR5U3RhdHMoKSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBvcGVuaW5nUmVjZWl2ZXI6IG51bGwsXG4gICAgb3ZlcnRpbWU6IG51bGwsXG4gICAgcGVuZGluZ1BpY2s6IHsgb2ZmZW5zZVBsYXk6IG51bGwsIGRlZmVuc2VQbGF5OiBudWxsIH0sXG4gICAgbGFzdFBsYXlEZXNjcmlwdGlvbjogXCJTdGFydCBvZiBnYW1lXCIsXG4gICAgaXNTYWZldHlLaWNrOiBmYWxzZSxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG9wcChwOiBQbGF5ZXJJZCk6IFBsYXllcklkIHtcbiAgcmV0dXJuIHAgPT09IDEgPyAyIDogMTtcbn1cbiIsICIvKipcbiAqIFRoZSBwbGF5IG1hdGNodXAgbWF0cml4IFx1MjAxNCB0aGUgaGVhcnQgb2YgRm9vdEJvcmVkLlxuICpcbiAqIEJvdGggdGVhbXMgcGljayBhIHBsYXkuIFRoZSBtYXRyaXggc2NvcmVzIGhvdyAqY2xvc2VseSogdGhlIGRlZmVuc2VcbiAqIHByZWRpY3RlZCB0aGUgb2ZmZW5zaXZlIGNhbGw6XG4gKiAgIC0gMSA9IGRlZmVuc2Ugd2F5IG9mZiBcdTIxOTIgZ3JlYXQgZm9yIG9mZmVuc2VcbiAqICAgLSA1ID0gZGVmZW5zZSBtYXRjaGVkIFx1MjE5MiB0ZXJyaWJsZSBmb3Igb2ZmZW5zZSAoY29tYmluZWQgd2l0aCBhIGxvd1xuICogICAgICAgICBtdWx0aXBsaWVyIGNhcmQsIHRoaXMgYmVjb21lcyBhIGxvc3MgLyB0dXJub3ZlciByaXNrKVxuICpcbiAqIFJvd3MgPSBvZmZlbnNpdmUgY2FsbCwgQ29scyA9IGRlZmVuc2l2ZSBjYWxsLiBPcmRlcjogW1NSLCBMUiwgU1AsIExQXS5cbiAqXG4gKiAgICAgICAgICAgREVGOiBTUiAgTFIgIFNQICBMUFxuICogICBPRkY6IFNSICAgICBbIDUsICAzLCAgMywgIDIgXVxuICogICBPRkY6IExSICAgICBbIDIsICA0LCAgMSwgIDIgXVxuICogICBPRkY6IFNQICAgICBbIDMsICAyLCAgNSwgIDMgXVxuICogICBPRkY6IExQICAgICBbIDEsICAyLCAgMiwgIDQgXVxuICpcbiAqIFBvcnRlZCB2ZXJiYXRpbSBmcm9tIHB1YmxpYy9qcy9kZWZhdWx0cy5qcyBNQVRDSFVQLiBJbmRleGluZyBjb25maXJtZWRcbiAqIGFnYWluc3QgcGxheU1lY2hhbmlzbSAvIGNhbGNUaW1lcyBpbiBydW4uanM6MjM2OC5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IFJlZ3VsYXJQbGF5IH0gZnJvbSBcIi4uL3R5cGVzLmpzXCI7XG5cbmV4cG9ydCBjb25zdCBNQVRDSFVQOiBSZWFkb25seUFycmF5PFJlYWRvbmx5QXJyYXk8TWF0Y2h1cFF1YWxpdHk+PiA9IFtcbiAgWzUsIDMsIDMsIDJdLFxuICBbMiwgNCwgMSwgMl0sXG4gIFszLCAyLCA1LCAzXSxcbiAgWzEsIDIsIDIsIDRdLFxuXSBhcyBjb25zdDtcblxuZXhwb3J0IHR5cGUgTWF0Y2h1cFF1YWxpdHkgPSAxIHwgMiB8IDMgfCA0IHwgNTtcblxuY29uc3QgUExBWV9JTkRFWDogUmVjb3JkPFJlZ3VsYXJQbGF5LCAwIHwgMSB8IDIgfCAzPiA9IHtcbiAgU1I6IDAsXG4gIExSOiAxLFxuICBTUDogMixcbiAgTFA6IDMsXG59O1xuXG4vKipcbiAqIE11bHRpcGxpZXIgY2FyZCB2YWx1ZXMuIEluZGV4aW5nIChjb25maXJtZWQgaW4gcnVuLmpzOjIzNzcpOlxuICogICByb3cgICAgPSBtdWx0aXBsaWVyIGNhcmQgKDA9S2luZywgMT1RdWVlbiwgMj1KYWNrLCAzPTEwKVxuICogICBjb2x1bW4gPSBtYXRjaHVwIHF1YWxpdHkgLSAxIChzbyBjb2x1bW4gMCA9IHF1YWxpdHkgMSwgY29sdW1uIDQgPSBxdWFsaXR5IDUpXG4gKlxuICogUXVhbGl0eSAxIChvZmZlbnNlIG91dGd1ZXNzZWQgZGVmZW5zZSkgKyBLaW5nID0gNHguIEJlc3QgcG9zc2libGUgcGxheS5cbiAqIFF1YWxpdHkgNSAoZGVmZW5zZSBtYXRjaGVkKSArIDEwICAgICAgICA9IC0xeC4gV29yc3QgcmVndWxhciBwbGF5LlxuICpcbiAqICAgICAgICAgICAgICAgICAgcXVhbCAxICBxdWFsIDIgIHF1YWwgMyAgcXVhbCA0ICBxdWFsIDVcbiAqICAgS2luZyAgICAoMCkgIFsgICA0LCAgICAgIDMsICAgICAgMiwgICAgIDEuNSwgICAgIDEgICBdXG4gKiAgIFF1ZWVuICAgKDEpICBbICAgMywgICAgICAyLCAgICAgIDEsICAgICAgMSwgICAgIDAuNSAgXVxuICogICBKYWNrICAgICgyKSAgWyAgIDIsICAgICAgMSwgICAgIDAuNSwgICAgIDAsICAgICAgMCAgIF1cbiAqICAgMTAgICAgICAoMykgIFsgICAwLCAgICAgIDAsICAgICAgMCwgICAgIC0xLCAgICAgLTEgICBdXG4gKlxuICogUG9ydGVkIHZlcmJhdGltIGZyb20gcHVibGljL2pzL2RlZmF1bHRzLmpzIE1VTFRJLlxuICovXG5leHBvcnQgY29uc3QgTVVMVEk6IFJlYWRvbmx5QXJyYXk8UmVhZG9ubHlBcnJheTxudW1iZXI+PiA9IFtcbiAgWzQsIDMsIDIsIDEuNSwgMV0sXG4gIFszLCAyLCAxLCAxLCAwLjVdLFxuICBbMiwgMSwgMC41LCAwLCAwXSxcbiAgWzAsIDAsIDAsIC0xLCAtMV0sXG5dIGFzIGNvbnN0O1xuXG5leHBvcnQgZnVuY3Rpb24gbWF0Y2h1cFF1YWxpdHkob2ZmOiBSZWd1bGFyUGxheSwgZGVmOiBSZWd1bGFyUGxheSk6IE1hdGNodXBRdWFsaXR5IHtcbiAgY29uc3Qgcm93ID0gTUFUQ0hVUFtQTEFZX0lOREVYW29mZl1dO1xuICBpZiAoIXJvdykgdGhyb3cgbmV3IEVycm9yKGB1bnJlYWNoYWJsZTogYmFkIG9mZiBwbGF5ICR7b2ZmfWApO1xuICBjb25zdCBxID0gcm93W1BMQVlfSU5ERVhbZGVmXV07XG4gIGlmIChxID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihgdW5yZWFjaGFibGU6IGJhZCBkZWYgcGxheSAke2RlZn1gKTtcbiAgcmV0dXJuIHE7XG59XG4iLCAiLyoqXG4gKiBQdXJlIHlhcmRhZ2UgY2FsY3VsYXRpb24gZm9yIGEgcmVndWxhciBwbGF5IChTUi9MUi9TUC9MUCkuXG4gKlxuICogRm9ybXVsYSAocnVuLmpzOjIzMzcpOlxuICogICB5YXJkcyA9IHJvdW5kKG11bHRpcGxpZXIgKiB5YXJkc0NhcmQpICsgYm9udXNcbiAqXG4gKiBXaGVyZTpcbiAqICAgLSBtdWx0aXBsaWVyID0gTVVMVElbbXVsdGlwbGllckNhcmRdW3F1YWxpdHkgLSAxXVxuICogICAtIHF1YWxpdHkgICAgPSBNQVRDSFVQW29mZmVuc2VdW2RlZmVuc2VdICAgLy8gMS01XG4gKiAgIC0gYm9udXMgICAgICA9IHNwZWNpYWwtcGxheSBib251cyAoZS5nLiBUcmljayBQbGF5ICs1IG9uIExSL0xQIG91dGNvbWVzKVxuICpcbiAqIFNwZWNpYWwgcGxheXMgKFRQLCBITSwgRkcsIFBVTlQsIFRXT19QVCkgdXNlIGRpZmZlcmVudCBmb3JtdWxhcyBcdTIwMTQgdGhleVxuICogbGl2ZSBpbiBydWxlcy9zcGVjaWFsLnRzIChUT0RPKSBhbmQgcHJvZHVjZSBldmVudHMgZGlyZWN0bHkuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBSZWd1bGFyUGxheSB9IGZyb20gXCIuLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgTVVMVEksIG1hdGNodXBRdWFsaXR5IH0gZnJvbSBcIi4vbWF0Y2h1cC5qc1wiO1xuXG5leHBvcnQgdHlwZSBNdWx0aXBsaWVyQ2FyZEluZGV4ID0gMCB8IDEgfCAyIHwgMztcbmV4cG9ydCBjb25zdCBNVUxUSVBMSUVSX0NBUkRfTkFNRVMgPSBbXCJLaW5nXCIsIFwiUXVlZW5cIiwgXCJKYWNrXCIsIFwiMTBcIl0gYXMgY29uc3Q7XG5leHBvcnQgdHlwZSBNdWx0aXBsaWVyQ2FyZE5hbWUgPSAodHlwZW9mIE1VTFRJUExJRVJfQ0FSRF9OQU1FUylbbnVtYmVyXTtcblxuZXhwb3J0IGludGVyZmFjZSBZYXJkYWdlSW5wdXRzIHtcbiAgb2ZmZW5zZTogUmVndWxhclBsYXk7XG4gIGRlZmVuc2U6IFJlZ3VsYXJQbGF5O1xuICAvKiogTXVsdGlwbGllciBjYXJkIGluZGV4OiAwPUtpbmcsIDE9UXVlZW4sIDI9SmFjaywgMz0xMC4gKi9cbiAgbXVsdGlwbGllckNhcmQ6IE11bHRpcGxpZXJDYXJkSW5kZXg7XG4gIC8qKiBZYXJkcyBjYXJkIGRyYXduLCAxLTEwLiAqL1xuICB5YXJkc0NhcmQ6IG51bWJlcjtcbiAgLyoqIEJvbnVzIHlhcmRzIGZyb20gc3BlY2lhbC1wbGF5IG92ZXJsYXlzIChlLmcuIFRyaWNrIFBsYXkgKzUpLiAqL1xuICBib251cz86IG51bWJlcjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBZYXJkYWdlT3V0Y29tZSB7XG4gIG1hdGNodXBRdWFsaXR5OiBudW1iZXI7XG4gIG11bHRpcGxpZXI6IG51bWJlcjtcbiAgbXVsdGlwbGllckNhcmROYW1lOiBNdWx0aXBsaWVyQ2FyZE5hbWU7XG4gIHlhcmRzR2FpbmVkOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjb21wdXRlWWFyZGFnZShpbnB1dHM6IFlhcmRhZ2VJbnB1dHMpOiBZYXJkYWdlT3V0Y29tZSB7XG4gIGNvbnN0IHF1YWxpdHkgPSBtYXRjaHVwUXVhbGl0eShpbnB1dHMub2ZmZW5zZSwgaW5wdXRzLmRlZmVuc2UpO1xuICBjb25zdCBtdWx0aVJvdyA9IE1VTFRJW2lucHV0cy5tdWx0aXBsaWVyQ2FyZF07XG4gIGlmICghbXVsdGlSb3cpIHRocm93IG5ldyBFcnJvcihgdW5yZWFjaGFibGU6IGJhZCBtdWx0aSBjYXJkICR7aW5wdXRzLm11bHRpcGxpZXJDYXJkfWApO1xuICBjb25zdCBtdWx0aXBsaWVyID0gbXVsdGlSb3dbcXVhbGl0eSAtIDFdO1xuICBpZiAobXVsdGlwbGllciA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoYHVucmVhY2hhYmxlOiBiYWQgcXVhbGl0eSAke3F1YWxpdHl9YCk7XG5cbiAgY29uc3QgYm9udXMgPSBpbnB1dHMuYm9udXMgPz8gMDtcbiAgY29uc3QgeWFyZHNHYWluZWQgPSBNYXRoLnJvdW5kKG11bHRpcGxpZXIgKiBpbnB1dHMueWFyZHNDYXJkKSArIGJvbnVzO1xuXG4gIHJldHVybiB7XG4gICAgbWF0Y2h1cFF1YWxpdHk6IHF1YWxpdHksXG4gICAgbXVsdGlwbGllcixcbiAgICBtdWx0aXBsaWVyQ2FyZE5hbWU6IE1VTFRJUExJRVJfQ0FSRF9OQU1FU1tpbnB1dHMubXVsdGlwbGllckNhcmRdLFxuICAgIHlhcmRzR2FpbmVkLFxuICB9O1xufVxuIiwgIi8qKlxuICogQ2FyZC1kZWNrIGRyYXdzIFx1MjAxNCBwdXJlIHZlcnNpb25zIG9mIHY1LjEncyBgR2FtZS5kZWNNdWx0c2AgYW5kIGBHYW1lLmRlY1lhcmRzYC5cbiAqXG4gKiBUaGUgZGVjayBpcyByZXByZXNlbnRlZCBhcyBhbiBhcnJheSBvZiByZW1haW5pbmcgY291bnRzIHBlciBjYXJkIHNsb3QuXG4gKiBUbyBkcmF3LCB3ZSBwaWNrIGEgdW5pZm9ybSByYW5kb20gc2xvdDsgaWYgdGhhdCBzbG90IGlzIGVtcHR5LCB3ZSByZXRyeS5cbiAqIFRoaXMgaXMgbWF0aGVtYXRpY2FsbHkgZXF1aXZhbGVudCB0byBzaHVmZmxpbmcgdGhlIHJlbWFpbmluZyBjYXJkcyBhbmRcbiAqIGRyYXdpbmcgb25lIFx1MjAxNCBhbmQgbWF0Y2hlcyB2NS4xJ3MgYmVoYXZpb3IgdmVyYmF0aW0uXG4gKlxuICogV2hlbiB0aGUgZGVjayBpcyBleGhhdXN0ZWQsIHRoZSBjb25zdW1lciAodGhlIHJlZHVjZXIpIHJlZmlsbHMgaXQgYW5kXG4gKiBlbWl0cyBhIERFQ0tfU0hVRkZMRUQgZXZlbnQuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IERlY2tTdGF0ZSB9IGZyb20gXCIuLi90eXBlcy5qc1wiO1xuaW1wb3J0IHtcbiAgZnJlc2hEZWNrTXVsdGlwbGllcnMsXG4gIGZyZXNoRGVja1lhcmRzLFxufSBmcm9tIFwiLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7XG4gIE1VTFRJUExJRVJfQ0FSRF9OQU1FUyxcbiAgdHlwZSBNdWx0aXBsaWVyQ2FyZEluZGV4LFxuICB0eXBlIE11bHRpcGxpZXJDYXJkTmFtZSxcbn0gZnJvbSBcIi4veWFyZGFnZS5qc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIE11bHRpcGxpZXJEcmF3IHtcbiAgY2FyZDogTXVsdGlwbGllckNhcmROYW1lO1xuICBpbmRleDogTXVsdGlwbGllckNhcmRJbmRleDtcbiAgZGVjazogRGVja1N0YXRlO1xuICByZXNodWZmbGVkOiBib29sZWFuO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZHJhd011bHRpcGxpZXIoZGVjazogRGVja1N0YXRlLCBybmc6IFJuZyk6IE11bHRpcGxpZXJEcmF3IHtcbiAgY29uc3QgbXVsdHMgPSBbLi4uZGVjay5tdWx0aXBsaWVyc10gYXMgW251bWJlciwgbnVtYmVyLCBudW1iZXIsIG51bWJlcl07XG5cbiAgbGV0IGluZGV4OiBNdWx0aXBsaWVyQ2FyZEluZGV4O1xuICAvLyBSZWplY3Rpb24tc2FtcGxlIHRvIGRyYXcgdW5pZm9ybWx5IGFjcm9zcyByZW1haW5pbmcgY2FyZHMuXG4gIC8vIExvb3AgaXMgYm91bmRlZCBcdTIwMTQgdG90YWwgY2FyZHMgaW4gZnJlc2ggZGVjayBpcyAxNS5cbiAgZm9yICg7Oykge1xuICAgIGNvbnN0IGkgPSBybmcuaW50QmV0d2VlbigwLCAzKSBhcyBNdWx0aXBsaWVyQ2FyZEluZGV4O1xuICAgIGlmIChtdWx0c1tpXSA+IDApIHtcbiAgICAgIGluZGV4ID0gaTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIG11bHRzW2luZGV4XS0tO1xuXG4gIGxldCByZXNodWZmbGVkID0gZmFsc2U7XG4gIGxldCBuZXh0RGVjazogRGVja1N0YXRlID0geyAuLi5kZWNrLCBtdWx0aXBsaWVyczogbXVsdHMgfTtcbiAgaWYgKG11bHRzLmV2ZXJ5KChjKSA9PiBjID09PSAwKSkge1xuICAgIHJlc2h1ZmZsZWQgPSB0cnVlO1xuICAgIG5leHREZWNrID0geyAuLi5uZXh0RGVjaywgbXVsdGlwbGllcnM6IGZyZXNoRGVja011bHRpcGxpZXJzKCkgfTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgY2FyZDogTVVMVElQTElFUl9DQVJEX05BTUVTW2luZGV4XSxcbiAgICBpbmRleCxcbiAgICBkZWNrOiBuZXh0RGVjayxcbiAgICByZXNodWZmbGVkLFxuICB9O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFlhcmRzRHJhdyB7XG4gIC8qKiBZYXJkcyBjYXJkIHZhbHVlLCAxLTEwLiAqL1xuICBjYXJkOiBudW1iZXI7XG4gIGRlY2s6IERlY2tTdGF0ZTtcbiAgcmVzaHVmZmxlZDogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRyYXdZYXJkcyhkZWNrOiBEZWNrU3RhdGUsIHJuZzogUm5nKTogWWFyZHNEcmF3IHtcbiAgY29uc3QgeWFyZHMgPSBbLi4uZGVjay55YXJkc107XG5cbiAgbGV0IGluZGV4OiBudW1iZXI7XG4gIGZvciAoOzspIHtcbiAgICBjb25zdCBpID0gcm5nLmludEJldHdlZW4oMCwgeWFyZHMubGVuZ3RoIC0gMSk7XG4gICAgY29uc3Qgc2xvdCA9IHlhcmRzW2ldO1xuICAgIGlmIChzbG90ICE9PSB1bmRlZmluZWQgJiYgc2xvdCA+IDApIHtcbiAgICAgIGluZGV4ID0gaTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIHlhcmRzW2luZGV4XSA9ICh5YXJkc1tpbmRleF0gPz8gMCkgLSAxO1xuXG4gIGxldCByZXNodWZmbGVkID0gZmFsc2U7XG4gIGxldCBuZXh0RGVjazogRGVja1N0YXRlID0geyAuLi5kZWNrLCB5YXJkcyB9O1xuICBpZiAoeWFyZHMuZXZlcnkoKGMpID0+IGMgPT09IDApKSB7XG4gICAgcmVzaHVmZmxlZCA9IHRydWU7XG4gICAgbmV4dERlY2sgPSB7IC4uLm5leHREZWNrLCB5YXJkczogZnJlc2hEZWNrWWFyZHMoKSB9O1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBjYXJkOiBpbmRleCArIDEsXG4gICAgZGVjazogbmV4dERlY2ssXG4gICAgcmVzaHVmZmxlZCxcbiAgfTtcbn1cbiIsICIvKipcbiAqIFJlZ3VsYXItcGxheSByZXNvbHV0aW9uLiBTcGVjaWFsIHBsYXlzIChUUCwgSE0sIEZHLCBQVU5ULCBUV09fUFQpIGJyYW5jaFxuICogZWxzZXdoZXJlIFx1MjAxNCBzZWUgcnVsZXMvc3BlY2lhbC50cyAoVE9ETykuXG4gKlxuICogR2l2ZW4gdHdvIHBpY2tzIChvZmZlbnNlICsgZGVmZW5zZSkgYW5kIHRoZSBjdXJyZW50IHN0YXRlLCBwcm9kdWNlIGEgbmV3XG4gKiBzdGF0ZSBhbmQgdGhlIGV2ZW50IHN0cmVhbSBmb3IgdGhlIHBsYXkuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIFBsYXlDYWxsLCBSZWd1bGFyUGxheSB9IGZyb20gXCIuLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgZHJhd011bHRpcGxpZXIsIGRyYXdZYXJkcyB9IGZyb20gXCIuL2RlY2suanNcIjtcbmltcG9ydCB7IGNvbXB1dGVZYXJkYWdlIH0gZnJvbSBcIi4veWFyZGFnZS5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4uL3N0YXRlLmpzXCI7XG5cbmNvbnN0IFJFR1VMQVI6IFJlYWRvbmx5U2V0PFBsYXlDYWxsPiA9IG5ldyBTZXQoW1wiU1JcIiwgXCJMUlwiLCBcIlNQXCIsIFwiTFBcIl0pO1xuXG5leHBvcnQgZnVuY3Rpb24gaXNSZWd1bGFyUGxheShwOiBQbGF5Q2FsbCk6IHAgaXMgUmVndWxhclBsYXkge1xuICByZXR1cm4gUkVHVUxBUi5oYXMocCk7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVzb2x2ZUlucHV0IHtcbiAgb2ZmZW5zZVBsYXk6IFBsYXlDYWxsO1xuICBkZWZlbnNlUGxheTogUGxheUNhbGw7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGxheVJlc29sdXRpb24ge1xuICBzdGF0ZTogR2FtZVN0YXRlO1xuICBldmVudHM6IEV2ZW50W107XG59XG5cbi8qKlxuICogUmVzb2x2ZSBhIHJlZ3VsYXIgdnMgcmVndWxhciBwbGF5LiBDYWxsZXIgKHRoZSByZWR1Y2VyKSByb3V0ZXMgdG8gc3BlY2lhbFxuICogcGxheSBoYW5kbGVycyBpZiBlaXRoZXIgcGljayBpcyBub24tcmVndWxhci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVSZWd1bGFyUGxheShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgaW5wdXQ6IFJlc29sdmVJbnB1dCxcbiAgcm5nOiBSbmcsXG4pOiBQbGF5UmVzb2x1dGlvbiB7XG4gIGlmICghaXNSZWd1bGFyUGxheShpbnB1dC5vZmZlbnNlUGxheSkgfHwgIWlzUmVndWxhclBsYXkoaW5wdXQuZGVmZW5zZVBsYXkpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwicmVzb2x2ZVJlZ3VsYXJQbGF5IGNhbGxlZCB3aXRoIGEgbm9uLXJlZ3VsYXIgcGxheVwiKTtcbiAgfVxuXG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuXG4gIC8vIERyYXcgY2FyZHMuXG4gIGNvbnN0IG11bHREcmF3ID0gZHJhd011bHRpcGxpZXIoc3RhdGUuZGVjaywgcm5nKTtcbiAgaWYgKG11bHREcmF3LnJlc2h1ZmZsZWQpIHtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcIm11bHRpcGxpZXJcIiB9KTtcbiAgfVxuICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMobXVsdERyYXcuZGVjaywgcm5nKTtcbiAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSB7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuICB9XG5cbiAgLy8gQ29tcHV0ZSB5YXJkYWdlLlxuICBjb25zdCBvdXRjb21lID0gY29tcHV0ZVlhcmRhZ2Uoe1xuICAgIG9mZmVuc2U6IGlucHV0Lm9mZmVuc2VQbGF5LFxuICAgIGRlZmVuc2U6IGlucHV0LmRlZmVuc2VQbGF5LFxuICAgIG11bHRpcGxpZXJDYXJkOiBtdWx0RHJhdy5pbmRleCxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICB9KTtcblxuICAvLyBEZWNyZW1lbnQgb2ZmZW5zZSdzIGhhbmQgZm9yIHRoZSBwbGF5IHRoZXkgdXNlZC4gUmVmaWxsIGF0IHplcm8gXHUyMDE0IHRoZVxuICAvLyBleGFjdCAxMi1jYXJkIHJlc2h1ZmZsZSBiZWhhdmlvciBsaXZlcyBpbiBgZGVjcmVtZW50SGFuZGAuXG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgW29mZmVuc2VdOiBkZWNyZW1lbnRIYW5kKHN0YXRlLnBsYXllcnNbb2ZmZW5zZV0sIGlucHV0Lm9mZmVuc2VQbGF5KSxcbiAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuXG4gIC8vIEFwcGx5IHlhcmRhZ2UgdG8gYmFsbCBwb3NpdGlvbi4gQ2xhbXAgYXQgMTAwIChURCkgYW5kIDAgKHNhZmV0eSkuXG4gIGNvbnN0IHByb2plY3RlZCA9IHN0YXRlLmZpZWxkLmJhbGxPbiArIG91dGNvbWUueWFyZHNHYWluZWQ7XG4gIGxldCBuZXdCYWxsT24gPSBwcm9qZWN0ZWQ7XG4gIGxldCBzY29yZWQ6IFwidGRcIiB8IFwic2FmZXR5XCIgfCBudWxsID0gbnVsbDtcbiAgaWYgKHByb2plY3RlZCA+PSAxMDApIHtcbiAgICBuZXdCYWxsT24gPSAxMDA7XG4gICAgc2NvcmVkID0gXCJ0ZFwiO1xuICB9IGVsc2UgaWYgKHByb2plY3RlZCA8PSAwKSB7XG4gICAgbmV3QmFsbE9uID0gMDtcbiAgICBzY29yZWQgPSBcInNhZmV0eVwiO1xuICB9XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgIG9mZmVuc2VQbGF5OiBpbnB1dC5vZmZlbnNlUGxheSxcbiAgICBkZWZlbnNlUGxheTogaW5wdXQuZGVmZW5zZVBsYXksXG4gICAgbWF0Y2h1cFF1YWxpdHk6IG91dGNvbWUubWF0Y2h1cFF1YWxpdHksXG4gICAgbXVsdGlwbGllcjogeyBjYXJkOiBvdXRjb21lLm11bHRpcGxpZXJDYXJkTmFtZSwgdmFsdWU6IG91dGNvbWUubXVsdGlwbGllciB9LFxuICAgIHlhcmRzQ2FyZDogeWFyZHNEcmF3LmNhcmQsXG4gICAgeWFyZHNHYWluZWQ6IG91dGNvbWUueWFyZHNHYWluZWQsXG4gICAgbmV3QmFsbE9uLFxuICB9KTtcblxuICAvLyBTY29yZSBoYW5kbGluZy5cbiAgaWYgKHNjb3JlZCA9PT0gXCJ0ZFwiKSB7XG4gICAgcmV0dXJuIHRvdWNoZG93blN0YXRlKFxuICAgICAgeyAuLi5zdGF0ZSwgZGVjazogeWFyZHNEcmF3LmRlY2ssIHBsYXllcnM6IG5ld1BsYXllcnMsIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSB9LFxuICAgICAgb2ZmZW5zZSxcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG4gIGlmIChzY29yZWQgPT09IFwic2FmZXR5XCIpIHtcbiAgICByZXR1cm4gc2FmZXR5U3RhdGUoXG4gICAgICB7IC4uLnN0YXRlLCBkZWNrOiB5YXJkc0RyYXcuZGVjaywgcGxheWVyczogbmV3UGxheWVycywgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpIH0sXG4gICAgICBvZmZlbnNlLFxuICAgICAgZXZlbnRzLFxuICAgICk7XG4gIH1cblxuICAvLyBEb3duL2Rpc3RhbmNlIGhhbmRsaW5nLlxuICBjb25zdCByZWFjaGVkRmlyc3REb3duID0gbmV3QmFsbE9uID49IHN0YXRlLmZpZWxkLmZpcnN0RG93bkF0O1xuICBsZXQgbmV4dERvd24gPSBzdGF0ZS5maWVsZC5kb3duO1xuICBsZXQgbmV4dEZpcnN0RG93bkF0ID0gc3RhdGUuZmllbGQuZmlyc3REb3duQXQ7XG4gIGxldCBwb3NzZXNzaW9uRmxpcHBlZCA9IGZhbHNlO1xuXG4gIGlmIChyZWFjaGVkRmlyc3REb3duKSB7XG4gICAgbmV4dERvd24gPSAxO1xuICAgIG5leHRGaXJzdERvd25BdCA9IE1hdGgubWluKDEwMCwgbmV3QmFsbE9uICsgMTApO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJGSVJTVF9ET1dOXCIgfSk7XG4gIH0gZWxzZSBpZiAoc3RhdGUuZmllbGQuZG93biA9PT0gNCkge1xuICAgIC8vIFR1cm5vdmVyIG9uIGRvd25zIFx1MjAxNCBwb3NzZXNzaW9uIGZsaXBzLCBiYWxsIHN0YXlzLlxuICAgIG5leHREb3duID0gMTtcbiAgICBwb3NzZXNzaW9uRmxpcHBlZCA9IHRydWU7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSX09OX0RPV05TXCIgfSk7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJkb3duc1wiIH0pO1xuICB9IGVsc2Uge1xuICAgIG5leHREb3duID0gKHN0YXRlLmZpZWxkLmRvd24gKyAxKSBhcyAxIHwgMiB8IDMgfCA0O1xuICB9XG5cbiAgY29uc3QgbmV4dE9mZmVuc2UgPSBwb3NzZXNzaW9uRmxpcHBlZCA/IG9wcChvZmZlbnNlKSA6IG9mZmVuc2U7XG4gIGNvbnN0IG5leHRCYWxsT24gPSBwb3NzZXNzaW9uRmxpcHBlZCA/IDEwMCAtIG5ld0JhbGxPbiA6IG5ld0JhbGxPbjtcbiAgY29uc3QgbmV4dEZpcnN0RG93biA9IHBvc3Nlc3Npb25GbGlwcGVkXG4gICAgPyBNYXRoLm1pbigxMDAsIG5leHRCYWxsT24gKyAxMClcbiAgICA6IG5leHRGaXJzdERvd25BdDtcblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIGRlY2s6IHlhcmRzRHJhdy5kZWNrLFxuICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogbmV4dEJhbGxPbixcbiAgICAgICAgZmlyc3REb3duQXQ6IG5leHRGaXJzdERvd24sXG4gICAgICAgIGRvd246IG5leHREb3duLFxuICAgICAgICBvZmZlbnNlOiBuZXh0T2ZmZW5zZSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGJsYW5rUGljaygpOiBHYW1lU3RhdGVbXCJwZW5kaW5nUGlja1wiXSB7XG4gIHJldHVybiB7IG9mZmVuc2VQbGF5OiBudWxsLCBkZWZlbnNlUGxheTogbnVsbCB9O1xufVxuXG4vKipcbiAqIFRvdWNoZG93biBib29ra2VlcGluZyBcdTIwMTQgNiBwb2ludHMsIHRyYW5zaXRpb24gdG8gUEFUX0NIT0lDRSBwaGFzZS5cbiAqIChQQVQvMnB0IHJlc29sdXRpb24gYW5kIGVuc3Vpbmcga2lja29mZiBoYXBwZW4gaW4gc3Vic2VxdWVudCBhY3Rpb25zLilcbiAqL1xuZnVuY3Rpb24gdG91Y2hkb3duU3RhdGUoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHNjb3JlcjogR2FtZVN0YXRlW1wiZmllbGRcIl1bXCJvZmZlbnNlXCJdLFxuICBldmVudHM6IEV2ZW50W10sXG4pOiBQbGF5UmVzb2x1dGlvbiB7XG4gIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgLi4uc3RhdGUucGxheWVycyxcbiAgICBbc2NvcmVyXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0uc2NvcmUgKyA2IH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRPVUNIRE9XTlwiLCBzY29yaW5nUGxheWVyOiBzY29yZXIgfSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHsgLi4uc3RhdGUsIHBsYXllcnM6IG5ld1BsYXllcnMsIHBoYXNlOiBcIlBBVF9DSE9JQ0VcIiB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuLyoqXG4gKiBTYWZldHkgXHUyMDE0IGRlZmVuc2Ugc2NvcmVzIDIsIG9mZmVuc2Uga2lja3MgZnJlZSBraWNrLlxuICogRm9yIHRoZSBza2V0Y2ggd2Ugc2NvcmUgYW5kIGVtaXQ7IHRoZSBraWNrb2ZmIHRyYW5zaXRpb24gaXMgVE9ETy5cbiAqL1xuZnVuY3Rpb24gc2FmZXR5U3RhdGUoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIGNvbmNlZGVyOiBHYW1lU3RhdGVbXCJmaWVsZFwiXVtcIm9mZmVuc2VcIl0sXG4gIGV2ZW50czogRXZlbnRbXSxcbik6IFBsYXlSZXNvbHV0aW9uIHtcbiAgY29uc3Qgc2NvcmVyID0gb3BwKGNvbmNlZGVyKTtcbiAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtzY29yZXJdOiB7IC4uLnN0YXRlLnBsYXllcnNbc2NvcmVyXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbc2NvcmVyXS5zY29yZSArIDIgfSxcbiAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiU0FGRVRZXCIsIHNjb3JpbmdQbGF5ZXI6IHNjb3JlciB9KTtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZTogeyAuLi5zdGF0ZSwgcGxheWVyczogbmV3UGxheWVycywgcGhhc2U6IFwiS0lDS09GRlwiIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG4vKipcbiAqIERlY3JlbWVudCB0aGUgY2hvc2VuIHBsYXkgaW4gYSBwbGF5ZXIncyBoYW5kLiBJZiB0aGUgcmVndWxhci1wbGF5IGNhcmRzXG4gKiAoU1IvTFIvU1AvTFApIGFyZSBhbGwgZXhoYXVzdGVkLCByZWZpbGwgdGhlbSBcdTIwMTQgSGFpbCBNYXJ5IGNvdW50IGlzXG4gKiBwcmVzZXJ2ZWQgYWNyb3NzIHJlZmlsbHMgKG1hdGNoZXMgdjUuMSBQbGF5ZXIuZmlsbFBsYXlzKCdwJykpLlxuICovXG5mdW5jdGlvbiBkZWNyZW1lbnRIYW5kKFxuICBwbGF5ZXI6IEdhbWVTdGF0ZVtcInBsYXllcnNcIl1bMV0sXG4gIHBsYXk6IFBsYXlDYWxsLFxuKTogR2FtZVN0YXRlW1wicGxheWVyc1wiXVsxXSB7XG4gIGNvbnN0IGhhbmQgPSB7IC4uLnBsYXllci5oYW5kIH07XG5cbiAgaWYgKHBsYXkgPT09IFwiSE1cIikge1xuICAgIGhhbmQuSE0gPSBNYXRoLm1heCgwLCBoYW5kLkhNIC0gMSk7XG4gICAgcmV0dXJuIHsgLi4ucGxheWVyLCBoYW5kIH07XG4gIH1cblxuICBpZiAocGxheSA9PT0gXCJGR1wiIHx8IHBsYXkgPT09IFwiUFVOVFwiIHx8IHBsYXkgPT09IFwiVFdPX1BUXCIpIHtcbiAgICAvLyBObyBjYXJkIGNvbnN1bWVkIFx1MjAxNCB0aGVzZSBhcmUgc2l0dWF0aW9uYWwgZGVjaXNpb25zLCBub3QgZHJhd3MuXG4gICAgcmV0dXJuIHBsYXllcjtcbiAgfVxuXG4gIGhhbmRbcGxheV0gPSBNYXRoLm1heCgwLCBoYW5kW3BsYXldIC0gMSk7XG5cbiAgY29uc3QgcmVndWxhckV4aGF1c3RlZCA9XG4gICAgaGFuZC5TUiA9PT0gMCAmJiBoYW5kLkxSID09PSAwICYmIGhhbmQuU1AgPT09IDAgJiYgaGFuZC5MUCA9PT0gMCAmJiBoYW5kLlRQID09PSAwO1xuXG4gIGlmIChyZWd1bGFyRXhoYXVzdGVkKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLnBsYXllcixcbiAgICAgIGhhbmQ6IHsgU1I6IDMsIExSOiAzLCBTUDogMywgTFA6IDMsIFRQOiAxLCBITTogaGFuZC5ITSB9LFxuICAgIH07XG4gIH1cblxuICByZXR1cm4geyAuLi5wbGF5ZXIsIGhhbmQgfTtcbn1cbiIsICIvKipcbiAqIFNoYXJlZCBwcmltaXRpdmVzIHVzZWQgYnkgbXVsdGlwbGUgc3BlY2lhbC1wbGF5IHJlc29sdmVycy5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIFBsYXllcklkIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vLi4vc3RhdGUuanNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIHN0YXRlOiBHYW1lU3RhdGU7XG4gIGV2ZW50czogRXZlbnRbXTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJsYW5rUGljaygpOiBHYW1lU3RhdGVbXCJwZW5kaW5nUGlja1wiXSB7XG4gIHJldHVybiB7IG9mZmVuc2VQbGF5OiBudWxsLCBkZWZlbnNlUGxheTogbnVsbCB9O1xufVxuXG4vKipcbiAqIEF3YXJkIHBvaW50cywgZmxpcCB0byBQQVRfQ0hPSUNFLiBDYWxsZXIgZW1pdHMgVE9VQ0hET1dOLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlUb3VjaGRvd24oXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHNjb3JlcjogUGxheWVySWQsXG4gIGV2ZW50czogRXZlbnRbXSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtzY29yZXJdOiB7IC4uLnN0YXRlLnBsYXllcnNbc2NvcmVyXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbc2NvcmVyXS5zY29yZSArIDYgfSxcbiAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiVE9VQ0hET1dOXCIsIHNjb3JpbmdQbGF5ZXI6IHNjb3JlciB9KTtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgcGhhc2U6IFwiUEFUX0NIT0lDRVwiLFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlTYWZldHkoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIGNvbmNlZGVyOiBQbGF5ZXJJZCxcbiAgZXZlbnRzOiBFdmVudFtdLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBzY29yZXIgPSBvcHAoY29uY2VkZXIpO1xuICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgW3Njb3Jlcl06IHsgLi4uc3RhdGUucGxheWVyc1tzY29yZXJdLCBzY29yZTogc3RhdGUucGxheWVyc1tzY29yZXJdLnNjb3JlICsgMiB9LFxuICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJTQUZFVFlcIiwgc2NvcmluZ1BsYXllcjogc2NvcmVyIH0pO1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBwaGFzZTogXCJLSUNLT0ZGXCIsXG4gICAgICBpc1NhZmV0eUtpY2s6IHRydWUsXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbi8qKlxuICogQXBwbHkgYSB5YXJkYWdlIG91dGNvbWUgd2l0aCBmdWxsIGRvd24vdHVybm92ZXIvc2NvcmUgYm9va2tlZXBpbmcuXG4gKiBVc2VkIGJ5IHNwZWNpYWxzIHRoYXQgcHJvZHVjZSB5YXJkYWdlIGRpcmVjdGx5IChIYWlsIE1hcnksIEJpZyBQbGF5IHJldHVybikuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhcHBseVlhcmRhZ2VPdXRjb21lKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICB5YXJkczogbnVtYmVyLFxuICBldmVudHM6IEV2ZW50W10sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBwcm9qZWN0ZWQgPSBzdGF0ZS5maWVsZC5iYWxsT24gKyB5YXJkcztcblxuICBpZiAocHJvamVjdGVkID49IDEwMCkgcmV0dXJuIGFwcGx5VG91Y2hkb3duKHN0YXRlLCBvZmZlbnNlLCBldmVudHMpO1xuICBpZiAocHJvamVjdGVkIDw9IDApIHJldHVybiBhcHBseVNhZmV0eShzdGF0ZSwgb2ZmZW5zZSwgZXZlbnRzKTtcblxuICBjb25zdCByZWFjaGVkRmlyc3REb3duID0gcHJvamVjdGVkID49IHN0YXRlLmZpZWxkLmZpcnN0RG93bkF0O1xuICBsZXQgbmV4dERvd24gPSBzdGF0ZS5maWVsZC5kb3duO1xuICBsZXQgbmV4dEZpcnN0RG93bkF0ID0gc3RhdGUuZmllbGQuZmlyc3REb3duQXQ7XG4gIGxldCBwb3NzZXNzaW9uRmxpcHBlZCA9IGZhbHNlO1xuXG4gIGlmIChyZWFjaGVkRmlyc3REb3duKSB7XG4gICAgbmV4dERvd24gPSAxO1xuICAgIG5leHRGaXJzdERvd25BdCA9IE1hdGgubWluKDEwMCwgcHJvamVjdGVkICsgMTApO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJGSVJTVF9ET1dOXCIgfSk7XG4gIH0gZWxzZSBpZiAoc3RhdGUuZmllbGQuZG93biA9PT0gNCkge1xuICAgIHBvc3Nlc3Npb25GbGlwcGVkID0gdHJ1ZTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJfT05fRE9XTlNcIiB9KTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcImRvd25zXCIgfSk7XG4gIH0gZWxzZSB7XG4gICAgbmV4dERvd24gPSAoc3RhdGUuZmllbGQuZG93biArIDEpIGFzIDEgfCAyIHwgMyB8IDQ7XG4gIH1cblxuICBjb25zdCBtaXJyb3JlZEJhbGxPbiA9IHBvc3Nlc3Npb25GbGlwcGVkID8gMTAwIC0gcHJvamVjdGVkIDogcHJvamVjdGVkO1xuXG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgYmFsbE9uOiBtaXJyb3JlZEJhbGxPbixcbiAgICAgICAgZmlyc3REb3duQXQ6IHBvc3Nlc3Npb25GbGlwcGVkXG4gICAgICAgICAgPyBNYXRoLm1pbigxMDAsIG1pcnJvcmVkQmFsbE9uICsgMTApXG4gICAgICAgICAgOiBuZXh0Rmlyc3REb3duQXQsXG4gICAgICAgIGRvd246IHBvc3Nlc3Npb25GbGlwcGVkID8gMSA6IG5leHREb3duLFxuICAgICAgICBvZmZlbnNlOiBwb3NzZXNzaW9uRmxpcHBlZCA/IG9wcChvZmZlbnNlKSA6IG9mZmVuc2UsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuIiwgIi8qKlxuICogQmlnIFBsYXkgcmVzb2x1dGlvbiAocnVuLmpzOjE5MzMpLlxuICpcbiAqIFRyaWdnZXJlZCBieTpcbiAqICAgLSBUcmljayBQbGF5IGRpZT01XG4gKiAgIC0gU2FtZSBQbGF5IEtpbmcgb3V0Y29tZVxuICogICAtIE90aGVyIGZ1dHVyZSBob29rc1xuICpcbiAqIFRoZSBiZW5lZmljaWFyeSBhcmd1bWVudCBzYXlzIHdobyBiZW5lZml0cyBcdTIwMTQgdGhpcyBjYW4gYmUgb2ZmZW5zZSBPUlxuICogZGVmZW5zZSAoZGlmZmVyZW50IG91dGNvbWUgdGFibGVzKS5cbiAqXG4gKiBPZmZlbnNpdmUgQmlnIFBsYXkgKG9mZmVuc2UgYmVuZWZpdHMpOlxuICogICBkaWUgMS0zIFx1MjE5MiArMjUgeWFyZHNcbiAqICAgZGllIDQtNSBcdTIxOTIgbWF4KGhhbGYtdG8tZ29hbCwgNDApIHlhcmRzXG4gKiAgIGRpZSA2ICAgXHUyMTkyIFRvdWNoZG93blxuICpcbiAqIERlZmVuc2l2ZSBCaWcgUGxheSAoZGVmZW5zZSBiZW5lZml0cyk6XG4gKiAgIGRpZSAxLTMgXHUyMTkyIDEwLXlhcmQgcGVuYWx0eSBvbiBvZmZlbnNlIChyZXBlYXQgZG93biksIGhhbGYtdG8tZ29hbCBpZiB0aWdodFxuICogICBkaWUgNC01IFx1MjE5MiBGVU1CTEUgXHUyMTkyIHR1cm5vdmVyICsgZGVmZW5zZSByZXR1cm5zIG1heChoYWxmLCAyNSlcbiAqICAgZGllIDYgICBcdTIxOTIgRlVNQkxFIFx1MjE5MiBkZWZlbnNpdmUgVERcbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgUGxheWVySWQgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi8uLi9zdGF0ZS5qc1wiO1xuaW1wb3J0IHtcbiAgYXBwbHlTYWZldHksXG4gIGFwcGx5VG91Y2hkb3duLFxuICBibGFua1BpY2ssXG4gIHR5cGUgU3BlY2lhbFJlc29sdXRpb24sXG59IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUJpZ1BsYXkoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIGJlbmVmaWNpYXJ5OiBQbGF5ZXJJZCxcbiAgcm5nOiBSbmcsXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBkaWUgPSBybmcuZDYoKTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW3sgdHlwZTogXCJCSUdfUExBWVwiLCBiZW5lZmljaWFyeSwgc3Vicm9sbDogZGllIH1dO1xuXG4gIGlmIChiZW5lZmljaWFyeSA9PT0gb2ZmZW5zZSkge1xuICAgIHJldHVybiBvZmZlbnNpdmVCaWdQbGF5KHN0YXRlLCBvZmZlbnNlLCBkaWUsIGV2ZW50cyk7XG4gIH1cbiAgcmV0dXJuIGRlZmVuc2l2ZUJpZ1BsYXkoc3RhdGUsIG9mZmVuc2UsIGRpZSwgZXZlbnRzKTtcbn1cblxuZnVuY3Rpb24gb2ZmZW5zaXZlQmlnUGxheShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgb2ZmZW5zZTogUGxheWVySWQsXG4gIGRpZTogMSB8IDIgfCAzIHwgNCB8IDUgfCA2LFxuICBldmVudHM6IEV2ZW50W10sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGlmIChkaWUgPT09IDYpIHtcbiAgICByZXR1cm4gYXBwbHlUb3VjaGRvd24oc3RhdGUsIG9mZmVuc2UsIGV2ZW50cyk7XG4gIH1cblxuICAvLyBkaWUgMS0zOiArMjU7IGRpZSA0LTU6IG1heChoYWxmLXRvLWdvYWwsIDQwKVxuICBsZXQgZ2FpbjogbnVtYmVyO1xuICBpZiAoZGllIDw9IDMpIHtcbiAgICBnYWluID0gMjU7XG4gIH0gZWxzZSB7XG4gICAgY29uc3QgaGFsZlRvR29hbCA9IE1hdGgucm91bmQoKDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbikgLyAyKTtcbiAgICBnYWluID0gaGFsZlRvR29hbCA+IDQwID8gaGFsZlRvR29hbCA6IDQwO1xuICB9XG5cbiAgY29uc3QgcHJvamVjdGVkID0gc3RhdGUuZmllbGQuYmFsbE9uICsgZ2FpbjtcbiAgaWYgKHByb2plY3RlZCA+PSAxMDApIHtcbiAgICByZXR1cm4gYXBwbHlUb3VjaGRvd24oc3RhdGUsIG9mZmVuc2UsIGV2ZW50cyk7XG4gIH1cblxuICAvLyBBcHBseSBnYWluLCBjaGVjayBmb3IgZmlyc3QgZG93bi5cbiAgY29uc3QgcmVhY2hlZEZpcnN0RG93biA9IHByb2plY3RlZCA+PSBzdGF0ZS5maWVsZC5maXJzdERvd25BdDtcbiAgY29uc3QgbmV4dERvd24gPSByZWFjaGVkRmlyc3REb3duID8gMSA6IHN0YXRlLmZpZWxkLmRvd247XG4gIGNvbnN0IG5leHRGaXJzdERvd25BdCA9IHJlYWNoZWRGaXJzdERvd25cbiAgICA/IE1hdGgubWluKDEwMCwgcHJvamVjdGVkICsgMTApXG4gICAgOiBzdGF0ZS5maWVsZC5maXJzdERvd25BdDtcblxuICBpZiAocmVhY2hlZEZpcnN0RG93bikgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkZJUlNUX0RPV05cIiB9KTtcblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIC4uLnN0YXRlLmZpZWxkLFxuICAgICAgICBiYWxsT246IHByb2plY3RlZCxcbiAgICAgICAgZG93bjogbmV4dERvd24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBuZXh0Rmlyc3REb3duQXQsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG5mdW5jdGlvbiBkZWZlbnNpdmVCaWdQbGF5KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBvZmZlbnNlOiBQbGF5ZXJJZCxcbiAgZGllOiAxIHwgMiB8IDMgfCA0IHwgNSB8IDYsXG4gIGV2ZW50czogRXZlbnRbXSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgLy8gMS0zOiAxMC15YXJkIHBlbmFsdHksIHJlcGVhdCBkb3duIChubyBkb3duIGNvbnN1bWVkKS5cbiAgaWYgKGRpZSA8PSAzKSB7XG4gICAgY29uc3QgbmFpdmVQZW5hbHR5ID0gLTEwO1xuICAgIGNvbnN0IGhhbGZUb0dvYWwgPSAtTWF0aC5mbG9vcihzdGF0ZS5maWVsZC5iYWxsT24gLyAyKTtcbiAgICBjb25zdCBwZW5hbHR5WWFyZHMgPVxuICAgICAgc3RhdGUuZmllbGQuYmFsbE9uIC0gMTAgPCAxID8gaGFsZlRvR29hbCA6IG5haXZlUGVuYWx0eTtcblxuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJQRU5BTFRZXCIsIGFnYWluc3Q6IG9mZmVuc2UsIHlhcmRzOiBwZW5hbHR5WWFyZHMsIGxvc3NPZkRvd246IGZhbHNlIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIC4uLnN0YXRlLmZpZWxkLFxuICAgICAgICAgIGJhbGxPbjogTWF0aC5tYXgoMCwgc3RhdGUuZmllbGQuYmFsbE9uICsgcGVuYWx0eVlhcmRzKSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIDQtNTogdHVybm92ZXIgd2l0aCByZXR1cm4gb2YgbWF4KGhhbGYsIDI1KS4gNjogZGVmZW5zaXZlIFRELlxuICBjb25zdCBkZWZlbmRlciA9IG9wcChvZmZlbnNlKTtcblxuICBpZiAoZGllID09PSA2KSB7XG4gICAgLy8gRGVmZW5zZSBzY29yZXMgdGhlIFRELlxuICAgIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgW2RlZmVuZGVyXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW2RlZmVuZGVyXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbZGVmZW5kZXJdLnNjb3JlICsgNiB9LFxuICAgIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcImZ1bWJsZVwiIH0pO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUT1VDSERPV05cIiwgc2NvcmluZ1BsYXllcjogZGVmZW5kZXIgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIHBoYXNlOiBcIlBBVF9DSE9JQ0VcIixcbiAgICAgICAgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IGRlZmVuZGVyIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBkaWUgNC01OiB0dXJub3ZlciB3aXRoIHJldHVybi5cbiAgY29uc3QgaGFsZlRvR29hbCA9IE1hdGgucm91bmQoKDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbikgLyAyKTtcbiAgY29uc3QgcmV0dXJuWWFyZHMgPSBoYWxmVG9Hb2FsID4gMjUgPyBoYWxmVG9Hb2FsIDogMjU7XG5cbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJmdW1ibGVcIiB9KTtcblxuICAvLyBEZWZlbnNlIGJlY29tZXMgbmV3IG9mZmVuc2UuIEJhbGwgcG9zaXRpb246IG9mZmVuc2UgZ2FpbmVkIHJldHVybllhcmRzLFxuICAvLyB0aGVuIGZsaXAgcGVyc3BlY3RpdmUuXG4gIGNvbnN0IHByb2plY3RlZCA9IHN0YXRlLmZpZWxkLmJhbGxPbiArIHJldHVybllhcmRzO1xuICBpZiAocHJvamVjdGVkID49IDEwMCkge1xuICAgIC8vIFJldHVybmVkIGFsbCB0aGUgd2F5IFx1MjAxNCBURCBmb3IgZGVmZW5kZXIuXG4gICAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICBbZGVmZW5kZXJdOiB7IC4uLnN0YXRlLnBsYXllcnNbZGVmZW5kZXJdLCBzY29yZTogc3RhdGUucGxheWVyc1tkZWZlbmRlcl0uc2NvcmUgKyA2IH0sXG4gICAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUT1VDSERPV05cIiwgc2NvcmluZ1BsYXllcjogZGVmZW5kZXIgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIHBoYXNlOiBcIlBBVF9DSE9JQ0VcIixcbiAgICAgICAgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IGRlZmVuZGVyIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cbiAgaWYgKHByb2plY3RlZCA8PSAwKSB7XG4gICAgcmV0dXJuIGFwcGx5U2FmZXR5KHN0YXRlLCBvZmZlbnNlLCBldmVudHMpO1xuICB9XG5cbiAgLy8gRmxpcCBwb3NzZXNzaW9uLCBtaXJyb3IgYmFsbCBwb3NpdGlvbi5cbiAgY29uc3QgbWlycm9yZWRCYWxsT24gPSAxMDAgLSBwcm9qZWN0ZWQ7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgYmFsbE9uOiBtaXJyb3JlZEJhbGxPbixcbiAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgbWlycm9yZWRCYWxsT24gKyAxMCksXG4gICAgICAgIGRvd246IDEsXG4gICAgICAgIG9mZmVuc2U6IGRlZmVuZGVyLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cbiIsICIvKipcbiAqIFB1bnQgKHJ1bi5qczoyMDkwKS4gQWxzbyBzZXJ2ZXMgZm9yIHNhZmV0eSBraWNrcy5cbiAqXG4gKiBTZXF1ZW5jZSAoYWxsIHJhbmRvbW5lc3MgdGhyb3VnaCBybmcpOlxuICogICAxLiBCbG9jayBjaGVjazogaWYgaW5pdGlhbCBkNiBpcyA2LCByb2xsIGFnYWluIFx1MjAxNCAyLXNpeGVzID0gYmxvY2tlZCAoMS8zNikuXG4gKiAgIDIuIElmIG5vdCBibG9ja2VkLCBkcmF3IHlhcmRzIGNhcmQgKyBjb2luIGZsaXA6XG4gKiAgICAgICAga2lja0Rpc3QgPSAxMCAqIHlhcmRzQ2FyZCAvIDIgKyAyMCAqIChjb2luPWhlYWRzID8gMSA6IDApXG4gKiAgICAgIFJlc3VsdGluZyByYW5nZTogWzUsIDcwXSB5YXJkcy5cbiAqICAgMy4gSWYgYmFsbCBsYW5kcyBwYXN0IDEwMCBcdTIxOTIgdG91Y2hiYWNrLCBwbGFjZSBhdCByZWNlaXZlcidzIDIwLlxuICogICA0LiBNdWZmIGNoZWNrIChub3Qgb24gdG91Y2hiYWNrL2Jsb2NrL3NhZmV0eSBraWNrKTogMi1zaXhlcyA9IHJlY2VpdmVyXG4gKiAgICAgIG11ZmZzLCBraWNraW5nIHRlYW0gcmVjb3ZlcnMuXG4gKiAgIDUuIFJldHVybjogaWYgcG9zc2Vzc2lvbiwgZHJhdyBtdWx0Q2FyZCArIHlhcmRzLlxuICogICAgICAgIEtpbmc9N3gsIFF1ZWVuPTR4LCBKYWNrPTF4LCAxMD0tMC41eFxuICogICAgICAgIHJldHVybiA9IHJvdW5kKG11bHQgKiB5YXJkc0NhcmQpXG4gKiAgICAgIFJldHVybiBjYW4gc2NvcmUgVEQgb3IgY29uY2VkZSBzYWZldHkuXG4gKlxuICogRm9yIHRoZSBlbmdpbmUgcG9ydDogdGhpcyBpcyB0aGUgbW9zdCBwcm9jZWR1cmFsIG9mIHRoZSBzcGVjaWFscy4gV2VcbiAqIGNvbGxlY3QgZXZlbnRzIGluIG9yZGVyIGFuZCBwcm9kdWNlIG9uZSBmaW5hbCBzdGF0ZS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4uLy4uL3N0YXRlLmpzXCI7XG5pbXBvcnQgeyBkcmF3TXVsdGlwbGllciwgZHJhd1lhcmRzIH0gZnJvbSBcIi4uL2RlY2suanNcIjtcbmltcG9ydCB7XG4gIGFwcGx5U2FmZXR5LFxuICBhcHBseVRvdWNoZG93bixcbiAgYmxhbmtQaWNrLFxuICB0eXBlIFNwZWNpYWxSZXNvbHV0aW9uLFxufSBmcm9tIFwiLi9zaGFyZWQuanNcIjtcblxuY29uc3QgUkVUVVJOX01VTFRJUExJRVJTOiBSZWNvcmQ8XCJLaW5nXCIgfCBcIlF1ZWVuXCIgfCBcIkphY2tcIiB8IFwiMTBcIiwgbnVtYmVyPiA9IHtcbiAgS2luZzogNyxcbiAgUXVlZW46IDQsXG4gIEphY2s6IDEsXG4gIFwiMTBcIjogLTAuNSxcbn07XG5cbmV4cG9ydCBpbnRlcmZhY2UgUHVudE9wdGlvbnMge1xuICAvKiogdHJ1ZSBpZiB0aGlzIGlzIGEgc2FmZXR5IGtpY2sgKG5vIGJsb2NrL211ZmYgY2hlY2tzKS4gKi9cbiAgc2FmZXR5S2ljaz86IGJvb2xlYW47XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUHVudChcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgcm5nOiBSbmcsXG4gIG9wdHM6IFB1bnRPcHRpb25zID0ge30sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBkZWZlbmRlciA9IG9wcChvZmZlbnNlKTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG4gIGxldCBkZWNrID0gc3RhdGUuZGVjaztcblxuICAvLyBCbG9jayBjaGVjayAobm90IG9uIHNhZmV0eSBraWNrKS5cbiAgbGV0IGJsb2NrZWQgPSBmYWxzZTtcbiAgaWYgKCFvcHRzLnNhZmV0eUtpY2spIHtcbiAgICBpZiAocm5nLmQ2KCkgPT09IDYgJiYgcm5nLmQ2KCkgPT09IDYpIHtcbiAgICAgIGJsb2NrZWQgPSB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIGlmIChibG9ja2VkKSB7XG4gICAgLy8gS2lja2luZyB0ZWFtIGxvc2VzIHBvc3Nlc3Npb24gYXQgdGhlIGxpbmUgb2Ygc2NyaW1tYWdlLlxuICAgIGNvbnN0IG1pcnJvcmVkQmFsbE9uID0gMTAwIC0gc3RhdGUuZmllbGQuYmFsbE9uO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJQVU5UXCIsIHBsYXllcjogb2ZmZW5zZSwgbGFuZGluZ1Nwb3Q6IHN0YXRlLmZpZWxkLmJhbGxPbiB9KTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcImZ1bWJsZVwiIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIGJhbGxPbjogbWlycm9yZWRCYWxsT24sXG4gICAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgbWlycm9yZWRCYWxsT24gKyAxMCksXG4gICAgICAgICAgZG93bjogMSxcbiAgICAgICAgICBvZmZlbnNlOiBkZWZlbmRlcixcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIERyYXcgeWFyZHMgKyBjb2luIGZvciBraWNrIGRpc3RhbmNlLlxuICBjb25zdCBjb2luID0gcm5nLmNvaW5GbGlwKCk7XG4gIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhkZWNrLCBybmcpO1xuICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcbiAgZGVjayA9IHlhcmRzRHJhdy5kZWNrO1xuXG4gIGNvbnN0IGtpY2tEaXN0ID0gKDEwICogeWFyZHNEcmF3LmNhcmQpIC8gMiArIChjb2luID09PSBcImhlYWRzXCIgPyAyMCA6IDApO1xuICBjb25zdCBsYW5kaW5nU3BvdCA9IHN0YXRlLmZpZWxkLmJhbGxPbiArIGtpY2tEaXN0O1xuICBjb25zdCB0b3VjaGJhY2sgPSBsYW5kaW5nU3BvdCA+IDEwMDtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlBVTlRcIiwgcGxheWVyOiBvZmZlbnNlLCBsYW5kaW5nU3BvdCB9KTtcblxuICAvLyBNdWZmIGNoZWNrIChub3Qgb24gdG91Y2hiYWNrLCBibG9jaywgc2FmZXR5IGtpY2spLlxuICBsZXQgbXVmZmVkID0gZmFsc2U7XG4gIGlmICghdG91Y2hiYWNrICYmICFvcHRzLnNhZmV0eUtpY2spIHtcbiAgICBpZiAocm5nLmQ2KCkgPT09IDYgJiYgcm5nLmQ2KCkgPT09IDYpIHtcbiAgICAgIG11ZmZlZCA9IHRydWU7XG4gICAgfVxuICB9XG5cbiAgaWYgKG11ZmZlZCkge1xuICAgIC8vIFJlY2VpdmVyIG11ZmZzLCBraWNraW5nIHRlYW0gcmVjb3ZlcnMgd2hlcmUgdGhlIGJhbGwgbGFuZGVkLlxuICAgIC8vIEtpY2tpbmcgdGVhbSByZXRhaW5zIHBvc3Nlc3Npb24gKHN0aWxsIG9mZmVuc2UpLlxuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiZnVtYmxlXCIgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBkZWNrLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgYmFsbE9uOiBNYXRoLm1pbig5OSwgbGFuZGluZ1Nwb3QpLFxuICAgICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIGxhbmRpbmdTcG90ICsgMTApLFxuICAgICAgICAgIGRvd246IDEsXG4gICAgICAgICAgb2ZmZW5zZSwgLy8ga2lja2VyIHJldGFpbnNcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIFRvdWNoYmFjazogcmVjZWl2ZXIgZ2V0cyBiYWxsIGF0IHRoZWlyIG93biAyMCAoPSA4MCBmcm9tIHRoZWlyIHBlcnNwZWN0aXZlLFxuICAvLyBidXQgYmFsbCBwb3NpdGlvbiBpcyB0cmFja2VkIGZyb20gb2ZmZW5zZSBQT1YsIHNvIGZvciB0aGUgTkVXIG9mZmVuc2UgdGhhdFxuICAvLyBpcyAxMDAtODAgPSAyMCkuXG4gIGlmICh0b3VjaGJhY2spIHtcbiAgICBjb25zdCBzdGF0ZUFmdGVyS2ljazogR2FtZVN0YXRlID0geyAuLi5zdGF0ZSwgZGVjayB9O1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZUFmdGVyS2ljayxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIGJhbGxPbjogMjAsXG4gICAgICAgICAgZmlyc3REb3duQXQ6IDMwLFxuICAgICAgICAgIGRvd246IDEsXG4gICAgICAgICAgb2ZmZW5zZTogZGVmZW5kZXIsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBOb3JtYWwgcHVudCByZXR1cm46IGRyYXcgbXVsdENhcmQgKyB5YXJkcy4gUmV0dXJuIG1lYXN1cmVkIGZyb20gbGFuZGluZ1Nwb3QuXG4gIGNvbnN0IG11bHREcmF3ID0gZHJhd011bHRpcGxpZXIoZGVjaywgcm5nKTtcbiAgaWYgKG11bHREcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwibXVsdGlwbGllclwiIH0pO1xuICBkZWNrID0gbXVsdERyYXcuZGVjaztcblxuICBjb25zdCByZXR1cm5EcmF3ID0gZHJhd1lhcmRzKGRlY2ssIHJuZyk7XG4gIGlmIChyZXR1cm5EcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcbiAgZGVjayA9IHJldHVybkRyYXcuZGVjaztcblxuICBjb25zdCBtdWx0ID0gUkVUVVJOX01VTFRJUExJRVJTW211bHREcmF3LmNhcmRdO1xuICBjb25zdCByZXR1cm5ZYXJkcyA9IE1hdGgucm91bmQobXVsdCAqIHJldHVybkRyYXcuY2FyZCk7XG5cbiAgLy8gQmFsbCBlbmRzIHVwIGF0IGxhbmRpbmdTcG90IC0gcmV0dXJuWWFyZHMgKGZyb20ga2lja2luZyB0ZWFtJ3MgUE9WKS5cbiAgLy8gRXF1aXZhbGVudGx5LCBmcm9tIHRoZSByZWNlaXZpbmcgdGVhbSdzIFBPVjogKDEwMCAtIGxhbmRpbmdTcG90KSArIHJldHVybllhcmRzLlxuICBjb25zdCByZWNlaXZlckJhbGxPbiA9IDEwMCAtIGxhbmRpbmdTcG90ICsgcmV0dXJuWWFyZHM7XG5cbiAgY29uc3Qgc3RhdGVBZnRlclJldHVybjogR2FtZVN0YXRlID0geyAuLi5zdGF0ZSwgZGVjayB9O1xuXG4gIC8vIFJldHVybiBURCBcdTIwMTQgcmVjZWl2ZXIgc2NvcmVzLlxuICBpZiAocmVjZWl2ZXJCYWxsT24gPj0gMTAwKSB7XG4gICAgY29uc3QgcmVjZWl2ZXJCYWxsQ2xhbXBlZCA9IDEwMDtcbiAgICB2b2lkIHJlY2VpdmVyQmFsbENsYW1wZWQ7XG4gICAgcmV0dXJuIGFwcGx5VG91Y2hkb3duKFxuICAgICAgeyAuLi5zdGF0ZUFmdGVyUmV0dXJuLCBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogZGVmZW5kZXIgfSB9LFxuICAgICAgZGVmZW5kZXIsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuXG4gIC8vIFJldHVybiBzYWZldHkgXHUyMDE0IHJlY2VpdmVyIHRhY2tsZWQgaW4gdGhlaXIgb3duIGVuZHpvbmUgKGNhbid0IGFjdHVhbGx5XG4gIC8vIGhhcHBlbiBmcm9tIGEgbmVnYXRpdmUtcmV0dXJuLXlhcmRhZ2Ugc3RhbmRwb2ludCBpbiB2NS4xIHNpbmNlIHN0YXJ0IGlzXG4gIC8vIDEwMC1sYW5kaW5nU3BvdCB3aGljaCBpcyA+IDAsIGJ1dCBtb2RlbCBpdCBhbnl3YXkgZm9yIGNvbXBsZXRlbmVzcykuXG4gIGlmIChyZWNlaXZlckJhbGxPbiA8PSAwKSB7XG4gICAgcmV0dXJuIGFwcGx5U2FmZXR5KFxuICAgICAgeyAuLi5zdGF0ZUFmdGVyUmV0dXJuLCBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogZGVmZW5kZXIgfSB9LFxuICAgICAgZGVmZW5kZXIsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlQWZ0ZXJSZXR1cm4sXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IHJlY2VpdmVyQmFsbE9uLFxuICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCByZWNlaXZlckJhbGxPbiArIDEwKSxcbiAgICAgICAgZG93bjogMSxcbiAgICAgICAgb2ZmZW5zZTogZGVmZW5kZXIsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuIiwgIi8qKlxuICogS2lja29mZi4gdjYgcmVzdG9yZXMgdjUuMSdzIGtpY2stdHlwZSAvIHJldHVybi10eXBlIHBpY2tzLlxuICpcbiAqIFRoZSBraWNrZXIgKHN0YXRlLmZpZWxkLm9mZmVuc2UpIGNob29zZXMgb25lIG9mOlxuICogICBSSyBcdTIwMTQgUmVndWxhciBLaWNrOiBsb25nIGtpY2ssIG11bHQreWFyZHMgcmV0dXJuXG4gKiAgIE9LIFx1MjAxNCBPbnNpZGUgS2ljazogIHNob3J0IGtpY2ssIDEtaW4tNiByZWNvdmVyeSByb2xsICgxLWluLTEyIHZzIE9SKVxuICogICBTSyBcdTIwMTQgU3F1aWIgS2ljazogICBtZWRpdW0ga2ljaywgMmQ2IHJldHVybiBpZiByZWNlaXZlciBjaG9zZSBSUlxuICpcbiAqIFRoZSByZXR1cm5lciBjaG9vc2VzIG9uZSBvZjpcbiAqICAgUlIgXHUyMDE0IFJlZ3VsYXIgUmV0dXJuOiBub3JtYWwgcmV0dXJuXG4gKiAgIE9SIFx1MjAxNCBPbnNpZGUgY291bnRlcjogZGVmZW5kcyB0aGUgb25zaWRlIChoYXJkZXIgZm9yIGtpY2tlciB0byByZWNvdmVyKVxuICogICBUQiBcdTIwMTQgVG91Y2hiYWNrOiAgICAgIHRha2UgdGhlIGJhbGwgYXQgdGhlIDI1XG4gKlxuICogU2FmZXR5IGtpY2tzIChzdGF0ZS5pc1NhZmV0eUtpY2s9dHJ1ZSkgc2tpcCB0aGUgcGlja3MgYW5kIHVzZSB0aGVcbiAqIGV4aXN0aW5nIHNpbXBsaWZpZWQgcHVudCBwYXRoLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBLaWNrVHlwZSwgUmV0dXJuVHlwZSB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4uLy4uL3N0YXRlLmpzXCI7XG5pbXBvcnQgeyBkcmF3TXVsdGlwbGllciwgZHJhd1lhcmRzIH0gZnJvbSBcIi4uL2RlY2suanNcIjtcbmltcG9ydCB7IHJlc29sdmVQdW50IH0gZnJvbSBcIi4vcHVudC5qc1wiO1xuaW1wb3J0IHtcbiAgYXBwbHlTYWZldHksXG4gIGFwcGx5VG91Y2hkb3duLFxuICBibGFua1BpY2ssXG4gIHR5cGUgU3BlY2lhbFJlc29sdXRpb24sXG59IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5jb25zdCBLSUNLT0ZGX01VTFRJUExJRVJTOiBSZWNvcmQ8XCJLaW5nXCIgfCBcIlF1ZWVuXCIgfCBcIkphY2tcIiB8IFwiMTBcIiwgbnVtYmVyPiA9IHtcbiAgS2luZzogMTAsXG4gIFF1ZWVuOiA1LFxuICBKYWNrOiAxLFxuICBcIjEwXCI6IDAsXG59O1xuXG5leHBvcnQgaW50ZXJmYWNlIEtpY2tvZmZPcHRpb25zIHtcbiAga2lja1R5cGU/OiBLaWNrVHlwZTtcbiAgcmV0dXJuVHlwZT86IFJldHVyblR5cGU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlS2lja29mZihcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgcm5nOiBSbmcsXG4gIG9wdHM6IEtpY2tvZmZPcHRpb25zID0ge30sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IGtpY2tlciA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IHJlY2VpdmVyID0gb3BwKGtpY2tlcik7XG5cbiAgLy8gU2FmZXR5LWtpY2sgcGF0aDogdjUuMSBjYXJ2ZS1vdXQgdHJlYXRzIGl0IGxpa2UgYSBwdW50IGZyb20gdGhlIDM1LlxuICAvLyBObyBwaWNrcyBhcmUgcHJvbXB0ZWQgZm9yLCBzbyBga2lja1R5cGVgIHdpbGwgYmUgdW5kZWZpbmVkIGhlcmUuXG4gIGlmIChzdGF0ZS5pc1NhZmV0eUtpY2sgfHwgIW9wdHMua2lja1R5cGUpIHtcbiAgICBjb25zdCBraWNraW5nU3RhdGU6IEdhbWVTdGF0ZSA9IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIGJhbGxPbjogMzUgfSxcbiAgICB9O1xuICAgIGNvbnN0IHJlc3VsdCA9IHJlc29sdmVQdW50KGtpY2tpbmdTdGF0ZSwgcm5nLCB7IHNhZmV0eUtpY2s6IHRydWUgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7IC4uLnJlc3VsdC5zdGF0ZSwgcGhhc2U6IFwiUkVHX1BMQVlcIiwgaXNTYWZldHlLaWNrOiBmYWxzZSB9LFxuICAgICAgZXZlbnRzOiByZXN1bHQuZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICBjb25zdCB7IGtpY2tUeXBlLCByZXR1cm5UeXBlIH0gPSBvcHRzO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIktJQ0tfVFlQRV9DSE9TRU5cIiwgcGxheWVyOiBraWNrZXIsIGNob2ljZToga2lja1R5cGUgfSk7XG4gIGlmIChyZXR1cm5UeXBlKSB7XG4gICAgZXZlbnRzLnB1c2goe1xuICAgICAgdHlwZTogXCJSRVRVUk5fVFlQRV9DSE9TRU5cIixcbiAgICAgIHBsYXllcjogcmVjZWl2ZXIsXG4gICAgICBjaG9pY2U6IHJldHVyblR5cGUsXG4gICAgfSk7XG4gIH1cblxuICBpZiAoa2lja1R5cGUgPT09IFwiUktcIikge1xuICAgIHJldHVybiByZXNvbHZlUmVndWxhcktpY2soc3RhdGUsIHJuZywgZXZlbnRzLCBraWNrZXIsIHJlY2VpdmVyLCByZXR1cm5UeXBlKTtcbiAgfVxuICBpZiAoa2lja1R5cGUgPT09IFwiT0tcIikge1xuICAgIHJldHVybiByZXNvbHZlT25zaWRlS2ljayhzdGF0ZSwgcm5nLCBldmVudHMsIGtpY2tlciwgcmVjZWl2ZXIsIHJldHVyblR5cGUpO1xuICB9XG4gIHJldHVybiByZXNvbHZlU3F1aWJLaWNrKHN0YXRlLCBybmcsIGV2ZW50cywga2lja2VyLCByZWNlaXZlciwgcmV0dXJuVHlwZSk7XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVSZWd1bGFyS2ljayhcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgcm5nOiBSbmcsXG4gIGV2ZW50czogRXZlbnRbXSxcbiAga2lja2VyOiBHYW1lU3RhdGVbXCJmaWVsZFwiXVtcIm9mZmVuc2VcIl0sXG4gIHJlY2VpdmVyOiBHYW1lU3RhdGVbXCJmaWVsZFwiXVtcIm9mZmVuc2VcIl0sXG4gIHJldHVyblR5cGU6IFJldHVyblR5cGUgfCB1bmRlZmluZWQsXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIC8vIFJldHVybmVyIGNob3NlIHRvdWNoYmFjayAob3IgbWlzbWF0Y2hlZCBPUik6IGJhbGwgYXQgdGhlIHJlY2VpdmVyJ3MgMjUuXG4gIGlmIChyZXR1cm5UeXBlID09PSBcIlRCXCIgfHwgcmV0dXJuVHlwZSA9PT0gXCJPUlwiKSB7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRPVUNIQkFDS1wiLCByZWNlaXZpbmdQbGF5ZXI6IHJlY2VpdmVyIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGhhc2U6IFwiUkVHX1BMQVlcIixcbiAgICAgICAgaXNTYWZldHlLaWNrOiBmYWxzZSxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIGJhbGxPbjogMjUsXG4gICAgICAgICAgZmlyc3REb3duQXQ6IDM1LFxuICAgICAgICAgIGRvd246IDEsXG4gICAgICAgICAgb2ZmZW5zZTogcmVjZWl2ZXIsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBSSyArIFJSOiBraWNrIGRpc3RhbmNlIDM1Li42MCwgdGhlbiBtdWx0K3lhcmRzIHJldHVybi5cbiAgY29uc3Qga2lja1JvbGwgPSBybmcuZDYoKTtcbiAgY29uc3Qga2lja1lhcmRzID0gMzUgKyA1ICogKGtpY2tSb2xsIC0gMSk7IC8vIDM1LCA0MCwgNDUsIDUwLCA1NSwgNjAgXHUyMDE0IDM1Li42MFxuICBjb25zdCBraWNrRW5kRnJvbUtpY2tlciA9IDM1ICsga2lja1lhcmRzOyAvLyA3MC4uOTUsIGJvdW5kZWQgdG8gMTAwXG4gIGNvbnN0IGJvdW5kZWRFbmQgPSBNYXRoLm1pbigxMDAsIGtpY2tFbmRGcm9tS2lja2VyKTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIktJQ0tPRkZcIiwgcmVjZWl2aW5nUGxheWVyOiByZWNlaXZlciwgYmFsbE9uOiBib3VuZGVkRW5kIH0pO1xuXG4gIC8vIFJlY2VpdmVyJ3Mgc3RhcnRpbmcgYmFsbE9uIChwb3NzZXNzaW9uIGZsaXBwZWQpLlxuICBjb25zdCByZWNlaXZlclN0YXJ0ID0gMTAwIC0gYm91bmRlZEVuZDsgLy8gMC4uMzBcblxuICBsZXQgZGVjayA9IHN0YXRlLmRlY2s7XG4gIGNvbnN0IG11bHREcmF3ID0gZHJhd011bHRpcGxpZXIoZGVjaywgcm5nKTtcbiAgaWYgKG11bHREcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwibXVsdGlwbGllclwiIH0pO1xuICBkZWNrID0gbXVsdERyYXcuZGVjaztcblxuICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMoZGVjaywgcm5nKTtcbiAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG4gIGRlY2sgPSB5YXJkc0RyYXcuZGVjaztcblxuICBjb25zdCBtdWx0ID0gS0lDS09GRl9NVUxUSVBMSUVSU1ttdWx0RHJhdy5jYXJkXTtcbiAgY29uc3QgcmV0WWFyZHMgPSBtdWx0ICogeWFyZHNEcmF3LmNhcmQ7XG4gIGlmIChyZXRZYXJkcyAhPT0gMCkge1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJLSUNLT0ZGX1JFVFVSTlwiLCByZXR1cm5lclBsYXllcjogcmVjZWl2ZXIsIHlhcmRzOiByZXRZYXJkcyB9KTtcbiAgfVxuXG4gIGNvbnN0IGZpbmFsQmFsbE9uID0gcmVjZWl2ZXJTdGFydCArIHJldFlhcmRzO1xuXG4gIGlmIChmaW5hbEJhbGxPbiA+PSAxMDApIHtcbiAgICByZXR1cm4gYXBwbHlUb3VjaGRvd24oXG4gICAgICB7IC4uLnN0YXRlLCBkZWNrLCBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogcmVjZWl2ZXIgfSwgaXNTYWZldHlLaWNrOiBmYWxzZSB9LFxuICAgICAgcmVjZWl2ZXIsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuICBpZiAoZmluYWxCYWxsT24gPD0gMCkge1xuICAgIC8vIFJldHVybiBiYWNrd2FyZCBpbnRvIG93biBlbmQgem9uZSBcdTIwMTQgdW5saWtlbHkgd2l0aCB2NS4xIG11bHRpcGxpZXJzIGJ1dCBtb2RlbCBpdC5cbiAgICByZXR1cm4gYXBwbHlTYWZldHkoXG4gICAgICB7IC4uLnN0YXRlLCBkZWNrLCBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogcmVjZWl2ZXIgfSwgaXNTYWZldHlLaWNrOiBmYWxzZSB9LFxuICAgICAgcmVjZWl2ZXIsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgZGVjayxcbiAgICAgIHBoYXNlOiBcIlJFR19QTEFZXCIsXG4gICAgICBpc1NhZmV0eUtpY2s6IGZhbHNlLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgYmFsbE9uOiBmaW5hbEJhbGxPbixcbiAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgZmluYWxCYWxsT24gKyAxMCksXG4gICAgICAgIGRvd246IDEsXG4gICAgICAgIG9mZmVuc2U6IHJlY2VpdmVyLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZU9uc2lkZUtpY2soXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHJuZzogUm5nLFxuICBldmVudHM6IEV2ZW50W10sXG4gIGtpY2tlcjogR2FtZVN0YXRlW1wiZmllbGRcIl1bXCJvZmZlbnNlXCJdLFxuICByZWNlaXZlcjogR2FtZVN0YXRlW1wiZmllbGRcIl1bXCJvZmZlbnNlXCJdLFxuICByZXR1cm5UeXBlOiBSZXR1cm5UeXBlIHwgdW5kZWZpbmVkLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICAvLyBSZXR1cm5lcidzIE9SIGNob2ljZSBjb3JyZWN0bHkgcmVhZHMgdGhlIG9uc2lkZSBcdTIwMTQgbWFrZXMgcmVjb3ZlcnkgaGFyZGVyLlxuICBjb25zdCBvZGRzID0gcmV0dXJuVHlwZSA9PT0gXCJPUlwiID8gMTIgOiA2O1xuICBjb25zdCB0bXAgPSBybmcuaW50QmV0d2VlbigxLCBvZGRzKTtcbiAgY29uc3QgcmVjb3ZlcmVkID0gdG1wID09PSAxO1xuICBjb25zdCBraWNrWWFyZHMgPSAxMCArIHRtcDsgLy8gc2hvcnQga2ljayAxMS4uMTYgKG9yIDExLi4yMiB2cyBPUilcbiAgY29uc3Qga2lja0VuZCA9IDM1ICsga2lja1lhcmRzO1xuXG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJLSUNLT0ZGXCIsIHJlY2VpdmluZ1BsYXllcjogcmVjZWl2ZXIsIGJhbGxPbjoga2lja0VuZCB9KTtcbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IFwiT05TSURFX0tJQ0tcIixcbiAgICByZWNvdmVyZWQsXG4gICAgcmVjb3ZlcmluZ1BsYXllcjogcmVjb3ZlcmVkID8ga2lja2VyIDogcmVjZWl2ZXIsXG4gIH0pO1xuXG4gIGNvbnN0IHJldHVyblJvbGwgPSBybmcuZDYoKSArIHRtcDsgLy8gdjUuMTogdG1wICsgZDZcblxuICBpZiAocmVjb3ZlcmVkKSB7XG4gICAgLy8gS2lja2VyIHJldGFpbnMuIHY1LjEgZmxpcHMgcmV0dXJuIGRpcmVjdGlvbiBcdTIwMTQgbW9kZWxzIFwia2lja2VyIHJlY292ZXJzXG4gICAgLy8gc2xpZ2h0bHkgYmFjayBvZiB0aGUga2ljayBzcG90LlwiXG4gICAgY29uc3Qga2lja2VyQmFsbE9uID0gTWF0aC5tYXgoMSwga2lja0VuZCAtIHJldHVyblJvbGwpO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGhhc2U6IFwiUkVHX1BMQVlcIixcbiAgICAgICAgaXNTYWZldHlLaWNrOiBmYWxzZSxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIGJhbGxPbjoga2lja2VyQmFsbE9uLFxuICAgICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIGtpY2tlckJhbGxPbiArIDEwKSxcbiAgICAgICAgICBkb3duOiAxLFxuICAgICAgICAgIG9mZmVuc2U6IGtpY2tlcixcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIFJlY2VpdmVyIHJlY292ZXJzIGF0IHRoZSBraWNrIHNwb3QsIHJldHVybnMgZm9yd2FyZC5cbiAgY29uc3QgcmVjZWl2ZXJTdGFydCA9IDEwMCAtIGtpY2tFbmQ7XG4gIGNvbnN0IGZpbmFsQmFsbE9uID0gcmVjZWl2ZXJTdGFydCArIHJldHVyblJvbGw7XG4gIGlmIChyZXR1cm5Sb2xsICE9PSAwKSB7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIktJQ0tPRkZfUkVUVVJOXCIsIHJldHVybmVyUGxheWVyOiByZWNlaXZlciwgeWFyZHM6IHJldHVyblJvbGwgfSk7XG4gIH1cblxuICBpZiAoZmluYWxCYWxsT24gPj0gMTAwKSB7XG4gICAgcmV0dXJuIGFwcGx5VG91Y2hkb3duKFxuICAgICAgeyAuLi5zdGF0ZSwgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IHJlY2VpdmVyIH0sIGlzU2FmZXR5S2ljazogZmFsc2UgfSxcbiAgICAgIHJlY2VpdmVyLFxuICAgICAgZXZlbnRzLFxuICAgICk7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBoYXNlOiBcIlJFR19QTEFZXCIsXG4gICAgICBpc1NhZmV0eUtpY2s6IGZhbHNlLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgYmFsbE9uOiBmaW5hbEJhbGxPbixcbiAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgZmluYWxCYWxsT24gKyAxMCksXG4gICAgICAgIGRvd246IDEsXG4gICAgICAgIG9mZmVuc2U6IHJlY2VpdmVyLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZVNxdWliS2ljayhcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgcm5nOiBSbmcsXG4gIGV2ZW50czogRXZlbnRbXSxcbiAga2lja2VyOiBHYW1lU3RhdGVbXCJmaWVsZFwiXVtcIm9mZmVuc2VcIl0sXG4gIHJlY2VpdmVyOiBHYW1lU3RhdGVbXCJmaWVsZFwiXVtcIm9mZmVuc2VcIl0sXG4gIHJldHVyblR5cGU6IFJldHVyblR5cGUgfCB1bmRlZmluZWQsXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IGtpY2tSb2xsID0gcm5nLmQ2KCk7XG4gIGNvbnN0IGtpY2tZYXJkcyA9IDE1ICsgNSAqIGtpY2tSb2xsOyAvLyAyMC4uNDVcbiAgY29uc3Qga2lja0VuZCA9IE1hdGgubWluKDEwMCwgMzUgKyBraWNrWWFyZHMpO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiS0lDS09GRlwiLCByZWNlaXZpbmdQbGF5ZXI6IHJlY2VpdmVyLCBiYWxsT246IGtpY2tFbmQgfSk7XG5cbiAgLy8gT25seSByZXR1cm5hYmxlIGlmIHJlY2VpdmVyIGNob3NlIFJSOyBvdGhlcndpc2Ugbm8gcmV0dXJuLlxuICBjb25zdCByZXRZYXJkcyA9IHJldHVyblR5cGUgPT09IFwiUlJcIiA/IHJuZy5kNigpICsgcm5nLmQ2KCkgOiAwO1xuICBpZiAocmV0WWFyZHMgPiAwKSB7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIktJQ0tPRkZfUkVUVVJOXCIsIHJldHVybmVyUGxheWVyOiByZWNlaXZlciwgeWFyZHM6IHJldFlhcmRzIH0pO1xuICB9XG5cbiAgY29uc3QgcmVjZWl2ZXJTdGFydCA9IDEwMCAtIGtpY2tFbmQ7XG4gIGNvbnN0IGZpbmFsQmFsbE9uID0gcmVjZWl2ZXJTdGFydCArIHJldFlhcmRzO1xuXG4gIGlmIChmaW5hbEJhbGxPbiA+PSAxMDApIHtcbiAgICByZXR1cm4gYXBwbHlUb3VjaGRvd24oXG4gICAgICB7IC4uLnN0YXRlLCBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogcmVjZWl2ZXIgfSwgaXNTYWZldHlLaWNrOiBmYWxzZSB9LFxuICAgICAgcmVjZWl2ZXIsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGhhc2U6IFwiUkVHX1BMQVlcIixcbiAgICAgIGlzU2FmZXR5S2ljazogZmFsc2UsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IGZpbmFsQmFsbE9uLFxuICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBmaW5hbEJhbGxPbiArIDEwKSxcbiAgICAgICAgZG93bjogMSxcbiAgICAgICAgb2ZmZW5zZTogcmVjZWl2ZXIsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuIiwgIi8qKlxuICogSGFpbCBNYXJ5IG91dGNvbWVzIChydW4uanM6MjI0MikuIERpZSB2YWx1ZSBcdTIxOTIgcmVzdWx0LCBmcm9tIG9mZmVuc2UncyBQT1Y6XG4gKiAgIDEgXHUyMTkyIEJJRyBTQUNLLCAtMTAgeWFyZHNcbiAqICAgMiBcdTIxOTIgKzIwIHlhcmRzXG4gKiAgIDMgXHUyMTkyICAgMCB5YXJkc1xuICogICA0IFx1MjE5MiArNDAgeWFyZHNcbiAqICAgNSBcdTIxOTIgSU5URVJDRVBUSU9OICh0dXJub3ZlciBhdCBzcG90KVxuICogICA2IFx1MjE5MiBUT1VDSERPV05cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4uLy4uL3N0YXRlLmpzXCI7XG5pbXBvcnQge1xuICBhcHBseVNhZmV0eSxcbiAgYXBwbHlUb3VjaGRvd24sXG4gIGFwcGx5WWFyZGFnZU91dGNvbWUsXG4gIGJsYW5rUGljayxcbiAgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbixcbn0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlSGFpbE1hcnkoc3RhdGU6IEdhbWVTdGF0ZSwgcm5nOiBSbmcpOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBkaWUgPSBybmcuZDYoKTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW3sgdHlwZTogXCJIQUlMX01BUllfUk9MTFwiLCBvdXRjb21lOiBkaWUgfV07XG5cbiAgLy8gRGVjcmVtZW50IEhNIGNvdW50IHJlZ2FyZGxlc3Mgb2Ygb3V0Y29tZS5cbiAgY29uc3QgdXBkYXRlZFBsYXllcnMgPSB7XG4gICAgLi4uc3RhdGUucGxheWVycyxcbiAgICBbb2ZmZW5zZV06IHtcbiAgICAgIC4uLnN0YXRlLnBsYXllcnNbb2ZmZW5zZV0sXG4gICAgICBoYW5kOiB7IC4uLnN0YXRlLnBsYXllcnNbb2ZmZW5zZV0uaGFuZCwgSE06IE1hdGgubWF4KDAsIHN0YXRlLnBsYXllcnNbb2ZmZW5zZV0uaGFuZC5ITSAtIDEpIH0sXG4gICAgfSxcbiAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICBjb25zdCBzdGF0ZVdpdGhIbTogR2FtZVN0YXRlID0geyAuLi5zdGF0ZSwgcGxheWVyczogdXBkYXRlZFBsYXllcnMgfTtcblxuICAvLyBJbnRlcmNlcHRpb24gKGRpZSA1KSBcdTIwMTQgdHVybm92ZXIgYXQgdGhlIHNwb3QsIHBvc3Nlc3Npb24gZmxpcHMuXG4gIGlmIChkaWUgPT09IDUpIHtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcImludGVyY2VwdGlvblwiIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZVdpdGhIbSxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIC4uLnN0YXRlV2l0aEhtLmZpZWxkLFxuICAgICAgICAgIG9mZmVuc2U6IG9wcChvZmZlbnNlKSxcbiAgICAgICAgICBiYWxsT246IDEwMCAtIHN0YXRlV2l0aEhtLmZpZWxkLmJhbGxPbixcbiAgICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCAxMDAgLSBzdGF0ZVdpdGhIbS5maWVsZC5iYWxsT24gKyAxMCksXG4gICAgICAgICAgZG93bjogMSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIFRvdWNoZG93biAoZGllIDYpLlxuICBpZiAoZGllID09PSA2KSB7XG4gICAgcmV0dXJuIGFwcGx5VG91Y2hkb3duKHN0YXRlV2l0aEhtLCBvZmZlbnNlLCBldmVudHMpO1xuICB9XG5cbiAgLy8gWWFyZGFnZSBvdXRjb21lcyAoZGllIDEsIDIsIDMsIDQpLlxuICBjb25zdCB5YXJkcyA9IGRpZSA9PT0gMSA/IC0xMCA6IGRpZSA9PT0gMiA/IDIwIDogZGllID09PSAzID8gMCA6IDQwO1xuICBjb25zdCBwcm9qZWN0ZWQgPSBzdGF0ZVdpdGhIbS5maWVsZC5iYWxsT24gKyB5YXJkcztcblxuICBpZiAocHJvamVjdGVkID49IDEwMCkgcmV0dXJuIGFwcGx5VG91Y2hkb3duKHN0YXRlV2l0aEhtLCBvZmZlbnNlLCBldmVudHMpO1xuICBpZiAocHJvamVjdGVkIDw9IDApIHJldHVybiBhcHBseVNhZmV0eShzdGF0ZVdpdGhIbSwgb2ZmZW5zZSwgZXZlbnRzKTtcblxuICBldmVudHMucHVzaCh7XG4gICAgdHlwZTogXCJQTEFZX1JFU09MVkVEXCIsXG4gICAgb2ZmZW5zZVBsYXk6IFwiSE1cIixcbiAgICBkZWZlbnNlUGxheTogc3RhdGUucGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgPz8gXCJTUlwiLFxuICAgIG1hdGNodXBRdWFsaXR5OiAwLFxuICAgIG11bHRpcGxpZXI6IHsgY2FyZDogXCIxMFwiLCB2YWx1ZTogMCB9LFxuICAgIHlhcmRzQ2FyZDogMCxcbiAgICB5YXJkc0dhaW5lZDogeWFyZHMsXG4gICAgbmV3QmFsbE9uOiBwcm9qZWN0ZWQsXG4gIH0pO1xuXG4gIHJldHVybiBhcHBseVlhcmRhZ2VPdXRjb21lKHN0YXRlV2l0aEhtLCB5YXJkcywgZXZlbnRzKTtcbn1cbiIsICIvKipcbiAqIFNhbWUgUGxheSBtZWNoYW5pc20gKHJ1bi5qczoxODk5KS5cbiAqXG4gKiBUcmlnZ2VyZWQgd2hlbiBib3RoIHRlYW1zIHBpY2sgdGhlIHNhbWUgcmVndWxhciBwbGF5IEFORCBhIGNvaW4tZmxpcCBsYW5kc1xuICogaGVhZHMgKGFsc28gdW5jb25kaXRpb25hbGx5IHdoZW4gYm90aCBwaWNrIFRyaWNrIFBsYXkpLiBSdW5zIGl0cyBvd25cbiAqIGNvaW4gKyBtdWx0aXBsaWVyLWNhcmQgY2hhaW46XG4gKlxuICogICBtdWx0Q2FyZCA9IEtpbmcgIFx1MjE5MiBCaWcgUGxheSAob2ZmZW5zZSBpZiBjb2luPWhlYWRzLCBkZWZlbnNlIGlmIHRhaWxzKVxuICogICBtdWx0Q2FyZCA9IFF1ZWVuICsgaGVhZHMgXHUyMTkyIG11bHRpcGxpZXIgPSArMywgZHJhdyB5YXJkcyBjYXJkXG4gKiAgIG11bHRDYXJkID0gUXVlZW4gKyB0YWlscyBcdTIxOTIgbXVsdGlwbGllciA9ICAwLCBubyB5YXJkcyAoZGlzdCA9IDApXG4gKiAgIG11bHRDYXJkID0gSmFjayAgKyBoZWFkcyBcdTIxOTIgbXVsdGlwbGllciA9ICAwLCBubyB5YXJkcyAoZGlzdCA9IDApXG4gKiAgIG11bHRDYXJkID0gSmFjayAgKyB0YWlscyBcdTIxOTIgbXVsdGlwbGllciA9IC0zLCBkcmF3IHlhcmRzIGNhcmRcbiAqICAgbXVsdENhcmQgPSAxMCAgICArIGhlYWRzIFx1MjE5MiBJTlRFUkNFUFRJT04gKHR1cm5vdmVyIGF0IHNwb3QpXG4gKiAgIG11bHRDYXJkID0gMTAgICAgKyB0YWlscyBcdTIxOTIgMCB5YXJkc1xuICpcbiAqIE5vdGU6IHRoZSBjb2luIGZsaXAgaW5zaWRlIHRoaXMgZnVuY3Rpb24gaXMgYSBTRUNPTkQgY29pbiBmbGlwIFx1MjAxNCB0aGVcbiAqIG1lY2hhbmlzbS10cmlnZ2VyIGNvaW4gZmxpcCBpcyBoYW5kbGVkIGJ5IHRoZSByZWR1Y2VyIGJlZm9yZSBjYWxsaW5nIGhlcmUuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi8uLi9zdGF0ZS5qc1wiO1xuaW1wb3J0IHsgZHJhd011bHRpcGxpZXIsIGRyYXdZYXJkcyB9IGZyb20gXCIuLi9kZWNrLmpzXCI7XG5pbXBvcnQgeyByZXNvbHZlQmlnUGxheSB9IGZyb20gXCIuL2JpZ1BsYXkuanNcIjtcbmltcG9ydCB7XG4gIGFwcGx5WWFyZGFnZU91dGNvbWUsXG4gIGJsYW5rUGljayxcbiAgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbixcbn0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlU2FtZVBsYXkoc3RhdGU6IEdhbWVTdGF0ZSwgcm5nOiBSbmcpOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcblxuICBjb25zdCBjb2luID0gcm5nLmNvaW5GbGlwKCk7XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJTQU1FX1BMQVlfQ09JTlwiLCBvdXRjb21lOiBjb2luIH0pO1xuXG4gIGNvbnN0IG11bHREcmF3ID0gZHJhd011bHRpcGxpZXIoc3RhdGUuZGVjaywgcm5nKTtcbiAgaWYgKG11bHREcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwibXVsdGlwbGllclwiIH0pO1xuXG4gIGNvbnN0IHN0YXRlQWZ0ZXJNdWx0OiBHYW1lU3RhdGUgPSB7IC4uLnN0YXRlLCBkZWNrOiBtdWx0RHJhdy5kZWNrIH07XG4gIGNvbnN0IGhlYWRzID0gY29pbiA9PT0gXCJoZWFkc1wiO1xuXG4gIC8vIEtpbmcgXHUyMTkyIEJpZyBQbGF5IGZvciB3aGljaGV2ZXIgc2lkZSB3aW5zIHRoZSBjb2luLlxuICBpZiAobXVsdERyYXcuY2FyZCA9PT0gXCJLaW5nXCIpIHtcbiAgICBjb25zdCBiZW5lZmljaWFyeSA9IGhlYWRzID8gb2ZmZW5zZSA6IG9wcChvZmZlbnNlKTtcbiAgICBjb25zdCBicCA9IHJlc29sdmVCaWdQbGF5KHN0YXRlQWZ0ZXJNdWx0LCBiZW5lZmljaWFyeSwgcm5nKTtcbiAgICByZXR1cm4geyBzdGF0ZTogYnAuc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4uYnAuZXZlbnRzXSB9O1xuICB9XG5cbiAgLy8gMTAgXHUyMTkyIGludGVyY2VwdGlvbiAoaGVhZHMpIG9yIDAgeWFyZHMgKHRhaWxzKS5cbiAgaWYgKG11bHREcmF3LmNhcmQgPT09IFwiMTBcIikge1xuICAgIGlmIChoZWFkcykge1xuICAgICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJpbnRlcmNlcHRpb25cIiB9KTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgLi4uc3RhdGVBZnRlck11bHQsXG4gICAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgICAuLi5zdGF0ZUFmdGVyTXVsdC5maWVsZCxcbiAgICAgICAgICAgIG9mZmVuc2U6IG9wcChvZmZlbnNlKSxcbiAgICAgICAgICAgIGJhbGxPbjogMTAwIC0gc3RhdGVBZnRlck11bHQuZmllbGQuYmFsbE9uLFxuICAgICAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgMTAwIC0gc3RhdGVBZnRlck11bHQuZmllbGQuYmFsbE9uICsgMTApLFxuICAgICAgICAgICAgZG93bjogMSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBldmVudHMsXG4gICAgICB9O1xuICAgIH1cbiAgICAvLyAwIHlhcmRzLCBkb3duIGNvbnN1bWVkLlxuICAgIHJldHVybiBhcHBseVlhcmRhZ2VPdXRjb21lKHN0YXRlQWZ0ZXJNdWx0LCAwLCBldmVudHMpO1xuICB9XG5cbiAgLy8gUXVlZW4gb3IgSmFjayBcdTIxOTIgbXVsdGlwbGllciwgdGhlbiBkcmF3IHlhcmRzIGNhcmQuXG4gIGxldCBtdWx0aXBsaWVyID0gMDtcbiAgaWYgKG11bHREcmF3LmNhcmQgPT09IFwiUXVlZW5cIikgbXVsdGlwbGllciA9IGhlYWRzID8gMyA6IDA7XG4gIGlmIChtdWx0RHJhdy5jYXJkID09PSBcIkphY2tcIikgbXVsdGlwbGllciA9IGhlYWRzID8gMCA6IC0zO1xuXG4gIGlmIChtdWx0aXBsaWVyID09PSAwKSB7XG4gICAgLy8gMCB5YXJkcywgZG93biBjb25zdW1lZC5cbiAgICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShzdGF0ZUFmdGVyTXVsdCwgMCwgZXZlbnRzKTtcbiAgfVxuXG4gIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhzdGF0ZUFmdGVyTXVsdC5kZWNrLCBybmcpO1xuICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcblxuICBjb25zdCB5YXJkcyA9IE1hdGgucm91bmQobXVsdGlwbGllciAqIHlhcmRzRHJhdy5jYXJkKTtcblxuICBldmVudHMucHVzaCh7XG4gICAgdHlwZTogXCJQTEFZX1JFU09MVkVEXCIsXG4gICAgb2ZmZW5zZVBsYXk6IHN0YXRlLnBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ID8/IFwiU1JcIixcbiAgICBkZWZlbnNlUGxheTogc3RhdGUucGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgPz8gXCJTUlwiLFxuICAgIG1hdGNodXBRdWFsaXR5OiAwLFxuICAgIG11bHRpcGxpZXI6IHsgY2FyZDogbXVsdERyYXcuY2FyZCwgdmFsdWU6IG11bHRpcGxpZXIgfSxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgIHlhcmRzR2FpbmVkOiB5YXJkcyxcbiAgICBuZXdCYWxsT246IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgc3RhdGVBZnRlck11bHQuZmllbGQuYmFsbE9uICsgeWFyZHMpKSxcbiAgfSk7XG5cbiAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoXG4gICAgeyAuLi5zdGF0ZUFmdGVyTXVsdCwgZGVjazogeWFyZHNEcmF3LmRlY2sgfSxcbiAgICB5YXJkcyxcbiAgICBldmVudHMsXG4gICk7XG59XG4iLCAiLyoqXG4gKiBUcmljayBQbGF5IHJlc29sdXRpb24gKHJ1bi5qczoxOTg3KS4gT25lIHBlciBzaHVmZmxlLCBjYWxsZWQgYnkgZWl0aGVyXG4gKiBvZmZlbnNlIG9yIGRlZmVuc2UuIERpZSByb2xsIG91dGNvbWVzIChmcm9tIHRoZSAqY2FsbGVyJ3MqIHBlcnNwZWN0aXZlKTpcbiAqXG4gKiAgIDEgXHUyMTkyIExvbmcgUGFzcyB3aXRoICs1IGJvbnVzICAgKG1hdGNodXAgdXNlcyBMUCB2cyB0aGUgb3RoZXIgc2lkZSdzIHBpY2spXG4gKiAgIDIgXHUyMTkyIDE1LXlhcmQgcGVuYWx0eSBvbiBvcHBvc2luZyBzaWRlIChoYWxmLXRvLWdvYWwgaWYgdGlnaHQpXG4gKiAgIDMgXHUyMTkyIGZpeGVkIC0zeCBtdWx0aXBsaWVyLCBkcmF3IHlhcmRzIGNhcmRcbiAqICAgNCBcdTIxOTIgZml4ZWQgKzR4IG11bHRpcGxpZXIsIGRyYXcgeWFyZHMgY2FyZFxuICogICA1IFx1MjE5MiBCaWcgUGxheSAoYmVuZWZpY2lhcnkgPSBjYWxsZXIpXG4gKiAgIDYgXHUyMTkyIExvbmcgUnVuIHdpdGggKzUgYm9udXNcbiAqXG4gKiBXaGVuIHRoZSBjYWxsZXIgaXMgdGhlIGRlZmVuc2UsIHRoZSB5YXJkYWdlIHNpZ25zIGludmVydCAoZGVmZW5zZSBnYWlucyA9XG4gKiBvZmZlbnNlIGxvc2VzKSwgdGhlIExSL0xQIG92ZXJsYXkgaXMgYXBwbGllZCB0byB0aGUgZGVmZW5zaXZlIGNhbGwsIGFuZFxuICogdGhlIEJpZyBQbGF5IGJlbmVmaWNpYXJ5IGlzIGRlZmVuc2UuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIFBsYXllcklkLCBSZWd1bGFyUGxheSB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgZHJhd011bHRpcGxpZXIsIGRyYXdZYXJkcyB9IGZyb20gXCIuLi9kZWNrLmpzXCI7XG5pbXBvcnQgeyBNVUxUSSwgbWF0Y2h1cFF1YWxpdHkgfSBmcm9tIFwiLi4vbWF0Y2h1cC5qc1wiO1xuaW1wb3J0IHsgcmVzb2x2ZUJpZ1BsYXkgfSBmcm9tIFwiLi9iaWdQbGF5LmpzXCI7XG5pbXBvcnQge1xuICBhcHBseVlhcmRhZ2VPdXRjb21lLFxuICBibGFua1BpY2ssXG4gIHR5cGUgU3BlY2lhbFJlc29sdXRpb24sXG59IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZU9mZmVuc2l2ZVRyaWNrUGxheShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgcm5nOiBSbmcsXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBkaWUgPSBybmcuZDYoKTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW3sgdHlwZTogXCJUUklDS19QTEFZX1JPTExcIiwgb3V0Y29tZTogZGllIH1dO1xuXG4gIC8vIDUgXHUyMTkyIEJpZyBQbGF5IGZvciBvZmZlbnNlIChjYWxsZXIpLlxuICBpZiAoZGllID09PSA1KSB7XG4gICAgY29uc3QgYnAgPSByZXNvbHZlQmlnUGxheShzdGF0ZSwgb2ZmZW5zZSwgcm5nKTtcbiAgICByZXR1cm4geyBzdGF0ZTogYnAuc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4uYnAuZXZlbnRzXSB9O1xuICB9XG5cbiAgLy8gMiBcdTIxOTIgMTUteWFyZCBwZW5hbHR5IG9uIGRlZmVuc2UgKD0gb2ZmZW5zZSBnYWlucyAxNSBvciBoYWxmLXRvLWdvYWwpLlxuICBpZiAoZGllID09PSAyKSB7XG4gICAgY29uc3QgcmF3R2FpbiA9IDE1O1xuICAgIGNvbnN0IGdhaW4gPVxuICAgICAgc3RhdGUuZmllbGQuYmFsbE9uICsgcmF3R2FpbiA+IDk5XG4gICAgICAgID8gTWF0aC50cnVuYygoMTAwIC0gc3RhdGUuZmllbGQuYmFsbE9uKSAvIDIpXG4gICAgICAgIDogcmF3R2FpbjtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiUEVOQUxUWVwiLCBhZ2FpbnN0OiBvcHBvbmVudChvZmZlbnNlKSwgeWFyZHM6IGdhaW4sIGxvc3NPZkRvd246IGZhbHNlIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIC4uLnN0YXRlLmZpZWxkLFxuICAgICAgICAgIGJhbGxPbjogTWF0aC5taW4oMTAwLCBzdGF0ZS5maWVsZC5iYWxsT24gKyBnYWluKSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIDMgb3IgNCBcdTIxOTIgZml4ZWQgbXVsdGlwbGllciwgZHJhdyB5YXJkcyBjYXJkLlxuICBpZiAoZGllID09PSAzIHx8IGRpZSA9PT0gNCkge1xuICAgIGNvbnN0IG11bHRpcGxpZXIgPSBkaWUgPT09IDMgPyAtMyA6IDQ7XG4gICAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKHN0YXRlLmRlY2ssIHJuZyk7XG4gICAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG4gICAgY29uc3QgeWFyZHMgPSBNYXRoLnJvdW5kKG11bHRpcGxpZXIgKiB5YXJkc0RyYXcuY2FyZCk7XG5cbiAgICBldmVudHMucHVzaCh7XG4gICAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICAgIG9mZmVuc2VQbGF5OiBcIlRQXCIsXG4gICAgICBkZWZlbnNlUGxheTogc3RhdGUucGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgPz8gXCJTUlwiLFxuICAgICAgbWF0Y2h1cFF1YWxpdHk6IDAsXG4gICAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IFwiS2luZ1wiLCB2YWx1ZTogbXVsdGlwbGllciB9LFxuICAgICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgICAgIHlhcmRzR2FpbmVkOiB5YXJkcyxcbiAgICAgIG5ld0JhbGxPbjogTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBzdGF0ZS5maWVsZC5iYWxsT24gKyB5YXJkcykpLFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoXG4gICAgICB7IC4uLnN0YXRlLCBkZWNrOiB5YXJkc0RyYXcuZGVjayB9LFxuICAgICAgeWFyZHMsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuXG4gIC8vIDEgb3IgNiBcdTIxOTIgcmVndWxhciBwbGF5IHJlc29sdXRpb24gd2l0aCBmb3JjZWQgb2ZmZW5zZSBwbGF5ICsgYm9udXMuXG4gIGNvbnN0IGZvcmNlZFBsYXk6IFJlZ3VsYXJQbGF5ID0gZGllID09PSAxID8gXCJMUFwiIDogXCJMUlwiO1xuICBjb25zdCBib251cyA9IDU7XG4gIGNvbnN0IGRlZmVuc2VQbGF5ID0gc3RhdGUucGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgPz8gXCJTUlwiO1xuXG4gIC8vIE11c3QgYmUgYSByZWd1bGFyIHBsYXkgZm9yIG1hdGNodXAgdG8gYmUgbWVhbmluZ2Z1bC4gSWYgZGVmZW5zZSBhbHNvIHBpY2tlZFxuICAvLyBzb21ldGhpbmcgd2VpcmQsIGZhbGwgYmFjayB0byBxdWFsaXR5IDMgKG5ldXRyYWwpLlxuICBjb25zdCBkZWZQbGF5ID0gaXNSZWd1bGFyKGRlZmVuc2VQbGF5KSA/IGRlZmVuc2VQbGF5IDogXCJTUlwiO1xuICBjb25zdCBxdWFsaXR5ID0gbWF0Y2h1cFF1YWxpdHkoZm9yY2VkUGxheSwgZGVmUGxheSk7XG5cbiAgY29uc3QgbXVsdERyYXcgPSBkcmF3TXVsdGlwbGllcihzdGF0ZS5kZWNrLCBybmcpO1xuICBpZiAobXVsdERyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJtdWx0aXBsaWVyXCIgfSk7XG4gIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhtdWx0RHJhdy5kZWNrLCBybmcpO1xuICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcblxuICBjb25zdCBtdWx0Um93ID0gTVVMVElbbXVsdERyYXcuaW5kZXhdO1xuICBjb25zdCBtdWx0aXBsaWVyID0gbXVsdFJvdz8uW3F1YWxpdHkgLSAxXSA/PyAwO1xuICBjb25zdCB5YXJkcyA9IE1hdGgucm91bmQobXVsdGlwbGllciAqIHlhcmRzRHJhdy5jYXJkKSArIGJvbnVzO1xuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICBvZmZlbnNlUGxheTogZm9yY2VkUGxheSxcbiAgICBkZWZlbnNlUGxheTogZGVmUGxheSxcbiAgICBtYXRjaHVwUXVhbGl0eTogcXVhbGl0eSxcbiAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IG11bHREcmF3LmNhcmQsIHZhbHVlOiBtdWx0aXBsaWVyIH0sXG4gICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgICB5YXJkc0dhaW5lZDogeWFyZHMsXG4gICAgbmV3QmFsbE9uOiBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHN0YXRlLmZpZWxkLmJhbGxPbiArIHlhcmRzKSksXG4gIH0pO1xuXG4gIHJldHVybiBhcHBseVlhcmRhZ2VPdXRjb21lKFxuICAgIHsgLi4uc3RhdGUsIGRlY2s6IHlhcmRzRHJhdy5kZWNrIH0sXG4gICAgeWFyZHMsXG4gICAgZXZlbnRzLFxuICApO1xufVxuXG5mdW5jdGlvbiBpc1JlZ3VsYXIocDogc3RyaW5nKTogcCBpcyBSZWd1bGFyUGxheSB7XG4gIHJldHVybiBwID09PSBcIlNSXCIgfHwgcCA9PT0gXCJMUlwiIHx8IHAgPT09IFwiU1BcIiB8fCBwID09PSBcIkxQXCI7XG59XG5cbmZ1bmN0aW9uIG9wcG9uZW50KHA6IFBsYXllcklkKTogUGxheWVySWQge1xuICByZXR1cm4gcCA9PT0gMSA/IDIgOiAxO1xufVxuXG4vKipcbiAqIERlZmVuc2UgY2FsbHMgVHJpY2sgUGxheS4gU3ltbWV0cmljIHRvIHRoZSBvZmZlbnNpdmUgdmVyc2lvbiB3aXRoIHRoZVxuICogeWFyZGFnZSBzaWduIGludmVydGVkIG9uIHRoZSBMUi9MUCBhbmQgcGVuYWx0eSBicmFuY2hlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVEZWZlbnNpdmVUcmlja1BsYXkoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHJuZzogUm5nLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgZGVmZW5kZXIgPSBvcHBvbmVudChvZmZlbnNlKTtcbiAgY29uc3QgZGllID0gcm5nLmQ2KCk7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFt7IHR5cGU6IFwiVFJJQ0tfUExBWV9ST0xMXCIsIG91dGNvbWU6IGRpZSB9XTtcblxuICAvLyA1IFx1MjE5MiBCaWcgUGxheSBmb3IgZGVmZW5zZSAoY2FsbGVyKS5cbiAgaWYgKGRpZSA9PT0gNSkge1xuICAgIGNvbnN0IGJwID0gcmVzb2x2ZUJpZ1BsYXkoc3RhdGUsIGRlZmVuZGVyLCBybmcpO1xuICAgIHJldHVybiB7IHN0YXRlOiBicC5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi5icC5ldmVudHNdIH07XG4gIH1cblxuICAvLyAyIFx1MjE5MiAxNS15YXJkIHBlbmFsdHkgb24gb2ZmZW5zZSAoPSBvZmZlbnNlIGxvc2VzIDE1IG9yIGhhbGYtdG8tb3duLWdvYWwpLlxuICBpZiAoZGllID09PSAyKSB7XG4gICAgY29uc3QgcmF3TG9zcyA9IC0xNTtcbiAgICBjb25zdCBsb3NzID1cbiAgICAgIHN0YXRlLmZpZWxkLmJhbGxPbiArIHJhd0xvc3MgPCAxXG4gICAgICAgID8gLU1hdGgudHJ1bmMoc3RhdGUuZmllbGQuYmFsbE9uIC8gMilcbiAgICAgICAgOiByYXdMb3NzO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJQRU5BTFRZXCIsIGFnYWluc3Q6IG9mZmVuc2UsIHlhcmRzOiBsb3NzLCBsb3NzT2ZEb3duOiBmYWxzZSB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBlbmRpbmdQaWNrOiB7IG9mZmVuc2VQbGF5OiBudWxsLCBkZWZlbnNlUGxheTogbnVsbCB9LFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIC4uLnN0YXRlLmZpZWxkLFxuICAgICAgICAgIGJhbGxPbjogTWF0aC5tYXgoMCwgc3RhdGUuZmllbGQuYmFsbE9uICsgbG9zcyksXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyAzIG9yIDQgXHUyMTkyIGZpeGVkIG11bHRpcGxpZXIgd2l0aCB0aGUgKmRlZmVuc2Uncyogc2lnbiBjb252ZW50aW9uLiB2NS4xXG4gIC8vIGFwcGxpZXMgdGhlIHNhbWUgKy8tIG11bHRpcGxpZXJzIGFzIG9mZmVuc2l2ZSBUcmljayBQbGF5OyB0aGUgaW52ZXJzaW9uXG4gIC8vIGlzIGltcGxpY2l0IGluIGRlZmVuc2UgYmVpbmcgdGhlIGNhbGxlci4gWWFyZGFnZSBpcyBmcm9tIG9mZmVuc2UgUE9WLlxuICBpZiAoZGllID09PSAzIHx8IGRpZSA9PT0gNCkge1xuICAgIGNvbnN0IG11bHRpcGxpZXIgPSBkaWUgPT09IDMgPyAtMyA6IDQ7XG4gICAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKHN0YXRlLmRlY2ssIHJuZyk7XG4gICAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG4gICAgY29uc3QgeWFyZHMgPSBNYXRoLnJvdW5kKG11bHRpcGxpZXIgKiB5YXJkc0RyYXcuY2FyZCk7XG5cbiAgICBldmVudHMucHVzaCh7XG4gICAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICAgIG9mZmVuc2VQbGF5OiBzdGF0ZS5wZW5kaW5nUGljay5vZmZlbnNlUGxheSA/PyBcIlNSXCIsXG4gICAgICBkZWZlbnNlUGxheTogXCJUUFwiLFxuICAgICAgbWF0Y2h1cFF1YWxpdHk6IDAsXG4gICAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IFwiS2luZ1wiLCB2YWx1ZTogbXVsdGlwbGllciB9LFxuICAgICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgICAgIHlhcmRzR2FpbmVkOiB5YXJkcyxcbiAgICAgIG5ld0JhbGxPbjogTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBzdGF0ZS5maWVsZC5iYWxsT24gKyB5YXJkcykpLFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoXG4gICAgICB7IC4uLnN0YXRlLCBkZWNrOiB5YXJkc0RyYXcuZGVjayB9LFxuICAgICAgeWFyZHMsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuXG4gIC8vIDEgb3IgNiBcdTIxOTIgZGVmZW5zZSdzIHBpY2sgYmVjb21lcyBMUCAvIExSIHdpdGggLTUgYm9udXMgdG8gb2ZmZW5zZS5cbiAgY29uc3QgZm9yY2VkRGVmUGxheTogUmVndWxhclBsYXkgPSBkaWUgPT09IDEgPyBcIkxQXCIgOiBcIkxSXCI7XG4gIGNvbnN0IGJvbnVzID0gLTU7XG4gIGNvbnN0IG9mZmVuc2VQbGF5ID0gc3RhdGUucGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPz8gXCJTUlwiO1xuICBjb25zdCBvZmZQbGF5ID0gaXNSZWd1bGFyKG9mZmVuc2VQbGF5KSA/IG9mZmVuc2VQbGF5IDogXCJTUlwiO1xuICBjb25zdCBxdWFsaXR5ID0gbWF0Y2h1cFF1YWxpdHkob2ZmUGxheSwgZm9yY2VkRGVmUGxheSk7XG5cbiAgY29uc3QgbXVsdERyYXcgPSBkcmF3TXVsdGlwbGllcihzdGF0ZS5kZWNrLCBybmcpO1xuICBpZiAobXVsdERyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJtdWx0aXBsaWVyXCIgfSk7XG4gIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhtdWx0RHJhdy5kZWNrLCBybmcpO1xuICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcblxuICBjb25zdCBtdWx0Um93ID0gTVVMVElbbXVsdERyYXcuaW5kZXhdO1xuICBjb25zdCBtdWx0aXBsaWVyID0gbXVsdFJvdz8uW3F1YWxpdHkgLSAxXSA/PyAwO1xuICBjb25zdCB5YXJkcyA9IE1hdGgucm91bmQobXVsdGlwbGllciAqIHlhcmRzRHJhdy5jYXJkKSArIGJvbnVzO1xuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICBvZmZlbnNlUGxheTogb2ZmUGxheSxcbiAgICBkZWZlbnNlUGxheTogZm9yY2VkRGVmUGxheSxcbiAgICBtYXRjaHVwUXVhbGl0eTogcXVhbGl0eSxcbiAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IG11bHREcmF3LmNhcmQsIHZhbHVlOiBtdWx0aXBsaWVyIH0sXG4gICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgICB5YXJkc0dhaW5lZDogeWFyZHMsXG4gICAgbmV3QmFsbE9uOiBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHN0YXRlLmZpZWxkLmJhbGxPbiArIHlhcmRzKSksXG4gIH0pO1xuXG4gIHJldHVybiBhcHBseVlhcmRhZ2VPdXRjb21lKFxuICAgIHsgLi4uc3RhdGUsIGRlY2s6IHlhcmRzRHJhdy5kZWNrIH0sXG4gICAgeWFyZHMsXG4gICAgZXZlbnRzLFxuICApO1xufVxuIiwgIi8qKlxuICogRmllbGQgR29hbCAocnVuLmpzOjIwNDApLlxuICpcbiAqIERpc3RhbmNlID0gKDEwMCAtIGJhbGxPbikgKyAxNy4gU28gZnJvbSB0aGUgNTAsIEZHID0gNjcteWFyZCBhdHRlbXB0LlxuICpcbiAqIERpZSByb2xsIGRldGVybWluZXMgc3VjY2VzcyBieSBkaXN0YW5jZSBiYW5kOlxuICogICBkaXN0YW5jZSA+IDY1ICAgICAgICBcdTIxOTIgMS1pbi0xMDAwIGNoYW5jZSAoZWZmZWN0aXZlbHkgYXV0by1taXNzKVxuICogICBkaXN0YW5jZSA+PSA2MCAgICAgICBcdTIxOTIgbmVlZHMgZGllID0gNlxuICogICBkaXN0YW5jZSA+PSA1MCAgICAgICBcdTIxOTIgbmVlZHMgZGllID49IDVcbiAqICAgZGlzdGFuY2UgPj0gNDAgICAgICAgXHUyMTkyIG5lZWRzIGRpZSA+PSA0XG4gKiAgIGRpc3RhbmNlID49IDMwICAgICAgIFx1MjE5MiBuZWVkcyBkaWUgPj0gM1xuICogICBkaXN0YW5jZSA+PSAyMCAgICAgICBcdTIxOTIgbmVlZHMgZGllID49IDJcbiAqICAgZGlzdGFuY2UgPCAgMjAgICAgICAgXHUyMTkyIGF1dG8tbWFrZVxuICpcbiAqIElmIGEgdGltZW91dCB3YXMgY2FsbGVkIGJ5IHRoZSBkZWZlbnNlIGp1c3QgcHJpb3IgKGtpY2tlciBpY2luZyksIGRpZSsrLlxuICpcbiAqIFN1Y2Nlc3MgXHUyMTkyICszIHBvaW50cywga2lja29mZiB0byBvcHBvbmVudC5cbiAqIE1pc3MgICAgXHUyMTkyIHBvc3Nlc3Npb24gZmxpcHMgYXQgdGhlIFNQT1QgT0YgVEhFIEtJQ0sgKG5vdCB0aGUgbGluZSBvZiBzY3JpbW1hZ2UpLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7IGJsYW5rUGljaywgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbiB9IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIEZpZWxkR29hbE9wdGlvbnMge1xuICAvKiogdHJ1ZSBpZiB0aGUgb3Bwb3NpbmcgdGVhbSBjYWxsZWQgYSB0aW1lb3V0IHRoYXQgc2hvdWxkIGljZSB0aGUga2lja2VyLiAqL1xuICBpY2VkPzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVGaWVsZEdvYWwoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHJuZzogUm5nLFxuICBvcHRzOiBGaWVsZEdvYWxPcHRpb25zID0ge30sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBkaXN0YW5jZSA9IDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbiArIDE3O1xuICBjb25zdCByYXdEaWUgPSBybmcuZDYoKTtcbiAgY29uc3QgZGllID0gb3B0cy5pY2VkID8gTWF0aC5taW4oNiwgcmF3RGllICsgMSkgOiByYXdEaWU7XG5cbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG5cbiAgbGV0IG1ha2U6IGJvb2xlYW47XG4gIGlmIChkaXN0YW5jZSA+IDY1KSB7XG4gICAgLy8gRXNzZW50aWFsbHkgaW1wb3NzaWJsZSBcdTIwMTQgcm9sbGVkIDEtMTAwMCwgbWFrZSBvbmx5IG9uIGV4YWN0IGhpdC5cbiAgICBtYWtlID0gcm5nLmludEJldHdlZW4oMSwgMTAwMCkgPT09IGRpc3RhbmNlO1xuICB9IGVsc2UgaWYgKGRpc3RhbmNlID49IDYwKSBtYWtlID0gZGllID49IDY7XG4gIGVsc2UgaWYgKGRpc3RhbmNlID49IDUwKSBtYWtlID0gZGllID49IDU7XG4gIGVsc2UgaWYgKGRpc3RhbmNlID49IDQwKSBtYWtlID0gZGllID49IDQ7XG4gIGVsc2UgaWYgKGRpc3RhbmNlID49IDMwKSBtYWtlID0gZGllID49IDM7XG4gIGVsc2UgaWYgKGRpc3RhbmNlID49IDIwKSBtYWtlID0gZGllID49IDI7XG4gIGVsc2UgbWFrZSA9IHRydWU7XG5cbiAgaWYgKG1ha2UpIHtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiRklFTERfR09BTF9HT09EXCIsIHBsYXllcjogb2ZmZW5zZSB9KTtcbiAgICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgIFtvZmZlbnNlXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLCBzY29yZTogc3RhdGUucGxheWVyc1tvZmZlbnNlXS5zY29yZSArIDMgfSxcbiAgICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIHBoYXNlOiBcIktJQ0tPRkZcIixcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJGSUVMRF9HT0FMX01JU1NFRFwiLCBwbGF5ZXI6IG9mZmVuc2UgfSk7XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwibWlzc2VkX2ZnXCIgfSk7XG5cbiAgLy8gUG9zc2Vzc2lvbiBmbGlwcyBhdCBsaW5lIG9mIHNjcmltbWFnZSAoYmFsbCBzdGF5cyB3aGVyZSBraWNrZWQgZnJvbSkuXG4gIGNvbnN0IGRlZmVuZGVyID0gb3BwKG9mZmVuc2UpO1xuICBjb25zdCBtaXJyb3JlZEJhbGxPbiA9IDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbjtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IG1pcnJvcmVkQmFsbE9uLFxuICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBtaXJyb3JlZEJhbGxPbiArIDEwKSxcbiAgICAgICAgZG93bjogMSxcbiAgICAgICAgb2ZmZW5zZTogZGVmZW5kZXIsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuIiwgIi8qKlxuICogVHdvLVBvaW50IENvbnZlcnNpb24gKFRXT19QVCBwaGFzZSkuXG4gKlxuICogQmFsbCBpcyBwbGFjZWQgYXQgb2ZmZW5zZSdzIDk3ICg9IDMteWFyZCBsaW5lKS4gQSBzaW5nbGUgcmVndWxhciBwbGF5IGlzXG4gKiByZXNvbHZlZC4gSWYgdGhlIHJlc3VsdGluZyB5YXJkYWdlIGNyb3NzZXMgdGhlIGdvYWwgbGluZSwgVFdPX1BPSU5UX0dPT0QuXG4gKiBPdGhlcndpc2UsIFRXT19QT0lOVF9GQUlMRUQuIEVpdGhlciB3YXksIGtpY2tvZmYgZm9sbG93cy5cbiAqXG4gKiBVbmxpa2UgYSBub3JtYWwgcGxheSwgYSAycHQgZG9lcyBOT1QgY2hhbmdlIGRvd24vZGlzdGFuY2UuIEl0J3MgYSBvbmUtc2hvdC5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgUmVndWxhclBsYXkgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IGRyYXdNdWx0aXBsaWVyLCBkcmF3WWFyZHMgfSBmcm9tIFwiLi4vZGVjay5qc1wiO1xuaW1wb3J0IHsgY29tcHV0ZVlhcmRhZ2UgfSBmcm9tIFwiLi4veWFyZGFnZS5qc1wiO1xuaW1wb3J0IHsgYmxhbmtQaWNrLCB0eXBlIFNwZWNpYWxSZXNvbHV0aW9uIH0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlVHdvUG9pbnRDb252ZXJzaW9uKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBvZmZlbnNlUGxheTogUmVndWxhclBsYXksXG4gIGRlZmVuc2VQbGF5OiBSZWd1bGFyUGxheSxcbiAgcm5nOiBSbmcsXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcblxuICBjb25zdCBtdWx0RHJhdyA9IGRyYXdNdWx0aXBsaWVyKHN0YXRlLmRlY2ssIHJuZyk7XG4gIGlmIChtdWx0RHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcIm11bHRpcGxpZXJcIiB9KTtcbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKG11bHREcmF3LmRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuXG4gIGNvbnN0IG91dGNvbWUgPSBjb21wdXRlWWFyZGFnZSh7XG4gICAgb2ZmZW5zZTogb2ZmZW5zZVBsYXksXG4gICAgZGVmZW5zZTogZGVmZW5zZVBsYXksXG4gICAgbXVsdGlwbGllckNhcmQ6IG11bHREcmF3LmluZGV4LFxuICAgIHlhcmRzQ2FyZDogeWFyZHNEcmF3LmNhcmQsXG4gIH0pO1xuXG4gIC8vIDJwdCBzdGFydHMgYXQgOTcuIENyb3NzaW5nIHRoZSBnb2FsID0gZ29vZC5cbiAgY29uc3Qgc3RhcnRCYWxsT24gPSA5NztcbiAgY29uc3QgcHJvamVjdGVkID0gc3RhcnRCYWxsT24gKyBvdXRjb21lLnlhcmRzR2FpbmVkO1xuICBjb25zdCBnb29kID0gcHJvamVjdGVkID49IDEwMDtcblxuICBldmVudHMucHVzaCh7XG4gICAgdHlwZTogXCJQTEFZX1JFU09MVkVEXCIsXG4gICAgb2ZmZW5zZVBsYXksXG4gICAgZGVmZW5zZVBsYXksXG4gICAgbWF0Y2h1cFF1YWxpdHk6IG91dGNvbWUubWF0Y2h1cFF1YWxpdHksXG4gICAgbXVsdGlwbGllcjogeyBjYXJkOiBvdXRjb21lLm11bHRpcGxpZXJDYXJkTmFtZSwgdmFsdWU6IG91dGNvbWUubXVsdGlwbGllciB9LFxuICAgIHlhcmRzQ2FyZDogeWFyZHNEcmF3LmNhcmQsXG4gICAgeWFyZHNHYWluZWQ6IG91dGNvbWUueWFyZHNHYWluZWQsXG4gICAgbmV3QmFsbE9uOiBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHByb2plY3RlZCkpLFxuICB9KTtcblxuICBjb25zdCBuZXdQbGF5ZXJzID0gZ29vZFxuICAgID8gKHtcbiAgICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgICAgW29mZmVuc2VdOiB7IC4uLnN0YXRlLnBsYXllcnNbb2ZmZW5zZV0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLnNjb3JlICsgMiB9LFxuICAgICAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdKVxuICAgIDogc3RhdGUucGxheWVycztcblxuICBldmVudHMucHVzaCh7XG4gICAgdHlwZTogZ29vZCA/IFwiVFdPX1BPSU5UX0dPT0RcIiA6IFwiVFdPX1BPSU5UX0ZBSUxFRFwiLFxuICAgIHBsYXllcjogb2ZmZW5zZSxcbiAgfSk7XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBkZWNrOiB5YXJkc0RyYXcuZGVjayxcbiAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBwaGFzZTogXCJLSUNLT0ZGXCIsXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBPdmVydGltZSBtZWNoYW5pY3MuXG4gKlxuICogQ29sbGVnZS1mb290YmFsbCBzdHlsZTpcbiAqICAgLSBFYWNoIHBlcmlvZDogZWFjaCB0ZWFtIGdldHMgb25lIHBvc3Nlc3Npb24gZnJvbSB0aGUgb3Bwb25lbnQncyAyNVxuICogICAgIChvZmZlbnNlIFBPVjogYmFsbE9uID0gNzUpLlxuICogICAtIEEgcG9zc2Vzc2lvbiBlbmRzIHdpdGg6IFREIChmb2xsb3dlZCBieSBQQVQvMnB0KSwgRkcgKG1hZGUgb3IgbWlzc2VkKSxcbiAqICAgICB0dXJub3ZlciwgdHVybm92ZXItb24tZG93bnMsIG9yIHNhZmV0eS5cbiAqICAgLSBBZnRlciBib3RoIHBvc3Nlc3Npb25zLCBpZiBzY29yZXMgZGlmZmVyIFx1MjE5MiBHQU1FX09WRVIuIElmIHRpZWQgXHUyMTkyIG5leHRcbiAqICAgICBwZXJpb2QuXG4gKiAgIC0gUGVyaW9kcyBhbHRlcm5hdGUgd2hvIHBvc3Nlc3NlcyBmaXJzdC5cbiAqICAgLSBQZXJpb2QgMys6IDItcG9pbnQgY29udmVyc2lvbiBtYW5kYXRvcnkgYWZ0ZXIgYSBURCAobm8gUEFUIGtpY2spLlxuICogICAtIEhhaWwgTWFyeXM6IDIgcGVyIHBlcmlvZCwgcmVmaWxsZWQgYXQgc3RhcnQgb2YgZWFjaCBwZXJpb2QuXG4gKiAgIC0gVGltZW91dHM6IDEgcGVyIHBhaXIgb2YgcGVyaW9kcy5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIE92ZXJ0aW1lU3RhdGUsIFBsYXllcklkIH0gZnJvbSBcIi4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBlbXB0eUhhbmQsIG9wcCB9IGZyb20gXCIuLi9zdGF0ZS5qc1wiO1xuaW1wb3J0IHsgZnJlc2hEZWNrTXVsdGlwbGllcnMsIGZyZXNoRGVja1lhcmRzIH0gZnJvbSBcIi4uL3N0YXRlLmpzXCI7XG5cbmNvbnN0IE9UX0JBTExfT04gPSA3NTsgLy8gb3Bwb25lbnQncyAyNS15YXJkIGxpbmUsIGZyb20gb2ZmZW5zZSBQT1ZcblxuLyoqXG4gKiBJbml0aWFsaXplIE9UIHN0YXRlLCByZWZyZXNoIGRlY2tzL2hhbmRzLCBzZXQgYmFsbCBhdCB0aGUgMjUuXG4gKiBDYWxsZWQgb25jZSB0aWVkIHJlZ3VsYXRpb24gZW5kcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0YXJ0T3ZlcnRpbWUoc3RhdGU6IEdhbWVTdGF0ZSk6IHsgc3RhdGU6IEdhbWVTdGF0ZTsgZXZlbnRzOiBFdmVudFtdIH0ge1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcbiAgY29uc3QgZmlyc3RSZWNlaXZlcjogUGxheWVySWQgPSBzdGF0ZS5vcGVuaW5nUmVjZWl2ZXIgPT09IDEgPyAyIDogMTtcbiAgY29uc3Qgb3ZlcnRpbWU6IE92ZXJ0aW1lU3RhdGUgPSB7XG4gICAgcGVyaW9kOiAxLFxuICAgIHBvc3Nlc3Npb246IGZpcnN0UmVjZWl2ZXIsXG4gICAgZmlyc3RSZWNlaXZlcixcbiAgICBwb3NzZXNzaW9uc1JlbWFpbmluZzogMixcbiAgfTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIk9WRVJUSU1FX1NUQVJURURcIiwgcGVyaW9kOiAxLCBwb3NzZXNzaW9uOiBmaXJzdFJlY2VpdmVyIH0pO1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBoYXNlOiBcIk9UX1NUQVJUXCIsXG4gICAgICBvdmVydGltZSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuLyoqIEJlZ2luIChvciByZXN1bWUpIHRoZSBuZXh0IE9UIHBvc3Nlc3Npb24uICovXG5leHBvcnQgZnVuY3Rpb24gc3RhcnRPdmVydGltZVBvc3Nlc3Npb24oc3RhdGU6IEdhbWVTdGF0ZSk6IHsgc3RhdGU6IEdhbWVTdGF0ZTsgZXZlbnRzOiBFdmVudFtdIH0ge1xuICBpZiAoIXN0YXRlLm92ZXJ0aW1lKSByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuXG4gIGNvbnN0IHBvc3Nlc3Npb24gPSBzdGF0ZS5vdmVydGltZS5wb3NzZXNzaW9uO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcblxuICAvLyBSZWZpbGwgSE0gY291bnQgZm9yIHRoZSBwb3NzZXNzaW9uJ3Mgb2ZmZW5zZSAobWF0Y2hlcyB2NS4xOiBITSByZXNldHNcbiAgLy8gcGVyIE9UIHBlcmlvZCkuIFBlcmlvZCAzKyBwbGF5ZXJzIGhhdmUgb25seSAyIEhNcyBhbnl3YXkuXG4gIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgLi4uc3RhdGUucGxheWVycyxcbiAgICBbcG9zc2Vzc2lvbl06IHtcbiAgICAgIC4uLnN0YXRlLnBsYXllcnNbcG9zc2Vzc2lvbl0sXG4gICAgICBoYW5kOiB7IC4uLnN0YXRlLnBsYXllcnNbcG9zc2Vzc2lvbl0uaGFuZCwgSE06IHN0YXRlLm92ZXJ0aW1lLnBlcmlvZCA+PSAzID8gMiA6IDIgfSxcbiAgICB9LFxuICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgcGhhc2U6IFwiT1RfUExBWVwiLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgYmFsbE9uOiBPVF9CQUxMX09OLFxuICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBPVF9CQUxMX09OICsgMTApLFxuICAgICAgICBkb3duOiAxLFxuICAgICAgICBvZmZlbnNlOiBwb3NzZXNzaW9uLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuLyoqXG4gKiBFbmQgdGhlIGN1cnJlbnQgT1QgcG9zc2Vzc2lvbi4gRGVjcmVtZW50cyBwb3NzZXNzaW9uc1JlbWFpbmluZzsgaWYgMCxcbiAqIGNoZWNrcyBmb3IgZ2FtZSBlbmQuIE90aGVyd2lzZSBmbGlwcyBwb3NzZXNzaW9uLlxuICpcbiAqIENhbGxlciBpcyByZXNwb25zaWJsZSBmb3IgZGV0ZWN0aW5nIFwidGhpcyB3YXMgYSBwb3NzZXNzaW9uLWVuZGluZyBldmVudFwiXG4gKiAoVEQrUEFULCBGRyBkZWNpc2lvbiwgdHVybm92ZXIsIGV0YykuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmRPdmVydGltZVBvc3Nlc3Npb24oc3RhdGU6IEdhbWVTdGF0ZSk6IHsgc3RhdGU6IEdhbWVTdGF0ZTsgZXZlbnRzOiBFdmVudFtdIH0ge1xuICBpZiAoIXN0YXRlLm92ZXJ0aW1lKSByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuXG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuICBjb25zdCByZW1haW5pbmcgPSBzdGF0ZS5vdmVydGltZS5wb3NzZXNzaW9uc1JlbWFpbmluZztcblxuICBpZiAocmVtYWluaW5nID09PSAyKSB7XG4gICAgLy8gRmlyc3QgcG9zc2Vzc2lvbiBlbmRlZC4gRmxpcCB0byBzZWNvbmQgdGVhbSwgZnJlc2ggYmFsbC5cbiAgICBjb25zdCBuZXh0UG9zc2Vzc2lvbiA9IG9wcChzdGF0ZS5vdmVydGltZS5wb3NzZXNzaW9uKTtcbiAgICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgIFtuZXh0UG9zc2Vzc2lvbl06IHtcbiAgICAgICAgLi4uc3RhdGUucGxheWVyc1tuZXh0UG9zc2Vzc2lvbl0sXG4gICAgICAgIGhhbmQ6IHsgLi4uc3RhdGUucGxheWVyc1tuZXh0UG9zc2Vzc2lvbl0uaGFuZCwgSE06IDIgfSxcbiAgICAgIH0sXG4gICAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgICAgcGhhc2U6IFwiT1RfUExBWVwiLFxuICAgICAgICBvdmVydGltZTogeyAuLi5zdGF0ZS5vdmVydGltZSwgcG9zc2Vzc2lvbjogbmV4dFBvc3Nlc3Npb24sIHBvc3Nlc3Npb25zUmVtYWluaW5nOiAxIH0sXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgYmFsbE9uOiBPVF9CQUxMX09OLFxuICAgICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIE9UX0JBTExfT04gKyAxMCksXG4gICAgICAgICAgZG93bjogMSxcbiAgICAgICAgICBvZmZlbnNlOiBuZXh0UG9zc2Vzc2lvbixcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIFNlY29uZCBwb3NzZXNzaW9uIGVuZGVkLiBDb21wYXJlIHNjb3Jlcy5cbiAgY29uc3QgcDEgPSBzdGF0ZS5wbGF5ZXJzWzFdLnNjb3JlO1xuICBjb25zdCBwMiA9IHN0YXRlLnBsYXllcnNbMl0uc2NvcmU7XG4gIGlmIChwMSAhPT0gcDIpIHtcbiAgICBjb25zdCB3aW5uZXI6IFBsYXllcklkID0gcDEgPiBwMiA/IDEgOiAyO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJHQU1FX09WRVJcIiwgd2lubmVyIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGhhc2U6IFwiR0FNRV9PVkVSXCIsXG4gICAgICAgIG92ZXJ0aW1lOiB7IC4uLnN0YXRlLm92ZXJ0aW1lLCBwb3NzZXNzaW9uc1JlbWFpbmluZzogMCB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gVGllZCBcdTIwMTQgc3RhcnQgbmV4dCBwZXJpb2QuIEFsdGVybmF0ZXMgZmlyc3QtcG9zc2Vzc29yLlxuICBjb25zdCBuZXh0UGVyaW9kID0gc3RhdGUub3ZlcnRpbWUucGVyaW9kICsgMTtcbiAgY29uc3QgbmV4dEZpcnN0ID0gb3BwKHN0YXRlLm92ZXJ0aW1lLmZpcnN0UmVjZWl2ZXIpO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiT1ZFUlRJTUVfU1RBUlRFRFwiLCBwZXJpb2Q6IG5leHRQZXJpb2QsIHBvc3Nlc3Npb246IG5leHRGaXJzdCB9KTtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwaGFzZTogXCJPVF9TVEFSVFwiLFxuICAgICAgb3ZlcnRpbWU6IHtcbiAgICAgICAgcGVyaW9kOiBuZXh0UGVyaW9kLFxuICAgICAgICBwb3NzZXNzaW9uOiBuZXh0Rmlyc3QsXG4gICAgICAgIGZpcnN0UmVjZWl2ZXI6IG5leHRGaXJzdCxcbiAgICAgICAgcG9zc2Vzc2lvbnNSZW1haW5pbmc6IDIsXG4gICAgICB9LFxuICAgICAgLy8gRnJlc2ggZGVja3MgZm9yIHRoZSBuZXcgcGVyaW9kLlxuICAgICAgZGVjazogeyBtdWx0aXBsaWVyczogZnJlc2hEZWNrTXVsdGlwbGllcnMoKSwgeWFyZHM6IGZyZXNoRGVja1lhcmRzKCkgfSxcbiAgICAgIHBsYXllcnM6IHtcbiAgICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgICAgMTogeyAuLi5zdGF0ZS5wbGF5ZXJzWzFdLCBoYW5kOiBlbXB0eUhhbmQodHJ1ZSkgfSxcbiAgICAgICAgMjogeyAuLi5zdGF0ZS5wbGF5ZXJzWzJdLCBoYW5kOiBlbXB0eUhhbmQodHJ1ZSkgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbi8qKlxuICogRGV0ZWN0IHdoZXRoZXIgYSBzZXF1ZW5jZSBvZiBldmVudHMgZnJvbSBhIHBsYXkgcmVzb2x1dGlvbiBzaG91bGQgZW5kXG4gKiB0aGUgY3VycmVudCBPVCBwb3NzZXNzaW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNQb3NzZXNzaW9uRW5kaW5nSW5PVChldmVudHM6IFJlYWRvbmx5QXJyYXk8RXZlbnQ+KTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgZSBvZiBldmVudHMpIHtcbiAgICBzd2l0Y2ggKGUudHlwZSkge1xuICAgICAgY2FzZSBcIlBBVF9HT09EXCI6XG4gICAgICBjYXNlIFwiVFdPX1BPSU5UX0dPT0RcIjpcbiAgICAgIGNhc2UgXCJUV09fUE9JTlRfRkFJTEVEXCI6XG4gICAgICBjYXNlIFwiRklFTERfR09BTF9HT09EXCI6XG4gICAgICBjYXNlIFwiRklFTERfR09BTF9NSVNTRURcIjpcbiAgICAgIGNhc2UgXCJUVVJOT1ZFUlwiOlxuICAgICAgY2FzZSBcIlRVUk5PVkVSX09OX0RPV05TXCI6XG4gICAgICBjYXNlIFwiU0FGRVRZXCI6XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG4iLCAiLyoqXG4gKiBUaGUgc2luZ2xlIHRyYW5zaXRpb24gZnVuY3Rpb24uIFRha2VzIChzdGF0ZSwgYWN0aW9uLCBybmcpIGFuZCByZXR1cm5zXG4gKiBhIG5ldyBzdGF0ZSBwbHVzIHRoZSBldmVudHMgdGhhdCBkZXNjcmliZSB3aGF0IGhhcHBlbmVkLlxuICpcbiAqIFRoaXMgZmlsZSBpcyB0aGUgKnNrZWxldG9uKiBcdTIwMTQgdGhlIGRpc3BhdGNoIHNoYXBlIGlzIGhlcmUsIHRoZSBjYXNlcyBhcmVcbiAqIG1vc3RseSBzdHVicyBtYXJrZWQgYC8vIFRPRE86IHBvcnQgZnJvbSBydW4uanNgLiBBcyB3ZSBwb3J0LCBlYWNoIGNhc2VcbiAqIGdldHMgdW5pdC10ZXN0ZWQuIFdoZW4gZXZlcnkgY2FzZSBpcyBpbXBsZW1lbnRlZCBhbmQgdGVzdGVkLCB2NS4xJ3MgcnVuLmpzXG4gKiBjYW4gYmUgZGVsZXRlZC5cbiAqXG4gKiBSdWxlcyBmb3IgdGhpcyBmaWxlOlxuICogICAxLiBORVZFUiBpbXBvcnQgZnJvbSBET00sIG5ldHdvcmssIG9yIGFuaW1hdGlvbiBtb2R1bGVzLlxuICogICAyLiBORVZFUiBtdXRhdGUgYHN0YXRlYCBcdTIwMTQgYWx3YXlzIHJldHVybiBhIG5ldyBvYmplY3QuXG4gKiAgIDMuIE5FVkVSIGNhbGwgTWF0aC5yYW5kb20gXHUyMDE0IHVzZSB0aGUgYHJuZ2AgcGFyYW1ldGVyLlxuICogICA0LiBORVZFUiB0aHJvdyBvbiBpbnZhbGlkIGFjdGlvbnMgXHUyMDE0IHJldHVybiBgeyBzdGF0ZSwgZXZlbnRzOiBbXSB9YFxuICogICAgICBhbmQgbGV0IHRoZSBjYWxsZXIgZGVjaWRlLiAoVmFsaWRhdGlvbiBpcyB0aGUgc2VydmVyJ3Mgam9iLilcbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEFjdGlvbiB9IGZyb20gXCIuL2FjdGlvbnMuanNcIjtcbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBLaWNrVHlwZSwgUmV0dXJuVHlwZSB9IGZyb20gXCIuL3R5cGVzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuL3JuZy5qc1wiO1xuaW1wb3J0IHsgaXNSZWd1bGFyUGxheSwgcmVzb2x2ZVJlZ3VsYXJQbGF5IH0gZnJvbSBcIi4vcnVsZXMvcGxheS5qc1wiO1xuaW1wb3J0IHtcbiAgcmVzb2x2ZURlZmVuc2l2ZVRyaWNrUGxheSxcbiAgcmVzb2x2ZUZpZWxkR29hbCxcbiAgcmVzb2x2ZUhhaWxNYXJ5LFxuICByZXNvbHZlS2lja29mZixcbiAgcmVzb2x2ZU9mZmVuc2l2ZVRyaWNrUGxheSxcbiAgcmVzb2x2ZVB1bnQsXG4gIHJlc29sdmVTYW1lUGxheSxcbiAgcmVzb2x2ZVR3b1BvaW50Q29udmVyc2lvbixcbn0gZnJvbSBcIi4vcnVsZXMvc3BlY2lhbHMvaW5kZXguanNcIjtcbmltcG9ydCB7XG4gIGVuZE92ZXJ0aW1lUG9zc2Vzc2lvbixcbiAgaXNQb3NzZXNzaW9uRW5kaW5nSW5PVCxcbiAgc3RhcnRPdmVydGltZSxcbiAgc3RhcnRPdmVydGltZVBvc3Nlc3Npb24sXG59IGZyb20gXCIuL3J1bGVzL292ZXJ0aW1lLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi9zdGF0ZS5qc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIFJlZHVjZVJlc3VsdCB7XG4gIHN0YXRlOiBHYW1lU3RhdGU7XG4gIGV2ZW50czogRXZlbnRbXTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlZHVjZShzdGF0ZTogR2FtZVN0YXRlLCBhY3Rpb246IEFjdGlvbiwgcm5nOiBSbmcpOiBSZWR1Y2VSZXN1bHQge1xuICBjb25zdCByZXN1bHQgPSByZWR1Y2VDb3JlKHN0YXRlLCBhY3Rpb24sIHJuZyk7XG4gIHJldHVybiBhcHBseU92ZXJ0aW1lUm91dGluZyhzdGF0ZSwgcmVzdWx0KTtcbn1cblxuLyoqXG4gKiBJZiB3ZSdyZSBpbiBPVCBhbmQgYSBwb3NzZXNzaW9uLWVuZGluZyBldmVudCBqdXN0IGZpcmVkLCByb3V0ZSB0byB0aGVcbiAqIG5leHQgT1QgcG9zc2Vzc2lvbiAob3IgZ2FtZSBlbmQpLiBTa2lwcyB3aGVuIHRoZSBhY3Rpb24gaXMgaXRzZWxmIGFuIE9UXG4gKiBoZWxwZXIgKHNvIHdlIGRvbid0IGRvdWJsZS1yb3V0ZSkuXG4gKi9cbmZ1bmN0aW9uIGFwcGx5T3ZlcnRpbWVSb3V0aW5nKHByZXZTdGF0ZTogR2FtZVN0YXRlLCByZXN1bHQ6IFJlZHVjZVJlc3VsdCk6IFJlZHVjZVJlc3VsdCB7XG4gIC8vIE9ubHkgY29uc2lkZXIgcm91dGluZyB3aGVuIHdlICp3ZXJlKiBpbiBPVC4gKHN0YXJ0T3ZlcnRpbWUgc2V0cyBzdGF0ZS5vdmVydGltZS4pXG4gIGlmICghcHJldlN0YXRlLm92ZXJ0aW1lICYmICFyZXN1bHQuc3RhdGUub3ZlcnRpbWUpIHJldHVybiByZXN1bHQ7XG4gIGlmICghcmVzdWx0LnN0YXRlLm92ZXJ0aW1lKSByZXR1cm4gcmVzdWx0O1xuICBpZiAoIWlzUG9zc2Vzc2lvbkVuZGluZ0luT1QocmVzdWx0LmV2ZW50cykpIHJldHVybiByZXN1bHQ7XG5cbiAgLy8gUEFUIGluIE9UOiBhIFREIHNjb3JlZCwgYnV0IHBvc3Nlc3Npb24gZG9lc24ndCBlbmQgdW50aWwgUEFULzJwdCByZXNvbHZlcy5cbiAgLy8gUEFUX0dPT0QgLyBUV09fUE9JTlRfKiBhcmUgdGhlbXNlbHZlcyBwb3NzZXNzaW9uLWVuZGluZywgc28gdGhleSBETyByb3V0ZS5cbiAgLy8gQWZ0ZXIgcG9zc2Vzc2lvbiBlbmRzLCBkZWNpZGUgbmV4dC5cbiAgY29uc3QgZW5kZWQgPSBlbmRPdmVydGltZVBvc3Nlc3Npb24ocmVzdWx0LnN0YXRlKTtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZTogZW5kZWQuc3RhdGUsXG4gICAgZXZlbnRzOiBbLi4ucmVzdWx0LmV2ZW50cywgLi4uZW5kZWQuZXZlbnRzXSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVkdWNlQ29yZShzdGF0ZTogR2FtZVN0YXRlLCBhY3Rpb246IEFjdGlvbiwgcm5nOiBSbmcpOiBSZWR1Y2VSZXN1bHQge1xuICBzd2l0Y2ggKGFjdGlvbi50eXBlKSB7XG4gICAgY2FzZSBcIlNUQVJUX0dBTUVcIjpcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgcGhhc2U6IFwiQ09JTl9UT1NTXCIsXG4gICAgICAgICAgY2xvY2s6IHtcbiAgICAgICAgICAgIC4uLnN0YXRlLmNsb2NrLFxuICAgICAgICAgICAgcXVhcnRlcjogMSxcbiAgICAgICAgICAgIHF1YXJ0ZXJMZW5ndGhNaW51dGVzOiBhY3Rpb24ucXVhcnRlckxlbmd0aE1pbnV0ZXMsXG4gICAgICAgICAgICBzZWNvbmRzUmVtYWluaW5nOiBhY3Rpb24ucXVhcnRlckxlbmd0aE1pbnV0ZXMgKiA2MCxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHBsYXllcnM6IHtcbiAgICAgICAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICAgICAgICAxOiB7IC4uLnN0YXRlLnBsYXllcnNbMV0sIHRlYW06IHsgaWQ6IGFjdGlvbi50ZWFtc1sxXSB9IH0sXG4gICAgICAgICAgICAyOiB7IC4uLnN0YXRlLnBsYXllcnNbMl0sIHRlYW06IHsgaWQ6IGFjdGlvbi50ZWFtc1syXSB9IH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgZXZlbnRzOiBbeyB0eXBlOiBcIkdBTUVfU1RBUlRFRFwiIH1dLFxuICAgICAgfTtcblxuICAgIGNhc2UgXCJDT0lOX1RPU1NfQ0FMTFwiOiB7XG4gICAgICBjb25zdCBhY3R1YWwgPSBybmcuY29pbkZsaXAoKTtcbiAgICAgIGNvbnN0IHdpbm5lciA9IGFjdGlvbi5jYWxsID09PSBhY3R1YWwgPyBhY3Rpb24ucGxheWVyIDogb3BwKGFjdGlvbi5wbGF5ZXIpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGUsXG4gICAgICAgIGV2ZW50czogW3sgdHlwZTogXCJDT0lOX1RPU1NfUkVTVUxUXCIsIHJlc3VsdDogYWN0dWFsLCB3aW5uZXIgfV0sXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJSRUNFSVZFX0NIT0lDRVwiOiB7XG4gICAgICAvLyBUaGUgY2FsbGVyJ3MgY2hvaWNlIGRldGVybWluZXMgd2hvIHJlY2VpdmVzIHRoZSBvcGVuaW5nIGtpY2tvZmYuXG4gICAgICAvLyBcInJlY2VpdmVcIiBcdTIxOTIgY2FsbGVyIHJlY2VpdmVzOyBcImRlZmVyXCIgXHUyMTkyIGNhbGxlciBraWNrcyAob3Bwb25lbnQgcmVjZWl2ZXMpLlxuICAgICAgY29uc3QgcmVjZWl2ZXIgPSBhY3Rpb24uY2hvaWNlID09PSBcInJlY2VpdmVcIiA/IGFjdGlvbi5wbGF5ZXIgOiBvcHAoYWN0aW9uLnBsYXllcik7XG4gICAgICAvLyBLaWNrZXIgaXMgdGhlIG9wZW5pbmcgb2ZmZW5zZSAodGhleSBraWNrIG9mZik7IHJlY2VpdmVyIGdldHMgdGhlIGJhbGwgYWZ0ZXIuXG4gICAgICBjb25zdCBraWNrZXIgPSBvcHAocmVjZWl2ZXIpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGU6IHtcbiAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICBwaGFzZTogXCJLSUNLT0ZGXCIsXG4gICAgICAgICAgb3BlbmluZ1JlY2VpdmVyOiByZWNlaXZlcixcbiAgICAgICAgICBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZToga2lja2VyIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGV2ZW50czogW3sgdHlwZTogXCJLSUNLT0ZGXCIsIHJlY2VpdmluZ1BsYXllcjogcmVjZWl2ZXIsIGJhbGxPbjogMzUgfV0sXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJSRVNPTFZFX0tJQ0tPRkZcIjoge1xuICAgICAgY29uc3Qgb3B0czogeyBraWNrVHlwZT86IEtpY2tUeXBlOyByZXR1cm5UeXBlPzogUmV0dXJuVHlwZSB9ID0ge307XG4gICAgICBpZiAoYWN0aW9uLmtpY2tUeXBlKSBvcHRzLmtpY2tUeXBlID0gYWN0aW9uLmtpY2tUeXBlO1xuICAgICAgaWYgKGFjdGlvbi5yZXR1cm5UeXBlKSBvcHRzLnJldHVyblR5cGUgPSBhY3Rpb24ucmV0dXJuVHlwZTtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHJlc29sdmVLaWNrb2ZmKHN0YXRlLCBybmcsIG9wdHMpO1xuICAgICAgcmV0dXJuIHsgc3RhdGU6IHJlc3VsdC5zdGF0ZSwgZXZlbnRzOiByZXN1bHQuZXZlbnRzIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIlNUQVJUX09UX1BPU1NFU1NJT05cIjoge1xuICAgICAgY29uc3QgciA9IHN0YXJ0T3ZlcnRpbWVQb3NzZXNzaW9uKHN0YXRlKTtcbiAgICAgIHJldHVybiB7IHN0YXRlOiByLnN0YXRlLCBldmVudHM6IHIuZXZlbnRzIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIlBJQ0tfUExBWVwiOiB7XG4gICAgICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgICAgIGNvbnN0IGlzT2ZmZW5zaXZlQ2FsbCA9IGFjdGlvbi5wbGF5ZXIgPT09IG9mZmVuc2U7XG5cbiAgICAgIC8vIFZhbGlkYXRlLiBJbGxlZ2FsIHBpY2tzIGFyZSBzaWxlbnRseSBuby1vcCdkOyB0aGUgb3JjaGVzdHJhdG9yXG4gICAgICAvLyAoc2VydmVyIC8gVUkpIGlzIHJlc3BvbnNpYmxlIGZvciBzdXJmYWNpbmcgdGhlIGVycm9yIHRvIHRoZSB1c2VyLlxuICAgICAgaWYgKGFjdGlvbi5wbGF5ID09PSBcIkZHXCIgfHwgYWN0aW9uLnBsYXkgPT09IFwiUFVOVFwiIHx8IGFjdGlvbi5wbGF5ID09PSBcIlRXT19QVFwiKSB7XG4gICAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07IC8vIHdyb25nIGFjdGlvbiB0eXBlIGZvciB0aGVzZVxuICAgICAgfVxuICAgICAgaWYgKGFjdGlvbi5wbGF5ID09PSBcIkhNXCIgJiYgIWlzT2ZmZW5zaXZlQ2FsbCkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9OyAvLyBkZWZlbnNlIGNhbid0IGNhbGwgSGFpbCBNYXJ5XG4gICAgICB9XG4gICAgICBjb25zdCBoYW5kID0gc3RhdGUucGxheWVyc1thY3Rpb24ucGxheWVyXS5oYW5kO1xuICAgICAgaWYgKGFjdGlvbi5wbGF5ID09PSBcIkhNXCIgJiYgaGFuZC5ITSA8PSAwKSB7XG4gICAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gICAgICB9XG4gICAgICBpZiAoXG4gICAgICAgIChhY3Rpb24ucGxheSA9PT0gXCJTUlwiIHx8IGFjdGlvbi5wbGF5ID09PSBcIkxSXCIgfHwgYWN0aW9uLnBsYXkgPT09IFwiU1BcIiB8fCBhY3Rpb24ucGxheSA9PT0gXCJMUFwiIHx8IGFjdGlvbi5wbGF5ID09PSBcIlRQXCIpICYmXG4gICAgICAgIGhhbmRbYWN0aW9uLnBsYXldIDw9IDBcbiAgICAgICkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgfVxuICAgICAgLy8gUmVqZWN0IHJlLXBpY2tzIGZvciB0aGUgc2FtZSBzaWRlIGluIHRoZSBzYW1lIHBsYXkuXG4gICAgICBpZiAoaXNPZmZlbnNpdmVDYWxsICYmIHN0YXRlLnBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5KSB7XG4gICAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gICAgICB9XG4gICAgICBpZiAoIWlzT2ZmZW5zaXZlQ2FsbCAmJiBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgfVxuXG4gICAgICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXG4gICAgICAgIHsgdHlwZTogXCJQTEFZX0NBTExFRFwiLCBwbGF5ZXI6IGFjdGlvbi5wbGF5ZXIsIHBsYXk6IGFjdGlvbi5wbGF5IH0sXG4gICAgICBdO1xuXG4gICAgICBjb25zdCBwZW5kaW5nUGljayA9IHtcbiAgICAgICAgb2ZmZW5zZVBsYXk6IGlzT2ZmZW5zaXZlQ2FsbCA/IGFjdGlvbi5wbGF5IDogc3RhdGUucGVuZGluZ1BpY2sub2ZmZW5zZVBsYXksXG4gICAgICAgIGRlZmVuc2VQbGF5OiBpc09mZmVuc2l2ZUNhbGwgPyBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA6IGFjdGlvbi5wbGF5LFxuICAgICAgfTtcblxuICAgICAgLy8gQm90aCB0ZWFtcyBoYXZlIHBpY2tlZCBcdTIwMTQgcmVzb2x2ZS5cbiAgICAgIGlmIChwZW5kaW5nUGljay5vZmZlbnNlUGxheSAmJiBwZW5kaW5nUGljay5kZWZlbnNlUGxheSkge1xuICAgICAgICAvLyAyLXBvaW50IGNvbnZlcnNpb246IFBJQ0tfUExBWSBpbiBUV09fUFRfQ09OViBwaGFzZSByb3V0ZXMgdG8gdGhlXG4gICAgICAgIC8vIGRlZGljYXRlZCAyLXB0IHJlc29sdmVyIChzY29yaW5nIGNhcHBlZCBhdCAyIHB0cywgbm8gUEFUIGN5Y2xlKS5cbiAgICAgICAgLy8gVFAvSE0gb24gYSAyLXB0IHRyeSBhcmUgY29lcmNlZCB0byBTUiBzbyB0aGV5IGNhbid0IG1pcy1zY29yZTpcbiAgICAgICAgLy8gb3RoZXJ3aXNlIGEgVFAgdGhhdCBkZWZhdWx0cyB0byBMUiBhbmQgY3Jvc3NlcyB0aGUgZ29hbCBsaW5lIHdvdWxkXG4gICAgICAgIC8vIHJ1biB0aHJvdWdoIGFwcGx5WWFyZGFnZU91dGNvbWUgYW5kIGVtaXQgVE9VQ0hET1dOICsgdHJhbnNpdGlvbiB0b1xuICAgICAgICAvLyBQQVRfQ0hPSUNFLCBncmFudGluZyA2IHBvaW50cyBhbmQgYSBmdWxsIFBBVCBpbnN0ZWFkIG9mIDIuXG4gICAgICAgIGlmIChzdGF0ZS5waGFzZSA9PT0gXCJUV09fUFRfQ09OVlwiKSB7XG4gICAgICAgICAgY29uc3Qgb2ZmUGxheSA9IGlzUmVndWxhclBsYXkocGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkpXG4gICAgICAgICAgICA/IHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5XG4gICAgICAgICAgICA6IFwiU1JcIjtcbiAgICAgICAgICBjb25zdCBkZWZQbGF5ID0gaXNSZWd1bGFyUGxheShwZW5kaW5nUGljay5kZWZlbnNlUGxheSlcbiAgICAgICAgICAgID8gcGVuZGluZ1BpY2suZGVmZW5zZVBsYXlcbiAgICAgICAgICAgIDogXCJTUlwiO1xuICAgICAgICAgIGNvbnN0IHN0YXRlV2l0aFBpY2s6IEdhbWVTdGF0ZSA9IHtcbiAgICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgICAgcGVuZGluZ1BpY2s6IHsgb2ZmZW5zZVBsYXk6IG9mZlBsYXksIGRlZmVuc2VQbGF5OiBkZWZQbGF5IH0sXG4gICAgICAgICAgfTtcbiAgICAgICAgICBjb25zdCB0cCA9IHJlc29sdmVUd29Qb2ludENvbnZlcnNpb24oXG4gICAgICAgICAgICBzdGF0ZVdpdGhQaWNrLFxuICAgICAgICAgICAgb2ZmUGxheSxcbiAgICAgICAgICAgIGRlZlBsYXksXG4gICAgICAgICAgICBybmcsXG4gICAgICAgICAgKTtcbiAgICAgICAgICByZXR1cm4geyBzdGF0ZTogdHAuc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4udHAuZXZlbnRzXSB9O1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc3RhdGVXaXRoUGljazogR2FtZVN0YXRlID0geyAuLi5zdGF0ZSwgcGVuZGluZ1BpY2sgfTtcblxuICAgICAgICAvLyBIYWlsIE1hcnkgYnkgb2ZmZW5zZSBcdTIwMTQgcmVzb2x2ZXMgaW1tZWRpYXRlbHksIGRlZmVuc2UgcGljayBpZ25vcmVkLlxuICAgICAgICBpZiAocGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPT09IFwiSE1cIikge1xuICAgICAgICAgIGNvbnN0IGhtID0gcmVzb2x2ZUhhaWxNYXJ5KHN0YXRlV2l0aFBpY2ssIHJuZyk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IGhtLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLmhtLmV2ZW50c10gfTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFRyaWNrIFBsYXkgYnkgZWl0aGVyIHNpZGUuIHY1LjEgKHJ1bi5qczoxODg2KTogaWYgYm90aCBwaWNrIFRQLFxuICAgICAgICAvLyBTYW1lIFBsYXkgY29pbiBhbHdheXMgdHJpZ2dlcnMgXHUyMDE0IGZhbGxzIHRocm91Z2ggdG8gU2FtZSBQbGF5IGJlbG93LlxuICAgICAgICBpZiAoXG4gICAgICAgICAgcGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPT09IFwiVFBcIiAmJlxuICAgICAgICAgIHBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5ICE9PSBcIlRQXCJcbiAgICAgICAgKSB7XG4gICAgICAgICAgY29uc3QgdHAgPSByZXNvbHZlT2ZmZW5zaXZlVHJpY2tQbGF5KHN0YXRlV2l0aFBpY2ssIHJuZyk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHRwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLnRwLmV2ZW50c10gfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoXG4gICAgICAgICAgcGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgPT09IFwiVFBcIiAmJlxuICAgICAgICAgIHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ICE9PSBcIlRQXCJcbiAgICAgICAgKSB7XG4gICAgICAgICAgY29uc3QgdHAgPSByZXNvbHZlRGVmZW5zaXZlVHJpY2tQbGF5KHN0YXRlV2l0aFBpY2ssIHJuZyk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHRwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLnRwLmV2ZW50c10gfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPT09IFwiVFBcIiAmJiBwZW5kaW5nUGljay5kZWZlbnNlUGxheSA9PT0gXCJUUFwiKSB7XG4gICAgICAgICAgLy8gQm90aCBUUCBcdTIxOTIgU2FtZSBQbGF5IHVuY29uZGl0aW9uYWxseS5cbiAgICAgICAgICBjb25zdCBzcCA9IHJlc29sdmVTYW1lUGxheShzdGF0ZVdpdGhQaWNrLCBybmcpO1xuICAgICAgICAgIHJldHVybiB7IHN0YXRlOiBzcC5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi5zcC5ldmVudHNdIH07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZWd1bGFyIHZzIHJlZ3VsYXIuXG4gICAgICAgIGlmIChcbiAgICAgICAgICBpc1JlZ3VsYXJQbGF5KHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5KSAmJlxuICAgICAgICAgIGlzUmVndWxhclBsYXkocGVuZGluZ1BpY2suZGVmZW5zZVBsYXkpXG4gICAgICAgICkge1xuICAgICAgICAgIC8vIFNhbWUgcGxheT8gNTAvNTAgY2hhbmNlIHRvIHRyaWdnZXIgU2FtZSBQbGF5IG1lY2hhbmlzbS5cbiAgICAgICAgICAvLyBTb3VyY2U6IHJ1bi5qczoxODg2IChgaWYgKHBsMSA9PT0gcGwyKWApLlxuICAgICAgICAgIGlmIChwZW5kaW5nUGljay5vZmZlbnNlUGxheSA9PT0gcGVuZGluZ1BpY2suZGVmZW5zZVBsYXkpIHtcbiAgICAgICAgICAgIGNvbnN0IHRyaWdnZXIgPSBybmcuY29pbkZsaXAoKTtcbiAgICAgICAgICAgIGlmICh0cmlnZ2VyID09PSBcImhlYWRzXCIpIHtcbiAgICAgICAgICAgICAgY29uc3Qgc3AgPSByZXNvbHZlU2FtZVBsYXkoc3RhdGVXaXRoUGljaywgcm5nKTtcbiAgICAgICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHNwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLnNwLmV2ZW50c10gfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIFRhaWxzOiBmYWxsIHRocm91Z2ggdG8gcmVndWxhciByZXNvbHV0aW9uIChxdWFsaXR5IDUgb3V0Y29tZSkuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgcmVzb2x2ZWQgPSByZXNvbHZlUmVndWxhclBsYXkoXG4gICAgICAgICAgICBzdGF0ZVdpdGhQaWNrLFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBvZmZlbnNlUGxheTogcGVuZGluZ1BpY2sub2ZmZW5zZVBsYXksXG4gICAgICAgICAgICAgIGRlZmVuc2VQbGF5OiBwZW5kaW5nUGljay5kZWZlbnNlUGxheSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBybmcsXG4gICAgICAgICAgKTtcbiAgICAgICAgICByZXR1cm4geyBzdGF0ZTogcmVzb2x2ZWQuc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4ucmVzb2x2ZWQuZXZlbnRzXSB9O1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRGVmZW5zaXZlIHRyaWNrIHBsYXksIEZHLCBQVU5ULCBUV09fUFQgcGlja3MgXHUyMDE0IG5vdCByb3V0ZWQgaGVyZSB5ZXQuXG4gICAgICAgIC8vIEZHL1BVTlQvVFdPX1BUIGFyZSBkcml2ZW4gYnkgRk9VUlRIX0RPV05fQ0hPSUNFIC8gUEFUX0NIT0lDRSBhY3Rpb25zLFxuICAgICAgICAvLyBub3QgYnkgUElDS19QTEFZLiBEZWZlbnNpdmUgVFAgaXMgYSBUT0RPLlxuICAgICAgICByZXR1cm4geyBzdGF0ZTogc3RhdGVXaXRoUGljaywgZXZlbnRzIH07XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7IHN0YXRlOiB7IC4uLnN0YXRlLCBwZW5kaW5nUGljayB9LCBldmVudHMgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiQ0FMTF9USU1FT1VUXCI6IHtcbiAgICAgIGNvbnN0IHAgPSBzdGF0ZS5wbGF5ZXJzW2FjdGlvbi5wbGF5ZXJdO1xuICAgICAgaWYgKHAudGltZW91dHMgPD0gMCkgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcbiAgICAgIGNvbnN0IHJlbWFpbmluZyA9IHAudGltZW91dHMgLSAxO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGU6IHtcbiAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICBwbGF5ZXJzOiB7XG4gICAgICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICAgICAgW2FjdGlvbi5wbGF5ZXJdOiB7IC4uLnAsIHRpbWVvdXRzOiByZW1haW5pbmcgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBldmVudHM6IFt7IHR5cGU6IFwiVElNRU9VVF9DQUxMRURcIiwgcGxheWVyOiBhY3Rpb24ucGxheWVyLCByZW1haW5pbmcgfV0sXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJBQ0NFUFRfUEVOQUxUWVwiOlxuICAgIGNhc2UgXCJERUNMSU5FX1BFTkFMVFlcIjpcbiAgICAgIC8vIFBlbmFsdGllcyBhcmUgY2FwdHVyZWQgYXMgZXZlbnRzIGF0IHJlc29sdXRpb24gdGltZSwgYnV0IGFjY2VwdC9kZWNsaW5lXG4gICAgICAvLyBmbG93IHJlcXVpcmVzIHN0YXRlIG5vdCB5ZXQgbW9kZWxlZCAocGVuZGluZyBwZW5hbHR5KS4gVE9ETyB3aGVuXG4gICAgICAvLyBwZW5hbHR5IG1lY2hhbmljcyBhcmUgcG9ydGVkIGZyb20gcnVuLmpzLlxuICAgICAgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcblxuICAgIGNhc2UgXCJQQVRfQ0hPSUNFXCI6IHtcbiAgICAgIGNvbnN0IHNjb3JlciA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gICAgICAvLyAzT1QrIHJlcXVpcmVzIDItcG9pbnQgY29udmVyc2lvbi4gU2lsZW50bHkgc3Vic3RpdHV0ZSBldmVuIGlmIFwia2lja1wiXG4gICAgICAvLyB3YXMgc2VudCAobWF0Y2hlcyB2NS4xJ3MgXCJtdXN0XCIgYmVoYXZpb3IgYXQgcnVuLmpzOjE2NDEpLlxuICAgICAgY29uc3QgZWZmZWN0aXZlQ2hvaWNlID1cbiAgICAgICAgc3RhdGUub3ZlcnRpbWUgJiYgc3RhdGUub3ZlcnRpbWUucGVyaW9kID49IDNcbiAgICAgICAgICA/IFwidHdvX3BvaW50XCJcbiAgICAgICAgICA6IGFjdGlvbi5jaG9pY2U7XG4gICAgICBpZiAoZWZmZWN0aXZlQ2hvaWNlID09PSBcImtpY2tcIikge1xuICAgICAgICAvLyBBc3N1bWUgYXV0b21hdGljIGluIHY1LjEgXHUyMDE0IG5vIG1lY2hhbmljIHJlY29yZGVkIGZvciBQQVQga2lja3MuXG4gICAgICAgIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgICAgICBbc2NvcmVyXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0uc2NvcmUgKyAxIH0sXG4gICAgICAgIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdGF0ZToge1xuICAgICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgZXZlbnRzOiBbeyB0eXBlOiBcIlBBVF9HT09EXCIsIHBsYXllcjogc2NvcmVyIH1dLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgLy8gdHdvX3BvaW50IFx1MjE5MiB0cmFuc2l0aW9uIHRvIFRXT19QVF9DT05WIHBoYXNlOyBhIFBJQ0tfUExBWSByZXNvbHZlcyBpdC5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgcGhhc2U6IFwiVFdPX1BUX0NPTlZcIixcbiAgICAgICAgICBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgYmFsbE9uOiA5NywgZmlyc3REb3duQXQ6IDEwMCwgZG93bjogMSB9LFxuICAgICAgICB9LFxuICAgICAgICBldmVudHM6IFtdLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiRk9VUlRIX0RPV05fQ0hPSUNFXCI6IHtcbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlID09PSBcImdvXCIpIHtcbiAgICAgICAgLy8gTm90aGluZyB0byBkbyBcdTIwMTQgdGhlIG5leHQgUElDS19QTEFZIHdpbGwgcmVzb2x2ZSBub3JtYWxseSBmcm9tIDR0aCBkb3duLlxuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgfVxuICAgICAgaWYgKGFjdGlvbi5jaG9pY2UgPT09IFwicHVudFwiKSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHJlc29sdmVQdW50KHN0YXRlLCBybmcpO1xuICAgICAgICByZXR1cm4geyBzdGF0ZTogcmVzdWx0LnN0YXRlLCBldmVudHM6IHJlc3VsdC5ldmVudHMgfTtcbiAgICAgIH1cbiAgICAgIC8vIGZnXG4gICAgICBjb25zdCByZXN1bHQgPSByZXNvbHZlRmllbGRHb2FsKHN0YXRlLCBybmcpO1xuICAgICAgcmV0dXJuIHsgc3RhdGU6IHJlc3VsdC5zdGF0ZSwgZXZlbnRzOiByZXN1bHQuZXZlbnRzIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIkZPUkZFSVRcIjoge1xuICAgICAgY29uc3Qgd2lubmVyID0gb3BwKGFjdGlvbi5wbGF5ZXIpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGU6IHsgLi4uc3RhdGUsIHBoYXNlOiBcIkdBTUVfT1ZFUlwiIH0sXG4gICAgICAgIGV2ZW50czogW3sgdHlwZTogXCJHQU1FX09WRVJcIiwgd2lubmVyIH1dLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiVElDS19DTE9DS1wiOiB7XG4gICAgICBjb25zdCBwcmV2ID0gc3RhdGUuY2xvY2suc2Vjb25kc1JlbWFpbmluZztcbiAgICAgIGNvbnN0IG5leHQgPSBNYXRoLm1heCgwLCBwcmV2IC0gYWN0aW9uLnNlY29uZHMpO1xuICAgICAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW3sgdHlwZTogXCJDTE9DS19USUNLRURcIiwgc2Vjb25kczogYWN0aW9uLnNlY29uZHMgfV07XG5cbiAgICAgIC8vIFR3by1taW51dGUgd2FybmluZzogY3Jvc3NpbmcgMTIwIHNlY29uZHMgaW4gUTIgb3IgUTQgdHJpZ2dlcnMgYW4gZXZlbnQuXG4gICAgICBpZiAoXG4gICAgICAgIChzdGF0ZS5jbG9jay5xdWFydGVyID09PSAyIHx8IHN0YXRlLmNsb2NrLnF1YXJ0ZXIgPT09IDQpICYmXG4gICAgICAgIHByZXYgPiAxMjAgJiZcbiAgICAgICAgbmV4dCA8PSAxMjBcbiAgICAgICkge1xuICAgICAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFdPX01JTlVURV9XQVJOSU5HXCIgfSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChuZXh0ID09PSAwKSB7XG4gICAgICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJRVUFSVEVSX0VOREVEXCIsIHF1YXJ0ZXI6IHN0YXRlLmNsb2NrLnF1YXJ0ZXIgfSk7XG4gICAgICAgIC8vIFExXHUyMTkyUTIgYW5kIFEzXHUyMTkyUTQ6IHJvbGwgb3ZlciBjbG9jaywgc2FtZSBoYWxmLCBzYW1lIHBvc3Nlc3Npb24gY29udGludWVzLlxuICAgICAgICBpZiAoc3RhdGUuY2xvY2sucXVhcnRlciA9PT0gMSB8fCBzdGF0ZS5jbG9jay5xdWFydGVyID09PSAzKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgICAgICBjbG9jazoge1xuICAgICAgICAgICAgICAgIC4uLnN0YXRlLmNsb2NrLFxuICAgICAgICAgICAgICAgIHF1YXJ0ZXI6IHN0YXRlLmNsb2NrLnF1YXJ0ZXIgKyAxLFxuICAgICAgICAgICAgICAgIHNlY29uZHNSZW1haW5pbmc6IHN0YXRlLmNsb2NrLnF1YXJ0ZXJMZW5ndGhNaW51dGVzICogNjAsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZXZlbnRzLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgLy8gRW5kIG9mIFEyID0gaGFsZnRpbWUuIFE0IGVuZCA9IHJlZ3VsYXRpb24gb3Zlci5cbiAgICAgICAgaWYgKHN0YXRlLmNsb2NrLnF1YXJ0ZXIgPT09IDIpIHtcbiAgICAgICAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiSEFMRl9FTkRFRFwiIH0pO1xuICAgICAgICAgIC8vIFJlY2VpdmVyIG9mIG9wZW5pbmcga2lja29mZiBraWNrcyB0aGUgc2Vjb25kIGhhbGY7IGZsaXAgcG9zc2Vzc2lvbi5cbiAgICAgICAgICBjb25zdCBzZWNvbmRIYWxmUmVjZWl2ZXIgPVxuICAgICAgICAgICAgc3RhdGUub3BlbmluZ1JlY2VpdmVyID09PSBudWxsID8gMSA6IG9wcChzdGF0ZS5vcGVuaW5nUmVjZWl2ZXIpO1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0ZToge1xuICAgICAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgICAgICAgICAgICBjbG9jazoge1xuICAgICAgICAgICAgICAgIC4uLnN0YXRlLmNsb2NrLFxuICAgICAgICAgICAgICAgIHF1YXJ0ZXI6IDMsXG4gICAgICAgICAgICAgICAgc2Vjb25kc1JlbWFpbmluZzogc3RhdGUuY2xvY2sucXVhcnRlckxlbmd0aE1pbnV0ZXMgKiA2MCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IG9wcChzZWNvbmRIYWxmUmVjZWl2ZXIpIH0sXG4gICAgICAgICAgICAgIC8vIFJlZnJlc2ggdGltZW91dHMgZm9yIG5ldyBoYWxmLlxuICAgICAgICAgICAgICBwbGF5ZXJzOiB7XG4gICAgICAgICAgICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgICAgICAgICAgICAxOiB7IC4uLnN0YXRlLnBsYXllcnNbMV0sIHRpbWVvdXRzOiAzIH0sXG4gICAgICAgICAgICAgICAgMjogeyAuLi5zdGF0ZS5wbGF5ZXJzWzJdLCB0aW1lb3V0czogMyB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGV2ZW50cyxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIC8vIFE0IGVuZGVkLlxuICAgICAgICBjb25zdCBwMSA9IHN0YXRlLnBsYXllcnNbMV0uc2NvcmU7XG4gICAgICAgIGNvbnN0IHAyID0gc3RhdGUucGxheWVyc1syXS5zY29yZTtcbiAgICAgICAgaWYgKHAxICE9PSBwMikge1xuICAgICAgICAgIGNvbnN0IHdpbm5lciA9IHAxID4gcDIgPyAxIDogMjtcbiAgICAgICAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiR0FNRV9PVkVSXCIsIHdpbm5lciB9KTtcbiAgICAgICAgICByZXR1cm4geyBzdGF0ZTogeyAuLi5zdGF0ZSwgcGhhc2U6IFwiR0FNRV9PVkVSXCIgfSwgZXZlbnRzIH07XG4gICAgICAgIH1cbiAgICAgICAgLy8gVGllZCBcdTIwMTQgaGVhZCB0byBvdmVydGltZS5cbiAgICAgICAgY29uc3Qgb3RDbG9jayA9IHsgLi4uc3RhdGUuY2xvY2ssIHF1YXJ0ZXI6IDUsIHNlY29uZHNSZW1haW5pbmc6IDAgfTtcbiAgICAgICAgY29uc3Qgb3QgPSBzdGFydE92ZXJ0aW1lKHsgLi4uc3RhdGUsIGNsb2NrOiBvdENsb2NrIH0pO1xuICAgICAgICBldmVudHMucHVzaCguLi5vdC5ldmVudHMpO1xuICAgICAgICByZXR1cm4geyBzdGF0ZTogb3Quc3RhdGUsIGV2ZW50cyB9O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0ZTogeyAuLi5zdGF0ZSwgY2xvY2s6IHsgLi4uc3RhdGUuY2xvY2ssIHNlY29uZHNSZW1haW5pbmc6IG5leHQgfSB9LFxuICAgICAgICBldmVudHMsXG4gICAgICB9O1xuICAgIH1cblxuICAgIGRlZmF1bHQ6IHtcbiAgICAgIC8vIEV4aGF1c3RpdmVuZXNzIGNoZWNrIFx1MjAxNCBhZGRpbmcgYSBuZXcgQWN0aW9uIHZhcmlhbnQgd2l0aG91dCBoYW5kbGluZyBpdFxuICAgICAgLy8gaGVyZSB3aWxsIHByb2R1Y2UgYSBjb21waWxlIGVycm9yLlxuICAgICAgY29uc3QgX2V4aGF1c3RpdmU6IG5ldmVyID0gYWN0aW9uO1xuICAgICAgdm9pZCBfZXhoYXVzdGl2ZTtcbiAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogQ29udmVuaWVuY2UgZm9yIHJlcGxheWluZyBhIHNlcXVlbmNlIG9mIGFjdGlvbnMgXHUyMDE0IHVzZWZ1bCBmb3IgdGVzdHMgYW5kXG4gKiBmb3Igc2VydmVyLXNpZGUgZ2FtZSByZXBsYXkgZnJvbSBhY3Rpb24gbG9nLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVkdWNlTWFueShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgYWN0aW9uczogQWN0aW9uW10sXG4gIHJuZzogUm5nLFxuKTogUmVkdWNlUmVzdWx0IHtcbiAgbGV0IGN1cnJlbnQgPSBzdGF0ZTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG4gIGZvciAoY29uc3QgYWN0aW9uIG9mIGFjdGlvbnMpIHtcbiAgICBjb25zdCByZXN1bHQgPSByZWR1Y2UoY3VycmVudCwgYWN0aW9uLCBybmcpO1xuICAgIGN1cnJlbnQgPSByZXN1bHQuc3RhdGU7XG4gICAgZXZlbnRzLnB1c2goLi4ucmVzdWx0LmV2ZW50cyk7XG4gIH1cbiAgcmV0dXJuIHsgc3RhdGU6IGN1cnJlbnQsIGV2ZW50cyB9O1xufVxuIiwgIi8qKlxuICogUk5HIGFic3RyYWN0aW9uLlxuICpcbiAqIFRoZSBlbmdpbmUgbmV2ZXIgcmVhY2hlcyBmb3IgYE1hdGgucmFuZG9tKClgIGRpcmVjdGx5LiBBbGwgcmFuZG9tbmVzcyBpc1xuICogc291cmNlZCBmcm9tIGFuIGBSbmdgIGluc3RhbmNlIHBhc3NlZCBpbnRvIGByZWR1Y2UoKWAuIFRoaXMgaXMgd2hhdCBtYWtlc1xuICogdGhlIGVuZ2luZSBkZXRlcm1pbmlzdGljIGFuZCB0ZXN0YWJsZS5cbiAqXG4gKiBJbiBwcm9kdWN0aW9uLCB0aGUgU3VwYWJhc2UgRWRnZSBGdW5jdGlvbiBjcmVhdGVzIGEgc2VlZGVkIFJORyBwZXIgZ2FtZVxuICogKHNlZWQgc3RvcmVkIGFsb25nc2lkZSBnYW1lIHN0YXRlKSwgc28gYSBjb21wbGV0ZSBnYW1lIGNhbiBiZSByZXBsYXllZFxuICogZGV0ZXJtaW5pc3RpY2FsbHkgZnJvbSBpdHMgYWN0aW9uIGxvZyBcdTIwMTQgdXNlZnVsIGZvciBidWcgcmVwb3J0cywgcmVjYXBcbiAqIGdlbmVyYXRpb24sIGFuZCBcIndhdGNoIHRoZSBnYW1lIGJhY2tcIiBmZWF0dXJlcy5cbiAqL1xuXG5leHBvcnQgaW50ZXJmYWNlIFJuZyB7XG4gIC8qKiBJbmNsdXNpdmUgYm90aCBlbmRzLiAqL1xuICBpbnRCZXR3ZWVuKG1pbkluY2x1c2l2ZTogbnVtYmVyLCBtYXhJbmNsdXNpdmU6IG51bWJlcik6IG51bWJlcjtcbiAgLyoqIFJldHVybnMgXCJoZWFkc1wiIG9yIFwidGFpbHNcIi4gKi9cbiAgY29pbkZsaXAoKTogXCJoZWFkc1wiIHwgXCJ0YWlsc1wiO1xuICAvKiogUmV0dXJucyAxLTYuICovXG4gIGQ2KCk6IDEgfCAyIHwgMyB8IDQgfCA1IHwgNjtcbn1cblxuLyoqXG4gKiBNdWxiZXJyeTMyIFx1MjAxNCBhIHNtYWxsLCBmYXN0LCB3ZWxsLWRpc3RyaWJ1dGVkIHNlZWRlZCBQUk5HLiBTdWZmaWNpZW50IGZvclxuICogYSBjYXJkLWRyYXdpbmcgZm9vdGJhbGwgZ2FtZTsgbm90IGZvciBjcnlwdG9ncmFwaHkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZWVkZWRSbmcoc2VlZDogbnVtYmVyKTogUm5nIHtcbiAgbGV0IHN0YXRlID0gc2VlZCA+Pj4gMDtcblxuICBjb25zdCBuZXh0ID0gKCk6IG51bWJlciA9PiB7XG4gICAgc3RhdGUgPSAoc3RhdGUgKyAweDZkMmI3OWY1KSA+Pj4gMDtcbiAgICBsZXQgdCA9IHN0YXRlO1xuICAgIHQgPSBNYXRoLmltdWwodCBeICh0ID4+PiAxNSksIHQgfCAxKTtcbiAgICB0IF49IHQgKyBNYXRoLmltdWwodCBeICh0ID4+PiA3KSwgdCB8IDYxKTtcbiAgICByZXR1cm4gKCh0IF4gKHQgPj4+IDE0KSkgPj4+IDApIC8gNDI5NDk2NzI5NjtcbiAgfTtcblxuICByZXR1cm4ge1xuICAgIGludEJldHdlZW4obWluLCBtYXgpIHtcbiAgICAgIHJldHVybiBNYXRoLmZsb29yKG5leHQoKSAqIChtYXggLSBtaW4gKyAxKSkgKyBtaW47XG4gICAgfSxcbiAgICBjb2luRmxpcCgpIHtcbiAgICAgIHJldHVybiBuZXh0KCkgPCAwLjUgPyBcImhlYWRzXCIgOiBcInRhaWxzXCI7XG4gICAgfSxcbiAgICBkNigpIHtcbiAgICAgIHJldHVybiAoTWF0aC5mbG9vcihuZXh0KCkgKiA2KSArIDEpIGFzIDEgfCAyIHwgMyB8IDQgfCA1IHwgNjtcbiAgICB9LFxuICB9O1xufVxuIiwgIi8qKlxuICogUHVyZSBvdXRjb21lLXRhYmxlIGhlbHBlcnMgZm9yIHNwZWNpYWwgcGxheXMuIFRoZXNlIGFyZSBleHRyYWN0ZWRcbiAqIGZyb20gdGhlIGZ1bGwgcmVzb2x2ZXJzIHNvIHRoYXQgY29uc3VtZXJzIChsaWtlIHY1LjEncyBhc3luYyBjb2RlXG4gKiBwYXRocykgY2FuIGxvb2sgdXAgdGhlIHJ1bGUgb3V0Y29tZSB3aXRob3V0IHJ1bm5pbmcgdGhlIGVuZ2luZSdzXG4gKiBzdGF0ZSB0cmFuc2l0aW9uLlxuICpcbiAqIE9uY2UgUGhhc2UgMiBjb2xsYXBzZXMgdGhlIG9yY2hlc3RyYXRvciBpbnRvIGBlbmdpbmUucmVkdWNlYCwgdGhlc2VcbiAqIGhlbHBlcnMgYmVjb21lIGFuIGludGVybmFsIGltcGxlbWVudGF0aW9uIGRldGFpbC4gVW50aWwgdGhlbiwgdGhleVxuICogbGV0IHY1LjEgdXNlIHRoZSBlbmdpbmUgYXMgdGhlIHNvdXJjZSBvZiB0cnV0aCBmb3IgZ2FtZSBydWxlcyB3aGlsZVxuICoga2VlcGluZyBpdHMgaW1wZXJhdGl2ZSBmbG93LlxuICovXG5cbmltcG9ydCB0eXBlIHsgTXVsdGlwbGllckNhcmROYW1lIH0gZnJvbSBcIi4uL3lhcmRhZ2UuanNcIjtcbmltcG9ydCB0eXBlIHsgUGxheWVySWQgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcblxuLy8gLS0tLS0tLS0tLSBTYW1lIFBsYXkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIFNhbWVQbGF5T3V0Y29tZSA9XG4gIHwgeyBraW5kOiBcImJpZ19wbGF5XCI7IGJlbmVmaWNpYXJ5OiBcIm9mZmVuc2VcIiB8IFwiZGVmZW5zZVwiIH1cbiAgfCB7IGtpbmQ6IFwibXVsdGlwbGllclwiOyB2YWx1ZTogbnVtYmVyOyBkcmF3WWFyZHM6IGJvb2xlYW4gfVxuICB8IHsga2luZDogXCJpbnRlcmNlcHRpb25cIiB9XG4gIHwgeyBraW5kOiBcIm5vX2dhaW5cIiB9O1xuXG4vKipcbiAqIHY1LjEncyBTYW1lIFBsYXkgdGFibGUgKHJ1bi5qczoxODk5KS5cbiAqXG4gKiAgIEtpbmcgICAgXHUyMTkyIEJpZyBQbGF5IChvZmZlbnNlIGlmIGhlYWRzLCBkZWZlbnNlIGlmIHRhaWxzKVxuICogICBRdWVlbiArIGhlYWRzIFx1MjE5MiArM3ggbXVsdGlwbGllciAoZHJhdyB5YXJkcylcbiAqICAgUXVlZW4gKyB0YWlscyBcdTIxOTIgMHggbXVsdGlwbGllciAobm8geWFyZHMsIG5vIGdhaW4pXG4gKiAgIEphY2sgICsgaGVhZHMgXHUyMTkyIDB4IG11bHRpcGxpZXJcbiAqICAgSmFjayAgKyB0YWlscyBcdTIxOTIgLTN4IG11bHRpcGxpZXIgKGRyYXcgeWFyZHMpXG4gKiAgIDEwICAgICsgaGVhZHMgXHUyMTkyIElOVEVSQ0VQVElPTlxuICogICAxMCAgICArIHRhaWxzIFx1MjE5MiAwIHlhcmRzIChubyBtZWNoYW5pYylcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbWVQbGF5T3V0Y29tZShcbiAgY2FyZDogTXVsdGlwbGllckNhcmROYW1lLFxuICBjb2luOiBcImhlYWRzXCIgfCBcInRhaWxzXCIsXG4pOiBTYW1lUGxheU91dGNvbWUge1xuICBjb25zdCBoZWFkcyA9IGNvaW4gPT09IFwiaGVhZHNcIjtcbiAgaWYgKGNhcmQgPT09IFwiS2luZ1wiKSByZXR1cm4geyBraW5kOiBcImJpZ19wbGF5XCIsIGJlbmVmaWNpYXJ5OiBoZWFkcyA/IFwib2ZmZW5zZVwiIDogXCJkZWZlbnNlXCIgfTtcbiAgaWYgKGNhcmQgPT09IFwiMTBcIikgcmV0dXJuIGhlYWRzID8geyBraW5kOiBcImludGVyY2VwdGlvblwiIH0gOiB7IGtpbmQ6IFwibm9fZ2FpblwiIH07XG4gIGlmIChjYXJkID09PSBcIlF1ZWVuXCIpIHtcbiAgICByZXR1cm4gaGVhZHNcbiAgICAgID8geyBraW5kOiBcIm11bHRpcGxpZXJcIiwgdmFsdWU6IDMsIGRyYXdZYXJkczogdHJ1ZSB9XG4gICAgICA6IHsga2luZDogXCJtdWx0aXBsaWVyXCIsIHZhbHVlOiAwLCBkcmF3WWFyZHM6IGZhbHNlIH07XG4gIH1cbiAgLy8gSmFja1xuICByZXR1cm4gaGVhZHNcbiAgICA/IHsga2luZDogXCJtdWx0aXBsaWVyXCIsIHZhbHVlOiAwLCBkcmF3WWFyZHM6IGZhbHNlIH1cbiAgICA6IHsga2luZDogXCJtdWx0aXBsaWVyXCIsIHZhbHVlOiAtMywgZHJhd1lhcmRzOiB0cnVlIH07XG59XG5cbi8vIC0tLS0tLS0tLS0gVHJpY2sgUGxheSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgdHlwZSBUcmlja1BsYXlPdXRjb21lID1cbiAgfCB7IGtpbmQ6IFwiYmlnX3BsYXlcIjsgYmVuZWZpY2lhcnk6IFBsYXllcklkIH1cbiAgfCB7IGtpbmQ6IFwicGVuYWx0eVwiOyByYXdZYXJkczogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6IFwibXVsdGlwbGllclwiOyB2YWx1ZTogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6IFwib3ZlcmxheVwiOyBwbGF5OiBcIkxQXCIgfCBcIkxSXCI7IGJvbnVzOiBudW1iZXIgfTtcblxuLyoqXG4gKiB2NS4xJ3MgVHJpY2sgUGxheSB0YWJsZSAocnVuLmpzOjE5ODcpLiBDYWxsZXIgPSBwbGF5ZXIgd2hvIGNhbGxlZCB0aGVcbiAqIFRyaWNrIFBsYXkgKG9mZmVuc2Ugb3IgZGVmZW5zZSkuIERpZSByb2xsIG91dGNvbWVzIChmcm9tIGNhbGxlcidzIFBPVik6XG4gKlxuICogICAxIFx1MjE5MiBvdmVybGF5IExQIHdpdGggKzUgYm9udXMgKHNpZ25zIGZsaXAgZm9yIGRlZmVuc2l2ZSBjYWxsZXIpXG4gKiAgIDIgXHUyMTkyIDE1LXlhcmQgcGVuYWx0eSBvbiBvcHBvbmVudFxuICogICAzIFx1MjE5MiBmaXhlZCAtM3ggbXVsdGlwbGllciwgZHJhdyB5YXJkc1xuICogICA0IFx1MjE5MiBmaXhlZCArNHggbXVsdGlwbGllciwgZHJhdyB5YXJkc1xuICogICA1IFx1MjE5MiBCaWcgUGxheSBmb3IgY2FsbGVyXG4gKiAgIDYgXHUyMTkyIG92ZXJsYXkgTFIgd2l0aCArNSBib251c1xuICpcbiAqIGByYXdZYXJkc2Agb24gcGVuYWx0eSBpcyBzaWduZWQgZnJvbSBvZmZlbnNlIFBPVjogcG9zaXRpdmUgPSBnYWluIGZvclxuICogb2ZmZW5zZSAob2ZmZW5zaXZlIFRyaWNrIFBsYXkgcm9sbD0yKSwgbmVnYXRpdmUgPSBsb3NzIChkZWZlbnNpdmUpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gdHJpY2tQbGF5T3V0Y29tZShcbiAgY2FsbGVyOiBQbGF5ZXJJZCxcbiAgb2ZmZW5zZTogUGxheWVySWQsXG4gIGRpZTogMSB8IDIgfCAzIHwgNCB8IDUgfCA2LFxuKTogVHJpY2tQbGF5T3V0Y29tZSB7XG4gIGNvbnN0IGNhbGxlcklzT2ZmZW5zZSA9IGNhbGxlciA9PT0gb2ZmZW5zZTtcblxuICBpZiAoZGllID09PSA1KSByZXR1cm4geyBraW5kOiBcImJpZ19wbGF5XCIsIGJlbmVmaWNpYXJ5OiBjYWxsZXIgfTtcblxuICBpZiAoZGllID09PSAyKSB7XG4gICAgY29uc3QgcmF3WWFyZHMgPSBjYWxsZXJJc09mZmVuc2UgPyAxNSA6IC0xNTtcbiAgICByZXR1cm4geyBraW5kOiBcInBlbmFsdHlcIiwgcmF3WWFyZHMgfTtcbiAgfVxuXG4gIGlmIChkaWUgPT09IDMpIHJldHVybiB7IGtpbmQ6IFwibXVsdGlwbGllclwiLCB2YWx1ZTogLTMgfTtcbiAgaWYgKGRpZSA9PT0gNCkgcmV0dXJuIHsga2luZDogXCJtdWx0aXBsaWVyXCIsIHZhbHVlOiA0IH07XG5cbiAgLy8gZGllIDEgb3IgNlxuICBjb25zdCBwbGF5ID0gZGllID09PSAxID8gXCJMUFwiIDogXCJMUlwiO1xuICBjb25zdCBib251cyA9IGNhbGxlcklzT2ZmZW5zZSA/IDUgOiAtNTtcbiAgcmV0dXJuIHsga2luZDogXCJvdmVybGF5XCIsIHBsYXksIGJvbnVzIH07XG59XG5cbi8vIC0tLS0tLS0tLS0gQmlnIFBsYXkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgdHlwZSBCaWdQbGF5T3V0Y29tZSA9XG4gIHwgeyBraW5kOiBcIm9mZmVuc2VfZ2FpblwiOyB5YXJkczogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6IFwib2ZmZW5zZV90ZFwiIH1cbiAgfCB7IGtpbmQ6IFwiZGVmZW5zZV9wZW5hbHR5XCI7IHJhd1lhcmRzOiBudW1iZXIgfVxuICB8IHsga2luZDogXCJkZWZlbnNlX2Z1bWJsZV9yZXR1cm5cIjsgeWFyZHM6IG51bWJlciB9XG4gIHwgeyBraW5kOiBcImRlZmVuc2VfZnVtYmxlX3RkXCIgfTtcblxuLyoqXG4gKiB2NS4xJ3MgQmlnIFBsYXkgdGFibGUgKHJ1bi5qczoxOTMzKS4gYmVuZWZpY2lhcnkgPSB3aG8gYmVuZWZpdHNcbiAqIChvZmZlbnNlIG9yIGRlZmVuc2UpLlxuICpcbiAqIE9mZmVuc2U6XG4gKiAgIDEtMyBcdTIxOTIgKzI1IHlhcmRzXG4gKiAgIDQtNSBcdTIxOTIgbWF4KGhhbGYtdG8tZ29hbCwgNDApXG4gKiAgIDYgICBcdTIxOTIgVERcbiAqIERlZmVuc2U6XG4gKiAgIDEtMyBcdTIxOTIgMTAteWFyZCBwZW5hbHR5IG9uIG9mZmVuc2UgKHJlcGVhdCBkb3duKVxuICogICA0LTUgXHUyMTkyIGZ1bWJsZSwgZGVmZW5zZSByZXR1cm5zIG1heChoYWxmLXRvLWdvYWwsIDI1KVxuICogICA2ICAgXHUyMTkyIGZ1bWJsZSwgZGVmZW5zaXZlIFREXG4gKi9cbi8vIC0tLS0tLS0tLS0gUHVudCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBQdW50IHJldHVybiBtdWx0aXBsaWVyIGJ5IGRyYXduIG11bHRpcGxpZXIgY2FyZCAocnVuLmpzOjIxOTYpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHB1bnRSZXR1cm5NdWx0aXBsaWVyKGNhcmQ6IE11bHRpcGxpZXJDYXJkTmFtZSk6IG51bWJlciB7XG4gIHN3aXRjaCAoY2FyZCkge1xuICAgIGNhc2UgXCJLaW5nXCI6IHJldHVybiA3O1xuICAgIGNhc2UgXCJRdWVlblwiOiByZXR1cm4gNDtcbiAgICBjYXNlIFwiSmFja1wiOiByZXR1cm4gMTtcbiAgICBjYXNlIFwiMTBcIjogcmV0dXJuIC0wLjU7XG4gIH1cbn1cblxuLyoqXG4gKiBQdW50IGtpY2sgZGlzdGFuY2UgZm9ybXVsYSAocnVuLmpzOjIxNDMpOlxuICogICAxMCAqIHlhcmRzQ2FyZCAvIDIgKyAyMCAqIChjb2luID09PSBcImhlYWRzXCIgPyAxIDogMClcbiAqIHlhcmRzQ2FyZCBpcyB0aGUgMS0xMCBjYXJkLiBSYW5nZTogNS03MCB5YXJkcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHB1bnRLaWNrRGlzdGFuY2UoeWFyZHNDYXJkOiBudW1iZXIsIGNvaW46IFwiaGVhZHNcIiB8IFwidGFpbHNcIik6IG51bWJlciB7XG4gIHJldHVybiAoMTAgKiB5YXJkc0NhcmQpIC8gMiArIChjb2luID09PSBcImhlYWRzXCIgPyAyMCA6IDApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYmlnUGxheU91dGNvbWUoXG4gIGJlbmVmaWNpYXJ5OiBQbGF5ZXJJZCxcbiAgb2ZmZW5zZTogUGxheWVySWQsXG4gIGRpZTogMSB8IDIgfCAzIHwgNCB8IDUgfCA2LFxuICAvKiogYmFsbE9uIGZyb20gb2ZmZW5zZSBQT1YgKDAtMTAwKS4gKi9cbiAgYmFsbE9uOiBudW1iZXIsXG4pOiBCaWdQbGF5T3V0Y29tZSB7XG4gIGNvbnN0IGJlbmVmaXRzT2ZmZW5zZSA9IGJlbmVmaWNpYXJ5ID09PSBvZmZlbnNlO1xuXG4gIGlmIChiZW5lZml0c09mZmVuc2UpIHtcbiAgICBpZiAoZGllID09PSA2KSByZXR1cm4geyBraW5kOiBcIm9mZmVuc2VfdGRcIiB9O1xuICAgIGlmIChkaWUgPD0gMykgcmV0dXJuIHsga2luZDogXCJvZmZlbnNlX2dhaW5cIiwgeWFyZHM6IDI1IH07XG4gICAgY29uc3QgaGFsZlRvR29hbCA9IE1hdGgucm91bmQoKDEwMCAtIGJhbGxPbikgLyAyKTtcbiAgICByZXR1cm4geyBraW5kOiBcIm9mZmVuc2VfZ2FpblwiLCB5YXJkczogaGFsZlRvR29hbCA+IDQwID8gaGFsZlRvR29hbCA6IDQwIH07XG4gIH1cblxuICAvLyBEZWZlbnNlIGJlbmVmaWNpYXJ5XG4gIGlmIChkaWUgPD0gMykge1xuICAgIGNvbnN0IHJhd1lhcmRzID0gYmFsbE9uIC0gMTAgPCAxID8gLU1hdGguZmxvb3IoYmFsbE9uIC8gMikgOiAtMTA7XG4gICAgcmV0dXJuIHsga2luZDogXCJkZWZlbnNlX3BlbmFsdHlcIiwgcmF3WWFyZHMgfTtcbiAgfVxuICBpZiAoZGllID09PSA2KSByZXR1cm4geyBraW5kOiBcImRlZmVuc2VfZnVtYmxlX3RkXCIgfTtcbiAgY29uc3QgaGFsZlRvR29hbCA9IE1hdGgucm91bmQoKDEwMCAtIGJhbGxPbikgLyAyKTtcbiAgcmV0dXJuIHsga2luZDogXCJkZWZlbnNlX2Z1bWJsZV9yZXR1cm5cIiwgeWFyZHM6IGhhbGZUb0dvYWwgPiAyNSA/IGhhbGZUb0dvYWwgOiAyNSB9O1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQVNPLFNBQVMsVUFBVSxhQUFhLE9BQWE7QUFDbEQsU0FBTztBQUFBLElBQ0wsSUFBSTtBQUFBLElBQ0osSUFBSTtBQUFBLElBQ0osSUFBSTtBQUFBLElBQ0osSUFBSTtBQUFBLElBQ0osSUFBSTtBQUFBLElBQ0osSUFBSSxhQUFhLElBQUk7QUFBQSxFQUN2QjtBQUNGO0FBRU8sU0FBUyxhQUFvQjtBQUNsQyxTQUFPLEVBQUUsV0FBVyxHQUFHLFdBQVcsR0FBRyxXQUFXLEdBQUcsT0FBTyxFQUFFO0FBQzlEO0FBRU8sU0FBUyx1QkFBeUQ7QUFDdkUsU0FBTyxDQUFDLEdBQUcsR0FBRyxHQUFHLENBQUM7QUFDcEI7QUFFTyxTQUFTLGlCQUEyQjtBQUN6QyxTQUFPLENBQUMsR0FBRyxHQUFHLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxHQUFHLEdBQUcsQ0FBQztBQUN0QztBQVFPLFNBQVMsYUFBYSxNQUFtQztBQUM5RCxTQUFPO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxlQUFlO0FBQUEsSUFDZixPQUFPO0FBQUEsTUFDTCxTQUFTO0FBQUEsTUFDVCxrQkFBa0IsS0FBSyx1QkFBdUI7QUFBQSxNQUM5QyxzQkFBc0IsS0FBSztBQUFBLElBQzdCO0FBQUEsSUFDQSxPQUFPO0FBQUEsTUFDTCxRQUFRO0FBQUEsTUFDUixhQUFhO0FBQUEsTUFDYixNQUFNO0FBQUEsTUFDTixTQUFTO0FBQUEsSUFDWDtBQUFBLElBQ0EsTUFBTTtBQUFBLE1BQ0osYUFBYSxxQkFBcUI7QUFBQSxNQUNsQyxPQUFPLGVBQWU7QUFBQSxJQUN4QjtBQUFBLElBQ0EsU0FBUztBQUFBLE1BQ1AsR0FBRztBQUFBLFFBQ0QsTUFBTSxLQUFLO0FBQUEsUUFDWCxPQUFPO0FBQUEsUUFDUCxVQUFVO0FBQUEsUUFDVixNQUFNLFVBQVU7QUFBQSxRQUNoQixPQUFPLFdBQVc7QUFBQSxN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QyxTQUFPLEVBQUUsTUFBTSxXQUFXLE1BQU0sTUFBTTtBQUN4QztBQTJCTyxTQUFTLHFCQUFxQixNQUFrQztBQUNyRSxVQUFRLE1BQU07QUFBQSxJQUNaLEtBQUs7QUFBUSxhQUFPO0FBQUEsSUFDcEIsS0FBSztBQUFTLGFBQU87QUFBQSxJQUNyQixLQUFLO0FBQVEsYUFBTztBQUFBLElBQ3BCLEtBQUs7QUFBTSxhQUFPO0FBQUEsRUFDcEI7QUFDRjtBQU9PLFNBQVMsaUJBQWlCLFdBQW1CLE1BQWlDO0FBQ25GLFNBQVEsS0FBSyxZQUFhLEtBQUssU0FBUyxVQUFVLEtBQUs7QUFDekQ7QUFFTyxTQUFTLGVBQ2QsYUFDQSxTQUNBLEtBRUEsUUFDZ0I7QUFDaEIsUUFBTSxrQkFBa0IsZ0JBQWdCO0FBRXhDLE1BQUksaUJBQWlCO0FBQ25CLFFBQUksUUFBUSxFQUFHLFFBQU8sRUFBRSxNQUFNLGFBQWE7QUFDM0MsUUFBSSxPQUFPLEVBQUcsUUFBTyxFQUFFLE1BQU0sZ0JBQWdCLE9BQU8sR0FBRztBQUN2RCxVQUFNQyxjQUFhLEtBQUssT0FBTyxNQUFNLFVBQVUsQ0FBQztBQUNoRCxXQUFPLEVBQUUsTUFBTSxnQkFBZ0IsT0FBT0EsY0FBYSxLQUFLQSxjQUFhLEdBQUc7QUFBQSxFQUMxRTtBQUdBLE1BQUksT0FBTyxHQUFHO0FBQ1osVUFBTSxXQUFXLFNBQVMsS0FBSyxJQUFJLENBQUMsS0FBSyxNQUFNLFNBQVMsQ0FBQyxJQUFJO0FBQzdELFdBQU8sRUFBRSxNQUFNLG1CQUFtQixTQUFTO0FBQUEsRUFDN0M7QUFDQSxNQUFJLFFBQVEsRUFBRyxRQUFPLEVBQUUsTUFBTSxvQkFBb0I7QUFDbEQsUUFBTSxhQUFhLEtBQUssT0FBTyxNQUFNLFVBQVUsQ0FBQztBQUNoRCxTQUFPLEVBQUUsTUFBTSx5QkFBeUIsT0FBTyxhQUFhLEtBQUssYUFBYSxHQUFHO0FBQ25GOyIsCiAgIm5hbWVzIjogWyJibGFua1BpY2siLCAiYmxhbmtQaWNrIiwgImhhbGZUb0dvYWwiLCAiYmxhbmtQaWNrIiwgImJsYW5rUGljayIsICJibGFua1BpY2siLCAiYmxhbmtQaWNrIiwgImJsYW5rUGljayIsICJtdWx0aXBsaWVyIiwgInlhcmRzRHJhdyIsICJ5YXJkcyIsICJibGFua1BpY2siLCAiYmxhbmtQaWNrIiwgInN0YXRlV2l0aFBpY2siLCAicmVzdWx0IiwgImhhbGZUb0dvYWwiXQp9Cg==
