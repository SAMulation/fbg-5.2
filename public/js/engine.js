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
  reduce,
  reduceMany,
  resolveBigPlay,
  resolveDefensiveTrickPlay,
  resolveFieldGoal,
  resolveHailMary,
  resolveKickoff,
  resolveOffensiveTrickPlay,
  resolvePunt,
  resolveSamePlay,
  resolveTwoPointConversion,
  seededRng,
  startOvertime,
  startOvertimePossession
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9zdGF0ZS50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL21hdGNodXAudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy95YXJkYWdlLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvZGVjay50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3BsYXkudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9zaGFyZWQudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9iaWdQbGF5LnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvcHVudC50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL2tpY2tvZmYudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9oYWlsTWFyeS50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL3NhbWVQbGF5LnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvdHJpY2tQbGF5LnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvZmllbGRHb2FsLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvdHdvUG9pbnQudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9vdmVydGltZS50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3JlZHVjZXIudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ybmcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8qKlxuICogU3RhdGUgZmFjdG9yaWVzLlxuICpcbiAqIGBpbml0aWFsU3RhdGUoKWAgcHJvZHVjZXMgYSBmcmVzaCBHYW1lU3RhdGUgaW4gSU5JVCBwaGFzZS4gRXZlcnl0aGluZyBlbHNlXG4gKiBmbG93cyBmcm9tIHJlZHVjaW5nIGFjdGlvbnMgb3ZlciB0aGlzIHN0YXJ0aW5nIHBvaW50LlxuICovXG5cbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBIYW5kLCBQbGF5ZXJJZCwgU3RhdHMsIFRlYW1SZWYgfSBmcm9tIFwiLi90eXBlcy5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gZW1wdHlIYW5kKGlzT3ZlcnRpbWUgPSBmYWxzZSk6IEhhbmQge1xuICByZXR1cm4ge1xuICAgIFNSOiAzLFxuICAgIExSOiAzLFxuICAgIFNQOiAzLFxuICAgIExQOiAzLFxuICAgIFRQOiAxLFxuICAgIEhNOiBpc092ZXJ0aW1lID8gMiA6IDMsXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBlbXB0eVN0YXRzKCk6IFN0YXRzIHtcbiAgcmV0dXJuIHsgcGFzc1lhcmRzOiAwLCBydXNoWWFyZHM6IDAsIHR1cm5vdmVyczogMCwgc2Fja3M6IDAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZyZXNoRGVja011bHRpcGxpZXJzKCk6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdIHtcbiAgcmV0dXJuIFs0LCA0LCA0LCAzXTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZyZXNoRGVja1lhcmRzKCk6IG51bWJlcltdIHtcbiAgcmV0dXJuIFsxLCAxLCAxLCAxLCAxLCAxLCAxLCAxLCAxLCAxXTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBJbml0aWFsU3RhdGVBcmdzIHtcbiAgdGVhbTE6IFRlYW1SZWY7XG4gIHRlYW0yOiBUZWFtUmVmO1xuICBxdWFydGVyTGVuZ3RoTWludXRlczogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaW5pdGlhbFN0YXRlKGFyZ3M6IEluaXRpYWxTdGF0ZUFyZ3MpOiBHYW1lU3RhdGUge1xuICByZXR1cm4ge1xuICAgIHBoYXNlOiBcIklOSVRcIixcbiAgICBzY2hlbWFWZXJzaW9uOiAxLFxuICAgIGNsb2NrOiB7XG4gICAgICBxdWFydGVyOiAwLFxuICAgICAgc2Vjb25kc1JlbWFpbmluZzogYXJncy5xdWFydGVyTGVuZ3RoTWludXRlcyAqIDYwLFxuICAgICAgcXVhcnRlckxlbmd0aE1pbnV0ZXM6IGFyZ3MucXVhcnRlckxlbmd0aE1pbnV0ZXMsXG4gICAgfSxcbiAgICBmaWVsZDoge1xuICAgICAgYmFsbE9uOiAzNSxcbiAgICAgIGZpcnN0RG93bkF0OiA0NSxcbiAgICAgIGRvd246IDEsXG4gICAgICBvZmZlbnNlOiAxLFxuICAgIH0sXG4gICAgZGVjazoge1xuICAgICAgbXVsdGlwbGllcnM6IGZyZXNoRGVja011bHRpcGxpZXJzKCksXG4gICAgICB5YXJkczogZnJlc2hEZWNrWWFyZHMoKSxcbiAgICB9LFxuICAgIHBsYXllcnM6IHtcbiAgICAgIDE6IHtcbiAgICAgICAgdGVhbTogYXJncy50ZWFtMSxcbiAgICAgICAgc2NvcmU6IDAsXG4gICAgICAgIHRpbWVvdXRzOiAzLFxuICAgICAgICBoYW5kOiBlbXB0eUhhbmQoKSxcbiAgICAgICAgc3RhdHM6IGVtcHR5U3RhdHMoKSxcbiAgICAgIH0sXG4gICAgICAyOiB7XG4gICAgICAgIHRlYW06IGFyZ3MudGVhbTIsXG4gICAgICAgIHNjb3JlOiAwLFxuICAgICAgICB0aW1lb3V0czogMyxcbiAgICAgICAgaGFuZDogZW1wdHlIYW5kKCksXG4gICAgICAgIHN0YXRzOiBlbXB0eVN0YXRzKCksXG4gICAgICB9LFxuICAgIH0sXG4gICAgb3BlbmluZ1JlY2VpdmVyOiBudWxsLFxuICAgIG92ZXJ0aW1lOiBudWxsLFxuICAgIHBlbmRpbmdQaWNrOiB7IG9mZmVuc2VQbGF5OiBudWxsLCBkZWZlbnNlUGxheTogbnVsbCB9LFxuICAgIGxhc3RQbGF5RGVzY3JpcHRpb246IFwiU3RhcnQgb2YgZ2FtZVwiLFxuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gb3BwKHA6IFBsYXllcklkKTogUGxheWVySWQge1xuICByZXR1cm4gcCA9PT0gMSA/IDIgOiAxO1xufVxuIiwgIi8qKlxuICogVGhlIHBsYXkgbWF0Y2h1cCBtYXRyaXggXHUyMDE0IHRoZSBoZWFydCBvZiBGb290Qm9yZWQuXG4gKlxuICogQm90aCB0ZWFtcyBwaWNrIGEgcGxheS4gVGhlIG1hdHJpeCBzY29yZXMgaG93ICpjbG9zZWx5KiB0aGUgZGVmZW5zZVxuICogcHJlZGljdGVkIHRoZSBvZmZlbnNpdmUgY2FsbDpcbiAqICAgLSAxID0gZGVmZW5zZSB3YXkgb2ZmIFx1MjE5MiBncmVhdCBmb3Igb2ZmZW5zZVxuICogICAtIDUgPSBkZWZlbnNlIG1hdGNoZWQgXHUyMTkyIHRlcnJpYmxlIGZvciBvZmZlbnNlIChjb21iaW5lZCB3aXRoIGEgbG93XG4gKiAgICAgICAgIG11bHRpcGxpZXIgY2FyZCwgdGhpcyBiZWNvbWVzIGEgbG9zcyAvIHR1cm5vdmVyIHJpc2spXG4gKlxuICogUm93cyA9IG9mZmVuc2l2ZSBjYWxsLCBDb2xzID0gZGVmZW5zaXZlIGNhbGwuIE9yZGVyOiBbU1IsIExSLCBTUCwgTFBdLlxuICpcbiAqICAgICAgICAgICBERUY6IFNSICBMUiAgU1AgIExQXG4gKiAgIE9GRjogU1IgICAgIFsgNSwgIDMsICAzLCAgMiBdXG4gKiAgIE9GRjogTFIgICAgIFsgMiwgIDQsICAxLCAgMiBdXG4gKiAgIE9GRjogU1AgICAgIFsgMywgIDIsICA1LCAgMyBdXG4gKiAgIE9GRjogTFAgICAgIFsgMSwgIDIsICAyLCAgNCBdXG4gKlxuICogUG9ydGVkIHZlcmJhdGltIGZyb20gcHVibGljL2pzL2RlZmF1bHRzLmpzIE1BVENIVVAuIEluZGV4aW5nIGNvbmZpcm1lZFxuICogYWdhaW5zdCBwbGF5TWVjaGFuaXNtIC8gY2FsY1RpbWVzIGluIHJ1bi5qczoyMzY4LlxuICovXG5cbmltcG9ydCB0eXBlIHsgUmVndWxhclBsYXkgfSBmcm9tIFwiLi4vdHlwZXMuanNcIjtcblxuZXhwb3J0IGNvbnN0IE1BVENIVVA6IFJlYWRvbmx5QXJyYXk8UmVhZG9ubHlBcnJheTxNYXRjaHVwUXVhbGl0eT4+ID0gW1xuICBbNSwgMywgMywgMl0sXG4gIFsyLCA0LCAxLCAyXSxcbiAgWzMsIDIsIDUsIDNdLFxuICBbMSwgMiwgMiwgNF0sXG5dIGFzIGNvbnN0O1xuXG5leHBvcnQgdHlwZSBNYXRjaHVwUXVhbGl0eSA9IDEgfCAyIHwgMyB8IDQgfCA1O1xuXG5jb25zdCBQTEFZX0lOREVYOiBSZWNvcmQ8UmVndWxhclBsYXksIDAgfCAxIHwgMiB8IDM+ID0ge1xuICBTUjogMCxcbiAgTFI6IDEsXG4gIFNQOiAyLFxuICBMUDogMyxcbn07XG5cbi8qKlxuICogTXVsdGlwbGllciBjYXJkIHZhbHVlcy4gSW5kZXhpbmcgKGNvbmZpcm1lZCBpbiBydW4uanM6MjM3Nyk6XG4gKiAgIHJvdyAgICA9IG11bHRpcGxpZXIgY2FyZCAoMD1LaW5nLCAxPVF1ZWVuLCAyPUphY2ssIDM9MTApXG4gKiAgIGNvbHVtbiA9IG1hdGNodXAgcXVhbGl0eSAtIDEgKHNvIGNvbHVtbiAwID0gcXVhbGl0eSAxLCBjb2x1bW4gNCA9IHF1YWxpdHkgNSlcbiAqXG4gKiBRdWFsaXR5IDEgKG9mZmVuc2Ugb3V0Z3Vlc3NlZCBkZWZlbnNlKSArIEtpbmcgPSA0eC4gQmVzdCBwb3NzaWJsZSBwbGF5LlxuICogUXVhbGl0eSA1IChkZWZlbnNlIG1hdGNoZWQpICsgMTAgICAgICAgID0gLTF4LiBXb3JzdCByZWd1bGFyIHBsYXkuXG4gKlxuICogICAgICAgICAgICAgICAgICBxdWFsIDEgIHF1YWwgMiAgcXVhbCAzICBxdWFsIDQgIHF1YWwgNVxuICogICBLaW5nICAgICgwKSAgWyAgIDQsICAgICAgMywgICAgICAyLCAgICAgMS41LCAgICAgMSAgIF1cbiAqICAgUXVlZW4gICAoMSkgIFsgICAzLCAgICAgIDIsICAgICAgMSwgICAgICAxLCAgICAgMC41ICBdXG4gKiAgIEphY2sgICAgKDIpICBbICAgMiwgICAgICAxLCAgICAgMC41LCAgICAgMCwgICAgICAwICAgXVxuICogICAxMCAgICAgICgzKSAgWyAgIDAsICAgICAgMCwgICAgICAwLCAgICAgLTEsICAgICAtMSAgIF1cbiAqXG4gKiBQb3J0ZWQgdmVyYmF0aW0gZnJvbSBwdWJsaWMvanMvZGVmYXVsdHMuanMgTVVMVEkuXG4gKi9cbmV4cG9ydCBjb25zdCBNVUxUSTogUmVhZG9ubHlBcnJheTxSZWFkb25seUFycmF5PG51bWJlcj4+ID0gW1xuICBbNCwgMywgMiwgMS41LCAxXSxcbiAgWzMsIDIsIDEsIDEsIDAuNV0sXG4gIFsyLCAxLCAwLjUsIDAsIDBdLFxuICBbMCwgMCwgMCwgLTEsIC0xXSxcbl0gYXMgY29uc3Q7XG5cbmV4cG9ydCBmdW5jdGlvbiBtYXRjaHVwUXVhbGl0eShvZmY6IFJlZ3VsYXJQbGF5LCBkZWY6IFJlZ3VsYXJQbGF5KTogTWF0Y2h1cFF1YWxpdHkge1xuICBjb25zdCByb3cgPSBNQVRDSFVQW1BMQVlfSU5ERVhbb2ZmXV07XG4gIGlmICghcm93KSB0aHJvdyBuZXcgRXJyb3IoYHVucmVhY2hhYmxlOiBiYWQgb2ZmIHBsYXkgJHtvZmZ9YCk7XG4gIGNvbnN0IHEgPSByb3dbUExBWV9JTkRFWFtkZWZdXTtcbiAgaWYgKHEgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKGB1bnJlYWNoYWJsZTogYmFkIGRlZiBwbGF5ICR7ZGVmfWApO1xuICByZXR1cm4gcTtcbn1cbiIsICIvKipcbiAqIFB1cmUgeWFyZGFnZSBjYWxjdWxhdGlvbiBmb3IgYSByZWd1bGFyIHBsYXkgKFNSL0xSL1NQL0xQKS5cbiAqXG4gKiBGb3JtdWxhIChydW4uanM6MjMzNyk6XG4gKiAgIHlhcmRzID0gcm91bmQobXVsdGlwbGllciAqIHlhcmRzQ2FyZCkgKyBib251c1xuICpcbiAqIFdoZXJlOlxuICogICAtIG11bHRpcGxpZXIgPSBNVUxUSVttdWx0aXBsaWVyQ2FyZF1bcXVhbGl0eSAtIDFdXG4gKiAgIC0gcXVhbGl0eSAgICA9IE1BVENIVVBbb2ZmZW5zZV1bZGVmZW5zZV0gICAvLyAxLTVcbiAqICAgLSBib251cyAgICAgID0gc3BlY2lhbC1wbGF5IGJvbnVzIChlLmcuIFRyaWNrIFBsYXkgKzUgb24gTFIvTFAgb3V0Y29tZXMpXG4gKlxuICogU3BlY2lhbCBwbGF5cyAoVFAsIEhNLCBGRywgUFVOVCwgVFdPX1BUKSB1c2UgZGlmZmVyZW50IGZvcm11bGFzIFx1MjAxNCB0aGV5XG4gKiBsaXZlIGluIHJ1bGVzL3NwZWNpYWwudHMgKFRPRE8pIGFuZCBwcm9kdWNlIGV2ZW50cyBkaXJlY3RseS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IFJlZ3VsYXJQbGF5IH0gZnJvbSBcIi4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBNVUxUSSwgbWF0Y2h1cFF1YWxpdHkgfSBmcm9tIFwiLi9tYXRjaHVwLmpzXCI7XG5cbmV4cG9ydCB0eXBlIE11bHRpcGxpZXJDYXJkSW5kZXggPSAwIHwgMSB8IDIgfCAzO1xuZXhwb3J0IGNvbnN0IE1VTFRJUExJRVJfQ0FSRF9OQU1FUyA9IFtcIktpbmdcIiwgXCJRdWVlblwiLCBcIkphY2tcIiwgXCIxMFwiXSBhcyBjb25zdDtcbmV4cG9ydCB0eXBlIE11bHRpcGxpZXJDYXJkTmFtZSA9ICh0eXBlb2YgTVVMVElQTElFUl9DQVJEX05BTUVTKVtudW1iZXJdO1xuXG5leHBvcnQgaW50ZXJmYWNlIFlhcmRhZ2VJbnB1dHMge1xuICBvZmZlbnNlOiBSZWd1bGFyUGxheTtcbiAgZGVmZW5zZTogUmVndWxhclBsYXk7XG4gIC8qKiBNdWx0aXBsaWVyIGNhcmQgaW5kZXg6IDA9S2luZywgMT1RdWVlbiwgMj1KYWNrLCAzPTEwLiAqL1xuICBtdWx0aXBsaWVyQ2FyZDogTXVsdGlwbGllckNhcmRJbmRleDtcbiAgLyoqIFlhcmRzIGNhcmQgZHJhd24sIDEtMTAuICovXG4gIHlhcmRzQ2FyZDogbnVtYmVyO1xuICAvKiogQm9udXMgeWFyZHMgZnJvbSBzcGVjaWFsLXBsYXkgb3ZlcmxheXMgKGUuZy4gVHJpY2sgUGxheSArNSkuICovXG4gIGJvbnVzPzogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFlhcmRhZ2VPdXRjb21lIHtcbiAgbWF0Y2h1cFF1YWxpdHk6IG51bWJlcjtcbiAgbXVsdGlwbGllcjogbnVtYmVyO1xuICBtdWx0aXBsaWVyQ2FyZE5hbWU6IE11bHRpcGxpZXJDYXJkTmFtZTtcbiAgeWFyZHNHYWluZWQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNvbXB1dGVZYXJkYWdlKGlucHV0czogWWFyZGFnZUlucHV0cyk6IFlhcmRhZ2VPdXRjb21lIHtcbiAgY29uc3QgcXVhbGl0eSA9IG1hdGNodXBRdWFsaXR5KGlucHV0cy5vZmZlbnNlLCBpbnB1dHMuZGVmZW5zZSk7XG4gIGNvbnN0IG11bHRpUm93ID0gTVVMVElbaW5wdXRzLm11bHRpcGxpZXJDYXJkXTtcbiAgaWYgKCFtdWx0aVJvdykgdGhyb3cgbmV3IEVycm9yKGB1bnJlYWNoYWJsZTogYmFkIG11bHRpIGNhcmQgJHtpbnB1dHMubXVsdGlwbGllckNhcmR9YCk7XG4gIGNvbnN0IG11bHRpcGxpZXIgPSBtdWx0aVJvd1txdWFsaXR5IC0gMV07XG4gIGlmIChtdWx0aXBsaWVyID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihgdW5yZWFjaGFibGU6IGJhZCBxdWFsaXR5ICR7cXVhbGl0eX1gKTtcblxuICBjb25zdCBib251cyA9IGlucHV0cy5ib251cyA/PyAwO1xuICBjb25zdCB5YXJkc0dhaW5lZCA9IE1hdGgucm91bmQobXVsdGlwbGllciAqIGlucHV0cy55YXJkc0NhcmQpICsgYm9udXM7XG5cbiAgcmV0dXJuIHtcbiAgICBtYXRjaHVwUXVhbGl0eTogcXVhbGl0eSxcbiAgICBtdWx0aXBsaWVyLFxuICAgIG11bHRpcGxpZXJDYXJkTmFtZTogTVVMVElQTElFUl9DQVJEX05BTUVTW2lucHV0cy5tdWx0aXBsaWVyQ2FyZF0sXG4gICAgeWFyZHNHYWluZWQsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBDYXJkLWRlY2sgZHJhd3MgXHUyMDE0IHB1cmUgdmVyc2lvbnMgb2YgdjUuMSdzIGBHYW1lLmRlY011bHRzYCBhbmQgYEdhbWUuZGVjWWFyZHNgLlxuICpcbiAqIFRoZSBkZWNrIGlzIHJlcHJlc2VudGVkIGFzIGFuIGFycmF5IG9mIHJlbWFpbmluZyBjb3VudHMgcGVyIGNhcmQgc2xvdC5cbiAqIFRvIGRyYXcsIHdlIHBpY2sgYSB1bmlmb3JtIHJhbmRvbSBzbG90OyBpZiB0aGF0IHNsb3QgaXMgZW1wdHksIHdlIHJldHJ5LlxuICogVGhpcyBpcyBtYXRoZW1hdGljYWxseSBlcXVpdmFsZW50IHRvIHNodWZmbGluZyB0aGUgcmVtYWluaW5nIGNhcmRzIGFuZFxuICogZHJhd2luZyBvbmUgXHUyMDE0IGFuZCBtYXRjaGVzIHY1LjEncyBiZWhhdmlvciB2ZXJiYXRpbS5cbiAqXG4gKiBXaGVuIHRoZSBkZWNrIGlzIGV4aGF1c3RlZCwgdGhlIGNvbnN1bWVyICh0aGUgcmVkdWNlcikgcmVmaWxscyBpdCBhbmRcbiAqIGVtaXRzIGEgREVDS19TSFVGRkxFRCBldmVudC5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgRGVja1N0YXRlIH0gZnJvbSBcIi4uL3R5cGVzLmpzXCI7XG5pbXBvcnQge1xuICBmcmVzaERlY2tNdWx0aXBsaWVycyxcbiAgZnJlc2hEZWNrWWFyZHMsXG59IGZyb20gXCIuLi9zdGF0ZS5qc1wiO1xuaW1wb3J0IHtcbiAgTVVMVElQTElFUl9DQVJEX05BTUVTLFxuICB0eXBlIE11bHRpcGxpZXJDYXJkSW5kZXgsXG4gIHR5cGUgTXVsdGlwbGllckNhcmROYW1lLFxufSBmcm9tIFwiLi95YXJkYWdlLmpzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgTXVsdGlwbGllckRyYXcge1xuICBjYXJkOiBNdWx0aXBsaWVyQ2FyZE5hbWU7XG4gIGluZGV4OiBNdWx0aXBsaWVyQ2FyZEluZGV4O1xuICBkZWNrOiBEZWNrU3RhdGU7XG4gIHJlc2h1ZmZsZWQ6IGJvb2xlYW47XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkcmF3TXVsdGlwbGllcihkZWNrOiBEZWNrU3RhdGUsIHJuZzogUm5nKTogTXVsdGlwbGllckRyYXcge1xuICBjb25zdCBtdWx0cyA9IFsuLi5kZWNrLm11bHRpcGxpZXJzXSBhcyBbbnVtYmVyLCBudW1iZXIsIG51bWJlciwgbnVtYmVyXTtcblxuICBsZXQgaW5kZXg6IE11bHRpcGxpZXJDYXJkSW5kZXg7XG4gIC8vIFJlamVjdGlvbi1zYW1wbGUgdG8gZHJhdyB1bmlmb3JtbHkgYWNyb3NzIHJlbWFpbmluZyBjYXJkcy5cbiAgLy8gTG9vcCBpcyBib3VuZGVkIFx1MjAxNCB0b3RhbCBjYXJkcyBpbiBmcmVzaCBkZWNrIGlzIDE1LlxuICBmb3IgKDs7KSB7XG4gICAgY29uc3QgaSA9IHJuZy5pbnRCZXR3ZWVuKDAsIDMpIGFzIE11bHRpcGxpZXJDYXJkSW5kZXg7XG4gICAgaWYgKG11bHRzW2ldID4gMCkge1xuICAgICAgaW5kZXggPSBpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgbXVsdHNbaW5kZXhdLS07XG5cbiAgbGV0IHJlc2h1ZmZsZWQgPSBmYWxzZTtcbiAgbGV0IG5leHREZWNrOiBEZWNrU3RhdGUgPSB7IC4uLmRlY2ssIG11bHRpcGxpZXJzOiBtdWx0cyB9O1xuICBpZiAobXVsdHMuZXZlcnkoKGMpID0+IGMgPT09IDApKSB7XG4gICAgcmVzaHVmZmxlZCA9IHRydWU7XG4gICAgbmV4dERlY2sgPSB7IC4uLm5leHREZWNrLCBtdWx0aXBsaWVyczogZnJlc2hEZWNrTXVsdGlwbGllcnMoKSB9O1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBjYXJkOiBNVUxUSVBMSUVSX0NBUkRfTkFNRVNbaW5kZXhdLFxuICAgIGluZGV4LFxuICAgIGRlY2s6IG5leHREZWNrLFxuICAgIHJlc2h1ZmZsZWQsXG4gIH07XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgWWFyZHNEcmF3IHtcbiAgLyoqIFlhcmRzIGNhcmQgdmFsdWUsIDEtMTAuICovXG4gIGNhcmQ6IG51bWJlcjtcbiAgZGVjazogRGVja1N0YXRlO1xuICByZXNodWZmbGVkOiBib29sZWFuO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZHJhd1lhcmRzKGRlY2s6IERlY2tTdGF0ZSwgcm5nOiBSbmcpOiBZYXJkc0RyYXcge1xuICBjb25zdCB5YXJkcyA9IFsuLi5kZWNrLnlhcmRzXTtcblxuICBsZXQgaW5kZXg6IG51bWJlcjtcbiAgZm9yICg7Oykge1xuICAgIGNvbnN0IGkgPSBybmcuaW50QmV0d2VlbigwLCB5YXJkcy5sZW5ndGggLSAxKTtcbiAgICBjb25zdCBzbG90ID0geWFyZHNbaV07XG4gICAgaWYgKHNsb3QgIT09IHVuZGVmaW5lZCAmJiBzbG90ID4gMCkge1xuICAgICAgaW5kZXggPSBpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgeWFyZHNbaW5kZXhdID0gKHlhcmRzW2luZGV4XSA/PyAwKSAtIDE7XG5cbiAgbGV0IHJlc2h1ZmZsZWQgPSBmYWxzZTtcbiAgbGV0IG5leHREZWNrOiBEZWNrU3RhdGUgPSB7IC4uLmRlY2ssIHlhcmRzIH07XG4gIGlmICh5YXJkcy5ldmVyeSgoYykgPT4gYyA9PT0gMCkpIHtcbiAgICByZXNodWZmbGVkID0gdHJ1ZTtcbiAgICBuZXh0RGVjayA9IHsgLi4ubmV4dERlY2ssIHlhcmRzOiBmcmVzaERlY2tZYXJkcygpIH07XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGNhcmQ6IGluZGV4ICsgMSxcbiAgICBkZWNrOiBuZXh0RGVjayxcbiAgICByZXNodWZmbGVkLFxuICB9O1xufVxuIiwgIi8qKlxuICogUmVndWxhci1wbGF5IHJlc29sdXRpb24uIFNwZWNpYWwgcGxheXMgKFRQLCBITSwgRkcsIFBVTlQsIFRXT19QVCkgYnJhbmNoXG4gKiBlbHNld2hlcmUgXHUyMDE0IHNlZSBydWxlcy9zcGVjaWFsLnRzIChUT0RPKS5cbiAqXG4gKiBHaXZlbiB0d28gcGlja3MgKG9mZmVuc2UgKyBkZWZlbnNlKSBhbmQgdGhlIGN1cnJlbnQgc3RhdGUsIHByb2R1Y2UgYSBuZXdcbiAqIHN0YXRlIGFuZCB0aGUgZXZlbnQgc3RyZWFtIGZvciB0aGUgcGxheS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgUGxheUNhbGwsIFJlZ3VsYXJQbGF5IH0gZnJvbSBcIi4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBkcmF3TXVsdGlwbGllciwgZHJhd1lhcmRzIH0gZnJvbSBcIi4vZGVjay5qc1wiO1xuaW1wb3J0IHsgY29tcHV0ZVlhcmRhZ2UgfSBmcm9tIFwiLi95YXJkYWdlLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vc3RhdGUuanNcIjtcblxuY29uc3QgUkVHVUxBUjogUmVhZG9ubHlTZXQ8UGxheUNhbGw+ID0gbmV3IFNldChbXCJTUlwiLCBcIkxSXCIsIFwiU1BcIiwgXCJMUFwiXSk7XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1JlZ3VsYXJQbGF5KHA6IFBsYXlDYWxsKTogcCBpcyBSZWd1bGFyUGxheSB7XG4gIHJldHVybiBSRUdVTEFSLmhhcyhwKTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBSZXNvbHZlSW5wdXQge1xuICBvZmZlbnNlUGxheTogUGxheUNhbGw7XG4gIGRlZmVuc2VQbGF5OiBQbGF5Q2FsbDtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBQbGF5UmVzb2x1dGlvbiB7XG4gIHN0YXRlOiBHYW1lU3RhdGU7XG4gIGV2ZW50czogRXZlbnRbXTtcbn1cblxuLyoqXG4gKiBSZXNvbHZlIGEgcmVndWxhciB2cyByZWd1bGFyIHBsYXkuIENhbGxlciAodGhlIHJlZHVjZXIpIHJvdXRlcyB0byBzcGVjaWFsXG4gKiBwbGF5IGhhbmRsZXJzIGlmIGVpdGhlciBwaWNrIGlzIG5vbi1yZWd1bGFyLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVJlZ3VsYXJQbGF5KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBpbnB1dDogUmVzb2x2ZUlucHV0LFxuICBybmc6IFJuZyxcbik6IFBsYXlSZXNvbHV0aW9uIHtcbiAgaWYgKCFpc1JlZ3VsYXJQbGF5KGlucHV0Lm9mZmVuc2VQbGF5KSB8fCAhaXNSZWd1bGFyUGxheShpbnB1dC5kZWZlbnNlUGxheSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJyZXNvbHZlUmVndWxhclBsYXkgY2FsbGVkIHdpdGggYSBub24tcmVndWxhciBwbGF5XCIpO1xuICB9XG5cbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG5cbiAgLy8gRHJhdyBjYXJkcy5cbiAgY29uc3QgbXVsdERyYXcgPSBkcmF3TXVsdGlwbGllcihzdGF0ZS5kZWNrLCBybmcpO1xuICBpZiAobXVsdERyYXcucmVzaHVmZmxlZCkge1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwibXVsdGlwbGllclwiIH0pO1xuICB9XG4gIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhtdWx0RHJhdy5kZWNrLCBybmcpO1xuICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIHtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG4gIH1cblxuICAvLyBDb21wdXRlIHlhcmRhZ2UuXG4gIGNvbnN0IG91dGNvbWUgPSBjb21wdXRlWWFyZGFnZSh7XG4gICAgb2ZmZW5zZTogaW5wdXQub2ZmZW5zZVBsYXksXG4gICAgZGVmZW5zZTogaW5wdXQuZGVmZW5zZVBsYXksXG4gICAgbXVsdGlwbGllckNhcmQ6IG11bHREcmF3LmluZGV4LFxuICAgIHlhcmRzQ2FyZDogeWFyZHNEcmF3LmNhcmQsXG4gIH0pO1xuXG4gIC8vIERlY3JlbWVudCBvZmZlbnNlJ3MgaGFuZCBmb3IgdGhlIHBsYXkgdGhleSB1c2VkLiBSZWZpbGwgYXQgemVybyBcdTIwMTQgdGhlXG4gIC8vIGV4YWN0IDEyLWNhcmQgcmVzaHVmZmxlIGJlaGF2aW9yIGxpdmVzIGluIGBkZWNyZW1lbnRIYW5kYC5cbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgLi4uc3RhdGUucGxheWVycyxcbiAgICBbb2ZmZW5zZV06IGRlY3JlbWVudEhhbmQoc3RhdGUucGxheWVyc1tvZmZlbnNlXSwgaW5wdXQub2ZmZW5zZVBsYXkpLFxuICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG5cbiAgLy8gQXBwbHkgeWFyZGFnZSB0byBiYWxsIHBvc2l0aW9uLiBDbGFtcCBhdCAxMDAgKFREKSBhbmQgMCAoc2FmZXR5KS5cbiAgY29uc3QgcHJvamVjdGVkID0gc3RhdGUuZmllbGQuYmFsbE9uICsgb3V0Y29tZS55YXJkc0dhaW5lZDtcbiAgbGV0IG5ld0JhbGxPbiA9IHByb2plY3RlZDtcbiAgbGV0IHNjb3JlZDogXCJ0ZFwiIHwgXCJzYWZldHlcIiB8IG51bGwgPSBudWxsO1xuICBpZiAocHJvamVjdGVkID49IDEwMCkge1xuICAgIG5ld0JhbGxPbiA9IDEwMDtcbiAgICBzY29yZWQgPSBcInRkXCI7XG4gIH0gZWxzZSBpZiAocHJvamVjdGVkIDw9IDApIHtcbiAgICBuZXdCYWxsT24gPSAwO1xuICAgIHNjb3JlZCA9IFwic2FmZXR5XCI7XG4gIH1cblxuICBldmVudHMucHVzaCh7XG4gICAgdHlwZTogXCJQTEFZX1JFU09MVkVEXCIsXG4gICAgb2ZmZW5zZVBsYXk6IGlucHV0Lm9mZmVuc2VQbGF5LFxuICAgIGRlZmVuc2VQbGF5OiBpbnB1dC5kZWZlbnNlUGxheSxcbiAgICBtYXRjaHVwUXVhbGl0eTogb3V0Y29tZS5tYXRjaHVwUXVhbGl0eSxcbiAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IG91dGNvbWUubXVsdGlwbGllckNhcmROYW1lLCB2YWx1ZTogb3V0Y29tZS5tdWx0aXBsaWVyIH0sXG4gICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgICB5YXJkc0dhaW5lZDogb3V0Y29tZS55YXJkc0dhaW5lZCxcbiAgICBuZXdCYWxsT24sXG4gIH0pO1xuXG4gIC8vIFNjb3JlIGhhbmRsaW5nLlxuICBpZiAoc2NvcmVkID09PSBcInRkXCIpIHtcbiAgICByZXR1cm4gdG91Y2hkb3duU3RhdGUoXG4gICAgICB7IC4uLnN0YXRlLCBkZWNrOiB5YXJkc0RyYXcuZGVjaywgcGxheWVyczogbmV3UGxheWVycywgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpIH0sXG4gICAgICBvZmZlbnNlLFxuICAgICAgZXZlbnRzLFxuICAgICk7XG4gIH1cbiAgaWYgKHNjb3JlZCA9PT0gXCJzYWZldHlcIikge1xuICAgIHJldHVybiBzYWZldHlTdGF0ZShcbiAgICAgIHsgLi4uc3RhdGUsIGRlY2s6IHlhcmRzRHJhdy5kZWNrLCBwbGF5ZXJzOiBuZXdQbGF5ZXJzLCBwZW5kaW5nUGljazogYmxhbmtQaWNrKCkgfSxcbiAgICAgIG9mZmVuc2UsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuXG4gIC8vIERvd24vZGlzdGFuY2UgaGFuZGxpbmcuXG4gIGNvbnN0IHJlYWNoZWRGaXJzdERvd24gPSBuZXdCYWxsT24gPj0gc3RhdGUuZmllbGQuZmlyc3REb3duQXQ7XG4gIGxldCBuZXh0RG93biA9IHN0YXRlLmZpZWxkLmRvd247XG4gIGxldCBuZXh0Rmlyc3REb3duQXQgPSBzdGF0ZS5maWVsZC5maXJzdERvd25BdDtcbiAgbGV0IHBvc3Nlc3Npb25GbGlwcGVkID0gZmFsc2U7XG5cbiAgaWYgKHJlYWNoZWRGaXJzdERvd24pIHtcbiAgICBuZXh0RG93biA9IDE7XG4gICAgbmV4dEZpcnN0RG93bkF0ID0gTWF0aC5taW4oMTAwLCBuZXdCYWxsT24gKyAxMCk7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkZJUlNUX0RPV05cIiB9KTtcbiAgfSBlbHNlIGlmIChzdGF0ZS5maWVsZC5kb3duID09PSA0KSB7XG4gICAgLy8gVHVybm92ZXIgb24gZG93bnMgXHUyMDE0IHBvc3Nlc3Npb24gZmxpcHMsIGJhbGwgc3RheXMuXG4gICAgbmV4dERvd24gPSAxO1xuICAgIHBvc3Nlc3Npb25GbGlwcGVkID0gdHJ1ZTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJfT05fRE9XTlNcIiB9KTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcImRvd25zXCIgfSk7XG4gIH0gZWxzZSB7XG4gICAgbmV4dERvd24gPSAoc3RhdGUuZmllbGQuZG93biArIDEpIGFzIDEgfCAyIHwgMyB8IDQ7XG4gIH1cblxuICBjb25zdCBuZXh0T2ZmZW5zZSA9IHBvc3Nlc3Npb25GbGlwcGVkID8gb3BwKG9mZmVuc2UpIDogb2ZmZW5zZTtcbiAgY29uc3QgbmV4dEJhbGxPbiA9IHBvc3Nlc3Npb25GbGlwcGVkID8gMTAwIC0gbmV3QmFsbE9uIDogbmV3QmFsbE9uO1xuICBjb25zdCBuZXh0Rmlyc3REb3duID0gcG9zc2Vzc2lvbkZsaXBwZWRcbiAgICA/IE1hdGgubWluKDEwMCwgbmV4dEJhbGxPbiArIDEwKVxuICAgIDogbmV4dEZpcnN0RG93bkF0O1xuXG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgZGVjazogeWFyZHNEcmF3LmRlY2ssXG4gICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgYmFsbE9uOiBuZXh0QmFsbE9uLFxuICAgICAgICBmaXJzdERvd25BdDogbmV4dEZpcnN0RG93bixcbiAgICAgICAgZG93bjogbmV4dERvd24sXG4gICAgICAgIG9mZmVuc2U6IG5leHRPZmZlbnNlLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gYmxhbmtQaWNrKCk6IEdhbWVTdGF0ZVtcInBlbmRpbmdQaWNrXCJdIHtcbiAgcmV0dXJuIHsgb2ZmZW5zZVBsYXk6IG51bGwsIGRlZmVuc2VQbGF5OiBudWxsIH07XG59XG5cbi8qKlxuICogVG91Y2hkb3duIGJvb2trZWVwaW5nIFx1MjAxNCA2IHBvaW50cywgdHJhbnNpdGlvbiB0byBQQVRfQ0hPSUNFIHBoYXNlLlxuICogKFBBVC8ycHQgcmVzb2x1dGlvbiBhbmQgZW5zdWluZyBraWNrb2ZmIGhhcHBlbiBpbiBzdWJzZXF1ZW50IGFjdGlvbnMuKVxuICovXG5mdW5jdGlvbiB0b3VjaGRvd25TdGF0ZShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgc2NvcmVyOiBHYW1lU3RhdGVbXCJmaWVsZFwiXVtcIm9mZmVuc2VcIl0sXG4gIGV2ZW50czogRXZlbnRbXSxcbik6IFBsYXlSZXNvbHV0aW9uIHtcbiAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtzY29yZXJdOiB7IC4uLnN0YXRlLnBsYXllcnNbc2NvcmVyXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbc2NvcmVyXS5zY29yZSArIDYgfSxcbiAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiVE9VQ0hET1dOXCIsIHNjb3JpbmdQbGF5ZXI6IHNjb3JlciB9KTtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZTogeyAuLi5zdGF0ZSwgcGxheWVyczogbmV3UGxheWVycywgcGhhc2U6IFwiUEFUX0NIT0lDRVwiIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG4vKipcbiAqIFNhZmV0eSBcdTIwMTQgZGVmZW5zZSBzY29yZXMgMiwgb2ZmZW5zZSBraWNrcyBmcmVlIGtpY2suXG4gKiBGb3IgdGhlIHNrZXRjaCB3ZSBzY29yZSBhbmQgZW1pdDsgdGhlIGtpY2tvZmYgdHJhbnNpdGlvbiBpcyBUT0RPLlxuICovXG5mdW5jdGlvbiBzYWZldHlTdGF0ZShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgY29uY2VkZXI6IEdhbWVTdGF0ZVtcImZpZWxkXCJdW1wib2ZmZW5zZVwiXSxcbiAgZXZlbnRzOiBFdmVudFtdLFxuKTogUGxheVJlc29sdXRpb24ge1xuICBjb25zdCBzY29yZXIgPSBvcHAoY29uY2VkZXIpO1xuICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgW3Njb3Jlcl06IHsgLi4uc3RhdGUucGxheWVyc1tzY29yZXJdLCBzY29yZTogc3RhdGUucGxheWVyc1tzY29yZXJdLnNjb3JlICsgMiB9LFxuICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJTQUZFVFlcIiwgc2NvcmluZ1BsYXllcjogc2NvcmVyIH0pO1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7IC4uLnN0YXRlLCBwbGF5ZXJzOiBuZXdQbGF5ZXJzLCBwaGFzZTogXCJLSUNLT0ZGXCIgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbi8qKlxuICogRGVjcmVtZW50IHRoZSBjaG9zZW4gcGxheSBpbiBhIHBsYXllcidzIGhhbmQuIElmIHRoZSByZWd1bGFyLXBsYXkgY2FyZHNcbiAqIChTUi9MUi9TUC9MUCkgYXJlIGFsbCBleGhhdXN0ZWQsIHJlZmlsbCB0aGVtIFx1MjAxNCBIYWlsIE1hcnkgY291bnQgaXNcbiAqIHByZXNlcnZlZCBhY3Jvc3MgcmVmaWxscyAobWF0Y2hlcyB2NS4xIFBsYXllci5maWxsUGxheXMoJ3AnKSkuXG4gKi9cbmZ1bmN0aW9uIGRlY3JlbWVudEhhbmQoXG4gIHBsYXllcjogR2FtZVN0YXRlW1wicGxheWVyc1wiXVsxXSxcbiAgcGxheTogUGxheUNhbGwsXG4pOiBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdWzFdIHtcbiAgY29uc3QgaGFuZCA9IHsgLi4ucGxheWVyLmhhbmQgfTtcblxuICBpZiAocGxheSA9PT0gXCJITVwiKSB7XG4gICAgaGFuZC5ITSA9IE1hdGgubWF4KDAsIGhhbmQuSE0gLSAxKTtcbiAgICByZXR1cm4geyAuLi5wbGF5ZXIsIGhhbmQgfTtcbiAgfVxuXG4gIGlmIChwbGF5ID09PSBcIkZHXCIgfHwgcGxheSA9PT0gXCJQVU5UXCIgfHwgcGxheSA9PT0gXCJUV09fUFRcIikge1xuICAgIC8vIE5vIGNhcmQgY29uc3VtZWQgXHUyMDE0IHRoZXNlIGFyZSBzaXR1YXRpb25hbCBkZWNpc2lvbnMsIG5vdCBkcmF3cy5cbiAgICByZXR1cm4gcGxheWVyO1xuICB9XG5cbiAgaGFuZFtwbGF5XSA9IE1hdGgubWF4KDAsIGhhbmRbcGxheV0gLSAxKTtcblxuICBjb25zdCByZWd1bGFyRXhoYXVzdGVkID1cbiAgICBoYW5kLlNSID09PSAwICYmIGhhbmQuTFIgPT09IDAgJiYgaGFuZC5TUCA9PT0gMCAmJiBoYW5kLkxQID09PSAwICYmIGhhbmQuVFAgPT09IDA7XG5cbiAgaWYgKHJlZ3VsYXJFeGhhdXN0ZWQpIHtcbiAgICByZXR1cm4ge1xuICAgICAgLi4ucGxheWVyLFxuICAgICAgaGFuZDogeyBTUjogMywgTFI6IDMsIFNQOiAzLCBMUDogMywgVFA6IDEsIEhNOiBoYW5kLkhNIH0sXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB7IC4uLnBsYXllciwgaGFuZCB9O1xufVxuIiwgIi8qKlxuICogU2hhcmVkIHByaW1pdGl2ZXMgdXNlZCBieSBtdWx0aXBsZSBzcGVjaWFsLXBsYXkgcmVzb2x2ZXJzLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgUGxheWVySWQgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi8uLi9zdGF0ZS5qc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgc3RhdGU6IEdhbWVTdGF0ZTtcbiAgZXZlbnRzOiBFdmVudFtdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYmxhbmtQaWNrKCk6IEdhbWVTdGF0ZVtcInBlbmRpbmdQaWNrXCJdIHtcbiAgcmV0dXJuIHsgb2ZmZW5zZVBsYXk6IG51bGwsIGRlZmVuc2VQbGF5OiBudWxsIH07XG59XG5cbi8qKlxuICogQXdhcmQgcG9pbnRzLCBmbGlwIHRvIFBBVF9DSE9JQ0UuIENhbGxlciBlbWl0cyBUT1VDSERPV04uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhcHBseVRvdWNoZG93bihcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgc2NvcmVyOiBQbGF5ZXJJZCxcbiAgZXZlbnRzOiBFdmVudFtdLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgW3Njb3Jlcl06IHsgLi4uc3RhdGUucGxheWVyc1tzY29yZXJdLCBzY29yZTogc3RhdGUucGxheWVyc1tzY29yZXJdLnNjb3JlICsgNiB9LFxuICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUT1VDSERPV05cIiwgc2NvcmluZ1BsYXllcjogc2NvcmVyIH0pO1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBwaGFzZTogXCJQQVRfQ0hPSUNFXCIsXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcHBseVNhZmV0eShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgY29uY2VkZXI6IFBsYXllcklkLFxuICBldmVudHM6IEV2ZW50W10sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IHNjb3JlciA9IG9wcChjb25jZWRlcik7XG4gIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgLi4uc3RhdGUucGxheWVycyxcbiAgICBbc2NvcmVyXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0uc2NvcmUgKyAyIH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlNBRkVUWVwiLCBzY29yaW5nUGxheWVyOiBzY29yZXIgfSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIHBoYXNlOiBcIktJQ0tPRkZcIixcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuLyoqXG4gKiBBcHBseSBhIHlhcmRhZ2Ugb3V0Y29tZSB3aXRoIGZ1bGwgZG93bi90dXJub3Zlci9zY29yZSBib29ra2VlcGluZy5cbiAqIFVzZWQgYnkgc3BlY2lhbHMgdGhhdCBwcm9kdWNlIHlhcmRhZ2UgZGlyZWN0bHkgKEhhaWwgTWFyeSwgQmlnIFBsYXkgcmV0dXJuKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5WWFyZGFnZU91dGNvbWUoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHlhcmRzOiBudW1iZXIsXG4gIGV2ZW50czogRXZlbnRbXSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IHByb2plY3RlZCA9IHN0YXRlLmZpZWxkLmJhbGxPbiArIHlhcmRzO1xuXG4gIGlmIChwcm9qZWN0ZWQgPj0gMTAwKSByZXR1cm4gYXBwbHlUb3VjaGRvd24oc3RhdGUsIG9mZmVuc2UsIGV2ZW50cyk7XG4gIGlmIChwcm9qZWN0ZWQgPD0gMCkgcmV0dXJuIGFwcGx5U2FmZXR5KHN0YXRlLCBvZmZlbnNlLCBldmVudHMpO1xuXG4gIGNvbnN0IHJlYWNoZWRGaXJzdERvd24gPSBwcm9qZWN0ZWQgPj0gc3RhdGUuZmllbGQuZmlyc3REb3duQXQ7XG4gIGxldCBuZXh0RG93biA9IHN0YXRlLmZpZWxkLmRvd247XG4gIGxldCBuZXh0Rmlyc3REb3duQXQgPSBzdGF0ZS5maWVsZC5maXJzdERvd25BdDtcbiAgbGV0IHBvc3Nlc3Npb25GbGlwcGVkID0gZmFsc2U7XG5cbiAgaWYgKHJlYWNoZWRGaXJzdERvd24pIHtcbiAgICBuZXh0RG93biA9IDE7XG4gICAgbmV4dEZpcnN0RG93bkF0ID0gTWF0aC5taW4oMTAwLCBwcm9qZWN0ZWQgKyAxMCk7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkZJUlNUX0RPV05cIiB9KTtcbiAgfSBlbHNlIGlmIChzdGF0ZS5maWVsZC5kb3duID09PSA0KSB7XG4gICAgcG9zc2Vzc2lvbkZsaXBwZWQgPSB0cnVlO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUl9PTl9ET1dOU1wiIH0pO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiZG93bnNcIiB9KTtcbiAgfSBlbHNlIHtcbiAgICBuZXh0RG93biA9IChzdGF0ZS5maWVsZC5kb3duICsgMSkgYXMgMSB8IDIgfCAzIHwgNDtcbiAgfVxuXG4gIGNvbnN0IG1pcnJvcmVkQmFsbE9uID0gcG9zc2Vzc2lvbkZsaXBwZWQgPyAxMDAgLSBwcm9qZWN0ZWQgOiBwcm9qZWN0ZWQ7XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IG1pcnJvcmVkQmFsbE9uLFxuICAgICAgICBmaXJzdERvd25BdDogcG9zc2Vzc2lvbkZsaXBwZWRcbiAgICAgICAgICA/IE1hdGgubWluKDEwMCwgbWlycm9yZWRCYWxsT24gKyAxMClcbiAgICAgICAgICA6IG5leHRGaXJzdERvd25BdCxcbiAgICAgICAgZG93bjogcG9zc2Vzc2lvbkZsaXBwZWQgPyAxIDogbmV4dERvd24sXG4gICAgICAgIG9mZmVuc2U6IHBvc3Nlc3Npb25GbGlwcGVkID8gb3BwKG9mZmVuc2UpIDogb2ZmZW5zZSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBCaWcgUGxheSByZXNvbHV0aW9uIChydW4uanM6MTkzMykuXG4gKlxuICogVHJpZ2dlcmVkIGJ5OlxuICogICAtIFRyaWNrIFBsYXkgZGllPTVcbiAqICAgLSBTYW1lIFBsYXkgS2luZyBvdXRjb21lXG4gKiAgIC0gT3RoZXIgZnV0dXJlIGhvb2tzXG4gKlxuICogVGhlIGJlbmVmaWNpYXJ5IGFyZ3VtZW50IHNheXMgd2hvIGJlbmVmaXRzIFx1MjAxNCB0aGlzIGNhbiBiZSBvZmZlbnNlIE9SXG4gKiBkZWZlbnNlIChkaWZmZXJlbnQgb3V0Y29tZSB0YWJsZXMpLlxuICpcbiAqIE9mZmVuc2l2ZSBCaWcgUGxheSAob2ZmZW5zZSBiZW5lZml0cyk6XG4gKiAgIGRpZSAxLTMgXHUyMTkyICsyNSB5YXJkc1xuICogICBkaWUgNC01IFx1MjE5MiBtYXgoaGFsZi10by1nb2FsLCA0MCkgeWFyZHNcbiAqICAgZGllIDYgICBcdTIxOTIgVG91Y2hkb3duXG4gKlxuICogRGVmZW5zaXZlIEJpZyBQbGF5IChkZWZlbnNlIGJlbmVmaXRzKTpcbiAqICAgZGllIDEtMyBcdTIxOTIgMTAteWFyZCBwZW5hbHR5IG9uIG9mZmVuc2UgKHJlcGVhdCBkb3duKSwgaGFsZi10by1nb2FsIGlmIHRpZ2h0XG4gKiAgIGRpZSA0LTUgXHUyMTkyIEZVTUJMRSBcdTIxOTIgdHVybm92ZXIgKyBkZWZlbnNlIHJldHVybnMgbWF4KGhhbGYsIDI1KVxuICogICBkaWUgNiAgIFx1MjE5MiBGVU1CTEUgXHUyMTkyIGRlZmVuc2l2ZSBURFxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBQbGF5ZXJJZCB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4uLy4uL3N0YXRlLmpzXCI7XG5pbXBvcnQge1xuICBhcHBseVNhZmV0eSxcbiAgYXBwbHlUb3VjaGRvd24sXG4gIGJsYW5rUGljayxcbiAgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbixcbn0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlQmlnUGxheShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgYmVuZWZpY2lhcnk6IFBsYXllcklkLFxuICBybmc6IFJuZyxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGRpZSA9IHJuZy5kNigpO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbeyB0eXBlOiBcIkJJR19QTEFZXCIsIGJlbmVmaWNpYXJ5LCBzdWJyb2xsOiBkaWUgfV07XG5cbiAgaWYgKGJlbmVmaWNpYXJ5ID09PSBvZmZlbnNlKSB7XG4gICAgcmV0dXJuIG9mZmVuc2l2ZUJpZ1BsYXkoc3RhdGUsIG9mZmVuc2UsIGRpZSwgZXZlbnRzKTtcbiAgfVxuICByZXR1cm4gZGVmZW5zaXZlQmlnUGxheShzdGF0ZSwgb2ZmZW5zZSwgZGllLCBldmVudHMpO1xufVxuXG5mdW5jdGlvbiBvZmZlbnNpdmVCaWdQbGF5KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBvZmZlbnNlOiBQbGF5ZXJJZCxcbiAgZGllOiAxIHwgMiB8IDMgfCA0IHwgNSB8IDYsXG4gIGV2ZW50czogRXZlbnRbXSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgaWYgKGRpZSA9PT0gNikge1xuICAgIHJldHVybiBhcHBseVRvdWNoZG93bihzdGF0ZSwgb2ZmZW5zZSwgZXZlbnRzKTtcbiAgfVxuXG4gIC8vIGRpZSAxLTM6ICsyNTsgZGllIDQtNTogbWF4KGhhbGYtdG8tZ29hbCwgNDApXG4gIGxldCBnYWluOiBudW1iZXI7XG4gIGlmIChkaWUgPD0gMykge1xuICAgIGdhaW4gPSAyNTtcbiAgfSBlbHNlIHtcbiAgICBjb25zdCBoYWxmVG9Hb2FsID0gTWF0aC5yb3VuZCgoMTAwIC0gc3RhdGUuZmllbGQuYmFsbE9uKSAvIDIpO1xuICAgIGdhaW4gPSBoYWxmVG9Hb2FsID4gNDAgPyBoYWxmVG9Hb2FsIDogNDA7XG4gIH1cblxuICBjb25zdCBwcm9qZWN0ZWQgPSBzdGF0ZS5maWVsZC5iYWxsT24gKyBnYWluO1xuICBpZiAocHJvamVjdGVkID49IDEwMCkge1xuICAgIHJldHVybiBhcHBseVRvdWNoZG93bihzdGF0ZSwgb2ZmZW5zZSwgZXZlbnRzKTtcbiAgfVxuXG4gIC8vIEFwcGx5IGdhaW4sIGNoZWNrIGZvciBmaXJzdCBkb3duLlxuICBjb25zdCByZWFjaGVkRmlyc3REb3duID0gcHJvamVjdGVkID49IHN0YXRlLmZpZWxkLmZpcnN0RG93bkF0O1xuICBjb25zdCBuZXh0RG93biA9IHJlYWNoZWRGaXJzdERvd24gPyAxIDogc3RhdGUuZmllbGQuZG93bjtcbiAgY29uc3QgbmV4dEZpcnN0RG93bkF0ID0gcmVhY2hlZEZpcnN0RG93blxuICAgID8gTWF0aC5taW4oMTAwLCBwcm9qZWN0ZWQgKyAxMClcbiAgICA6IHN0YXRlLmZpZWxkLmZpcnN0RG93bkF0O1xuXG4gIGlmIChyZWFjaGVkRmlyc3REb3duKSBldmVudHMucHVzaCh7IHR5cGU6IFwiRklSU1RfRE9XTlwiIH0pO1xuXG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgLi4uc3RhdGUuZmllbGQsXG4gICAgICAgIGJhbGxPbjogcHJvamVjdGVkLFxuICAgICAgICBkb3duOiBuZXh0RG93bixcbiAgICAgICAgZmlyc3REb3duQXQ6IG5leHRGaXJzdERvd25BdCxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGRlZmVuc2l2ZUJpZ1BsYXkoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIG9mZmVuc2U6IFBsYXllcklkLFxuICBkaWU6IDEgfCAyIHwgMyB8IDQgfCA1IHwgNixcbiAgZXZlbnRzOiBFdmVudFtdLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICAvLyAxLTM6IDEwLXlhcmQgcGVuYWx0eSwgcmVwZWF0IGRvd24gKG5vIGRvd24gY29uc3VtZWQpLlxuICBpZiAoZGllIDw9IDMpIHtcbiAgICBjb25zdCBuYWl2ZVBlbmFsdHkgPSAtMTA7XG4gICAgY29uc3QgaGFsZlRvR29hbCA9IC1NYXRoLmZsb29yKHN0YXRlLmZpZWxkLmJhbGxPbiAvIDIpO1xuICAgIGNvbnN0IHBlbmFsdHlZYXJkcyA9XG4gICAgICBzdGF0ZS5maWVsZC5iYWxsT24gLSAxMCA8IDEgPyBoYWxmVG9Hb2FsIDogbmFpdmVQZW5hbHR5O1xuXG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlBFTkFMVFlcIiwgYWdhaW5zdDogb2ZmZW5zZSwgeWFyZHM6IHBlbmFsdHlZYXJkcywgbG9zc09mRG93bjogZmFsc2UgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgLi4uc3RhdGUuZmllbGQsXG4gICAgICAgICAgYmFsbE9uOiBNYXRoLm1heCgwLCBzdGF0ZS5maWVsZC5iYWxsT24gKyBwZW5hbHR5WWFyZHMpLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gNC01OiB0dXJub3ZlciB3aXRoIHJldHVybiBvZiBtYXgoaGFsZiwgMjUpLiA2OiBkZWZlbnNpdmUgVEQuXG4gIGNvbnN0IGRlZmVuZGVyID0gb3BwKG9mZmVuc2UpO1xuXG4gIGlmIChkaWUgPT09IDYpIHtcbiAgICAvLyBEZWZlbnNlIHNjb3JlcyB0aGUgVEQuXG4gICAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICBbZGVmZW5kZXJdOiB7IC4uLnN0YXRlLnBsYXllcnNbZGVmZW5kZXJdLCBzY29yZTogc3RhdGUucGxheWVyc1tkZWZlbmRlcl0uc2NvcmUgKyA2IH0sXG4gICAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiZnVtYmxlXCIgfSk7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRPVUNIRE9XTlwiLCBzY29yaW5nUGxheWVyOiBkZWZlbmRlciB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgcGhhc2U6IFwiUEFUX0NIT0lDRVwiLFxuICAgICAgICBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogZGVmZW5kZXIgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIGRpZSA0LTU6IHR1cm5vdmVyIHdpdGggcmV0dXJuLlxuICBjb25zdCBoYWxmVG9Hb2FsID0gTWF0aC5yb3VuZCgoMTAwIC0gc3RhdGUuZmllbGQuYmFsbE9uKSAvIDIpO1xuICBjb25zdCByZXR1cm5ZYXJkcyA9IGhhbGZUb0dvYWwgPiAyNSA/IGhhbGZUb0dvYWwgOiAyNTtcblxuICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcImZ1bWJsZVwiIH0pO1xuXG4gIC8vIERlZmVuc2UgYmVjb21lcyBuZXcgb2ZmZW5zZS4gQmFsbCBwb3NpdGlvbjogb2ZmZW5zZSBnYWluZWQgcmV0dXJuWWFyZHMsXG4gIC8vIHRoZW4gZmxpcCBwZXJzcGVjdGl2ZS5cbiAgY29uc3QgcHJvamVjdGVkID0gc3RhdGUuZmllbGQuYmFsbE9uICsgcmV0dXJuWWFyZHM7XG4gIGlmIChwcm9qZWN0ZWQgPj0gMTAwKSB7XG4gICAgLy8gUmV0dXJuZWQgYWxsIHRoZSB3YXkgXHUyMDE0IFREIGZvciBkZWZlbmRlci5cbiAgICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgIFtkZWZlbmRlcl06IHsgLi4uc3RhdGUucGxheWVyc1tkZWZlbmRlcl0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW2RlZmVuZGVyXS5zY29yZSArIDYgfSxcbiAgICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRPVUNIRE9XTlwiLCBzY29yaW5nUGxheWVyOiBkZWZlbmRlciB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgcGhhc2U6IFwiUEFUX0NIT0lDRVwiLFxuICAgICAgICBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogZGVmZW5kZXIgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuICBpZiAocHJvamVjdGVkIDw9IDApIHtcbiAgICByZXR1cm4gYXBwbHlTYWZldHkoc3RhdGUsIG9mZmVuc2UsIGV2ZW50cyk7XG4gIH1cblxuICAvLyBGbGlwIHBvc3Nlc3Npb24sIG1pcnJvciBiYWxsIHBvc2l0aW9uLlxuICBjb25zdCBtaXJyb3JlZEJhbGxPbiA9IDEwMCAtIHByb2plY3RlZDtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IG1pcnJvcmVkQmFsbE9uLFxuICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBtaXJyb3JlZEJhbGxPbiArIDEwKSxcbiAgICAgICAgZG93bjogMSxcbiAgICAgICAgb2ZmZW5zZTogZGVmZW5kZXIsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuIiwgIi8qKlxuICogUHVudCAocnVuLmpzOjIwOTApLiBBbHNvIHNlcnZlcyBmb3Igc2FmZXR5IGtpY2tzLlxuICpcbiAqIFNlcXVlbmNlIChhbGwgcmFuZG9tbmVzcyB0aHJvdWdoIHJuZyk6XG4gKiAgIDEuIEJsb2NrIGNoZWNrOiBpZiBpbml0aWFsIGQ2IGlzIDYsIHJvbGwgYWdhaW4gXHUyMDE0IDItc2l4ZXMgPSBibG9ja2VkICgxLzM2KS5cbiAqICAgMi4gSWYgbm90IGJsb2NrZWQsIGRyYXcgeWFyZHMgY2FyZCArIGNvaW4gZmxpcDpcbiAqICAgICAgICBraWNrRGlzdCA9IDEwICogeWFyZHNDYXJkIC8gMiArIDIwICogKGNvaW49aGVhZHMgPyAxIDogMClcbiAqICAgICAgUmVzdWx0aW5nIHJhbmdlOiBbNSwgNzBdIHlhcmRzLlxuICogICAzLiBJZiBiYWxsIGxhbmRzIHBhc3QgMTAwIFx1MjE5MiB0b3VjaGJhY2ssIHBsYWNlIGF0IHJlY2VpdmVyJ3MgMjAuXG4gKiAgIDQuIE11ZmYgY2hlY2sgKG5vdCBvbiB0b3VjaGJhY2svYmxvY2svc2FmZXR5IGtpY2spOiAyLXNpeGVzID0gcmVjZWl2ZXJcbiAqICAgICAgbXVmZnMsIGtpY2tpbmcgdGVhbSByZWNvdmVycy5cbiAqICAgNS4gUmV0dXJuOiBpZiBwb3NzZXNzaW9uLCBkcmF3IG11bHRDYXJkICsgeWFyZHMuXG4gKiAgICAgICAgS2luZz03eCwgUXVlZW49NHgsIEphY2s9MXgsIDEwPS0wLjV4XG4gKiAgICAgICAgcmV0dXJuID0gcm91bmQobXVsdCAqIHlhcmRzQ2FyZClcbiAqICAgICAgUmV0dXJuIGNhbiBzY29yZSBURCBvciBjb25jZWRlIHNhZmV0eS5cbiAqXG4gKiBGb3IgdGhlIGVuZ2luZSBwb3J0OiB0aGlzIGlzIHRoZSBtb3N0IHByb2NlZHVyYWwgb2YgdGhlIHNwZWNpYWxzLiBXZVxuICogY29sbGVjdCBldmVudHMgaW4gb3JkZXIgYW5kIHByb2R1Y2Ugb25lIGZpbmFsIHN0YXRlLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7IGRyYXdNdWx0aXBsaWVyLCBkcmF3WWFyZHMgfSBmcm9tIFwiLi4vZGVjay5qc1wiO1xuaW1wb3J0IHtcbiAgYXBwbHlTYWZldHksXG4gIGFwcGx5VG91Y2hkb3duLFxuICBibGFua1BpY2ssXG4gIHR5cGUgU3BlY2lhbFJlc29sdXRpb24sXG59IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5jb25zdCBSRVRVUk5fTVVMVElQTElFUlM6IFJlY29yZDxcIktpbmdcIiB8IFwiUXVlZW5cIiB8IFwiSmFja1wiIHwgXCIxMFwiLCBudW1iZXI+ID0ge1xuICBLaW5nOiA3LFxuICBRdWVlbjogNCxcbiAgSmFjazogMSxcbiAgXCIxMFwiOiAtMC41LFxufTtcblxuZXhwb3J0IGludGVyZmFjZSBQdW50T3B0aW9ucyB7XG4gIC8qKiB0cnVlIGlmIHRoaXMgaXMgYSBzYWZldHkga2ljayAobm8gYmxvY2svbXVmZiBjaGVja3MpLiAqL1xuICBzYWZldHlLaWNrPzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVQdW50KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBybmc6IFJuZyxcbiAgb3B0czogUHVudE9wdGlvbnMgPSB7fSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGRlZmVuZGVyID0gb3BwKG9mZmVuc2UpO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcbiAgbGV0IGRlY2sgPSBzdGF0ZS5kZWNrO1xuXG4gIC8vIEJsb2NrIGNoZWNrIChub3Qgb24gc2FmZXR5IGtpY2spLlxuICBsZXQgYmxvY2tlZCA9IGZhbHNlO1xuICBpZiAoIW9wdHMuc2FmZXR5S2ljaykge1xuICAgIGlmIChybmcuZDYoKSA9PT0gNiAmJiBybmcuZDYoKSA9PT0gNikge1xuICAgICAgYmxvY2tlZCA9IHRydWU7XG4gICAgfVxuICB9XG5cbiAgaWYgKGJsb2NrZWQpIHtcbiAgICAvLyBLaWNraW5nIHRlYW0gbG9zZXMgcG9zc2Vzc2lvbiBhdCB0aGUgbGluZSBvZiBzY3JpbW1hZ2UuXG4gICAgY29uc3QgbWlycm9yZWRCYWxsT24gPSAxMDAgLSBzdGF0ZS5maWVsZC5iYWxsT247XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlBVTlRcIiwgcGxheWVyOiBvZmZlbnNlLCBsYW5kaW5nU3BvdDogc3RhdGUuZmllbGQuYmFsbE9uIH0pO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiZnVtYmxlXCIgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgYmFsbE9uOiBtaXJyb3JlZEJhbGxPbixcbiAgICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBtaXJyb3JlZEJhbGxPbiArIDEwKSxcbiAgICAgICAgICBkb3duOiAxLFxuICAgICAgICAgIG9mZmVuc2U6IGRlZmVuZGVyLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gRHJhdyB5YXJkcyArIGNvaW4gZm9yIGtpY2sgZGlzdGFuY2UuXG4gIGNvbnN0IGNvaW4gPSBybmcuY29pbkZsaXAoKTtcbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKGRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuICBkZWNrID0geWFyZHNEcmF3LmRlY2s7XG5cbiAgY29uc3Qga2lja0Rpc3QgPSAoMTAgKiB5YXJkc0RyYXcuY2FyZCkgLyAyICsgKGNvaW4gPT09IFwiaGVhZHNcIiA/IDIwIDogMCk7XG4gIGNvbnN0IGxhbmRpbmdTcG90ID0gc3RhdGUuZmllbGQuYmFsbE9uICsga2lja0Rpc3Q7XG4gIGNvbnN0IHRvdWNoYmFjayA9IGxhbmRpbmdTcG90ID4gMTAwO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiUFVOVFwiLCBwbGF5ZXI6IG9mZmVuc2UsIGxhbmRpbmdTcG90IH0pO1xuXG4gIC8vIE11ZmYgY2hlY2sgKG5vdCBvbiB0b3VjaGJhY2ssIGJsb2NrLCBzYWZldHkga2ljaykuXG4gIGxldCBtdWZmZWQgPSBmYWxzZTtcbiAgaWYgKCF0b3VjaGJhY2sgJiYgIW9wdHMuc2FmZXR5S2ljaykge1xuICAgIGlmIChybmcuZDYoKSA9PT0gNiAmJiBybmcuZDYoKSA9PT0gNikge1xuICAgICAgbXVmZmVkID0gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICBpZiAobXVmZmVkKSB7XG4gICAgLy8gUmVjZWl2ZXIgbXVmZnMsIGtpY2tpbmcgdGVhbSByZWNvdmVycyB3aGVyZSB0aGUgYmFsbCBsYW5kZWQuXG4gICAgLy8gS2lja2luZyB0ZWFtIHJldGFpbnMgcG9zc2Vzc2lvbiAoc3RpbGwgb2ZmZW5zZSkuXG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJmdW1ibGVcIiB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIGRlY2ssXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICBiYWxsT246IE1hdGgubWluKDk5LCBsYW5kaW5nU3BvdCksXG4gICAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgbGFuZGluZ1Nwb3QgKyAxMCksXG4gICAgICAgICAgZG93bjogMSxcbiAgICAgICAgICBvZmZlbnNlLCAvLyBraWNrZXIgcmV0YWluc1xuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gVG91Y2hiYWNrOiByZWNlaXZlciBnZXRzIGJhbGwgYXQgdGhlaXIgb3duIDIwICg9IDgwIGZyb20gdGhlaXIgcGVyc3BlY3RpdmUsXG4gIC8vIGJ1dCBiYWxsIHBvc2l0aW9uIGlzIHRyYWNrZWQgZnJvbSBvZmZlbnNlIFBPViwgc28gZm9yIHRoZSBORVcgb2ZmZW5zZSB0aGF0XG4gIC8vIGlzIDEwMC04MCA9IDIwKS5cbiAgaWYgKHRvdWNoYmFjaykge1xuICAgIGNvbnN0IHN0YXRlQWZ0ZXJLaWNrOiBHYW1lU3RhdGUgPSB7IC4uLnN0YXRlLCBkZWNrIH07XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlQWZ0ZXJLaWNrLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgYmFsbE9uOiAyMCxcbiAgICAgICAgICBmaXJzdERvd25BdDogMzAsXG4gICAgICAgICAgZG93bjogMSxcbiAgICAgICAgICBvZmZlbnNlOiBkZWZlbmRlcixcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIE5vcm1hbCBwdW50IHJldHVybjogZHJhdyBtdWx0Q2FyZCArIHlhcmRzLiBSZXR1cm4gbWVhc3VyZWQgZnJvbSBsYW5kaW5nU3BvdC5cbiAgY29uc3QgbXVsdERyYXcgPSBkcmF3TXVsdGlwbGllcihkZWNrLCBybmcpO1xuICBpZiAobXVsdERyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJtdWx0aXBsaWVyXCIgfSk7XG4gIGRlY2sgPSBtdWx0RHJhdy5kZWNrO1xuXG4gIGNvbnN0IHJldHVybkRyYXcgPSBkcmF3WWFyZHMoZGVjaywgcm5nKTtcbiAgaWYgKHJldHVybkRyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuICBkZWNrID0gcmV0dXJuRHJhdy5kZWNrO1xuXG4gIGNvbnN0IG11bHQgPSBSRVRVUk5fTVVMVElQTElFUlNbbXVsdERyYXcuY2FyZF07XG4gIGNvbnN0IHJldHVybllhcmRzID0gTWF0aC5yb3VuZChtdWx0ICogcmV0dXJuRHJhdy5jYXJkKTtcblxuICAvLyBCYWxsIGVuZHMgdXAgYXQgbGFuZGluZ1Nwb3QgLSByZXR1cm5ZYXJkcyAoZnJvbSBraWNraW5nIHRlYW0ncyBQT1YpLlxuICAvLyBFcXVpdmFsZW50bHksIGZyb20gdGhlIHJlY2VpdmluZyB0ZWFtJ3MgUE9WOiAoMTAwIC0gbGFuZGluZ1Nwb3QpICsgcmV0dXJuWWFyZHMuXG4gIGNvbnN0IHJlY2VpdmVyQmFsbE9uID0gMTAwIC0gbGFuZGluZ1Nwb3QgKyByZXR1cm5ZYXJkcztcblxuICBjb25zdCBzdGF0ZUFmdGVyUmV0dXJuOiBHYW1lU3RhdGUgPSB7IC4uLnN0YXRlLCBkZWNrIH07XG5cbiAgLy8gUmV0dXJuIFREIFx1MjAxNCByZWNlaXZlciBzY29yZXMuXG4gIGlmIChyZWNlaXZlckJhbGxPbiA+PSAxMDApIHtcbiAgICBjb25zdCByZWNlaXZlckJhbGxDbGFtcGVkID0gMTAwO1xuICAgIHZvaWQgcmVjZWl2ZXJCYWxsQ2xhbXBlZDtcbiAgICByZXR1cm4gYXBwbHlUb3VjaGRvd24oXG4gICAgICB7IC4uLnN0YXRlQWZ0ZXJSZXR1cm4sIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiBkZWZlbmRlciB9IH0sXG4gICAgICBkZWZlbmRlcixcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgLy8gUmV0dXJuIHNhZmV0eSBcdTIwMTQgcmVjZWl2ZXIgdGFja2xlZCBpbiB0aGVpciBvd24gZW5kem9uZSAoY2FuJ3QgYWN0dWFsbHlcbiAgLy8gaGFwcGVuIGZyb20gYSBuZWdhdGl2ZS1yZXR1cm4teWFyZGFnZSBzdGFuZHBvaW50IGluIHY1LjEgc2luY2Ugc3RhcnQgaXNcbiAgLy8gMTAwLWxhbmRpbmdTcG90IHdoaWNoIGlzID4gMCwgYnV0IG1vZGVsIGl0IGFueXdheSBmb3IgY29tcGxldGVuZXNzKS5cbiAgaWYgKHJlY2VpdmVyQmFsbE9uIDw9IDApIHtcbiAgICByZXR1cm4gYXBwbHlTYWZldHkoXG4gICAgICB7IC4uLnN0YXRlQWZ0ZXJSZXR1cm4sIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiBkZWZlbmRlciB9IH0sXG4gICAgICBkZWZlbmRlcixcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGVBZnRlclJldHVybixcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogcmVjZWl2ZXJCYWxsT24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIHJlY2VpdmVyQmFsbE9uICsgMTApLFxuICAgICAgICBkb3duOiAxLFxuICAgICAgICBvZmZlbnNlOiBkZWZlbmRlcixcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBLaWNrb2ZmLiBJbiB2NS4xIGtpY2tvZmZzIGhhdmUgYSBcImtpY2sgdHlwZVwiIHNlbGVjdGlvbiAob25zaWRlIHZzXG4gKiByZWd1bGFyKSB3aGljaCB3ZSdyZSBza2lwcGluZyBmb3IgdjYgXHUyMDE0IGluc3RlYWQgd2UgdHJlYXQgYSBraWNrb2ZmIGFzXG4gKiBhIHNpbXBsaWZpZWQgcHVudCBmcm9tIHRoZSAzNSB3aXRoIG5vIGJsb2NrIGNoZWNrIGFuZCBubyBtdWZmIGNoZWNrLlxuICpcbiAqIFRoZSBraWNraW5nIHRlYW0gKHN0YXRlLmZpZWxkLm9mZmVuc2UpIGlzIHdob2V2ZXIganVzdCBzY29yZWQgb3IgaXNcbiAqIHN0YXJ0aW5nIHRoZSBoYWxmLiBQb3NzZXNzaW9uIGZsaXBzIHRvIHRoZSByZWNlaXZlciBhcyBwYXJ0IG9mIHRoZVxuICogcmVzb2x1dGlvbi5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyByZXNvbHZlUHVudCB9IGZyb20gXCIuL3B1bnQuanNcIjtcbmltcG9ydCB7IHR5cGUgU3BlY2lhbFJlc29sdXRpb24gfSBmcm9tIFwiLi9zaGFyZWQuanNcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVLaWNrb2ZmKHN0YXRlOiBHYW1lU3RhdGUsIHJuZzogUm5nKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICAvLyBQbGFjZSBiYWxsIGF0IGtpY2tpbmcgdGVhbSdzIDM1IGFuZCBwdW50IGZyb20gdGhlcmUuIFVzZSB0aGUgc2FmZXR5S2lja1xuICAvLyBmbGFnIHRvIHNraXAgYmxvY2svbXVmZiBcdTIwMTQgYSByZWFsIGtpY2tvZmYgY2FuJ3QgYmUgXCJibG9ja2VkXCIgaW4gdGhlIHNhbWVcbiAgLy8gd2F5LCBhbmQgdjUuMSB1c2VzIHB1bnQoKSBmb3Igc2FmZXR5IGtpY2tzIHNpbWlsYXJseS5cbiAgY29uc3Qga2lja2luZ1N0YXRlOiBHYW1lU3RhdGUgPSB7XG4gICAgLi4uc3RhdGUsXG4gICAgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIGJhbGxPbjogMzUgfSxcbiAgfTtcbiAgY29uc3QgcmVzdWx0ID0gcmVzb2x2ZVB1bnQoa2lja2luZ1N0YXRlLCBybmcsIHsgc2FmZXR5S2ljazogdHJ1ZSB9KTtcbiAgLy8gQWZ0ZXIgcmVzb2x1dGlvbiwgd2UncmUgaW4gUkVHX1BMQVkuXG4gIHJldHVybiB7XG4gICAgLi4ucmVzdWx0LFxuICAgIHN0YXRlOiB7IC4uLnJlc3VsdC5zdGF0ZSwgcGhhc2U6IFwiUkVHX1BMQVlcIiB9LFxuICB9O1xufVxuIiwgIi8qKlxuICogSGFpbCBNYXJ5IG91dGNvbWVzIChydW4uanM6MjI0MikuIERpZSB2YWx1ZSBcdTIxOTIgcmVzdWx0LCBmcm9tIG9mZmVuc2UncyBQT1Y6XG4gKiAgIDEgXHUyMTkyIEJJRyBTQUNLLCAtMTAgeWFyZHNcbiAqICAgMiBcdTIxOTIgKzIwIHlhcmRzXG4gKiAgIDMgXHUyMTkyICAgMCB5YXJkc1xuICogICA0IFx1MjE5MiArNDAgeWFyZHNcbiAqICAgNSBcdTIxOTIgSU5URVJDRVBUSU9OICh0dXJub3ZlciBhdCBzcG90KVxuICogICA2IFx1MjE5MiBUT1VDSERPV05cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4uLy4uL3N0YXRlLmpzXCI7XG5pbXBvcnQge1xuICBhcHBseVNhZmV0eSxcbiAgYXBwbHlUb3VjaGRvd24sXG4gIGFwcGx5WWFyZGFnZU91dGNvbWUsXG4gIGJsYW5rUGljayxcbiAgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbixcbn0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlSGFpbE1hcnkoc3RhdGU6IEdhbWVTdGF0ZSwgcm5nOiBSbmcpOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBkaWUgPSBybmcuZDYoKTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW3sgdHlwZTogXCJIQUlMX01BUllfUk9MTFwiLCBvdXRjb21lOiBkaWUgfV07XG5cbiAgLy8gRGVjcmVtZW50IEhNIGNvdW50IHJlZ2FyZGxlc3Mgb2Ygb3V0Y29tZS5cbiAgY29uc3QgdXBkYXRlZFBsYXllcnMgPSB7XG4gICAgLi4uc3RhdGUucGxheWVycyxcbiAgICBbb2ZmZW5zZV06IHtcbiAgICAgIC4uLnN0YXRlLnBsYXllcnNbb2ZmZW5zZV0sXG4gICAgICBoYW5kOiB7IC4uLnN0YXRlLnBsYXllcnNbb2ZmZW5zZV0uaGFuZCwgSE06IE1hdGgubWF4KDAsIHN0YXRlLnBsYXllcnNbb2ZmZW5zZV0uaGFuZC5ITSAtIDEpIH0sXG4gICAgfSxcbiAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICBjb25zdCBzdGF0ZVdpdGhIbTogR2FtZVN0YXRlID0geyAuLi5zdGF0ZSwgcGxheWVyczogdXBkYXRlZFBsYXllcnMgfTtcblxuICAvLyBJbnRlcmNlcHRpb24gKGRpZSA1KSBcdTIwMTQgdHVybm92ZXIgYXQgdGhlIHNwb3QsIHBvc3Nlc3Npb24gZmxpcHMuXG4gIGlmIChkaWUgPT09IDUpIHtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcImludGVyY2VwdGlvblwiIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZVdpdGhIbSxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIC4uLnN0YXRlV2l0aEhtLmZpZWxkLFxuICAgICAgICAgIG9mZmVuc2U6IG9wcChvZmZlbnNlKSxcbiAgICAgICAgICBiYWxsT246IDEwMCAtIHN0YXRlV2l0aEhtLmZpZWxkLmJhbGxPbixcbiAgICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCAxMDAgLSBzdGF0ZVdpdGhIbS5maWVsZC5iYWxsT24gKyAxMCksXG4gICAgICAgICAgZG93bjogMSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIFRvdWNoZG93biAoZGllIDYpLlxuICBpZiAoZGllID09PSA2KSB7XG4gICAgcmV0dXJuIGFwcGx5VG91Y2hkb3duKHN0YXRlV2l0aEhtLCBvZmZlbnNlLCBldmVudHMpO1xuICB9XG5cbiAgLy8gWWFyZGFnZSBvdXRjb21lcyAoZGllIDEsIDIsIDMsIDQpLlxuICBjb25zdCB5YXJkcyA9IGRpZSA9PT0gMSA/IC0xMCA6IGRpZSA9PT0gMiA/IDIwIDogZGllID09PSAzID8gMCA6IDQwO1xuICBjb25zdCBwcm9qZWN0ZWQgPSBzdGF0ZVdpdGhIbS5maWVsZC5iYWxsT24gKyB5YXJkcztcblxuICBpZiAocHJvamVjdGVkID49IDEwMCkgcmV0dXJuIGFwcGx5VG91Y2hkb3duKHN0YXRlV2l0aEhtLCBvZmZlbnNlLCBldmVudHMpO1xuICBpZiAocHJvamVjdGVkIDw9IDApIHJldHVybiBhcHBseVNhZmV0eShzdGF0ZVdpdGhIbSwgb2ZmZW5zZSwgZXZlbnRzKTtcblxuICBldmVudHMucHVzaCh7XG4gICAgdHlwZTogXCJQTEFZX1JFU09MVkVEXCIsXG4gICAgb2ZmZW5zZVBsYXk6IFwiSE1cIixcbiAgICBkZWZlbnNlUGxheTogc3RhdGUucGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgPz8gXCJTUlwiLFxuICAgIG1hdGNodXBRdWFsaXR5OiAwLFxuICAgIG11bHRpcGxpZXI6IHsgY2FyZDogXCIxMFwiLCB2YWx1ZTogMCB9LFxuICAgIHlhcmRzQ2FyZDogMCxcbiAgICB5YXJkc0dhaW5lZDogeWFyZHMsXG4gICAgbmV3QmFsbE9uOiBwcm9qZWN0ZWQsXG4gIH0pO1xuXG4gIHJldHVybiBhcHBseVlhcmRhZ2VPdXRjb21lKHN0YXRlV2l0aEhtLCB5YXJkcywgZXZlbnRzKTtcbn1cbiIsICIvKipcbiAqIFNhbWUgUGxheSBtZWNoYW5pc20gKHJ1bi5qczoxODk5KS5cbiAqXG4gKiBUcmlnZ2VyZWQgd2hlbiBib3RoIHRlYW1zIHBpY2sgdGhlIHNhbWUgcmVndWxhciBwbGF5IEFORCBhIGNvaW4tZmxpcCBsYW5kc1xuICogaGVhZHMgKGFsc28gdW5jb25kaXRpb25hbGx5IHdoZW4gYm90aCBwaWNrIFRyaWNrIFBsYXkpLiBSdW5zIGl0cyBvd25cbiAqIGNvaW4gKyBtdWx0aXBsaWVyLWNhcmQgY2hhaW46XG4gKlxuICogICBtdWx0Q2FyZCA9IEtpbmcgIFx1MjE5MiBCaWcgUGxheSAob2ZmZW5zZSBpZiBjb2luPWhlYWRzLCBkZWZlbnNlIGlmIHRhaWxzKVxuICogICBtdWx0Q2FyZCA9IFF1ZWVuICsgaGVhZHMgXHUyMTkyIG11bHRpcGxpZXIgPSArMywgZHJhdyB5YXJkcyBjYXJkXG4gKiAgIG11bHRDYXJkID0gUXVlZW4gKyB0YWlscyBcdTIxOTIgbXVsdGlwbGllciA9ICAwLCBubyB5YXJkcyAoZGlzdCA9IDApXG4gKiAgIG11bHRDYXJkID0gSmFjayAgKyBoZWFkcyBcdTIxOTIgbXVsdGlwbGllciA9ICAwLCBubyB5YXJkcyAoZGlzdCA9IDApXG4gKiAgIG11bHRDYXJkID0gSmFjayAgKyB0YWlscyBcdTIxOTIgbXVsdGlwbGllciA9IC0zLCBkcmF3IHlhcmRzIGNhcmRcbiAqICAgbXVsdENhcmQgPSAxMCAgICArIGhlYWRzIFx1MjE5MiBJTlRFUkNFUFRJT04gKHR1cm5vdmVyIGF0IHNwb3QpXG4gKiAgIG11bHRDYXJkID0gMTAgICAgKyB0YWlscyBcdTIxOTIgMCB5YXJkc1xuICpcbiAqIE5vdGU6IHRoZSBjb2luIGZsaXAgaW5zaWRlIHRoaXMgZnVuY3Rpb24gaXMgYSBTRUNPTkQgY29pbiBmbGlwIFx1MjAxNCB0aGVcbiAqIG1lY2hhbmlzbS10cmlnZ2VyIGNvaW4gZmxpcCBpcyBoYW5kbGVkIGJ5IHRoZSByZWR1Y2VyIGJlZm9yZSBjYWxsaW5nIGhlcmUuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi8uLi9zdGF0ZS5qc1wiO1xuaW1wb3J0IHsgZHJhd011bHRpcGxpZXIsIGRyYXdZYXJkcyB9IGZyb20gXCIuLi9kZWNrLmpzXCI7XG5pbXBvcnQgeyByZXNvbHZlQmlnUGxheSB9IGZyb20gXCIuL2JpZ1BsYXkuanNcIjtcbmltcG9ydCB7XG4gIGFwcGx5WWFyZGFnZU91dGNvbWUsXG4gIGJsYW5rUGljayxcbiAgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbixcbn0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlU2FtZVBsYXkoc3RhdGU6IEdhbWVTdGF0ZSwgcm5nOiBSbmcpOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcblxuICBjb25zdCBjb2luID0gcm5nLmNvaW5GbGlwKCk7XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJTQU1FX1BMQVlfQ09JTlwiLCBvdXRjb21lOiBjb2luIH0pO1xuXG4gIGNvbnN0IG11bHREcmF3ID0gZHJhd011bHRpcGxpZXIoc3RhdGUuZGVjaywgcm5nKTtcbiAgaWYgKG11bHREcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwibXVsdGlwbGllclwiIH0pO1xuXG4gIGNvbnN0IHN0YXRlQWZ0ZXJNdWx0OiBHYW1lU3RhdGUgPSB7IC4uLnN0YXRlLCBkZWNrOiBtdWx0RHJhdy5kZWNrIH07XG4gIGNvbnN0IGhlYWRzID0gY29pbiA9PT0gXCJoZWFkc1wiO1xuXG4gIC8vIEtpbmcgXHUyMTkyIEJpZyBQbGF5IGZvciB3aGljaGV2ZXIgc2lkZSB3aW5zIHRoZSBjb2luLlxuICBpZiAobXVsdERyYXcuY2FyZCA9PT0gXCJLaW5nXCIpIHtcbiAgICBjb25zdCBiZW5lZmljaWFyeSA9IGhlYWRzID8gb2ZmZW5zZSA6IG9wcChvZmZlbnNlKTtcbiAgICBjb25zdCBicCA9IHJlc29sdmVCaWdQbGF5KHN0YXRlQWZ0ZXJNdWx0LCBiZW5lZmljaWFyeSwgcm5nKTtcbiAgICByZXR1cm4geyBzdGF0ZTogYnAuc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4uYnAuZXZlbnRzXSB9O1xuICB9XG5cbiAgLy8gMTAgXHUyMTkyIGludGVyY2VwdGlvbiAoaGVhZHMpIG9yIDAgeWFyZHMgKHRhaWxzKS5cbiAgaWYgKG11bHREcmF3LmNhcmQgPT09IFwiMTBcIikge1xuICAgIGlmIChoZWFkcykge1xuICAgICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJpbnRlcmNlcHRpb25cIiB9KTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgLi4uc3RhdGVBZnRlck11bHQsXG4gICAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgICAuLi5zdGF0ZUFmdGVyTXVsdC5maWVsZCxcbiAgICAgICAgICAgIG9mZmVuc2U6IG9wcChvZmZlbnNlKSxcbiAgICAgICAgICAgIGJhbGxPbjogMTAwIC0gc3RhdGVBZnRlck11bHQuZmllbGQuYmFsbE9uLFxuICAgICAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgMTAwIC0gc3RhdGVBZnRlck11bHQuZmllbGQuYmFsbE9uICsgMTApLFxuICAgICAgICAgICAgZG93bjogMSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBldmVudHMsXG4gICAgICB9O1xuICAgIH1cbiAgICAvLyAwIHlhcmRzLCBkb3duIGNvbnN1bWVkLlxuICAgIHJldHVybiBhcHBseVlhcmRhZ2VPdXRjb21lKHN0YXRlQWZ0ZXJNdWx0LCAwLCBldmVudHMpO1xuICB9XG5cbiAgLy8gUXVlZW4gb3IgSmFjayBcdTIxOTIgbXVsdGlwbGllciwgdGhlbiBkcmF3IHlhcmRzIGNhcmQuXG4gIGxldCBtdWx0aXBsaWVyID0gMDtcbiAgaWYgKG11bHREcmF3LmNhcmQgPT09IFwiUXVlZW5cIikgbXVsdGlwbGllciA9IGhlYWRzID8gMyA6IDA7XG4gIGlmIChtdWx0RHJhdy5jYXJkID09PSBcIkphY2tcIikgbXVsdGlwbGllciA9IGhlYWRzID8gMCA6IC0zO1xuXG4gIGlmIChtdWx0aXBsaWVyID09PSAwKSB7XG4gICAgLy8gMCB5YXJkcywgZG93biBjb25zdW1lZC5cbiAgICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShzdGF0ZUFmdGVyTXVsdCwgMCwgZXZlbnRzKTtcbiAgfVxuXG4gIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhzdGF0ZUFmdGVyTXVsdC5kZWNrLCBybmcpO1xuICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcblxuICBjb25zdCB5YXJkcyA9IE1hdGgucm91bmQobXVsdGlwbGllciAqIHlhcmRzRHJhdy5jYXJkKTtcblxuICBldmVudHMucHVzaCh7XG4gICAgdHlwZTogXCJQTEFZX1JFU09MVkVEXCIsXG4gICAgb2ZmZW5zZVBsYXk6IHN0YXRlLnBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ID8/IFwiU1JcIixcbiAgICBkZWZlbnNlUGxheTogc3RhdGUucGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgPz8gXCJTUlwiLFxuICAgIG1hdGNodXBRdWFsaXR5OiAwLFxuICAgIG11bHRpcGxpZXI6IHsgY2FyZDogbXVsdERyYXcuY2FyZCwgdmFsdWU6IG11bHRpcGxpZXIgfSxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgIHlhcmRzR2FpbmVkOiB5YXJkcyxcbiAgICBuZXdCYWxsT246IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgc3RhdGVBZnRlck11bHQuZmllbGQuYmFsbE9uICsgeWFyZHMpKSxcbiAgfSk7XG5cbiAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoXG4gICAgeyAuLi5zdGF0ZUFmdGVyTXVsdCwgZGVjazogeWFyZHNEcmF3LmRlY2sgfSxcbiAgICB5YXJkcyxcbiAgICBldmVudHMsXG4gICk7XG59XG4iLCAiLyoqXG4gKiBUcmljayBQbGF5IHJlc29sdXRpb24gKHJ1bi5qczoxOTg3KS4gT25lIHBlciBzaHVmZmxlLCBjYWxsZWQgYnkgZWl0aGVyXG4gKiBvZmZlbnNlIG9yIGRlZmVuc2UuIERpZSByb2xsIG91dGNvbWVzIChmcm9tIHRoZSAqY2FsbGVyJ3MqIHBlcnNwZWN0aXZlKTpcbiAqXG4gKiAgIDEgXHUyMTkyIExvbmcgUGFzcyB3aXRoICs1IGJvbnVzICAgKG1hdGNodXAgdXNlcyBMUCB2cyB0aGUgb3RoZXIgc2lkZSdzIHBpY2spXG4gKiAgIDIgXHUyMTkyIDE1LXlhcmQgcGVuYWx0eSBvbiBvcHBvc2luZyBzaWRlIChoYWxmLXRvLWdvYWwgaWYgdGlnaHQpXG4gKiAgIDMgXHUyMTkyIGZpeGVkIC0zeCBtdWx0aXBsaWVyLCBkcmF3IHlhcmRzIGNhcmRcbiAqICAgNCBcdTIxOTIgZml4ZWQgKzR4IG11bHRpcGxpZXIsIGRyYXcgeWFyZHMgY2FyZFxuICogICA1IFx1MjE5MiBCaWcgUGxheSAoYmVuZWZpY2lhcnkgPSBjYWxsZXIpXG4gKiAgIDYgXHUyMTkyIExvbmcgUnVuIHdpdGggKzUgYm9udXNcbiAqXG4gKiBXaGVuIHRoZSBjYWxsZXIgaXMgdGhlIGRlZmVuc2UsIHRoZSB5YXJkYWdlIHNpZ25zIGludmVydCAoZGVmZW5zZSBnYWlucyA9XG4gKiBvZmZlbnNlIGxvc2VzKSwgdGhlIExSL0xQIG92ZXJsYXkgaXMgYXBwbGllZCB0byB0aGUgZGVmZW5zaXZlIGNhbGwsIGFuZFxuICogdGhlIEJpZyBQbGF5IGJlbmVmaWNpYXJ5IGlzIGRlZmVuc2UuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIFBsYXllcklkLCBSZWd1bGFyUGxheSB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgZHJhd011bHRpcGxpZXIsIGRyYXdZYXJkcyB9IGZyb20gXCIuLi9kZWNrLmpzXCI7XG5pbXBvcnQgeyBNVUxUSSwgbWF0Y2h1cFF1YWxpdHkgfSBmcm9tIFwiLi4vbWF0Y2h1cC5qc1wiO1xuaW1wb3J0IHsgcmVzb2x2ZUJpZ1BsYXkgfSBmcm9tIFwiLi9iaWdQbGF5LmpzXCI7XG5pbXBvcnQge1xuICBhcHBseVlhcmRhZ2VPdXRjb21lLFxuICBibGFua1BpY2ssXG4gIHR5cGUgU3BlY2lhbFJlc29sdXRpb24sXG59IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZU9mZmVuc2l2ZVRyaWNrUGxheShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgcm5nOiBSbmcsXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBkaWUgPSBybmcuZDYoKTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW3sgdHlwZTogXCJUUklDS19QTEFZX1JPTExcIiwgb3V0Y29tZTogZGllIH1dO1xuXG4gIC8vIDUgXHUyMTkyIEJpZyBQbGF5IGZvciBvZmZlbnNlIChjYWxsZXIpLlxuICBpZiAoZGllID09PSA1KSB7XG4gICAgY29uc3QgYnAgPSByZXNvbHZlQmlnUGxheShzdGF0ZSwgb2ZmZW5zZSwgcm5nKTtcbiAgICByZXR1cm4geyBzdGF0ZTogYnAuc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4uYnAuZXZlbnRzXSB9O1xuICB9XG5cbiAgLy8gMiBcdTIxOTIgMTUteWFyZCBwZW5hbHR5IG9uIGRlZmVuc2UgKD0gb2ZmZW5zZSBnYWlucyAxNSBvciBoYWxmLXRvLWdvYWwpLlxuICBpZiAoZGllID09PSAyKSB7XG4gICAgY29uc3QgcmF3R2FpbiA9IDE1O1xuICAgIGNvbnN0IGdhaW4gPVxuICAgICAgc3RhdGUuZmllbGQuYmFsbE9uICsgcmF3R2FpbiA+IDk5XG4gICAgICAgID8gTWF0aC50cnVuYygoMTAwIC0gc3RhdGUuZmllbGQuYmFsbE9uKSAvIDIpXG4gICAgICAgIDogcmF3R2FpbjtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiUEVOQUxUWVwiLCBhZ2FpbnN0OiBvcHBvbmVudChvZmZlbnNlKSwgeWFyZHM6IGdhaW4sIGxvc3NPZkRvd246IGZhbHNlIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIC4uLnN0YXRlLmZpZWxkLFxuICAgICAgICAgIGJhbGxPbjogTWF0aC5taW4oMTAwLCBzdGF0ZS5maWVsZC5iYWxsT24gKyBnYWluKSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIDMgb3IgNCBcdTIxOTIgZml4ZWQgbXVsdGlwbGllciwgZHJhdyB5YXJkcyBjYXJkLlxuICBpZiAoZGllID09PSAzIHx8IGRpZSA9PT0gNCkge1xuICAgIGNvbnN0IG11bHRpcGxpZXIgPSBkaWUgPT09IDMgPyAtMyA6IDQ7XG4gICAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKHN0YXRlLmRlY2ssIHJuZyk7XG4gICAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG4gICAgY29uc3QgeWFyZHMgPSBNYXRoLnJvdW5kKG11bHRpcGxpZXIgKiB5YXJkc0RyYXcuY2FyZCk7XG5cbiAgICBldmVudHMucHVzaCh7XG4gICAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICAgIG9mZmVuc2VQbGF5OiBcIlRQXCIsXG4gICAgICBkZWZlbnNlUGxheTogc3RhdGUucGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgPz8gXCJTUlwiLFxuICAgICAgbWF0Y2h1cFF1YWxpdHk6IDAsXG4gICAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IFwiS2luZ1wiLCB2YWx1ZTogbXVsdGlwbGllciB9LFxuICAgICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgICAgIHlhcmRzR2FpbmVkOiB5YXJkcyxcbiAgICAgIG5ld0JhbGxPbjogTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBzdGF0ZS5maWVsZC5iYWxsT24gKyB5YXJkcykpLFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoXG4gICAgICB7IC4uLnN0YXRlLCBkZWNrOiB5YXJkc0RyYXcuZGVjayB9LFxuICAgICAgeWFyZHMsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuXG4gIC8vIDEgb3IgNiBcdTIxOTIgcmVndWxhciBwbGF5IHJlc29sdXRpb24gd2l0aCBmb3JjZWQgb2ZmZW5zZSBwbGF5ICsgYm9udXMuXG4gIGNvbnN0IGZvcmNlZFBsYXk6IFJlZ3VsYXJQbGF5ID0gZGllID09PSAxID8gXCJMUFwiIDogXCJMUlwiO1xuICBjb25zdCBib251cyA9IDU7XG4gIGNvbnN0IGRlZmVuc2VQbGF5ID0gc3RhdGUucGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgPz8gXCJTUlwiO1xuXG4gIC8vIE11c3QgYmUgYSByZWd1bGFyIHBsYXkgZm9yIG1hdGNodXAgdG8gYmUgbWVhbmluZ2Z1bC4gSWYgZGVmZW5zZSBhbHNvIHBpY2tlZFxuICAvLyBzb21ldGhpbmcgd2VpcmQsIGZhbGwgYmFjayB0byBxdWFsaXR5IDMgKG5ldXRyYWwpLlxuICBjb25zdCBkZWZQbGF5ID0gaXNSZWd1bGFyKGRlZmVuc2VQbGF5KSA/IGRlZmVuc2VQbGF5IDogXCJTUlwiO1xuICBjb25zdCBxdWFsaXR5ID0gbWF0Y2h1cFF1YWxpdHkoZm9yY2VkUGxheSwgZGVmUGxheSk7XG5cbiAgY29uc3QgbXVsdERyYXcgPSBkcmF3TXVsdGlwbGllcihzdGF0ZS5kZWNrLCBybmcpO1xuICBpZiAobXVsdERyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJtdWx0aXBsaWVyXCIgfSk7XG4gIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhtdWx0RHJhdy5kZWNrLCBybmcpO1xuICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcblxuICBjb25zdCBtdWx0Um93ID0gTVVMVElbbXVsdERyYXcuaW5kZXhdO1xuICBjb25zdCBtdWx0aXBsaWVyID0gbXVsdFJvdz8uW3F1YWxpdHkgLSAxXSA/PyAwO1xuICBjb25zdCB5YXJkcyA9IE1hdGgucm91bmQobXVsdGlwbGllciAqIHlhcmRzRHJhdy5jYXJkKSArIGJvbnVzO1xuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICBvZmZlbnNlUGxheTogZm9yY2VkUGxheSxcbiAgICBkZWZlbnNlUGxheTogZGVmUGxheSxcbiAgICBtYXRjaHVwUXVhbGl0eTogcXVhbGl0eSxcbiAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IG11bHREcmF3LmNhcmQsIHZhbHVlOiBtdWx0aXBsaWVyIH0sXG4gICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgICB5YXJkc0dhaW5lZDogeWFyZHMsXG4gICAgbmV3QmFsbE9uOiBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHN0YXRlLmZpZWxkLmJhbGxPbiArIHlhcmRzKSksXG4gIH0pO1xuXG4gIHJldHVybiBhcHBseVlhcmRhZ2VPdXRjb21lKFxuICAgIHsgLi4uc3RhdGUsIGRlY2s6IHlhcmRzRHJhdy5kZWNrIH0sXG4gICAgeWFyZHMsXG4gICAgZXZlbnRzLFxuICApO1xufVxuXG5mdW5jdGlvbiBpc1JlZ3VsYXIocDogc3RyaW5nKTogcCBpcyBSZWd1bGFyUGxheSB7XG4gIHJldHVybiBwID09PSBcIlNSXCIgfHwgcCA9PT0gXCJMUlwiIHx8IHAgPT09IFwiU1BcIiB8fCBwID09PSBcIkxQXCI7XG59XG5cbmZ1bmN0aW9uIG9wcG9uZW50KHA6IFBsYXllcklkKTogUGxheWVySWQge1xuICByZXR1cm4gcCA9PT0gMSA/IDIgOiAxO1xufVxuXG4vKipcbiAqIERlZmVuc2UgY2FsbHMgVHJpY2sgUGxheS4gU3ltbWV0cmljIHRvIHRoZSBvZmZlbnNpdmUgdmVyc2lvbiB3aXRoIHRoZVxuICogeWFyZGFnZSBzaWduIGludmVydGVkIG9uIHRoZSBMUi9MUCBhbmQgcGVuYWx0eSBicmFuY2hlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVEZWZlbnNpdmVUcmlja1BsYXkoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHJuZzogUm5nLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgZGVmZW5kZXIgPSBvcHBvbmVudChvZmZlbnNlKTtcbiAgY29uc3QgZGllID0gcm5nLmQ2KCk7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFt7IHR5cGU6IFwiVFJJQ0tfUExBWV9ST0xMXCIsIG91dGNvbWU6IGRpZSB9XTtcblxuICAvLyA1IFx1MjE5MiBCaWcgUGxheSBmb3IgZGVmZW5zZSAoY2FsbGVyKS5cbiAgaWYgKGRpZSA9PT0gNSkge1xuICAgIGNvbnN0IGJwID0gcmVzb2x2ZUJpZ1BsYXkoc3RhdGUsIGRlZmVuZGVyLCBybmcpO1xuICAgIHJldHVybiB7IHN0YXRlOiBicC5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi5icC5ldmVudHNdIH07XG4gIH1cblxuICAvLyAyIFx1MjE5MiAxNS15YXJkIHBlbmFsdHkgb24gb2ZmZW5zZSAoPSBvZmZlbnNlIGxvc2VzIDE1IG9yIGhhbGYtdG8tb3duLWdvYWwpLlxuICBpZiAoZGllID09PSAyKSB7XG4gICAgY29uc3QgcmF3TG9zcyA9IC0xNTtcbiAgICBjb25zdCBsb3NzID1cbiAgICAgIHN0YXRlLmZpZWxkLmJhbGxPbiArIHJhd0xvc3MgPCAxXG4gICAgICAgID8gLU1hdGgudHJ1bmMoc3RhdGUuZmllbGQuYmFsbE9uIC8gMilcbiAgICAgICAgOiByYXdMb3NzO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJQRU5BTFRZXCIsIGFnYWluc3Q6IG9mZmVuc2UsIHlhcmRzOiBsb3NzLCBsb3NzT2ZEb3duOiBmYWxzZSB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBlbmRpbmdQaWNrOiB7IG9mZmVuc2VQbGF5OiBudWxsLCBkZWZlbnNlUGxheTogbnVsbCB9LFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIC4uLnN0YXRlLmZpZWxkLFxuICAgICAgICAgIGJhbGxPbjogTWF0aC5tYXgoMCwgc3RhdGUuZmllbGQuYmFsbE9uICsgbG9zcyksXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyAzIG9yIDQgXHUyMTkyIGZpeGVkIG11bHRpcGxpZXIgd2l0aCB0aGUgKmRlZmVuc2Uncyogc2lnbiBjb252ZW50aW9uLiB2NS4xXG4gIC8vIGFwcGxpZXMgdGhlIHNhbWUgKy8tIG11bHRpcGxpZXJzIGFzIG9mZmVuc2l2ZSBUcmljayBQbGF5OyB0aGUgaW52ZXJzaW9uXG4gIC8vIGlzIGltcGxpY2l0IGluIGRlZmVuc2UgYmVpbmcgdGhlIGNhbGxlci4gWWFyZGFnZSBpcyBmcm9tIG9mZmVuc2UgUE9WLlxuICBpZiAoZGllID09PSAzIHx8IGRpZSA9PT0gNCkge1xuICAgIGNvbnN0IG11bHRpcGxpZXIgPSBkaWUgPT09IDMgPyAtMyA6IDQ7XG4gICAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKHN0YXRlLmRlY2ssIHJuZyk7XG4gICAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG4gICAgY29uc3QgeWFyZHMgPSBNYXRoLnJvdW5kKG11bHRpcGxpZXIgKiB5YXJkc0RyYXcuY2FyZCk7XG5cbiAgICBldmVudHMucHVzaCh7XG4gICAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICAgIG9mZmVuc2VQbGF5OiBzdGF0ZS5wZW5kaW5nUGljay5vZmZlbnNlUGxheSA/PyBcIlNSXCIsXG4gICAgICBkZWZlbnNlUGxheTogXCJUUFwiLFxuICAgICAgbWF0Y2h1cFF1YWxpdHk6IDAsXG4gICAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IFwiS2luZ1wiLCB2YWx1ZTogbXVsdGlwbGllciB9LFxuICAgICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgICAgIHlhcmRzR2FpbmVkOiB5YXJkcyxcbiAgICAgIG5ld0JhbGxPbjogTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBzdGF0ZS5maWVsZC5iYWxsT24gKyB5YXJkcykpLFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoXG4gICAgICB7IC4uLnN0YXRlLCBkZWNrOiB5YXJkc0RyYXcuZGVjayB9LFxuICAgICAgeWFyZHMsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuXG4gIC8vIDEgb3IgNiBcdTIxOTIgZGVmZW5zZSdzIHBpY2sgYmVjb21lcyBMUCAvIExSIHdpdGggLTUgYm9udXMgdG8gb2ZmZW5zZS5cbiAgY29uc3QgZm9yY2VkRGVmUGxheTogUmVndWxhclBsYXkgPSBkaWUgPT09IDEgPyBcIkxQXCIgOiBcIkxSXCI7XG4gIGNvbnN0IGJvbnVzID0gLTU7XG4gIGNvbnN0IG9mZmVuc2VQbGF5ID0gc3RhdGUucGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPz8gXCJTUlwiO1xuICBjb25zdCBvZmZQbGF5ID0gaXNSZWd1bGFyKG9mZmVuc2VQbGF5KSA/IG9mZmVuc2VQbGF5IDogXCJTUlwiO1xuICBjb25zdCBxdWFsaXR5ID0gbWF0Y2h1cFF1YWxpdHkob2ZmUGxheSwgZm9yY2VkRGVmUGxheSk7XG5cbiAgY29uc3QgbXVsdERyYXcgPSBkcmF3TXVsdGlwbGllcihzdGF0ZS5kZWNrLCBybmcpO1xuICBpZiAobXVsdERyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJtdWx0aXBsaWVyXCIgfSk7XG4gIGNvbnN0IHlhcmRzRHJhdyA9IGRyYXdZYXJkcyhtdWx0RHJhdy5kZWNrLCBybmcpO1xuICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcblxuICBjb25zdCBtdWx0Um93ID0gTVVMVElbbXVsdERyYXcuaW5kZXhdO1xuICBjb25zdCBtdWx0aXBsaWVyID0gbXVsdFJvdz8uW3F1YWxpdHkgLSAxXSA/PyAwO1xuICBjb25zdCB5YXJkcyA9IE1hdGgucm91bmQobXVsdGlwbGllciAqIHlhcmRzRHJhdy5jYXJkKSArIGJvbnVzO1xuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICBvZmZlbnNlUGxheTogb2ZmUGxheSxcbiAgICBkZWZlbnNlUGxheTogZm9yY2VkRGVmUGxheSxcbiAgICBtYXRjaHVwUXVhbGl0eTogcXVhbGl0eSxcbiAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IG11bHREcmF3LmNhcmQsIHZhbHVlOiBtdWx0aXBsaWVyIH0sXG4gICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgICB5YXJkc0dhaW5lZDogeWFyZHMsXG4gICAgbmV3QmFsbE9uOiBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHN0YXRlLmZpZWxkLmJhbGxPbiArIHlhcmRzKSksXG4gIH0pO1xuXG4gIHJldHVybiBhcHBseVlhcmRhZ2VPdXRjb21lKFxuICAgIHsgLi4uc3RhdGUsIGRlY2s6IHlhcmRzRHJhdy5kZWNrIH0sXG4gICAgeWFyZHMsXG4gICAgZXZlbnRzLFxuICApO1xufVxuIiwgIi8qKlxuICogRmllbGQgR29hbCAocnVuLmpzOjIwNDApLlxuICpcbiAqIERpc3RhbmNlID0gKDEwMCAtIGJhbGxPbikgKyAxNy4gU28gZnJvbSB0aGUgNTAsIEZHID0gNjcteWFyZCBhdHRlbXB0LlxuICpcbiAqIERpZSByb2xsIGRldGVybWluZXMgc3VjY2VzcyBieSBkaXN0YW5jZSBiYW5kOlxuICogICBkaXN0YW5jZSA+IDY1ICAgICAgICBcdTIxOTIgMS1pbi0xMDAwIGNoYW5jZSAoZWZmZWN0aXZlbHkgYXV0by1taXNzKVxuICogICBkaXN0YW5jZSA+PSA2MCAgICAgICBcdTIxOTIgbmVlZHMgZGllID0gNlxuICogICBkaXN0YW5jZSA+PSA1MCAgICAgICBcdTIxOTIgbmVlZHMgZGllID49IDVcbiAqICAgZGlzdGFuY2UgPj0gNDAgICAgICAgXHUyMTkyIG5lZWRzIGRpZSA+PSA0XG4gKiAgIGRpc3RhbmNlID49IDMwICAgICAgIFx1MjE5MiBuZWVkcyBkaWUgPj0gM1xuICogICBkaXN0YW5jZSA+PSAyMCAgICAgICBcdTIxOTIgbmVlZHMgZGllID49IDJcbiAqICAgZGlzdGFuY2UgPCAgMjAgICAgICAgXHUyMTkyIGF1dG8tbWFrZVxuICpcbiAqIElmIGEgdGltZW91dCB3YXMgY2FsbGVkIGJ5IHRoZSBkZWZlbnNlIGp1c3QgcHJpb3IgKGtpY2tlciBpY2luZyksIGRpZSsrLlxuICpcbiAqIFN1Y2Nlc3MgXHUyMTkyICszIHBvaW50cywga2lja29mZiB0byBvcHBvbmVudC5cbiAqIE1pc3MgICAgXHUyMTkyIHBvc3Nlc3Npb24gZmxpcHMgYXQgdGhlIFNQT1QgT0YgVEhFIEtJQ0sgKG5vdCB0aGUgbGluZSBvZiBzY3JpbW1hZ2UpLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7IGJsYW5rUGljaywgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbiB9IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIEZpZWxkR29hbE9wdGlvbnMge1xuICAvKiogdHJ1ZSBpZiB0aGUgb3Bwb3NpbmcgdGVhbSBjYWxsZWQgYSB0aW1lb3V0IHRoYXQgc2hvdWxkIGljZSB0aGUga2lja2VyLiAqL1xuICBpY2VkPzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVGaWVsZEdvYWwoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHJuZzogUm5nLFxuICBvcHRzOiBGaWVsZEdvYWxPcHRpb25zID0ge30sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBkaXN0YW5jZSA9IDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbiArIDE3O1xuICBjb25zdCByYXdEaWUgPSBybmcuZDYoKTtcbiAgY29uc3QgZGllID0gb3B0cy5pY2VkID8gTWF0aC5taW4oNiwgcmF3RGllICsgMSkgOiByYXdEaWU7XG5cbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG5cbiAgbGV0IG1ha2U6IGJvb2xlYW47XG4gIGlmIChkaXN0YW5jZSA+IDY1KSB7XG4gICAgLy8gRXNzZW50aWFsbHkgaW1wb3NzaWJsZSBcdTIwMTQgcm9sbGVkIDEtMTAwMCwgbWFrZSBvbmx5IG9uIGV4YWN0IGhpdC5cbiAgICBtYWtlID0gcm5nLmludEJldHdlZW4oMSwgMTAwMCkgPT09IGRpc3RhbmNlO1xuICB9IGVsc2UgaWYgKGRpc3RhbmNlID49IDYwKSBtYWtlID0gZGllID49IDY7XG4gIGVsc2UgaWYgKGRpc3RhbmNlID49IDUwKSBtYWtlID0gZGllID49IDU7XG4gIGVsc2UgaWYgKGRpc3RhbmNlID49IDQwKSBtYWtlID0gZGllID49IDQ7XG4gIGVsc2UgaWYgKGRpc3RhbmNlID49IDMwKSBtYWtlID0gZGllID49IDM7XG4gIGVsc2UgaWYgKGRpc3RhbmNlID49IDIwKSBtYWtlID0gZGllID49IDI7XG4gIGVsc2UgbWFrZSA9IHRydWU7XG5cbiAgaWYgKG1ha2UpIHtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiRklFTERfR09BTF9HT09EXCIsIHBsYXllcjogb2ZmZW5zZSB9KTtcbiAgICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgIFtvZmZlbnNlXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLCBzY29yZTogc3RhdGUucGxheWVyc1tvZmZlbnNlXS5zY29yZSArIDMgfSxcbiAgICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIHBoYXNlOiBcIktJQ0tPRkZcIixcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJGSUVMRF9HT0FMX01JU1NFRFwiLCBwbGF5ZXI6IG9mZmVuc2UgfSk7XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwibWlzc2VkX2ZnXCIgfSk7XG5cbiAgLy8gUG9zc2Vzc2lvbiBmbGlwcyBhdCBsaW5lIG9mIHNjcmltbWFnZSAoYmFsbCBzdGF5cyB3aGVyZSBraWNrZWQgZnJvbSkuXG4gIGNvbnN0IGRlZmVuZGVyID0gb3BwKG9mZmVuc2UpO1xuICBjb25zdCBtaXJyb3JlZEJhbGxPbiA9IDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbjtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IG1pcnJvcmVkQmFsbE9uLFxuICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBtaXJyb3JlZEJhbGxPbiArIDEwKSxcbiAgICAgICAgZG93bjogMSxcbiAgICAgICAgb2ZmZW5zZTogZGVmZW5kZXIsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuIiwgIi8qKlxuICogVHdvLVBvaW50IENvbnZlcnNpb24gKFRXT19QVCBwaGFzZSkuXG4gKlxuICogQmFsbCBpcyBwbGFjZWQgYXQgb2ZmZW5zZSdzIDk3ICg9IDMteWFyZCBsaW5lKS4gQSBzaW5nbGUgcmVndWxhciBwbGF5IGlzXG4gKiByZXNvbHZlZC4gSWYgdGhlIHJlc3VsdGluZyB5YXJkYWdlIGNyb3NzZXMgdGhlIGdvYWwgbGluZSwgVFdPX1BPSU5UX0dPT0QuXG4gKiBPdGhlcndpc2UsIFRXT19QT0lOVF9GQUlMRUQuIEVpdGhlciB3YXksIGtpY2tvZmYgZm9sbG93cy5cbiAqXG4gKiBVbmxpa2UgYSBub3JtYWwgcGxheSwgYSAycHQgZG9lcyBOT1QgY2hhbmdlIGRvd24vZGlzdGFuY2UuIEl0J3MgYSBvbmUtc2hvdC5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgUmVndWxhclBsYXkgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IGRyYXdNdWx0aXBsaWVyLCBkcmF3WWFyZHMgfSBmcm9tIFwiLi4vZGVjay5qc1wiO1xuaW1wb3J0IHsgY29tcHV0ZVlhcmRhZ2UgfSBmcm9tIFwiLi4veWFyZGFnZS5qc1wiO1xuaW1wb3J0IHsgYmxhbmtQaWNrLCB0eXBlIFNwZWNpYWxSZXNvbHV0aW9uIH0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlVHdvUG9pbnRDb252ZXJzaW9uKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBvZmZlbnNlUGxheTogUmVndWxhclBsYXksXG4gIGRlZmVuc2VQbGF5OiBSZWd1bGFyUGxheSxcbiAgcm5nOiBSbmcsXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcblxuICBjb25zdCBtdWx0RHJhdyA9IGRyYXdNdWx0aXBsaWVyKHN0YXRlLmRlY2ssIHJuZyk7XG4gIGlmIChtdWx0RHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcIm11bHRpcGxpZXJcIiB9KTtcbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKG11bHREcmF3LmRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuXG4gIGNvbnN0IG91dGNvbWUgPSBjb21wdXRlWWFyZGFnZSh7XG4gICAgb2ZmZW5zZTogb2ZmZW5zZVBsYXksXG4gICAgZGVmZW5zZTogZGVmZW5zZVBsYXksXG4gICAgbXVsdGlwbGllckNhcmQ6IG11bHREcmF3LmluZGV4LFxuICAgIHlhcmRzQ2FyZDogeWFyZHNEcmF3LmNhcmQsXG4gIH0pO1xuXG4gIC8vIDJwdCBzdGFydHMgYXQgOTcuIENyb3NzaW5nIHRoZSBnb2FsID0gZ29vZC5cbiAgY29uc3Qgc3RhcnRCYWxsT24gPSA5NztcbiAgY29uc3QgcHJvamVjdGVkID0gc3RhcnRCYWxsT24gKyBvdXRjb21lLnlhcmRzR2FpbmVkO1xuICBjb25zdCBnb29kID0gcHJvamVjdGVkID49IDEwMDtcblxuICBldmVudHMucHVzaCh7XG4gICAgdHlwZTogXCJQTEFZX1JFU09MVkVEXCIsXG4gICAgb2ZmZW5zZVBsYXksXG4gICAgZGVmZW5zZVBsYXksXG4gICAgbWF0Y2h1cFF1YWxpdHk6IG91dGNvbWUubWF0Y2h1cFF1YWxpdHksXG4gICAgbXVsdGlwbGllcjogeyBjYXJkOiBvdXRjb21lLm11bHRpcGxpZXJDYXJkTmFtZSwgdmFsdWU6IG91dGNvbWUubXVsdGlwbGllciB9LFxuICAgIHlhcmRzQ2FyZDogeWFyZHNEcmF3LmNhcmQsXG4gICAgeWFyZHNHYWluZWQ6IG91dGNvbWUueWFyZHNHYWluZWQsXG4gICAgbmV3QmFsbE9uOiBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHByb2plY3RlZCkpLFxuICB9KTtcblxuICBjb25zdCBuZXdQbGF5ZXJzID0gZ29vZFxuICAgID8gKHtcbiAgICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgICAgW29mZmVuc2VdOiB7IC4uLnN0YXRlLnBsYXllcnNbb2ZmZW5zZV0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLnNjb3JlICsgMiB9LFxuICAgICAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdKVxuICAgIDogc3RhdGUucGxheWVycztcblxuICBldmVudHMucHVzaCh7XG4gICAgdHlwZTogZ29vZCA/IFwiVFdPX1BPSU5UX0dPT0RcIiA6IFwiVFdPX1BPSU5UX0ZBSUxFRFwiLFxuICAgIHBsYXllcjogb2ZmZW5zZSxcbiAgfSk7XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBkZWNrOiB5YXJkc0RyYXcuZGVjayxcbiAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBwaGFzZTogXCJLSUNLT0ZGXCIsXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBPdmVydGltZSBtZWNoYW5pY3MuXG4gKlxuICogQ29sbGVnZS1mb290YmFsbCBzdHlsZTpcbiAqICAgLSBFYWNoIHBlcmlvZDogZWFjaCB0ZWFtIGdldHMgb25lIHBvc3Nlc3Npb24gZnJvbSB0aGUgb3Bwb25lbnQncyAyNVxuICogICAgIChvZmZlbnNlIFBPVjogYmFsbE9uID0gNzUpLlxuICogICAtIEEgcG9zc2Vzc2lvbiBlbmRzIHdpdGg6IFREIChmb2xsb3dlZCBieSBQQVQvMnB0KSwgRkcgKG1hZGUgb3IgbWlzc2VkKSxcbiAqICAgICB0dXJub3ZlciwgdHVybm92ZXItb24tZG93bnMsIG9yIHNhZmV0eS5cbiAqICAgLSBBZnRlciBib3RoIHBvc3Nlc3Npb25zLCBpZiBzY29yZXMgZGlmZmVyIFx1MjE5MiBHQU1FX09WRVIuIElmIHRpZWQgXHUyMTkyIG5leHRcbiAqICAgICBwZXJpb2QuXG4gKiAgIC0gUGVyaW9kcyBhbHRlcm5hdGUgd2hvIHBvc3Nlc3NlcyBmaXJzdC5cbiAqICAgLSBQZXJpb2QgMys6IDItcG9pbnQgY29udmVyc2lvbiBtYW5kYXRvcnkgYWZ0ZXIgYSBURCAobm8gUEFUIGtpY2spLlxuICogICAtIEhhaWwgTWFyeXM6IDIgcGVyIHBlcmlvZCwgcmVmaWxsZWQgYXQgc3RhcnQgb2YgZWFjaCBwZXJpb2QuXG4gKiAgIC0gVGltZW91dHM6IDEgcGVyIHBhaXIgb2YgcGVyaW9kcy5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIE92ZXJ0aW1lU3RhdGUsIFBsYXllcklkIH0gZnJvbSBcIi4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBlbXB0eUhhbmQsIG9wcCB9IGZyb20gXCIuLi9zdGF0ZS5qc1wiO1xuaW1wb3J0IHsgZnJlc2hEZWNrTXVsdGlwbGllcnMsIGZyZXNoRGVja1lhcmRzIH0gZnJvbSBcIi4uL3N0YXRlLmpzXCI7XG5cbmNvbnN0IE9UX0JBTExfT04gPSA3NTsgLy8gb3Bwb25lbnQncyAyNS15YXJkIGxpbmUsIGZyb20gb2ZmZW5zZSBQT1ZcblxuLyoqXG4gKiBJbml0aWFsaXplIE9UIHN0YXRlLCByZWZyZXNoIGRlY2tzL2hhbmRzLCBzZXQgYmFsbCBhdCB0aGUgMjUuXG4gKiBDYWxsZWQgb25jZSB0aWVkIHJlZ3VsYXRpb24gZW5kcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0YXJ0T3ZlcnRpbWUoc3RhdGU6IEdhbWVTdGF0ZSk6IHsgc3RhdGU6IEdhbWVTdGF0ZTsgZXZlbnRzOiBFdmVudFtdIH0ge1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcbiAgY29uc3QgZmlyc3RSZWNlaXZlcjogUGxheWVySWQgPSBzdGF0ZS5vcGVuaW5nUmVjZWl2ZXIgPT09IDEgPyAyIDogMTtcbiAgY29uc3Qgb3ZlcnRpbWU6IE92ZXJ0aW1lU3RhdGUgPSB7XG4gICAgcGVyaW9kOiAxLFxuICAgIHBvc3Nlc3Npb246IGZpcnN0UmVjZWl2ZXIsXG4gICAgZmlyc3RSZWNlaXZlcixcbiAgICBwb3NzZXNzaW9uc1JlbWFpbmluZzogMixcbiAgfTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIk9WRVJUSU1FX1NUQVJURURcIiwgcGVyaW9kOiAxLCBwb3NzZXNzaW9uOiBmaXJzdFJlY2VpdmVyIH0pO1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBoYXNlOiBcIk9UX1NUQVJUXCIsXG4gICAgICBvdmVydGltZSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuLyoqIEJlZ2luIChvciByZXN1bWUpIHRoZSBuZXh0IE9UIHBvc3Nlc3Npb24uICovXG5leHBvcnQgZnVuY3Rpb24gc3RhcnRPdmVydGltZVBvc3Nlc3Npb24oc3RhdGU6IEdhbWVTdGF0ZSk6IHsgc3RhdGU6IEdhbWVTdGF0ZTsgZXZlbnRzOiBFdmVudFtdIH0ge1xuICBpZiAoIXN0YXRlLm92ZXJ0aW1lKSByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuXG4gIGNvbnN0IHBvc3Nlc3Npb24gPSBzdGF0ZS5vdmVydGltZS5wb3NzZXNzaW9uO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcblxuICAvLyBSZWZpbGwgSE0gY291bnQgZm9yIHRoZSBwb3NzZXNzaW9uJ3Mgb2ZmZW5zZSAobWF0Y2hlcyB2NS4xOiBITSByZXNldHNcbiAgLy8gcGVyIE9UIHBlcmlvZCkuIFBlcmlvZCAzKyBwbGF5ZXJzIGhhdmUgb25seSAyIEhNcyBhbnl3YXkuXG4gIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgLi4uc3RhdGUucGxheWVycyxcbiAgICBbcG9zc2Vzc2lvbl06IHtcbiAgICAgIC4uLnN0YXRlLnBsYXllcnNbcG9zc2Vzc2lvbl0sXG4gICAgICBoYW5kOiB7IC4uLnN0YXRlLnBsYXllcnNbcG9zc2Vzc2lvbl0uaGFuZCwgSE06IHN0YXRlLm92ZXJ0aW1lLnBlcmlvZCA+PSAzID8gMiA6IDIgfSxcbiAgICB9LFxuICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgcGhhc2U6IFwiT1RfUExBWVwiLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgYmFsbE9uOiBPVF9CQUxMX09OLFxuICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBPVF9CQUxMX09OICsgMTApLFxuICAgICAgICBkb3duOiAxLFxuICAgICAgICBvZmZlbnNlOiBwb3NzZXNzaW9uLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuLyoqXG4gKiBFbmQgdGhlIGN1cnJlbnQgT1QgcG9zc2Vzc2lvbi4gRGVjcmVtZW50cyBwb3NzZXNzaW9uc1JlbWFpbmluZzsgaWYgMCxcbiAqIGNoZWNrcyBmb3IgZ2FtZSBlbmQuIE90aGVyd2lzZSBmbGlwcyBwb3NzZXNzaW9uLlxuICpcbiAqIENhbGxlciBpcyByZXNwb25zaWJsZSBmb3IgZGV0ZWN0aW5nIFwidGhpcyB3YXMgYSBwb3NzZXNzaW9uLWVuZGluZyBldmVudFwiXG4gKiAoVEQrUEFULCBGRyBkZWNpc2lvbiwgdHVybm92ZXIsIGV0YykuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbmRPdmVydGltZVBvc3Nlc3Npb24oc3RhdGU6IEdhbWVTdGF0ZSk6IHsgc3RhdGU6IEdhbWVTdGF0ZTsgZXZlbnRzOiBFdmVudFtdIH0ge1xuICBpZiAoIXN0YXRlLm92ZXJ0aW1lKSByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuXG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuICBjb25zdCByZW1haW5pbmcgPSBzdGF0ZS5vdmVydGltZS5wb3NzZXNzaW9uc1JlbWFpbmluZztcblxuICBpZiAocmVtYWluaW5nID09PSAyKSB7XG4gICAgLy8gRmlyc3QgcG9zc2Vzc2lvbiBlbmRlZC4gRmxpcCB0byBzZWNvbmQgdGVhbSwgZnJlc2ggYmFsbC5cbiAgICBjb25zdCBuZXh0UG9zc2Vzc2lvbiA9IG9wcChzdGF0ZS5vdmVydGltZS5wb3NzZXNzaW9uKTtcbiAgICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgIFtuZXh0UG9zc2Vzc2lvbl06IHtcbiAgICAgICAgLi4uc3RhdGUucGxheWVyc1tuZXh0UG9zc2Vzc2lvbl0sXG4gICAgICAgIGhhbmQ6IHsgLi4uc3RhdGUucGxheWVyc1tuZXh0UG9zc2Vzc2lvbl0uaGFuZCwgSE06IDIgfSxcbiAgICAgIH0sXG4gICAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgICAgcGhhc2U6IFwiT1RfUExBWVwiLFxuICAgICAgICBvdmVydGltZTogeyAuLi5zdGF0ZS5vdmVydGltZSwgcG9zc2Vzc2lvbjogbmV4dFBvc3Nlc3Npb24sIHBvc3Nlc3Npb25zUmVtYWluaW5nOiAxIH0sXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgYmFsbE9uOiBPVF9CQUxMX09OLFxuICAgICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIE9UX0JBTExfT04gKyAxMCksXG4gICAgICAgICAgZG93bjogMSxcbiAgICAgICAgICBvZmZlbnNlOiBuZXh0UG9zc2Vzc2lvbixcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIFNlY29uZCBwb3NzZXNzaW9uIGVuZGVkLiBDb21wYXJlIHNjb3Jlcy5cbiAgY29uc3QgcDEgPSBzdGF0ZS5wbGF5ZXJzWzFdLnNjb3JlO1xuICBjb25zdCBwMiA9IHN0YXRlLnBsYXllcnNbMl0uc2NvcmU7XG4gIGlmIChwMSAhPT0gcDIpIHtcbiAgICBjb25zdCB3aW5uZXI6IFBsYXllcklkID0gcDEgPiBwMiA/IDEgOiAyO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJHQU1FX09WRVJcIiwgd2lubmVyIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGhhc2U6IFwiR0FNRV9PVkVSXCIsXG4gICAgICAgIG92ZXJ0aW1lOiB7IC4uLnN0YXRlLm92ZXJ0aW1lLCBwb3NzZXNzaW9uc1JlbWFpbmluZzogMCB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gVGllZCBcdTIwMTQgc3RhcnQgbmV4dCBwZXJpb2QuIEFsdGVybmF0ZXMgZmlyc3QtcG9zc2Vzc29yLlxuICBjb25zdCBuZXh0UGVyaW9kID0gc3RhdGUub3ZlcnRpbWUucGVyaW9kICsgMTtcbiAgY29uc3QgbmV4dEZpcnN0ID0gb3BwKHN0YXRlLm92ZXJ0aW1lLmZpcnN0UmVjZWl2ZXIpO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiT1ZFUlRJTUVfU1RBUlRFRFwiLCBwZXJpb2Q6IG5leHRQZXJpb2QsIHBvc3Nlc3Npb246IG5leHRGaXJzdCB9KTtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwaGFzZTogXCJPVF9TVEFSVFwiLFxuICAgICAgb3ZlcnRpbWU6IHtcbiAgICAgICAgcGVyaW9kOiBuZXh0UGVyaW9kLFxuICAgICAgICBwb3NzZXNzaW9uOiBuZXh0Rmlyc3QsXG4gICAgICAgIGZpcnN0UmVjZWl2ZXI6IG5leHRGaXJzdCxcbiAgICAgICAgcG9zc2Vzc2lvbnNSZW1haW5pbmc6IDIsXG4gICAgICB9LFxuICAgICAgLy8gRnJlc2ggZGVja3MgZm9yIHRoZSBuZXcgcGVyaW9kLlxuICAgICAgZGVjazogeyBtdWx0aXBsaWVyczogZnJlc2hEZWNrTXVsdGlwbGllcnMoKSwgeWFyZHM6IGZyZXNoRGVja1lhcmRzKCkgfSxcbiAgICAgIHBsYXllcnM6IHtcbiAgICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgICAgMTogeyAuLi5zdGF0ZS5wbGF5ZXJzWzFdLCBoYW5kOiBlbXB0eUhhbmQodHJ1ZSkgfSxcbiAgICAgICAgMjogeyAuLi5zdGF0ZS5wbGF5ZXJzWzJdLCBoYW5kOiBlbXB0eUhhbmQodHJ1ZSkgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbi8qKlxuICogRGV0ZWN0IHdoZXRoZXIgYSBzZXF1ZW5jZSBvZiBldmVudHMgZnJvbSBhIHBsYXkgcmVzb2x1dGlvbiBzaG91bGQgZW5kXG4gKiB0aGUgY3VycmVudCBPVCBwb3NzZXNzaW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNQb3NzZXNzaW9uRW5kaW5nSW5PVChldmVudHM6IFJlYWRvbmx5QXJyYXk8RXZlbnQ+KTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgZSBvZiBldmVudHMpIHtcbiAgICBzd2l0Y2ggKGUudHlwZSkge1xuICAgICAgY2FzZSBcIlBBVF9HT09EXCI6XG4gICAgICBjYXNlIFwiVFdPX1BPSU5UX0dPT0RcIjpcbiAgICAgIGNhc2UgXCJUV09fUE9JTlRfRkFJTEVEXCI6XG4gICAgICBjYXNlIFwiRklFTERfR09BTF9HT09EXCI6XG4gICAgICBjYXNlIFwiRklFTERfR09BTF9NSVNTRURcIjpcbiAgICAgIGNhc2UgXCJUVVJOT1ZFUlwiOlxuICAgICAgY2FzZSBcIlRVUk5PVkVSX09OX0RPV05TXCI6XG4gICAgICBjYXNlIFwiU0FGRVRZXCI6XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG4iLCAiLyoqXG4gKiBUaGUgc2luZ2xlIHRyYW5zaXRpb24gZnVuY3Rpb24uIFRha2VzIChzdGF0ZSwgYWN0aW9uLCBybmcpIGFuZCByZXR1cm5zXG4gKiBhIG5ldyBzdGF0ZSBwbHVzIHRoZSBldmVudHMgdGhhdCBkZXNjcmliZSB3aGF0IGhhcHBlbmVkLlxuICpcbiAqIFRoaXMgZmlsZSBpcyB0aGUgKnNrZWxldG9uKiBcdTIwMTQgdGhlIGRpc3BhdGNoIHNoYXBlIGlzIGhlcmUsIHRoZSBjYXNlcyBhcmVcbiAqIG1vc3RseSBzdHVicyBtYXJrZWQgYC8vIFRPRE86IHBvcnQgZnJvbSBydW4uanNgLiBBcyB3ZSBwb3J0LCBlYWNoIGNhc2VcbiAqIGdldHMgdW5pdC10ZXN0ZWQuIFdoZW4gZXZlcnkgY2FzZSBpcyBpbXBsZW1lbnRlZCBhbmQgdGVzdGVkLCB2NS4xJ3MgcnVuLmpzXG4gKiBjYW4gYmUgZGVsZXRlZC5cbiAqXG4gKiBSdWxlcyBmb3IgdGhpcyBmaWxlOlxuICogICAxLiBORVZFUiBpbXBvcnQgZnJvbSBET00sIG5ldHdvcmssIG9yIGFuaW1hdGlvbiBtb2R1bGVzLlxuICogICAyLiBORVZFUiBtdXRhdGUgYHN0YXRlYCBcdTIwMTQgYWx3YXlzIHJldHVybiBhIG5ldyBvYmplY3QuXG4gKiAgIDMuIE5FVkVSIGNhbGwgTWF0aC5yYW5kb20gXHUyMDE0IHVzZSB0aGUgYHJuZ2AgcGFyYW1ldGVyLlxuICogICA0LiBORVZFUiB0aHJvdyBvbiBpbnZhbGlkIGFjdGlvbnMgXHUyMDE0IHJldHVybiBgeyBzdGF0ZSwgZXZlbnRzOiBbXSB9YFxuICogICAgICBhbmQgbGV0IHRoZSBjYWxsZXIgZGVjaWRlLiAoVmFsaWRhdGlvbiBpcyB0aGUgc2VydmVyJ3Mgam9iLilcbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEFjdGlvbiB9IGZyb20gXCIuL2FjdGlvbnMuanNcIjtcbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlIH0gZnJvbSBcIi4vdHlwZXMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4vcm5nLmpzXCI7XG5pbXBvcnQgeyBpc1JlZ3VsYXJQbGF5LCByZXNvbHZlUmVndWxhclBsYXkgfSBmcm9tIFwiLi9ydWxlcy9wbGF5LmpzXCI7XG5pbXBvcnQge1xuICByZXNvbHZlRGVmZW5zaXZlVHJpY2tQbGF5LFxuICByZXNvbHZlRmllbGRHb2FsLFxuICByZXNvbHZlSGFpbE1hcnksXG4gIHJlc29sdmVLaWNrb2ZmLFxuICByZXNvbHZlT2ZmZW5zaXZlVHJpY2tQbGF5LFxuICByZXNvbHZlUHVudCxcbiAgcmVzb2x2ZVNhbWVQbGF5LFxufSBmcm9tIFwiLi9ydWxlcy9zcGVjaWFscy9pbmRleC5qc1wiO1xuaW1wb3J0IHtcbiAgZW5kT3ZlcnRpbWVQb3NzZXNzaW9uLFxuICBpc1Bvc3Nlc3Npb25FbmRpbmdJbk9ULFxuICBzdGFydE92ZXJ0aW1lLFxuICBzdGFydE92ZXJ0aW1lUG9zc2Vzc2lvbixcbn0gZnJvbSBcIi4vcnVsZXMvb3ZlcnRpbWUuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuL3N0YXRlLmpzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVkdWNlUmVzdWx0IHtcbiAgc3RhdGU6IEdhbWVTdGF0ZTtcbiAgZXZlbnRzOiBFdmVudFtdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVkdWNlKHN0YXRlOiBHYW1lU3RhdGUsIGFjdGlvbjogQWN0aW9uLCBybmc6IFJuZyk6IFJlZHVjZVJlc3VsdCB7XG4gIGNvbnN0IHJlc3VsdCA9IHJlZHVjZUNvcmUoc3RhdGUsIGFjdGlvbiwgcm5nKTtcbiAgcmV0dXJuIGFwcGx5T3ZlcnRpbWVSb3V0aW5nKHN0YXRlLCByZXN1bHQpO1xufVxuXG4vKipcbiAqIElmIHdlJ3JlIGluIE9UIGFuZCBhIHBvc3Nlc3Npb24tZW5kaW5nIGV2ZW50IGp1c3QgZmlyZWQsIHJvdXRlIHRvIHRoZVxuICogbmV4dCBPVCBwb3NzZXNzaW9uIChvciBnYW1lIGVuZCkuIFNraXBzIHdoZW4gdGhlIGFjdGlvbiBpcyBpdHNlbGYgYW4gT1RcbiAqIGhlbHBlciAoc28gd2UgZG9uJ3QgZG91YmxlLXJvdXRlKS5cbiAqL1xuZnVuY3Rpb24gYXBwbHlPdmVydGltZVJvdXRpbmcocHJldlN0YXRlOiBHYW1lU3RhdGUsIHJlc3VsdDogUmVkdWNlUmVzdWx0KTogUmVkdWNlUmVzdWx0IHtcbiAgLy8gT25seSBjb25zaWRlciByb3V0aW5nIHdoZW4gd2UgKndlcmUqIGluIE9ULiAoc3RhcnRPdmVydGltZSBzZXRzIHN0YXRlLm92ZXJ0aW1lLilcbiAgaWYgKCFwcmV2U3RhdGUub3ZlcnRpbWUgJiYgIXJlc3VsdC5zdGF0ZS5vdmVydGltZSkgcmV0dXJuIHJlc3VsdDtcbiAgaWYgKCFyZXN1bHQuc3RhdGUub3ZlcnRpbWUpIHJldHVybiByZXN1bHQ7XG4gIGlmICghaXNQb3NzZXNzaW9uRW5kaW5nSW5PVChyZXN1bHQuZXZlbnRzKSkgcmV0dXJuIHJlc3VsdDtcblxuICAvLyBQQVQgaW4gT1Q6IGEgVEQgc2NvcmVkLCBidXQgcG9zc2Vzc2lvbiBkb2Vzbid0IGVuZCB1bnRpbCBQQVQvMnB0IHJlc29sdmVzLlxuICAvLyBQQVRfR09PRCAvIFRXT19QT0lOVF8qIGFyZSB0aGVtc2VsdmVzIHBvc3Nlc3Npb24tZW5kaW5nLCBzbyB0aGV5IERPIHJvdXRlLlxuICAvLyBBZnRlciBwb3NzZXNzaW9uIGVuZHMsIGRlY2lkZSBuZXh0LlxuICBjb25zdCBlbmRlZCA9IGVuZE92ZXJ0aW1lUG9zc2Vzc2lvbihyZXN1bHQuc3RhdGUpO1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiBlbmRlZC5zdGF0ZSxcbiAgICBldmVudHM6IFsuLi5yZXN1bHQuZXZlbnRzLCAuLi5lbmRlZC5ldmVudHNdLFxuICB9O1xufVxuXG5mdW5jdGlvbiByZWR1Y2VDb3JlKHN0YXRlOiBHYW1lU3RhdGUsIGFjdGlvbjogQWN0aW9uLCBybmc6IFJuZyk6IFJlZHVjZVJlc3VsdCB7XG4gIHN3aXRjaCAoYWN0aW9uLnR5cGUpIHtcbiAgICBjYXNlIFwiU1RBUlRfR0FNRVwiOlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGU6IHtcbiAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICBwaGFzZTogXCJDT0lOX1RPU1NcIixcbiAgICAgICAgICBjbG9jazoge1xuICAgICAgICAgICAgLi4uc3RhdGUuY2xvY2ssXG4gICAgICAgICAgICBxdWFydGVyOiAxLFxuICAgICAgICAgICAgcXVhcnRlckxlbmd0aE1pbnV0ZXM6IGFjdGlvbi5xdWFydGVyTGVuZ3RoTWludXRlcyxcbiAgICAgICAgICAgIHNlY29uZHNSZW1haW5pbmc6IGFjdGlvbi5xdWFydGVyTGVuZ3RoTWludXRlcyAqIDYwLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgcGxheWVyczoge1xuICAgICAgICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgICAgICAgIDE6IHsgLi4uc3RhdGUucGxheWVyc1sxXSwgdGVhbTogeyBpZDogYWN0aW9uLnRlYW1zWzFdIH0gfSxcbiAgICAgICAgICAgIDI6IHsgLi4uc3RhdGUucGxheWVyc1syXSwgdGVhbTogeyBpZDogYWN0aW9uLnRlYW1zWzJdIH0gfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBldmVudHM6IFt7IHR5cGU6IFwiR0FNRV9TVEFSVEVEXCIgfV0sXG4gICAgICB9O1xuXG4gICAgY2FzZSBcIkNPSU5fVE9TU19DQUxMXCI6IHtcbiAgICAgIGNvbnN0IGFjdHVhbCA9IHJuZy5jb2luRmxpcCgpO1xuICAgICAgY29uc3Qgd2lubmVyID0gYWN0aW9uLmNhbGwgPT09IGFjdHVhbCA/IGFjdGlvbi5wbGF5ZXIgOiBvcHAoYWN0aW9uLnBsYXllcik7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0ZSxcbiAgICAgICAgZXZlbnRzOiBbeyB0eXBlOiBcIkNPSU5fVE9TU19SRVNVTFRcIiwgcmVzdWx0OiBhY3R1YWwsIHdpbm5lciB9XSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIlJFQ0VJVkVfQ0hPSUNFXCI6IHtcbiAgICAgIC8vIFRoZSBjYWxsZXIncyBjaG9pY2UgZGV0ZXJtaW5lcyB3aG8gcmVjZWl2ZXMgdGhlIG9wZW5pbmcga2lja29mZi5cbiAgICAgIC8vIFwicmVjZWl2ZVwiIFx1MjE5MiBjYWxsZXIgcmVjZWl2ZXM7IFwiZGVmZXJcIiBcdTIxOTIgY2FsbGVyIGtpY2tzIChvcHBvbmVudCByZWNlaXZlcykuXG4gICAgICBjb25zdCByZWNlaXZlciA9IGFjdGlvbi5jaG9pY2UgPT09IFwicmVjZWl2ZVwiID8gYWN0aW9uLnBsYXllciA6IG9wcChhY3Rpb24ucGxheWVyKTtcbiAgICAgIC8vIEtpY2tlciBpcyB0aGUgb3BlbmluZyBvZmZlbnNlICh0aGV5IGtpY2sgb2ZmKTsgcmVjZWl2ZXIgZ2V0cyB0aGUgYmFsbCBhZnRlci5cbiAgICAgIGNvbnN0IGtpY2tlciA9IG9wcChyZWNlaXZlcik7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0ZToge1xuICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgIHBoYXNlOiBcIktJQ0tPRkZcIixcbiAgICAgICAgICBvcGVuaW5nUmVjZWl2ZXI6IHJlY2VpdmVyLFxuICAgICAgICAgIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiBraWNrZXIgfSxcbiAgICAgICAgfSxcbiAgICAgICAgZXZlbnRzOiBbeyB0eXBlOiBcIktJQ0tPRkZcIiwgcmVjZWl2aW5nUGxheWVyOiByZWNlaXZlciwgYmFsbE9uOiAzNSB9XSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIlJFU09MVkVfS0lDS09GRlwiOiB7XG4gICAgICBjb25zdCByZXN1bHQgPSByZXNvbHZlS2lja29mZihzdGF0ZSwgcm5nKTtcbiAgICAgIHJldHVybiB7IHN0YXRlOiByZXN1bHQuc3RhdGUsIGV2ZW50czogcmVzdWx0LmV2ZW50cyB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJTVEFSVF9PVF9QT1NTRVNTSU9OXCI6IHtcbiAgICAgIGNvbnN0IHIgPSBzdGFydE92ZXJ0aW1lUG9zc2Vzc2lvbihzdGF0ZSk7XG4gICAgICByZXR1cm4geyBzdGF0ZTogci5zdGF0ZSwgZXZlbnRzOiByLmV2ZW50cyB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJQSUNLX1BMQVlcIjoge1xuICAgICAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gICAgICBjb25zdCBpc09mZmVuc2l2ZUNhbGwgPSBhY3Rpb24ucGxheWVyID09PSBvZmZlbnNlO1xuXG4gICAgICAvLyBWYWxpZGF0ZS4gSWxsZWdhbCBwaWNrcyBhcmUgc2lsZW50bHkgbm8tb3AnZDsgdGhlIG9yY2hlc3RyYXRvclxuICAgICAgLy8gKHNlcnZlciAvIFVJKSBpcyByZXNwb25zaWJsZSBmb3Igc3VyZmFjaW5nIHRoZSBlcnJvciB0byB0aGUgdXNlci5cbiAgICAgIGlmIChhY3Rpb24ucGxheSA9PT0gXCJGR1wiIHx8IGFjdGlvbi5wbGF5ID09PSBcIlBVTlRcIiB8fCBhY3Rpb24ucGxheSA9PT0gXCJUV09fUFRcIikge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9OyAvLyB3cm9uZyBhY3Rpb24gdHlwZSBmb3IgdGhlc2VcbiAgICAgIH1cbiAgICAgIGlmIChhY3Rpb24ucGxheSA9PT0gXCJITVwiICYmICFpc09mZmVuc2l2ZUNhbGwpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTsgLy8gZGVmZW5zZSBjYW4ndCBjYWxsIEhhaWwgTWFyeVxuICAgICAgfVxuICAgICAgY29uc3QgaGFuZCA9IHN0YXRlLnBsYXllcnNbYWN0aW9uLnBsYXllcl0uaGFuZDtcbiAgICAgIGlmIChhY3Rpb24ucGxheSA9PT0gXCJITVwiICYmIGhhbmQuSE0gPD0gMCkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgfVxuICAgICAgaWYgKFxuICAgICAgICAoYWN0aW9uLnBsYXkgPT09IFwiU1JcIiB8fCBhY3Rpb24ucGxheSA9PT0gXCJMUlwiIHx8IGFjdGlvbi5wbGF5ID09PSBcIlNQXCIgfHwgYWN0aW9uLnBsYXkgPT09IFwiTFBcIiB8fCBhY3Rpb24ucGxheSA9PT0gXCJUUFwiKSAmJlxuICAgICAgICBoYW5kW2FjdGlvbi5wbGF5XSA8PSAwXG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcbiAgICAgIH1cbiAgICAgIC8vIFJlamVjdCByZS1waWNrcyBmb3IgdGhlIHNhbWUgc2lkZSBpbiB0aGUgc2FtZSBwbGF5LlxuICAgICAgaWYgKGlzT2ZmZW5zaXZlQ2FsbCAmJiBzdGF0ZS5wZW5kaW5nUGljay5vZmZlbnNlUGxheSkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgfVxuICAgICAgaWYgKCFpc09mZmVuc2l2ZUNhbGwgJiYgc3RhdGUucGVuZGluZ1BpY2suZGVmZW5zZVBsYXkpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW1xuICAgICAgICB7IHR5cGU6IFwiUExBWV9DQUxMRURcIiwgcGxheWVyOiBhY3Rpb24ucGxheWVyLCBwbGF5OiBhY3Rpb24ucGxheSB9LFxuICAgICAgXTtcblxuICAgICAgY29uc3QgcGVuZGluZ1BpY2sgPSB7XG4gICAgICAgIG9mZmVuc2VQbGF5OiBpc09mZmVuc2l2ZUNhbGwgPyBhY3Rpb24ucGxheSA6IHN0YXRlLnBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5LFxuICAgICAgICBkZWZlbnNlUGxheTogaXNPZmZlbnNpdmVDYWxsID8gc3RhdGUucGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgOiBhY3Rpb24ucGxheSxcbiAgICAgIH07XG5cbiAgICAgIC8vIEJvdGggdGVhbXMgaGF2ZSBwaWNrZWQgXHUyMDE0IHJlc29sdmUuXG4gICAgICBpZiAocGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgJiYgcGVuZGluZ1BpY2suZGVmZW5zZVBsYXkpIHtcbiAgICAgICAgY29uc3Qgc3RhdGVXaXRoUGljazogR2FtZVN0YXRlID0geyAuLi5zdGF0ZSwgcGVuZGluZ1BpY2sgfTtcblxuICAgICAgICAvLyBIYWlsIE1hcnkgYnkgb2ZmZW5zZSBcdTIwMTQgcmVzb2x2ZXMgaW1tZWRpYXRlbHksIGRlZmVuc2UgcGljayBpZ25vcmVkLlxuICAgICAgICBpZiAocGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPT09IFwiSE1cIikge1xuICAgICAgICAgIGNvbnN0IGhtID0gcmVzb2x2ZUhhaWxNYXJ5KHN0YXRlV2l0aFBpY2ssIHJuZyk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IGhtLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLmhtLmV2ZW50c10gfTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFRyaWNrIFBsYXkgYnkgZWl0aGVyIHNpZGUuIHY1LjEgKHJ1bi5qczoxODg2KTogaWYgYm90aCBwaWNrIFRQLFxuICAgICAgICAvLyBTYW1lIFBsYXkgY29pbiBhbHdheXMgdHJpZ2dlcnMgXHUyMDE0IGZhbGxzIHRocm91Z2ggdG8gU2FtZSBQbGF5IGJlbG93LlxuICAgICAgICBpZiAoXG4gICAgICAgICAgcGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPT09IFwiVFBcIiAmJlxuICAgICAgICAgIHBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5ICE9PSBcIlRQXCJcbiAgICAgICAgKSB7XG4gICAgICAgICAgY29uc3QgdHAgPSByZXNvbHZlT2ZmZW5zaXZlVHJpY2tQbGF5KHN0YXRlV2l0aFBpY2ssIHJuZyk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHRwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLnRwLmV2ZW50c10gfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoXG4gICAgICAgICAgcGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgPT09IFwiVFBcIiAmJlxuICAgICAgICAgIHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ICE9PSBcIlRQXCJcbiAgICAgICAgKSB7XG4gICAgICAgICAgY29uc3QgdHAgPSByZXNvbHZlRGVmZW5zaXZlVHJpY2tQbGF5KHN0YXRlV2l0aFBpY2ssIHJuZyk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHRwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLnRwLmV2ZW50c10gfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPT09IFwiVFBcIiAmJiBwZW5kaW5nUGljay5kZWZlbnNlUGxheSA9PT0gXCJUUFwiKSB7XG4gICAgICAgICAgLy8gQm90aCBUUCBcdTIxOTIgU2FtZSBQbGF5IHVuY29uZGl0aW9uYWxseS5cbiAgICAgICAgICBjb25zdCBzcCA9IHJlc29sdmVTYW1lUGxheShzdGF0ZVdpdGhQaWNrLCBybmcpO1xuICAgICAgICAgIHJldHVybiB7IHN0YXRlOiBzcC5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi5zcC5ldmVudHNdIH07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZWd1bGFyIHZzIHJlZ3VsYXIuXG4gICAgICAgIGlmIChcbiAgICAgICAgICBpc1JlZ3VsYXJQbGF5KHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5KSAmJlxuICAgICAgICAgIGlzUmVndWxhclBsYXkocGVuZGluZ1BpY2suZGVmZW5zZVBsYXkpXG4gICAgICAgICkge1xuICAgICAgICAgIC8vIFNhbWUgcGxheT8gNTAvNTAgY2hhbmNlIHRvIHRyaWdnZXIgU2FtZSBQbGF5IG1lY2hhbmlzbS5cbiAgICAgICAgICAvLyBTb3VyY2U6IHJ1bi5qczoxODg2IChgaWYgKHBsMSA9PT0gcGwyKWApLlxuICAgICAgICAgIGlmIChwZW5kaW5nUGljay5vZmZlbnNlUGxheSA9PT0gcGVuZGluZ1BpY2suZGVmZW5zZVBsYXkpIHtcbiAgICAgICAgICAgIGNvbnN0IHRyaWdnZXIgPSBybmcuY29pbkZsaXAoKTtcbiAgICAgICAgICAgIGlmICh0cmlnZ2VyID09PSBcImhlYWRzXCIpIHtcbiAgICAgICAgICAgICAgY29uc3Qgc3AgPSByZXNvbHZlU2FtZVBsYXkoc3RhdGVXaXRoUGljaywgcm5nKTtcbiAgICAgICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHNwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLnNwLmV2ZW50c10gfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIFRhaWxzOiBmYWxsIHRocm91Z2ggdG8gcmVndWxhciByZXNvbHV0aW9uIChxdWFsaXR5IDUgb3V0Y29tZSkuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgcmVzb2x2ZWQgPSByZXNvbHZlUmVndWxhclBsYXkoXG4gICAgICAgICAgICBzdGF0ZVdpdGhQaWNrLFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBvZmZlbnNlUGxheTogcGVuZGluZ1BpY2sub2ZmZW5zZVBsYXksXG4gICAgICAgICAgICAgIGRlZmVuc2VQbGF5OiBwZW5kaW5nUGljay5kZWZlbnNlUGxheSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBybmcsXG4gICAgICAgICAgKTtcbiAgICAgICAgICByZXR1cm4geyBzdGF0ZTogcmVzb2x2ZWQuc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4ucmVzb2x2ZWQuZXZlbnRzXSB9O1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRGVmZW5zaXZlIHRyaWNrIHBsYXksIEZHLCBQVU5ULCBUV09fUFQgcGlja3MgXHUyMDE0IG5vdCByb3V0ZWQgaGVyZSB5ZXQuXG4gICAgICAgIC8vIEZHL1BVTlQvVFdPX1BUIGFyZSBkcml2ZW4gYnkgRk9VUlRIX0RPV05fQ0hPSUNFIC8gUEFUX0NIT0lDRSBhY3Rpb25zLFxuICAgICAgICAvLyBub3QgYnkgUElDS19QTEFZLiBEZWZlbnNpdmUgVFAgaXMgYSBUT0RPLlxuICAgICAgICByZXR1cm4geyBzdGF0ZTogc3RhdGVXaXRoUGljaywgZXZlbnRzIH07XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7IHN0YXRlOiB7IC4uLnN0YXRlLCBwZW5kaW5nUGljayB9LCBldmVudHMgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiQ0FMTF9USU1FT1VUXCI6IHtcbiAgICAgIGNvbnN0IHAgPSBzdGF0ZS5wbGF5ZXJzW2FjdGlvbi5wbGF5ZXJdO1xuICAgICAgaWYgKHAudGltZW91dHMgPD0gMCkgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcbiAgICAgIGNvbnN0IHJlbWFpbmluZyA9IHAudGltZW91dHMgLSAxO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGU6IHtcbiAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICBwbGF5ZXJzOiB7XG4gICAgICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICAgICAgW2FjdGlvbi5wbGF5ZXJdOiB7IC4uLnAsIHRpbWVvdXRzOiByZW1haW5pbmcgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBldmVudHM6IFt7IHR5cGU6IFwiVElNRU9VVF9DQUxMRURcIiwgcGxheWVyOiBhY3Rpb24ucGxheWVyLCByZW1haW5pbmcgfV0sXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJBQ0NFUFRfUEVOQUxUWVwiOlxuICAgIGNhc2UgXCJERUNMSU5FX1BFTkFMVFlcIjpcbiAgICAgIC8vIFBlbmFsdGllcyBhcmUgY2FwdHVyZWQgYXMgZXZlbnRzIGF0IHJlc29sdXRpb24gdGltZSwgYnV0IGFjY2VwdC9kZWNsaW5lXG4gICAgICAvLyBmbG93IHJlcXVpcmVzIHN0YXRlIG5vdCB5ZXQgbW9kZWxlZCAocGVuZGluZyBwZW5hbHR5KS4gVE9ETyB3aGVuXG4gICAgICAvLyBwZW5hbHR5IG1lY2hhbmljcyBhcmUgcG9ydGVkIGZyb20gcnVuLmpzLlxuICAgICAgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcblxuICAgIGNhc2UgXCJQQVRfQ0hPSUNFXCI6IHtcbiAgICAgIGNvbnN0IHNjb3JlciA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gICAgICAvLyAzT1QrIHJlcXVpcmVzIDItcG9pbnQgY29udmVyc2lvbi4gU2lsZW50bHkgc3Vic3RpdHV0ZSBldmVuIGlmIFwia2lja1wiXG4gICAgICAvLyB3YXMgc2VudCAobWF0Y2hlcyB2NS4xJ3MgXCJtdXN0XCIgYmVoYXZpb3IgYXQgcnVuLmpzOjE2NDEpLlxuICAgICAgY29uc3QgZWZmZWN0aXZlQ2hvaWNlID1cbiAgICAgICAgc3RhdGUub3ZlcnRpbWUgJiYgc3RhdGUub3ZlcnRpbWUucGVyaW9kID49IDNcbiAgICAgICAgICA/IFwidHdvX3BvaW50XCJcbiAgICAgICAgICA6IGFjdGlvbi5jaG9pY2U7XG4gICAgICBpZiAoZWZmZWN0aXZlQ2hvaWNlID09PSBcImtpY2tcIikge1xuICAgICAgICAvLyBBc3N1bWUgYXV0b21hdGljIGluIHY1LjEgXHUyMDE0IG5vIG1lY2hhbmljIHJlY29yZGVkIGZvciBQQVQga2lja3MuXG4gICAgICAgIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgICAgICBbc2NvcmVyXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0uc2NvcmUgKyAxIH0sXG4gICAgICAgIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdGF0ZToge1xuICAgICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgZXZlbnRzOiBbeyB0eXBlOiBcIlBBVF9HT09EXCIsIHBsYXllcjogc2NvcmVyIH1dLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgLy8gdHdvX3BvaW50IFx1MjE5MiB0cmFuc2l0aW9uIHRvIFRXT19QVF9DT05WIHBoYXNlOyBhIFBJQ0tfUExBWSByZXNvbHZlcyBpdC5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgcGhhc2U6IFwiVFdPX1BUX0NPTlZcIixcbiAgICAgICAgICBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgYmFsbE9uOiA5NywgZmlyc3REb3duQXQ6IDEwMCwgZG93bjogMSB9LFxuICAgICAgICB9LFxuICAgICAgICBldmVudHM6IFtdLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiRk9VUlRIX0RPV05fQ0hPSUNFXCI6IHtcbiAgICAgIGlmIChhY3Rpb24uY2hvaWNlID09PSBcImdvXCIpIHtcbiAgICAgICAgLy8gTm90aGluZyB0byBkbyBcdTIwMTQgdGhlIG5leHQgUElDS19QTEFZIHdpbGwgcmVzb2x2ZSBub3JtYWxseSBmcm9tIDR0aCBkb3duLlxuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgfVxuICAgICAgaWYgKGFjdGlvbi5jaG9pY2UgPT09IFwicHVudFwiKSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHJlc29sdmVQdW50KHN0YXRlLCBybmcpO1xuICAgICAgICByZXR1cm4geyBzdGF0ZTogcmVzdWx0LnN0YXRlLCBldmVudHM6IHJlc3VsdC5ldmVudHMgfTtcbiAgICAgIH1cbiAgICAgIC8vIGZnXG4gICAgICBjb25zdCByZXN1bHQgPSByZXNvbHZlRmllbGRHb2FsKHN0YXRlLCBybmcpO1xuICAgICAgcmV0dXJuIHsgc3RhdGU6IHJlc3VsdC5zdGF0ZSwgZXZlbnRzOiByZXN1bHQuZXZlbnRzIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIkZPUkZFSVRcIjoge1xuICAgICAgY29uc3Qgd2lubmVyID0gb3BwKGFjdGlvbi5wbGF5ZXIpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGU6IHsgLi4uc3RhdGUsIHBoYXNlOiBcIkdBTUVfT1ZFUlwiIH0sXG4gICAgICAgIGV2ZW50czogW3sgdHlwZTogXCJHQU1FX09WRVJcIiwgd2lubmVyIH1dLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiVElDS19DTE9DS1wiOiB7XG4gICAgICBjb25zdCBwcmV2ID0gc3RhdGUuY2xvY2suc2Vjb25kc1JlbWFpbmluZztcbiAgICAgIGNvbnN0IG5leHQgPSBNYXRoLm1heCgwLCBwcmV2IC0gYWN0aW9uLnNlY29uZHMpO1xuICAgICAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW3sgdHlwZTogXCJDTE9DS19USUNLRURcIiwgc2Vjb25kczogYWN0aW9uLnNlY29uZHMgfV07XG5cbiAgICAgIC8vIFR3by1taW51dGUgd2FybmluZzogY3Jvc3NpbmcgMTIwIHNlY29uZHMgaW4gUTIgb3IgUTQgdHJpZ2dlcnMgYW4gZXZlbnQuXG4gICAgICBpZiAoXG4gICAgICAgIChzdGF0ZS5jbG9jay5xdWFydGVyID09PSAyIHx8IHN0YXRlLmNsb2NrLnF1YXJ0ZXIgPT09IDQpICYmXG4gICAgICAgIHByZXYgPiAxMjAgJiZcbiAgICAgICAgbmV4dCA8PSAxMjBcbiAgICAgICkge1xuICAgICAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFdPX01JTlVURV9XQVJOSU5HXCIgfSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChuZXh0ID09PSAwKSB7XG4gICAgICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJRVUFSVEVSX0VOREVEXCIsIHF1YXJ0ZXI6IHN0YXRlLmNsb2NrLnF1YXJ0ZXIgfSk7XG4gICAgICAgIC8vIFExXHUyMTkyUTIgYW5kIFEzXHUyMTkyUTQ6IHJvbGwgb3ZlciBjbG9jaywgc2FtZSBoYWxmLCBzYW1lIHBvc3Nlc3Npb24gY29udGludWVzLlxuICAgICAgICBpZiAoc3RhdGUuY2xvY2sucXVhcnRlciA9PT0gMSB8fCBzdGF0ZS5jbG9jay5xdWFydGVyID09PSAzKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgICAgICBjbG9jazoge1xuICAgICAgICAgICAgICAgIC4uLnN0YXRlLmNsb2NrLFxuICAgICAgICAgICAgICAgIHF1YXJ0ZXI6IHN0YXRlLmNsb2NrLnF1YXJ0ZXIgKyAxLFxuICAgICAgICAgICAgICAgIHNlY29uZHNSZW1haW5pbmc6IHN0YXRlLmNsb2NrLnF1YXJ0ZXJMZW5ndGhNaW51dGVzICogNjAsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZXZlbnRzLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgLy8gRW5kIG9mIFEyID0gaGFsZnRpbWUuIFE0IGVuZCA9IHJlZ3VsYXRpb24gb3Zlci5cbiAgICAgICAgaWYgKHN0YXRlLmNsb2NrLnF1YXJ0ZXIgPT09IDIpIHtcbiAgICAgICAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiSEFMRl9FTkRFRFwiIH0pO1xuICAgICAgICAgIC8vIFJlY2VpdmVyIG9mIG9wZW5pbmcga2lja29mZiBraWNrcyB0aGUgc2Vjb25kIGhhbGY7IGZsaXAgcG9zc2Vzc2lvbi5cbiAgICAgICAgICBjb25zdCBzZWNvbmRIYWxmUmVjZWl2ZXIgPVxuICAgICAgICAgICAgc3RhdGUub3BlbmluZ1JlY2VpdmVyID09PSBudWxsID8gMSA6IG9wcChzdGF0ZS5vcGVuaW5nUmVjZWl2ZXIpO1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0ZToge1xuICAgICAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgICAgICAgICAgICBjbG9jazoge1xuICAgICAgICAgICAgICAgIC4uLnN0YXRlLmNsb2NrLFxuICAgICAgICAgICAgICAgIHF1YXJ0ZXI6IDMsXG4gICAgICAgICAgICAgICAgc2Vjb25kc1JlbWFpbmluZzogc3RhdGUuY2xvY2sucXVhcnRlckxlbmd0aE1pbnV0ZXMgKiA2MCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IG9wcChzZWNvbmRIYWxmUmVjZWl2ZXIpIH0sXG4gICAgICAgICAgICAgIC8vIFJlZnJlc2ggdGltZW91dHMgZm9yIG5ldyBoYWxmLlxuICAgICAgICAgICAgICBwbGF5ZXJzOiB7XG4gICAgICAgICAgICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgICAgICAgICAgICAxOiB7IC4uLnN0YXRlLnBsYXllcnNbMV0sIHRpbWVvdXRzOiAzIH0sXG4gICAgICAgICAgICAgICAgMjogeyAuLi5zdGF0ZS5wbGF5ZXJzWzJdLCB0aW1lb3V0czogMyB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGV2ZW50cyxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIC8vIFE0IGVuZGVkLlxuICAgICAgICBjb25zdCBwMSA9IHN0YXRlLnBsYXllcnNbMV0uc2NvcmU7XG4gICAgICAgIGNvbnN0IHAyID0gc3RhdGUucGxheWVyc1syXS5zY29yZTtcbiAgICAgICAgaWYgKHAxICE9PSBwMikge1xuICAgICAgICAgIGNvbnN0IHdpbm5lciA9IHAxID4gcDIgPyAxIDogMjtcbiAgICAgICAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiR0FNRV9PVkVSXCIsIHdpbm5lciB9KTtcbiAgICAgICAgICByZXR1cm4geyBzdGF0ZTogeyAuLi5zdGF0ZSwgcGhhc2U6IFwiR0FNRV9PVkVSXCIgfSwgZXZlbnRzIH07XG4gICAgICAgIH1cbiAgICAgICAgLy8gVGllZCBcdTIwMTQgaGVhZCB0byBvdmVydGltZS5cbiAgICAgICAgY29uc3Qgb3RDbG9jayA9IHsgLi4uc3RhdGUuY2xvY2ssIHF1YXJ0ZXI6IDUsIHNlY29uZHNSZW1haW5pbmc6IDAgfTtcbiAgICAgICAgY29uc3Qgb3QgPSBzdGFydE92ZXJ0aW1lKHsgLi4uc3RhdGUsIGNsb2NrOiBvdENsb2NrIH0pO1xuICAgICAgICBldmVudHMucHVzaCguLi5vdC5ldmVudHMpO1xuICAgICAgICByZXR1cm4geyBzdGF0ZTogb3Quc3RhdGUsIGV2ZW50cyB9O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0ZTogeyAuLi5zdGF0ZSwgY2xvY2s6IHsgLi4uc3RhdGUuY2xvY2ssIHNlY29uZHNSZW1haW5pbmc6IG5leHQgfSB9LFxuICAgICAgICBldmVudHMsXG4gICAgICB9O1xuICAgIH1cblxuICAgIGRlZmF1bHQ6IHtcbiAgICAgIC8vIEV4aGF1c3RpdmVuZXNzIGNoZWNrIFx1MjAxNCBhZGRpbmcgYSBuZXcgQWN0aW9uIHZhcmlhbnQgd2l0aG91dCBoYW5kbGluZyBpdFxuICAgICAgLy8gaGVyZSB3aWxsIHByb2R1Y2UgYSBjb21waWxlIGVycm9yLlxuICAgICAgY29uc3QgX2V4aGF1c3RpdmU6IG5ldmVyID0gYWN0aW9uO1xuICAgICAgdm9pZCBfZXhoYXVzdGl2ZTtcbiAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogQ29udmVuaWVuY2UgZm9yIHJlcGxheWluZyBhIHNlcXVlbmNlIG9mIGFjdGlvbnMgXHUyMDE0IHVzZWZ1bCBmb3IgdGVzdHMgYW5kXG4gKiBmb3Igc2VydmVyLXNpZGUgZ2FtZSByZXBsYXkgZnJvbSBhY3Rpb24gbG9nLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVkdWNlTWFueShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgYWN0aW9uczogQWN0aW9uW10sXG4gIHJuZzogUm5nLFxuKTogUmVkdWNlUmVzdWx0IHtcbiAgbGV0IGN1cnJlbnQgPSBzdGF0ZTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG4gIGZvciAoY29uc3QgYWN0aW9uIG9mIGFjdGlvbnMpIHtcbiAgICBjb25zdCByZXN1bHQgPSByZWR1Y2UoY3VycmVudCwgYWN0aW9uLCBybmcpO1xuICAgIGN1cnJlbnQgPSByZXN1bHQuc3RhdGU7XG4gICAgZXZlbnRzLnB1c2goLi4ucmVzdWx0LmV2ZW50cyk7XG4gIH1cbiAgcmV0dXJuIHsgc3RhdGU6IGN1cnJlbnQsIGV2ZW50cyB9O1xufVxuIiwgIi8qKlxuICogUk5HIGFic3RyYWN0aW9uLlxuICpcbiAqIFRoZSBlbmdpbmUgbmV2ZXIgcmVhY2hlcyBmb3IgYE1hdGgucmFuZG9tKClgIGRpcmVjdGx5LiBBbGwgcmFuZG9tbmVzcyBpc1xuICogc291cmNlZCBmcm9tIGFuIGBSbmdgIGluc3RhbmNlIHBhc3NlZCBpbnRvIGByZWR1Y2UoKWAuIFRoaXMgaXMgd2hhdCBtYWtlc1xuICogdGhlIGVuZ2luZSBkZXRlcm1pbmlzdGljIGFuZCB0ZXN0YWJsZS5cbiAqXG4gKiBJbiBwcm9kdWN0aW9uLCB0aGUgU3VwYWJhc2UgRWRnZSBGdW5jdGlvbiBjcmVhdGVzIGEgc2VlZGVkIFJORyBwZXIgZ2FtZVxuICogKHNlZWQgc3RvcmVkIGFsb25nc2lkZSBnYW1lIHN0YXRlKSwgc28gYSBjb21wbGV0ZSBnYW1lIGNhbiBiZSByZXBsYXllZFxuICogZGV0ZXJtaW5pc3RpY2FsbHkgZnJvbSBpdHMgYWN0aW9uIGxvZyBcdTIwMTQgdXNlZnVsIGZvciBidWcgcmVwb3J0cywgcmVjYXBcbiAqIGdlbmVyYXRpb24sIGFuZCBcIndhdGNoIHRoZSBnYW1lIGJhY2tcIiBmZWF0dXJlcy5cbiAqL1xuXG5leHBvcnQgaW50ZXJmYWNlIFJuZyB7XG4gIC8qKiBJbmNsdXNpdmUgYm90aCBlbmRzLiAqL1xuICBpbnRCZXR3ZWVuKG1pbkluY2x1c2l2ZTogbnVtYmVyLCBtYXhJbmNsdXNpdmU6IG51bWJlcik6IG51bWJlcjtcbiAgLyoqIFJldHVybnMgXCJoZWFkc1wiIG9yIFwidGFpbHNcIi4gKi9cbiAgY29pbkZsaXAoKTogXCJoZWFkc1wiIHwgXCJ0YWlsc1wiO1xuICAvKiogUmV0dXJucyAxLTYuICovXG4gIGQ2KCk6IDEgfCAyIHwgMyB8IDQgfCA1IHwgNjtcbn1cblxuLyoqXG4gKiBNdWxiZXJyeTMyIFx1MjAxNCBhIHNtYWxsLCBmYXN0LCB3ZWxsLWRpc3RyaWJ1dGVkIHNlZWRlZCBQUk5HLiBTdWZmaWNpZW50IGZvclxuICogYSBjYXJkLWRyYXdpbmcgZm9vdGJhbGwgZ2FtZTsgbm90IGZvciBjcnlwdG9ncmFwaHkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZWVkZWRSbmcoc2VlZDogbnVtYmVyKTogUm5nIHtcbiAgbGV0IHN0YXRlID0gc2VlZCA+Pj4gMDtcblxuICBjb25zdCBuZXh0ID0gKCk6IG51bWJlciA9PiB7XG4gICAgc3RhdGUgPSAoc3RhdGUgKyAweDZkMmI3OWY1KSA+Pj4gMDtcbiAgICBsZXQgdCA9IHN0YXRlO1xuICAgIHQgPSBNYXRoLmltdWwodCBeICh0ID4+PiAxNSksIHQgfCAxKTtcbiAgICB0IF49IHQgKyBNYXRoLmltdWwodCBeICh0ID4+PiA3KSwgdCB8IDYxKTtcbiAgICByZXR1cm4gKCh0IF4gKHQgPj4+IDE0KSkgPj4+IDApIC8gNDI5NDk2NzI5NjtcbiAgfTtcblxuICByZXR1cm4ge1xuICAgIGludEJldHdlZW4obWluLCBtYXgpIHtcbiAgICAgIHJldHVybiBNYXRoLmZsb29yKG5leHQoKSAqIChtYXggLSBtaW4gKyAxKSkgKyBtaW47XG4gICAgfSxcbiAgICBjb2luRmxpcCgpIHtcbiAgICAgIHJldHVybiBuZXh0KCkgPCAwLjUgPyBcImhlYWRzXCIgOiBcInRhaWxzXCI7XG4gICAgfSxcbiAgICBkNigpIHtcbiAgICAgIHJldHVybiAoTWF0aC5mbG9vcihuZXh0KCkgKiA2KSArIDEpIGFzIDEgfCAyIHwgMyB8IDQgfCA1IHwgNjtcbiAgICB9LFxuICB9O1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQVNPLFNBQVMsVUFBVSxhQUFhLE9BQWE7QUFDbEQsU0FBTztBQUFBLElBQ0wsSUFBSTtBQUFBLElBQ0osSUFBSTtBQUFBLElBQ0osSUFBSTtBQUFBLElBQ0osSUFBSTtBQUFBLElBQ0osSUFBSTtBQUFBLElBQ0osSUFBSSxhQUFhLElBQUk7QUFBQSxFQUN2QjtBQUNGO0FBRU8sU0FBUyxhQUFvQjtBQUNsQyxTQUFPLEVBQUUsV0FBVyxHQUFHLFdBQVcsR0FBRyxXQUFXLEdBQUcsT0FBTyxFQUFFO0FBQzlEO0FBRU8sU0FBUyx1QkFBeUQ7QUFDdkUsU0FBTyxDQUFDLEdBQUcsR0FBRyxHQUFHLENBQUM7QUFDcEI7QUFFTyxTQUFTLGlCQUEyQjtBQUN6QyxTQUFPLENBQUMsR0FBRyxHQUFHLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxHQUFHLEdBQUcsQ0FBQztBQUN0QztBQVFPLFNBQVMsYUFBYSxNQUFtQztBQUM5RCxTQUFPO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxlQUFlO0FBQUEsSUFDZixPQUFPO0FBQUEsTUFDTCxTQUFTO0FBQUEsTUFDVCxrQkFBa0IsS0FBSyx1QkFBdUI7QUFBQSxNQUM5QyxzQkFBc0IsS0FBSztBQUFBLElBQzdCO0FBQUEsSUFDQSxPQUFPO0FBQUEsTUFDTCxRQUFRO0FBQUEsTUFDUixhQUFhO0FBQUEsTUFDYixNQUFNO0FBQUEsTUFDTixTQUFTO0FBQUEsSUFDWDtBQUFBLElB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QUM7QUFDekMsaUJBQU8sRUFBRSxPQUFPLEVBQUUsR0FBRyxPQUFPLE9BQU8sWUFBWSxHQUFHLE9BQU87QUFBQSxRQUMzRDtBQUVBLGNBQU0sVUFBVSxFQUFFLEdBQUcsTUFBTSxPQUFPLFNBQVMsR0FBRyxrQkFBa0IsRUFBRTtBQUNsRSxjQUFNLEtBQUssY0FBYyxFQUFFLEdBQUcsT0FBTyxPQUFPLFFBQVEsQ0FBQztBQUNyRCxlQUFPLEtBQUssR0FBRyxHQUFHLE1BQU07QUFDeEIsZUFBTyxFQUFFLE9BQU8sR0FBRyxPQUFPLE9BQU87QUFBQSxNQUNuQztBQUVBLGFBQU87QUFBQSxRQUNMLE9BQU8sRUFBRSxHQUFHLE9BQU8sT0FBTyxFQUFFLEdBQUcsTUFBTSxPQUFPLGtCQUFrQixLQUFLLEVBQUU7QUFBQSxRQUNyRTtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsSUFFQSxTQUFTO0FBR1AsWUFBTSxjQUFxQjtBQUUzQixhQUFPLEVBQUUsT0FBTyxRQUFRLENBQUMsRUFBRTtBQUFBLElBQzdCO0FBQUEsRUFDRjtBQUNGO0FBTU8sU0FBUyxXQUNkLE9BQ0EsU0FDQSxLQUNjO0FBQ2QsTUFBSSxVQUFVO0FBQ2QsUUFBTSxTQUFrQixDQUFDO0FBQ3pCLGFBQVcsVUFBVSxTQUFTO0FBQzVCLFVBQU0sU0FBUyxPQUFPLFNBQVMsUUFBUSxHQUFHO0FBQzFDLGNBQVUsT0FBTztBQUNqQixXQUFPLEtBQUssR0FBRyxPQUFPLE1BQU07QUFBQSxFQUM5QjtBQUNBLFNBQU8sRUFBRSxPQUFPLFNBQVMsT0FBTztBQUNsQzs7O0FDeFlPLFNBQVMsVUFBVSxNQUFtQjtBQUMzQyxNQUFJLFFBQVEsU0FBUztBQUVyQixRQUFNLE9BQU8sTUFBYztBQUN6QixZQUFTLFFBQVEsZUFBZ0I7QUFDakMsUUFBSSxJQUFJO0FBQ1IsUUFBSSxLQUFLLEtBQUssSUFBSyxNQUFNLElBQUssSUFBSSxDQUFDO0FBQ25DLFNBQUssSUFBSSxLQUFLLEtBQUssSUFBSyxNQUFNLEdBQUksSUFBSSxFQUFFO0FBQ3hDLGFBQVMsSUFBSyxNQUFNLFFBQVMsS0FBSztBQUFBLEVBQ3BDO0FBRUEsU0FBTztBQUFBLElBQ0wsV0FBVyxLQUFLLEtBQUs7QUFDbkIsYUFBTyxLQUFLLE1BQU0sS0FBSyxLQUFLLE1BQU0sTUFBTSxFQUFFLElBQUk7QUFBQSxJQUNoRDtBQUFBLElBQ0EsV0FBVztBQUNULGFBQU8sS0FBSyxJQUFJLE1BQU0sVUFBVTtBQUFBLElBQ2xDO0FBQUEsSUFDQSxLQUFLO0FBQ0gsYUFBUSxLQUFLLE1BQU0sS0FBSyxJQUFJLENBQUMsSUFBSTtBQUFBLElBQ25DO0FBQUEsRUFDRjtBQUNGOyIsCiAgIm5hbWVzIjogWyJibGFua1BpY2siLCAiYmxhbmtQaWNrIiwgImhhbGZUb0dvYWwiLCAiYmxhbmtQaWNrIiwgImJsYW5rUGljayIsICJibGFua1BpY2siLCAiYmxhbmtQaWNrIiwgIm11bHRpcGxpZXIiLCAieWFyZHNEcmF3IiwgInlhcmRzIiwgImJsYW5rUGljayIsICJibGFua1BpY2siLCAicmVzdWx0Il0KfQo=
