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
    lastPlayDescription: "Start of game"
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
      phase: "KICKOFF"
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
function resolveKickoff(state, rng) {
  const kickingState = {
    ...state,
    field: { ...state.field, ballOn: 35 }
  };
  const result = resolvePunt(kickingState, rng, { safetyKick: true });
  return {
    ...result,
    state: { ...result.state, phase: "REG_PLAY" }
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
      const result = resolveKickoff(state, rng);
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
export {
  MATCHUP,
  MULTI,
  computeYardage,
  emptyHand,
  emptyStats,
  endOvertimePossession,
  initialState,
  matchupQuality,
  opp,
  reduce,
  reduceMany,
  seededRng,
  startOvertime,
  startOvertimePossession
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9zdGF0ZS50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL21hdGNodXAudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy95YXJkYWdlLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvZGVjay50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3BsYXkudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9zaGFyZWQudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9iaWdQbGF5LnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvcHVudC50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL2tpY2tvZmYudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9oYWlsTWFyeS50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL3NhbWVQbGF5LnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvdHJpY2tQbGF5LnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvZmllbGRHb2FsLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvb3ZlcnRpbWUudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9yZWR1Y2VyLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcm5nLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvKipcbiAqIFN0YXRlIGZhY3Rvcmllcy5cbiAqXG4gKiBgaW5pdGlhbFN0YXRlKClgIHByb2R1Y2VzIGEgZnJlc2ggR2FtZVN0YXRlIGluIElOSVQgcGhhc2UuIEV2ZXJ5dGhpbmcgZWxzZVxuICogZmxvd3MgZnJvbSByZWR1Y2luZyBhY3Rpb25zIG92ZXIgdGhpcyBzdGFydGluZyBwb2ludC5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgSGFuZCwgUGxheWVySWQsIFN0YXRzLCBUZWFtUmVmIH0gZnJvbSBcIi4vdHlwZXMuanNcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIGVtcHR5SGFuZChpc092ZXJ0aW1lID0gZmFsc2UpOiBIYW5kIHtcbiAgcmV0dXJuIHtcbiAgICBTUjogMyxcbiAgICBMUjogMyxcbiAgICBTUDogMyxcbiAgICBMUDogMyxcbiAgICBUUDogMSxcbiAgICBITTogaXNPdmVydGltZSA/IDIgOiAzLFxuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZW1wdHlTdGF0cygpOiBTdGF0cyB7XG4gIHJldHVybiB7IHBhc3NZYXJkczogMCwgcnVzaFlhcmRzOiAwLCB0dXJub3ZlcnM6IDAsIHNhY2tzOiAwIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmcmVzaERlY2tNdWx0aXBsaWVycygpOiBbbnVtYmVyLCBudW1iZXIsIG51bWJlciwgbnVtYmVyXSB7XG4gIHJldHVybiBbNCwgNCwgNCwgM107XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmcmVzaERlY2tZYXJkcygpOiBudW1iZXJbXSB7XG4gIHJldHVybiBbMSwgMSwgMSwgMSwgMSwgMSwgMSwgMSwgMSwgMV07XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSW5pdGlhbFN0YXRlQXJncyB7XG4gIHRlYW0xOiBUZWFtUmVmO1xuICB0ZWFtMjogVGVhbVJlZjtcbiAgcXVhcnRlckxlbmd0aE1pbnV0ZXM6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGluaXRpYWxTdGF0ZShhcmdzOiBJbml0aWFsU3RhdGVBcmdzKTogR2FtZVN0YXRlIHtcbiAgcmV0dXJuIHtcbiAgICBwaGFzZTogXCJJTklUXCIsXG4gICAgc2NoZW1hVmVyc2lvbjogMSxcbiAgICBjbG9jazoge1xuICAgICAgcXVhcnRlcjogMCxcbiAgICAgIHNlY29uZHNSZW1haW5pbmc6IGFyZ3MucXVhcnRlckxlbmd0aE1pbnV0ZXMgKiA2MCxcbiAgICAgIHF1YXJ0ZXJMZW5ndGhNaW51dGVzOiBhcmdzLnF1YXJ0ZXJMZW5ndGhNaW51dGVzLFxuICAgIH0sXG4gICAgZmllbGQ6IHtcbiAgICAgIGJhbGxPbjogMzUsXG4gICAgICBmaXJzdERvd25BdDogNDUsXG4gICAgICBkb3duOiAxLFxuICAgICAgb2ZmZW5zZTogMSxcbiAgICB9LFxuICAgIGRlY2s6IHtcbiAgICAgIG11bHRpcGxpZXJzOiBmcmVzaERlY2tNdWx0aXBsaWVycygpLFxuICAgICAgeWFyZHM6IGZyZXNoRGVja1lhcmRzKCksXG4gICAgfSxcbiAgICBwbGF5ZXJzOiB7XG4gICAgICAxOiB7XG4gICAgICAgIHRlYW06IGFyZ3MudGVhbTEsXG4gICAgICAgIHNjb3JlOiAwLFxuICAgICAgICB0aW1lb3V0czogMyxcbiAgICAgICAgaGFuZDogZW1wdHlIYW5kKCksXG4gICAgICAgIHN0YXRzOiBlbXB0eVN0YXRzKCksXG4gICAgICB9LFxuICAgICAgMjoge1xuICAgICAgICB0ZWFtOiBhcmdzLnRlYW0yLFxuICAgICAgICBzY29yZTogMCxcbiAgICAgICAgdGltZW91dHM6IDMsXG4gICAgICAgIGhhbmQ6IGVtcHR5SGFuZCgpLFxuICAgICAgICBzdGF0czogZW1wdHlTdGF0cygpLFxuICAgICAgfSxcbiAgICB9LFxuICAgIG9wZW5pbmdSZWNlaXZlcjogbnVsbCxcbiAgICBvdmVydGltZTogbnVsbCxcbiAgICBwZW5kaW5nUGljazogeyBvZmZlbnNlUGxheTogbnVsbCwgZGVmZW5zZVBsYXk6IG51bGwgfSxcbiAgICBsYXN0UGxheURlc2NyaXB0aW9uOiBcIlN0YXJ0IG9mIGdhbWVcIixcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG9wcChwOiBQbGF5ZXJJZCk6IFBsYXllcklkIHtcbiAgcmV0dXJuIHAgPT09IDEgPyAyIDogMTtcbn1cbiIsICIvKipcbiAqIFRoZSBwbGF5IG1hdGNodXAgbWF0cml4IFx1MjAxNCB0aGUgaGVhcnQgb2YgRm9vdEJvcmVkLlxuICpcbiAqIEJvdGggdGVhbXMgcGljayBhIHBsYXkuIFRoZSBtYXRyaXggc2NvcmVzIGhvdyAqY2xvc2VseSogdGhlIGRlZmVuc2VcbiAqIHByZWRpY3RlZCB0aGUgb2ZmZW5zaXZlIGNhbGw6XG4gKiAgIC0gMSA9IGRlZmVuc2Ugd2F5IG9mZiBcdTIxOTIgZ3JlYXQgZm9yIG9mZmVuc2VcbiAqICAgLSA1ID0gZGVmZW5zZSBtYXRjaGVkIFx1MjE5MiB0ZXJyaWJsZSBmb3Igb2ZmZW5zZSAoY29tYmluZWQgd2l0aCBhIGxvd1xuICogICAgICAgICBtdWx0aXBsaWVyIGNhcmQsIHRoaXMgYmVjb21lcyBhIGxvc3MgLyB0dXJub3ZlciByaXNrKVxuICpcbiAqIFJvd3MgPSBvZmZlbnNpdmUgY2FsbCwgQ29scyA9IGRlZmVuc2l2ZSBjYWxsLiBPcmRlcjogW1NSLCBMUiwgU1AsIExQXS5cbiAqXG4gKiAgICAgICAgICAgREVGOiBTUiAgTFIgIFNQICBMUFxuICogICBPRkY6IFNSICAgICBbIDUsICAzLCAgMywgIDIgXVxuICogICBPRkY6IExSICAgICBbIDIsICA0LCAgMSwgIDIgXVxuICogICBPRkY6IFNQICAgICBbIDMsICAyLCAgNSwgIDMgXVxuICogICBPRkY6IExQICAgICBbIDEsICAyLCAgMiwgIDQgXVxuICpcbiAqIFBvcnRlZCB2ZXJiYXRpbSBmcm9tIHB1YmxpYy9qcy9kZWZhdWx0cy5qcyBNQVRDSFVQLiBJbmRleGluZyBjb25maXJtZWRcbiAqIGFnYWluc3QgcGxheU1lY2hhbmlzbSAvIGNhbGNUaW1lcyBpbiBydW4uanM6MjM2OC5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IFJlZ3VsYXJQbGF5IH0gZnJvbSBcIi4uL3R5cGVzLmpzXCI7XG5cbmV4cG9ydCBjb25zdCBNQVRDSFVQOiBSZWFkb25seUFycmF5PFJlYWRvbmx5QXJyYXk8TWF0Y2h1cFF1YWxpdHk+PiA9IFtcbiAgWzUsIDMsIDMsIDJdLFxuICBbMiwgNCwgMSwgMl0sXG4gIFszLCAyLCA1LCAzXSxcbiAgWzEsIDIsIDIsIDRdLFxuXSBhcyBjb25zdDtcblxuZXhwb3J0IHR5cGUgTWF0Y2h1cFF1YWxpdHkgPSAxIHwgMiB8IDMgfCA0IHwgNTtcblxuY29uc3QgUExBWV9JTkRFWDogUmVjb3JkPFJlZ3VsYXJQbGF5LCAwIHwgMSB8IDIgfCAzPiA9IHtcbiAgU1I6IDAsXG4gIExSOiAxLFxuICBTUDogMixcbiAgTFA6IDMsXG59O1xuXG4vKipcbiAqIE11bHRpcGxpZXIgY2FyZCB2YWx1ZXMuIEluZGV4aW5nIChjb25maXJtZWQgaW4gcnVuLmpzOjIzNzcpOlxuICogICByb3cgICAgPSBtdWx0aXBsaWVyIGNhcmQgKDA9S2luZywgMT1RdWVlbiwgMj1KYWNrLCAzPTEwKVxuICogICBjb2x1bW4gPSBtYXRjaHVwIHF1YWxpdHkgLSAxIChzbyBjb2x1bW4gMCA9IHF1YWxpdHkgMSwgY29sdW1uIDQgPSBxdWFsaXR5IDUpXG4gKlxuICogUXVhbGl0eSAxIChvZmZlbnNlIG91dGd1ZXNzZWQgZGVmZW5zZSkgKyBLaW5nID0gNHguIEJlc3QgcG9zc2libGUgcGxheS5cbiAqIFF1YWxpdHkgNSAoZGVmZW5zZSBtYXRjaGVkKSArIDEwICAgICAgICA9IC0xeC4gV29yc3QgcmVndWxhciBwbGF5LlxuICpcbiAqICAgICAgICAgICAgICAgICAgcXVhbCAxICBxdWFsIDIgIHF1YWwgMyAgcXVhbCA0ICBxdWFsIDVcbiAqICAgS2luZyAgICAoMCkgIFsgICA0LCAgICAgIDMsICAgICAgMiwgICAgIDEuNSwgICAgIDEgICBdXG4gKiAgIFF1ZWVuICAgKDEpICBbICAgMywgICAgICAyLCAgICAgIDEsICAgICAgMSwgICAgIDAuNSAgXVxuICogICBKYWNrICAgICgyKSAgWyAgIDIsICAgICAgMSwgICAgIDAuNSwgICAgIDAsICAgICAgMCAgIF1cbiAqICAgMTAgICAgICAoMykgIFsgICAwLCAgICAgIDAsICAgICAgMCwgICAgIC0xLCAgICAgLTEgICBdXG4gKlxuICogUG9ydGVkIHZlcmJhdGltIGZyb20gcHVibGljL2pzL2RlZmF1bHRzLmpzIE1VTFRJLlxuICovXG5leHBvcnQgY29uc3QgTVVMVEk6IFJlYWRvbmx5QXJyYXk8UmVhZG9ubHlBcnJheTxudW1iZXI+PiA9IFtcbiAgWzQsIDMsIDIsIDEuNSwgMV0sXG4gIFszLCAyLCAxLCAxLCAwLjVdLFxuICBbMiwgMSwgMC41LCAwLCAwXSxcbiAgWzAsIDAsIDAsIC0xLCAtMV0sXG5dIGFzIGNvbnN0O1xuXG5leHBvcnQgZnVuY3Rpb24gbWF0Y2h1cFF1YWxpdHkob2ZmOiBSZWd1bGFyUGxheSwgZGVmOiBSZWd1bGFyUGxheSk6IE1hdGNodXBRdWFsaXR5IHtcbiAgY29uc3Qgcm93ID0gTUFUQ0hVUFtQTEFZX0lOREVYW29mZl1dO1xuICBpZiAoIXJvdykgdGhyb3cgbmV3IEVycm9yKGB1bnJlYWNoYWJsZTogYmFkIG9mZiBwbGF5ICR7b2ZmfWApO1xuICBjb25zdCBxID0gcm93W1BMQVlfSU5ERVhbZGVmXV07XG4gIGlmIChxID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihgdW5yZWFjaGFibGU6IGJhZCBkZWYgcGxheSAke2RlZn1gKTtcbiAgcmV0dXJuIHE7XG59XG4iLCAiLyoqXG4gKiBQdXJlIHlhcmRhZ2UgY2FsY3VsYXRpb24gZm9yIGEgcmVndWxhciBwbGF5IChTUi9MUi9TUC9MUCkuXG4gKlxuICogRm9ybXVsYSAocnVuLmpzOjIzMzcpOlxuICogICB5YXJkcyA9IHJvdW5kKG11bHRpcGxpZXIgKiB5YXJkc0NhcmQpICsgYm9udXNcbiAqXG4gKiBXaGVyZTpcbiAqICAgLSBtdWx0aXBsaWVyID0gTVVMVElbbXVsdGlwbGllckNhcmRdW3F1YWxpdHkgLSAxXVxuICogICAtIHF1YWxpdHkgICAgPSBNQVRDSFVQW29mZmVuc2VdW2RlZmVuc2VdICAgLy8gMS01XG4gKiAgIC0gYm9udXMgICAgICA9IHNwZWNpYWwtcGxheSBib251cyAoZS5nLiBUcmljayBQbGF5ICs1IG9uIExSL0xQIG91dGNvbWVzKVxuICpcbiAqIFNwZWNpYWwgcGxheXMgKFRQLCBITSwgRkcsIFBVTlQsIFRXT19QVCkgdXNlIGRpZmZlcmVudCBmb3JtdWxhcyBcdTIwMTQgdGhleVxuICogbGl2ZSBpbiBydWxlcy9zcGVjaWFsLnRzIChUT0RPKSBhbmQgcHJvZHVjZSBldmVudHMgZGlyZWN0bHkuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBSZWd1bGFyUGxheSB9IGZyb20gXCIuLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgTVVMVEksIG1hdGNodXBRdWFsaXR5IH0gZnJvbSBcIi4vbWF0Y2h1cC5qc1wiO1xuXG5leHBvcnQgdHlwZSBNdWx0aXBsaWVyQ2FyZEluZGV4ID0gMCB8IDEgfCAyIHwgMztcbmV4cG9ydCBjb25zdCBNVUxUSVBMSUVSX0NBUkRfTkFNRVMgPSBbXCJLaW5nXCIsIFwiUXVlZW5cIiwgXCJKYWNrXCIsIFwiMTBcIl0gYXMgY29uc3Q7XG5leHBvcnQgdHlwZSBNdWx0aXBsaWVyQ2FyZE5hbWUgPSAodHlwZW9mIE1VTFRJUExJRVJfQ0FSRF9OQU1FUylbbnVtYmVyXTtcblxuZXhwb3J0IGludGVyZmFjZSBZYXJkYWdlSW5wdXRzIHtcbiAgb2ZmZW5zZTogUmVndWxhclBsYXk7XG4gIGRlZmVuc2U6IFJlZ3VsYXJQbGF5O1xuICAvKiogTXVsdGlwbGllciBjYXJkIGluZGV4OiAwPUtpbmcsIDE9UXVlZW4sIDI9SmFjaywgMz0xMC4gKi9cbiAgbXVsdGlwbGllckNhcmQ6IE11bHRpcGxpZXJDYXJkSW5kZXg7XG4gIC8qKiBZYXJkcyBjYXJkIGRyYXduLCAxLTEwLiAqL1xuICB5YXJkc0NhcmQ6IG51bWJlcjtcbiAgLyoqIEJvbnVzIHlhcmRzIGZyb20gc3BlY2lhbC1wbGF5IG92ZXJsYXlzIChlLmcuIFRyaWNrIFBsYXkgKzUpLiAqL1xuICBib251cz86IG51bWJlcjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBZYXJkYWdlT3V0Y29tZSB7XG4gIG1hdGNodXBRdWFsaXR5OiBudW1iZXI7XG4gIG11bHRpcGxpZXI6IG51bWJlcjtcbiAgbXVsdGlwbGllckNhcmROYW1lOiBNdWx0aXBsaWVyQ2FyZE5hbWU7XG4gIHlhcmRzR2FpbmVkOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjb21wdXRlWWFyZGFnZShpbnB1dHM6IFlhcmRhZ2VJbnB1dHMpOiBZYXJkYWdlT3V0Y29tZSB7XG4gIGNvbnN0IHF1YWxpdHkgPSBtYXRjaHVwUXVhbGl0eShpbnB1dHMub2ZmZW5zZSwgaW5wdXRzLmRlZmVuc2UpO1xuICBjb25zdCBtdWx0aVJvdyA9IE1VTFRJW2lucHV0cy5tdWx0aXBsaWVyQ2FyZF07XG4gIGlmICghbXVsdGlSb3cpIHRocm93IG5ldyBFcnJvcihgdW5yZWFjaGFibGU6IGJhZCBtdWx0aSBjYXJkICR7aW5wdXRzLm11bHRpcGxpZXJDYXJkfWApO1xuICBjb25zdCBtdWx0aXBsaWVyID0gbXVsdGlSb3dbcXVhbGl0eSAtIDFdO1xuICBpZiAobXVsdGlwbGllciA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoYHVucmVhY2hhYmxlOiBiYWQgcXVhbGl0eSAke3F1YWxpdHl9YCk7XG5cbiAgY29uc3QgYm9udXMgPSBpbnB1dHMuYm9udXMgPz8gMDtcbiAgY29uc3QgeWFyZHNHYWluZWQgPSBNYXRoLnJvdW5kKG11bHRpcGxpZXIgKiBpbnB1dHMueWFyZHNDYXJkKSArIGJvbnVzO1xuXG4gIHJldHVybiB7XG4gICAgbWF0Y2h1cFF1YWxpdHk6IHF1YWxpdHksXG4gICAgbXVsdGlwbGllcixcbiAgICBtdWx0aXBsaWVyQ2FyZE5hbWU6IE1VTFRJUExJRVJfQ0FSRF9OQU1FU1tpbnB1dHMubXVsdGlwbGllckNhcmRdLFxuICAgIHlhcmRzR2FpbmVkLFxuICB9O1xufVxuIiwgIi8qKlxuICogQ2FyZC1kZWNrIGRyYXdzIFx1MjAxNCBwdXJlIHZlcnNpb25zIG9mIHY1LjEncyBgR2FtZS5kZWNNdWx0c2AgYW5kIGBHYW1lLmRlY1lhcmRzYC5cbiAqXG4gKiBUaGUgZGVjayBpcyByZXByZXNlbnRlZCBhcyBhbiBhcnJheSBvZiByZW1haW5pbmcgY291bnRzIHBlciBjYXJkIHNsb3QuXG4gKiBUbyBkcmF3LCB3ZSBwaWNrIGEgdW5pZm9ybSByYW5kb20gc2xvdDsgaWYgdGhhdCBzbG90IGlzIGVtcHR5LCB3ZSByZXRyeS5cbiAqIFRoaXMgaXMgbWF0aGVtYXRpY2FsbHkgZXF1aXZhbGVudCB0byBzaHVmZmxpbmcgdGhlIHJlbWFpbmluZyBjYXJkcyBhbmRcbiAqIGRyYXdpbmcgb25lIFx1MjAxNCBhbmQgbWF0Y2hlcyB2NS4xJ3MgYmVoYXZpb3IgdmVyYmF0aW0uXG4gKlxuICogV2hlbiB0aGUgZGVjayBpcyBleGhhdXN0ZWQsIHRoZSBjb25zdW1lciAodGhlIHJlZHVjZXIpIHJlZmlsbHMgaXQgYW5kXG4gKiBlbWl0cyBhIERFQ0tfU0hVRkZMRUQgZXZlbnQuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IERlY2tTdGF0ZSB9IGZyb20gXCIuLi90eXBlcy5qc1wiO1xuaW1wb3J0IHtcbiAgZnJlc2hEZWNrTXVsdGlwbGllcnMsXG4gIGZyZXNoRGVja1lhcmRzLFxufSBmcm9tIFwiLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7XG4gIE1VTFRJUExJRVJfQ0FSRF9OQU1FUyxcbiAgdHlwZSBNdWx0aXBsaWVyQ2FyZEluZGV4LFxuICB0eXBlIE11bHRpcGxpZXJDYXJkTmFtZSxcbn0gZnJvbSBcIi4veWFyZGFnZS5qc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIE11bHRpcGxpZXJEcmF3IHtcbiAgY2FyZDogTXVsdGlwbGllckNhcmROYW1lO1xuICBpbmRleDogTXVsdGlwbGllckNhcmRJbmRleDtcbiAgZGVjazogRGVja1N0YXRlO1xuICByZXNodWZmbGVkOiBib29sZWFuO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZHJhd011bHRpcGxpZXIoZGVjazogRGVja1N0YXRlLCBybmc6IFJuZyk6IE11bHRpcGxpZXJEcmF3IHtcbiAgY29uc3QgbXVsdHMgPSBbLi4uZGVjay5tdWx0aXBsaWVyc10gYXMgW251bWJlciwgbnVtYmVyLCBudW1iZXIsIG51bWJlcl07XG5cbiAgbGV0IGluZGV4OiBNdWx0aXBsaWVyQ2FyZEluZGV4O1xuICAvLyBSZWplY3Rpb24tc2FtcGxlIHRvIGRyYXcgdW5pZm9ybWx5IGFjcm9zcyByZW1haW5pbmcgY2FyZHMuXG4gIC8vIExvb3AgaXMgYm91bmRlZCBcdTIwMTQgdG90YWwgY2FyZHMgaW4gZnJlc2ggZGVjayBpcyAxNS5cbiAgZm9yICg7Oykge1xuICAgIGNvbnN0IGkgPSBybmcuaW50QmV0d2VlbigwLCAzKSBhcyBNdWx0aXBsaWVyQ2FyZEluZGV4O1xuICAgIGlmIChtdWx0c1tpXSA+IDApIHtcbiAgICAgIGluZGV4ID0gaTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIG11bHRzW2luZGV4XS0tO1xuXG4gIGxldCByZXNodWZmbGVkID0gZmFsc2U7XG4gIGxldCBuZXh0RGVjazogRGVja1N0YXRlID0geyAuLi5kZWNrLCBtdWx0aXBsaWVyczogbXVsdHMgfTtcbiAgaWYgKG11bHRzLmV2ZXJ5KChjKSA9PiBjID09PSAwKSkge1xuICAgIHJlc2h1ZmZsZWQgPSB0cnVlO1xuICAgIG5leHREZWNrID0geyAuLi5uZXh0RGVjaywgbXVsdGlwbGllcnM6IGZyZXNoRGVja011bHRpcGxpZXJzKCkgfTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgY2FyZDogTVVMVElQTElFUl9DQVJEX05BTUVTW2luZGV4XSxcbiAgICBpbmRleCxcbiAgICBkZWNrOiBuZXh0RGVjayxcbiAgICByZXNodWZmbGVkLFxuICB9O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFlhcmRzRHJhdyB7XG4gIC8qKiBZYXJkcyBjYXJkIHZhbHVlLCAxLTEwLiAqL1xuICBjYXJkOiBudW1iZXI7XG4gIGRlY2s6IERlY2tTdGF0ZTtcbiAgcmVzaHVmZmxlZDogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRyYXdZYXJkcyhkZWNrOiBEZWNrU3RhdGUsIHJuZzogUm5nKTogWWFyZHNEcmF3IHtcbiAgY29uc3QgeWFyZHMgPSBbLi4uZGVjay55YXJkc107XG5cbiAgbGV0IGluZGV4OiBudW1iZXI7XG4gIGZvciAoOzspIHtcbiAgICBjb25zdCBpID0gcm5nLmludEJldHdlZW4oMCwgeWFyZHMubGVuZ3RoIC0gMSk7XG4gICAgY29uc3Qgc2xvdCA9IHlhcmRzW2ldO1xuICAgIGlmIChzbG90ICE9PSB1bmRlZmluZWQgJiYgc2xvdCA+IDApIHtcbiAgICAgIGluZGV4ID0gaTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIHlhcmRzW2luZGV4XSA9ICh5YXJkc1tpbmRleF0gPz8gMCkgLSAxO1xuXG4gIGxldCByZXNodWZmbGVkID0gZmFsc2U7XG4gIGxldCBuZXh0RGVjazogRGVja1N0YXRlID0geyAuLi5kZWNrLCB5YXJkcyB9O1xuICBpZiAoeWFyZHMuZXZlcnkoKGMpID0+IGMgPT09IDApKSB7XG4gICAgcmVzaHVmZmxlZCA9IHRydWU7XG4gICAgbmV4dERlY2sgPSB7IC4uLm5leHREZWNrLCB5YXJkczogZnJlc2hEZWNrWWFyZHMoKSB9O1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBjYXJkOiBpbmRleCArIDEsXG4gICAgZGVjazogbmV4dERlY2ssXG4gICAgcmVzaHVmZmxlZCxcbiAgfTtcbn1cbiIsICIvKipcbiAqIFJlZ3VsYXItcGxheSByZXNvbHV0aW9uLiBTcGVjaWFsIHBsYXlzIChUUCwgSE0sIEZHLCBQVU5ULCBUV09fUFQpIGJyYW5jaFxuICogZWxzZXdoZXJlIFx1MjAxNCBzZWUgcnVsZXMvc3BlY2lhbC50cyAoVE9ETykuXG4gKlxuICogR2l2ZW4gdHdvIHBpY2tzIChvZmZlbnNlICsgZGVmZW5zZSkgYW5kIHRoZSBjdXJyZW50IHN0YXRlLCBwcm9kdWNlIGEgbmV3XG4gKiBzdGF0ZSBhbmQgdGhlIGV2ZW50IHN0cmVhbSBmb3IgdGhlIHBsYXkuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIFBsYXlDYWxsLCBSZWd1bGFyUGxheSB9IGZyb20gXCIuLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgZHJhd011bHRpcGxpZXIsIGRyYXdZYXJkcyB9IGZyb20gXCIuL2RlY2suanNcIjtcbmltcG9ydCB7IGNvbXB1dGVZYXJkYWdlIH0gZnJvbSBcIi4veWFyZGFnZS5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4uL3N0YXRlLmpzXCI7XG5cbmNvbnN0IFJFR1VMQVI6IFJlYWRvbmx5U2V0PFBsYXlDYWxsPiA9IG5ldyBTZXQoW1wiU1JcIiwgXCJMUlwiLCBcIlNQXCIsIFwiTFBcIl0pO1xuXG5leHBvcnQgZnVuY3Rpb24gaXNSZWd1bGFyUGxheShwOiBQbGF5Q2FsbCk6IHAgaXMgUmVndWxhclBsYXkge1xuICByZXR1cm4gUkVHVUxBUi5oYXMocCk7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVzb2x2ZUlucHV0IHtcbiAgb2ZmZW5zZVBsYXk6IFBsYXlDYWxsO1xuICBkZWZlbnNlUGxheTogUGxheUNhbGw7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGxheVJlc29sdXRpb24ge1xuICBzdGF0ZTogR2FtZVN0YXRlO1xuICBldmVudHM6IEV2ZW50W107XG59XG5cbi8qKlxuICogUmVzb2x2ZSBhIHJlZ3VsYXIgdnMgcmVndWxhciBwbGF5LiBDYWxsZXIgKHRoZSByZWR1Y2VyKSByb3V0ZXMgdG8gc3BlY2lhbFxuICogcGxheSBoYW5kbGVycyBpZiBlaXRoZXIgcGljayBpcyBub24tcmVndWxhci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVSZWd1bGFyUGxheShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgaW5wdXQ6IFJlc29sdmVJbnB1dCxcbiAgcm5nOiBSbmcsXG4pOiBQbGF5UmVzb2x1dGlvbiB7XG4gIGlmICghaXNSZWd1bGFyUGxheShpbnB1dC5vZmZlbnNlUGxheSkgfHwgIWlzUmVndWxhclBsYXkoaW5wdXQuZGVmZW5zZVBsYXkpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwicmVzb2x2ZVJlZ3VsYXJQbGF5IGNhbGxlZCB3aXRoIGEgbm9uLXJlZ3VsYXIgcGxheVwiKTtcbiAgfVxuXG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuXG4gIC8vIERyYXcgY2FyZHMuXG4gIGNvbnN0IG11bHREcmF3ID0gZHJhd011bHRpcGxpZXIoc3RhdGUuZGVjaywgcm5nKTtcbiAgaWYgKG11bHREcmF3LnJlc2h1ZmZsZWQpIHtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcIm11bHRpcGxpZXJcIiB9KTtcbiAgfVxuICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMobXVsdERyYXcuZGVjaywgcm5nKTtcbiAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSB7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuICB9XG5cbiAgLy8gQ29tcHV0ZSB5YXJkYWdlLlxuICBjb25zdCBvdXRjb21lID0gY29tcHV0ZVlhcmRhZ2Uoe1xuICAgIG9mZmVuc2U6IGlucHV0Lm9mZmVuc2VQbGF5LFxuICAgIGRlZmVuc2U6IGlucHV0LmRlZmVuc2VQbGF5LFxuICAgIG11bHRpcGxpZXJDYXJkOiBtdWx0RHJhdy5pbmRleCxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICB9KTtcblxuICAvLyBEZWNyZW1lbnQgb2ZmZW5zZSdzIGhhbmQgZm9yIHRoZSBwbGF5IHRoZXkgdXNlZC4gUmVmaWxsIGF0IHplcm8gXHUyMDE0IHRoZVxuICAvLyBleGFjdCAxMi1jYXJkIHJlc2h1ZmZsZSBiZWhhdmlvciBsaXZlcyBpbiBgZGVjcmVtZW50SGFuZGAuXG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgW29mZmVuc2VdOiBkZWNyZW1lbnRIYW5kKHN0YXRlLnBsYXllcnNbb2ZmZW5zZV0sIGlucHV0Lm9mZmVuc2VQbGF5KSxcbiAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuXG4gIC8vIEFwcGx5IHlhcmRhZ2UgdG8gYmFsbCBwb3NpdGlvbi4gQ2xhbXAgYXQgMTAwIChURCkgYW5kIDAgKHNhZmV0eSkuXG4gIGNvbnN0IHByb2plY3RlZCA9IHN0YXRlLmZpZWxkLmJhbGxPbiArIG91dGNvbWUueWFyZHNHYWluZWQ7XG4gIGxldCBuZXdCYWxsT24gPSBwcm9qZWN0ZWQ7XG4gIGxldCBzY29yZWQ6IFwidGRcIiB8IFwic2FmZXR5XCIgfCBudWxsID0gbnVsbDtcbiAgaWYgKHByb2plY3RlZCA+PSAxMDApIHtcbiAgICBuZXdCYWxsT24gPSAxMDA7XG4gICAgc2NvcmVkID0gXCJ0ZFwiO1xuICB9IGVsc2UgaWYgKHByb2plY3RlZCA8PSAwKSB7XG4gICAgbmV3QmFsbE9uID0gMDtcbiAgICBzY29yZWQgPSBcInNhZmV0eVwiO1xuICB9XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgIG9mZmVuc2VQbGF5OiBpbnB1dC5vZmZlbnNlUGxheSxcbiAgICBkZWZlbnNlUGxheTogaW5wdXQuZGVmZW5zZVBsYXksXG4gICAgbWF0Y2h1cFF1YWxpdHk6IG91dGNvbWUubWF0Y2h1cFF1YWxpdHksXG4gICAgbXVsdGlwbGllcjogeyBjYXJkOiBvdXRjb21lLm11bHRpcGxpZXJDYXJkTmFtZSwgdmFsdWU6IG91dGNvbWUubXVsdGlwbGllciB9LFxuICAgIHlhcmRzQ2FyZDogeWFyZHNEcmF3LmNhcmQsXG4gICAgeWFyZHNHYWluZWQ6IG91dGNvbWUueWFyZHNHYWluZWQsXG4gICAgbmV3QmFsbE9uLFxuICB9KTtcblxuICAvLyBTY29yZSBoYW5kbGluZy5cbiAgaWYgKHNjb3JlZCA9PT0gXCJ0ZFwiKSB7XG4gICAgcmV0dXJuIHRvdWNoZG93blN0YXRlKFxuICAgICAgeyAuLi5zdGF0ZSwgZGVjazogeWFyZHNEcmF3LmRlY2ssIHBsYXllcnM6IG5ld1BsYXllcnMsIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSB9LFxuICAgICAgb2ZmZW5zZSxcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG4gIGlmIChzY29yZWQgPT09IFwic2FmZXR5XCIpIHtcbiAgICByZXR1cm4gc2FmZXR5U3RhdGUoXG4gICAgICB7IC4uLnN0YXRlLCBkZWNrOiB5YXJkc0RyYXcuZGVjaywgcGxheWVyczogbmV3UGxheWVycywgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpIH0sXG4gICAgICBvZmZlbnNlLFxuICAgICAgZXZlbnRzLFxuICAgICk7XG4gIH1cblxuICAvLyBEb3duL2Rpc3RhbmNlIGhhbmRsaW5nLlxuICBjb25zdCByZWFjaGVkRmlyc3REb3duID0gbmV3QmFsbE9uID49IHN0YXRlLmZpZWxkLmZpcnN0RG93bkF0O1xuICBsZXQgbmV4dERvd24gPSBzdGF0ZS5maWVsZC5kb3duO1xuICBsZXQgbmV4dEZpcnN0RG93bkF0ID0gc3RhdGUuZmllbGQuZmlyc3REb3duQXQ7XG4gIGxldCBwb3NzZXNzaW9uRmxpcHBlZCA9IGZhbHNlO1xuXG4gIGlmIChyZWFjaGVkRmlyc3REb3duKSB7XG4gICAgbmV4dERvd24gPSAxO1xuICAgIG5leHRGaXJzdERvd25BdCA9IE1hdGgubWluKDEwMCwgbmV3QmFsbE9uICsgMTApO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJGSVJTVF9ET1dOXCIgfSk7XG4gIH0gZWxzZSBpZiAoc3RhdGUuZmllbGQuZG93biA9PT0gNCkge1xuICAgIC8vIFR1cm5vdmVyIG9uIGRvd25zIFx1MjAxNCBwb3NzZXNzaW9uIGZsaXBzLCBiYWxsIHN0YXlzLlxuICAgIG5leHREb3duID0gMTtcbiAgICBwb3NzZXNzaW9uRmxpcHBlZCA9IHRydWU7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSX09OX0RPV05TXCIgfSk7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJkb3duc1wiIH0pO1xuICB9IGVsc2Uge1xuICAgIG5leHREb3duID0gKHN0YXRlLmZpZWxkLmRvd24gKyAxKSBhcyAxIHwgMiB8IDMgfCA0O1xuICB9XG5cbiAgY29uc3QgbmV4dE9mZmVuc2UgPSBwb3NzZXNzaW9uRmxpcHBlZCA/IG9wcChvZmZlbnNlKSA6IG9mZmVuc2U7XG4gIGNvbnN0IG5leHRCYWxsT24gPSBwb3NzZXNzaW9uRmxpcHBlZCA/IDEwMCAtIG5ld0JhbGxPbiA6IG5ld0JhbGxPbjtcbiAgY29uc3QgbmV4dEZpcnN0RG93biA9IHBvc3Nlc3Npb25GbGlwcGVkXG4gICAgPyBNYXRoLm1pbigxMDAsIG5leHRCYWxsT24gKyAxMClcbiAgICA6IG5leHRGaXJzdERvd25BdDtcblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIGRlY2s6IHlhcmRzRHJhdy5kZWNrLFxuICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogbmV4dEJhbGxPbixcbiAgICAgICAgZmlyc3REb3duQXQ6IG5leHRGaXJzdERvd24sXG4gICAgICAgIGRvd246IG5leHREb3duLFxuICAgICAgICBvZmZlbnNlOiBuZXh0T2ZmZW5zZSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGJsYW5rUGljaygpOiBHYW1lU3RhdGVbXCJwZW5kaW5nUGlja1wiXSB7XG4gIHJldHVybiB7IG9mZmVuc2VQbGF5OiBudWxsLCBkZWZlbnNlUGxheTogbnVsbCB9O1xufVxuXG4vKipcbiAqIFRvdWNoZG93biBib29ra2VlcGluZyBcdTIwMTQgNiBwb2ludHMsIHRyYW5zaXRpb24gdG8gUEFUX0NIT0lDRSBwaGFzZS5cbiAqIChQQVQvMnB0IHJlc29sdXRpb24gYW5kIGVuc3Vpbmcga2lja29mZiBoYXBwZW4gaW4gc3Vic2VxdWVudCBhY3Rpb25zLilcbiAqL1xuZnVuY3Rpb24gdG91Y2hkb3duU3RhdGUoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHNjb3JlcjogR2FtZVN0YXRlW1wiZmllbGRcIl1bXCJvZmZlbnNlXCJdLFxuICBldmVudHM6IEV2ZW50W10sXG4pOiBQbGF5UmVzb2x1dGlvbiB7XG4gIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgLi4uc3RhdGUucGxheWVycyxcbiAgICBbc2NvcmVyXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0uc2NvcmUgKyA2IH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRPVUNIRE9XTlwiLCBzY29yaW5nUGxheWVyOiBzY29yZXIgfSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHsgLi4uc3RhdGUsIHBsYXllcnM6IG5ld1BsYXllcnMsIHBoYXNlOiBcIlBBVF9DSE9JQ0VcIiB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuLyoqXG4gKiBTYWZldHkgXHUyMDE0IGRlZmVuc2Ugc2NvcmVzIDIsIG9mZmVuc2Uga2lja3MgZnJlZSBraWNrLlxuICogRm9yIHRoZSBza2V0Y2ggd2Ugc2NvcmUgYW5kIGVtaXQ7IHRoZSBraWNrb2ZmIHRyYW5zaXRpb24gaXMgVE9ETy5cbiAqL1xuZnVuY3Rpb24gc2FmZXR5U3RhdGUoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIGNvbmNlZGVyOiBHYW1lU3RhdGVbXCJmaWVsZFwiXVtcIm9mZmVuc2VcIl0sXG4gIGV2ZW50czogRXZlbnRbXSxcbik6IFBsYXlSZXNvbHV0aW9uIHtcbiAgY29uc3Qgc2NvcmVyID0gb3BwKGNvbmNlZGVyKTtcbiAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtzY29yZXJdOiB7IC4uLnN0YXRlLnBsYXllcnNbc2NvcmVyXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbc2NvcmVyXS5zY29yZSArIDIgfSxcbiAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiU0FGRVRZXCIsIHNjb3JpbmdQbGF5ZXI6IHNjb3JlciB9KTtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZTogeyAuLi5zdGF0ZSwgcGxheWVyczogbmV3UGxheWVycywgcGhhc2U6IFwiS0lDS09GRlwiIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG4vKipcbiAqIERlY3JlbWVudCB0aGUgY2hvc2VuIHBsYXkgaW4gYSBwbGF5ZXIncyBoYW5kLiBJZiB0aGUgcmVndWxhci1wbGF5IGNhcmRzXG4gKiAoU1IvTFIvU1AvTFApIGFyZSBhbGwgZXhoYXVzdGVkLCByZWZpbGwgdGhlbSBcdTIwMTQgSGFpbCBNYXJ5IGNvdW50IGlzXG4gKiBwcmVzZXJ2ZWQgYWNyb3NzIHJlZmlsbHMgKG1hdGNoZXMgdjUuMSBQbGF5ZXIuZmlsbFBsYXlzKCdwJykpLlxuICovXG5mdW5jdGlvbiBkZWNyZW1lbnRIYW5kKFxuICBwbGF5ZXI6IEdhbWVTdGF0ZVtcInBsYXllcnNcIl1bMV0sXG4gIHBsYXk6IFBsYXlDYWxsLFxuKTogR2FtZVN0YXRlW1wicGxheWVyc1wiXVsxXSB7XG4gIGNvbnN0IGhhbmQgPSB7IC4uLnBsYXllci5oYW5kIH07XG5cbiAgaWYgKHBsYXkgPT09IFwiSE1cIikge1xuICAgIGhhbmQuSE0gPSBNYXRoLm1heCgwLCBoYW5kLkhNIC0gMSk7XG4gICAgcmV0dXJuIHsgLi4ucGxheWVyLCBoYW5kIH07XG4gIH1cblxuICBpZiAocGxheSA9PT0gXCJGR1wiIHx8IHBsYXkgPT09IFwiUFVOVFwiIHx8IHBsYXkgPT09IFwiVFdPX1BUXCIpIHtcbiAgICAvLyBObyBjYXJkIGNvbnN1bWVkIFx1MjAxNCB0aGVzZSBhcmUgc2l0dWF0aW9uYWwgZGVjaXNpb25zLCBub3QgZHJhd3MuXG4gICAgcmV0dXJuIHBsYXllcjtcbiAgfVxuXG4gIGhhbmRbcGxheV0gPSBNYXRoLm1heCgwLCBoYW5kW3BsYXldIC0gMSk7XG5cbiAgY29uc3QgcmVndWxhckV4aGF1c3RlZCA9XG4gICAgaGFuZC5TUiA9PT0gMCAmJiBoYW5kLkxSID09PSAwICYmIGhhbmQuU1AgPT09IDAgJiYgaGFuZC5MUCA9PT0gMCAmJiBoYW5kLlRQID09PSAwO1xuXG4gIGlmIChyZWd1bGFyRXhoYXVzdGVkKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLnBsYXllcixcbiAgICAgIGhhbmQ6IHsgU1I6IDMsIExSOiAzLCBTUDogMywgTFA6IDMsIFRQOiAxLCBITTogaGFuZC5ITSB9LFxuICAgIH07XG4gIH1cblxuICByZXR1cm4geyAuLi5wbGF5ZXIsIGhhbmQgfTtcbn1cbiIsICIvKipcbiAqIFNoYXJlZCBwcmltaXRpdmVzIHVzZWQgYnkgbXVsdGlwbGUgc3BlY2lhbC1wbGF5IHJlc29sdmVycy5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIFBsYXllcklkIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vLi4vc3RhdGUuanNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIHN0YXRlOiBHYW1lU3RhdGU7XG4gIGV2ZW50czogRXZlbnRbXTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJsYW5rUGljaygpOiBHYW1lU3RhdGVbXCJwZW5kaW5nUGlja1wiXSB7XG4gIHJldHVybiB7IG9mZmVuc2VQbGF5OiBudWxsLCBkZWZlbnNlUGxheTogbnVsbCB9O1xufVxuXG4vKipcbiAqIEF3YXJkIHBvaW50cywgZmxpcCB0byBQQVRfQ0hPSUNFLiBDYWxsZXIgZW1pdHMgVE9VQ0hET1dOLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlUb3VjaGRvd24oXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHNjb3JlcjogUGxheWVySWQsXG4gIGV2ZW50czogRXZlbnRbXSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtzY29yZXJdOiB7IC4uLnN0YXRlLnBsYXllcnNbc2NvcmVyXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbc2NvcmVyXS5zY29yZSArIDYgfSxcbiAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiVE9VQ0hET1dOXCIsIHNjb3JpbmdQbGF5ZXI6IHNjb3JlciB9KTtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgcGhhc2U6IFwiUEFUX0NIT0lDRVwiLFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlTYWZldHkoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIGNvbmNlZGVyOiBQbGF5ZXJJZCxcbiAgZXZlbnRzOiBFdmVudFtdLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBzY29yZXIgPSBvcHAoY29uY2VkZXIpO1xuICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgW3Njb3Jlcl06IHsgLi4uc3RhdGUucGxheWVyc1tzY29yZXJdLCBzY29yZTogc3RhdGUucGxheWVyc1tzY29yZXJdLnNjb3JlICsgMiB9LFxuICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJTQUZFVFlcIiwgc2NvcmluZ1BsYXllcjogc2NvcmVyIH0pO1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBwaGFzZTogXCJLSUNLT0ZGXCIsXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbi8qKlxuICogQXBwbHkgYSB5YXJkYWdlIG91dGNvbWUgd2l0aCBmdWxsIGRvd24vdHVybm92ZXIvc2NvcmUgYm9va2tlZXBpbmcuXG4gKiBVc2VkIGJ5IHNwZWNpYWxzIHRoYXQgcHJvZHVjZSB5YXJkYWdlIGRpcmVjdGx5IChIYWlsIE1hcnksIEJpZyBQbGF5IHJldHVybikuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhcHBseVlhcmRhZ2VPdXRjb21lKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICB5YXJkczogbnVtYmVyLFxuICBldmVudHM6IEV2ZW50W10sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBwcm9qZWN0ZWQgPSBzdGF0ZS5maWVsZC5iYWxsT24gKyB5YXJkcztcblxuICBpZiAocHJvamVjdGVkID49IDEwMCkgcmV0dXJuIGFwcGx5VG91Y2hkb3duKHN0YXRlLCBvZmZlbnNlLCBldmVudHMpO1xuICBpZiAocHJvamVjdGVkIDw9IDApIHJldHVybiBhcHBseVNhZmV0eShzdGF0ZSwgb2ZmZW5zZSwgZXZlbnRzKTtcblxuICBjb25zdCByZWFjaGVkRmlyc3REb3duID0gcHJvamVjdGVkID49IHN0YXRlLmZpZWxkLmZpcnN0RG93bkF0O1xuICBsZXQgbmV4dERvd24gPSBzdGF0ZS5maWVsZC5kb3duO1xuICBsZXQgbmV4dEZpcnN0RG93bkF0ID0gc3RhdGUuZmllbGQuZmlyc3REb3duQXQ7XG4gIGxldCBwb3NzZXNzaW9uRmxpcHBlZCA9IGZhbHNlO1xuXG4gIGlmIChyZWFjaGVkRmlyc3REb3duKSB7XG4gICAgbmV4dERvd24gPSAxO1xuICAgIG5leHRGaXJzdERvd25BdCA9IE1hdGgubWluKDEwMCwgcHJvamVjdGVkICsgMTApO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJGSVJTVF9ET1dOXCIgfSk7XG4gIH0gZWxzZSBpZiAoc3RhdGUuZmllbGQuZG93biA9PT0gNCkge1xuICAgIHBvc3Nlc3Npb25GbGlwcGVkID0gdHJ1ZTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJfT05fRE9XTlNcIiB9KTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcImRvd25zXCIgfSk7XG4gIH0gZWxzZSB7XG4gICAgbmV4dERvd24gPSAoc3RhdGUuZmllbGQuZG93biArIDEpIGFzIDEgfCAyIHwgMyB8IDQ7XG4gIH1cblxuICBjb25zdCBtaXJyb3JlZEJhbGxPbiA9IHBvc3Nlc3Npb25GbGlwcGVkID8gMTAwIC0gcHJvamVjdGVkIDogcHJvamVjdGVkO1xuXG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgYmFsbE9uOiBtaXJyb3JlZEJhbGxPbixcbiAgICAgICAgZmlyc3REb3duQXQ6IHBvc3Nlc3Npb25GbGlwcGVkXG4gICAgICAgICAgPyBNYXRoLm1pbigxMDAsIG1pcnJvcmVkQmFsbE9uICsgMTApXG4gICAgICAgICAgOiBuZXh0Rmlyc3REb3duQXQsXG4gICAgICAgIGRvd246IHBvc3Nlc3Npb25GbGlwcGVkID8gMSA6IG5leHREb3duLFxuICAgICAgICBvZmZlbnNlOiBwb3NzZXNzaW9uRmxpcHBlZCA/IG9wcChvZmZlbnNlKSA6IG9mZmVuc2UsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuIiwgIi8qKlxuICogQmlnIFBsYXkgcmVzb2x1dGlvbiAocnVuLmpzOjE5MzMpLlxuICpcbiAqIFRyaWdnZXJlZCBieTpcbiAqICAgLSBUcmljayBQbGF5IGRpZT01XG4gKiAgIC0gU2FtZSBQbGF5IEtpbmcgb3V0Y29tZVxuICogICAtIE90aGVyIGZ1dHVyZSBob29rc1xuICpcbiAqIFRoZSBiZW5lZmljaWFyeSBhcmd1bWVudCBzYXlzIHdobyBiZW5lZml0cyBcdTIwMTQgdGhpcyBjYW4gYmUgb2ZmZW5zZSBPUlxuICogZGVmZW5zZSAoZGlmZmVyZW50IG91dGNvbWUgdGFibGVzKS5cbiAqXG4gKiBPZmZlbnNpdmUgQmlnIFBsYXkgKG9mZmVuc2UgYmVuZWZpdHMpOlxuICogICBkaWUgMS0zIFx1MjE5MiArMjUgeWFyZHNcbiAqICAgZGllIDQtNSBcdTIxOTIgbWF4KGhhbGYtdG8tZ29hbCwgNDApIHlhcmRzXG4gKiAgIGRpZSA2ICAgXHUyMTkyIFRvdWNoZG93blxuICpcbiAqIERlZmVuc2l2ZSBCaWcgUGxheSAoZGVmZW5zZSBiZW5lZml0cyk6XG4gKiAgIGRpZSAxLTMgXHUyMTkyIDEwLXlhcmQgcGVuYWx0eSBvbiBvZmZlbnNlIChyZXBlYXQgZG93biksIGhhbGYtdG8tZ29hbCBpZiB0aWdodFxuICogICBkaWUgNC01IFx1MjE5MiBGVU1CTEUgXHUyMTkyIHR1cm5vdmVyICsgZGVmZW5zZSByZXR1cm5zIG1heChoYWxmLCAyNSlcbiAqICAgZGllIDYgICBcdTIxOTIgRlVNQkxFIFx1MjE5MiBkZWZlbnNpdmUgVERcbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgUGxheWVySWQgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi8uLi9zdGF0ZS5qc1wiO1xuaW1wb3J0IHtcbiAgYXBwbHlTYWZldHksXG4gIGFwcGx5VG91Y2hkb3duLFxuICBibGFua1BpY2ssXG4gIHR5cGUgU3BlY2lhbFJlc29sdXRpb24sXG59IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUJpZ1BsYXkoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIGJlbmVmaWNpYXJ5OiBQbGF5ZXJJZCxcbiAgcm5nOiBSbmcsXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBkaWUgPSBybmcuZDYoKTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW3sgdHlwZTogXCJCSUdfUExBWVwiLCBiZW5lZmljaWFyeSwgc3Vicm9sbDogZGllIH1dO1xuXG4gIGlmIChiZW5lZmljaWFyeSA9PT0gb2ZmZW5zZSkge1xuICAgIHJldHVybiBvZmZlbnNpdmVCaWdQbGF5KHN0YXRlLCBvZmZlbnNlLCBkaWUsIGV2ZW50cyk7XG4gIH1cbiAgcmV0dXJuIGRlZmVuc2l2ZUJpZ1BsYXkoc3RhdGUsIG9mZmVuc2UsIGRpZSwgZXZlbnRzKTtcbn1cblxuZnVuY3Rpb24gb2ZmZW5zaXZlQmlnUGxheShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgb2ZmZW5zZTogUGxheWVySWQsXG4gIGRpZTogMSB8IDIgfCAzIHwgNCB8IDUgfCA2LFxuICBldmVudHM6IEV2ZW50W10sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGlmIChkaWUgPT09IDYpIHtcbiAgICByZXR1cm4gYXBwbHlUb3VjaGRvd24oc3RhdGUsIG9mZmVuc2UsIGV2ZW50cyk7XG4gIH1cblxuICAvLyBkaWUgMS0zOiArMjU7IGRpZSA0LTU6IG1heChoYWxmLXRvLWdvYWwsIDQwKVxuICBsZXQgZ2FpbjogbnVtYmVyO1xuICBpZiAoZGllIDw9IDMpIHtcbiAgICBnYWluID0gMjU7XG4gIH0gZWxzZSB7XG4gICAgY29uc3QgaGFsZlRvR29hbCA9IE1hdGgucm91bmQoKDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbikgLyAyKTtcbiAgICBnYWluID0gaGFsZlRvR29hbCA+IDQwID8gaGFsZlRvR29hbCA6IDQwO1xuICB9XG5cbiAgY29uc3QgcHJvamVjdGVkID0gc3RhdGUuZmllbGQuYmFsbE9uICsgZ2FpbjtcbiAgaWYgKHByb2plY3RlZCA+PSAxMDApIHtcbiAgICByZXR1cm4gYXBwbHlUb3VjaGRvd24oc3RhdGUsIG9mZmVuc2UsIGV2ZW50cyk7XG4gIH1cblxuICAvLyBBcHBseSBnYWluLCBjaGVjayBmb3IgZmlyc3QgZG93bi5cbiAgY29uc3QgcmVhY2hlZEZpcnN0RG93biA9IHByb2plY3RlZCA+PSBzdGF0ZS5maWVsZC5maXJzdERvd25BdDtcbiAgY29uc3QgbmV4dERvd24gPSByZWFjaGVkRmlyc3REb3duID8gMSA6IHN0YXRlLmZpZWxkLmRvd247XG4gIGNvbnN0IG5leHRGaXJzdERvd25BdCA9IHJlYWNoZWRGaXJzdERvd25cbiAgICA/IE1hdGgubWluKDEwMCwgcHJvamVjdGVkICsgMTApXG4gICAgOiBzdGF0ZS5maWVsZC5maXJzdERvd25BdDtcblxuICBpZiAocmVhY2hlZEZpcnN0RG93bikgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkZJUlNUX0RPV05cIiB9KTtcblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIC4uLnN0YXRlLmZpZWxkLFxuICAgICAgICBiYWxsT246IHByb2plY3RlZCxcbiAgICAgICAgZG93bjogbmV4dERvd24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBuZXh0Rmlyc3REb3duQXQsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG5mdW5jdGlvbiBkZWZlbnNpdmVCaWdQbGF5KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBvZmZlbnNlOiBQbGF5ZXJJZCxcbiAgZGllOiAxIHwgMiB8IDMgfCA0IHwgNSB8IDYsXG4gIGV2ZW50czogRXZlbnRbXSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgLy8gMS0zOiAxMC15YXJkIHBlbmFsdHksIHJlcGVhdCBkb3duIChubyBkb3duIGNvbnN1bWVkKS5cbiAgaWYgKGRpZSA8PSAzKSB7XG4gICAgY29uc3QgbmFpdmVQZW5hbHR5ID0gLTEwO1xuICAgIGNvbnN0IGhhbGZUb0dvYWwgPSAtTWF0aC5mbG9vcihzdGF0ZS5maWVsZC5iYWxsT24gLyAyKTtcbiAgICBjb25zdCBwZW5hbHR5WWFyZHMgPVxuICAgICAgc3RhdGUuZmllbGQuYmFsbE9uIC0gMTAgPCAxID8gaGFsZlRvR29hbCA6IG5haXZlUGVuYWx0eTtcblxuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJQRU5BTFRZXCIsIGFnYWluc3Q6IG9mZmVuc2UsIHlhcmRzOiBwZW5hbHR5WWFyZHMsIGxvc3NPZkRvd246IGZhbHNlIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIC4uLnN0YXRlLmZpZWxkLFxuICAgICAgICAgIGJhbGxPbjogTWF0aC5tYXgoMCwgc3RhdGUuZmllbGQuYmFsbE9uICsgcGVuYWx0eVlhcmRzKSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIDQtNTogdHVybm92ZXIgd2l0aCByZXR1cm4gb2YgbWF4KGhhbGYsIDI1KS4gNjogZGVmZW5zaXZlIFRELlxuICBjb25zdCBkZWZlbmRlciA9IG9wcChvZmZlbnNlKTtcblxuICBpZiAoZGllID09PSA2KSB7XG4gICAgLy8gRGVmZW5zZSBzY29yZXMgdGhlIFRELlxuICAgIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgW2RlZmVuZGVyXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW2RlZmVuZGVyXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbZGVmZW5kZXJdLnNjb3JlICsgNiB9LFxuICAgIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcImZ1bWJsZVwiIH0pO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUT1VDSERPV05cIiwgc2NvcmluZ1BsYXllcjogZGVmZW5kZXIgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIHBoYXNlOiBcIlBBVF9DSE9JQ0VcIixcbiAgICAgICAgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IGRlZmVuZGVyIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBkaWUgNC01OiB0dXJub3ZlciB3aXRoIHJldHVybi5cbiAgY29uc3QgaGFsZlRvR29hbCA9IE1hdGgucm91bmQoKDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbikgLyAyKTtcbiAgY29uc3QgcmV0dXJuWWFyZHMgPSBoYWxmVG9Hb2FsID4gMjUgPyBoYWxmVG9Hb2FsIDogMjU7XG5cbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJmdW1ibGVcIiB9KTtcblxuICAvLyBEZWZlbnNlIGJlY29tZXMgbmV3IG9mZmVuc2UuIEJhbGwgcG9zaXRpb246IG9mZmVuc2UgZ2FpbmVkIHJldHVybllhcmRzLFxuICAvLyB0aGVuIGZsaXAgcGVyc3BlY3RpdmUuXG4gIGNvbnN0IHByb2plY3RlZCA9IHN0YXRlLmZpZWxkLmJhbGxPbiArIHJldHVybllhcmRzO1xuICBpZiAocHJvamVjdGVkID49IDEwMCkge1xuICAgIC8vIFJldHVybmVkIGFsbCB0aGUgd2F5IFx1MjAxNCBURCBmb3IgZGVmZW5kZXIuXG4gICAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICBbZGVmZW5kZXJdOiB7IC4uLnN0YXRlLnBsYXllcnNbZGVmZW5kZXJdLCBzY29yZTogc3RhdGUucGxheWVyc1tkZWZlbmRlcl0uc2NvcmUgKyA2IH0sXG4gICAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUT1VDSERPV05cIiwgc2NvcmluZ1BsYXllcjogZGVmZW5kZXIgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIHBoYXNlOiBcIlBBVF9DSE9JQ0VcIixcbiAgICAgICAgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IGRlZmVuZGVyIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cbiAgaWYgKHByb2plY3RlZCA8PSAwKSB7XG4gICAgcmV0dXJuIGFwcGx5U2FmZXR5KHN0YXRlLCBvZmZlbnNlLCBldmVudHMpO1xuICB9XG5cbiAgLy8gRmxpcCBwb3NzZXNzaW9uLCBtaXJyb3IgYmFsbCBwb3NpdGlvbi5cbiAgY29uc3QgbWlycm9yZWRCYWxsT24gPSAxMDAgLSBwcm9qZWN0ZWQ7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgYmFsbE9uOiBtaXJyb3JlZEJhbGxPbixcbiAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgbWlycm9yZWRCYWxsT24gKyAxMCksXG4gICAgICAgIGRvd246IDEsXG4gICAgICAgIG9mZmVuc2U6IGRlZmVuZGVyLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cbiIsICIvKipcbiAqIFB1bnQgKHJ1bi5qczoyMDkwKS4gQWxzbyBzZXJ2ZXMgZm9yIHNhZmV0eSBraWNrcy5cbiAqXG4gKiBTZXF1ZW5jZSAoYWxsIHJhbmRvbW5lc3MgdGhyb3VnaCBybmcpOlxuICogICAxLiBCbG9jayBjaGVjazogaWYgaW5pdGlhbCBkNiBpcyA2LCByb2xsIGFnYWluIFx1MjAxNCAyLXNpeGVzID0gYmxvY2tlZCAoMS8zNikuXG4gKiAgIDIuIElmIG5vdCBibG9ja2VkLCBkcmF3IHlhcmRzIGNhcmQgKyBjb2luIGZsaXA6XG4gKiAgICAgICAga2lja0Rpc3QgPSAxMCAqIHlhcmRzQ2FyZCAvIDIgKyAyMCAqIChjb2luPWhlYWRzID8gMSA6IDApXG4gKiAgICAgIFJlc3VsdGluZyByYW5nZTogWzUsIDcwXSB5YXJkcy5cbiAqICAgMy4gSWYgYmFsbCBsYW5kcyBwYXN0IDEwMCBcdTIxOTIgdG91Y2hiYWNrLCBwbGFjZSBhdCByZWNlaXZlcidzIDIwLlxuICogICA0LiBNdWZmIGNoZWNrIChub3Qgb24gdG91Y2hiYWNrL2Jsb2NrL3NhZmV0eSBraWNrKTogMi1zaXhlcyA9IHJlY2VpdmVyXG4gKiAgICAgIG11ZmZzLCBraWNraW5nIHRlYW0gcmVjb3ZlcnMuXG4gKiAgIDUuIFJldHVybjogaWYgcG9zc2Vzc2lvbiwgZHJhdyBtdWx0Q2FyZCArIHlhcmRzLlxuICogICAgICAgIEtpbmc9N3gsIFF1ZWVuPTR4LCBKYWNrPTF4LCAxMD0tMC41eFxuICogICAgICAgIHJldHVybiA9IHJvdW5kKG11bHQgKiB5YXJkc0NhcmQpXG4gKiAgICAgIFJldHVybiBjYW4gc2NvcmUgVEQgb3IgY29uY2VkZSBzYWZldHkuXG4gKlxuICogRm9yIHRoZSBlbmdpbmUgcG9ydDogdGhpcyBpcyB0aGUgbW9zdCBwcm9jZWR1cmFsIG9mIHRoZSBzcGVjaWFscy4gV2VcbiAqIGNvbGxlY3QgZXZlbnRzIGluIG9yZGVyIGFuZCBwcm9kdWNlIG9uZSBmaW5hbCBzdGF0ZS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4uLy4uL3N0YXRlLmpzXCI7XG5pbXBvcnQgeyBkcmF3TXVsdGlwbGllciwgZHJhd1lhcmRzIH0gZnJvbSBcIi4uL2RlY2suanNcIjtcbmltcG9ydCB7XG4gIGFwcGx5U2FmZXR5LFxuICBhcHBseVRvdWNoZG93bixcbiAgYmxhbmtQaWNrLFxuICB0eXBlIFNwZWNpYWxSZXNvbHV0aW9uLFxufSBmcm9tIFwiLi9zaGFyZWQuanNcIjtcblxuY29uc3QgUkVUVVJOX01VTFRJUExJRVJTOiBSZWNvcmQ8XCJLaW5nXCIgfCBcIlF1ZWVuXCIgfCBcIkphY2tcIiB8IFwiMTBcIiwgbnVtYmVyPiA9IHtcbiAgS2luZzogNyxcbiAgUXVlZW46IDQsXG4gIEphY2s6IDEsXG4gIFwiMTBcIjogLTAuNSxcbn07XG5cbmV4cG9ydCBpbnRlcmZhY2UgUHVudE9wdGlvbnMge1xuICAvKiogdHJ1ZSBpZiB0aGlzIGlzIGEgc2FmZXR5IGtpY2sgKG5vIGJsb2NrL211ZmYgY2hlY2tzKS4gKi9cbiAgc2FmZXR5S2ljaz86IGJvb2xlYW47XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUHVudChcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgcm5nOiBSbmcsXG4gIG9wdHM6IFB1bnRPcHRpb25zID0ge30sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBkZWZlbmRlciA9IG9wcChvZmZlbnNlKTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG4gIGxldCBkZWNrID0gc3RhdGUuZGVjaztcblxuICAvLyBCbG9jayBjaGVjayAobm90IG9uIHNhZmV0eSBraWNrKS5cbiAgbGV0IGJsb2NrZWQgPSBmYWxzZTtcbiAgaWYgKCFvcHRzLnNhZmV0eUtpY2spIHtcbiAgICBpZiAocm5nLmQ2KCkgPT09IDYgJiYgcm5nLmQ2KCkgPT09IDYpIHtcbiAgICAgIGJsb2NrZWQgPSB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIGlmIChibG9ja2VkKSB7XG4gICAgLy8gS2lja2luZyB0ZWFtIGxvc2VzIHBvc3Nlc3Npb24gYXQgdGhlIGxpbmUgb2Ygc2NyaW1tYWdlLlxuICAgIGNvbnN0IG1pcnJvcmVkQmFsbE9uID0gMTAwIC0gc3RhdGUuZmllbGQuYmFsbE9uO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJQVU5UXCIsIHBsYXllcjogb2ZmZW5zZSwgbGFuZGluZ1Nwb3Q6IHN0YXRlLmZpZWxkLmJhbGxPbiB9KTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcImZ1bWJsZVwiIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIGJhbGxPbjogbWlycm9yZWRCYWxsT24sXG4gICAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgbWlycm9yZWRCYWxsT24gKyAxMCksXG4gICAgICAgICAgZG93bjogMSxcbiAgICAgICAgICBvZmZlbnNlOiBkZWZlbmRlcixcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIERyYXcgeWFyZHMgKyBjb2luIGZvciBraWNrIGRpc3RhbmNlLlxuICBjb25zdCBjb2luID0gcm5nLmNvaW5GbGlwKCk7XG4gIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhkZWNrLCBybmcpO1xuICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcbiAgZGVjayA9IHlhcmRzRHJhdy5kZWNrO1xuXG4gIGNvbnN0IGtpY2tEaXN0ID0gKDEwICogeWFyZHNEcmF3LmNhcmQpIC8gMiArIChjb2luID09PSBcImhlYWRzXCIgPyAyMCA6IDApO1xuICBjb25zdCBsYW5kaW5nU3BvdCA9IHN0YXRlLmZpZWxkLmJhbGxPbiArIGtpY2tEaXN0O1xuICBjb25zdCB0b3VjaGJhY2sgPSBsYW5kaW5nU3BvdCA+IDEwMDtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlBVTlRcIiwgcGxheWVyOiBvZmZlbnNlLCBsYW5kaW5nU3BvdCB9KTtcblxuICAvLyBNdWZmIGNoZWNrIChub3Qgb24gdG91Y2hiYWNrLCBibG9jaywgc2FmZXR5IGtpY2spLlxuICBsZXQgbXVmZmVkID0gZmFsc2U7XG4gIGlmICghdG91Y2hiYWNrICYmICFvcHRzLnNhZmV0eUtpY2spIHtcbiAgICBpZiAocm5nLmQ2KCkgPT09IDYgJiYgcm5nLmQ2KCkgPT09IDYpIHtcbiAgICAgIG11ZmZlZCA9IHRydWU7XG4gICAgfVxuICB9XG5cbiAgaWYgKG11ZmZlZCkge1xuICAgIC8vIFJlY2VpdmVyIG11ZmZzLCBraWNraW5nIHRlYW0gcmVjb3ZlcnMgd2hlcmUgdGhlIGJhbGwgbGFuZGVkLlxuICAgIC8vIEtpY2tpbmcgdGVhbSByZXRhaW5zIHBvc3Nlc3Npb24gKHN0aWxsIG9mZmVuc2UpLlxuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiZnVtYmxlXCIgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBkZWNrLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgYmFsbE9uOiBNYXRoLm1pbig5OSwgbGFuZGluZ1Nwb3QpLFxuICAgICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIGxhbmRpbmdTcG90ICsgMTApLFxuICAgICAgICAgIGRvd246IDEsXG4gICAgICAgICAgb2ZmZW5zZSwgLy8ga2lja2VyIHJldGFpbnNcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIFRvdWNoYmFjazogcmVjZWl2ZXIgZ2V0cyBiYWxsIGF0IHRoZWlyIG93biAyMCAoPSA4MCBmcm9tIHRoZWlyIHBlcnNwZWN0aXZlLFxuICAvLyBidXQgYmFsbCBwb3NpdGlvbiBpcyB0cmFja2VkIGZyb20gb2ZmZW5zZSBQT1YsIHNvIGZvciB0aGUgTkVXIG9mZmVuc2UgdGhhdFxuICAvLyBpcyAxMDAtODAgPSAyMCkuXG4gIGlmICh0b3VjaGJhY2spIHtcbiAgICBjb25zdCBzdGF0ZUFmdGVyS2ljazogR2FtZVN0YXRlID0geyAuLi5zdGF0ZSwgZGVjayB9O1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZUFmdGVyS2ljayxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIGJhbGxPbjogMjAsXG4gICAgICAgICAgZmlyc3REb3duQXQ6IDMwLFxuICAgICAgICAgIGRvd246IDEsXG4gICAgICAgICAgb2ZmZW5zZTogZGVmZW5kZXIsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBOb3JtYWwgcHVudCByZXR1cm46IGRyYXcgbXVsdENhcmQgKyB5YXJkcy4gUmV0dXJuIG1lYXN1cmVkIGZyb20gbGFuZGluZ1Nwb3QuXG4gIGNvbnN0IG11bHREcmF3ID0gZHJhd011bHRpcGxpZXIoZGVjaywgcm5nKTtcbiAgaWYgKG11bHREcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwibXVsdGlwbGllclwiIH0pO1xuICBkZWNrID0gbXVsdERyYXcuZGVjaztcblxuICBjb25zdCByZXR1cm5EcmF3ID0gZHJhd1lhcmRzKGRlY2ssIHJuZyk7XG4gIGlmIChyZXR1cm5EcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcbiAgZGVjayA9IHJldHVybkRyYXcuZGVjaztcblxuICBjb25zdCBtdWx0ID0gUkVUVVJOX01VTFRJUExJRVJTW211bHREcmF3LmNhcmRdO1xuICBjb25zdCByZXR1cm5ZYXJkcyA9IE1hdGgucm91bmQobXVsdCAqIHJldHVybkRyYXcuY2FyZCk7XG5cbiAgLy8gQmFsbCBlbmRzIHVwIGF0IGxhbmRpbmdTcG90IC0gcmV0dXJuWWFyZHMgKGZyb20ga2lja2luZyB0ZWFtJ3MgUE9WKS5cbiAgLy8gRXF1aXZhbGVudGx5LCBmcm9tIHRoZSByZWNlaXZpbmcgdGVhbSdzIFBPVjogKDEwMCAtIGxhbmRpbmdTcG90KSArIHJldHVybllhcmRzLlxuICBjb25zdCByZWNlaXZlckJhbGxPbiA9IDEwMCAtIGxhbmRpbmdTcG90ICsgcmV0dXJuWWFyZHM7XG5cbiAgY29uc3Qgc3RhdGVBZnRlclJldHVybjogR2FtZVN0YXRlID0geyAuLi5zdGF0ZSwgZGVjayB9O1xuXG4gIC8vIFJldHVybiBURCBcdTIwMTQgcmVjZWl2ZXIgc2NvcmVzLlxuICBpZiAocmVjZWl2ZXJCYWxsT24gPj0gMTAwKSB7XG4gICAgY29uc3QgcmVjZWl2ZXJCYWxsQ2xhbXBlZCA9IDEwMDtcbiAgICB2b2lkIHJlY2VpdmVyQmFsbENsYW1wZWQ7XG4gICAgcmV0dXJuIGFwcGx5VG91Y2hkb3duKFxuICAgICAgeyAuLi5zdGF0ZUFmdGVyUmV0dXJuLCBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogZGVmZW5kZXIgfSB9LFxuICAgICAgZGVmZW5kZXIsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuXG4gIC8vIFJldHVybiBzYWZldHkgXHUyMDE0IHJlY2VpdmVyIHRhY2tsZWQgaW4gdGhlaXIgb3duIGVuZHpvbmUgKGNhbid0IGFjdHVhbGx5XG4gIC8vIGhhcHBlbiBmcm9tIGEgbmVnYXRpdmUtcmV0dXJuLXlhcmRhZ2Ugc3RhbmRwb2ludCBpbiB2NS4xIHNpbmNlIHN0YXJ0IGlzXG4gIC8vIDEwMC1sYW5kaW5nU3BvdCB3aGljaCBpcyA+IDAsIGJ1dCBtb2RlbCBpdCBhbnl3YXkgZm9yIGNvbXBsZXRlbmVzcykuXG4gIGlmIChyZWNlaXZlckJhbGxPbiA8PSAwKSB7XG4gICAgcmV0dXJuIGFwcGx5U2FmZXR5KFxuICAgICAgeyAuLi5zdGF0ZUFmdGVyUmV0dXJuLCBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogZGVmZW5kZXIgfSB9LFxuICAgICAgZGVmZW5kZXIsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlQWZ0ZXJSZXR1cm4sXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IHJlY2VpdmVyQmFsbE9uLFxuICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCByZWNlaXZlckJhbGxPbiArIDEwKSxcbiAgICAgICAgZG93bjogMSxcbiAgICAgICAgb2ZmZW5zZTogZGVmZW5kZXIsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuIiwgIi8qKlxuICogS2lja29mZi4gSW4gdjUuMSBraWNrb2ZmcyBoYXZlIGEgXCJraWNrIHR5cGVcIiBzZWxlY3Rpb24gKG9uc2lkZSB2c1xuICogcmVndWxhcikgd2hpY2ggd2UncmUgc2tpcHBpbmcgZm9yIHY2IFx1MjAxNCBpbnN0ZWFkIHdlIHRyZWF0IGEga2lja29mZiBhc1xuICogYSBzaW1wbGlmaWVkIHB1bnQgZnJvbSB0aGUgMzUgd2l0aCBubyBibG9jayBjaGVjayBhbmQgbm8gbXVmZiBjaGVjay5cbiAqXG4gKiBUaGUga2lja2luZyB0ZWFtIChzdGF0ZS5maWVsZC5vZmZlbnNlKSBpcyB3aG9ldmVyIGp1c3Qgc2NvcmVkIG9yIGlzXG4gKiBzdGFydGluZyB0aGUgaGFsZi4gUG9zc2Vzc2lvbiBmbGlwcyB0byB0aGUgcmVjZWl2ZXIgYXMgcGFydCBvZiB0aGVcbiAqIHJlc29sdXRpb24uXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgcmVzb2x2ZVB1bnQgfSBmcm9tIFwiLi9wdW50LmpzXCI7XG5pbXBvcnQgeyB0eXBlIFNwZWNpYWxSZXNvbHV0aW9uIH0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlS2lja29mZihzdGF0ZTogR2FtZVN0YXRlLCBybmc6IFJuZyk6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgLy8gUGxhY2UgYmFsbCBhdCBraWNraW5nIHRlYW0ncyAzNSBhbmQgcHVudCBmcm9tIHRoZXJlLiBVc2UgdGhlIHNhZmV0eUtpY2tcbiAgLy8gZmxhZyB0byBza2lwIGJsb2NrL211ZmYgXHUyMDE0IGEgcmVhbCBraWNrb2ZmIGNhbid0IGJlIFwiYmxvY2tlZFwiIGluIHRoZSBzYW1lXG4gIC8vIHdheSwgYW5kIHY1LjEgdXNlcyBwdW50KCkgZm9yIHNhZmV0eSBraWNrcyBzaW1pbGFybHkuXG4gIGNvbnN0IGtpY2tpbmdTdGF0ZTogR2FtZVN0YXRlID0ge1xuICAgIC4uLnN0YXRlLFxuICAgIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBiYWxsT246IDM1IH0sXG4gIH07XG4gIGNvbnN0IHJlc3VsdCA9IHJlc29sdmVQdW50KGtpY2tpbmdTdGF0ZSwgcm5nLCB7IHNhZmV0eUtpY2s6IHRydWUgfSk7XG4gIC8vIEFmdGVyIHJlc29sdXRpb24sIHdlJ3JlIGluIFJFR19QTEFZLlxuICByZXR1cm4ge1xuICAgIC4uLnJlc3VsdCxcbiAgICBzdGF0ZTogeyAuLi5yZXN1bHQuc3RhdGUsIHBoYXNlOiBcIlJFR19QTEFZXCIgfSxcbiAgfTtcbn1cbiIsICIvKipcbiAqIEhhaWwgTWFyeSBvdXRjb21lcyAocnVuLmpzOjIyNDIpLiBEaWUgdmFsdWUgXHUyMTkyIHJlc3VsdCwgZnJvbSBvZmZlbnNlJ3MgUE9WOlxuICogICAxIFx1MjE5MiBCSUcgU0FDSywgLTEwIHlhcmRzXG4gKiAgIDIgXHUyMTkyICsyMCB5YXJkc1xuICogICAzIFx1MjE5MiAgIDAgeWFyZHNcbiAqICAgNCBcdTIxOTIgKzQwIHlhcmRzXG4gKiAgIDUgXHUyMTkyIElOVEVSQ0VQVElPTiAodHVybm92ZXIgYXQgc3BvdClcbiAqICAgNiBcdTIxOTIgVE9VQ0hET1dOXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi8uLi9zdGF0ZS5qc1wiO1xuaW1wb3J0IHtcbiAgYXBwbHlTYWZldHksXG4gIGFwcGx5VG91Y2hkb3duLFxuICBhcHBseVlhcmRhZ2VPdXRjb21lLFxuICBibGFua1BpY2ssXG4gIHR5cGUgU3BlY2lhbFJlc29sdXRpb24sXG59IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUhhaWxNYXJ5KHN0YXRlOiBHYW1lU3RhdGUsIHJuZzogUm5nKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgZGllID0gcm5nLmQ2KCk7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFt7IHR5cGU6IFwiSEFJTF9NQVJZX1JPTExcIiwgb3V0Y29tZTogZGllIH1dO1xuXG4gIC8vIERlY3JlbWVudCBITSBjb3VudCByZWdhcmRsZXNzIG9mIG91dGNvbWUuXG4gIGNvbnN0IHVwZGF0ZWRQbGF5ZXJzID0ge1xuICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgW29mZmVuc2VdOiB7XG4gICAgICAuLi5zdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLFxuICAgICAgaGFuZDogeyAuLi5zdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLmhhbmQsIEhNOiBNYXRoLm1heCgwLCBzdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLmhhbmQuSE0gLSAxKSB9LFxuICAgIH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgY29uc3Qgc3RhdGVXaXRoSG06IEdhbWVTdGF0ZSA9IHsgLi4uc3RhdGUsIHBsYXllcnM6IHVwZGF0ZWRQbGF5ZXJzIH07XG5cbiAgLy8gSW50ZXJjZXB0aW9uIChkaWUgNSkgXHUyMDE0IHR1cm5vdmVyIGF0IHRoZSBzcG90LCBwb3NzZXNzaW9uIGZsaXBzLlxuICBpZiAoZGllID09PSA1KSB7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJpbnRlcmNlcHRpb25cIiB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGVXaXRoSG0sXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICAuLi5zdGF0ZVdpdGhIbS5maWVsZCxcbiAgICAgICAgICBvZmZlbnNlOiBvcHAob2ZmZW5zZSksXG4gICAgICAgICAgYmFsbE9uOiAxMDAgLSBzdGF0ZVdpdGhIbS5maWVsZC5iYWxsT24sXG4gICAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgMTAwIC0gc3RhdGVXaXRoSG0uZmllbGQuYmFsbE9uICsgMTApLFxuICAgICAgICAgIGRvd246IDEsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBUb3VjaGRvd24gKGRpZSA2KS5cbiAgaWYgKGRpZSA9PT0gNikge1xuICAgIHJldHVybiBhcHBseVRvdWNoZG93bihzdGF0ZVdpdGhIbSwgb2ZmZW5zZSwgZXZlbnRzKTtcbiAgfVxuXG4gIC8vIFlhcmRhZ2Ugb3V0Y29tZXMgKGRpZSAxLCAyLCAzLCA0KS5cbiAgY29uc3QgeWFyZHMgPSBkaWUgPT09IDEgPyAtMTAgOiBkaWUgPT09IDIgPyAyMCA6IGRpZSA9PT0gMyA/IDAgOiA0MDtcbiAgY29uc3QgcHJvamVjdGVkID0gc3RhdGVXaXRoSG0uZmllbGQuYmFsbE9uICsgeWFyZHM7XG5cbiAgaWYgKHByb2plY3RlZCA+PSAxMDApIHJldHVybiBhcHBseVRvdWNoZG93bihzdGF0ZVdpdGhIbSwgb2ZmZW5zZSwgZXZlbnRzKTtcbiAgaWYgKHByb2plY3RlZCA8PSAwKSByZXR1cm4gYXBwbHlTYWZldHkoc3RhdGVXaXRoSG0sIG9mZmVuc2UsIGV2ZW50cyk7XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgIG9mZmVuc2VQbGF5OiBcIkhNXCIsXG4gICAgZGVmZW5zZVBsYXk6IHN0YXRlLnBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5ID8/IFwiU1JcIixcbiAgICBtYXRjaHVwUXVhbGl0eTogMCxcbiAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IFwiMTBcIiwgdmFsdWU6IDAgfSxcbiAgICB5YXJkc0NhcmQ6IDAsXG4gICAgeWFyZHNHYWluZWQ6IHlhcmRzLFxuICAgIG5ld0JhbGxPbjogcHJvamVjdGVkLFxuICB9KTtcblxuICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShzdGF0ZVdpdGhIbSwgeWFyZHMsIGV2ZW50cyk7XG59XG4iLCAiLyoqXG4gKiBTYW1lIFBsYXkgbWVjaGFuaXNtIChydW4uanM6MTg5OSkuXG4gKlxuICogVHJpZ2dlcmVkIHdoZW4gYm90aCB0ZWFtcyBwaWNrIHRoZSBzYW1lIHJlZ3VsYXIgcGxheSBBTkQgYSBjb2luLWZsaXAgbGFuZHNcbiAqIGhlYWRzIChhbHNvIHVuY29uZGl0aW9uYWxseSB3aGVuIGJvdGggcGljayBUcmljayBQbGF5KS4gUnVucyBpdHMgb3duXG4gKiBjb2luICsgbXVsdGlwbGllci1jYXJkIGNoYWluOlxuICpcbiAqICAgbXVsdENhcmQgPSBLaW5nICBcdTIxOTIgQmlnIFBsYXkgKG9mZmVuc2UgaWYgY29pbj1oZWFkcywgZGVmZW5zZSBpZiB0YWlscylcbiAqICAgbXVsdENhcmQgPSBRdWVlbiArIGhlYWRzIFx1MjE5MiBtdWx0aXBsaWVyID0gKzMsIGRyYXcgeWFyZHMgY2FyZFxuICogICBtdWx0Q2FyZCA9IFF1ZWVuICsgdGFpbHMgXHUyMTkyIG11bHRpcGxpZXIgPSAgMCwgbm8geWFyZHMgKGRpc3QgPSAwKVxuICogICBtdWx0Q2FyZCA9IEphY2sgICsgaGVhZHMgXHUyMTkyIG11bHRpcGxpZXIgPSAgMCwgbm8geWFyZHMgKGRpc3QgPSAwKVxuICogICBtdWx0Q2FyZCA9IEphY2sgICsgdGFpbHMgXHUyMTkyIG11bHRpcGxpZXIgPSAtMywgZHJhdyB5YXJkcyBjYXJkXG4gKiAgIG11bHRDYXJkID0gMTAgICAgKyBoZWFkcyBcdTIxOTIgSU5URVJDRVBUSU9OICh0dXJub3ZlciBhdCBzcG90KVxuICogICBtdWx0Q2FyZCA9IDEwICAgICsgdGFpbHMgXHUyMTkyIDAgeWFyZHNcbiAqXG4gKiBOb3RlOiB0aGUgY29pbiBmbGlwIGluc2lkZSB0aGlzIGZ1bmN0aW9uIGlzIGEgU0VDT05EIGNvaW4gZmxpcCBcdTIwMTQgdGhlXG4gKiBtZWNoYW5pc20tdHJpZ2dlciBjb2luIGZsaXAgaXMgaGFuZGxlZCBieSB0aGUgcmVkdWNlciBiZWZvcmUgY2FsbGluZyBoZXJlLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7IGRyYXdNdWx0aXBsaWVyLCBkcmF3WWFyZHMgfSBmcm9tIFwiLi4vZGVjay5qc1wiO1xuaW1wb3J0IHsgcmVzb2x2ZUJpZ1BsYXkgfSBmcm9tIFwiLi9iaWdQbGF5LmpzXCI7XG5pbXBvcnQge1xuICBhcHBseVlhcmRhZ2VPdXRjb21lLFxuICBibGFua1BpY2ssXG4gIHR5cGUgU3BlY2lhbFJlc29sdXRpb24sXG59IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVNhbWVQbGF5KHN0YXRlOiBHYW1lU3RhdGUsIHJuZzogUm5nKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG5cbiAgY29uc3QgY29pbiA9IHJuZy5jb2luRmxpcCgpO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiU0FNRV9QTEFZX0NPSU5cIiwgb3V0Y29tZTogY29pbiB9KTtcblxuICBjb25zdCBtdWx0RHJhdyA9IGRyYXdNdWx0aXBsaWVyKHN0YXRlLmRlY2ssIHJuZyk7XG4gIGlmIChtdWx0RHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcIm11bHRpcGxpZXJcIiB9KTtcblxuICBjb25zdCBzdGF0ZUFmdGVyTXVsdDogR2FtZVN0YXRlID0geyAuLi5zdGF0ZSwgZGVjazogbXVsdERyYXcuZGVjayB9O1xuICBjb25zdCBoZWFkcyA9IGNvaW4gPT09IFwiaGVhZHNcIjtcblxuICAvLyBLaW5nIFx1MjE5MiBCaWcgUGxheSBmb3Igd2hpY2hldmVyIHNpZGUgd2lucyB0aGUgY29pbi5cbiAgaWYgKG11bHREcmF3LmNhcmQgPT09IFwiS2luZ1wiKSB7XG4gICAgY29uc3QgYmVuZWZpY2lhcnkgPSBoZWFkcyA/IG9mZmVuc2UgOiBvcHAob2ZmZW5zZSk7XG4gICAgY29uc3QgYnAgPSByZXNvbHZlQmlnUGxheShzdGF0ZUFmdGVyTXVsdCwgYmVuZWZpY2lhcnksIHJuZyk7XG4gICAgcmV0dXJuIHsgc3RhdGU6IGJwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLmJwLmV2ZW50c10gfTtcbiAgfVxuXG4gIC8vIDEwIFx1MjE5MiBpbnRlcmNlcHRpb24gKGhlYWRzKSBvciAwIHlhcmRzICh0YWlscykuXG4gIGlmIChtdWx0RHJhdy5jYXJkID09PSBcIjEwXCIpIHtcbiAgICBpZiAoaGVhZHMpIHtcbiAgICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiaW50ZXJjZXB0aW9uXCIgfSk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0ZToge1xuICAgICAgICAgIC4uLnN0YXRlQWZ0ZXJNdWx0LFxuICAgICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgICBmaWVsZDoge1xuICAgICAgICAgICAgLi4uc3RhdGVBZnRlck11bHQuZmllbGQsXG4gICAgICAgICAgICBvZmZlbnNlOiBvcHAob2ZmZW5zZSksXG4gICAgICAgICAgICBiYWxsT246IDEwMCAtIHN0YXRlQWZ0ZXJNdWx0LmZpZWxkLmJhbGxPbixcbiAgICAgICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIDEwMCAtIHN0YXRlQWZ0ZXJNdWx0LmZpZWxkLmJhbGxPbiArIDEwKSxcbiAgICAgICAgICAgIGRvd246IDEsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgZXZlbnRzLFxuICAgICAgfTtcbiAgICB9XG4gICAgLy8gMCB5YXJkcywgZG93biBjb25zdW1lZC5cbiAgICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShzdGF0ZUFmdGVyTXVsdCwgMCwgZXZlbnRzKTtcbiAgfVxuXG4gIC8vIFF1ZWVuIG9yIEphY2sgXHUyMTkyIG11bHRpcGxpZXIsIHRoZW4gZHJhdyB5YXJkcyBjYXJkLlxuICBsZXQgbXVsdGlwbGllciA9IDA7XG4gIGlmIChtdWx0RHJhdy5jYXJkID09PSBcIlF1ZWVuXCIpIG11bHRpcGxpZXIgPSBoZWFkcyA/IDMgOiAwO1xuICBpZiAobXVsdERyYXcuY2FyZCA9PT0gXCJKYWNrXCIpIG11bHRpcGxpZXIgPSBoZWFkcyA/IDAgOiAtMztcblxuICBpZiAobXVsdGlwbGllciA9PT0gMCkge1xuICAgIC8vIDAgeWFyZHMsIGRvd24gY29uc3VtZWQuXG4gICAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoc3RhdGVBZnRlck11bHQsIDAsIGV2ZW50cyk7XG4gIH1cblxuICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMoc3RhdGVBZnRlck11bHQuZGVjaywgcm5nKTtcbiAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG5cbiAgY29uc3QgeWFyZHMgPSBNYXRoLnJvdW5kKG11bHRpcGxpZXIgKiB5YXJkc0RyYXcuY2FyZCk7XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgIG9mZmVuc2VQbGF5OiBzdGF0ZS5wZW5kaW5nUGljay5vZmZlbnNlUGxheSA/PyBcIlNSXCIsXG4gICAgZGVmZW5zZVBsYXk6IHN0YXRlLnBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5ID8/IFwiU1JcIixcbiAgICBtYXRjaHVwUXVhbGl0eTogMCxcbiAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IG11bHREcmF3LmNhcmQsIHZhbHVlOiBtdWx0aXBsaWVyIH0sXG4gICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgICB5YXJkc0dhaW5lZDogeWFyZHMsXG4gICAgbmV3QmFsbE9uOiBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHN0YXRlQWZ0ZXJNdWx0LmZpZWxkLmJhbGxPbiArIHlhcmRzKSksXG4gIH0pO1xuXG4gIHJldHVybiBhcHBseVlhcmRhZ2VPdXRjb21lKFxuICAgIHsgLi4uc3RhdGVBZnRlck11bHQsIGRlY2s6IHlhcmRzRHJhdy5kZWNrIH0sXG4gICAgeWFyZHMsXG4gICAgZXZlbnRzLFxuICApO1xufVxuIiwgIi8qKlxuICogVHJpY2sgUGxheSByZXNvbHV0aW9uIChydW4uanM6MTk4NykuIE9uZSBwZXIgc2h1ZmZsZSwgY2FsbGVkIGJ5IGVpdGhlclxuICogb2ZmZW5zZSBvciBkZWZlbnNlLiBEaWUgcm9sbCBvdXRjb21lcyAoZnJvbSB0aGUgKmNhbGxlcidzKiBwZXJzcGVjdGl2ZSk6XG4gKlxuICogICAxIFx1MjE5MiBMb25nIFBhc3Mgd2l0aCArNSBib251cyAgIChtYXRjaHVwIHVzZXMgTFAgdnMgdGhlIG90aGVyIHNpZGUncyBwaWNrKVxuICogICAyIFx1MjE5MiAxNS15YXJkIHBlbmFsdHkgb24gb3Bwb3Npbmcgc2lkZSAoaGFsZi10by1nb2FsIGlmIHRpZ2h0KVxuICogICAzIFx1MjE5MiBmaXhlZCAtM3ggbXVsdGlwbGllciwgZHJhdyB5YXJkcyBjYXJkXG4gKiAgIDQgXHUyMTkyIGZpeGVkICs0eCBtdWx0aXBsaWVyLCBkcmF3IHlhcmRzIGNhcmRcbiAqICAgNSBcdTIxOTIgQmlnIFBsYXkgKGJlbmVmaWNpYXJ5ID0gY2FsbGVyKVxuICogICA2IFx1MjE5MiBMb25nIFJ1biB3aXRoICs1IGJvbnVzXG4gKlxuICogV2hlbiB0aGUgY2FsbGVyIGlzIHRoZSBkZWZlbnNlLCB0aGUgeWFyZGFnZSBzaWducyBpbnZlcnQgKGRlZmVuc2UgZ2FpbnMgPVxuICogb2ZmZW5zZSBsb3NlcyksIHRoZSBMUi9MUCBvdmVybGF5IGlzIGFwcGxpZWQgdG8gdGhlIGRlZmVuc2l2ZSBjYWxsLCBhbmRcbiAqIHRoZSBCaWcgUGxheSBiZW5lZmljaWFyeSBpcyBkZWZlbnNlLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBQbGF5ZXJJZCwgUmVndWxhclBsYXkgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IGRyYXdNdWx0aXBsaWVyLCBkcmF3WWFyZHMgfSBmcm9tIFwiLi4vZGVjay5qc1wiO1xuaW1wb3J0IHsgTVVMVEksIG1hdGNodXBRdWFsaXR5IH0gZnJvbSBcIi4uL21hdGNodXAuanNcIjtcbmltcG9ydCB7IHJlc29sdmVCaWdQbGF5IH0gZnJvbSBcIi4vYmlnUGxheS5qc1wiO1xuaW1wb3J0IHtcbiAgYXBwbHlZYXJkYWdlT3V0Y29tZSxcbiAgYmxhbmtQaWNrLFxuICB0eXBlIFNwZWNpYWxSZXNvbHV0aW9uLFxufSBmcm9tIFwiLi9zaGFyZWQuanNcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVPZmZlbnNpdmVUcmlja1BsYXkoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHJuZzogUm5nLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgZGllID0gcm5nLmQ2KCk7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFt7IHR5cGU6IFwiVFJJQ0tfUExBWV9ST0xMXCIsIG91dGNvbWU6IGRpZSB9XTtcblxuICAvLyA1IFx1MjE5MiBCaWcgUGxheSBmb3Igb2ZmZW5zZSAoY2FsbGVyKS5cbiAgaWYgKGRpZSA9PT0gNSkge1xuICAgIGNvbnN0IGJwID0gcmVzb2x2ZUJpZ1BsYXkoc3RhdGUsIG9mZmVuc2UsIHJuZyk7XG4gICAgcmV0dXJuIHsgc3RhdGU6IGJwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLmJwLmV2ZW50c10gfTtcbiAgfVxuXG4gIC8vIDIgXHUyMTkyIDE1LXlhcmQgcGVuYWx0eSBvbiBkZWZlbnNlICg9IG9mZmVuc2UgZ2FpbnMgMTUgb3IgaGFsZi10by1nb2FsKS5cbiAgaWYgKGRpZSA9PT0gMikge1xuICAgIGNvbnN0IHJhd0dhaW4gPSAxNTtcbiAgICBjb25zdCBnYWluID1cbiAgICAgIHN0YXRlLmZpZWxkLmJhbGxPbiArIHJhd0dhaW4gPiA5OVxuICAgICAgICA/IE1hdGgudHJ1bmMoKDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbikgLyAyKVxuICAgICAgICA6IHJhd0dhaW47XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlBFTkFMVFlcIiwgYWdhaW5zdDogb3Bwb25lbnQob2ZmZW5zZSksIHlhcmRzOiBnYWluLCBsb3NzT2ZEb3duOiBmYWxzZSB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICAuLi5zdGF0ZS5maWVsZCxcbiAgICAgICAgICBiYWxsT246IE1hdGgubWluKDEwMCwgc3RhdGUuZmllbGQuYmFsbE9uICsgZ2FpbiksXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyAzIG9yIDQgXHUyMTkyIGZpeGVkIG11bHRpcGxpZXIsIGRyYXcgeWFyZHMgY2FyZC5cbiAgaWYgKGRpZSA9PT0gMyB8fCBkaWUgPT09IDQpIHtcbiAgICBjb25zdCBtdWx0aXBsaWVyID0gZGllID09PSAzID8gLTMgOiA0O1xuICAgIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhzdGF0ZS5kZWNrLCBybmcpO1xuICAgIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuICAgIGNvbnN0IHlhcmRzID0gTWF0aC5yb3VuZChtdWx0aXBsaWVyICogeWFyZHNEcmF3LmNhcmQpO1xuXG4gICAgZXZlbnRzLnB1c2goe1xuICAgICAgdHlwZTogXCJQTEFZX1JFU09MVkVEXCIsXG4gICAgICBvZmZlbnNlUGxheTogXCJUUFwiLFxuICAgICAgZGVmZW5zZVBsYXk6IHN0YXRlLnBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5ID8/IFwiU1JcIixcbiAgICAgIG1hdGNodXBRdWFsaXR5OiAwLFxuICAgICAgbXVsdGlwbGllcjogeyBjYXJkOiBcIktpbmdcIiwgdmFsdWU6IG11bHRpcGxpZXIgfSxcbiAgICAgIHlhcmRzQ2FyZDogeWFyZHNEcmF3LmNhcmQsXG4gICAgICB5YXJkc0dhaW5lZDogeWFyZHMsXG4gICAgICBuZXdCYWxsT246IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgc3RhdGUuZmllbGQuYmFsbE9uICsgeWFyZHMpKSxcbiAgICB9KTtcblxuICAgIHJldHVybiBhcHBseVlhcmRhZ2VPdXRjb21lKFxuICAgICAgeyAuLi5zdGF0ZSwgZGVjazogeWFyZHNEcmF3LmRlY2sgfSxcbiAgICAgIHlhcmRzLFxuICAgICAgZXZlbnRzLFxuICAgICk7XG4gIH1cblxuICAvLyAxIG9yIDYgXHUyMTkyIHJlZ3VsYXIgcGxheSByZXNvbHV0aW9uIHdpdGggZm9yY2VkIG9mZmVuc2UgcGxheSArIGJvbnVzLlxuICBjb25zdCBmb3JjZWRQbGF5OiBSZWd1bGFyUGxheSA9IGRpZSA9PT0gMSA/IFwiTFBcIiA6IFwiTFJcIjtcbiAgY29uc3QgYm9udXMgPSA1O1xuICBjb25zdCBkZWZlbnNlUGxheSA9IHN0YXRlLnBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5ID8/IFwiU1JcIjtcblxuICAvLyBNdXN0IGJlIGEgcmVndWxhciBwbGF5IGZvciBtYXRjaHVwIHRvIGJlIG1lYW5pbmdmdWwuIElmIGRlZmVuc2UgYWxzbyBwaWNrZWRcbiAgLy8gc29tZXRoaW5nIHdlaXJkLCBmYWxsIGJhY2sgdG8gcXVhbGl0eSAzIChuZXV0cmFsKS5cbiAgY29uc3QgZGVmUGxheSA9IGlzUmVndWxhcihkZWZlbnNlUGxheSkgPyBkZWZlbnNlUGxheSA6IFwiU1JcIjtcbiAgY29uc3QgcXVhbGl0eSA9IG1hdGNodXBRdWFsaXR5KGZvcmNlZFBsYXksIGRlZlBsYXkpO1xuXG4gIGNvbnN0IG11bHREcmF3ID0gZHJhd011bHRpcGxpZXIoc3RhdGUuZGVjaywgcm5nKTtcbiAgaWYgKG11bHREcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwibXVsdGlwbGllclwiIH0pO1xuICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMobXVsdERyYXcuZGVjaywgcm5nKTtcbiAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG5cbiAgY29uc3QgbXVsdFJvdyA9IE1VTFRJW211bHREcmF3LmluZGV4XTtcbiAgY29uc3QgbXVsdGlwbGllciA9IG11bHRSb3c/LltxdWFsaXR5IC0gMV0gPz8gMDtcbiAgY29uc3QgeWFyZHMgPSBNYXRoLnJvdW5kKG11bHRpcGxpZXIgKiB5YXJkc0RyYXcuY2FyZCkgKyBib251cztcblxuICBldmVudHMucHVzaCh7XG4gICAgdHlwZTogXCJQTEFZX1JFU09MVkVEXCIsXG4gICAgb2ZmZW5zZVBsYXk6IGZvcmNlZFBsYXksXG4gICAgZGVmZW5zZVBsYXk6IGRlZlBsYXksXG4gICAgbWF0Y2h1cFF1YWxpdHk6IHF1YWxpdHksXG4gICAgbXVsdGlwbGllcjogeyBjYXJkOiBtdWx0RHJhdy5jYXJkLCB2YWx1ZTogbXVsdGlwbGllciB9LFxuICAgIHlhcmRzQ2FyZDogeWFyZHNEcmF3LmNhcmQsXG4gICAgeWFyZHNHYWluZWQ6IHlhcmRzLFxuICAgIG5ld0JhbGxPbjogTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBzdGF0ZS5maWVsZC5iYWxsT24gKyB5YXJkcykpLFxuICB9KTtcblxuICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShcbiAgICB7IC4uLnN0YXRlLCBkZWNrOiB5YXJkc0RyYXcuZGVjayB9LFxuICAgIHlhcmRzLFxuICAgIGV2ZW50cyxcbiAgKTtcbn1cblxuZnVuY3Rpb24gaXNSZWd1bGFyKHA6IHN0cmluZyk6IHAgaXMgUmVndWxhclBsYXkge1xuICByZXR1cm4gcCA9PT0gXCJTUlwiIHx8IHAgPT09IFwiTFJcIiB8fCBwID09PSBcIlNQXCIgfHwgcCA9PT0gXCJMUFwiO1xufVxuXG5mdW5jdGlvbiBvcHBvbmVudChwOiBQbGF5ZXJJZCk6IFBsYXllcklkIHtcbiAgcmV0dXJuIHAgPT09IDEgPyAyIDogMTtcbn1cblxuLyoqXG4gKiBEZWZlbnNlIGNhbGxzIFRyaWNrIFBsYXkuIFN5bW1ldHJpYyB0byB0aGUgb2ZmZW5zaXZlIHZlcnNpb24gd2l0aCB0aGVcbiAqIHlhcmRhZ2Ugc2lnbiBpbnZlcnRlZCBvbiB0aGUgTFIvTFAgYW5kIHBlbmFsdHkgYnJhbmNoZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlRGVmZW5zaXZlVHJpY2tQbGF5KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBybmc6IFJuZyxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGRlZmVuZGVyID0gb3Bwb25lbnQob2ZmZW5zZSk7XG4gIGNvbnN0IGRpZSA9IHJuZy5kNigpO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbeyB0eXBlOiBcIlRSSUNLX1BMQVlfUk9MTFwiLCBvdXRjb21lOiBkaWUgfV07XG5cbiAgLy8gNSBcdTIxOTIgQmlnIFBsYXkgZm9yIGRlZmVuc2UgKGNhbGxlcikuXG4gIGlmIChkaWUgPT09IDUpIHtcbiAgICBjb25zdCBicCA9IHJlc29sdmVCaWdQbGF5KHN0YXRlLCBkZWZlbmRlciwgcm5nKTtcbiAgICByZXR1cm4geyBzdGF0ZTogYnAuc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4uYnAuZXZlbnRzXSB9O1xuICB9XG5cbiAgLy8gMiBcdTIxOTIgMTUteWFyZCBwZW5hbHR5IG9uIG9mZmVuc2UgKD0gb2ZmZW5zZSBsb3NlcyAxNSBvciBoYWxmLXRvLW93bi1nb2FsKS5cbiAgaWYgKGRpZSA9PT0gMikge1xuICAgIGNvbnN0IHJhd0xvc3MgPSAtMTU7XG4gICAgY29uc3QgbG9zcyA9XG4gICAgICBzdGF0ZS5maWVsZC5iYWxsT24gKyByYXdMb3NzIDwgMVxuICAgICAgICA/IC1NYXRoLnRydW5jKHN0YXRlLmZpZWxkLmJhbGxPbiAvIDIpXG4gICAgICAgIDogcmF3TG9zcztcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiUEVOQUxUWVwiLCBhZ2FpbnN0OiBvZmZlbnNlLCB5YXJkczogbG9zcywgbG9zc09mRG93bjogZmFsc2UgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwZW5kaW5nUGljazogeyBvZmZlbnNlUGxheTogbnVsbCwgZGVmZW5zZVBsYXk6IG51bGwgfSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICAuLi5zdGF0ZS5maWVsZCxcbiAgICAgICAgICBiYWxsT246IE1hdGgubWF4KDAsIHN0YXRlLmZpZWxkLmJhbGxPbiArIGxvc3MpLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gMyBvciA0IFx1MjE5MiBmaXhlZCBtdWx0aXBsaWVyIHdpdGggdGhlICpkZWZlbnNlJ3MqIHNpZ24gY29udmVudGlvbi4gdjUuMVxuICAvLyBhcHBsaWVzIHRoZSBzYW1lICsvLSBtdWx0aXBsaWVycyBhcyBvZmZlbnNpdmUgVHJpY2sgUGxheTsgdGhlIGludmVyc2lvblxuICAvLyBpcyBpbXBsaWNpdCBpbiBkZWZlbnNlIGJlaW5nIHRoZSBjYWxsZXIuIFlhcmRhZ2UgaXMgZnJvbSBvZmZlbnNlIFBPVi5cbiAgaWYgKGRpZSA9PT0gMyB8fCBkaWUgPT09IDQpIHtcbiAgICBjb25zdCBtdWx0aXBsaWVyID0gZGllID09PSAzID8gLTMgOiA0O1xuICAgIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhzdGF0ZS5kZWNrLCBybmcpO1xuICAgIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuICAgIGNvbnN0IHlhcmRzID0gTWF0aC5yb3VuZChtdWx0aXBsaWVyICogeWFyZHNEcmF3LmNhcmQpO1xuXG4gICAgZXZlbnRzLnB1c2goe1xuICAgICAgdHlwZTogXCJQTEFZX1JFU09MVkVEXCIsXG4gICAgICBvZmZlbnNlUGxheTogc3RhdGUucGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPz8gXCJTUlwiLFxuICAgICAgZGVmZW5zZVBsYXk6IFwiVFBcIixcbiAgICAgIG1hdGNodXBRdWFsaXR5OiAwLFxuICAgICAgbXVsdGlwbGllcjogeyBjYXJkOiBcIktpbmdcIiwgdmFsdWU6IG11bHRpcGxpZXIgfSxcbiAgICAgIHlhcmRzQ2FyZDogeWFyZHNEcmF3LmNhcmQsXG4gICAgICB5YXJkc0dhaW5lZDogeWFyZHMsXG4gICAgICBuZXdCYWxsT246IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgc3RhdGUuZmllbGQuYmFsbE9uICsgeWFyZHMpKSxcbiAgICB9KTtcblxuICAgIHJldHVybiBhcHBseVlhcmRhZ2VPdXRjb21lKFxuICAgICAgeyAuLi5zdGF0ZSwgZGVjazogeWFyZHNEcmF3LmRlY2sgfSxcbiAgICAgIHlhcmRzLFxuICAgICAgZXZlbnRzLFxuICAgICk7XG4gIH1cblxuICAvLyAxIG9yIDYgXHUyMTkyIGRlZmVuc2UncyBwaWNrIGJlY29tZXMgTFAgLyBMUiB3aXRoIC01IGJvbnVzIHRvIG9mZmVuc2UuXG4gIGNvbnN0IGZvcmNlZERlZlBsYXk6IFJlZ3VsYXJQbGF5ID0gZGllID09PSAxID8gXCJMUFwiIDogXCJMUlwiO1xuICBjb25zdCBib251cyA9IC01O1xuICBjb25zdCBvZmZlbnNlUGxheSA9IHN0YXRlLnBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ID8/IFwiU1JcIjtcbiAgY29uc3Qgb2ZmUGxheSA9IGlzUmVndWxhcihvZmZlbnNlUGxheSkgPyBvZmZlbnNlUGxheSA6IFwiU1JcIjtcbiAgY29uc3QgcXVhbGl0eSA9IG1hdGNodXBRdWFsaXR5KG9mZlBsYXksIGZvcmNlZERlZlBsYXkpO1xuXG4gIGNvbnN0IG11bHREcmF3ID0gZHJhd011bHRpcGxpZXIoc3RhdGUuZGVjaywgcm5nKTtcbiAgaWYgKG11bHREcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwibXVsdGlwbGllclwiIH0pO1xuICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMobXVsdERyYXcuZGVjaywgcm5nKTtcbiAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG5cbiAgY29uc3QgbXVsdFJvdyA9IE1VTFRJW211bHREcmF3LmluZGV4XTtcbiAgY29uc3QgbXVsdGlwbGllciA9IG11bHRSb3c/LltxdWFsaXR5IC0gMV0gPz8gMDtcbiAgY29uc3QgeWFyZHMgPSBNYXRoLnJvdW5kKG11bHRpcGxpZXIgKiB5YXJkc0RyYXcuY2FyZCkgKyBib251cztcblxuICBldmVudHMucHVzaCh7XG4gICAgdHlwZTogXCJQTEFZX1JFU09MVkVEXCIsXG4gICAgb2ZmZW5zZVBsYXk6IG9mZlBsYXksXG4gICAgZGVmZW5zZVBsYXk6IGZvcmNlZERlZlBsYXksXG4gICAgbWF0Y2h1cFF1YWxpdHk6IHF1YWxpdHksXG4gICAgbXVsdGlwbGllcjogeyBjYXJkOiBtdWx0RHJhdy5jYXJkLCB2YWx1ZTogbXVsdGlwbGllciB9LFxuICAgIHlhcmRzQ2FyZDogeWFyZHNEcmF3LmNhcmQsXG4gICAgeWFyZHNHYWluZWQ6IHlhcmRzLFxuICAgIG5ld0JhbGxPbjogTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBzdGF0ZS5maWVsZC5iYWxsT24gKyB5YXJkcykpLFxuICB9KTtcblxuICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShcbiAgICB7IC4uLnN0YXRlLCBkZWNrOiB5YXJkc0RyYXcuZGVjayB9LFxuICAgIHlhcmRzLFxuICAgIGV2ZW50cyxcbiAgKTtcbn1cbiIsICIvKipcbiAqIEZpZWxkIEdvYWwgKHJ1bi5qczoyMDQwKS5cbiAqXG4gKiBEaXN0YW5jZSA9ICgxMDAgLSBiYWxsT24pICsgMTcuIFNvIGZyb20gdGhlIDUwLCBGRyA9IDY3LXlhcmQgYXR0ZW1wdC5cbiAqXG4gKiBEaWUgcm9sbCBkZXRlcm1pbmVzIHN1Y2Nlc3MgYnkgZGlzdGFuY2UgYmFuZDpcbiAqICAgZGlzdGFuY2UgPiA2NSAgICAgICAgXHUyMTkyIDEtaW4tMTAwMCBjaGFuY2UgKGVmZmVjdGl2ZWx5IGF1dG8tbWlzcylcbiAqICAgZGlzdGFuY2UgPj0gNjAgICAgICAgXHUyMTkyIG5lZWRzIGRpZSA9IDZcbiAqICAgZGlzdGFuY2UgPj0gNTAgICAgICAgXHUyMTkyIG5lZWRzIGRpZSA+PSA1XG4gKiAgIGRpc3RhbmNlID49IDQwICAgICAgIFx1MjE5MiBuZWVkcyBkaWUgPj0gNFxuICogICBkaXN0YW5jZSA+PSAzMCAgICAgICBcdTIxOTIgbmVlZHMgZGllID49IDNcbiAqICAgZGlzdGFuY2UgPj0gMjAgICAgICAgXHUyMTkyIG5lZWRzIGRpZSA+PSAyXG4gKiAgIGRpc3RhbmNlIDwgIDIwICAgICAgIFx1MjE5MiBhdXRvLW1ha2VcbiAqXG4gKiBJZiBhIHRpbWVvdXQgd2FzIGNhbGxlZCBieSB0aGUgZGVmZW5zZSBqdXN0IHByaW9yIChraWNrZXIgaWNpbmcpLCBkaWUrKy5cbiAqXG4gKiBTdWNjZXNzIFx1MjE5MiArMyBwb2ludHMsIGtpY2tvZmYgdG8gb3Bwb25lbnQuXG4gKiBNaXNzICAgIFx1MjE5MiBwb3NzZXNzaW9uIGZsaXBzIGF0IHRoZSBTUE9UIE9GIFRIRSBLSUNLIChub3QgdGhlIGxpbmUgb2Ygc2NyaW1tYWdlKS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4uLy4uL3N0YXRlLmpzXCI7XG5pbXBvcnQgeyBibGFua1BpY2ssIHR5cGUgU3BlY2lhbFJlc29sdXRpb24gfSBmcm9tIFwiLi9zaGFyZWQuanNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBGaWVsZEdvYWxPcHRpb25zIHtcbiAgLyoqIHRydWUgaWYgdGhlIG9wcG9zaW5nIHRlYW0gY2FsbGVkIGEgdGltZW91dCB0aGF0IHNob3VsZCBpY2UgdGhlIGtpY2tlci4gKi9cbiAgaWNlZD86IGJvb2xlYW47XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlRmllbGRHb2FsKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBybmc6IFJuZyxcbiAgb3B0czogRmllbGRHb2FsT3B0aW9ucyA9IHt9LFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgZGlzdGFuY2UgPSAxMDAgLSBzdGF0ZS5maWVsZC5iYWxsT24gKyAxNztcbiAgY29uc3QgcmF3RGllID0gcm5nLmQ2KCk7XG4gIGNvbnN0IGRpZSA9IG9wdHMuaWNlZCA/IE1hdGgubWluKDYsIHJhd0RpZSArIDEpIDogcmF3RGllO1xuXG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuXG4gIGxldCBtYWtlOiBib29sZWFuO1xuICBpZiAoZGlzdGFuY2UgPiA2NSkge1xuICAgIC8vIEVzc2VudGlhbGx5IGltcG9zc2libGUgXHUyMDE0IHJvbGxlZCAxLTEwMDAsIG1ha2Ugb25seSBvbiBleGFjdCBoaXQuXG4gICAgbWFrZSA9IHJuZy5pbnRCZXR3ZWVuKDEsIDEwMDApID09PSBkaXN0YW5jZTtcbiAgfSBlbHNlIGlmIChkaXN0YW5jZSA+PSA2MCkgbWFrZSA9IGRpZSA+PSA2O1xuICBlbHNlIGlmIChkaXN0YW5jZSA+PSA1MCkgbWFrZSA9IGRpZSA+PSA1O1xuICBlbHNlIGlmIChkaXN0YW5jZSA+PSA0MCkgbWFrZSA9IGRpZSA+PSA0O1xuICBlbHNlIGlmIChkaXN0YW5jZSA+PSAzMCkgbWFrZSA9IGRpZSA+PSAzO1xuICBlbHNlIGlmIChkaXN0YW5jZSA+PSAyMCkgbWFrZSA9IGRpZSA+PSAyO1xuICBlbHNlIG1ha2UgPSB0cnVlO1xuXG4gIGlmIChtYWtlKSB7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkZJRUxEX0dPQUxfR09PRFwiLCBwbGF5ZXI6IG9mZmVuc2UgfSk7XG4gICAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICBbb2ZmZW5zZV06IHsgLi4uc3RhdGUucGxheWVyc1tvZmZlbnNlXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbb2ZmZW5zZV0uc2NvcmUgKyAzIH0sXG4gICAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBwaGFzZTogXCJLSUNLT0ZGXCIsXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICBldmVudHMucHVzaCh7IHR5cGU6IFwiRklFTERfR09BTF9NSVNTRURcIiwgcGxheWVyOiBvZmZlbnNlIH0pO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcIm1pc3NlZF9mZ1wiIH0pO1xuXG4gIC8vIFBvc3Nlc3Npb24gZmxpcHMgYXQgbGluZSBvZiBzY3JpbW1hZ2UgKGJhbGwgc3RheXMgd2hlcmUga2lja2VkIGZyb20pLlxuICBjb25zdCBkZWZlbmRlciA9IG9wcChvZmZlbnNlKTtcbiAgY29uc3QgbWlycm9yZWRCYWxsT24gPSAxMDAgLSBzdGF0ZS5maWVsZC5iYWxsT247XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgYmFsbE9uOiBtaXJyb3JlZEJhbGxPbixcbiAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgbWlycm9yZWRCYWxsT24gKyAxMCksXG4gICAgICAgIGRvd246IDEsXG4gICAgICAgIG9mZmVuc2U6IGRlZmVuZGVyLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cbiIsICIvKipcbiAqIE92ZXJ0aW1lIG1lY2hhbmljcy5cbiAqXG4gKiBDb2xsZWdlLWZvb3RiYWxsIHN0eWxlOlxuICogICAtIEVhY2ggcGVyaW9kOiBlYWNoIHRlYW0gZ2V0cyBvbmUgcG9zc2Vzc2lvbiBmcm9tIHRoZSBvcHBvbmVudCdzIDI1XG4gKiAgICAgKG9mZmVuc2UgUE9WOiBiYWxsT24gPSA3NSkuXG4gKiAgIC0gQSBwb3NzZXNzaW9uIGVuZHMgd2l0aDogVEQgKGZvbGxvd2VkIGJ5IFBBVC8ycHQpLCBGRyAobWFkZSBvciBtaXNzZWQpLFxuICogICAgIHR1cm5vdmVyLCB0dXJub3Zlci1vbi1kb3ducywgb3Igc2FmZXR5LlxuICogICAtIEFmdGVyIGJvdGggcG9zc2Vzc2lvbnMsIGlmIHNjb3JlcyBkaWZmZXIgXHUyMTkyIEdBTUVfT1ZFUi4gSWYgdGllZCBcdTIxOTIgbmV4dFxuICogICAgIHBlcmlvZC5cbiAqICAgLSBQZXJpb2RzIGFsdGVybmF0ZSB3aG8gcG9zc2Vzc2VzIGZpcnN0LlxuICogICAtIFBlcmlvZCAzKzogMi1wb2ludCBjb252ZXJzaW9uIG1hbmRhdG9yeSBhZnRlciBhIFREIChubyBQQVQga2ljaykuXG4gKiAgIC0gSGFpbCBNYXJ5czogMiBwZXIgcGVyaW9kLCByZWZpbGxlZCBhdCBzdGFydCBvZiBlYWNoIHBlcmlvZC5cbiAqICAgLSBUaW1lb3V0czogMSBwZXIgcGFpciBvZiBwZXJpb2RzLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgT3ZlcnRpbWVTdGF0ZSwgUGxheWVySWQgfSBmcm9tIFwiLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IGVtcHR5SGFuZCwgb3BwIH0gZnJvbSBcIi4uL3N0YXRlLmpzXCI7XG5pbXBvcnQgeyBmcmVzaERlY2tNdWx0aXBsaWVycywgZnJlc2hEZWNrWWFyZHMgfSBmcm9tIFwiLi4vc3RhdGUuanNcIjtcblxuY29uc3QgT1RfQkFMTF9PTiA9IDc1OyAvLyBvcHBvbmVudCdzIDI1LXlhcmQgbGluZSwgZnJvbSBvZmZlbnNlIFBPVlxuXG4vKipcbiAqIEluaXRpYWxpemUgT1Qgc3RhdGUsIHJlZnJlc2ggZGVja3MvaGFuZHMsIHNldCBiYWxsIGF0IHRoZSAyNS5cbiAqIENhbGxlZCBvbmNlIHRpZWQgcmVndWxhdGlvbiBlbmRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3RhcnRPdmVydGltZShzdGF0ZTogR2FtZVN0YXRlKTogeyBzdGF0ZTogR2FtZVN0YXRlOyBldmVudHM6IEV2ZW50W10gfSB7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuICBjb25zdCBmaXJzdFJlY2VpdmVyOiBQbGF5ZXJJZCA9IHN0YXRlLm9wZW5pbmdSZWNlaXZlciA9PT0gMSA/IDIgOiAxO1xuICBjb25zdCBvdmVydGltZTogT3ZlcnRpbWVTdGF0ZSA9IHtcbiAgICBwZXJpb2Q6IDEsXG4gICAgcG9zc2Vzc2lvbjogZmlyc3RSZWNlaXZlcixcbiAgICBmaXJzdFJlY2VpdmVyLFxuICAgIHBvc3Nlc3Npb25zUmVtYWluaW5nOiAyLFxuICB9O1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiT1ZFUlRJTUVfU1RBUlRFRFwiLCBwZXJpb2Q6IDEsIHBvc3Nlc3Npb246IGZpcnN0UmVjZWl2ZXIgfSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGhhc2U6IFwiT1RfU1RBUlRcIixcbiAgICAgIG92ZXJ0aW1lLFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG4vKiogQmVnaW4gKG9yIHJlc3VtZSkgdGhlIG5leHQgT1QgcG9zc2Vzc2lvbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGFydE92ZXJ0aW1lUG9zc2Vzc2lvbihzdGF0ZTogR2FtZVN0YXRlKTogeyBzdGF0ZTogR2FtZVN0YXRlOyBldmVudHM6IEV2ZW50W10gfSB7XG4gIGlmICghc3RhdGUub3ZlcnRpbWUpIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG5cbiAgY29uc3QgcG9zc2Vzc2lvbiA9IHN0YXRlLm92ZXJ0aW1lLnBvc3Nlc3Npb247XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuXG4gIC8vIFJlZmlsbCBITSBjb3VudCBmb3IgdGhlIHBvc3Nlc3Npb24ncyBvZmZlbnNlIChtYXRjaGVzIHY1LjE6IEhNIHJlc2V0c1xuICAvLyBwZXIgT1QgcGVyaW9kKS4gUGVyaW9kIDMrIHBsYXllcnMgaGF2ZSBvbmx5IDIgSE1zIGFueXdheS5cbiAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtwb3NzZXNzaW9uXToge1xuICAgICAgLi4uc3RhdGUucGxheWVyc1twb3NzZXNzaW9uXSxcbiAgICAgIGhhbmQ6IHsgLi4uc3RhdGUucGxheWVyc1twb3NzZXNzaW9uXS5oYW5kLCBITTogc3RhdGUub3ZlcnRpbWUucGVyaW9kID49IDMgPyAyIDogMiB9LFxuICAgIH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICBwaGFzZTogXCJPVF9QTEFZXCIsXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IE9UX0JBTExfT04sXG4gICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIE9UX0JBTExfT04gKyAxMCksXG4gICAgICAgIGRvd246IDEsXG4gICAgICAgIG9mZmVuc2U6IHBvc3Nlc3Npb24sXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG4vKipcbiAqIEVuZCB0aGUgY3VycmVudCBPVCBwb3NzZXNzaW9uLiBEZWNyZW1lbnRzIHBvc3Nlc3Npb25zUmVtYWluaW5nOyBpZiAwLFxuICogY2hlY2tzIGZvciBnYW1lIGVuZC4gT3RoZXJ3aXNlIGZsaXBzIHBvc3Nlc3Npb24uXG4gKlxuICogQ2FsbGVyIGlzIHJlc3BvbnNpYmxlIGZvciBkZXRlY3RpbmcgXCJ0aGlzIHdhcyBhIHBvc3Nlc3Npb24tZW5kaW5nIGV2ZW50XCJcbiAqIChURCtQQVQsIEZHIGRlY2lzaW9uLCB0dXJub3ZlciwgZXRjKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuZE92ZXJ0aW1lUG9zc2Vzc2lvbihzdGF0ZTogR2FtZVN0YXRlKTogeyBzdGF0ZTogR2FtZVN0YXRlOyBldmVudHM6IEV2ZW50W10gfSB7XG4gIGlmICghc3RhdGUub3ZlcnRpbWUpIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG5cbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG4gIGNvbnN0IHJlbWFpbmluZyA9IHN0YXRlLm92ZXJ0aW1lLnBvc3Nlc3Npb25zUmVtYWluaW5nO1xuXG4gIGlmIChyZW1haW5pbmcgPT09IDIpIHtcbiAgICAvLyBGaXJzdCBwb3NzZXNzaW9uIGVuZGVkLiBGbGlwIHRvIHNlY29uZCB0ZWFtLCBmcmVzaCBiYWxsLlxuICAgIGNvbnN0IG5leHRQb3NzZXNzaW9uID0gb3BwKHN0YXRlLm92ZXJ0aW1lLnBvc3Nlc3Npb24pO1xuICAgIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgW25leHRQb3NzZXNzaW9uXToge1xuICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzW25leHRQb3NzZXNzaW9uXSxcbiAgICAgICAgaGFuZDogeyAuLi5zdGF0ZS5wbGF5ZXJzW25leHRQb3NzZXNzaW9uXS5oYW5kLCBITTogMiB9LFxuICAgICAgfSxcbiAgICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgICBwaGFzZTogXCJPVF9QTEFZXCIsXG4gICAgICAgIG92ZXJ0aW1lOiB7IC4uLnN0YXRlLm92ZXJ0aW1lLCBwb3NzZXNzaW9uOiBuZXh0UG9zc2Vzc2lvbiwgcG9zc2Vzc2lvbnNSZW1haW5pbmc6IDEgfSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICBiYWxsT246IE9UX0JBTExfT04sXG4gICAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgT1RfQkFMTF9PTiArIDEwKSxcbiAgICAgICAgICBkb3duOiAxLFxuICAgICAgICAgIG9mZmVuc2U6IG5leHRQb3NzZXNzaW9uLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gU2Vjb25kIHBvc3Nlc3Npb24gZW5kZWQuIENvbXBhcmUgc2NvcmVzLlxuICBjb25zdCBwMSA9IHN0YXRlLnBsYXllcnNbMV0uc2NvcmU7XG4gIGNvbnN0IHAyID0gc3RhdGUucGxheWVyc1syXS5zY29yZTtcbiAgaWYgKHAxICE9PSBwMikge1xuICAgIGNvbnN0IHdpbm5lcjogUGxheWVySWQgPSBwMSA+IHAyID8gMSA6IDI7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkdBTUVfT1ZFUlwiLCB3aW5uZXIgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwaGFzZTogXCJHQU1FX09WRVJcIixcbiAgICAgICAgb3ZlcnRpbWU6IHsgLi4uc3RhdGUub3ZlcnRpbWUsIHBvc3Nlc3Npb25zUmVtYWluaW5nOiAwIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBUaWVkIFx1MjAxNCBzdGFydCBuZXh0IHBlcmlvZC4gQWx0ZXJuYXRlcyBmaXJzdC1wb3NzZXNzb3IuXG4gIGNvbnN0IG5leHRQZXJpb2QgPSBzdGF0ZS5vdmVydGltZS5wZXJpb2QgKyAxO1xuICBjb25zdCBuZXh0Rmlyc3QgPSBvcHAoc3RhdGUub3ZlcnRpbWUuZmlyc3RSZWNlaXZlcik7XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJPVkVSVElNRV9TVEFSVEVEXCIsIHBlcmlvZDogbmV4dFBlcmlvZCwgcG9zc2Vzc2lvbjogbmV4dEZpcnN0IH0pO1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBoYXNlOiBcIk9UX1NUQVJUXCIsXG4gICAgICBvdmVydGltZToge1xuICAgICAgICBwZXJpb2Q6IG5leHRQZXJpb2QsXG4gICAgICAgIHBvc3Nlc3Npb246IG5leHRGaXJzdCxcbiAgICAgICAgZmlyc3RSZWNlaXZlcjogbmV4dEZpcnN0LFxuICAgICAgICBwb3NzZXNzaW9uc1JlbWFpbmluZzogMixcbiAgICAgIH0sXG4gICAgICAvLyBGcmVzaCBkZWNrcyBmb3IgdGhlIG5ldyBwZXJpb2QuXG4gICAgICBkZWNrOiB7IG11bHRpcGxpZXJzOiBmcmVzaERlY2tNdWx0aXBsaWVycygpLCB5YXJkczogZnJlc2hEZWNrWWFyZHMoKSB9LFxuICAgICAgcGxheWVyczoge1xuICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICAxOiB7IC4uLnN0YXRlLnBsYXllcnNbMV0sIGhhbmQ6IGVtcHR5SGFuZCh0cnVlKSB9LFxuICAgICAgICAyOiB7IC4uLnN0YXRlLnBsYXllcnNbMl0sIGhhbmQ6IGVtcHR5SGFuZCh0cnVlKSB9LFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuLyoqXG4gKiBEZXRlY3Qgd2hldGhlciBhIHNlcXVlbmNlIG9mIGV2ZW50cyBmcm9tIGEgcGxheSByZXNvbHV0aW9uIHNob3VsZCBlbmRcbiAqIHRoZSBjdXJyZW50IE9UIHBvc3Nlc3Npb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1Bvc3Nlc3Npb25FbmRpbmdJbk9UKGV2ZW50czogUmVhZG9ubHlBcnJheTxFdmVudD4pOiBib29sZWFuIHtcbiAgZm9yIChjb25zdCBlIG9mIGV2ZW50cykge1xuICAgIHN3aXRjaCAoZS50eXBlKSB7XG4gICAgICBjYXNlIFwiUEFUX0dPT0RcIjpcbiAgICAgIGNhc2UgXCJUV09fUE9JTlRfR09PRFwiOlxuICAgICAgY2FzZSBcIlRXT19QT0lOVF9GQUlMRURcIjpcbiAgICAgIGNhc2UgXCJGSUVMRF9HT0FMX0dPT0RcIjpcbiAgICAgIGNhc2UgXCJGSUVMRF9HT0FMX01JU1NFRFwiOlxuICAgICAgY2FzZSBcIlRVUk5PVkVSXCI6XG4gICAgICBjYXNlIFwiVFVSTk9WRVJfT05fRE9XTlNcIjpcbiAgICAgIGNhc2UgXCJTQUZFVFlcIjpcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cbiIsICIvKipcbiAqIFRoZSBzaW5nbGUgdHJhbnNpdGlvbiBmdW5jdGlvbi4gVGFrZXMgKHN0YXRlLCBhY3Rpb24sIHJuZykgYW5kIHJldHVybnNcbiAqIGEgbmV3IHN0YXRlIHBsdXMgdGhlIGV2ZW50cyB0aGF0IGRlc2NyaWJlIHdoYXQgaGFwcGVuZWQuXG4gKlxuICogVGhpcyBmaWxlIGlzIHRoZSAqc2tlbGV0b24qIFx1MjAxNCB0aGUgZGlzcGF0Y2ggc2hhcGUgaXMgaGVyZSwgdGhlIGNhc2VzIGFyZVxuICogbW9zdGx5IHN0dWJzIG1hcmtlZCBgLy8gVE9ETzogcG9ydCBmcm9tIHJ1bi5qc2AuIEFzIHdlIHBvcnQsIGVhY2ggY2FzZVxuICogZ2V0cyB1bml0LXRlc3RlZC4gV2hlbiBldmVyeSBjYXNlIGlzIGltcGxlbWVudGVkIGFuZCB0ZXN0ZWQsIHY1LjEncyBydW4uanNcbiAqIGNhbiBiZSBkZWxldGVkLlxuICpcbiAqIFJ1bGVzIGZvciB0aGlzIGZpbGU6XG4gKiAgIDEuIE5FVkVSIGltcG9ydCBmcm9tIERPTSwgbmV0d29yaywgb3IgYW5pbWF0aW9uIG1vZHVsZXMuXG4gKiAgIDIuIE5FVkVSIG11dGF0ZSBgc3RhdGVgIFx1MjAxNCBhbHdheXMgcmV0dXJuIGEgbmV3IG9iamVjdC5cbiAqICAgMy4gTkVWRVIgY2FsbCBNYXRoLnJhbmRvbSBcdTIwMTQgdXNlIHRoZSBgcm5nYCBwYXJhbWV0ZXIuXG4gKiAgIDQuIE5FVkVSIHRocm93IG9uIGludmFsaWQgYWN0aW9ucyBcdTIwMTQgcmV0dXJuIGB7IHN0YXRlLCBldmVudHM6IFtdIH1gXG4gKiAgICAgIGFuZCBsZXQgdGhlIGNhbGxlciBkZWNpZGUuIChWYWxpZGF0aW9uIGlzIHRoZSBzZXJ2ZXIncyBqb2IuKVxuICovXG5cbmltcG9ydCB0eXBlIHsgQWN0aW9uIH0gZnJvbSBcIi4vYWN0aW9ucy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUgfSBmcm9tIFwiLi90eXBlcy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi9ybmcuanNcIjtcbmltcG9ydCB7IGlzUmVndWxhclBsYXksIHJlc29sdmVSZWd1bGFyUGxheSB9IGZyb20gXCIuL3J1bGVzL3BsYXkuanNcIjtcbmltcG9ydCB7XG4gIHJlc29sdmVEZWZlbnNpdmVUcmlja1BsYXksXG4gIHJlc29sdmVGaWVsZEdvYWwsXG4gIHJlc29sdmVIYWlsTWFyeSxcbiAgcmVzb2x2ZUtpY2tvZmYsXG4gIHJlc29sdmVPZmZlbnNpdmVUcmlja1BsYXksXG4gIHJlc29sdmVQdW50LFxuICByZXNvbHZlU2FtZVBsYXksXG59IGZyb20gXCIuL3J1bGVzL3NwZWNpYWxzL2luZGV4LmpzXCI7XG5pbXBvcnQge1xuICBlbmRPdmVydGltZVBvc3Nlc3Npb24sXG4gIGlzUG9zc2Vzc2lvbkVuZGluZ0luT1QsXG4gIHN0YXJ0T3ZlcnRpbWUsXG4gIHN0YXJ0T3ZlcnRpbWVQb3NzZXNzaW9uLFxufSBmcm9tIFwiLi9ydWxlcy9vdmVydGltZS5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4vc3RhdGUuanNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBSZWR1Y2VSZXN1bHQge1xuICBzdGF0ZTogR2FtZVN0YXRlO1xuICBldmVudHM6IEV2ZW50W107XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWR1Y2Uoc3RhdGU6IEdhbWVTdGF0ZSwgYWN0aW9uOiBBY3Rpb24sIHJuZzogUm5nKTogUmVkdWNlUmVzdWx0IHtcbiAgY29uc3QgcmVzdWx0ID0gcmVkdWNlQ29yZShzdGF0ZSwgYWN0aW9uLCBybmcpO1xuICByZXR1cm4gYXBwbHlPdmVydGltZVJvdXRpbmcoc3RhdGUsIHJlc3VsdCk7XG59XG5cbi8qKlxuICogSWYgd2UncmUgaW4gT1QgYW5kIGEgcG9zc2Vzc2lvbi1lbmRpbmcgZXZlbnQganVzdCBmaXJlZCwgcm91dGUgdG8gdGhlXG4gKiBuZXh0IE9UIHBvc3Nlc3Npb24gKG9yIGdhbWUgZW5kKS4gU2tpcHMgd2hlbiB0aGUgYWN0aW9uIGlzIGl0c2VsZiBhbiBPVFxuICogaGVscGVyIChzbyB3ZSBkb24ndCBkb3VibGUtcm91dGUpLlxuICovXG5mdW5jdGlvbiBhcHBseU92ZXJ0aW1lUm91dGluZyhwcmV2U3RhdGU6IEdhbWVTdGF0ZSwgcmVzdWx0OiBSZWR1Y2VSZXN1bHQpOiBSZWR1Y2VSZXN1bHQge1xuICAvLyBPbmx5IGNvbnNpZGVyIHJvdXRpbmcgd2hlbiB3ZSAqd2VyZSogaW4gT1QuIChzdGFydE92ZXJ0aW1lIHNldHMgc3RhdGUub3ZlcnRpbWUuKVxuICBpZiAoIXByZXZTdGF0ZS5vdmVydGltZSAmJiAhcmVzdWx0LnN0YXRlLm92ZXJ0aW1lKSByZXR1cm4gcmVzdWx0O1xuICBpZiAoIXJlc3VsdC5zdGF0ZS5vdmVydGltZSkgcmV0dXJuIHJlc3VsdDtcbiAgaWYgKCFpc1Bvc3Nlc3Npb25FbmRpbmdJbk9UKHJlc3VsdC5ldmVudHMpKSByZXR1cm4gcmVzdWx0O1xuXG4gIC8vIFBBVCBpbiBPVDogYSBURCBzY29yZWQsIGJ1dCBwb3NzZXNzaW9uIGRvZXNuJ3QgZW5kIHVudGlsIFBBVC8ycHQgcmVzb2x2ZXMuXG4gIC8vIFBBVF9HT09EIC8gVFdPX1BPSU5UXyogYXJlIHRoZW1zZWx2ZXMgcG9zc2Vzc2lvbi1lbmRpbmcsIHNvIHRoZXkgRE8gcm91dGUuXG4gIC8vIEFmdGVyIHBvc3Nlc3Npb24gZW5kcywgZGVjaWRlIG5leHQuXG4gIGNvbnN0IGVuZGVkID0gZW5kT3ZlcnRpbWVQb3NzZXNzaW9uKHJlc3VsdC5zdGF0ZSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IGVuZGVkLnN0YXRlLFxuICAgIGV2ZW50czogWy4uLnJlc3VsdC5ldmVudHMsIC4uLmVuZGVkLmV2ZW50c10sXG4gIH07XG59XG5cbmZ1bmN0aW9uIHJlZHVjZUNvcmUoc3RhdGU6IEdhbWVTdGF0ZSwgYWN0aW9uOiBBY3Rpb24sIHJuZzogUm5nKTogUmVkdWNlUmVzdWx0IHtcbiAgc3dpdGNoIChhY3Rpb24udHlwZSkge1xuICAgIGNhc2UgXCJTVEFSVF9HQU1FXCI6XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0ZToge1xuICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgIHBoYXNlOiBcIkNPSU5fVE9TU1wiLFxuICAgICAgICAgIGNsb2NrOiB7XG4gICAgICAgICAgICAuLi5zdGF0ZS5jbG9jayxcbiAgICAgICAgICAgIHF1YXJ0ZXI6IDEsXG4gICAgICAgICAgICBxdWFydGVyTGVuZ3RoTWludXRlczogYWN0aW9uLnF1YXJ0ZXJMZW5ndGhNaW51dGVzLFxuICAgICAgICAgICAgc2Vjb25kc1JlbWFpbmluZzogYWN0aW9uLnF1YXJ0ZXJMZW5ndGhNaW51dGVzICogNjAsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBwbGF5ZXJzOiB7XG4gICAgICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICAgICAgMTogeyAuLi5zdGF0ZS5wbGF5ZXJzWzFdLCB0ZWFtOiB7IGlkOiBhY3Rpb24udGVhbXNbMV0gfSB9LFxuICAgICAgICAgICAgMjogeyAuLi5zdGF0ZS5wbGF5ZXJzWzJdLCB0ZWFtOiB7IGlkOiBhY3Rpb24udGVhbXNbMl0gfSB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGV2ZW50czogW3sgdHlwZTogXCJHQU1FX1NUQVJURURcIiB9XSxcbiAgICAgIH07XG5cbiAgICBjYXNlIFwiQ09JTl9UT1NTX0NBTExcIjoge1xuICAgICAgY29uc3QgYWN0dWFsID0gcm5nLmNvaW5GbGlwKCk7XG4gICAgICBjb25zdCB3aW5uZXIgPSBhY3Rpb24uY2FsbCA9PT0gYWN0dWFsID8gYWN0aW9uLnBsYXllciA6IG9wcChhY3Rpb24ucGxheWVyKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlLFxuICAgICAgICBldmVudHM6IFt7IHR5cGU6IFwiQ09JTl9UT1NTX1JFU1VMVFwiLCByZXN1bHQ6IGFjdHVhbCwgd2lubmVyIH1dLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiUkVDRUlWRV9DSE9JQ0VcIjoge1xuICAgICAgLy8gVGhlIGNhbGxlcidzIGNob2ljZSBkZXRlcm1pbmVzIHdobyByZWNlaXZlcyB0aGUgb3BlbmluZyBraWNrb2ZmLlxuICAgICAgLy8gXCJyZWNlaXZlXCIgXHUyMTkyIGNhbGxlciByZWNlaXZlczsgXCJkZWZlclwiIFx1MjE5MiBjYWxsZXIga2lja3MgKG9wcG9uZW50IHJlY2VpdmVzKS5cbiAgICAgIGNvbnN0IHJlY2VpdmVyID0gYWN0aW9uLmNob2ljZSA9PT0gXCJyZWNlaXZlXCIgPyBhY3Rpb24ucGxheWVyIDogb3BwKGFjdGlvbi5wbGF5ZXIpO1xuICAgICAgLy8gS2lja2VyIGlzIHRoZSBvcGVuaW5nIG9mZmVuc2UgKHRoZXkga2ljayBvZmYpOyByZWNlaXZlciBnZXRzIHRoZSBiYWxsIGFmdGVyLlxuICAgICAgY29uc3Qga2lja2VyID0gb3BwKHJlY2VpdmVyKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgICAgICAgIG9wZW5pbmdSZWNlaXZlcjogcmVjZWl2ZXIsXG4gICAgICAgICAgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IGtpY2tlciB9LFxuICAgICAgICB9LFxuICAgICAgICBldmVudHM6IFt7IHR5cGU6IFwiS0lDS09GRlwiLCByZWNlaXZpbmdQbGF5ZXI6IHJlY2VpdmVyLCBiYWxsT246IDM1IH1dLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiUkVTT0xWRV9LSUNLT0ZGXCI6IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHJlc29sdmVLaWNrb2ZmKHN0YXRlLCBybmcpO1xuICAgICAgcmV0dXJuIHsgc3RhdGU6IHJlc3VsdC5zdGF0ZSwgZXZlbnRzOiByZXN1bHQuZXZlbnRzIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIlNUQVJUX09UX1BPU1NFU1NJT05cIjoge1xuICAgICAgY29uc3QgciA9IHN0YXJ0T3ZlcnRpbWVQb3NzZXNzaW9uKHN0YXRlKTtcbiAgICAgIHJldHVybiB7IHN0YXRlOiByLnN0YXRlLCBldmVudHM6IHIuZXZlbnRzIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIlBJQ0tfUExBWVwiOiB7XG4gICAgICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgICAgIGNvbnN0IGlzT2ZmZW5zaXZlQ2FsbCA9IGFjdGlvbi5wbGF5ZXIgPT09IG9mZmVuc2U7XG5cbiAgICAgIC8vIFZhbGlkYXRlLiBJbGxlZ2FsIHBpY2tzIGFyZSBzaWxlbnRseSBuby1vcCdkOyB0aGUgb3JjaGVzdHJhdG9yXG4gICAgICAvLyAoc2VydmVyIC8gVUkpIGlzIHJlc3BvbnNpYmxlIGZvciBzdXJmYWNpbmcgdGhlIGVycm9yIHRvIHRoZSB1c2VyLlxuICAgICAgaWYgKGFjdGlvbi5wbGF5ID09PSBcIkZHXCIgfHwgYWN0aW9uLnBsYXkgPT09IFwiUFVOVFwiIHx8IGFjdGlvbi5wbGF5ID09PSBcIlRXT19QVFwiKSB7XG4gICAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07IC8vIHdyb25nIGFjdGlvbiB0eXBlIGZvciB0aGVzZVxuICAgICAgfVxuICAgICAgaWYgKGFjdGlvbi5wbGF5ID09PSBcIkhNXCIgJiYgIWlzT2ZmZW5zaXZlQ2FsbCkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9OyAvLyBkZWZlbnNlIGNhbid0IGNhbGwgSGFpbCBNYXJ5XG4gICAgICB9XG4gICAgICBjb25zdCBoYW5kID0gc3RhdGUucGxheWVyc1thY3Rpb24ucGxheWVyXS5oYW5kO1xuICAgICAgaWYgKGFjdGlvbi5wbGF5ID09PSBcIkhNXCIgJiYgaGFuZC5ITSA8PSAwKSB7XG4gICAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gICAgICB9XG4gICAgICBpZiAoXG4gICAgICAgIChhY3Rpb24ucGxheSA9PT0gXCJTUlwiIHx8IGFjdGlvbi5wbGF5ID09PSBcIkxSXCIgfHwgYWN0aW9uLnBsYXkgPT09IFwiU1BcIiB8fCBhY3Rpb24ucGxheSA9PT0gXCJMUFwiIHx8IGFjdGlvbi5wbGF5ID09PSBcIlRQXCIpICYmXG4gICAgICAgIGhhbmRbYWN0aW9uLnBsYXldIDw9IDBcbiAgICAgICkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgfVxuICAgICAgLy8gUmVqZWN0IHJlLXBpY2tzIGZvciB0aGUgc2FtZSBzaWRlIGluIHRoZSBzYW1lIHBsYXkuXG4gICAgICBpZiAoaXNPZmZlbnNpdmVDYWxsICYmIHN0YXRlLnBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5KSB7XG4gICAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gICAgICB9XG4gICAgICBpZiAoIWlzT2ZmZW5zaXZlQ2FsbCAmJiBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgfVxuXG4gICAgICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXG4gICAgICAgIHsgdHlwZTogXCJQTEFZX0NBTExFRFwiLCBwbGF5ZXI6IGFjdGlvbi5wbGF5ZXIsIHBsYXk6IGFjdGlvbi5wbGF5IH0sXG4gICAgICBdO1xuXG4gICAgICBjb25zdCBwZW5kaW5nUGljayA9IHtcbiAgICAgICAgb2ZmZW5zZVBsYXk6IGlzT2ZmZW5zaXZlQ2FsbCA/IGFjdGlvbi5wbGF5IDogc3RhdGUucGVuZGluZ1BpY2sub2ZmZW5zZVBsYXksXG4gICAgICAgIGRlZmVuc2VQbGF5OiBpc09mZmVuc2l2ZUNhbGwgPyBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA6IGFjdGlvbi5wbGF5LFxuICAgICAgfTtcblxuICAgICAgLy8gQm90aCB0ZWFtcyBoYXZlIHBpY2tlZCBcdTIwMTQgcmVzb2x2ZS5cbiAgICAgIGlmIChwZW5kaW5nUGljay5vZmZlbnNlUGxheSAmJiBwZW5kaW5nUGljay5kZWZlbnNlUGxheSkge1xuICAgICAgICBjb25zdCBzdGF0ZVdpdGhQaWNrOiBHYW1lU3RhdGUgPSB7IC4uLnN0YXRlLCBwZW5kaW5nUGljayB9O1xuXG4gICAgICAgIC8vIEhhaWwgTWFyeSBieSBvZmZlbnNlIFx1MjAxNCByZXNvbHZlcyBpbW1lZGlhdGVseSwgZGVmZW5zZSBwaWNrIGlnbm9yZWQuXG4gICAgICAgIGlmIChwZW5kaW5nUGljay5vZmZlbnNlUGxheSA9PT0gXCJITVwiKSB7XG4gICAgICAgICAgY29uc3QgaG0gPSByZXNvbHZlSGFpbE1hcnkoc3RhdGVXaXRoUGljaywgcm5nKTtcbiAgICAgICAgICByZXR1cm4geyBzdGF0ZTogaG0uc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4uaG0uZXZlbnRzXSB9O1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVHJpY2sgUGxheSBieSBlaXRoZXIgc2lkZS4gdjUuMSAocnVuLmpzOjE4ODYpOiBpZiBib3RoIHBpY2sgVFAsXG4gICAgICAgIC8vIFNhbWUgUGxheSBjb2luIGFsd2F5cyB0cmlnZ2VycyBcdTIwMTQgZmFsbHMgdGhyb3VnaCB0byBTYW1lIFBsYXkgYmVsb3cuXG4gICAgICAgIGlmIChcbiAgICAgICAgICBwZW5kaW5nUGljay5vZmZlbnNlUGxheSA9PT0gXCJUUFwiICYmXG4gICAgICAgICAgcGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgIT09IFwiVFBcIlxuICAgICAgICApIHtcbiAgICAgICAgICBjb25zdCB0cCA9IHJlc29sdmVPZmZlbnNpdmVUcmlja1BsYXkoc3RhdGVXaXRoUGljaywgcm5nKTtcbiAgICAgICAgICByZXR1cm4geyBzdGF0ZTogdHAuc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4udHAuZXZlbnRzXSB9O1xuICAgICAgICB9XG4gICAgICAgIGlmIChcbiAgICAgICAgICBwZW5kaW5nUGljay5kZWZlbnNlUGxheSA9PT0gXCJUUFwiICYmXG4gICAgICAgICAgcGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgIT09IFwiVFBcIlxuICAgICAgICApIHtcbiAgICAgICAgICBjb25zdCB0cCA9IHJlc29sdmVEZWZlbnNpdmVUcmlja1BsYXkoc3RhdGVXaXRoUGljaywgcm5nKTtcbiAgICAgICAgICByZXR1cm4geyBzdGF0ZTogdHAuc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4udHAuZXZlbnRzXSB9O1xuICAgICAgICB9XG4gICAgICAgIGlmIChwZW5kaW5nUGljay5vZmZlbnNlUGxheSA9PT0gXCJUUFwiICYmIHBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5ID09PSBcIlRQXCIpIHtcbiAgICAgICAgICAvLyBCb3RoIFRQIFx1MjE5MiBTYW1lIFBsYXkgdW5jb25kaXRpb25hbGx5LlxuICAgICAgICAgIGNvbnN0IHNwID0gcmVzb2x2ZVNhbWVQbGF5KHN0YXRlV2l0aFBpY2ssIHJuZyk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHNwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLnNwLmV2ZW50c10gfTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFJlZ3VsYXIgdnMgcmVndWxhci5cbiAgICAgICAgaWYgKFxuICAgICAgICAgIGlzUmVndWxhclBsYXkocGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkpICYmXG4gICAgICAgICAgaXNSZWd1bGFyUGxheShwZW5kaW5nUGljay5kZWZlbnNlUGxheSlcbiAgICAgICAgKSB7XG4gICAgICAgICAgLy8gU2FtZSBwbGF5PyA1MC81MCBjaGFuY2UgdG8gdHJpZ2dlciBTYW1lIFBsYXkgbWVjaGFuaXNtLlxuICAgICAgICAgIC8vIFNvdXJjZTogcnVuLmpzOjE4ODYgKGBpZiAocGwxID09PSBwbDIpYCkuXG4gICAgICAgICAgaWYgKHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ID09PSBwZW5kaW5nUGljay5kZWZlbnNlUGxheSkge1xuICAgICAgICAgICAgY29uc3QgdHJpZ2dlciA9IHJuZy5jb2luRmxpcCgpO1xuICAgICAgICAgICAgaWYgKHRyaWdnZXIgPT09IFwiaGVhZHNcIikge1xuICAgICAgICAgICAgICBjb25zdCBzcCA9IHJlc29sdmVTYW1lUGxheShzdGF0ZVdpdGhQaWNrLCBybmcpO1xuICAgICAgICAgICAgICByZXR1cm4geyBzdGF0ZTogc3Auc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4uc3AuZXZlbnRzXSB9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gVGFpbHM6IGZhbGwgdGhyb3VnaCB0byByZWd1bGFyIHJlc29sdXRpb24gKHF1YWxpdHkgNSBvdXRjb21lKS5cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCByZXNvbHZlZCA9IHJlc29sdmVSZWd1bGFyUGxheShcbiAgICAgICAgICAgIHN0YXRlV2l0aFBpY2ssXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG9mZmVuc2VQbGF5OiBwZW5kaW5nUGljay5vZmZlbnNlUGxheSxcbiAgICAgICAgICAgICAgZGVmZW5zZVBsYXk6IHBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHJuZyxcbiAgICAgICAgICApO1xuICAgICAgICAgIHJldHVybiB7IHN0YXRlOiByZXNvbHZlZC5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi5yZXNvbHZlZC5ldmVudHNdIH07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBEZWZlbnNpdmUgdHJpY2sgcGxheSwgRkcsIFBVTlQsIFRXT19QVCBwaWNrcyBcdTIwMTQgbm90IHJvdXRlZCBoZXJlIHlldC5cbiAgICAgICAgLy8gRkcvUFVOVC9UV09fUFQgYXJlIGRyaXZlbiBieSBGT1VSVEhfRE9XTl9DSE9JQ0UgLyBQQVRfQ0hPSUNFIGFjdGlvbnMsXG4gICAgICAgIC8vIG5vdCBieSBQSUNLX1BMQVkuIERlZmVuc2l2ZSBUUCBpcyBhIFRPRE8uXG4gICAgICAgIHJldHVybiB7IHN0YXRlOiBzdGF0ZVdpdGhQaWNrLCBldmVudHMgfTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHsgc3RhdGU6IHsgLi4uc3RhdGUsIHBlbmRpbmdQaWNrIH0sIGV2ZW50cyB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJDQUxMX1RJTUVPVVRcIjoge1xuICAgICAgY29uc3QgcCA9IHN0YXRlLnBsYXllcnNbYWN0aW9uLnBsYXllcl07XG4gICAgICBpZiAocC50aW1lb3V0cyA8PSAwKSByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgY29uc3QgcmVtYWluaW5nID0gcC50aW1lb3V0cyAtIDE7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0ZToge1xuICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgIHBsYXllcnM6IHtcbiAgICAgICAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICAgICAgICBbYWN0aW9uLnBsYXllcl06IHsgLi4ucCwgdGltZW91dHM6IHJlbWFpbmluZyB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGV2ZW50czogW3sgdHlwZTogXCJUSU1FT1VUX0NBTExFRFwiLCBwbGF5ZXI6IGFjdGlvbi5wbGF5ZXIsIHJlbWFpbmluZyB9XSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIkFDQ0VQVF9QRU5BTFRZXCI6XG4gICAgY2FzZSBcIkRFQ0xJTkVfUEVOQUxUWVwiOlxuICAgICAgLy8gUGVuYWx0aWVzIGFyZSBjYXB0dXJlZCBhcyBldmVudHMgYXQgcmVzb2x1dGlvbiB0aW1lLCBidXQgYWNjZXB0L2RlY2xpbmVcbiAgICAgIC8vIGZsb3cgcmVxdWlyZXMgc3RhdGUgbm90IHlldCBtb2RlbGVkIChwZW5kaW5nIHBlbmFsdHkpLiBUT0RPIHdoZW5cbiAgICAgIC8vIHBlbmFsdHkgbWVjaGFuaWNzIGFyZSBwb3J0ZWQgZnJvbSBydW4uanMuXG4gICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuXG4gICAgY2FzZSBcIlBBVF9DSE9JQ0VcIjoge1xuICAgICAgY29uc3Qgc2NvcmVyID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgICAgIC8vIDNPVCsgcmVxdWlyZXMgMi1wb2ludCBjb252ZXJzaW9uLiBTaWxlbnRseSBzdWJzdGl0dXRlIGV2ZW4gaWYgXCJraWNrXCJcbiAgICAgIC8vIHdhcyBzZW50IChtYXRjaGVzIHY1LjEncyBcIm11c3RcIiBiZWhhdmlvciBhdCBydW4uanM6MTY0MSkuXG4gICAgICBjb25zdCBlZmZlY3RpdmVDaG9pY2UgPVxuICAgICAgICBzdGF0ZS5vdmVydGltZSAmJiBzdGF0ZS5vdmVydGltZS5wZXJpb2QgPj0gM1xuICAgICAgICAgID8gXCJ0d29fcG9pbnRcIlxuICAgICAgICAgIDogYWN0aW9uLmNob2ljZTtcbiAgICAgIGlmIChlZmZlY3RpdmVDaG9pY2UgPT09IFwia2lja1wiKSB7XG4gICAgICAgIC8vIEFzc3VtZSBhdXRvbWF0aWMgaW4gdjUuMSBcdTIwMTQgbm8gbWVjaGFuaWMgcmVjb3JkZWQgZm9yIFBBVCBraWNrcy5cbiAgICAgICAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICAgIFtzY29yZXJdOiB7IC4uLnN0YXRlLnBsYXllcnNbc2NvcmVyXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbc2NvcmVyXS5zY29yZSArIDEgfSxcbiAgICAgICAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICAgICAgICBwaGFzZTogXCJLSUNLT0ZGXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBldmVudHM6IFt7IHR5cGU6IFwiUEFUX0dPT0RcIiwgcGxheWVyOiBzY29yZXIgfV0sXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICAvLyB0d29fcG9pbnQgXHUyMTkyIHRyYW5zaXRpb24gdG8gVFdPX1BUX0NPTlYgcGhhc2U7IGEgUElDS19QTEFZIHJlc29sdmVzIGl0LlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGU6IHtcbiAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICBwaGFzZTogXCJUV09fUFRfQ09OVlwiLFxuICAgICAgICAgIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBiYWxsT246IDk3LCBmaXJzdERvd25BdDogMTAwLCBkb3duOiAxIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGV2ZW50czogW10sXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJGT1VSVEhfRE9XTl9DSE9JQ0VcIjoge1xuICAgICAgaWYgKGFjdGlvbi5jaG9pY2UgPT09IFwiZ29cIikge1xuICAgICAgICAvLyBOb3RoaW5nIHRvIGRvIFx1MjAxNCB0aGUgbmV4dCBQSUNLX1BMQVkgd2lsbCByZXNvbHZlIG5vcm1hbGx5IGZyb20gNHRoIGRvd24uXG4gICAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gICAgICB9XG4gICAgICBpZiAoYWN0aW9uLmNob2ljZSA9PT0gXCJwdW50XCIpIHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gcmVzb2x2ZVB1bnQoc3RhdGUsIHJuZyk7XG4gICAgICAgIHJldHVybiB7IHN0YXRlOiByZXN1bHQuc3RhdGUsIGV2ZW50czogcmVzdWx0LmV2ZW50cyB9O1xuICAgICAgfVxuICAgICAgLy8gZmdcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHJlc29sdmVGaWVsZEdvYWwoc3RhdGUsIHJuZyk7XG4gICAgICByZXR1cm4geyBzdGF0ZTogcmVzdWx0LnN0YXRlLCBldmVudHM6IHJlc3VsdC5ldmVudHMgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiRk9SRkVJVFwiOiB7XG4gICAgICBjb25zdCB3aW5uZXIgPSBvcHAoYWN0aW9uLnBsYXllcik7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0ZTogeyAuLi5zdGF0ZSwgcGhhc2U6IFwiR0FNRV9PVkVSXCIgfSxcbiAgICAgICAgZXZlbnRzOiBbeyB0eXBlOiBcIkdBTUVfT1ZFUlwiLCB3aW5uZXIgfV0sXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJUSUNLX0NMT0NLXCI6IHtcbiAgICAgIGNvbnN0IHByZXYgPSBzdGF0ZS5jbG9jay5zZWNvbmRzUmVtYWluaW5nO1xuICAgICAgY29uc3QgbmV4dCA9IE1hdGgubWF4KDAsIHByZXYgLSBhY3Rpb24uc2Vjb25kcyk7XG4gICAgICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbeyB0eXBlOiBcIkNMT0NLX1RJQ0tFRFwiLCBzZWNvbmRzOiBhY3Rpb24uc2Vjb25kcyB9XTtcblxuICAgICAgLy8gVHdvLW1pbnV0ZSB3YXJuaW5nOiBjcm9zc2luZyAxMjAgc2Vjb25kcyBpbiBRMiBvciBRNCB0cmlnZ2VycyBhbiBldmVudC5cbiAgICAgIGlmIChcbiAgICAgICAgKHN0YXRlLmNsb2NrLnF1YXJ0ZXIgPT09IDIgfHwgc3RhdGUuY2xvY2sucXVhcnRlciA9PT0gNCkgJiZcbiAgICAgICAgcHJldiA+IDEyMCAmJlxuICAgICAgICBuZXh0IDw9IDEyMFxuICAgICAgKSB7XG4gICAgICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUV09fTUlOVVRFX1dBUk5JTkdcIiB9KTtcbiAgICAgIH1cblxuICAgICAgaWYgKG5leHQgPT09IDApIHtcbiAgICAgICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlFVQVJURVJfRU5ERURcIiwgcXVhcnRlcjogc3RhdGUuY2xvY2sucXVhcnRlciB9KTtcbiAgICAgICAgLy8gUTFcdTIxOTJRMiBhbmQgUTNcdTIxOTJRNDogcm9sbCBvdmVyIGNsb2NrLCBzYW1lIGhhbGYsIHNhbWUgcG9zc2Vzc2lvbiBjb250aW51ZXMuXG4gICAgICAgIGlmIChzdGF0ZS5jbG9jay5xdWFydGVyID09PSAxIHx8IHN0YXRlLmNsb2NrLnF1YXJ0ZXIgPT09IDMpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdGU6IHtcbiAgICAgICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgICAgIGNsb2NrOiB7XG4gICAgICAgICAgICAgICAgLi4uc3RhdGUuY2xvY2ssXG4gICAgICAgICAgICAgICAgcXVhcnRlcjogc3RhdGUuY2xvY2sucXVhcnRlciArIDEsXG4gICAgICAgICAgICAgICAgc2Vjb25kc1JlbWFpbmluZzogc3RhdGUuY2xvY2sucXVhcnRlckxlbmd0aE1pbnV0ZXMgKiA2MCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBldmVudHMsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICAvLyBFbmQgb2YgUTIgPSBoYWxmdGltZS4gUTQgZW5kID0gcmVndWxhdGlvbiBvdmVyLlxuICAgICAgICBpZiAoc3RhdGUuY2xvY2sucXVhcnRlciA9PT0gMikge1xuICAgICAgICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJIQUxGX0VOREVEXCIgfSk7XG4gICAgICAgICAgLy8gUmVjZWl2ZXIgb2Ygb3BlbmluZyBraWNrb2ZmIGtpY2tzIHRoZSBzZWNvbmQgaGFsZjsgZmxpcCBwb3NzZXNzaW9uLlxuICAgICAgICAgIGNvbnN0IHNlY29uZEhhbGZSZWNlaXZlciA9XG4gICAgICAgICAgICBzdGF0ZS5vcGVuaW5nUmVjZWl2ZXIgPT09IG51bGwgPyAxIDogb3BwKHN0YXRlLm9wZW5pbmdSZWNlaXZlcik7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgICAgICBwaGFzZTogXCJLSUNLT0ZGXCIsXG4gICAgICAgICAgICAgIGNsb2NrOiB7XG4gICAgICAgICAgICAgICAgLi4uc3RhdGUuY2xvY2ssXG4gICAgICAgICAgICAgICAgcXVhcnRlcjogMyxcbiAgICAgICAgICAgICAgICBzZWNvbmRzUmVtYWluaW5nOiBzdGF0ZS5jbG9jay5xdWFydGVyTGVuZ3RoTWludXRlcyAqIDYwLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogb3BwKHNlY29uZEhhbGZSZWNlaXZlcikgfSxcbiAgICAgICAgICAgICAgLy8gUmVmcmVzaCB0aW1lb3V0cyBmb3IgbmV3IGhhbGYuXG4gICAgICAgICAgICAgIHBsYXllcnM6IHtcbiAgICAgICAgICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICAgICAgICAgIDE6IHsgLi4uc3RhdGUucGxheWVyc1sxXSwgdGltZW91dHM6IDMgfSxcbiAgICAgICAgICAgICAgICAyOiB7IC4uLnN0YXRlLnBsYXllcnNbMl0sIHRpbWVvdXRzOiAzIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZXZlbnRzLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgLy8gUTQgZW5kZWQuXG4gICAgICAgIGNvbnN0IHAxID0gc3RhdGUucGxheWVyc1sxXS5zY29yZTtcbiAgICAgICAgY29uc3QgcDIgPSBzdGF0ZS5wbGF5ZXJzWzJdLnNjb3JlO1xuICAgICAgICBpZiAocDEgIT09IHAyKSB7XG4gICAgICAgICAgY29uc3Qgd2lubmVyID0gcDEgPiBwMiA/IDEgOiAyO1xuICAgICAgICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJHQU1FX09WRVJcIiwgd2lubmVyIH0pO1xuICAgICAgICAgIHJldHVybiB7IHN0YXRlOiB7IC4uLnN0YXRlLCBwaGFzZTogXCJHQU1FX09WRVJcIiB9LCBldmVudHMgfTtcbiAgICAgICAgfVxuICAgICAgICAvLyBUaWVkIFx1MjAxNCBoZWFkIHRvIG92ZXJ0aW1lLlxuICAgICAgICBjb25zdCBvdENsb2NrID0geyAuLi5zdGF0ZS5jbG9jaywgcXVhcnRlcjogNSwgc2Vjb25kc1JlbWFpbmluZzogMCB9O1xuICAgICAgICBjb25zdCBvdCA9IHN0YXJ0T3ZlcnRpbWUoeyAuLi5zdGF0ZSwgY2xvY2s6IG90Q2xvY2sgfSk7XG4gICAgICAgIGV2ZW50cy5wdXNoKC4uLm90LmV2ZW50cyk7XG4gICAgICAgIHJldHVybiB7IHN0YXRlOiBvdC5zdGF0ZSwgZXZlbnRzIH07XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7IC4uLnN0YXRlLCBjbG9jazogeyAuLi5zdGF0ZS5jbG9jaywgc2Vjb25kc1JlbWFpbmluZzogbmV4dCB9IH0sXG4gICAgICAgIGV2ZW50cyxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgZGVmYXVsdDoge1xuICAgICAgLy8gRXhoYXVzdGl2ZW5lc3MgY2hlY2sgXHUyMDE0IGFkZGluZyBhIG5ldyBBY3Rpb24gdmFyaWFudCB3aXRob3V0IGhhbmRsaW5nIGl0XG4gICAgICAvLyBoZXJlIHdpbGwgcHJvZHVjZSBhIGNvbXBpbGUgZXJyb3IuXG4gICAgICBjb25zdCBfZXhoYXVzdGl2ZTogbmV2ZXIgPSBhY3Rpb247XG4gICAgICB2b2lkIF9leGhhdXN0aXZlO1xuICAgICAgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBDb252ZW5pZW5jZSBmb3IgcmVwbGF5aW5nIGEgc2VxdWVuY2Ugb2YgYWN0aW9ucyBcdTIwMTQgdXNlZnVsIGZvciB0ZXN0cyBhbmRcbiAqIGZvciBzZXJ2ZXItc2lkZSBnYW1lIHJlcGxheSBmcm9tIGFjdGlvbiBsb2cuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWR1Y2VNYW55KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBhY3Rpb25zOiBBY3Rpb25bXSxcbiAgcm5nOiBSbmcsXG4pOiBSZWR1Y2VSZXN1bHQge1xuICBsZXQgY3VycmVudCA9IHN0YXRlO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcbiAgZm9yIChjb25zdCBhY3Rpb24gb2YgYWN0aW9ucykge1xuICAgIGNvbnN0IHJlc3VsdCA9IHJlZHVjZShjdXJyZW50LCBhY3Rpb24sIHJuZyk7XG4gICAgY3VycmVudCA9IHJlc3VsdC5zdGF0ZTtcbiAgICBldmVudHMucHVzaCguLi5yZXN1bHQuZXZlbnRzKTtcbiAgfVxuICByZXR1cm4geyBzdGF0ZTogY3VycmVudCwgZXZlbnRzIH07XG59XG4iLCAiLyoqXG4gKiBSTkcgYWJzdHJhY3Rpb24uXG4gKlxuICogVGhlIGVuZ2luZSBuZXZlciByZWFjaGVzIGZvciBgTWF0aC5yYW5kb20oKWAgZGlyZWN0bHkuIEFsbCByYW5kb21uZXNzIGlzXG4gKiBzb3VyY2VkIGZyb20gYW4gYFJuZ2AgaW5zdGFuY2UgcGFzc2VkIGludG8gYHJlZHVjZSgpYC4gVGhpcyBpcyB3aGF0IG1ha2VzXG4gKiB0aGUgZW5naW5lIGRldGVybWluaXN0aWMgYW5kIHRlc3RhYmxlLlxuICpcbiAqIEluIHByb2R1Y3Rpb24sIHRoZSBTdXBhYmFzZSBFZGdlIEZ1bmN0aW9uIGNyZWF0ZXMgYSBzZWVkZWQgUk5HIHBlciBnYW1lXG4gKiAoc2VlZCBzdG9yZWQgYWxvbmdzaWRlIGdhbWUgc3RhdGUpLCBzbyBhIGNvbXBsZXRlIGdhbWUgY2FuIGJlIHJlcGxheWVkXG4gKiBkZXRlcm1pbmlzdGljYWxseSBmcm9tIGl0cyBhY3Rpb24gbG9nIFx1MjAxNCB1c2VmdWwgZm9yIGJ1ZyByZXBvcnRzLCByZWNhcFxuICogZ2VuZXJhdGlvbiwgYW5kIFwid2F0Y2ggdGhlIGdhbWUgYmFja1wiIGZlYXR1cmVzLlxuICovXG5cbmV4cG9ydCBpbnRlcmZhY2UgUm5nIHtcbiAgLyoqIEluY2x1c2l2ZSBib3RoIGVuZHMuICovXG4gIGludEJldHdlZW4obWluSW5jbHVzaXZlOiBudW1iZXIsIG1heEluY2x1c2l2ZTogbnVtYmVyKTogbnVtYmVyO1xuICAvKiogUmV0dXJucyBcImhlYWRzXCIgb3IgXCJ0YWlsc1wiLiAqL1xuICBjb2luRmxpcCgpOiBcImhlYWRzXCIgfCBcInRhaWxzXCI7XG4gIC8qKiBSZXR1cm5zIDEtNi4gKi9cbiAgZDYoKTogMSB8IDIgfCAzIHwgNCB8IDUgfCA2O1xufVxuXG4vKipcbiAqIE11bGJlcnJ5MzIgXHUyMDE0IGEgc21hbGwsIGZhc3QsIHdlbGwtZGlzdHJpYnV0ZWQgc2VlZGVkIFBSTkcuIFN1ZmZpY2llbnQgZm9yXG4gKiBhIGNhcmQtZHJhd2luZyBmb290YmFsbCBnYW1lOyBub3QgZm9yIGNyeXB0b2dyYXBoeS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNlZWRlZFJuZyhzZWVkOiBudW1iZXIpOiBSbmcge1xuICBsZXQgc3RhdGUgPSBzZWVkID4+PiAwO1xuXG4gIGNvbnN0IG5leHQgPSAoKTogbnVtYmVyID0+IHtcbiAgICBzdGF0ZSA9IChzdGF0ZSArIDB4NmQyYjc5ZjUpID4+PiAwO1xuICAgIGxldCB0ID0gc3RhdGU7XG4gICAgdCA9IE1hdGguaW11bCh0IF4gKHQgPj4+IDE1KSwgdCB8IDEpO1xuICAgIHQgXj0gdCArIE1hdGguaW11bCh0IF4gKHQgPj4+IDcpLCB0IHwgNjEpO1xuICAgIHJldHVybiAoKHQgXiAodCA+Pj4gMTQpKSA+Pj4gMCkgLyA0Mjk0OTY3Mjk2O1xuICB9O1xuXG4gIHJldHVybiB7XG4gICAgaW50QmV0d2VlbihtaW4sIG1heCkge1xuICAgICAgcmV0dXJuIE1hdGguZmxvb3IobmV4dCgpICogKG1heCAtIG1pbiArIDEpKSArIG1pbjtcbiAgICB9LFxuICAgIGNvaW5GbGlwKCkge1xuICAgICAgcmV0dXJuIG5leHQoKSA8IDAuNSA/IFwiaGVhZHNcIiA6IFwidGFpbHNcIjtcbiAgICB9LFxuICAgIGQ2KCkge1xuICAgICAgcmV0dXJuIChNYXRoLmZsb29yKG5leHQoKSAqIDYpICsgMSkgYXMgMSB8IDIgfCAzIHwgNCB8IDUgfCA2O1xuICAgIH0sXG4gIH07XG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBU08sU0FBUyxVQUFVLGFBQWEsT0FBYTtBQUNsRCxTQUFPO0FBQUEsSUFDTCxJQUFJO0FBQUEsSUFDSixJQUFJO0FBQUEsSUFDSixJQUFJO0FBQUEsSUFDSixJQUFJO0FBQUEsSUFDSixJQUFJO0FBQUEsSUFDSixJQUFJLGFBQWEsSUFBSTtBQUFBLEVBQ3ZCO0FBQ0Y7QUFFTyxTQUFTLGFBQW9CO0FBQ2xDLFNBQU8sRUFBRSxXQUFXLEdBQUcsV0FBVyxHQUFHLFdBQVcsR0FBRyxPQUFPLEVBQUU7QUFDOUQ7QUFFTyxTQUFTLHVCQUF5RDtBQUN2RSxTQUFPLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQztBQUNwQjtBQUVPLFNBQVMsaUJBQTJCO0FBQ3pDLFNBQU8sQ0FBQyxHQUFHLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxDQUFDO0FBQ3RDO0FBUU8sU0FBUyxhQUFhLE1BQW1D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LEtBQUssS0FBSyxJQUFLLE1BQU0sR0FBSSxJQUFJLEVBQUU7QUFDeEMsYUFBUyxJQUFLLE1BQU0sUUFBUyxLQUFLO0FBQUEsRUFDcEM7QUFFQSxTQUFPO0FBQUEsSUFDTCxXQUFXLEtBQUssS0FBSztBQUNuQixhQUFPLEtBQUssTUFBTSxLQUFLLEtBQUssTUFBTSxNQUFNLEVBQUUsSUFBSTtBQUFBLElBQ2hEO0FBQUEsSUFDQSxXQUFXO0FBQ1QsYUFBTyxLQUFLLElBQUksTUFBTSxVQUFVO0FBQUEsSUFDbEM7QUFBQSxJQUNBLEtBQUs7QUFDSCxhQUFRLEtBQUssTUFBTSxLQUFLLElBQUksQ0FBQyxJQUFJO0FBQUEsSUFDbkM7QUFBQSxFQUNGO0FBQ0Y7IiwKICAibmFtZXMiOiBbImJsYW5rUGljayIsICJibGFua1BpY2siLCAiaGFsZlRvR29hbCIsICJibGFua1BpY2siLCAiYmxhbmtQaWNrIiwgImJsYW5rUGljayIsICJibGFua1BpY2siLCAibXVsdGlwbGllciIsICJ5YXJkc0RyYXciLCAieWFyZHMiLCAiYmxhbmtQaWNrIiwgInJlc3VsdCJdCn0K
