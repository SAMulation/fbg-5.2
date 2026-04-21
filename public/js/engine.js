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
        if (state.phase === "TWO_PT_CONV" && isRegularPlay(pendingPick.offensePlay) && isRegularPlay(pendingPick.defensePlay)) {
          const tp = resolveTwoPointConversion(
            stateWithPick,
            pendingPick.offensePlay,
            pendingPick.defensePlay,
            rng
          );
          return { state: tp.state, events: [...events, ...tp.events] };
        }
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9zdGF0ZS50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL21hdGNodXAudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy95YXJkYWdlLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvZGVjay50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3BsYXkudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9zaGFyZWQudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9iaWdQbGF5LnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvcHVudC50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL2tpY2tvZmYudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9oYWlsTWFyeS50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3J1bGVzL3NwZWNpYWxzL3NhbWVQbGF5LnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvdHJpY2tQbGF5LnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvZmllbGRHb2FsLnRzIiwgIi4uLy4uL3BhY2thZ2VzL2VuZ2luZS9zcmMvcnVsZXMvc3BlY2lhbHMvdHdvUG9pbnQudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9vdmVydGltZS50cyIsICIuLi8uLi9wYWNrYWdlcy9lbmdpbmUvc3JjL3JlZHVjZXIudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ybmcudHMiLCAiLi4vLi4vcGFja2FnZXMvZW5naW5lL3NyYy9ydWxlcy9zcGVjaWFscy9vdXRjb21lcy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLyoqXG4gKiBTdGF0ZSBmYWN0b3JpZXMuXG4gKlxuICogYGluaXRpYWxTdGF0ZSgpYCBwcm9kdWNlcyBhIGZyZXNoIEdhbWVTdGF0ZSBpbiBJTklUIHBoYXNlLiBFdmVyeXRoaW5nIGVsc2VcbiAqIGZsb3dzIGZyb20gcmVkdWNpbmcgYWN0aW9ucyBvdmVyIHRoaXMgc3RhcnRpbmcgcG9pbnQuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIEhhbmQsIFBsYXllcklkLCBTdGF0cywgVGVhbVJlZiB9IGZyb20gXCIuL3R5cGVzLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBlbXB0eUhhbmQoaXNPdmVydGltZSA9IGZhbHNlKTogSGFuZCB7XG4gIHJldHVybiB7XG4gICAgU1I6IDMsXG4gICAgTFI6IDMsXG4gICAgU1A6IDMsXG4gICAgTFA6IDMsXG4gICAgVFA6IDEsXG4gICAgSE06IGlzT3ZlcnRpbWUgPyAyIDogMyxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGVtcHR5U3RhdHMoKTogU3RhdHMge1xuICByZXR1cm4geyBwYXNzWWFyZHM6IDAsIHJ1c2hZYXJkczogMCwgdHVybm92ZXJzOiAwLCBzYWNrczogMCB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZnJlc2hEZWNrTXVsdGlwbGllcnMoKTogW251bWJlciwgbnVtYmVyLCBudW1iZXIsIG51bWJlcl0ge1xuICByZXR1cm4gWzQsIDQsIDQsIDNdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZnJlc2hEZWNrWWFyZHMoKTogbnVtYmVyW10ge1xuICByZXR1cm4gWzEsIDEsIDEsIDEsIDEsIDEsIDEsIDEsIDEsIDFdO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEluaXRpYWxTdGF0ZUFyZ3Mge1xuICB0ZWFtMTogVGVhbVJlZjtcbiAgdGVhbTI6IFRlYW1SZWY7XG4gIHF1YXJ0ZXJMZW5ndGhNaW51dGVzOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpbml0aWFsU3RhdGUoYXJnczogSW5pdGlhbFN0YXRlQXJncyk6IEdhbWVTdGF0ZSB7XG4gIHJldHVybiB7XG4gICAgcGhhc2U6IFwiSU5JVFwiLFxuICAgIHNjaGVtYVZlcnNpb246IDEsXG4gICAgY2xvY2s6IHtcbiAgICAgIHF1YXJ0ZXI6IDAsXG4gICAgICBzZWNvbmRzUmVtYWluaW5nOiBhcmdzLnF1YXJ0ZXJMZW5ndGhNaW51dGVzICogNjAsXG4gICAgICBxdWFydGVyTGVuZ3RoTWludXRlczogYXJncy5xdWFydGVyTGVuZ3RoTWludXRlcyxcbiAgICB9LFxuICAgIGZpZWxkOiB7XG4gICAgICBiYWxsT246IDM1LFxuICAgICAgZmlyc3REb3duQXQ6IDQ1LFxuICAgICAgZG93bjogMSxcbiAgICAgIG9mZmVuc2U6IDEsXG4gICAgfSxcbiAgICBkZWNrOiB7XG4gICAgICBtdWx0aXBsaWVyczogZnJlc2hEZWNrTXVsdGlwbGllcnMoKSxcbiAgICAgIHlhcmRzOiBmcmVzaERlY2tZYXJkcygpLFxuICAgIH0sXG4gICAgcGxheWVyczoge1xuICAgICAgMToge1xuICAgICAgICB0ZWFtOiBhcmdzLnRlYW0xLFxuICAgICAgICBzY29yZTogMCxcbiAgICAgICAgdGltZW91dHM6IDMsXG4gICAgICAgIGhhbmQ6IGVtcHR5SGFuZCgpLFxuICAgICAgICBzdGF0czogZW1wdHlTdGF0cygpLFxuICAgICAgfSxcbiAgICAgIDI6IHtcbiAgICAgICAgdGVhbTogYXJncy50ZWFtMixcbiAgICAgICAgc2NvcmU6IDAsXG4gICAgICAgIHRpbWVvdXRzOiAzLFxuICAgICAgICBoYW5kOiBlbXB0eUhhbmQoKSxcbiAgICAgICAgc3RhdHM6IGVtcHR5U3RhdHMoKSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBvcGVuaW5nUmVjZWl2ZXI6IG51bGwsXG4gICAgb3ZlcnRpbWU6IG51bGwsXG4gICAgcGVuZGluZ1BpY2s6IHsgb2ZmZW5zZVBsYXk6IG51bGwsIGRlZmVuc2VQbGF5OiBudWxsIH0sXG4gICAgbGFzdFBsYXlEZXNjcmlwdGlvbjogXCJTdGFydCBvZiBnYW1lXCIsXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBvcHAocDogUGxheWVySWQpOiBQbGF5ZXJJZCB7XG4gIHJldHVybiBwID09PSAxID8gMiA6IDE7XG59XG4iLCAiLyoqXG4gKiBUaGUgcGxheSBtYXRjaHVwIG1hdHJpeCBcdTIwMTQgdGhlIGhlYXJ0IG9mIEZvb3RCb3JlZC5cbiAqXG4gKiBCb3RoIHRlYW1zIHBpY2sgYSBwbGF5LiBUaGUgbWF0cml4IHNjb3JlcyBob3cgKmNsb3NlbHkqIHRoZSBkZWZlbnNlXG4gKiBwcmVkaWN0ZWQgdGhlIG9mZmVuc2l2ZSBjYWxsOlxuICogICAtIDEgPSBkZWZlbnNlIHdheSBvZmYgXHUyMTkyIGdyZWF0IGZvciBvZmZlbnNlXG4gKiAgIC0gNSA9IGRlZmVuc2UgbWF0Y2hlZCBcdTIxOTIgdGVycmlibGUgZm9yIG9mZmVuc2UgKGNvbWJpbmVkIHdpdGggYSBsb3dcbiAqICAgICAgICAgbXVsdGlwbGllciBjYXJkLCB0aGlzIGJlY29tZXMgYSBsb3NzIC8gdHVybm92ZXIgcmlzaylcbiAqXG4gKiBSb3dzID0gb2ZmZW5zaXZlIGNhbGwsIENvbHMgPSBkZWZlbnNpdmUgY2FsbC4gT3JkZXI6IFtTUiwgTFIsIFNQLCBMUF0uXG4gKlxuICogICAgICAgICAgIERFRjogU1IgIExSICBTUCAgTFBcbiAqICAgT0ZGOiBTUiAgICAgWyA1LCAgMywgIDMsICAyIF1cbiAqICAgT0ZGOiBMUiAgICAgWyAyLCAgNCwgIDEsICAyIF1cbiAqICAgT0ZGOiBTUCAgICAgWyAzLCAgMiwgIDUsICAzIF1cbiAqICAgT0ZGOiBMUCAgICAgWyAxLCAgMiwgIDIsICA0IF1cbiAqXG4gKiBQb3J0ZWQgdmVyYmF0aW0gZnJvbSBwdWJsaWMvanMvZGVmYXVsdHMuanMgTUFUQ0hVUC4gSW5kZXhpbmcgY29uZmlybWVkXG4gKiBhZ2FpbnN0IHBsYXlNZWNoYW5pc20gLyBjYWxjVGltZXMgaW4gcnVuLmpzOjIzNjguXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBSZWd1bGFyUGxheSB9IGZyb20gXCIuLi90eXBlcy5qc1wiO1xuXG5leHBvcnQgY29uc3QgTUFUQ0hVUDogUmVhZG9ubHlBcnJheTxSZWFkb25seUFycmF5PE1hdGNodXBRdWFsaXR5Pj4gPSBbXG4gIFs1LCAzLCAzLCAyXSxcbiAgWzIsIDQsIDEsIDJdLFxuICBbMywgMiwgNSwgM10sXG4gIFsxLCAyLCAyLCA0XSxcbl0gYXMgY29uc3Q7XG5cbmV4cG9ydCB0eXBlIE1hdGNodXBRdWFsaXR5ID0gMSB8IDIgfCAzIHwgNCB8IDU7XG5cbmNvbnN0IFBMQVlfSU5ERVg6IFJlY29yZDxSZWd1bGFyUGxheSwgMCB8IDEgfCAyIHwgMz4gPSB7XG4gIFNSOiAwLFxuICBMUjogMSxcbiAgU1A6IDIsXG4gIExQOiAzLFxufTtcblxuLyoqXG4gKiBNdWx0aXBsaWVyIGNhcmQgdmFsdWVzLiBJbmRleGluZyAoY29uZmlybWVkIGluIHJ1bi5qczoyMzc3KTpcbiAqICAgcm93ICAgID0gbXVsdGlwbGllciBjYXJkICgwPUtpbmcsIDE9UXVlZW4sIDI9SmFjaywgMz0xMClcbiAqICAgY29sdW1uID0gbWF0Y2h1cCBxdWFsaXR5IC0gMSAoc28gY29sdW1uIDAgPSBxdWFsaXR5IDEsIGNvbHVtbiA0ID0gcXVhbGl0eSA1KVxuICpcbiAqIFF1YWxpdHkgMSAob2ZmZW5zZSBvdXRndWVzc2VkIGRlZmVuc2UpICsgS2luZyA9IDR4LiBCZXN0IHBvc3NpYmxlIHBsYXkuXG4gKiBRdWFsaXR5IDUgKGRlZmVuc2UgbWF0Y2hlZCkgKyAxMCAgICAgICAgPSAtMXguIFdvcnN0IHJlZ3VsYXIgcGxheS5cbiAqXG4gKiAgICAgICAgICAgICAgICAgIHF1YWwgMSAgcXVhbCAyICBxdWFsIDMgIHF1YWwgNCAgcXVhbCA1XG4gKiAgIEtpbmcgICAgKDApICBbICAgNCwgICAgICAzLCAgICAgIDIsICAgICAxLjUsICAgICAxICAgXVxuICogICBRdWVlbiAgICgxKSAgWyAgIDMsICAgICAgMiwgICAgICAxLCAgICAgIDEsICAgICAwLjUgIF1cbiAqICAgSmFjayAgICAoMikgIFsgICAyLCAgICAgIDEsICAgICAwLjUsICAgICAwLCAgICAgIDAgICBdXG4gKiAgIDEwICAgICAgKDMpICBbICAgMCwgICAgICAwLCAgICAgIDAsICAgICAtMSwgICAgIC0xICAgXVxuICpcbiAqIFBvcnRlZCB2ZXJiYXRpbSBmcm9tIHB1YmxpYy9qcy9kZWZhdWx0cy5qcyBNVUxUSS5cbiAqL1xuZXhwb3J0IGNvbnN0IE1VTFRJOiBSZWFkb25seUFycmF5PFJlYWRvbmx5QXJyYXk8bnVtYmVyPj4gPSBbXG4gIFs0LCAzLCAyLCAxLjUsIDFdLFxuICBbMywgMiwgMSwgMSwgMC41XSxcbiAgWzIsIDEsIDAuNSwgMCwgMF0sXG4gIFswLCAwLCAwLCAtMSwgLTFdLFxuXSBhcyBjb25zdDtcblxuZXhwb3J0IGZ1bmN0aW9uIG1hdGNodXBRdWFsaXR5KG9mZjogUmVndWxhclBsYXksIGRlZjogUmVndWxhclBsYXkpOiBNYXRjaHVwUXVhbGl0eSB7XG4gIGNvbnN0IHJvdyA9IE1BVENIVVBbUExBWV9JTkRFWFtvZmZdXTtcbiAgaWYgKCFyb3cpIHRocm93IG5ldyBFcnJvcihgdW5yZWFjaGFibGU6IGJhZCBvZmYgcGxheSAke29mZn1gKTtcbiAgY29uc3QgcSA9IHJvd1tQTEFZX0lOREVYW2RlZl1dO1xuICBpZiAocSA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoYHVucmVhY2hhYmxlOiBiYWQgZGVmIHBsYXkgJHtkZWZ9YCk7XG4gIHJldHVybiBxO1xufVxuIiwgIi8qKlxuICogUHVyZSB5YXJkYWdlIGNhbGN1bGF0aW9uIGZvciBhIHJlZ3VsYXIgcGxheSAoU1IvTFIvU1AvTFApLlxuICpcbiAqIEZvcm11bGEgKHJ1bi5qczoyMzM3KTpcbiAqICAgeWFyZHMgPSByb3VuZChtdWx0aXBsaWVyICogeWFyZHNDYXJkKSArIGJvbnVzXG4gKlxuICogV2hlcmU6XG4gKiAgIC0gbXVsdGlwbGllciA9IE1VTFRJW211bHRpcGxpZXJDYXJkXVtxdWFsaXR5IC0gMV1cbiAqICAgLSBxdWFsaXR5ICAgID0gTUFUQ0hVUFtvZmZlbnNlXVtkZWZlbnNlXSAgIC8vIDEtNVxuICogICAtIGJvbnVzICAgICAgPSBzcGVjaWFsLXBsYXkgYm9udXMgKGUuZy4gVHJpY2sgUGxheSArNSBvbiBMUi9MUCBvdXRjb21lcylcbiAqXG4gKiBTcGVjaWFsIHBsYXlzIChUUCwgSE0sIEZHLCBQVU5ULCBUV09fUFQpIHVzZSBkaWZmZXJlbnQgZm9ybXVsYXMgXHUyMDE0IHRoZXlcbiAqIGxpdmUgaW4gcnVsZXMvc3BlY2lhbC50cyAoVE9ETykgYW5kIHByb2R1Y2UgZXZlbnRzIGRpcmVjdGx5LlxuICovXG5cbmltcG9ydCB0eXBlIHsgUmVndWxhclBsYXkgfSBmcm9tIFwiLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IE1VTFRJLCBtYXRjaHVwUXVhbGl0eSB9IGZyb20gXCIuL21hdGNodXAuanNcIjtcblxuZXhwb3J0IHR5cGUgTXVsdGlwbGllckNhcmRJbmRleCA9IDAgfCAxIHwgMiB8IDM7XG5leHBvcnQgY29uc3QgTVVMVElQTElFUl9DQVJEX05BTUVTID0gW1wiS2luZ1wiLCBcIlF1ZWVuXCIsIFwiSmFja1wiLCBcIjEwXCJdIGFzIGNvbnN0O1xuZXhwb3J0IHR5cGUgTXVsdGlwbGllckNhcmROYW1lID0gKHR5cGVvZiBNVUxUSVBMSUVSX0NBUkRfTkFNRVMpW251bWJlcl07XG5cbmV4cG9ydCBpbnRlcmZhY2UgWWFyZGFnZUlucHV0cyB7XG4gIG9mZmVuc2U6IFJlZ3VsYXJQbGF5O1xuICBkZWZlbnNlOiBSZWd1bGFyUGxheTtcbiAgLyoqIE11bHRpcGxpZXIgY2FyZCBpbmRleDogMD1LaW5nLCAxPVF1ZWVuLCAyPUphY2ssIDM9MTAuICovXG4gIG11bHRpcGxpZXJDYXJkOiBNdWx0aXBsaWVyQ2FyZEluZGV4O1xuICAvKiogWWFyZHMgY2FyZCBkcmF3biwgMS0xMC4gKi9cbiAgeWFyZHNDYXJkOiBudW1iZXI7XG4gIC8qKiBCb251cyB5YXJkcyBmcm9tIHNwZWNpYWwtcGxheSBvdmVybGF5cyAoZS5nLiBUcmljayBQbGF5ICs1KS4gKi9cbiAgYm9udXM/OiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgWWFyZGFnZU91dGNvbWUge1xuICBtYXRjaHVwUXVhbGl0eTogbnVtYmVyO1xuICBtdWx0aXBsaWVyOiBudW1iZXI7XG4gIG11bHRpcGxpZXJDYXJkTmFtZTogTXVsdGlwbGllckNhcmROYW1lO1xuICB5YXJkc0dhaW5lZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY29tcHV0ZVlhcmRhZ2UoaW5wdXRzOiBZYXJkYWdlSW5wdXRzKTogWWFyZGFnZU91dGNvbWUge1xuICBjb25zdCBxdWFsaXR5ID0gbWF0Y2h1cFF1YWxpdHkoaW5wdXRzLm9mZmVuc2UsIGlucHV0cy5kZWZlbnNlKTtcbiAgY29uc3QgbXVsdGlSb3cgPSBNVUxUSVtpbnB1dHMubXVsdGlwbGllckNhcmRdO1xuICBpZiAoIW11bHRpUm93KSB0aHJvdyBuZXcgRXJyb3IoYHVucmVhY2hhYmxlOiBiYWQgbXVsdGkgY2FyZCAke2lucHV0cy5tdWx0aXBsaWVyQ2FyZH1gKTtcbiAgY29uc3QgbXVsdGlwbGllciA9IG11bHRpUm93W3F1YWxpdHkgLSAxXTtcbiAgaWYgKG11bHRpcGxpZXIgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKGB1bnJlYWNoYWJsZTogYmFkIHF1YWxpdHkgJHtxdWFsaXR5fWApO1xuXG4gIGNvbnN0IGJvbnVzID0gaW5wdXRzLmJvbnVzID8/IDA7XG4gIGNvbnN0IHlhcmRzR2FpbmVkID0gTWF0aC5yb3VuZChtdWx0aXBsaWVyICogaW5wdXRzLnlhcmRzQ2FyZCkgKyBib251cztcblxuICByZXR1cm4ge1xuICAgIG1hdGNodXBRdWFsaXR5OiBxdWFsaXR5LFxuICAgIG11bHRpcGxpZXIsXG4gICAgbXVsdGlwbGllckNhcmROYW1lOiBNVUxUSVBMSUVSX0NBUkRfTkFNRVNbaW5wdXRzLm11bHRpcGxpZXJDYXJkXSxcbiAgICB5YXJkc0dhaW5lZCxcbiAgfTtcbn1cbiIsICIvKipcbiAqIENhcmQtZGVjayBkcmF3cyBcdTIwMTQgcHVyZSB2ZXJzaW9ucyBvZiB2NS4xJ3MgYEdhbWUuZGVjTXVsdHNgIGFuZCBgR2FtZS5kZWNZYXJkc2AuXG4gKlxuICogVGhlIGRlY2sgaXMgcmVwcmVzZW50ZWQgYXMgYW4gYXJyYXkgb2YgcmVtYWluaW5nIGNvdW50cyBwZXIgY2FyZCBzbG90LlxuICogVG8gZHJhdywgd2UgcGljayBhIHVuaWZvcm0gcmFuZG9tIHNsb3Q7IGlmIHRoYXQgc2xvdCBpcyBlbXB0eSwgd2UgcmV0cnkuXG4gKiBUaGlzIGlzIG1hdGhlbWF0aWNhbGx5IGVxdWl2YWxlbnQgdG8gc2h1ZmZsaW5nIHRoZSByZW1haW5pbmcgY2FyZHMgYW5kXG4gKiBkcmF3aW5nIG9uZSBcdTIwMTQgYW5kIG1hdGNoZXMgdjUuMSdzIGJlaGF2aW9yIHZlcmJhdGltLlxuICpcbiAqIFdoZW4gdGhlIGRlY2sgaXMgZXhoYXVzdGVkLCB0aGUgY29uc3VtZXIgKHRoZSByZWR1Y2VyKSByZWZpbGxzIGl0IGFuZFxuICogZW1pdHMgYSBERUNLX1NIVUZGTEVEIGV2ZW50LlxuICovXG5cbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBEZWNrU3RhdGUgfSBmcm9tIFwiLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7XG4gIGZyZXNoRGVja011bHRpcGxpZXJzLFxuICBmcmVzaERlY2tZYXJkcyxcbn0gZnJvbSBcIi4uL3N0YXRlLmpzXCI7XG5pbXBvcnQge1xuICBNVUxUSVBMSUVSX0NBUkRfTkFNRVMsXG4gIHR5cGUgTXVsdGlwbGllckNhcmRJbmRleCxcbiAgdHlwZSBNdWx0aXBsaWVyQ2FyZE5hbWUsXG59IGZyb20gXCIuL3lhcmRhZ2UuanNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBNdWx0aXBsaWVyRHJhdyB7XG4gIGNhcmQ6IE11bHRpcGxpZXJDYXJkTmFtZTtcbiAgaW5kZXg6IE11bHRpcGxpZXJDYXJkSW5kZXg7XG4gIGRlY2s6IERlY2tTdGF0ZTtcbiAgcmVzaHVmZmxlZDogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRyYXdNdWx0aXBsaWVyKGRlY2s6IERlY2tTdGF0ZSwgcm5nOiBSbmcpOiBNdWx0aXBsaWVyRHJhdyB7XG4gIGNvbnN0IG11bHRzID0gWy4uLmRlY2subXVsdGlwbGllcnNdIGFzIFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdO1xuXG4gIGxldCBpbmRleDogTXVsdGlwbGllckNhcmRJbmRleDtcbiAgLy8gUmVqZWN0aW9uLXNhbXBsZSB0byBkcmF3IHVuaWZvcm1seSBhY3Jvc3MgcmVtYWluaW5nIGNhcmRzLlxuICAvLyBMb29wIGlzIGJvdW5kZWQgXHUyMDE0IHRvdGFsIGNhcmRzIGluIGZyZXNoIGRlY2sgaXMgMTUuXG4gIGZvciAoOzspIHtcbiAgICBjb25zdCBpID0gcm5nLmludEJldHdlZW4oMCwgMykgYXMgTXVsdGlwbGllckNhcmRJbmRleDtcbiAgICBpZiAobXVsdHNbaV0gPiAwKSB7XG4gICAgICBpbmRleCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICBtdWx0c1tpbmRleF0tLTtcblxuICBsZXQgcmVzaHVmZmxlZCA9IGZhbHNlO1xuICBsZXQgbmV4dERlY2s6IERlY2tTdGF0ZSA9IHsgLi4uZGVjaywgbXVsdGlwbGllcnM6IG11bHRzIH07XG4gIGlmIChtdWx0cy5ldmVyeSgoYykgPT4gYyA9PT0gMCkpIHtcbiAgICByZXNodWZmbGVkID0gdHJ1ZTtcbiAgICBuZXh0RGVjayA9IHsgLi4ubmV4dERlY2ssIG11bHRpcGxpZXJzOiBmcmVzaERlY2tNdWx0aXBsaWVycygpIH07XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGNhcmQ6IE1VTFRJUExJRVJfQ0FSRF9OQU1FU1tpbmRleF0sXG4gICAgaW5kZXgsXG4gICAgZGVjazogbmV4dERlY2ssXG4gICAgcmVzaHVmZmxlZCxcbiAgfTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBZYXJkc0RyYXcge1xuICAvKiogWWFyZHMgY2FyZCB2YWx1ZSwgMS0xMC4gKi9cbiAgY2FyZDogbnVtYmVyO1xuICBkZWNrOiBEZWNrU3RhdGU7XG4gIHJlc2h1ZmZsZWQ6IGJvb2xlYW47XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkcmF3WWFyZHMoZGVjazogRGVja1N0YXRlLCBybmc6IFJuZyk6IFlhcmRzRHJhdyB7XG4gIGNvbnN0IHlhcmRzID0gWy4uLmRlY2sueWFyZHNdO1xuXG4gIGxldCBpbmRleDogbnVtYmVyO1xuICBmb3IgKDs7KSB7XG4gICAgY29uc3QgaSA9IHJuZy5pbnRCZXR3ZWVuKDAsIHlhcmRzLmxlbmd0aCAtIDEpO1xuICAgIGNvbnN0IHNsb3QgPSB5YXJkc1tpXTtcbiAgICBpZiAoc2xvdCAhPT0gdW5kZWZpbmVkICYmIHNsb3QgPiAwKSB7XG4gICAgICBpbmRleCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICB5YXJkc1tpbmRleF0gPSAoeWFyZHNbaW5kZXhdID8/IDApIC0gMTtcblxuICBsZXQgcmVzaHVmZmxlZCA9IGZhbHNlO1xuICBsZXQgbmV4dERlY2s6IERlY2tTdGF0ZSA9IHsgLi4uZGVjaywgeWFyZHMgfTtcbiAgaWYgKHlhcmRzLmV2ZXJ5KChjKSA9PiBjID09PSAwKSkge1xuICAgIHJlc2h1ZmZsZWQgPSB0cnVlO1xuICAgIG5leHREZWNrID0geyAuLi5uZXh0RGVjaywgeWFyZHM6IGZyZXNoRGVja1lhcmRzKCkgfTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgY2FyZDogaW5kZXggKyAxLFxuICAgIGRlY2s6IG5leHREZWNrLFxuICAgIHJlc2h1ZmZsZWQsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBSZWd1bGFyLXBsYXkgcmVzb2x1dGlvbi4gU3BlY2lhbCBwbGF5cyAoVFAsIEhNLCBGRywgUFVOVCwgVFdPX1BUKSBicmFuY2hcbiAqIGVsc2V3aGVyZSBcdTIwMTQgc2VlIHJ1bGVzL3NwZWNpYWwudHMgKFRPRE8pLlxuICpcbiAqIEdpdmVuIHR3byBwaWNrcyAob2ZmZW5zZSArIGRlZmVuc2UpIGFuZCB0aGUgY3VycmVudCBzdGF0ZSwgcHJvZHVjZSBhIG5ld1xuICogc3RhdGUgYW5kIHRoZSBldmVudCBzdHJlYW0gZm9yIHRoZSBwbGF5LlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBQbGF5Q2FsbCwgUmVndWxhclBsYXkgfSBmcm9tIFwiLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IGRyYXdNdWx0aXBsaWVyLCBkcmF3WWFyZHMgfSBmcm9tIFwiLi9kZWNrLmpzXCI7XG5pbXBvcnQgeyBjb21wdXRlWWFyZGFnZSB9IGZyb20gXCIuL3lhcmRhZ2UuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi9zdGF0ZS5qc1wiO1xuXG5jb25zdCBSRUdVTEFSOiBSZWFkb25seVNldDxQbGF5Q2FsbD4gPSBuZXcgU2V0KFtcIlNSXCIsIFwiTFJcIiwgXCJTUFwiLCBcIkxQXCJdKTtcblxuZXhwb3J0IGZ1bmN0aW9uIGlzUmVndWxhclBsYXkocDogUGxheUNhbGwpOiBwIGlzIFJlZ3VsYXJQbGF5IHtcbiAgcmV0dXJuIFJFR1VMQVIuaGFzKHApO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJlc29sdmVJbnB1dCB7XG4gIG9mZmVuc2VQbGF5OiBQbGF5Q2FsbDtcbiAgZGVmZW5zZVBsYXk6IFBsYXlDYWxsO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFBsYXlSZXNvbHV0aW9uIHtcbiAgc3RhdGU6IEdhbWVTdGF0ZTtcbiAgZXZlbnRzOiBFdmVudFtdO1xufVxuXG4vKipcbiAqIFJlc29sdmUgYSByZWd1bGFyIHZzIHJlZ3VsYXIgcGxheS4gQ2FsbGVyICh0aGUgcmVkdWNlcikgcm91dGVzIHRvIHNwZWNpYWxcbiAqIHBsYXkgaGFuZGxlcnMgaWYgZWl0aGVyIHBpY2sgaXMgbm9uLXJlZ3VsYXIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUmVndWxhclBsYXkoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIGlucHV0OiBSZXNvbHZlSW5wdXQsXG4gIHJuZzogUm5nLFxuKTogUGxheVJlc29sdXRpb24ge1xuICBpZiAoIWlzUmVndWxhclBsYXkoaW5wdXQub2ZmZW5zZVBsYXkpIHx8ICFpc1JlZ3VsYXJQbGF5KGlucHV0LmRlZmVuc2VQbGF5KSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcInJlc29sdmVSZWd1bGFyUGxheSBjYWxsZWQgd2l0aCBhIG5vbi1yZWd1bGFyIHBsYXlcIik7XG4gIH1cblxuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcblxuICAvLyBEcmF3IGNhcmRzLlxuICBjb25zdCBtdWx0RHJhdyA9IGRyYXdNdWx0aXBsaWVyKHN0YXRlLmRlY2ssIHJuZyk7XG4gIGlmIChtdWx0RHJhdy5yZXNodWZmbGVkKSB7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJtdWx0aXBsaWVyXCIgfSk7XG4gIH1cbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKG11bHREcmF3LmRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkge1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcbiAgfVxuXG4gIC8vIENvbXB1dGUgeWFyZGFnZS5cbiAgY29uc3Qgb3V0Y29tZSA9IGNvbXB1dGVZYXJkYWdlKHtcbiAgICBvZmZlbnNlOiBpbnB1dC5vZmZlbnNlUGxheSxcbiAgICBkZWZlbnNlOiBpbnB1dC5kZWZlbnNlUGxheSxcbiAgICBtdWx0aXBsaWVyQ2FyZDogbXVsdERyYXcuaW5kZXgsXG4gICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgfSk7XG5cbiAgLy8gRGVjcmVtZW50IG9mZmVuc2UncyBoYW5kIGZvciB0aGUgcGxheSB0aGV5IHVzZWQuIFJlZmlsbCBhdCB6ZXJvIFx1MjAxNCB0aGVcbiAgLy8gZXhhY3QgMTItY2FyZCByZXNodWZmbGUgYmVoYXZpb3IgbGl2ZXMgaW4gYGRlY3JlbWVudEhhbmRgLlxuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtvZmZlbnNlXTogZGVjcmVtZW50SGFuZChzdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLCBpbnB1dC5vZmZlbnNlUGxheSksXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcblxuICAvLyBBcHBseSB5YXJkYWdlIHRvIGJhbGwgcG9zaXRpb24uIENsYW1wIGF0IDEwMCAoVEQpIGFuZCAwIChzYWZldHkpLlxuICBjb25zdCBwcm9qZWN0ZWQgPSBzdGF0ZS5maWVsZC5iYWxsT24gKyBvdXRjb21lLnlhcmRzR2FpbmVkO1xuICBsZXQgbmV3QmFsbE9uID0gcHJvamVjdGVkO1xuICBsZXQgc2NvcmVkOiBcInRkXCIgfCBcInNhZmV0eVwiIHwgbnVsbCA9IG51bGw7XG4gIGlmIChwcm9qZWN0ZWQgPj0gMTAwKSB7XG4gICAgbmV3QmFsbE9uID0gMTAwO1xuICAgIHNjb3JlZCA9IFwidGRcIjtcbiAgfSBlbHNlIGlmIChwcm9qZWN0ZWQgPD0gMCkge1xuICAgIG5ld0JhbGxPbiA9IDA7XG4gICAgc2NvcmVkID0gXCJzYWZldHlcIjtcbiAgfVxuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICBvZmZlbnNlUGxheTogaW5wdXQub2ZmZW5zZVBsYXksXG4gICAgZGVmZW5zZVBsYXk6IGlucHV0LmRlZmVuc2VQbGF5LFxuICAgIG1hdGNodXBRdWFsaXR5OiBvdXRjb21lLm1hdGNodXBRdWFsaXR5LFxuICAgIG11bHRpcGxpZXI6IHsgY2FyZDogb3V0Y29tZS5tdWx0aXBsaWVyQ2FyZE5hbWUsIHZhbHVlOiBvdXRjb21lLm11bHRpcGxpZXIgfSxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgIHlhcmRzR2FpbmVkOiBvdXRjb21lLnlhcmRzR2FpbmVkLFxuICAgIG5ld0JhbGxPbixcbiAgfSk7XG5cbiAgLy8gU2NvcmUgaGFuZGxpbmcuXG4gIGlmIChzY29yZWQgPT09IFwidGRcIikge1xuICAgIHJldHVybiB0b3VjaGRvd25TdGF0ZShcbiAgICAgIHsgLi4uc3RhdGUsIGRlY2s6IHlhcmRzRHJhdy5kZWNrLCBwbGF5ZXJzOiBuZXdQbGF5ZXJzLCBwZW5kaW5nUGljazogYmxhbmtQaWNrKCkgfSxcbiAgICAgIG9mZmVuc2UsXG4gICAgICBldmVudHMsXG4gICAgKTtcbiAgfVxuICBpZiAoc2NvcmVkID09PSBcInNhZmV0eVwiKSB7XG4gICAgcmV0dXJuIHNhZmV0eVN0YXRlKFxuICAgICAgeyAuLi5zdGF0ZSwgZGVjazogeWFyZHNEcmF3LmRlY2ssIHBsYXllcnM6IG5ld1BsYXllcnMsIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSB9LFxuICAgICAgb2ZmZW5zZSxcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgLy8gRG93bi9kaXN0YW5jZSBoYW5kbGluZy5cbiAgY29uc3QgcmVhY2hlZEZpcnN0RG93biA9IG5ld0JhbGxPbiA+PSBzdGF0ZS5maWVsZC5maXJzdERvd25BdDtcbiAgbGV0IG5leHREb3duID0gc3RhdGUuZmllbGQuZG93bjtcbiAgbGV0IG5leHRGaXJzdERvd25BdCA9IHN0YXRlLmZpZWxkLmZpcnN0RG93bkF0O1xuICBsZXQgcG9zc2Vzc2lvbkZsaXBwZWQgPSBmYWxzZTtcblxuICBpZiAocmVhY2hlZEZpcnN0RG93bikge1xuICAgIG5leHREb3duID0gMTtcbiAgICBuZXh0Rmlyc3REb3duQXQgPSBNYXRoLm1pbigxMDAsIG5ld0JhbGxPbiArIDEwKTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiRklSU1RfRE9XTlwiIH0pO1xuICB9IGVsc2UgaWYgKHN0YXRlLmZpZWxkLmRvd24gPT09IDQpIHtcbiAgICAvLyBUdXJub3ZlciBvbiBkb3ducyBcdTIwMTQgcG9zc2Vzc2lvbiBmbGlwcywgYmFsbCBzdGF5cy5cbiAgICBuZXh0RG93biA9IDE7XG4gICAgcG9zc2Vzc2lvbkZsaXBwZWQgPSB0cnVlO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUl9PTl9ET1dOU1wiIH0pO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiZG93bnNcIiB9KTtcbiAgfSBlbHNlIHtcbiAgICBuZXh0RG93biA9IChzdGF0ZS5maWVsZC5kb3duICsgMSkgYXMgMSB8IDIgfCAzIHwgNDtcbiAgfVxuXG4gIGNvbnN0IG5leHRPZmZlbnNlID0gcG9zc2Vzc2lvbkZsaXBwZWQgPyBvcHAob2ZmZW5zZSkgOiBvZmZlbnNlO1xuICBjb25zdCBuZXh0QmFsbE9uID0gcG9zc2Vzc2lvbkZsaXBwZWQgPyAxMDAgLSBuZXdCYWxsT24gOiBuZXdCYWxsT247XG4gIGNvbnN0IG5leHRGaXJzdERvd24gPSBwb3NzZXNzaW9uRmxpcHBlZFxuICAgID8gTWF0aC5taW4oMTAwLCBuZXh0QmFsbE9uICsgMTApXG4gICAgOiBuZXh0Rmlyc3REb3duQXQ7XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBkZWNrOiB5YXJkc0RyYXcuZGVjayxcbiAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IG5leHRCYWxsT24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBuZXh0Rmlyc3REb3duLFxuICAgICAgICBkb3duOiBuZXh0RG93bixcbiAgICAgICAgb2ZmZW5zZTogbmV4dE9mZmVuc2UsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG5mdW5jdGlvbiBibGFua1BpY2soKTogR2FtZVN0YXRlW1wicGVuZGluZ1BpY2tcIl0ge1xuICByZXR1cm4geyBvZmZlbnNlUGxheTogbnVsbCwgZGVmZW5zZVBsYXk6IG51bGwgfTtcbn1cblxuLyoqXG4gKiBUb3VjaGRvd24gYm9va2tlZXBpbmcgXHUyMDE0IDYgcG9pbnRzLCB0cmFuc2l0aW9uIHRvIFBBVF9DSE9JQ0UgcGhhc2UuXG4gKiAoUEFULzJwdCByZXNvbHV0aW9uIGFuZCBlbnN1aW5nIGtpY2tvZmYgaGFwcGVuIGluIHN1YnNlcXVlbnQgYWN0aW9ucy4pXG4gKi9cbmZ1bmN0aW9uIHRvdWNoZG93blN0YXRlKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBzY29yZXI6IEdhbWVTdGF0ZVtcImZpZWxkXCJdW1wib2ZmZW5zZVwiXSxcbiAgZXZlbnRzOiBFdmVudFtdLFxuKTogUGxheVJlc29sdXRpb24ge1xuICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgW3Njb3Jlcl06IHsgLi4uc3RhdGUucGxheWVyc1tzY29yZXJdLCBzY29yZTogc3RhdGUucGxheWVyc1tzY29yZXJdLnNjb3JlICsgNiB9LFxuICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUT1VDSERPV05cIiwgc2NvcmluZ1BsYXllcjogc2NvcmVyIH0pO1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7IC4uLnN0YXRlLCBwbGF5ZXJzOiBuZXdQbGF5ZXJzLCBwaGFzZTogXCJQQVRfQ0hPSUNFXCIgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG5cbi8qKlxuICogU2FmZXR5IFx1MjAxNCBkZWZlbnNlIHNjb3JlcyAyLCBvZmZlbnNlIGtpY2tzIGZyZWUga2ljay5cbiAqIEZvciB0aGUgc2tldGNoIHdlIHNjb3JlIGFuZCBlbWl0OyB0aGUga2lja29mZiB0cmFuc2l0aW9uIGlzIFRPRE8uXG4gKi9cbmZ1bmN0aW9uIHNhZmV0eVN0YXRlKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBjb25jZWRlcjogR2FtZVN0YXRlW1wiZmllbGRcIl1bXCJvZmZlbnNlXCJdLFxuICBldmVudHM6IEV2ZW50W10sXG4pOiBQbGF5UmVzb2x1dGlvbiB7XG4gIGNvbnN0IHNjb3JlciA9IG9wcChjb25jZWRlcik7XG4gIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgLi4uc3RhdGUucGxheWVycyxcbiAgICBbc2NvcmVyXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0uc2NvcmUgKyAyIH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlNBRkVUWVwiLCBzY29yaW5nUGxheWVyOiBzY29yZXIgfSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHsgLi4uc3RhdGUsIHBsYXllcnM6IG5ld1BsYXllcnMsIHBoYXNlOiBcIktJQ0tPRkZcIiB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuLyoqXG4gKiBEZWNyZW1lbnQgdGhlIGNob3NlbiBwbGF5IGluIGEgcGxheWVyJ3MgaGFuZC4gSWYgdGhlIHJlZ3VsYXItcGxheSBjYXJkc1xuICogKFNSL0xSL1NQL0xQKSBhcmUgYWxsIGV4aGF1c3RlZCwgcmVmaWxsIHRoZW0gXHUyMDE0IEhhaWwgTWFyeSBjb3VudCBpc1xuICogcHJlc2VydmVkIGFjcm9zcyByZWZpbGxzIChtYXRjaGVzIHY1LjEgUGxheWVyLmZpbGxQbGF5cygncCcpKS5cbiAqL1xuZnVuY3Rpb24gZGVjcmVtZW50SGFuZChcbiAgcGxheWVyOiBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdWzFdLFxuICBwbGF5OiBQbGF5Q2FsbCxcbik6IEdhbWVTdGF0ZVtcInBsYXllcnNcIl1bMV0ge1xuICBjb25zdCBoYW5kID0geyAuLi5wbGF5ZXIuaGFuZCB9O1xuXG4gIGlmIChwbGF5ID09PSBcIkhNXCIpIHtcbiAgICBoYW5kLkhNID0gTWF0aC5tYXgoMCwgaGFuZC5ITSAtIDEpO1xuICAgIHJldHVybiB7IC4uLnBsYXllciwgaGFuZCB9O1xuICB9XG5cbiAgaWYgKHBsYXkgPT09IFwiRkdcIiB8fCBwbGF5ID09PSBcIlBVTlRcIiB8fCBwbGF5ID09PSBcIlRXT19QVFwiKSB7XG4gICAgLy8gTm8gY2FyZCBjb25zdW1lZCBcdTIwMTQgdGhlc2UgYXJlIHNpdHVhdGlvbmFsIGRlY2lzaW9ucywgbm90IGRyYXdzLlxuICAgIHJldHVybiBwbGF5ZXI7XG4gIH1cblxuICBoYW5kW3BsYXldID0gTWF0aC5tYXgoMCwgaGFuZFtwbGF5XSAtIDEpO1xuXG4gIGNvbnN0IHJlZ3VsYXJFeGhhdXN0ZWQgPVxuICAgIGhhbmQuU1IgPT09IDAgJiYgaGFuZC5MUiA9PT0gMCAmJiBoYW5kLlNQID09PSAwICYmIGhhbmQuTFAgPT09IDAgJiYgaGFuZC5UUCA9PT0gMDtcblxuICBpZiAocmVndWxhckV4aGF1c3RlZCkge1xuICAgIHJldHVybiB7XG4gICAgICAuLi5wbGF5ZXIsXG4gICAgICBoYW5kOiB7IFNSOiAzLCBMUjogMywgU1A6IDMsIExQOiAzLCBUUDogMSwgSE06IGhhbmQuSE0gfSxcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIHsgLi4ucGxheWVyLCBoYW5kIH07XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgcHJpbWl0aXZlcyB1c2VkIGJ5IG11bHRpcGxlIHNwZWNpYWwtcGxheSByZXNvbHZlcnMuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBQbGF5ZXJJZCB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4uLy4uL3N0YXRlLmpzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3BlY2lhbFJlc29sdXRpb24ge1xuICBzdGF0ZTogR2FtZVN0YXRlO1xuICBldmVudHM6IEV2ZW50W107XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBibGFua1BpY2soKTogR2FtZVN0YXRlW1wicGVuZGluZ1BpY2tcIl0ge1xuICByZXR1cm4geyBvZmZlbnNlUGxheTogbnVsbCwgZGVmZW5zZVBsYXk6IG51bGwgfTtcbn1cblxuLyoqXG4gKiBBd2FyZCBwb2ludHMsIGZsaXAgdG8gUEFUX0NIT0lDRS4gQ2FsbGVyIGVtaXRzIFRPVUNIRE9XTi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5VG91Y2hkb3duKFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBzY29yZXI6IFBsYXllcklkLFxuICBldmVudHM6IEV2ZW50W10sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgLi4uc3RhdGUucGxheWVycyxcbiAgICBbc2NvcmVyXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW3Njb3Jlcl0uc2NvcmUgKyA2IH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRPVUNIRE9XTlwiLCBzY29yaW5nUGxheWVyOiBzY29yZXIgfSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIHBoYXNlOiBcIlBBVF9DSE9JQ0VcIixcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5U2FmZXR5KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBjb25jZWRlcjogUGxheWVySWQsXG4gIGV2ZW50czogRXZlbnRbXSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgc2NvcmVyID0gb3BwKGNvbmNlZGVyKTtcbiAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtzY29yZXJdOiB7IC4uLnN0YXRlLnBsYXllcnNbc2NvcmVyXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbc2NvcmVyXS5zY29yZSArIDIgfSxcbiAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiU0FGRVRZXCIsIHNjb3JpbmdQbGF5ZXI6IHNjb3JlciB9KTtcbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG4vKipcbiAqIEFwcGx5IGEgeWFyZGFnZSBvdXRjb21lIHdpdGggZnVsbCBkb3duL3R1cm5vdmVyL3Njb3JlIGJvb2trZWVwaW5nLlxuICogVXNlZCBieSBzcGVjaWFscyB0aGF0IHByb2R1Y2UgeWFyZGFnZSBkaXJlY3RseSAoSGFpbCBNYXJ5LCBCaWcgUGxheSByZXR1cm4pLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlZYXJkYWdlT3V0Y29tZShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgeWFyZHM6IG51bWJlcixcbiAgZXZlbnRzOiBFdmVudFtdLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgcHJvamVjdGVkID0gc3RhdGUuZmllbGQuYmFsbE9uICsgeWFyZHM7XG5cbiAgaWYgKHByb2plY3RlZCA+PSAxMDApIHJldHVybiBhcHBseVRvdWNoZG93bihzdGF0ZSwgb2ZmZW5zZSwgZXZlbnRzKTtcbiAgaWYgKHByb2plY3RlZCA8PSAwKSByZXR1cm4gYXBwbHlTYWZldHkoc3RhdGUsIG9mZmVuc2UsIGV2ZW50cyk7XG5cbiAgY29uc3QgcmVhY2hlZEZpcnN0RG93biA9IHByb2plY3RlZCA+PSBzdGF0ZS5maWVsZC5maXJzdERvd25BdDtcbiAgbGV0IG5leHREb3duID0gc3RhdGUuZmllbGQuZG93bjtcbiAgbGV0IG5leHRGaXJzdERvd25BdCA9IHN0YXRlLmZpZWxkLmZpcnN0RG93bkF0O1xuICBsZXQgcG9zc2Vzc2lvbkZsaXBwZWQgPSBmYWxzZTtcblxuICBpZiAocmVhY2hlZEZpcnN0RG93bikge1xuICAgIG5leHREb3duID0gMTtcbiAgICBuZXh0Rmlyc3REb3duQXQgPSBNYXRoLm1pbigxMDAsIHByb2plY3RlZCArIDEwKTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiRklSU1RfRE9XTlwiIH0pO1xuICB9IGVsc2UgaWYgKHN0YXRlLmZpZWxkLmRvd24gPT09IDQpIHtcbiAgICBwb3NzZXNzaW9uRmxpcHBlZCA9IHRydWU7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSX09OX0RPV05TXCIgfSk7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJkb3duc1wiIH0pO1xuICB9IGVsc2Uge1xuICAgIG5leHREb3duID0gKHN0YXRlLmZpZWxkLmRvd24gKyAxKSBhcyAxIHwgMiB8IDMgfCA0O1xuICB9XG5cbiAgY29uc3QgbWlycm9yZWRCYWxsT24gPSBwb3NzZXNzaW9uRmxpcHBlZCA/IDEwMCAtIHByb2plY3RlZCA6IHByb2plY3RlZDtcblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogbWlycm9yZWRCYWxsT24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBwb3NzZXNzaW9uRmxpcHBlZFxuICAgICAgICAgID8gTWF0aC5taW4oMTAwLCBtaXJyb3JlZEJhbGxPbiArIDEwKVxuICAgICAgICAgIDogbmV4dEZpcnN0RG93bkF0LFxuICAgICAgICBkb3duOiBwb3NzZXNzaW9uRmxpcHBlZCA/IDEgOiBuZXh0RG93bixcbiAgICAgICAgb2ZmZW5zZTogcG9zc2Vzc2lvbkZsaXBwZWQgPyBvcHAob2ZmZW5zZSkgOiBvZmZlbnNlLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cbiIsICIvKipcbiAqIEJpZyBQbGF5IHJlc29sdXRpb24gKHJ1bi5qczoxOTMzKS5cbiAqXG4gKiBUcmlnZ2VyZWQgYnk6XG4gKiAgIC0gVHJpY2sgUGxheSBkaWU9NVxuICogICAtIFNhbWUgUGxheSBLaW5nIG91dGNvbWVcbiAqICAgLSBPdGhlciBmdXR1cmUgaG9va3NcbiAqXG4gKiBUaGUgYmVuZWZpY2lhcnkgYXJndW1lbnQgc2F5cyB3aG8gYmVuZWZpdHMgXHUyMDE0IHRoaXMgY2FuIGJlIG9mZmVuc2UgT1JcbiAqIGRlZmVuc2UgKGRpZmZlcmVudCBvdXRjb21lIHRhYmxlcykuXG4gKlxuICogT2ZmZW5zaXZlIEJpZyBQbGF5IChvZmZlbnNlIGJlbmVmaXRzKTpcbiAqICAgZGllIDEtMyBcdTIxOTIgKzI1IHlhcmRzXG4gKiAgIGRpZSA0LTUgXHUyMTkyIG1heChoYWxmLXRvLWdvYWwsIDQwKSB5YXJkc1xuICogICBkaWUgNiAgIFx1MjE5MiBUb3VjaGRvd25cbiAqXG4gKiBEZWZlbnNpdmUgQmlnIFBsYXkgKGRlZmVuc2UgYmVuZWZpdHMpOlxuICogICBkaWUgMS0zIFx1MjE5MiAxMC15YXJkIHBlbmFsdHkgb24gb2ZmZW5zZSAocmVwZWF0IGRvd24pLCBoYWxmLXRvLWdvYWwgaWYgdGlnaHRcbiAqICAgZGllIDQtNSBcdTIxOTIgRlVNQkxFIFx1MjE5MiB0dXJub3ZlciArIGRlZmVuc2UgcmV0dXJucyBtYXgoaGFsZiwgMjUpXG4gKiAgIGRpZSA2ICAgXHUyMTkyIEZVTUJMRSBcdTIxOTIgZGVmZW5zaXZlIFREXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUsIFBsYXllcklkIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7XG4gIGFwcGx5U2FmZXR5LFxuICBhcHBseVRvdWNoZG93bixcbiAgYmxhbmtQaWNrLFxuICB0eXBlIFNwZWNpYWxSZXNvbHV0aW9uLFxufSBmcm9tIFwiLi9zaGFyZWQuanNcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVCaWdQbGF5KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBiZW5lZmljaWFyeTogUGxheWVySWQsXG4gIHJuZzogUm5nLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgZGllID0gcm5nLmQ2KCk7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFt7IHR5cGU6IFwiQklHX1BMQVlcIiwgYmVuZWZpY2lhcnksIHN1YnJvbGw6IGRpZSB9XTtcblxuICBpZiAoYmVuZWZpY2lhcnkgPT09IG9mZmVuc2UpIHtcbiAgICByZXR1cm4gb2ZmZW5zaXZlQmlnUGxheShzdGF0ZSwgb2ZmZW5zZSwgZGllLCBldmVudHMpO1xuICB9XG4gIHJldHVybiBkZWZlbnNpdmVCaWdQbGF5KHN0YXRlLCBvZmZlbnNlLCBkaWUsIGV2ZW50cyk7XG59XG5cbmZ1bmN0aW9uIG9mZmVuc2l2ZUJpZ1BsYXkoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIG9mZmVuc2U6IFBsYXllcklkLFxuICBkaWU6IDEgfCAyIHwgMyB8IDQgfCA1IHwgNixcbiAgZXZlbnRzOiBFdmVudFtdLFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBpZiAoZGllID09PSA2KSB7XG4gICAgcmV0dXJuIGFwcGx5VG91Y2hkb3duKHN0YXRlLCBvZmZlbnNlLCBldmVudHMpO1xuICB9XG5cbiAgLy8gZGllIDEtMzogKzI1OyBkaWUgNC01OiBtYXgoaGFsZi10by1nb2FsLCA0MClcbiAgbGV0IGdhaW46IG51bWJlcjtcbiAgaWYgKGRpZSA8PSAzKSB7XG4gICAgZ2FpbiA9IDI1O1xuICB9IGVsc2Uge1xuICAgIGNvbnN0IGhhbGZUb0dvYWwgPSBNYXRoLnJvdW5kKCgxMDAgLSBzdGF0ZS5maWVsZC5iYWxsT24pIC8gMik7XG4gICAgZ2FpbiA9IGhhbGZUb0dvYWwgPiA0MCA/IGhhbGZUb0dvYWwgOiA0MDtcbiAgfVxuXG4gIGNvbnN0IHByb2plY3RlZCA9IHN0YXRlLmZpZWxkLmJhbGxPbiArIGdhaW47XG4gIGlmIChwcm9qZWN0ZWQgPj0gMTAwKSB7XG4gICAgcmV0dXJuIGFwcGx5VG91Y2hkb3duKHN0YXRlLCBvZmZlbnNlLCBldmVudHMpO1xuICB9XG5cbiAgLy8gQXBwbHkgZ2FpbiwgY2hlY2sgZm9yIGZpcnN0IGRvd24uXG4gIGNvbnN0IHJlYWNoZWRGaXJzdERvd24gPSBwcm9qZWN0ZWQgPj0gc3RhdGUuZmllbGQuZmlyc3REb3duQXQ7XG4gIGNvbnN0IG5leHREb3duID0gcmVhY2hlZEZpcnN0RG93biA/IDEgOiBzdGF0ZS5maWVsZC5kb3duO1xuICBjb25zdCBuZXh0Rmlyc3REb3duQXQgPSByZWFjaGVkRmlyc3REb3duXG4gICAgPyBNYXRoLm1pbigxMDAsIHByb2plY3RlZCArIDEwKVxuICAgIDogc3RhdGUuZmllbGQuZmlyc3REb3duQXQ7XG5cbiAgaWYgKHJlYWNoZWRGaXJzdERvd24pIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJGSVJTVF9ET1dOXCIgfSk7XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0ZToge1xuICAgICAgLi4uc3RhdGUsXG4gICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICBmaWVsZDoge1xuICAgICAgICAuLi5zdGF0ZS5maWVsZCxcbiAgICAgICAgYmFsbE9uOiBwcm9qZWN0ZWQsXG4gICAgICAgIGRvd246IG5leHREb3duLFxuICAgICAgICBmaXJzdERvd25BdDogbmV4dEZpcnN0RG93bkF0LFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gZGVmZW5zaXZlQmlnUGxheShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgb2ZmZW5zZTogUGxheWVySWQsXG4gIGRpZTogMSB8IDIgfCAzIHwgNCB8IDUgfCA2LFxuICBldmVudHM6IEV2ZW50W10sXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIC8vIDEtMzogMTAteWFyZCBwZW5hbHR5LCByZXBlYXQgZG93biAobm8gZG93biBjb25zdW1lZCkuXG4gIGlmIChkaWUgPD0gMykge1xuICAgIGNvbnN0IG5haXZlUGVuYWx0eSA9IC0xMDtcbiAgICBjb25zdCBoYWxmVG9Hb2FsID0gLU1hdGguZmxvb3Ioc3RhdGUuZmllbGQuYmFsbE9uIC8gMik7XG4gICAgY29uc3QgcGVuYWx0eVlhcmRzID1cbiAgICAgIHN0YXRlLmZpZWxkLmJhbGxPbiAtIDEwIDwgMSA/IGhhbGZUb0dvYWwgOiBuYWl2ZVBlbmFsdHk7XG5cbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiUEVOQUxUWVwiLCBhZ2FpbnN0OiBvZmZlbnNlLCB5YXJkczogcGVuYWx0eVlhcmRzLCBsb3NzT2ZEb3duOiBmYWxzZSB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICAuLi5zdGF0ZS5maWVsZCxcbiAgICAgICAgICBiYWxsT246IE1hdGgubWF4KDAsIHN0YXRlLmZpZWxkLmJhbGxPbiArIHBlbmFsdHlZYXJkcyksXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyA0LTU6IHR1cm5vdmVyIHdpdGggcmV0dXJuIG9mIG1heChoYWxmLCAyNSkuIDY6IGRlZmVuc2l2ZSBURC5cbiAgY29uc3QgZGVmZW5kZXIgPSBvcHAob2ZmZW5zZSk7XG5cbiAgaWYgKGRpZSA9PT0gNikge1xuICAgIC8vIERlZmVuc2Ugc2NvcmVzIHRoZSBURC5cbiAgICBjb25zdCBuZXdQbGF5ZXJzID0ge1xuICAgICAgLi4uc3RhdGUucGxheWVycyxcbiAgICAgIFtkZWZlbmRlcl06IHsgLi4uc3RhdGUucGxheWVyc1tkZWZlbmRlcl0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW2RlZmVuZGVyXS5zY29yZSArIDYgfSxcbiAgICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJmdW1ibGVcIiB9KTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVE9VQ0hET1dOXCIsIHNjb3JpbmdQbGF5ZXI6IGRlZmVuZGVyIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBwaGFzZTogXCJQQVRfQ0hPSUNFXCIsXG4gICAgICAgIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiBkZWZlbmRlciB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gZGllIDQtNTogdHVybm92ZXIgd2l0aCByZXR1cm4uXG4gIGNvbnN0IGhhbGZUb0dvYWwgPSBNYXRoLnJvdW5kKCgxMDAgLSBzdGF0ZS5maWVsZC5iYWxsT24pIC8gMik7XG4gIGNvbnN0IHJldHVybllhcmRzID0gaGFsZlRvR29hbCA+IDI1ID8gaGFsZlRvR29hbCA6IDI1O1xuXG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiZnVtYmxlXCIgfSk7XG5cbiAgLy8gRGVmZW5zZSBiZWNvbWVzIG5ldyBvZmZlbnNlLiBCYWxsIHBvc2l0aW9uOiBvZmZlbnNlIGdhaW5lZCByZXR1cm5ZYXJkcyxcbiAgLy8gdGhlbiBmbGlwIHBlcnNwZWN0aXZlLlxuICBjb25zdCBwcm9qZWN0ZWQgPSBzdGF0ZS5maWVsZC5iYWxsT24gKyByZXR1cm5ZYXJkcztcbiAgaWYgKHByb2plY3RlZCA+PSAxMDApIHtcbiAgICAvLyBSZXR1cm5lZCBhbGwgdGhlIHdheSBcdTIwMTQgVEQgZm9yIGRlZmVuZGVyLlxuICAgIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgW2RlZmVuZGVyXTogeyAuLi5zdGF0ZS5wbGF5ZXJzW2RlZmVuZGVyXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbZGVmZW5kZXJdLnNjb3JlICsgNiB9LFxuICAgIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVE9VQ0hET1dOXCIsIHNjb3JpbmdQbGF5ZXI6IGRlZmVuZGVyIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBwaGFzZTogXCJQQVRfQ0hPSUNFXCIsXG4gICAgICAgIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBvZmZlbnNlOiBkZWZlbmRlciB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG4gIGlmIChwcm9qZWN0ZWQgPD0gMCkge1xuICAgIHJldHVybiBhcHBseVNhZmV0eShzdGF0ZSwgb2ZmZW5zZSwgZXZlbnRzKTtcbiAgfVxuXG4gIC8vIEZsaXAgcG9zc2Vzc2lvbiwgbWlycm9yIGJhbGwgcG9zaXRpb24uXG4gIGNvbnN0IG1pcnJvcmVkQmFsbE9uID0gMTAwIC0gcHJvamVjdGVkO1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogbWlycm9yZWRCYWxsT24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIG1pcnJvcmVkQmFsbE9uICsgMTApLFxuICAgICAgICBkb3duOiAxLFxuICAgICAgICBvZmZlbnNlOiBkZWZlbmRlcixcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBQdW50IChydW4uanM6MjA5MCkuIEFsc28gc2VydmVzIGZvciBzYWZldHkga2lja3MuXG4gKlxuICogU2VxdWVuY2UgKGFsbCByYW5kb21uZXNzIHRocm91Z2ggcm5nKTpcbiAqICAgMS4gQmxvY2sgY2hlY2s6IGlmIGluaXRpYWwgZDYgaXMgNiwgcm9sbCBhZ2FpbiBcdTIwMTQgMi1zaXhlcyA9IGJsb2NrZWQgKDEvMzYpLlxuICogICAyLiBJZiBub3QgYmxvY2tlZCwgZHJhdyB5YXJkcyBjYXJkICsgY29pbiBmbGlwOlxuICogICAgICAgIGtpY2tEaXN0ID0gMTAgKiB5YXJkc0NhcmQgLyAyICsgMjAgKiAoY29pbj1oZWFkcyA/IDEgOiAwKVxuICogICAgICBSZXN1bHRpbmcgcmFuZ2U6IFs1LCA3MF0geWFyZHMuXG4gKiAgIDMuIElmIGJhbGwgbGFuZHMgcGFzdCAxMDAgXHUyMTkyIHRvdWNoYmFjaywgcGxhY2UgYXQgcmVjZWl2ZXIncyAyMC5cbiAqICAgNC4gTXVmZiBjaGVjayAobm90IG9uIHRvdWNoYmFjay9ibG9jay9zYWZldHkga2ljayk6IDItc2l4ZXMgPSByZWNlaXZlclxuICogICAgICBtdWZmcywga2lja2luZyB0ZWFtIHJlY292ZXJzLlxuICogICA1LiBSZXR1cm46IGlmIHBvc3Nlc3Npb24sIGRyYXcgbXVsdENhcmQgKyB5YXJkcy5cbiAqICAgICAgICBLaW5nPTd4LCBRdWVlbj00eCwgSmFjaz0xeCwgMTA9LTAuNXhcbiAqICAgICAgICByZXR1cm4gPSByb3VuZChtdWx0ICogeWFyZHNDYXJkKVxuICogICAgICBSZXR1cm4gY2FuIHNjb3JlIFREIG9yIGNvbmNlZGUgc2FmZXR5LlxuICpcbiAqIEZvciB0aGUgZW5naW5lIHBvcnQ6IHRoaXMgaXMgdGhlIG1vc3QgcHJvY2VkdXJhbCBvZiB0aGUgc3BlY2lhbHMuIFdlXG4gKiBjb2xsZWN0IGV2ZW50cyBpbiBvcmRlciBhbmQgcHJvZHVjZSBvbmUgZmluYWwgc3RhdGUuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi8uLi9zdGF0ZS5qc1wiO1xuaW1wb3J0IHsgZHJhd011bHRpcGxpZXIsIGRyYXdZYXJkcyB9IGZyb20gXCIuLi9kZWNrLmpzXCI7XG5pbXBvcnQge1xuICBhcHBseVNhZmV0eSxcbiAgYXBwbHlUb3VjaGRvd24sXG4gIGJsYW5rUGljayxcbiAgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbixcbn0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmNvbnN0IFJFVFVSTl9NVUxUSVBMSUVSUzogUmVjb3JkPFwiS2luZ1wiIHwgXCJRdWVlblwiIHwgXCJKYWNrXCIgfCBcIjEwXCIsIG51bWJlcj4gPSB7XG4gIEtpbmc6IDcsXG4gIFF1ZWVuOiA0LFxuICBKYWNrOiAxLFxuICBcIjEwXCI6IC0wLjUsXG59O1xuXG5leHBvcnQgaW50ZXJmYWNlIFB1bnRPcHRpb25zIHtcbiAgLyoqIHRydWUgaWYgdGhpcyBpcyBhIHNhZmV0eSBraWNrIChubyBibG9jay9tdWZmIGNoZWNrcykuICovXG4gIHNhZmV0eUtpY2s/OiBib29sZWFuO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVB1bnQoXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIHJuZzogUm5nLFxuICBvcHRzOiBQdW50T3B0aW9ucyA9IHt9LFxuKTogU3BlY2lhbFJlc29sdXRpb24ge1xuICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgY29uc3QgZGVmZW5kZXIgPSBvcHAob2ZmZW5zZSk7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuICBsZXQgZGVjayA9IHN0YXRlLmRlY2s7XG5cbiAgLy8gQmxvY2sgY2hlY2sgKG5vdCBvbiBzYWZldHkga2ljaykuXG4gIGxldCBibG9ja2VkID0gZmFsc2U7XG4gIGlmICghb3B0cy5zYWZldHlLaWNrKSB7XG4gICAgaWYgKHJuZy5kNigpID09PSA2ICYmIHJuZy5kNigpID09PSA2KSB7XG4gICAgICBibG9ja2VkID0gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICBpZiAoYmxvY2tlZCkge1xuICAgIC8vIEtpY2tpbmcgdGVhbSBsb3NlcyBwb3NzZXNzaW9uIGF0IHRoZSBsaW5lIG9mIHNjcmltbWFnZS5cbiAgICBjb25zdCBtaXJyb3JlZEJhbGxPbiA9IDEwMCAtIHN0YXRlLmZpZWxkLmJhbGxPbjtcbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiUFVOVFwiLCBwbGF5ZXI6IG9mZmVuc2UsIGxhbmRpbmdTcG90OiBzdGF0ZS5maWVsZC5iYWxsT24gfSk7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJmdW1ibGVcIiB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICBiYWxsT246IG1pcnJvcmVkQmFsbE9uLFxuICAgICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIG1pcnJvcmVkQmFsbE9uICsgMTApLFxuICAgICAgICAgIGRvd246IDEsXG4gICAgICAgICAgb2ZmZW5zZTogZGVmZW5kZXIsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBEcmF3IHlhcmRzICsgY29pbiBmb3Iga2ljayBkaXN0YW5jZS5cbiAgY29uc3QgY29pbiA9IHJuZy5jb2luRmxpcCgpO1xuICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMoZGVjaywgcm5nKTtcbiAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG4gIGRlY2sgPSB5YXJkc0RyYXcuZGVjaztcblxuICBjb25zdCBraWNrRGlzdCA9ICgxMCAqIHlhcmRzRHJhdy5jYXJkKSAvIDIgKyAoY29pbiA9PT0gXCJoZWFkc1wiID8gMjAgOiAwKTtcbiAgY29uc3QgbGFuZGluZ1Nwb3QgPSBzdGF0ZS5maWVsZC5iYWxsT24gKyBraWNrRGlzdDtcbiAgY29uc3QgdG91Y2hiYWNrID0gbGFuZGluZ1Nwb3QgPiAxMDA7XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJQVU5UXCIsIHBsYXllcjogb2ZmZW5zZSwgbGFuZGluZ1Nwb3QgfSk7XG5cbiAgLy8gTXVmZiBjaGVjayAobm90IG9uIHRvdWNoYmFjaywgYmxvY2ssIHNhZmV0eSBraWNrKS5cbiAgbGV0IG11ZmZlZCA9IGZhbHNlO1xuICBpZiAoIXRvdWNoYmFjayAmJiAhb3B0cy5zYWZldHlLaWNrKSB7XG4gICAgaWYgKHJuZy5kNigpID09PSA2ICYmIHJuZy5kNigpID09PSA2KSB7XG4gICAgICBtdWZmZWQgPSB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIGlmIChtdWZmZWQpIHtcbiAgICAvLyBSZWNlaXZlciBtdWZmcywga2lja2luZyB0ZWFtIHJlY292ZXJzIHdoZXJlIHRoZSBiYWxsIGxhbmRlZC5cbiAgICAvLyBLaWNraW5nIHRlYW0gcmV0YWlucyBwb3NzZXNzaW9uIChzdGlsbCBvZmZlbnNlKS5cbiAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcImZ1bWJsZVwiIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgZGVjayxcbiAgICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIGJhbGxPbjogTWF0aC5taW4oOTksIGxhbmRpbmdTcG90KSxcbiAgICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCBsYW5kaW5nU3BvdCArIDEwKSxcbiAgICAgICAgICBkb3duOiAxLFxuICAgICAgICAgIG9mZmVuc2UsIC8vIGtpY2tlciByZXRhaW5zXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBUb3VjaGJhY2s6IHJlY2VpdmVyIGdldHMgYmFsbCBhdCB0aGVpciBvd24gMjAgKD0gODAgZnJvbSB0aGVpciBwZXJzcGVjdGl2ZSxcbiAgLy8gYnV0IGJhbGwgcG9zaXRpb24gaXMgdHJhY2tlZCBmcm9tIG9mZmVuc2UgUE9WLCBzbyBmb3IgdGhlIE5FVyBvZmZlbnNlIHRoYXRcbiAgLy8gaXMgMTAwLTgwID0gMjApLlxuICBpZiAodG91Y2hiYWNrKSB7XG4gICAgY29uc3Qgc3RhdGVBZnRlcktpY2s6IEdhbWVTdGF0ZSA9IHsgLi4uc3RhdGUsIGRlY2sgfTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGVBZnRlcktpY2ssXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICBiYWxsT246IDIwLFxuICAgICAgICAgIGZpcnN0RG93bkF0OiAzMCxcbiAgICAgICAgICBkb3duOiAxLFxuICAgICAgICAgIG9mZmVuc2U6IGRlZmVuZGVyLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gTm9ybWFsIHB1bnQgcmV0dXJuOiBkcmF3IG11bHRDYXJkICsgeWFyZHMuIFJldHVybiBtZWFzdXJlZCBmcm9tIGxhbmRpbmdTcG90LlxuICBjb25zdCBtdWx0RHJhdyA9IGRyYXdNdWx0aXBsaWVyKGRlY2ssIHJuZyk7XG4gIGlmIChtdWx0RHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcIm11bHRpcGxpZXJcIiB9KTtcbiAgZGVjayA9IG11bHREcmF3LmRlY2s7XG5cbiAgY29uc3QgcmV0dXJuRHJhdyA9IGRyYXdZYXJkcyhkZWNrLCBybmcpO1xuICBpZiAocmV0dXJuRHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG4gIGRlY2sgPSByZXR1cm5EcmF3LmRlY2s7XG5cbiAgY29uc3QgbXVsdCA9IFJFVFVSTl9NVUxUSVBMSUVSU1ttdWx0RHJhdy5jYXJkXTtcbiAgY29uc3QgcmV0dXJuWWFyZHMgPSBNYXRoLnJvdW5kKG11bHQgKiByZXR1cm5EcmF3LmNhcmQpO1xuXG4gIC8vIEJhbGwgZW5kcyB1cCBhdCBsYW5kaW5nU3BvdCAtIHJldHVybllhcmRzIChmcm9tIGtpY2tpbmcgdGVhbSdzIFBPVikuXG4gIC8vIEVxdWl2YWxlbnRseSwgZnJvbSB0aGUgcmVjZWl2aW5nIHRlYW0ncyBQT1Y6ICgxMDAgLSBsYW5kaW5nU3BvdCkgKyByZXR1cm5ZYXJkcy5cbiAgY29uc3QgcmVjZWl2ZXJCYWxsT24gPSAxMDAgLSBsYW5kaW5nU3BvdCArIHJldHVybllhcmRzO1xuXG4gIGNvbnN0IHN0YXRlQWZ0ZXJSZXR1cm46IEdhbWVTdGF0ZSA9IHsgLi4uc3RhdGUsIGRlY2sgfTtcblxuICAvLyBSZXR1cm4gVEQgXHUyMDE0IHJlY2VpdmVyIHNjb3Jlcy5cbiAgaWYgKHJlY2VpdmVyQmFsbE9uID49IDEwMCkge1xuICAgIGNvbnN0IHJlY2VpdmVyQmFsbENsYW1wZWQgPSAxMDA7XG4gICAgdm9pZCByZWNlaXZlckJhbGxDbGFtcGVkO1xuICAgIHJldHVybiBhcHBseVRvdWNoZG93bihcbiAgICAgIHsgLi4uc3RhdGVBZnRlclJldHVybiwgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IGRlZmVuZGVyIH0gfSxcbiAgICAgIGRlZmVuZGVyLFxuICAgICAgZXZlbnRzLFxuICAgICk7XG4gIH1cblxuICAvLyBSZXR1cm4gc2FmZXR5IFx1MjAxNCByZWNlaXZlciB0YWNrbGVkIGluIHRoZWlyIG93biBlbmR6b25lIChjYW4ndCBhY3R1YWxseVxuICAvLyBoYXBwZW4gZnJvbSBhIG5lZ2F0aXZlLXJldHVybi15YXJkYWdlIHN0YW5kcG9pbnQgaW4gdjUuMSBzaW5jZSBzdGFydCBpc1xuICAvLyAxMDAtbGFuZGluZ1Nwb3Qgd2hpY2ggaXMgPiAwLCBidXQgbW9kZWwgaXQgYW55d2F5IGZvciBjb21wbGV0ZW5lc3MpLlxuICBpZiAocmVjZWl2ZXJCYWxsT24gPD0gMCkge1xuICAgIHJldHVybiBhcHBseVNhZmV0eShcbiAgICAgIHsgLi4uc3RhdGVBZnRlclJldHVybiwgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IGRlZmVuZGVyIH0gfSxcbiAgICAgIGRlZmVuZGVyLFxuICAgICAgZXZlbnRzLFxuICAgICk7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZUFmdGVyUmV0dXJuLFxuICAgICAgcGVuZGluZ1BpY2s6IGJsYW5rUGljaygpLFxuICAgICAgZmllbGQ6IHtcbiAgICAgICAgYmFsbE9uOiByZWNlaXZlckJhbGxPbixcbiAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgcmVjZWl2ZXJCYWxsT24gKyAxMCksXG4gICAgICAgIGRvd246IDEsXG4gICAgICAgIG9mZmVuc2U6IGRlZmVuZGVyLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cbiIsICIvKipcbiAqIEtpY2tvZmYuIEluIHY1LjEga2lja29mZnMgaGF2ZSBhIFwia2ljayB0eXBlXCIgc2VsZWN0aW9uIChvbnNpZGUgdnNcbiAqIHJlZ3VsYXIpIHdoaWNoIHdlJ3JlIHNraXBwaW5nIGZvciB2NiBcdTIwMTQgaW5zdGVhZCB3ZSB0cmVhdCBhIGtpY2tvZmYgYXNcbiAqIGEgc2ltcGxpZmllZCBwdW50IGZyb20gdGhlIDM1IHdpdGggbm8gYmxvY2sgY2hlY2sgYW5kIG5vIG11ZmYgY2hlY2suXG4gKlxuICogVGhlIGtpY2tpbmcgdGVhbSAoc3RhdGUuZmllbGQub2ZmZW5zZSkgaXMgd2hvZXZlciBqdXN0IHNjb3JlZCBvciBpc1xuICogc3RhcnRpbmcgdGhlIGhhbGYuIFBvc3Nlc3Npb24gZmxpcHMgdG8gdGhlIHJlY2VpdmVyIGFzIHBhcnQgb2YgdGhlXG4gKiByZXNvbHV0aW9uLlxuICovXG5cbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IHJlc29sdmVQdW50IH0gZnJvbSBcIi4vcHVudC5qc1wiO1xuaW1wb3J0IHsgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbiB9IGZyb20gXCIuL3NoYXJlZC5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUtpY2tvZmYoc3RhdGU6IEdhbWVTdGF0ZSwgcm5nOiBSbmcpOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIC8vIFBsYWNlIGJhbGwgYXQga2lja2luZyB0ZWFtJ3MgMzUgYW5kIHB1bnQgZnJvbSB0aGVyZS4gVXNlIHRoZSBzYWZldHlLaWNrXG4gIC8vIGZsYWcgdG8gc2tpcCBibG9jay9tdWZmIFx1MjAxNCBhIHJlYWwga2lja29mZiBjYW4ndCBiZSBcImJsb2NrZWRcIiBpbiB0aGUgc2FtZVxuICAvLyB3YXksIGFuZCB2NS4xIHVzZXMgcHVudCgpIGZvciBzYWZldHkga2lja3Mgc2ltaWxhcmx5LlxuICBjb25zdCBraWNraW5nU3RhdGU6IEdhbWVTdGF0ZSA9IHtcbiAgICAuLi5zdGF0ZSxcbiAgICBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgYmFsbE9uOiAzNSB9LFxuICB9O1xuICBjb25zdCByZXN1bHQgPSByZXNvbHZlUHVudChraWNraW5nU3RhdGUsIHJuZywgeyBzYWZldHlLaWNrOiB0cnVlIH0pO1xuICAvLyBBZnRlciByZXNvbHV0aW9uLCB3ZSdyZSBpbiBSRUdfUExBWS5cbiAgcmV0dXJuIHtcbiAgICAuLi5yZXN1bHQsXG4gICAgc3RhdGU6IHsgLi4ucmVzdWx0LnN0YXRlLCBwaGFzZTogXCJSRUdfUExBWVwiIH0sXG4gIH07XG59XG4iLCAiLyoqXG4gKiBIYWlsIE1hcnkgb3V0Y29tZXMgKHJ1bi5qczoyMjQyKS4gRGllIHZhbHVlIFx1MjE5MiByZXN1bHQsIGZyb20gb2ZmZW5zZSdzIFBPVjpcbiAqICAgMSBcdTIxOTIgQklHIFNBQ0ssIC0xMCB5YXJkc1xuICogICAyIFx1MjE5MiArMjAgeWFyZHNcbiAqICAgMyBcdTIxOTIgICAwIHlhcmRzXG4gKiAgIDQgXHUyMTkyICs0MCB5YXJkc1xuICogICA1IFx1MjE5MiBJTlRFUkNFUFRJT04gKHR1cm5vdmVyIGF0IHNwb3QpXG4gKiAgIDYgXHUyMTkyIFRPVUNIRE9XTlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlIH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBvcHAgfSBmcm9tIFwiLi4vLi4vc3RhdGUuanNcIjtcbmltcG9ydCB7XG4gIGFwcGx5U2FmZXR5LFxuICBhcHBseVRvdWNoZG93bixcbiAgYXBwbHlZYXJkYWdlT3V0Y29tZSxcbiAgYmxhbmtQaWNrLFxuICB0eXBlIFNwZWNpYWxSZXNvbHV0aW9uLFxufSBmcm9tIFwiLi9zaGFyZWQuanNcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVIYWlsTWFyeShzdGF0ZTogR2FtZVN0YXRlLCBybmc6IFJuZyk6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGRpZSA9IHJuZy5kNigpO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbeyB0eXBlOiBcIkhBSUxfTUFSWV9ST0xMXCIsIG91dGNvbWU6IGRpZSB9XTtcblxuICAvLyBEZWNyZW1lbnQgSE0gY291bnQgcmVnYXJkbGVzcyBvZiBvdXRjb21lLlxuICBjb25zdCB1cGRhdGVkUGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtvZmZlbnNlXToge1xuICAgICAgLi4uc3RhdGUucGxheWVyc1tvZmZlbnNlXSxcbiAgICAgIGhhbmQ6IHsgLi4uc3RhdGUucGxheWVyc1tvZmZlbnNlXS5oYW5kLCBITTogTWF0aC5tYXgoMCwgc3RhdGUucGxheWVyc1tvZmZlbnNlXS5oYW5kLkhNIC0gMSkgfSxcbiAgICB9LFxuICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gIGNvbnN0IHN0YXRlV2l0aEhtOiBHYW1lU3RhdGUgPSB7IC4uLnN0YXRlLCBwbGF5ZXJzOiB1cGRhdGVkUGxheWVycyB9O1xuXG4gIC8vIEludGVyY2VwdGlvbiAoZGllIDUpIFx1MjAxNCB0dXJub3ZlciBhdCB0aGUgc3BvdCwgcG9zc2Vzc2lvbiBmbGlwcy5cbiAgaWYgKGRpZSA9PT0gNSkge1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUVVJOT1ZFUlwiLCByZWFzb246IFwiaW50ZXJjZXB0aW9uXCIgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlV2l0aEhtLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgLi4uc3RhdGVXaXRoSG0uZmllbGQsXG4gICAgICAgICAgb2ZmZW5zZTogb3BwKG9mZmVuc2UpLFxuICAgICAgICAgIGJhbGxPbjogMTAwIC0gc3RhdGVXaXRoSG0uZmllbGQuYmFsbE9uLFxuICAgICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIDEwMCAtIHN0YXRlV2l0aEhtLmZpZWxkLmJhbGxPbiArIDEwKSxcbiAgICAgICAgICBkb3duOiAxLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gVG91Y2hkb3duIChkaWUgNikuXG4gIGlmIChkaWUgPT09IDYpIHtcbiAgICByZXR1cm4gYXBwbHlUb3VjaGRvd24oc3RhdGVXaXRoSG0sIG9mZmVuc2UsIGV2ZW50cyk7XG4gIH1cblxuICAvLyBZYXJkYWdlIG91dGNvbWVzIChkaWUgMSwgMiwgMywgNCkuXG4gIGNvbnN0IHlhcmRzID0gZGllID09PSAxID8gLTEwIDogZGllID09PSAyID8gMjAgOiBkaWUgPT09IDMgPyAwIDogNDA7XG4gIGNvbnN0IHByb2plY3RlZCA9IHN0YXRlV2l0aEhtLmZpZWxkLmJhbGxPbiArIHlhcmRzO1xuXG4gIGlmIChwcm9qZWN0ZWQgPj0gMTAwKSByZXR1cm4gYXBwbHlUb3VjaGRvd24oc3RhdGVXaXRoSG0sIG9mZmVuc2UsIGV2ZW50cyk7XG4gIGlmIChwcm9qZWN0ZWQgPD0gMCkgcmV0dXJuIGFwcGx5U2FmZXR5KHN0YXRlV2l0aEhtLCBvZmZlbnNlLCBldmVudHMpO1xuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICBvZmZlbnNlUGxheTogXCJITVwiLFxuICAgIGRlZmVuc2VQbGF5OiBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA/PyBcIlNSXCIsXG4gICAgbWF0Y2h1cFF1YWxpdHk6IDAsXG4gICAgbXVsdGlwbGllcjogeyBjYXJkOiBcIjEwXCIsIHZhbHVlOiAwIH0sXG4gICAgeWFyZHNDYXJkOiAwLFxuICAgIHlhcmRzR2FpbmVkOiB5YXJkcyxcbiAgICBuZXdCYWxsT246IHByb2plY3RlZCxcbiAgfSk7XG5cbiAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoc3RhdGVXaXRoSG0sIHlhcmRzLCBldmVudHMpO1xufVxuIiwgIi8qKlxuICogU2FtZSBQbGF5IG1lY2hhbmlzbSAocnVuLmpzOjE4OTkpLlxuICpcbiAqIFRyaWdnZXJlZCB3aGVuIGJvdGggdGVhbXMgcGljayB0aGUgc2FtZSByZWd1bGFyIHBsYXkgQU5EIGEgY29pbi1mbGlwIGxhbmRzXG4gKiBoZWFkcyAoYWxzbyB1bmNvbmRpdGlvbmFsbHkgd2hlbiBib3RoIHBpY2sgVHJpY2sgUGxheSkuIFJ1bnMgaXRzIG93blxuICogY29pbiArIG11bHRpcGxpZXItY2FyZCBjaGFpbjpcbiAqXG4gKiAgIG11bHRDYXJkID0gS2luZyAgXHUyMTkyIEJpZyBQbGF5IChvZmZlbnNlIGlmIGNvaW49aGVhZHMsIGRlZmVuc2UgaWYgdGFpbHMpXG4gKiAgIG11bHRDYXJkID0gUXVlZW4gKyBoZWFkcyBcdTIxOTIgbXVsdGlwbGllciA9ICszLCBkcmF3IHlhcmRzIGNhcmRcbiAqICAgbXVsdENhcmQgPSBRdWVlbiArIHRhaWxzIFx1MjE5MiBtdWx0aXBsaWVyID0gIDAsIG5vIHlhcmRzIChkaXN0ID0gMClcbiAqICAgbXVsdENhcmQgPSBKYWNrICArIGhlYWRzIFx1MjE5MiBtdWx0aXBsaWVyID0gIDAsIG5vIHlhcmRzIChkaXN0ID0gMClcbiAqICAgbXVsdENhcmQgPSBKYWNrICArIHRhaWxzIFx1MjE5MiBtdWx0aXBsaWVyID0gLTMsIGRyYXcgeWFyZHMgY2FyZFxuICogICBtdWx0Q2FyZCA9IDEwICAgICsgaGVhZHMgXHUyMTkyIElOVEVSQ0VQVElPTiAodHVybm92ZXIgYXQgc3BvdClcbiAqICAgbXVsdENhcmQgPSAxMCAgICArIHRhaWxzIFx1MjE5MiAwIHlhcmRzXG4gKlxuICogTm90ZTogdGhlIGNvaW4gZmxpcCBpbnNpZGUgdGhpcyBmdW5jdGlvbiBpcyBhIFNFQ09ORCBjb2luIGZsaXAgXHUyMDE0IHRoZVxuICogbWVjaGFuaXNtLXRyaWdnZXIgY29pbiBmbGlwIGlzIGhhbmRsZWQgYnkgdGhlIHJlZHVjZXIgYmVmb3JlIGNhbGxpbmcgaGVyZS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4uLy4uL3N0YXRlLmpzXCI7XG5pbXBvcnQgeyBkcmF3TXVsdGlwbGllciwgZHJhd1lhcmRzIH0gZnJvbSBcIi4uL2RlY2suanNcIjtcbmltcG9ydCB7IHJlc29sdmVCaWdQbGF5IH0gZnJvbSBcIi4vYmlnUGxheS5qc1wiO1xuaW1wb3J0IHtcbiAgYXBwbHlZYXJkYWdlT3V0Y29tZSxcbiAgYmxhbmtQaWNrLFxuICB0eXBlIFNwZWNpYWxSZXNvbHV0aW9uLFxufSBmcm9tIFwiLi9zaGFyZWQuanNcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVTYW1lUGxheShzdGF0ZTogR2FtZVN0YXRlLCBybmc6IFJuZyk6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuXG4gIGNvbnN0IGNvaW4gPSBybmcuY29pbkZsaXAoKTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlNBTUVfUExBWV9DT0lOXCIsIG91dGNvbWU6IGNvaW4gfSk7XG5cbiAgY29uc3QgbXVsdERyYXcgPSBkcmF3TXVsdGlwbGllcihzdGF0ZS5kZWNrLCBybmcpO1xuICBpZiAobXVsdERyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJtdWx0aXBsaWVyXCIgfSk7XG5cbiAgY29uc3Qgc3RhdGVBZnRlck11bHQ6IEdhbWVTdGF0ZSA9IHsgLi4uc3RhdGUsIGRlY2s6IG11bHREcmF3LmRlY2sgfTtcbiAgY29uc3QgaGVhZHMgPSBjb2luID09PSBcImhlYWRzXCI7XG5cbiAgLy8gS2luZyBcdTIxOTIgQmlnIFBsYXkgZm9yIHdoaWNoZXZlciBzaWRlIHdpbnMgdGhlIGNvaW4uXG4gIGlmIChtdWx0RHJhdy5jYXJkID09PSBcIktpbmdcIikge1xuICAgIGNvbnN0IGJlbmVmaWNpYXJ5ID0gaGVhZHMgPyBvZmZlbnNlIDogb3BwKG9mZmVuc2UpO1xuICAgIGNvbnN0IGJwID0gcmVzb2x2ZUJpZ1BsYXkoc3RhdGVBZnRlck11bHQsIGJlbmVmaWNpYXJ5LCBybmcpO1xuICAgIHJldHVybiB7IHN0YXRlOiBicC5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi5icC5ldmVudHNdIH07XG4gIH1cblxuICAvLyAxMCBcdTIxOTIgaW50ZXJjZXB0aW9uIChoZWFkcykgb3IgMCB5YXJkcyAodGFpbHMpLlxuICBpZiAobXVsdERyYXcuY2FyZCA9PT0gXCIxMFwiKSB7XG4gICAgaWYgKGhlYWRzKSB7XG4gICAgICBldmVudHMucHVzaCh7IHR5cGU6IFwiVFVSTk9WRVJcIiwgcmVhc29uOiBcImludGVyY2VwdGlvblwiIH0pO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGU6IHtcbiAgICAgICAgICAuLi5zdGF0ZUFmdGVyTXVsdCxcbiAgICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICAgIC4uLnN0YXRlQWZ0ZXJNdWx0LmZpZWxkLFxuICAgICAgICAgICAgb2ZmZW5zZTogb3BwKG9mZmVuc2UpLFxuICAgICAgICAgICAgYmFsbE9uOiAxMDAgLSBzdGF0ZUFmdGVyTXVsdC5maWVsZC5iYWxsT24sXG4gICAgICAgICAgICBmaXJzdERvd25BdDogTWF0aC5taW4oMTAwLCAxMDAgLSBzdGF0ZUFmdGVyTXVsdC5maWVsZC5iYWxsT24gKyAxMCksXG4gICAgICAgICAgICBkb3duOiAxLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGV2ZW50cyxcbiAgICAgIH07XG4gICAgfVxuICAgIC8vIDAgeWFyZHMsIGRvd24gY29uc3VtZWQuXG4gICAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoc3RhdGVBZnRlck11bHQsIDAsIGV2ZW50cyk7XG4gIH1cblxuICAvLyBRdWVlbiBvciBKYWNrIFx1MjE5MiBtdWx0aXBsaWVyLCB0aGVuIGRyYXcgeWFyZHMgY2FyZC5cbiAgbGV0IG11bHRpcGxpZXIgPSAwO1xuICBpZiAobXVsdERyYXcuY2FyZCA9PT0gXCJRdWVlblwiKSBtdWx0aXBsaWVyID0gaGVhZHMgPyAzIDogMDtcbiAgaWYgKG11bHREcmF3LmNhcmQgPT09IFwiSmFja1wiKSBtdWx0aXBsaWVyID0gaGVhZHMgPyAwIDogLTM7XG5cbiAgaWYgKG11bHRpcGxpZXIgPT09IDApIHtcbiAgICAvLyAwIHlhcmRzLCBkb3duIGNvbnN1bWVkLlxuICAgIHJldHVybiBhcHBseVlhcmRhZ2VPdXRjb21lKHN0YXRlQWZ0ZXJNdWx0LCAwLCBldmVudHMpO1xuICB9XG5cbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKHN0YXRlQWZ0ZXJNdWx0LmRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuXG4gIGNvbnN0IHlhcmRzID0gTWF0aC5yb3VuZChtdWx0aXBsaWVyICogeWFyZHNEcmF3LmNhcmQpO1xuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICBvZmZlbnNlUGxheTogc3RhdGUucGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgPz8gXCJTUlwiLFxuICAgIGRlZmVuc2VQbGF5OiBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA/PyBcIlNSXCIsXG4gICAgbWF0Y2h1cFF1YWxpdHk6IDAsXG4gICAgbXVsdGlwbGllcjogeyBjYXJkOiBtdWx0RHJhdy5jYXJkLCB2YWx1ZTogbXVsdGlwbGllciB9LFxuICAgIHlhcmRzQ2FyZDogeWFyZHNEcmF3LmNhcmQsXG4gICAgeWFyZHNHYWluZWQ6IHlhcmRzLFxuICAgIG5ld0JhbGxPbjogTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBzdGF0ZUFmdGVyTXVsdC5maWVsZC5iYWxsT24gKyB5YXJkcykpLFxuICB9KTtcblxuICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShcbiAgICB7IC4uLnN0YXRlQWZ0ZXJNdWx0LCBkZWNrOiB5YXJkc0RyYXcuZGVjayB9LFxuICAgIHlhcmRzLFxuICAgIGV2ZW50cyxcbiAgKTtcbn1cbiIsICIvKipcbiAqIFRyaWNrIFBsYXkgcmVzb2x1dGlvbiAocnVuLmpzOjE5ODcpLiBPbmUgcGVyIHNodWZmbGUsIGNhbGxlZCBieSBlaXRoZXJcbiAqIG9mZmVuc2Ugb3IgZGVmZW5zZS4gRGllIHJvbGwgb3V0Y29tZXMgKGZyb20gdGhlICpjYWxsZXIncyogcGVyc3BlY3RpdmUpOlxuICpcbiAqICAgMSBcdTIxOTIgTG9uZyBQYXNzIHdpdGggKzUgYm9udXMgICAobWF0Y2h1cCB1c2VzIExQIHZzIHRoZSBvdGhlciBzaWRlJ3MgcGljaylcbiAqICAgMiBcdTIxOTIgMTUteWFyZCBwZW5hbHR5IG9uIG9wcG9zaW5nIHNpZGUgKGhhbGYtdG8tZ29hbCBpZiB0aWdodClcbiAqICAgMyBcdTIxOTIgZml4ZWQgLTN4IG11bHRpcGxpZXIsIGRyYXcgeWFyZHMgY2FyZFxuICogICA0IFx1MjE5MiBmaXhlZCArNHggbXVsdGlwbGllciwgZHJhdyB5YXJkcyBjYXJkXG4gKiAgIDUgXHUyMTkyIEJpZyBQbGF5IChiZW5lZmljaWFyeSA9IGNhbGxlcilcbiAqICAgNiBcdTIxOTIgTG9uZyBSdW4gd2l0aCArNSBib251c1xuICpcbiAqIFdoZW4gdGhlIGNhbGxlciBpcyB0aGUgZGVmZW5zZSwgdGhlIHlhcmRhZ2Ugc2lnbnMgaW52ZXJ0IChkZWZlbnNlIGdhaW5zID1cbiAqIG9mZmVuc2UgbG9zZXMpLCB0aGUgTFIvTFAgb3ZlcmxheSBpcyBhcHBsaWVkIHRvIHRoZSBkZWZlbnNpdmUgY2FsbCwgYW5kXG4gKiB0aGUgQmlnIFBsYXkgYmVuZWZpY2lhcnkgaXMgZGVmZW5zZS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50IH0gZnJvbSBcIi4uLy4uL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi4vLi4vcm5nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgUGxheWVySWQsIFJlZ3VsYXJQbGF5IH0gZnJvbSBcIi4uLy4uL3R5cGVzLmpzXCI7XG5pbXBvcnQgeyBkcmF3TXVsdGlwbGllciwgZHJhd1lhcmRzIH0gZnJvbSBcIi4uL2RlY2suanNcIjtcbmltcG9ydCB7IE1VTFRJLCBtYXRjaHVwUXVhbGl0eSB9IGZyb20gXCIuLi9tYXRjaHVwLmpzXCI7XG5pbXBvcnQgeyByZXNvbHZlQmlnUGxheSB9IGZyb20gXCIuL2JpZ1BsYXkuanNcIjtcbmltcG9ydCB7XG4gIGFwcGx5WWFyZGFnZU91dGNvbWUsXG4gIGJsYW5rUGljayxcbiAgdHlwZSBTcGVjaWFsUmVzb2x1dGlvbixcbn0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlT2ZmZW5zaXZlVHJpY2tQbGF5KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBybmc6IFJuZyxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGRpZSA9IHJuZy5kNigpO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbeyB0eXBlOiBcIlRSSUNLX1BMQVlfUk9MTFwiLCBvdXRjb21lOiBkaWUgfV07XG5cbiAgLy8gNSBcdTIxOTIgQmlnIFBsYXkgZm9yIG9mZmVuc2UgKGNhbGxlcikuXG4gIGlmIChkaWUgPT09IDUpIHtcbiAgICBjb25zdCBicCA9IHJlc29sdmVCaWdQbGF5KHN0YXRlLCBvZmZlbnNlLCBybmcpO1xuICAgIHJldHVybiB7IHN0YXRlOiBicC5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi5icC5ldmVudHNdIH07XG4gIH1cblxuICAvLyAyIFx1MjE5MiAxNS15YXJkIHBlbmFsdHkgb24gZGVmZW5zZSAoPSBvZmZlbnNlIGdhaW5zIDE1IG9yIGhhbGYtdG8tZ29hbCkuXG4gIGlmIChkaWUgPT09IDIpIHtcbiAgICBjb25zdCByYXdHYWluID0gMTU7XG4gICAgY29uc3QgZ2FpbiA9XG4gICAgICBzdGF0ZS5maWVsZC5iYWxsT24gKyByYXdHYWluID4gOTlcbiAgICAgICAgPyBNYXRoLnRydW5jKCgxMDAgLSBzdGF0ZS5maWVsZC5iYWxsT24pIC8gMilcbiAgICAgICAgOiByYXdHYWluO1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJQRU5BTFRZXCIsIGFnYWluc3Q6IG9wcG9uZW50KG9mZmVuc2UpLCB5YXJkczogZ2FpbiwgbG9zc09mRG93bjogZmFsc2UgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwZW5kaW5nUGljazogYmxhbmtQaWNrKCksXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgLi4uc3RhdGUuZmllbGQsXG4gICAgICAgICAgYmFsbE9uOiBNYXRoLm1pbigxMDAsIHN0YXRlLmZpZWxkLmJhbGxPbiArIGdhaW4pLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gMyBvciA0IFx1MjE5MiBmaXhlZCBtdWx0aXBsaWVyLCBkcmF3IHlhcmRzIGNhcmQuXG4gIGlmIChkaWUgPT09IDMgfHwgZGllID09PSA0KSB7XG4gICAgY29uc3QgbXVsdGlwbGllciA9IGRpZSA9PT0gMyA/IC0zIDogNDtcbiAgICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMoc3RhdGUuZGVjaywgcm5nKTtcbiAgICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcbiAgICBjb25zdCB5YXJkcyA9IE1hdGgucm91bmQobXVsdGlwbGllciAqIHlhcmRzRHJhdy5jYXJkKTtcblxuICAgIGV2ZW50cy5wdXNoKHtcbiAgICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgICAgb2ZmZW5zZVBsYXk6IFwiVFBcIixcbiAgICAgIGRlZmVuc2VQbGF5OiBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA/PyBcIlNSXCIsXG4gICAgICBtYXRjaHVwUXVhbGl0eTogMCxcbiAgICAgIG11bHRpcGxpZXI6IHsgY2FyZDogXCJLaW5nXCIsIHZhbHVlOiBtdWx0aXBsaWVyIH0sXG4gICAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgICAgeWFyZHNHYWluZWQ6IHlhcmRzLFxuICAgICAgbmV3QmFsbE9uOiBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHN0YXRlLmZpZWxkLmJhbGxPbiArIHlhcmRzKSksXG4gICAgfSk7XG5cbiAgICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShcbiAgICAgIHsgLi4uc3RhdGUsIGRlY2s6IHlhcmRzRHJhdy5kZWNrIH0sXG4gICAgICB5YXJkcyxcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgLy8gMSBvciA2IFx1MjE5MiByZWd1bGFyIHBsYXkgcmVzb2x1dGlvbiB3aXRoIGZvcmNlZCBvZmZlbnNlIHBsYXkgKyBib251cy5cbiAgY29uc3QgZm9yY2VkUGxheTogUmVndWxhclBsYXkgPSBkaWUgPT09IDEgPyBcIkxQXCIgOiBcIkxSXCI7XG4gIGNvbnN0IGJvbnVzID0gNTtcbiAgY29uc3QgZGVmZW5zZVBsYXkgPSBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA/PyBcIlNSXCI7XG5cbiAgLy8gTXVzdCBiZSBhIHJlZ3VsYXIgcGxheSBmb3IgbWF0Y2h1cCB0byBiZSBtZWFuaW5nZnVsLiBJZiBkZWZlbnNlIGFsc28gcGlja2VkXG4gIC8vIHNvbWV0aGluZyB3ZWlyZCwgZmFsbCBiYWNrIHRvIHF1YWxpdHkgMyAobmV1dHJhbCkuXG4gIGNvbnN0IGRlZlBsYXkgPSBpc1JlZ3VsYXIoZGVmZW5zZVBsYXkpID8gZGVmZW5zZVBsYXkgOiBcIlNSXCI7XG4gIGNvbnN0IHF1YWxpdHkgPSBtYXRjaHVwUXVhbGl0eShmb3JjZWRQbGF5LCBkZWZQbGF5KTtcblxuICBjb25zdCBtdWx0RHJhdyA9IGRyYXdNdWx0aXBsaWVyKHN0YXRlLmRlY2ssIHJuZyk7XG4gIGlmIChtdWx0RHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcIm11bHRpcGxpZXJcIiB9KTtcbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKG11bHREcmF3LmRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuXG4gIGNvbnN0IG11bHRSb3cgPSBNVUxUSVttdWx0RHJhdy5pbmRleF07XG4gIGNvbnN0IG11bHRpcGxpZXIgPSBtdWx0Um93Py5bcXVhbGl0eSAtIDFdID8/IDA7XG4gIGNvbnN0IHlhcmRzID0gTWF0aC5yb3VuZChtdWx0aXBsaWVyICogeWFyZHNEcmF3LmNhcmQpICsgYm9udXM7XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgIG9mZmVuc2VQbGF5OiBmb3JjZWRQbGF5LFxuICAgIGRlZmVuc2VQbGF5OiBkZWZQbGF5LFxuICAgIG1hdGNodXBRdWFsaXR5OiBxdWFsaXR5LFxuICAgIG11bHRpcGxpZXI6IHsgY2FyZDogbXVsdERyYXcuY2FyZCwgdmFsdWU6IG11bHRpcGxpZXIgfSxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgIHlhcmRzR2FpbmVkOiB5YXJkcyxcbiAgICBuZXdCYWxsT246IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgc3RhdGUuZmllbGQuYmFsbE9uICsgeWFyZHMpKSxcbiAgfSk7XG5cbiAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoXG4gICAgeyAuLi5zdGF0ZSwgZGVjazogeWFyZHNEcmF3LmRlY2sgfSxcbiAgICB5YXJkcyxcbiAgICBldmVudHMsXG4gICk7XG59XG5cbmZ1bmN0aW9uIGlzUmVndWxhcihwOiBzdHJpbmcpOiBwIGlzIFJlZ3VsYXJQbGF5IHtcbiAgcmV0dXJuIHAgPT09IFwiU1JcIiB8fCBwID09PSBcIkxSXCIgfHwgcCA9PT0gXCJTUFwiIHx8IHAgPT09IFwiTFBcIjtcbn1cblxuZnVuY3Rpb24gb3Bwb25lbnQocDogUGxheWVySWQpOiBQbGF5ZXJJZCB7XG4gIHJldHVybiBwID09PSAxID8gMiA6IDE7XG59XG5cbi8qKlxuICogRGVmZW5zZSBjYWxscyBUcmljayBQbGF5LiBTeW1tZXRyaWMgdG8gdGhlIG9mZmVuc2l2ZSB2ZXJzaW9uIHdpdGggdGhlXG4gKiB5YXJkYWdlIHNpZ24gaW52ZXJ0ZWQgb24gdGhlIExSL0xQIGFuZCBwZW5hbHR5IGJyYW5jaGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZURlZmVuc2l2ZVRyaWNrUGxheShcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgcm5nOiBSbmcsXG4pOiBTcGVjaWFsUmVzb2x1dGlvbiB7XG4gIGNvbnN0IG9mZmVuc2UgPSBzdGF0ZS5maWVsZC5vZmZlbnNlO1xuICBjb25zdCBkZWZlbmRlciA9IG9wcG9uZW50KG9mZmVuc2UpO1xuICBjb25zdCBkaWUgPSBybmcuZDYoKTtcbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW3sgdHlwZTogXCJUUklDS19QTEFZX1JPTExcIiwgb3V0Y29tZTogZGllIH1dO1xuXG4gIC8vIDUgXHUyMTkyIEJpZyBQbGF5IGZvciBkZWZlbnNlIChjYWxsZXIpLlxuICBpZiAoZGllID09PSA1KSB7XG4gICAgY29uc3QgYnAgPSByZXNvbHZlQmlnUGxheShzdGF0ZSwgZGVmZW5kZXIsIHJuZyk7XG4gICAgcmV0dXJuIHsgc3RhdGU6IGJwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLmJwLmV2ZW50c10gfTtcbiAgfVxuXG4gIC8vIDIgXHUyMTkyIDE1LXlhcmQgcGVuYWx0eSBvbiBvZmZlbnNlICg9IG9mZmVuc2UgbG9zZXMgMTUgb3IgaGFsZi10by1vd24tZ29hbCkuXG4gIGlmIChkaWUgPT09IDIpIHtcbiAgICBjb25zdCByYXdMb3NzID0gLTE1O1xuICAgIGNvbnN0IGxvc3MgPVxuICAgICAgc3RhdGUuZmllbGQuYmFsbE9uICsgcmF3TG9zcyA8IDFcbiAgICAgICAgPyAtTWF0aC50cnVuYyhzdGF0ZS5maWVsZC5iYWxsT24gLyAyKVxuICAgICAgICA6IHJhd0xvc3M7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlBFTkFMVFlcIiwgYWdhaW5zdDogb2ZmZW5zZSwgeWFyZHM6IGxvc3MsIGxvc3NPZkRvd246IGZhbHNlIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZToge1xuICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgcGVuZGluZ1BpY2s6IHsgb2ZmZW5zZVBsYXk6IG51bGwsIGRlZmVuc2VQbGF5OiBudWxsIH0sXG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgLi4uc3RhdGUuZmllbGQsXG4gICAgICAgICAgYmFsbE9uOiBNYXRoLm1heCgwLCBzdGF0ZS5maWVsZC5iYWxsT24gKyBsb3NzKSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBldmVudHMsXG4gICAgfTtcbiAgfVxuXG4gIC8vIDMgb3IgNCBcdTIxOTIgZml4ZWQgbXVsdGlwbGllciB3aXRoIHRoZSAqZGVmZW5zZSdzKiBzaWduIGNvbnZlbnRpb24uIHY1LjFcbiAgLy8gYXBwbGllcyB0aGUgc2FtZSArLy0gbXVsdGlwbGllcnMgYXMgb2ZmZW5zaXZlIFRyaWNrIFBsYXk7IHRoZSBpbnZlcnNpb25cbiAgLy8gaXMgaW1wbGljaXQgaW4gZGVmZW5zZSBiZWluZyB0aGUgY2FsbGVyLiBZYXJkYWdlIGlzIGZyb20gb2ZmZW5zZSBQT1YuXG4gIGlmIChkaWUgPT09IDMgfHwgZGllID09PSA0KSB7XG4gICAgY29uc3QgbXVsdGlwbGllciA9IGRpZSA9PT0gMyA/IC0zIDogNDtcbiAgICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMoc3RhdGUuZGVjaywgcm5nKTtcbiAgICBpZiAoeWFyZHNEcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwieWFyZHNcIiB9KTtcbiAgICBjb25zdCB5YXJkcyA9IE1hdGgucm91bmQobXVsdGlwbGllciAqIHlhcmRzRHJhdy5jYXJkKTtcblxuICAgIGV2ZW50cy5wdXNoKHtcbiAgICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgICAgb2ZmZW5zZVBsYXk6IHN0YXRlLnBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ID8/IFwiU1JcIixcbiAgICAgIGRlZmVuc2VQbGF5OiBcIlRQXCIsXG4gICAgICBtYXRjaHVwUXVhbGl0eTogMCxcbiAgICAgIG11bHRpcGxpZXI6IHsgY2FyZDogXCJLaW5nXCIsIHZhbHVlOiBtdWx0aXBsaWVyIH0sXG4gICAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgICAgeWFyZHNHYWluZWQ6IHlhcmRzLFxuICAgICAgbmV3QmFsbE9uOiBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHN0YXRlLmZpZWxkLmJhbGxPbiArIHlhcmRzKSksXG4gICAgfSk7XG5cbiAgICByZXR1cm4gYXBwbHlZYXJkYWdlT3V0Y29tZShcbiAgICAgIHsgLi4uc3RhdGUsIGRlY2s6IHlhcmRzRHJhdy5kZWNrIH0sXG4gICAgICB5YXJkcyxcbiAgICAgIGV2ZW50cyxcbiAgICApO1xuICB9XG5cbiAgLy8gMSBvciA2IFx1MjE5MiBkZWZlbnNlJ3MgcGljayBiZWNvbWVzIExQIC8gTFIgd2l0aCAtNSBib251cyB0byBvZmZlbnNlLlxuICBjb25zdCBmb3JjZWREZWZQbGF5OiBSZWd1bGFyUGxheSA9IGRpZSA9PT0gMSA/IFwiTFBcIiA6IFwiTFJcIjtcbiAgY29uc3QgYm9udXMgPSAtNTtcbiAgY29uc3Qgb2ZmZW5zZVBsYXkgPSBzdGF0ZS5wZW5kaW5nUGljay5vZmZlbnNlUGxheSA/PyBcIlNSXCI7XG4gIGNvbnN0IG9mZlBsYXkgPSBpc1JlZ3VsYXIob2ZmZW5zZVBsYXkpID8gb2ZmZW5zZVBsYXkgOiBcIlNSXCI7XG4gIGNvbnN0IHF1YWxpdHkgPSBtYXRjaHVwUXVhbGl0eShvZmZQbGF5LCBmb3JjZWREZWZQbGF5KTtcblxuICBjb25zdCBtdWx0RHJhdyA9IGRyYXdNdWx0aXBsaWVyKHN0YXRlLmRlY2ssIHJuZyk7XG4gIGlmIChtdWx0RHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcIm11bHRpcGxpZXJcIiB9KTtcbiAgY29uc3QgeWFyZHNEcmF3ID0gZHJhd1lhcmRzKG11bHREcmF3LmRlY2ssIHJuZyk7XG4gIGlmICh5YXJkc0RyYXcucmVzaHVmZmxlZCkgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkRFQ0tfU0hVRkZMRURcIiwgZGVjazogXCJ5YXJkc1wiIH0pO1xuXG4gIGNvbnN0IG11bHRSb3cgPSBNVUxUSVttdWx0RHJhdy5pbmRleF07XG4gIGNvbnN0IG11bHRpcGxpZXIgPSBtdWx0Um93Py5bcXVhbGl0eSAtIDFdID8/IDA7XG4gIGNvbnN0IHlhcmRzID0gTWF0aC5yb3VuZChtdWx0aXBsaWVyICogeWFyZHNEcmF3LmNhcmQpICsgYm9udXM7XG5cbiAgZXZlbnRzLnB1c2goe1xuICAgIHR5cGU6IFwiUExBWV9SRVNPTFZFRFwiLFxuICAgIG9mZmVuc2VQbGF5OiBvZmZQbGF5LFxuICAgIGRlZmVuc2VQbGF5OiBmb3JjZWREZWZQbGF5LFxuICAgIG1hdGNodXBRdWFsaXR5OiBxdWFsaXR5LFxuICAgIG11bHRpcGxpZXI6IHsgY2FyZDogbXVsdERyYXcuY2FyZCwgdmFsdWU6IG11bHRpcGxpZXIgfSxcbiAgICB5YXJkc0NhcmQ6IHlhcmRzRHJhdy5jYXJkLFxuICAgIHlhcmRzR2FpbmVkOiB5YXJkcyxcbiAgICBuZXdCYWxsT246IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgc3RhdGUuZmllbGQuYmFsbE9uICsgeWFyZHMpKSxcbiAgfSk7XG5cbiAgcmV0dXJuIGFwcGx5WWFyZGFnZU91dGNvbWUoXG4gICAgeyAuLi5zdGF0ZSwgZGVjazogeWFyZHNEcmF3LmRlY2sgfSxcbiAgICB5YXJkcyxcbiAgICBldmVudHMsXG4gICk7XG59XG4iLCAiLyoqXG4gKiBGaWVsZCBHb2FsIChydW4uanM6MjA0MCkuXG4gKlxuICogRGlzdGFuY2UgPSAoMTAwIC0gYmFsbE9uKSArIDE3LiBTbyBmcm9tIHRoZSA1MCwgRkcgPSA2Ny15YXJkIGF0dGVtcHQuXG4gKlxuICogRGllIHJvbGwgZGV0ZXJtaW5lcyBzdWNjZXNzIGJ5IGRpc3RhbmNlIGJhbmQ6XG4gKiAgIGRpc3RhbmNlID4gNjUgICAgICAgIFx1MjE5MiAxLWluLTEwMDAgY2hhbmNlIChlZmZlY3RpdmVseSBhdXRvLW1pc3MpXG4gKiAgIGRpc3RhbmNlID49IDYwICAgICAgIFx1MjE5MiBuZWVkcyBkaWUgPSA2XG4gKiAgIGRpc3RhbmNlID49IDUwICAgICAgIFx1MjE5MiBuZWVkcyBkaWUgPj0gNVxuICogICBkaXN0YW5jZSA+PSA0MCAgICAgICBcdTIxOTIgbmVlZHMgZGllID49IDRcbiAqICAgZGlzdGFuY2UgPj0gMzAgICAgICAgXHUyMTkyIG5lZWRzIGRpZSA+PSAzXG4gKiAgIGRpc3RhbmNlID49IDIwICAgICAgIFx1MjE5MiBuZWVkcyBkaWUgPj0gMlxuICogICBkaXN0YW5jZSA8ICAyMCAgICAgICBcdTIxOTIgYXV0by1tYWtlXG4gKlxuICogSWYgYSB0aW1lb3V0IHdhcyBjYWxsZWQgYnkgdGhlIGRlZmVuc2UganVzdCBwcmlvciAoa2lja2VyIGljaW5nKSwgZGllKysuXG4gKlxuICogU3VjY2VzcyBcdTIxOTIgKzMgcG9pbnRzLCBraWNrb2ZmIHRvIG9wcG9uZW50LlxuICogTWlzcyAgICBcdTIxOTIgcG9zc2Vzc2lvbiBmbGlwcyBhdCB0aGUgU1BPVCBPRiBUSEUgS0lDSyAobm90IHRoZSBsaW5lIG9mIHNjcmltbWFnZSkuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuLi8uLi9ldmVudHMuanNcIjtcbmltcG9ydCB0eXBlIHsgUm5nIH0gZnJvbSBcIi4uLy4uL3JuZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUgfSBmcm9tIFwiLi4vLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IG9wcCB9IGZyb20gXCIuLi8uLi9zdGF0ZS5qc1wiO1xuaW1wb3J0IHsgYmxhbmtQaWNrLCB0eXBlIFNwZWNpYWxSZXNvbHV0aW9uIH0gZnJvbSBcIi4vc2hhcmVkLmpzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRmllbGRHb2FsT3B0aW9ucyB7XG4gIC8qKiB0cnVlIGlmIHRoZSBvcHBvc2luZyB0ZWFtIGNhbGxlZCBhIHRpbWVvdXQgdGhhdCBzaG91bGQgaWNlIHRoZSBraWNrZXIuICovXG4gIGljZWQ/OiBib29sZWFuO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUZpZWxkR29hbChcbiAgc3RhdGU6IEdhbWVTdGF0ZSxcbiAgcm5nOiBSbmcsXG4gIG9wdHM6IEZpZWxkR29hbE9wdGlvbnMgPSB7fSxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGRpc3RhbmNlID0gMTAwIC0gc3RhdGUuZmllbGQuYmFsbE9uICsgMTc7XG4gIGNvbnN0IHJhd0RpZSA9IHJuZy5kNigpO1xuICBjb25zdCBkaWUgPSBvcHRzLmljZWQgPyBNYXRoLm1pbig2LCByYXdEaWUgKyAxKSA6IHJhd0RpZTtcblxuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcblxuICBsZXQgbWFrZTogYm9vbGVhbjtcbiAgaWYgKGRpc3RhbmNlID4gNjUpIHtcbiAgICAvLyBFc3NlbnRpYWxseSBpbXBvc3NpYmxlIFx1MjAxNCByb2xsZWQgMS0xMDAwLCBtYWtlIG9ubHkgb24gZXhhY3QgaGl0LlxuICAgIG1ha2UgPSBybmcuaW50QmV0d2VlbigxLCAxMDAwKSA9PT0gZGlzdGFuY2U7XG4gIH0gZWxzZSBpZiAoZGlzdGFuY2UgPj0gNjApIG1ha2UgPSBkaWUgPj0gNjtcbiAgZWxzZSBpZiAoZGlzdGFuY2UgPj0gNTApIG1ha2UgPSBkaWUgPj0gNTtcbiAgZWxzZSBpZiAoZGlzdGFuY2UgPj0gNDApIG1ha2UgPSBkaWUgPj0gNDtcbiAgZWxzZSBpZiAoZGlzdGFuY2UgPj0gMzApIG1ha2UgPSBkaWUgPj0gMztcbiAgZWxzZSBpZiAoZGlzdGFuY2UgPj0gMjApIG1ha2UgPSBkaWUgPj0gMjtcbiAgZWxzZSBtYWtlID0gdHJ1ZTtcblxuICBpZiAobWFrZSkge1xuICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJGSUVMRF9HT0FMX0dPT0RcIiwgcGxheWVyOiBvZmZlbnNlIH0pO1xuICAgIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgW29mZmVuc2VdOiB7IC4uLnN0YXRlLnBsYXllcnNbb2ZmZW5zZV0sIHNjb3JlOiBzdGF0ZS5wbGF5ZXJzW29mZmVuc2VdLnNjb3JlICsgMyB9LFxuICAgIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkZJRUxEX0dPQUxfTUlTU0VEXCIsIHBsYXllcjogb2ZmZW5zZSB9KTtcbiAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlRVUk5PVkVSXCIsIHJlYXNvbjogXCJtaXNzZWRfZmdcIiB9KTtcblxuICAvLyBQb3NzZXNzaW9uIGZsaXBzIGF0IGxpbmUgb2Ygc2NyaW1tYWdlIChiYWxsIHN0YXlzIHdoZXJlIGtpY2tlZCBmcm9tKS5cbiAgY29uc3QgZGVmZW5kZXIgPSBvcHAob2ZmZW5zZSk7XG4gIGNvbnN0IG1pcnJvcmVkQmFsbE9uID0gMTAwIC0gc3RhdGUuZmllbGQuYmFsbE9uO1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIGZpZWxkOiB7XG4gICAgICAgIGJhbGxPbjogbWlycm9yZWRCYWxsT24sXG4gICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIG1pcnJvcmVkQmFsbE9uICsgMTApLFxuICAgICAgICBkb3duOiAxLFxuICAgICAgICBvZmZlbnNlOiBkZWZlbmRlcixcbiAgICAgIH0sXG4gICAgfSxcbiAgICBldmVudHMsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBUd28tUG9pbnQgQ29udmVyc2lvbiAoVFdPX1BUIHBoYXNlKS5cbiAqXG4gKiBCYWxsIGlzIHBsYWNlZCBhdCBvZmZlbnNlJ3MgOTcgKD0gMy15YXJkIGxpbmUpLiBBIHNpbmdsZSByZWd1bGFyIHBsYXkgaXNcbiAqIHJlc29sdmVkLiBJZiB0aGUgcmVzdWx0aW5nIHlhcmRhZ2UgY3Jvc3NlcyB0aGUgZ29hbCBsaW5lLCBUV09fUE9JTlRfR09PRC5cbiAqIE90aGVyd2lzZSwgVFdPX1BPSU5UX0ZBSUxFRC4gRWl0aGVyIHdheSwga2lja29mZiBmb2xsb3dzLlxuICpcbiAqIFVubGlrZSBhIG5vcm1hbCBwbGF5LCBhIDJwdCBkb2VzIE5PVCBjaGFuZ2UgZG93bi9kaXN0YW5jZS4gSXQncyBhIG9uZS1zaG90LlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFJuZyB9IGZyb20gXCIuLi8uLi9ybmcuanNcIjtcbmltcG9ydCB0eXBlIHsgR2FtZVN0YXRlLCBSZWd1bGFyUGxheSB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuaW1wb3J0IHsgZHJhd011bHRpcGxpZXIsIGRyYXdZYXJkcyB9IGZyb20gXCIuLi9kZWNrLmpzXCI7XG5pbXBvcnQgeyBjb21wdXRlWWFyZGFnZSB9IGZyb20gXCIuLi95YXJkYWdlLmpzXCI7XG5pbXBvcnQgeyBibGFua1BpY2ssIHR5cGUgU3BlY2lhbFJlc29sdXRpb24gfSBmcm9tIFwiLi9zaGFyZWQuanNcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVUd29Qb2ludENvbnZlcnNpb24oXG4gIHN0YXRlOiBHYW1lU3RhdGUsXG4gIG9mZmVuc2VQbGF5OiBSZWd1bGFyUGxheSxcbiAgZGVmZW5zZVBsYXk6IFJlZ3VsYXJQbGF5LFxuICBybmc6IFJuZyxcbik6IFNwZWNpYWxSZXNvbHV0aW9uIHtcbiAgY29uc3Qgb2ZmZW5zZSA9IHN0YXRlLmZpZWxkLm9mZmVuc2U7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuXG4gIGNvbnN0IG11bHREcmF3ID0gZHJhd011bHRpcGxpZXIoc3RhdGUuZGVjaywgcm5nKTtcbiAgaWYgKG11bHREcmF3LnJlc2h1ZmZsZWQpIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJERUNLX1NIVUZGTEVEXCIsIGRlY2s6IFwibXVsdGlwbGllclwiIH0pO1xuICBjb25zdCB5YXJkc0RyYXcgPSBkcmF3WWFyZHMobXVsdERyYXcuZGVjaywgcm5nKTtcbiAgaWYgKHlhcmRzRHJhdy5yZXNodWZmbGVkKSBldmVudHMucHVzaCh7IHR5cGU6IFwiREVDS19TSFVGRkxFRFwiLCBkZWNrOiBcInlhcmRzXCIgfSk7XG5cbiAgY29uc3Qgb3V0Y29tZSA9IGNvbXB1dGVZYXJkYWdlKHtcbiAgICBvZmZlbnNlOiBvZmZlbnNlUGxheSxcbiAgICBkZWZlbnNlOiBkZWZlbnNlUGxheSxcbiAgICBtdWx0aXBsaWVyQ2FyZDogbXVsdERyYXcuaW5kZXgsXG4gICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgfSk7XG5cbiAgLy8gMnB0IHN0YXJ0cyBhdCA5Ny4gQ3Jvc3NpbmcgdGhlIGdvYWwgPSBnb29kLlxuICBjb25zdCBzdGFydEJhbGxPbiA9IDk3O1xuICBjb25zdCBwcm9qZWN0ZWQgPSBzdGFydEJhbGxPbiArIG91dGNvbWUueWFyZHNHYWluZWQ7XG4gIGNvbnN0IGdvb2QgPSBwcm9qZWN0ZWQgPj0gMTAwO1xuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBcIlBMQVlfUkVTT0xWRURcIixcbiAgICBvZmZlbnNlUGxheSxcbiAgICBkZWZlbnNlUGxheSxcbiAgICBtYXRjaHVwUXVhbGl0eTogb3V0Y29tZS5tYXRjaHVwUXVhbGl0eSxcbiAgICBtdWx0aXBsaWVyOiB7IGNhcmQ6IG91dGNvbWUubXVsdGlwbGllckNhcmROYW1lLCB2YWx1ZTogb3V0Y29tZS5tdWx0aXBsaWVyIH0sXG4gICAgeWFyZHNDYXJkOiB5YXJkc0RyYXcuY2FyZCxcbiAgICB5YXJkc0dhaW5lZDogb3V0Y29tZS55YXJkc0dhaW5lZCxcbiAgICBuZXdCYWxsT246IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgcHJvamVjdGVkKSksXG4gIH0pO1xuXG4gIGNvbnN0IG5ld1BsYXllcnMgPSBnb29kXG4gICAgPyAoe1xuICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICBbb2ZmZW5zZV06IHsgLi4uc3RhdGUucGxheWVyc1tvZmZlbnNlXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbb2ZmZW5zZV0uc2NvcmUgKyAyIH0sXG4gICAgICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl0pXG4gICAgOiBzdGF0ZS5wbGF5ZXJzO1xuXG4gIGV2ZW50cy5wdXNoKHtcbiAgICB0eXBlOiBnb29kID8gXCJUV09fUE9JTlRfR09PRFwiIDogXCJUV09fUE9JTlRfRkFJTEVEXCIsXG4gICAgcGxheWVyOiBvZmZlbnNlLFxuICB9KTtcblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIGRlY2s6IHlhcmRzRHJhdy5kZWNrLFxuICAgICAgcGxheWVyczogbmV3UGxheWVycyxcbiAgICAgIHBlbmRpbmdQaWNrOiBibGFua1BpY2soKSxcbiAgICAgIHBoYXNlOiBcIktJQ0tPRkZcIixcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cbiIsICIvKipcbiAqIE92ZXJ0aW1lIG1lY2hhbmljcy5cbiAqXG4gKiBDb2xsZWdlLWZvb3RiYWxsIHN0eWxlOlxuICogICAtIEVhY2ggcGVyaW9kOiBlYWNoIHRlYW0gZ2V0cyBvbmUgcG9zc2Vzc2lvbiBmcm9tIHRoZSBvcHBvbmVudCdzIDI1XG4gKiAgICAgKG9mZmVuc2UgUE9WOiBiYWxsT24gPSA3NSkuXG4gKiAgIC0gQSBwb3NzZXNzaW9uIGVuZHMgd2l0aDogVEQgKGZvbGxvd2VkIGJ5IFBBVC8ycHQpLCBGRyAobWFkZSBvciBtaXNzZWQpLFxuICogICAgIHR1cm5vdmVyLCB0dXJub3Zlci1vbi1kb3ducywgb3Igc2FmZXR5LlxuICogICAtIEFmdGVyIGJvdGggcG9zc2Vzc2lvbnMsIGlmIHNjb3JlcyBkaWZmZXIgXHUyMTkyIEdBTUVfT1ZFUi4gSWYgdGllZCBcdTIxOTIgbmV4dFxuICogICAgIHBlcmlvZC5cbiAqICAgLSBQZXJpb2RzIGFsdGVybmF0ZSB3aG8gcG9zc2Vzc2VzIGZpcnN0LlxuICogICAtIFBlcmlvZCAzKzogMi1wb2ludCBjb252ZXJzaW9uIG1hbmRhdG9yeSBhZnRlciBhIFREIChubyBQQVQga2ljaykuXG4gKiAgIC0gSGFpbCBNYXJ5czogMiBwZXIgcGVyaW9kLCByZWZpbGxlZCBhdCBzdGFydCBvZiBlYWNoIHBlcmlvZC5cbiAqICAgLSBUaW1lb3V0czogMSBwZXIgcGFpciBvZiBwZXJpb2RzLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnQgfSBmcm9tIFwiLi4vZXZlbnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEdhbWVTdGF0ZSwgT3ZlcnRpbWVTdGF0ZSwgUGxheWVySWQgfSBmcm9tIFwiLi4vdHlwZXMuanNcIjtcbmltcG9ydCB7IGVtcHR5SGFuZCwgb3BwIH0gZnJvbSBcIi4uL3N0YXRlLmpzXCI7XG5pbXBvcnQgeyBmcmVzaERlY2tNdWx0aXBsaWVycywgZnJlc2hEZWNrWWFyZHMgfSBmcm9tIFwiLi4vc3RhdGUuanNcIjtcblxuY29uc3QgT1RfQkFMTF9PTiA9IDc1OyAvLyBvcHBvbmVudCdzIDI1LXlhcmQgbGluZSwgZnJvbSBvZmZlbnNlIFBPVlxuXG4vKipcbiAqIEluaXRpYWxpemUgT1Qgc3RhdGUsIHJlZnJlc2ggZGVja3MvaGFuZHMsIHNldCBiYWxsIGF0IHRoZSAyNS5cbiAqIENhbGxlZCBvbmNlIHRpZWQgcmVndWxhdGlvbiBlbmRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3RhcnRPdmVydGltZShzdGF0ZTogR2FtZVN0YXRlKTogeyBzdGF0ZTogR2FtZVN0YXRlOyBldmVudHM6IEV2ZW50W10gfSB7XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuICBjb25zdCBmaXJzdFJlY2VpdmVyOiBQbGF5ZXJJZCA9IHN0YXRlLm9wZW5pbmdSZWNlaXZlciA9PT0gMSA/IDIgOiAxO1xuICBjb25zdCBvdmVydGltZTogT3ZlcnRpbWVTdGF0ZSA9IHtcbiAgICBwZXJpb2Q6IDEsXG4gICAgcG9zc2Vzc2lvbjogZmlyc3RSZWNlaXZlcixcbiAgICBmaXJzdFJlY2VpdmVyLFxuICAgIHBvc3Nlc3Npb25zUmVtYWluaW5nOiAyLFxuICB9O1xuICBldmVudHMucHVzaCh7IHR5cGU6IFwiT1ZFUlRJTUVfU1RBUlRFRFwiLCBwZXJpb2Q6IDEsIHBvc3Nlc3Npb246IGZpcnN0UmVjZWl2ZXIgfSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IHtcbiAgICAgIC4uLnN0YXRlLFxuICAgICAgcGhhc2U6IFwiT1RfU1RBUlRcIixcbiAgICAgIG92ZXJ0aW1lLFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG4vKiogQmVnaW4gKG9yIHJlc3VtZSkgdGhlIG5leHQgT1QgcG9zc2Vzc2lvbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGFydE92ZXJ0aW1lUG9zc2Vzc2lvbihzdGF0ZTogR2FtZVN0YXRlKTogeyBzdGF0ZTogR2FtZVN0YXRlOyBldmVudHM6IEV2ZW50W10gfSB7XG4gIGlmICghc3RhdGUub3ZlcnRpbWUpIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG5cbiAgY29uc3QgcG9zc2Vzc2lvbiA9IHN0YXRlLm92ZXJ0aW1lLnBvc3Nlc3Npb247XG4gIGNvbnN0IGV2ZW50czogRXZlbnRbXSA9IFtdO1xuXG4gIC8vIFJlZmlsbCBITSBjb3VudCBmb3IgdGhlIHBvc3Nlc3Npb24ncyBvZmZlbnNlIChtYXRjaGVzIHY1LjE6IEhNIHJlc2V0c1xuICAvLyBwZXIgT1QgcGVyaW9kKS4gUGVyaW9kIDMrIHBsYXllcnMgaGF2ZSBvbmx5IDIgSE1zIGFueXdheS5cbiAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgIFtwb3NzZXNzaW9uXToge1xuICAgICAgLi4uc3RhdGUucGxheWVyc1twb3NzZXNzaW9uXSxcbiAgICAgIGhhbmQ6IHsgLi4uc3RhdGUucGxheWVyc1twb3NzZXNzaW9uXS5oYW5kLCBITTogc3RhdGUub3ZlcnRpbWUucGVyaW9kID49IDMgPyAyIDogMiB9LFxuICAgIH0sXG4gIH0gYXMgR2FtZVN0YXRlW1wicGxheWVyc1wiXTtcblxuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICBwaGFzZTogXCJPVF9QTEFZXCIsXG4gICAgICBmaWVsZDoge1xuICAgICAgICBiYWxsT246IE9UX0JBTExfT04sXG4gICAgICAgIGZpcnN0RG93bkF0OiBNYXRoLm1pbigxMDAsIE9UX0JBTExfT04gKyAxMCksXG4gICAgICAgIGRvd246IDEsXG4gICAgICAgIG9mZmVuc2U6IHBvc3Nlc3Npb24sXG4gICAgICB9LFxuICAgIH0sXG4gICAgZXZlbnRzLFxuICB9O1xufVxuXG4vKipcbiAqIEVuZCB0aGUgY3VycmVudCBPVCBwb3NzZXNzaW9uLiBEZWNyZW1lbnRzIHBvc3Nlc3Npb25zUmVtYWluaW5nOyBpZiAwLFxuICogY2hlY2tzIGZvciBnYW1lIGVuZC4gT3RoZXJ3aXNlIGZsaXBzIHBvc3Nlc3Npb24uXG4gKlxuICogQ2FsbGVyIGlzIHJlc3BvbnNpYmxlIGZvciBkZXRlY3RpbmcgXCJ0aGlzIHdhcyBhIHBvc3Nlc3Npb24tZW5kaW5nIGV2ZW50XCJcbiAqIChURCtQQVQsIEZHIGRlY2lzaW9uLCB0dXJub3ZlciwgZXRjKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVuZE92ZXJ0aW1lUG9zc2Vzc2lvbihzdGF0ZTogR2FtZVN0YXRlKTogeyBzdGF0ZTogR2FtZVN0YXRlOyBldmVudHM6IEV2ZW50W10gfSB7XG4gIGlmICghc3RhdGUub3ZlcnRpbWUpIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG5cbiAgY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG4gIGNvbnN0IHJlbWFpbmluZyA9IHN0YXRlLm92ZXJ0aW1lLnBvc3Nlc3Npb25zUmVtYWluaW5nO1xuXG4gIGlmIChyZW1haW5pbmcgPT09IDIpIHtcbiAgICAvLyBGaXJzdCBwb3NzZXNzaW9uIGVuZGVkLiBGbGlwIHRvIHNlY29uZCB0ZWFtLCBmcmVzaCBiYWxsLlxuICAgIGNvbnN0IG5leHRQb3NzZXNzaW9uID0gb3BwKHN0YXRlLm92ZXJ0aW1lLnBvc3Nlc3Npb24pO1xuICAgIGNvbnN0IG5ld1BsYXllcnMgPSB7XG4gICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgW25leHRQb3NzZXNzaW9uXToge1xuICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzW25leHRQb3NzZXNzaW9uXSxcbiAgICAgICAgaGFuZDogeyAuLi5zdGF0ZS5wbGF5ZXJzW25leHRQb3NzZXNzaW9uXS5oYW5kLCBITTogMiB9LFxuICAgICAgfSxcbiAgICB9IGFzIEdhbWVTdGF0ZVtcInBsYXllcnNcIl07XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwbGF5ZXJzOiBuZXdQbGF5ZXJzLFxuICAgICAgICBwaGFzZTogXCJPVF9QTEFZXCIsXG4gICAgICAgIG92ZXJ0aW1lOiB7IC4uLnN0YXRlLm92ZXJ0aW1lLCBwb3NzZXNzaW9uOiBuZXh0UG9zc2Vzc2lvbiwgcG9zc2Vzc2lvbnNSZW1haW5pbmc6IDEgfSxcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICBiYWxsT246IE9UX0JBTExfT04sXG4gICAgICAgICAgZmlyc3REb3duQXQ6IE1hdGgubWluKDEwMCwgT1RfQkFMTF9PTiArIDEwKSxcbiAgICAgICAgICBkb3duOiAxLFxuICAgICAgICAgIG9mZmVuc2U6IG5leHRQb3NzZXNzaW9uLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGV2ZW50cyxcbiAgICB9O1xuICB9XG5cbiAgLy8gU2Vjb25kIHBvc3Nlc3Npb24gZW5kZWQuIENvbXBhcmUgc2NvcmVzLlxuICBjb25zdCBwMSA9IHN0YXRlLnBsYXllcnNbMV0uc2NvcmU7XG4gIGNvbnN0IHAyID0gc3RhdGUucGxheWVyc1syXS5zY29yZTtcbiAgaWYgKHAxICE9PSBwMikge1xuICAgIGNvbnN0IHdpbm5lcjogUGxheWVySWQgPSBwMSA+IHAyID8gMSA6IDI7XG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIkdBTUVfT1ZFUlwiLCB3aW5uZXIgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnN0YXRlLFxuICAgICAgICBwaGFzZTogXCJHQU1FX09WRVJcIixcbiAgICAgICAgb3ZlcnRpbWU6IHsgLi4uc3RhdGUub3ZlcnRpbWUsIHBvc3Nlc3Npb25zUmVtYWluaW5nOiAwIH0sXG4gICAgICB9LFxuICAgICAgZXZlbnRzLFxuICAgIH07XG4gIH1cblxuICAvLyBUaWVkIFx1MjAxNCBzdGFydCBuZXh0IHBlcmlvZC4gQWx0ZXJuYXRlcyBmaXJzdC1wb3NzZXNzb3IuXG4gIGNvbnN0IG5leHRQZXJpb2QgPSBzdGF0ZS5vdmVydGltZS5wZXJpb2QgKyAxO1xuICBjb25zdCBuZXh0Rmlyc3QgPSBvcHAoc3RhdGUub3ZlcnRpbWUuZmlyc3RSZWNlaXZlcik7XG4gIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJPVkVSVElNRV9TVEFSVEVEXCIsIHBlcmlvZDogbmV4dFBlcmlvZCwgcG9zc2Vzc2lvbjogbmV4dEZpcnN0IH0pO1xuICByZXR1cm4ge1xuICAgIHN0YXRlOiB7XG4gICAgICAuLi5zdGF0ZSxcbiAgICAgIHBoYXNlOiBcIk9UX1NUQVJUXCIsXG4gICAgICBvdmVydGltZToge1xuICAgICAgICBwZXJpb2Q6IG5leHRQZXJpb2QsXG4gICAgICAgIHBvc3Nlc3Npb246IG5leHRGaXJzdCxcbiAgICAgICAgZmlyc3RSZWNlaXZlcjogbmV4dEZpcnN0LFxuICAgICAgICBwb3NzZXNzaW9uc1JlbWFpbmluZzogMixcbiAgICAgIH0sXG4gICAgICAvLyBGcmVzaCBkZWNrcyBmb3IgdGhlIG5ldyBwZXJpb2QuXG4gICAgICBkZWNrOiB7IG11bHRpcGxpZXJzOiBmcmVzaERlY2tNdWx0aXBsaWVycygpLCB5YXJkczogZnJlc2hEZWNrWWFyZHMoKSB9LFxuICAgICAgcGxheWVyczoge1xuICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICAxOiB7IC4uLnN0YXRlLnBsYXllcnNbMV0sIGhhbmQ6IGVtcHR5SGFuZCh0cnVlKSB9LFxuICAgICAgICAyOiB7IC4uLnN0YXRlLnBsYXllcnNbMl0sIGhhbmQ6IGVtcHR5SGFuZCh0cnVlKSB9LFxuICAgICAgfSxcbiAgICB9LFxuICAgIGV2ZW50cyxcbiAgfTtcbn1cblxuLyoqXG4gKiBEZXRlY3Qgd2hldGhlciBhIHNlcXVlbmNlIG9mIGV2ZW50cyBmcm9tIGEgcGxheSByZXNvbHV0aW9uIHNob3VsZCBlbmRcbiAqIHRoZSBjdXJyZW50IE9UIHBvc3Nlc3Npb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1Bvc3Nlc3Npb25FbmRpbmdJbk9UKGV2ZW50czogUmVhZG9ubHlBcnJheTxFdmVudD4pOiBib29sZWFuIHtcbiAgZm9yIChjb25zdCBlIG9mIGV2ZW50cykge1xuICAgIHN3aXRjaCAoZS50eXBlKSB7XG4gICAgICBjYXNlIFwiUEFUX0dPT0RcIjpcbiAgICAgIGNhc2UgXCJUV09fUE9JTlRfR09PRFwiOlxuICAgICAgY2FzZSBcIlRXT19QT0lOVF9GQUlMRURcIjpcbiAgICAgIGNhc2UgXCJGSUVMRF9HT0FMX0dPT0RcIjpcbiAgICAgIGNhc2UgXCJGSUVMRF9HT0FMX01JU1NFRFwiOlxuICAgICAgY2FzZSBcIlRVUk5PVkVSXCI6XG4gICAgICBjYXNlIFwiVFVSTk9WRVJfT05fRE9XTlNcIjpcbiAgICAgIGNhc2UgXCJTQUZFVFlcIjpcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cbiIsICIvKipcbiAqIFRoZSBzaW5nbGUgdHJhbnNpdGlvbiBmdW5jdGlvbi4gVGFrZXMgKHN0YXRlLCBhY3Rpb24sIHJuZykgYW5kIHJldHVybnNcbiAqIGEgbmV3IHN0YXRlIHBsdXMgdGhlIGV2ZW50cyB0aGF0IGRlc2NyaWJlIHdoYXQgaGFwcGVuZWQuXG4gKlxuICogVGhpcyBmaWxlIGlzIHRoZSAqc2tlbGV0b24qIFx1MjAxNCB0aGUgZGlzcGF0Y2ggc2hhcGUgaXMgaGVyZSwgdGhlIGNhc2VzIGFyZVxuICogbW9zdGx5IHN0dWJzIG1hcmtlZCBgLy8gVE9ETzogcG9ydCBmcm9tIHJ1bi5qc2AuIEFzIHdlIHBvcnQsIGVhY2ggY2FzZVxuICogZ2V0cyB1bml0LXRlc3RlZC4gV2hlbiBldmVyeSBjYXNlIGlzIGltcGxlbWVudGVkIGFuZCB0ZXN0ZWQsIHY1LjEncyBydW4uanNcbiAqIGNhbiBiZSBkZWxldGVkLlxuICpcbiAqIFJ1bGVzIGZvciB0aGlzIGZpbGU6XG4gKiAgIDEuIE5FVkVSIGltcG9ydCBmcm9tIERPTSwgbmV0d29yaywgb3IgYW5pbWF0aW9uIG1vZHVsZXMuXG4gKiAgIDIuIE5FVkVSIG11dGF0ZSBgc3RhdGVgIFx1MjAxNCBhbHdheXMgcmV0dXJuIGEgbmV3IG9iamVjdC5cbiAqICAgMy4gTkVWRVIgY2FsbCBNYXRoLnJhbmRvbSBcdTIwMTQgdXNlIHRoZSBgcm5nYCBwYXJhbWV0ZXIuXG4gKiAgIDQuIE5FVkVSIHRocm93IG9uIGludmFsaWQgYWN0aW9ucyBcdTIwMTQgcmV0dXJuIGB7IHN0YXRlLCBldmVudHM6IFtdIH1gXG4gKiAgICAgIGFuZCBsZXQgdGhlIGNhbGxlciBkZWNpZGUuIChWYWxpZGF0aW9uIGlzIHRoZSBzZXJ2ZXIncyBqb2IuKVxuICovXG5cbmltcG9ydCB0eXBlIHsgQWN0aW9uIH0gZnJvbSBcIi4vYWN0aW9ucy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBFdmVudCB9IGZyb20gXCIuL2V2ZW50cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBHYW1lU3RhdGUgfSBmcm9tIFwiLi90eXBlcy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBSbmcgfSBmcm9tIFwiLi9ybmcuanNcIjtcbmltcG9ydCB7IGlzUmVndWxhclBsYXksIHJlc29sdmVSZWd1bGFyUGxheSB9IGZyb20gXCIuL3J1bGVzL3BsYXkuanNcIjtcbmltcG9ydCB7XG4gIHJlc29sdmVEZWZlbnNpdmVUcmlja1BsYXksXG4gIHJlc29sdmVGaWVsZEdvYWwsXG4gIHJlc29sdmVIYWlsTWFyeSxcbiAgcmVzb2x2ZUtpY2tvZmYsXG4gIHJlc29sdmVPZmZlbnNpdmVUcmlja1BsYXksXG4gIHJlc29sdmVQdW50LFxuICByZXNvbHZlU2FtZVBsYXksXG4gIHJlc29sdmVUd29Qb2ludENvbnZlcnNpb24sXG59IGZyb20gXCIuL3J1bGVzL3NwZWNpYWxzL2luZGV4LmpzXCI7XG5pbXBvcnQge1xuICBlbmRPdmVydGltZVBvc3Nlc3Npb24sXG4gIGlzUG9zc2Vzc2lvbkVuZGluZ0luT1QsXG4gIHN0YXJ0T3ZlcnRpbWUsXG4gIHN0YXJ0T3ZlcnRpbWVQb3NzZXNzaW9uLFxufSBmcm9tIFwiLi9ydWxlcy9vdmVydGltZS5qc1wiO1xuaW1wb3J0IHsgb3BwIH0gZnJvbSBcIi4vc3RhdGUuanNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBSZWR1Y2VSZXN1bHQge1xuICBzdGF0ZTogR2FtZVN0YXRlO1xuICBldmVudHM6IEV2ZW50W107XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWR1Y2Uoc3RhdGU6IEdhbWVTdGF0ZSwgYWN0aW9uOiBBY3Rpb24sIHJuZzogUm5nKTogUmVkdWNlUmVzdWx0IHtcbiAgY29uc3QgcmVzdWx0ID0gcmVkdWNlQ29yZShzdGF0ZSwgYWN0aW9uLCBybmcpO1xuICByZXR1cm4gYXBwbHlPdmVydGltZVJvdXRpbmcoc3RhdGUsIHJlc3VsdCk7XG59XG5cbi8qKlxuICogSWYgd2UncmUgaW4gT1QgYW5kIGEgcG9zc2Vzc2lvbi1lbmRpbmcgZXZlbnQganVzdCBmaXJlZCwgcm91dGUgdG8gdGhlXG4gKiBuZXh0IE9UIHBvc3Nlc3Npb24gKG9yIGdhbWUgZW5kKS4gU2tpcHMgd2hlbiB0aGUgYWN0aW9uIGlzIGl0c2VsZiBhbiBPVFxuICogaGVscGVyIChzbyB3ZSBkb24ndCBkb3VibGUtcm91dGUpLlxuICovXG5mdW5jdGlvbiBhcHBseU92ZXJ0aW1lUm91dGluZyhwcmV2U3RhdGU6IEdhbWVTdGF0ZSwgcmVzdWx0OiBSZWR1Y2VSZXN1bHQpOiBSZWR1Y2VSZXN1bHQge1xuICAvLyBPbmx5IGNvbnNpZGVyIHJvdXRpbmcgd2hlbiB3ZSAqd2VyZSogaW4gT1QuIChzdGFydE92ZXJ0aW1lIHNldHMgc3RhdGUub3ZlcnRpbWUuKVxuICBpZiAoIXByZXZTdGF0ZS5vdmVydGltZSAmJiAhcmVzdWx0LnN0YXRlLm92ZXJ0aW1lKSByZXR1cm4gcmVzdWx0O1xuICBpZiAoIXJlc3VsdC5zdGF0ZS5vdmVydGltZSkgcmV0dXJuIHJlc3VsdDtcbiAgaWYgKCFpc1Bvc3Nlc3Npb25FbmRpbmdJbk9UKHJlc3VsdC5ldmVudHMpKSByZXR1cm4gcmVzdWx0O1xuXG4gIC8vIFBBVCBpbiBPVDogYSBURCBzY29yZWQsIGJ1dCBwb3NzZXNzaW9uIGRvZXNuJ3QgZW5kIHVudGlsIFBBVC8ycHQgcmVzb2x2ZXMuXG4gIC8vIFBBVF9HT09EIC8gVFdPX1BPSU5UXyogYXJlIHRoZW1zZWx2ZXMgcG9zc2Vzc2lvbi1lbmRpbmcsIHNvIHRoZXkgRE8gcm91dGUuXG4gIC8vIEFmdGVyIHBvc3Nlc3Npb24gZW5kcywgZGVjaWRlIG5leHQuXG4gIGNvbnN0IGVuZGVkID0gZW5kT3ZlcnRpbWVQb3NzZXNzaW9uKHJlc3VsdC5zdGF0ZSk7XG4gIHJldHVybiB7XG4gICAgc3RhdGU6IGVuZGVkLnN0YXRlLFxuICAgIGV2ZW50czogWy4uLnJlc3VsdC5ldmVudHMsIC4uLmVuZGVkLmV2ZW50c10sXG4gIH07XG59XG5cbmZ1bmN0aW9uIHJlZHVjZUNvcmUoc3RhdGU6IEdhbWVTdGF0ZSwgYWN0aW9uOiBBY3Rpb24sIHJuZzogUm5nKTogUmVkdWNlUmVzdWx0IHtcbiAgc3dpdGNoIChhY3Rpb24udHlwZSkge1xuICAgIGNhc2UgXCJTVEFSVF9HQU1FXCI6XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0ZToge1xuICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgIHBoYXNlOiBcIkNPSU5fVE9TU1wiLFxuICAgICAgICAgIGNsb2NrOiB7XG4gICAgICAgICAgICAuLi5zdGF0ZS5jbG9jayxcbiAgICAgICAgICAgIHF1YXJ0ZXI6IDEsXG4gICAgICAgICAgICBxdWFydGVyTGVuZ3RoTWludXRlczogYWN0aW9uLnF1YXJ0ZXJMZW5ndGhNaW51dGVzLFxuICAgICAgICAgICAgc2Vjb25kc1JlbWFpbmluZzogYWN0aW9uLnF1YXJ0ZXJMZW5ndGhNaW51dGVzICogNjAsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBwbGF5ZXJzOiB7XG4gICAgICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICAgICAgMTogeyAuLi5zdGF0ZS5wbGF5ZXJzWzFdLCB0ZWFtOiB7IGlkOiBhY3Rpb24udGVhbXNbMV0gfSB9LFxuICAgICAgICAgICAgMjogeyAuLi5zdGF0ZS5wbGF5ZXJzWzJdLCB0ZWFtOiB7IGlkOiBhY3Rpb24udGVhbXNbMl0gfSB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGV2ZW50czogW3sgdHlwZTogXCJHQU1FX1NUQVJURURcIiB9XSxcbiAgICAgIH07XG5cbiAgICBjYXNlIFwiQ09JTl9UT1NTX0NBTExcIjoge1xuICAgICAgY29uc3QgYWN0dWFsID0gcm5nLmNvaW5GbGlwKCk7XG4gICAgICBjb25zdCB3aW5uZXIgPSBhY3Rpb24uY2FsbCA9PT0gYWN0dWFsID8gYWN0aW9uLnBsYXllciA6IG9wcChhY3Rpb24ucGxheWVyKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlLFxuICAgICAgICBldmVudHM6IFt7IHR5cGU6IFwiQ09JTl9UT1NTX1JFU1VMVFwiLCByZXN1bHQ6IGFjdHVhbCwgd2lubmVyIH1dLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiUkVDRUlWRV9DSE9JQ0VcIjoge1xuICAgICAgLy8gVGhlIGNhbGxlcidzIGNob2ljZSBkZXRlcm1pbmVzIHdobyByZWNlaXZlcyB0aGUgb3BlbmluZyBraWNrb2ZmLlxuICAgICAgLy8gXCJyZWNlaXZlXCIgXHUyMTkyIGNhbGxlciByZWNlaXZlczsgXCJkZWZlclwiIFx1MjE5MiBjYWxsZXIga2lja3MgKG9wcG9uZW50IHJlY2VpdmVzKS5cbiAgICAgIGNvbnN0IHJlY2VpdmVyID0gYWN0aW9uLmNob2ljZSA9PT0gXCJyZWNlaXZlXCIgPyBhY3Rpb24ucGxheWVyIDogb3BwKGFjdGlvbi5wbGF5ZXIpO1xuICAgICAgLy8gS2lja2VyIGlzIHRoZSBvcGVuaW5nIG9mZmVuc2UgKHRoZXkga2ljayBvZmYpOyByZWNlaXZlciBnZXRzIHRoZSBiYWxsIGFmdGVyLlxuICAgICAgY29uc3Qga2lja2VyID0gb3BwKHJlY2VpdmVyKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgcGhhc2U6IFwiS0lDS09GRlwiLFxuICAgICAgICAgIG9wZW5pbmdSZWNlaXZlcjogcmVjZWl2ZXIsXG4gICAgICAgICAgZmllbGQ6IHsgLi4uc3RhdGUuZmllbGQsIG9mZmVuc2U6IGtpY2tlciB9LFxuICAgICAgICB9LFxuICAgICAgICBldmVudHM6IFt7IHR5cGU6IFwiS0lDS09GRlwiLCByZWNlaXZpbmdQbGF5ZXI6IHJlY2VpdmVyLCBiYWxsT246IDM1IH1dLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiUkVTT0xWRV9LSUNLT0ZGXCI6IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHJlc29sdmVLaWNrb2ZmKHN0YXRlLCBybmcpO1xuICAgICAgcmV0dXJuIHsgc3RhdGU6IHJlc3VsdC5zdGF0ZSwgZXZlbnRzOiByZXN1bHQuZXZlbnRzIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIlNUQVJUX09UX1BPU1NFU1NJT05cIjoge1xuICAgICAgY29uc3QgciA9IHN0YXJ0T3ZlcnRpbWVQb3NzZXNzaW9uKHN0YXRlKTtcbiAgICAgIHJldHVybiB7IHN0YXRlOiByLnN0YXRlLCBldmVudHM6IHIuZXZlbnRzIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIlBJQ0tfUExBWVwiOiB7XG4gICAgICBjb25zdCBvZmZlbnNlID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgICAgIGNvbnN0IGlzT2ZmZW5zaXZlQ2FsbCA9IGFjdGlvbi5wbGF5ZXIgPT09IG9mZmVuc2U7XG5cbiAgICAgIC8vIFZhbGlkYXRlLiBJbGxlZ2FsIHBpY2tzIGFyZSBzaWxlbnRseSBuby1vcCdkOyB0aGUgb3JjaGVzdHJhdG9yXG4gICAgICAvLyAoc2VydmVyIC8gVUkpIGlzIHJlc3BvbnNpYmxlIGZvciBzdXJmYWNpbmcgdGhlIGVycm9yIHRvIHRoZSB1c2VyLlxuICAgICAgaWYgKGFjdGlvbi5wbGF5ID09PSBcIkZHXCIgfHwgYWN0aW9uLnBsYXkgPT09IFwiUFVOVFwiIHx8IGFjdGlvbi5wbGF5ID09PSBcIlRXT19QVFwiKSB7XG4gICAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07IC8vIHdyb25nIGFjdGlvbiB0eXBlIGZvciB0aGVzZVxuICAgICAgfVxuICAgICAgaWYgKGFjdGlvbi5wbGF5ID09PSBcIkhNXCIgJiYgIWlzT2ZmZW5zaXZlQ2FsbCkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9OyAvLyBkZWZlbnNlIGNhbid0IGNhbGwgSGFpbCBNYXJ5XG4gICAgICB9XG4gICAgICBjb25zdCBoYW5kID0gc3RhdGUucGxheWVyc1thY3Rpb24ucGxheWVyXS5oYW5kO1xuICAgICAgaWYgKGFjdGlvbi5wbGF5ID09PSBcIkhNXCIgJiYgaGFuZC5ITSA8PSAwKSB7XG4gICAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gICAgICB9XG4gICAgICBpZiAoXG4gICAgICAgIChhY3Rpb24ucGxheSA9PT0gXCJTUlwiIHx8IGFjdGlvbi5wbGF5ID09PSBcIkxSXCIgfHwgYWN0aW9uLnBsYXkgPT09IFwiU1BcIiB8fCBhY3Rpb24ucGxheSA9PT0gXCJMUFwiIHx8IGFjdGlvbi5wbGF5ID09PSBcIlRQXCIpICYmXG4gICAgICAgIGhhbmRbYWN0aW9uLnBsYXldIDw9IDBcbiAgICAgICkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgfVxuICAgICAgLy8gUmVqZWN0IHJlLXBpY2tzIGZvciB0aGUgc2FtZSBzaWRlIGluIHRoZSBzYW1lIHBsYXkuXG4gICAgICBpZiAoaXNPZmZlbnNpdmVDYWxsICYmIHN0YXRlLnBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5KSB7XG4gICAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gICAgICB9XG4gICAgICBpZiAoIWlzT2ZmZW5zaXZlQ2FsbCAmJiBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSkge1xuICAgICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgfVxuXG4gICAgICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXG4gICAgICAgIHsgdHlwZTogXCJQTEFZX0NBTExFRFwiLCBwbGF5ZXI6IGFjdGlvbi5wbGF5ZXIsIHBsYXk6IGFjdGlvbi5wbGF5IH0sXG4gICAgICBdO1xuXG4gICAgICBjb25zdCBwZW5kaW5nUGljayA9IHtcbiAgICAgICAgb2ZmZW5zZVBsYXk6IGlzT2ZmZW5zaXZlQ2FsbCA/IGFjdGlvbi5wbGF5IDogc3RhdGUucGVuZGluZ1BpY2sub2ZmZW5zZVBsYXksXG4gICAgICAgIGRlZmVuc2VQbGF5OiBpc09mZmVuc2l2ZUNhbGwgPyBzdGF0ZS5wZW5kaW5nUGljay5kZWZlbnNlUGxheSA6IGFjdGlvbi5wbGF5LFxuICAgICAgfTtcblxuICAgICAgLy8gQm90aCB0ZWFtcyBoYXZlIHBpY2tlZCBcdTIwMTQgcmVzb2x2ZS5cbiAgICAgIGlmIChwZW5kaW5nUGljay5vZmZlbnNlUGxheSAmJiBwZW5kaW5nUGljay5kZWZlbnNlUGxheSkge1xuICAgICAgICBjb25zdCBzdGF0ZVdpdGhQaWNrOiBHYW1lU3RhdGUgPSB7IC4uLnN0YXRlLCBwZW5kaW5nUGljayB9O1xuXG4gICAgICAgIC8vIDItcG9pbnQgY29udmVyc2lvbjogUElDS19QTEFZIGluIFRXT19QVF9DT05WIHBoYXNlIHJvdXRlcyB0byBhXG4gICAgICAgIC8vIGRlZGljYXRlZCByZXNvbHZlciAoZGlmZmVyZW50IHNjb3JpbmcgKyB0cmFuc2l0aW9uIHRoYW4gcmVndWxhclxuICAgICAgICAvLyBwbGF5KS4gUmVzdHJpY3RlZCB0byByZWd1bGFyIHBsYXlzIFx1MjAxNCBlbmdpbmUgaW50ZW50aW9uYWxseVxuICAgICAgICAvLyBkb2Vzbid0IGFsbG93IEhNL1RQIGV4b3RpYyBmbG93cyBvbiB0aGUgY29udmVyc2lvbi5cbiAgICAgICAgaWYgKFxuICAgICAgICAgIHN0YXRlLnBoYXNlID09PSBcIlRXT19QVF9DT05WXCIgJiZcbiAgICAgICAgICBpc1JlZ3VsYXJQbGF5KHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5KSAmJlxuICAgICAgICAgIGlzUmVndWxhclBsYXkocGVuZGluZ1BpY2suZGVmZW5zZVBsYXkpXG4gICAgICAgICkge1xuICAgICAgICAgIGNvbnN0IHRwID0gcmVzb2x2ZVR3b1BvaW50Q29udmVyc2lvbihcbiAgICAgICAgICAgIHN0YXRlV2l0aFBpY2ssXG4gICAgICAgICAgICBwZW5kaW5nUGljay5vZmZlbnNlUGxheSxcbiAgICAgICAgICAgIHBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5LFxuICAgICAgICAgICAgcm5nLFxuICAgICAgICAgICk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHRwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLnRwLmV2ZW50c10gfTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEhhaWwgTWFyeSBieSBvZmZlbnNlIFx1MjAxNCByZXNvbHZlcyBpbW1lZGlhdGVseSwgZGVmZW5zZSBwaWNrIGlnbm9yZWQuXG4gICAgICAgIGlmIChwZW5kaW5nUGljay5vZmZlbnNlUGxheSA9PT0gXCJITVwiKSB7XG4gICAgICAgICAgY29uc3QgaG0gPSByZXNvbHZlSGFpbE1hcnkoc3RhdGVXaXRoUGljaywgcm5nKTtcbiAgICAgICAgICByZXR1cm4geyBzdGF0ZTogaG0uc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4uaG0uZXZlbnRzXSB9O1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVHJpY2sgUGxheSBieSBlaXRoZXIgc2lkZS4gdjUuMSAocnVuLmpzOjE4ODYpOiBpZiBib3RoIHBpY2sgVFAsXG4gICAgICAgIC8vIFNhbWUgUGxheSBjb2luIGFsd2F5cyB0cmlnZ2VycyBcdTIwMTQgZmFsbHMgdGhyb3VnaCB0byBTYW1lIFBsYXkgYmVsb3cuXG4gICAgICAgIGlmIChcbiAgICAgICAgICBwZW5kaW5nUGljay5vZmZlbnNlUGxheSA9PT0gXCJUUFwiICYmXG4gICAgICAgICAgcGVuZGluZ1BpY2suZGVmZW5zZVBsYXkgIT09IFwiVFBcIlxuICAgICAgICApIHtcbiAgICAgICAgICBjb25zdCB0cCA9IHJlc29sdmVPZmZlbnNpdmVUcmlja1BsYXkoc3RhdGVXaXRoUGljaywgcm5nKTtcbiAgICAgICAgICByZXR1cm4geyBzdGF0ZTogdHAuc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4udHAuZXZlbnRzXSB9O1xuICAgICAgICB9XG4gICAgICAgIGlmIChcbiAgICAgICAgICBwZW5kaW5nUGljay5kZWZlbnNlUGxheSA9PT0gXCJUUFwiICYmXG4gICAgICAgICAgcGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkgIT09IFwiVFBcIlxuICAgICAgICApIHtcbiAgICAgICAgICBjb25zdCB0cCA9IHJlc29sdmVEZWZlbnNpdmVUcmlja1BsYXkoc3RhdGVXaXRoUGljaywgcm5nKTtcbiAgICAgICAgICByZXR1cm4geyBzdGF0ZTogdHAuc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4udHAuZXZlbnRzXSB9O1xuICAgICAgICB9XG4gICAgICAgIGlmIChwZW5kaW5nUGljay5vZmZlbnNlUGxheSA9PT0gXCJUUFwiICYmIHBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5ID09PSBcIlRQXCIpIHtcbiAgICAgICAgICAvLyBCb3RoIFRQIFx1MjE5MiBTYW1lIFBsYXkgdW5jb25kaXRpb25hbGx5LlxuICAgICAgICAgIGNvbnN0IHNwID0gcmVzb2x2ZVNhbWVQbGF5KHN0YXRlV2l0aFBpY2ssIHJuZyk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHNwLnN0YXRlLCBldmVudHM6IFsuLi5ldmVudHMsIC4uLnNwLmV2ZW50c10gfTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFJlZ3VsYXIgdnMgcmVndWxhci5cbiAgICAgICAgaWYgKFxuICAgICAgICAgIGlzUmVndWxhclBsYXkocGVuZGluZ1BpY2sub2ZmZW5zZVBsYXkpICYmXG4gICAgICAgICAgaXNSZWd1bGFyUGxheShwZW5kaW5nUGljay5kZWZlbnNlUGxheSlcbiAgICAgICAgKSB7XG4gICAgICAgICAgLy8gU2FtZSBwbGF5PyA1MC81MCBjaGFuY2UgdG8gdHJpZ2dlciBTYW1lIFBsYXkgbWVjaGFuaXNtLlxuICAgICAgICAgIC8vIFNvdXJjZTogcnVuLmpzOjE4ODYgKGBpZiAocGwxID09PSBwbDIpYCkuXG4gICAgICAgICAgaWYgKHBlbmRpbmdQaWNrLm9mZmVuc2VQbGF5ID09PSBwZW5kaW5nUGljay5kZWZlbnNlUGxheSkge1xuICAgICAgICAgICAgY29uc3QgdHJpZ2dlciA9IHJuZy5jb2luRmxpcCgpO1xuICAgICAgICAgICAgaWYgKHRyaWdnZXIgPT09IFwiaGVhZHNcIikge1xuICAgICAgICAgICAgICBjb25zdCBzcCA9IHJlc29sdmVTYW1lUGxheShzdGF0ZVdpdGhQaWNrLCBybmcpO1xuICAgICAgICAgICAgICByZXR1cm4geyBzdGF0ZTogc3Auc3RhdGUsIGV2ZW50czogWy4uLmV2ZW50cywgLi4uc3AuZXZlbnRzXSB9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gVGFpbHM6IGZhbGwgdGhyb3VnaCB0byByZWd1bGFyIHJlc29sdXRpb24gKHF1YWxpdHkgNSBvdXRjb21lKS5cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCByZXNvbHZlZCA9IHJlc29sdmVSZWd1bGFyUGxheShcbiAgICAgICAgICAgIHN0YXRlV2l0aFBpY2ssXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG9mZmVuc2VQbGF5OiBwZW5kaW5nUGljay5vZmZlbnNlUGxheSxcbiAgICAgICAgICAgICAgZGVmZW5zZVBsYXk6IHBlbmRpbmdQaWNrLmRlZmVuc2VQbGF5LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHJuZyxcbiAgICAgICAgICApO1xuICAgICAgICAgIHJldHVybiB7IHN0YXRlOiByZXNvbHZlZC5zdGF0ZSwgZXZlbnRzOiBbLi4uZXZlbnRzLCAuLi5yZXNvbHZlZC5ldmVudHNdIH07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBEZWZlbnNpdmUgdHJpY2sgcGxheSwgRkcsIFBVTlQsIFRXT19QVCBwaWNrcyBcdTIwMTQgbm90IHJvdXRlZCBoZXJlIHlldC5cbiAgICAgICAgLy8gRkcvUFVOVC9UV09fUFQgYXJlIGRyaXZlbiBieSBGT1VSVEhfRE9XTl9DSE9JQ0UgLyBQQVRfQ0hPSUNFIGFjdGlvbnMsXG4gICAgICAgIC8vIG5vdCBieSBQSUNLX1BMQVkuIERlZmVuc2l2ZSBUUCBpcyBhIFRPRE8uXG4gICAgICAgIHJldHVybiB7IHN0YXRlOiBzdGF0ZVdpdGhQaWNrLCBldmVudHMgfTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHsgc3RhdGU6IHsgLi4uc3RhdGUsIHBlbmRpbmdQaWNrIH0sIGV2ZW50cyB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJDQUxMX1RJTUVPVVRcIjoge1xuICAgICAgY29uc3QgcCA9IHN0YXRlLnBsYXllcnNbYWN0aW9uLnBsYXllcl07XG4gICAgICBpZiAocC50aW1lb3V0cyA8PSAwKSByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuICAgICAgY29uc3QgcmVtYWluaW5nID0gcC50aW1lb3V0cyAtIDE7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0ZToge1xuICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgIHBsYXllcnM6IHtcbiAgICAgICAgICAgIC4uLnN0YXRlLnBsYXllcnMsXG4gICAgICAgICAgICBbYWN0aW9uLnBsYXllcl06IHsgLi4ucCwgdGltZW91dHM6IHJlbWFpbmluZyB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGV2ZW50czogW3sgdHlwZTogXCJUSU1FT1VUX0NBTExFRFwiLCBwbGF5ZXI6IGFjdGlvbi5wbGF5ZXIsIHJlbWFpbmluZyB9XSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgY2FzZSBcIkFDQ0VQVF9QRU5BTFRZXCI6XG4gICAgY2FzZSBcIkRFQ0xJTkVfUEVOQUxUWVwiOlxuICAgICAgLy8gUGVuYWx0aWVzIGFyZSBjYXB0dXJlZCBhcyBldmVudHMgYXQgcmVzb2x1dGlvbiB0aW1lLCBidXQgYWNjZXB0L2RlY2xpbmVcbiAgICAgIC8vIGZsb3cgcmVxdWlyZXMgc3RhdGUgbm90IHlldCBtb2RlbGVkIChwZW5kaW5nIHBlbmFsdHkpLiBUT0RPIHdoZW5cbiAgICAgIC8vIHBlbmFsdHkgbWVjaGFuaWNzIGFyZSBwb3J0ZWQgZnJvbSBydW4uanMuXG4gICAgICByZXR1cm4geyBzdGF0ZSwgZXZlbnRzOiBbXSB9O1xuXG4gICAgY2FzZSBcIlBBVF9DSE9JQ0VcIjoge1xuICAgICAgY29uc3Qgc2NvcmVyID0gc3RhdGUuZmllbGQub2ZmZW5zZTtcbiAgICAgIC8vIDNPVCsgcmVxdWlyZXMgMi1wb2ludCBjb252ZXJzaW9uLiBTaWxlbnRseSBzdWJzdGl0dXRlIGV2ZW4gaWYgXCJraWNrXCJcbiAgICAgIC8vIHdhcyBzZW50IChtYXRjaGVzIHY1LjEncyBcIm11c3RcIiBiZWhhdmlvciBhdCBydW4uanM6MTY0MSkuXG4gICAgICBjb25zdCBlZmZlY3RpdmVDaG9pY2UgPVxuICAgICAgICBzdGF0ZS5vdmVydGltZSAmJiBzdGF0ZS5vdmVydGltZS5wZXJpb2QgPj0gM1xuICAgICAgICAgID8gXCJ0d29fcG9pbnRcIlxuICAgICAgICAgIDogYWN0aW9uLmNob2ljZTtcbiAgICAgIGlmIChlZmZlY3RpdmVDaG9pY2UgPT09IFwia2lja1wiKSB7XG4gICAgICAgIC8vIEFzc3VtZSBhdXRvbWF0aWMgaW4gdjUuMSBcdTIwMTQgbm8gbWVjaGFuaWMgcmVjb3JkZWQgZm9yIFBBVCBraWNrcy5cbiAgICAgICAgY29uc3QgbmV3UGxheWVycyA9IHtcbiAgICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICAgIFtzY29yZXJdOiB7IC4uLnN0YXRlLnBsYXllcnNbc2NvcmVyXSwgc2NvcmU6IHN0YXRlLnBsYXllcnNbc2NvcmVyXS5zY29yZSArIDEgfSxcbiAgICAgICAgfSBhcyBHYW1lU3RhdGVbXCJwbGF5ZXJzXCJdO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICAgIHBsYXllcnM6IG5ld1BsYXllcnMsXG4gICAgICAgICAgICBwaGFzZTogXCJLSUNLT0ZGXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBldmVudHM6IFt7IHR5cGU6IFwiUEFUX0dPT0RcIiwgcGxheWVyOiBzY29yZXIgfV0sXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICAvLyB0d29fcG9pbnQgXHUyMTkyIHRyYW5zaXRpb24gdG8gVFdPX1BUX0NPTlYgcGhhc2U7IGEgUElDS19QTEFZIHJlc29sdmVzIGl0LlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdGU6IHtcbiAgICAgICAgICAuLi5zdGF0ZSxcbiAgICAgICAgICBwaGFzZTogXCJUV09fUFRfQ09OVlwiLFxuICAgICAgICAgIGZpZWxkOiB7IC4uLnN0YXRlLmZpZWxkLCBiYWxsT246IDk3LCBmaXJzdERvd25BdDogMTAwLCBkb3duOiAxIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGV2ZW50czogW10sXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJGT1VSVEhfRE9XTl9DSE9JQ0VcIjoge1xuICAgICAgaWYgKGFjdGlvbi5jaG9pY2UgPT09IFwiZ29cIikge1xuICAgICAgICAvLyBOb3RoaW5nIHRvIGRvIFx1MjAxNCB0aGUgbmV4dCBQSUNLX1BMQVkgd2lsbCByZXNvbHZlIG5vcm1hbGx5IGZyb20gNHRoIGRvd24uXG4gICAgICAgIHJldHVybiB7IHN0YXRlLCBldmVudHM6IFtdIH07XG4gICAgICB9XG4gICAgICBpZiAoYWN0aW9uLmNob2ljZSA9PT0gXCJwdW50XCIpIHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gcmVzb2x2ZVB1bnQoc3RhdGUsIHJuZyk7XG4gICAgICAgIHJldHVybiB7IHN0YXRlOiByZXN1bHQuc3RhdGUsIGV2ZW50czogcmVzdWx0LmV2ZW50cyB9O1xuICAgICAgfVxuICAgICAgLy8gZmdcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHJlc29sdmVGaWVsZEdvYWwoc3RhdGUsIHJuZyk7XG4gICAgICByZXR1cm4geyBzdGF0ZTogcmVzdWx0LnN0YXRlLCBldmVudHM6IHJlc3VsdC5ldmVudHMgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiRk9SRkVJVFwiOiB7XG4gICAgICBjb25zdCB3aW5uZXIgPSBvcHAoYWN0aW9uLnBsYXllcik7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0ZTogeyAuLi5zdGF0ZSwgcGhhc2U6IFwiR0FNRV9PVkVSXCIgfSxcbiAgICAgICAgZXZlbnRzOiBbeyB0eXBlOiBcIkdBTUVfT1ZFUlwiLCB3aW5uZXIgfV0sXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJUSUNLX0NMT0NLXCI6IHtcbiAgICAgIGNvbnN0IHByZXYgPSBzdGF0ZS5jbG9jay5zZWNvbmRzUmVtYWluaW5nO1xuICAgICAgY29uc3QgbmV4dCA9IE1hdGgubWF4KDAsIHByZXYgLSBhY3Rpb24uc2Vjb25kcyk7XG4gICAgICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbeyB0eXBlOiBcIkNMT0NLX1RJQ0tFRFwiLCBzZWNvbmRzOiBhY3Rpb24uc2Vjb25kcyB9XTtcblxuICAgICAgLy8gVHdvLW1pbnV0ZSB3YXJuaW5nOiBjcm9zc2luZyAxMjAgc2Vjb25kcyBpbiBRMiBvciBRNCB0cmlnZ2VycyBhbiBldmVudC5cbiAgICAgIGlmIChcbiAgICAgICAgKHN0YXRlLmNsb2NrLnF1YXJ0ZXIgPT09IDIgfHwgc3RhdGUuY2xvY2sucXVhcnRlciA9PT0gNCkgJiZcbiAgICAgICAgcHJldiA+IDEyMCAmJlxuICAgICAgICBuZXh0IDw9IDEyMFxuICAgICAgKSB7XG4gICAgICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJUV09fTUlOVVRFX1dBUk5JTkdcIiB9KTtcbiAgICAgIH1cblxuICAgICAgaWYgKG5leHQgPT09IDApIHtcbiAgICAgICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcIlFVQVJURVJfRU5ERURcIiwgcXVhcnRlcjogc3RhdGUuY2xvY2sucXVhcnRlciB9KTtcbiAgICAgICAgLy8gUTFcdTIxOTJRMiBhbmQgUTNcdTIxOTJRNDogcm9sbCBvdmVyIGNsb2NrLCBzYW1lIGhhbGYsIHNhbWUgcG9zc2Vzc2lvbiBjb250aW51ZXMuXG4gICAgICAgIGlmIChzdGF0ZS5jbG9jay5xdWFydGVyID09PSAxIHx8IHN0YXRlLmNsb2NrLnF1YXJ0ZXIgPT09IDMpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdGU6IHtcbiAgICAgICAgICAgICAgLi4uc3RhdGUsXG4gICAgICAgICAgICAgIGNsb2NrOiB7XG4gICAgICAgICAgICAgICAgLi4uc3RhdGUuY2xvY2ssXG4gICAgICAgICAgICAgICAgcXVhcnRlcjogc3RhdGUuY2xvY2sucXVhcnRlciArIDEsXG4gICAgICAgICAgICAgICAgc2Vjb25kc1JlbWFpbmluZzogc3RhdGUuY2xvY2sucXVhcnRlckxlbmd0aE1pbnV0ZXMgKiA2MCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBldmVudHMsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICAvLyBFbmQgb2YgUTIgPSBoYWxmdGltZS4gUTQgZW5kID0gcmVndWxhdGlvbiBvdmVyLlxuICAgICAgICBpZiAoc3RhdGUuY2xvY2sucXVhcnRlciA9PT0gMikge1xuICAgICAgICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJIQUxGX0VOREVEXCIgfSk7XG4gICAgICAgICAgLy8gUmVjZWl2ZXIgb2Ygb3BlbmluZyBraWNrb2ZmIGtpY2tzIHRoZSBzZWNvbmQgaGFsZjsgZmxpcCBwb3NzZXNzaW9uLlxuICAgICAgICAgIGNvbnN0IHNlY29uZEhhbGZSZWNlaXZlciA9XG4gICAgICAgICAgICBzdGF0ZS5vcGVuaW5nUmVjZWl2ZXIgPT09IG51bGwgPyAxIDogb3BwKHN0YXRlLm9wZW5pbmdSZWNlaXZlcik7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXRlOiB7XG4gICAgICAgICAgICAgIC4uLnN0YXRlLFxuICAgICAgICAgICAgICBwaGFzZTogXCJLSUNLT0ZGXCIsXG4gICAgICAgICAgICAgIGNsb2NrOiB7XG4gICAgICAgICAgICAgICAgLi4uc3RhdGUuY2xvY2ssXG4gICAgICAgICAgICAgICAgcXVhcnRlcjogMyxcbiAgICAgICAgICAgICAgICBzZWNvbmRzUmVtYWluaW5nOiBzdGF0ZS5jbG9jay5xdWFydGVyTGVuZ3RoTWludXRlcyAqIDYwLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBmaWVsZDogeyAuLi5zdGF0ZS5maWVsZCwgb2ZmZW5zZTogb3BwKHNlY29uZEhhbGZSZWNlaXZlcikgfSxcbiAgICAgICAgICAgICAgLy8gUmVmcmVzaCB0aW1lb3V0cyBmb3IgbmV3IGhhbGYuXG4gICAgICAgICAgICAgIHBsYXllcnM6IHtcbiAgICAgICAgICAgICAgICAuLi5zdGF0ZS5wbGF5ZXJzLFxuICAgICAgICAgICAgICAgIDE6IHsgLi4uc3RhdGUucGxheWVyc1sxXSwgdGltZW91dHM6IDMgfSxcbiAgICAgICAgICAgICAgICAyOiB7IC4uLnN0YXRlLnBsYXllcnNbMl0sIHRpbWVvdXRzOiAzIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZXZlbnRzLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgLy8gUTQgZW5kZWQuXG4gICAgICAgIGNvbnN0IHAxID0gc3RhdGUucGxheWVyc1sxXS5zY29yZTtcbiAgICAgICAgY29uc3QgcDIgPSBzdGF0ZS5wbGF5ZXJzWzJdLnNjb3JlO1xuICAgICAgICBpZiAocDEgIT09IHAyKSB7XG4gICAgICAgICAgY29uc3Qgd2lubmVyID0gcDEgPiBwMiA/IDEgOiAyO1xuICAgICAgICAgIGV2ZW50cy5wdXNoKHsgdHlwZTogXCJHQU1FX09WRVJcIiwgd2lubmVyIH0pO1xuICAgICAgICAgIHJldHVybiB7IHN0YXRlOiB7IC4uLnN0YXRlLCBwaGFzZTogXCJHQU1FX09WRVJcIiB9LCBldmVudHMgfTtcbiAgICAgICAgfVxuICAgICAgICAvLyBUaWVkIFx1MjAxNCBoZWFkIHRvIG92ZXJ0aW1lLlxuICAgICAgICBjb25zdCBvdENsb2NrID0geyAuLi5zdGF0ZS5jbG9jaywgcXVhcnRlcjogNSwgc2Vjb25kc1JlbWFpbmluZzogMCB9O1xuICAgICAgICBjb25zdCBvdCA9IHN0YXJ0T3ZlcnRpbWUoeyAuLi5zdGF0ZSwgY2xvY2s6IG90Q2xvY2sgfSk7XG4gICAgICAgIGV2ZW50cy5wdXNoKC4uLm90LmV2ZW50cyk7XG4gICAgICAgIHJldHVybiB7IHN0YXRlOiBvdC5zdGF0ZSwgZXZlbnRzIH07XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlOiB7IC4uLnN0YXRlLCBjbG9jazogeyAuLi5zdGF0ZS5jbG9jaywgc2Vjb25kc1JlbWFpbmluZzogbmV4dCB9IH0sXG4gICAgICAgIGV2ZW50cyxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgZGVmYXVsdDoge1xuICAgICAgLy8gRXhoYXVzdGl2ZW5lc3MgY2hlY2sgXHUyMDE0IGFkZGluZyBhIG5ldyBBY3Rpb24gdmFyaWFudCB3aXRob3V0IGhhbmRsaW5nIGl0XG4gICAgICAvLyBoZXJlIHdpbGwgcHJvZHVjZSBhIGNvbXBpbGUgZXJyb3IuXG4gICAgICBjb25zdCBfZXhoYXVzdGl2ZTogbmV2ZXIgPSBhY3Rpb247XG4gICAgICB2b2lkIF9leGhhdXN0aXZlO1xuICAgICAgcmV0dXJuIHsgc3RhdGUsIGV2ZW50czogW10gfTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBDb252ZW5pZW5jZSBmb3IgcmVwbGF5aW5nIGEgc2VxdWVuY2Ugb2YgYWN0aW9ucyBcdTIwMTQgdXNlZnVsIGZvciB0ZXN0cyBhbmRcbiAqIGZvciBzZXJ2ZXItc2lkZSBnYW1lIHJlcGxheSBmcm9tIGFjdGlvbiBsb2cuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWR1Y2VNYW55KFxuICBzdGF0ZTogR2FtZVN0YXRlLFxuICBhY3Rpb25zOiBBY3Rpb25bXSxcbiAgcm5nOiBSbmcsXG4pOiBSZWR1Y2VSZXN1bHQge1xuICBsZXQgY3VycmVudCA9IHN0YXRlO1xuICBjb25zdCBldmVudHM6IEV2ZW50W10gPSBbXTtcbiAgZm9yIChjb25zdCBhY3Rpb24gb2YgYWN0aW9ucykge1xuICAgIGNvbnN0IHJlc3VsdCA9IHJlZHVjZShjdXJyZW50LCBhY3Rpb24sIHJuZyk7XG4gICAgY3VycmVudCA9IHJlc3VsdC5zdGF0ZTtcbiAgICBldmVudHMucHVzaCguLi5yZXN1bHQuZXZlbnRzKTtcbiAgfVxuICByZXR1cm4geyBzdGF0ZTogY3VycmVudCwgZXZlbnRzIH07XG59XG4iLCAiLyoqXG4gKiBSTkcgYWJzdHJhY3Rpb24uXG4gKlxuICogVGhlIGVuZ2luZSBuZXZlciByZWFjaGVzIGZvciBgTWF0aC5yYW5kb20oKWAgZGlyZWN0bHkuIEFsbCByYW5kb21uZXNzIGlzXG4gKiBzb3VyY2VkIGZyb20gYW4gYFJuZ2AgaW5zdGFuY2UgcGFzc2VkIGludG8gYHJlZHVjZSgpYC4gVGhpcyBpcyB3aGF0IG1ha2VzXG4gKiB0aGUgZW5naW5lIGRldGVybWluaXN0aWMgYW5kIHRlc3RhYmxlLlxuICpcbiAqIEluIHByb2R1Y3Rpb24sIHRoZSBTdXBhYmFzZSBFZGdlIEZ1bmN0aW9uIGNyZWF0ZXMgYSBzZWVkZWQgUk5HIHBlciBnYW1lXG4gKiAoc2VlZCBzdG9yZWQgYWxvbmdzaWRlIGdhbWUgc3RhdGUpLCBzbyBhIGNvbXBsZXRlIGdhbWUgY2FuIGJlIHJlcGxheWVkXG4gKiBkZXRlcm1pbmlzdGljYWxseSBmcm9tIGl0cyBhY3Rpb24gbG9nIFx1MjAxNCB1c2VmdWwgZm9yIGJ1ZyByZXBvcnRzLCByZWNhcFxuICogZ2VuZXJhdGlvbiwgYW5kIFwid2F0Y2ggdGhlIGdhbWUgYmFja1wiIGZlYXR1cmVzLlxuICovXG5cbmV4cG9ydCBpbnRlcmZhY2UgUm5nIHtcbiAgLyoqIEluY2x1c2l2ZSBib3RoIGVuZHMuICovXG4gIGludEJldHdlZW4obWluSW5jbHVzaXZlOiBudW1iZXIsIG1heEluY2x1c2l2ZTogbnVtYmVyKTogbnVtYmVyO1xuICAvKiogUmV0dXJucyBcImhlYWRzXCIgb3IgXCJ0YWlsc1wiLiAqL1xuICBjb2luRmxpcCgpOiBcImhlYWRzXCIgfCBcInRhaWxzXCI7XG4gIC8qKiBSZXR1cm5zIDEtNi4gKi9cbiAgZDYoKTogMSB8IDIgfCAzIHwgNCB8IDUgfCA2O1xufVxuXG4vKipcbiAqIE11bGJlcnJ5MzIgXHUyMDE0IGEgc21hbGwsIGZhc3QsIHdlbGwtZGlzdHJpYnV0ZWQgc2VlZGVkIFBSTkcuIFN1ZmZpY2llbnQgZm9yXG4gKiBhIGNhcmQtZHJhd2luZyBmb290YmFsbCBnYW1lOyBub3QgZm9yIGNyeXB0b2dyYXBoeS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNlZWRlZFJuZyhzZWVkOiBudW1iZXIpOiBSbmcge1xuICBsZXQgc3RhdGUgPSBzZWVkID4+PiAwO1xuXG4gIGNvbnN0IG5leHQgPSAoKTogbnVtYmVyID0+IHtcbiAgICBzdGF0ZSA9IChzdGF0ZSArIDB4NmQyYjc5ZjUpID4+PiAwO1xuICAgIGxldCB0ID0gc3RhdGU7XG4gICAgdCA9IE1hdGguaW11bCh0IF4gKHQgPj4+IDE1KSwgdCB8IDEpO1xuICAgIHQgXj0gdCArIE1hdGguaW11bCh0IF4gKHQgPj4+IDcpLCB0IHwgNjEpO1xuICAgIHJldHVybiAoKHQgXiAodCA+Pj4gMTQpKSA+Pj4gMCkgLyA0Mjk0OTY3Mjk2O1xuICB9O1xuXG4gIHJldHVybiB7XG4gICAgaW50QmV0d2VlbihtaW4sIG1heCkge1xuICAgICAgcmV0dXJuIE1hdGguZmxvb3IobmV4dCgpICogKG1heCAtIG1pbiArIDEpKSArIG1pbjtcbiAgICB9LFxuICAgIGNvaW5GbGlwKCkge1xuICAgICAgcmV0dXJuIG5leHQoKSA8IDAuNSA/IFwiaGVhZHNcIiA6IFwidGFpbHNcIjtcbiAgICB9LFxuICAgIGQ2KCkge1xuICAgICAgcmV0dXJuIChNYXRoLmZsb29yKG5leHQoKSAqIDYpICsgMSkgYXMgMSB8IDIgfCAzIHwgNCB8IDUgfCA2O1xuICAgIH0sXG4gIH07XG59XG4iLCAiLyoqXG4gKiBQdXJlIG91dGNvbWUtdGFibGUgaGVscGVycyBmb3Igc3BlY2lhbCBwbGF5cy4gVGhlc2UgYXJlIGV4dHJhY3RlZFxuICogZnJvbSB0aGUgZnVsbCByZXNvbHZlcnMgc28gdGhhdCBjb25zdW1lcnMgKGxpa2UgdjUuMSdzIGFzeW5jIGNvZGVcbiAqIHBhdGhzKSBjYW4gbG9vayB1cCB0aGUgcnVsZSBvdXRjb21lIHdpdGhvdXQgcnVubmluZyB0aGUgZW5naW5lJ3NcbiAqIHN0YXRlIHRyYW5zaXRpb24uXG4gKlxuICogT25jZSBQaGFzZSAyIGNvbGxhcHNlcyB0aGUgb3JjaGVzdHJhdG9yIGludG8gYGVuZ2luZS5yZWR1Y2VgLCB0aGVzZVxuICogaGVscGVycyBiZWNvbWUgYW4gaW50ZXJuYWwgaW1wbGVtZW50YXRpb24gZGV0YWlsLiBVbnRpbCB0aGVuLCB0aGV5XG4gKiBsZXQgdjUuMSB1c2UgdGhlIGVuZ2luZSBhcyB0aGUgc291cmNlIG9mIHRydXRoIGZvciBnYW1lIHJ1bGVzIHdoaWxlXG4gKiBrZWVwaW5nIGl0cyBpbXBlcmF0aXZlIGZsb3cuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBNdWx0aXBsaWVyQ2FyZE5hbWUgfSBmcm9tIFwiLi4veWFyZGFnZS5qc1wiO1xuaW1wb3J0IHR5cGUgeyBQbGF5ZXJJZCB9IGZyb20gXCIuLi8uLi90eXBlcy5qc1wiO1xuXG4vLyAtLS0tLS0tLS0tIFNhbWUgUGxheSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IHR5cGUgU2FtZVBsYXlPdXRjb21lID1cbiAgfCB7IGtpbmQ6IFwiYmlnX3BsYXlcIjsgYmVuZWZpY2lhcnk6IFwib2ZmZW5zZVwiIHwgXCJkZWZlbnNlXCIgfVxuICB8IHsga2luZDogXCJtdWx0aXBsaWVyXCI7IHZhbHVlOiBudW1iZXI7IGRyYXdZYXJkczogYm9vbGVhbiB9XG4gIHwgeyBraW5kOiBcImludGVyY2VwdGlvblwiIH1cbiAgfCB7IGtpbmQ6IFwibm9fZ2FpblwiIH07XG5cbi8qKlxuICogdjUuMSdzIFNhbWUgUGxheSB0YWJsZSAocnVuLmpzOjE4OTkpLlxuICpcbiAqICAgS2luZyAgICBcdTIxOTIgQmlnIFBsYXkgKG9mZmVuc2UgaWYgaGVhZHMsIGRlZmVuc2UgaWYgdGFpbHMpXG4gKiAgIFF1ZWVuICsgaGVhZHMgXHUyMTkyICszeCBtdWx0aXBsaWVyIChkcmF3IHlhcmRzKVxuICogICBRdWVlbiArIHRhaWxzIFx1MjE5MiAweCBtdWx0aXBsaWVyIChubyB5YXJkcywgbm8gZ2FpbilcbiAqICAgSmFjayAgKyBoZWFkcyBcdTIxOTIgMHggbXVsdGlwbGllclxuICogICBKYWNrICArIHRhaWxzIFx1MjE5MiAtM3ggbXVsdGlwbGllciAoZHJhdyB5YXJkcylcbiAqICAgMTAgICAgKyBoZWFkcyBcdTIxOTIgSU5URVJDRVBUSU9OXG4gKiAgIDEwICAgICsgdGFpbHMgXHUyMTkyIDAgeWFyZHMgKG5vIG1lY2hhbmljKVxuICovXG5leHBvcnQgZnVuY3Rpb24gc2FtZVBsYXlPdXRjb21lKFxuICBjYXJkOiBNdWx0aXBsaWVyQ2FyZE5hbWUsXG4gIGNvaW46IFwiaGVhZHNcIiB8IFwidGFpbHNcIixcbik6IFNhbWVQbGF5T3V0Y29tZSB7XG4gIGNvbnN0IGhlYWRzID0gY29pbiA9PT0gXCJoZWFkc1wiO1xuICBpZiAoY2FyZCA9PT0gXCJLaW5nXCIpIHJldHVybiB7IGtpbmQ6IFwiYmlnX3BsYXlcIiwgYmVuZWZpY2lhcnk6IGhlYWRzID8gXCJvZmZlbnNlXCIgOiBcImRlZmVuc2VcIiB9O1xuICBpZiAoY2FyZCA9PT0gXCIxMFwiKSByZXR1cm4gaGVhZHMgPyB7IGtpbmQ6IFwiaW50ZXJjZXB0aW9uXCIgfSA6IHsga2luZDogXCJub19nYWluXCIgfTtcbiAgaWYgKGNhcmQgPT09IFwiUXVlZW5cIikge1xuICAgIHJldHVybiBoZWFkc1xuICAgICAgPyB7IGtpbmQ6IFwibXVsdGlwbGllclwiLCB2YWx1ZTogMywgZHJhd1lhcmRzOiB0cnVlIH1cbiAgICAgIDogeyBraW5kOiBcIm11bHRpcGxpZXJcIiwgdmFsdWU6IDAsIGRyYXdZYXJkczogZmFsc2UgfTtcbiAgfVxuICAvLyBKYWNrXG4gIHJldHVybiBoZWFkc1xuICAgID8geyBraW5kOiBcIm11bHRpcGxpZXJcIiwgdmFsdWU6IDAsIGRyYXdZYXJkczogZmFsc2UgfVxuICAgIDogeyBraW5kOiBcIm11bHRpcGxpZXJcIiwgdmFsdWU6IC0zLCBkcmF3WWFyZHM6IHRydWUgfTtcbn1cblxuLy8gLS0tLS0tLS0tLSBUcmljayBQbGF5IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIFRyaWNrUGxheU91dGNvbWUgPVxuICB8IHsga2luZDogXCJiaWdfcGxheVwiOyBiZW5lZmljaWFyeTogUGxheWVySWQgfVxuICB8IHsga2luZDogXCJwZW5hbHR5XCI7IHJhd1lhcmRzOiBudW1iZXIgfVxuICB8IHsga2luZDogXCJtdWx0aXBsaWVyXCI7IHZhbHVlOiBudW1iZXIgfVxuICB8IHsga2luZDogXCJvdmVybGF5XCI7IHBsYXk6IFwiTFBcIiB8IFwiTFJcIjsgYm9udXM6IG51bWJlciB9O1xuXG4vKipcbiAqIHY1LjEncyBUcmljayBQbGF5IHRhYmxlIChydW4uanM6MTk4NykuIENhbGxlciA9IHBsYXllciB3aG8gY2FsbGVkIHRoZVxuICogVHJpY2sgUGxheSAob2ZmZW5zZSBvciBkZWZlbnNlKS4gRGllIHJvbGwgb3V0Y29tZXMgKGZyb20gY2FsbGVyJ3MgUE9WKTpcbiAqXG4gKiAgIDEgXHUyMTkyIG92ZXJsYXkgTFAgd2l0aCArNSBib251cyAoc2lnbnMgZmxpcCBmb3IgZGVmZW5zaXZlIGNhbGxlcilcbiAqICAgMiBcdTIxOTIgMTUteWFyZCBwZW5hbHR5IG9uIG9wcG9uZW50XG4gKiAgIDMgXHUyMTkyIGZpeGVkIC0zeCBtdWx0aXBsaWVyLCBkcmF3IHlhcmRzXG4gKiAgIDQgXHUyMTkyIGZpeGVkICs0eCBtdWx0aXBsaWVyLCBkcmF3IHlhcmRzXG4gKiAgIDUgXHUyMTkyIEJpZyBQbGF5IGZvciBjYWxsZXJcbiAqICAgNiBcdTIxOTIgb3ZlcmxheSBMUiB3aXRoICs1IGJvbnVzXG4gKlxuICogYHJhd1lhcmRzYCBvbiBwZW5hbHR5IGlzIHNpZ25lZCBmcm9tIG9mZmVuc2UgUE9WOiBwb3NpdGl2ZSA9IGdhaW4gZm9yXG4gKiBvZmZlbnNlIChvZmZlbnNpdmUgVHJpY2sgUGxheSByb2xsPTIpLCBuZWdhdGl2ZSA9IGxvc3MgKGRlZmVuc2l2ZSkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0cmlja1BsYXlPdXRjb21lKFxuICBjYWxsZXI6IFBsYXllcklkLFxuICBvZmZlbnNlOiBQbGF5ZXJJZCxcbiAgZGllOiAxIHwgMiB8IDMgfCA0IHwgNSB8IDYsXG4pOiBUcmlja1BsYXlPdXRjb21lIHtcbiAgY29uc3QgY2FsbGVySXNPZmZlbnNlID0gY2FsbGVyID09PSBvZmZlbnNlO1xuXG4gIGlmIChkaWUgPT09IDUpIHJldHVybiB7IGtpbmQ6IFwiYmlnX3BsYXlcIiwgYmVuZWZpY2lhcnk6IGNhbGxlciB9O1xuXG4gIGlmIChkaWUgPT09IDIpIHtcbiAgICBjb25zdCByYXdZYXJkcyA9IGNhbGxlcklzT2ZmZW5zZSA/IDE1IDogLTE1O1xuICAgIHJldHVybiB7IGtpbmQ6IFwicGVuYWx0eVwiLCByYXdZYXJkcyB9O1xuICB9XG5cbiAgaWYgKGRpZSA9PT0gMykgcmV0dXJuIHsga2luZDogXCJtdWx0aXBsaWVyXCIsIHZhbHVlOiAtMyB9O1xuICBpZiAoZGllID09PSA0KSByZXR1cm4geyBraW5kOiBcIm11bHRpcGxpZXJcIiwgdmFsdWU6IDQgfTtcblxuICAvLyBkaWUgMSBvciA2XG4gIGNvbnN0IHBsYXkgPSBkaWUgPT09IDEgPyBcIkxQXCIgOiBcIkxSXCI7XG4gIGNvbnN0IGJvbnVzID0gY2FsbGVySXNPZmZlbnNlID8gNSA6IC01O1xuICByZXR1cm4geyBraW5kOiBcIm92ZXJsYXlcIiwgcGxheSwgYm9udXMgfTtcbn1cblxuLy8gLS0tLS0tLS0tLSBCaWcgUGxheSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIEJpZ1BsYXlPdXRjb21lID1cbiAgfCB7IGtpbmQ6IFwib2ZmZW5zZV9nYWluXCI7IHlhcmRzOiBudW1iZXIgfVxuICB8IHsga2luZDogXCJvZmZlbnNlX3RkXCIgfVxuICB8IHsga2luZDogXCJkZWZlbnNlX3BlbmFsdHlcIjsgcmF3WWFyZHM6IG51bWJlciB9XG4gIHwgeyBraW5kOiBcImRlZmVuc2VfZnVtYmxlX3JldHVyblwiOyB5YXJkczogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6IFwiZGVmZW5zZV9mdW1ibGVfdGRcIiB9O1xuXG4vKipcbiAqIHY1LjEncyBCaWcgUGxheSB0YWJsZSAocnVuLmpzOjE5MzMpLiBiZW5lZmljaWFyeSA9IHdobyBiZW5lZml0c1xuICogKG9mZmVuc2Ugb3IgZGVmZW5zZSkuXG4gKlxuICogT2ZmZW5zZTpcbiAqICAgMS0zIFx1MjE5MiArMjUgeWFyZHNcbiAqICAgNC01IFx1MjE5MiBtYXgoaGFsZi10by1nb2FsLCA0MClcbiAqICAgNiAgIFx1MjE5MiBURFxuICogRGVmZW5zZTpcbiAqICAgMS0zIFx1MjE5MiAxMC15YXJkIHBlbmFsdHkgb24gb2ZmZW5zZSAocmVwZWF0IGRvd24pXG4gKiAgIDQtNSBcdTIxOTIgZnVtYmxlLCBkZWZlbnNlIHJldHVybnMgbWF4KGhhbGYtdG8tZ29hbCwgMjUpXG4gKiAgIDYgICBcdTIxOTIgZnVtYmxlLCBkZWZlbnNpdmUgVERcbiAqL1xuLy8gLS0tLS0tLS0tLSBQdW50IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFB1bnQgcmV0dXJuIG11bHRpcGxpZXIgYnkgZHJhd24gbXVsdGlwbGllciBjYXJkIChydW4uanM6MjE5NikuICovXG5leHBvcnQgZnVuY3Rpb24gcHVudFJldHVybk11bHRpcGxpZXIoY2FyZDogTXVsdGlwbGllckNhcmROYW1lKTogbnVtYmVyIHtcbiAgc3dpdGNoIChjYXJkKSB7XG4gICAgY2FzZSBcIktpbmdcIjogcmV0dXJuIDc7XG4gICAgY2FzZSBcIlF1ZWVuXCI6IHJldHVybiA0O1xuICAgIGNhc2UgXCJKYWNrXCI6IHJldHVybiAxO1xuICAgIGNhc2UgXCIxMFwiOiByZXR1cm4gLTAuNTtcbiAgfVxufVxuXG4vKipcbiAqIFB1bnQga2ljayBkaXN0YW5jZSBmb3JtdWxhIChydW4uanM6MjE0Myk6XG4gKiAgIDEwICogeWFyZHNDYXJkIC8gMiArIDIwICogKGNvaW4gPT09IFwiaGVhZHNcIiA/IDEgOiAwKVxuICogeWFyZHNDYXJkIGlzIHRoZSAxLTEwIGNhcmQuIFJhbmdlOiA1LTcwIHlhcmRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcHVudEtpY2tEaXN0YW5jZSh5YXJkc0NhcmQ6IG51bWJlciwgY29pbjogXCJoZWFkc1wiIHwgXCJ0YWlsc1wiKTogbnVtYmVyIHtcbiAgcmV0dXJuICgxMCAqIHlhcmRzQ2FyZCkgLyAyICsgKGNvaW4gPT09IFwiaGVhZHNcIiA/IDIwIDogMCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBiaWdQbGF5T3V0Y29tZShcbiAgYmVuZWZpY2lhcnk6IFBsYXllcklkLFxuICBvZmZlbnNlOiBQbGF5ZXJJZCxcbiAgZGllOiAxIHwgMiB8IDMgfCA0IHwgNSB8IDYsXG4gIC8qKiBiYWxsT24gZnJvbSBvZmZlbnNlIFBPViAoMC0xMDApLiAqL1xuICBiYWxsT246IG51bWJlcixcbik6IEJpZ1BsYXlPdXRjb21lIHtcbiAgY29uc3QgYmVuZWZpdHNPZmZlbnNlID0gYmVuZWZpY2lhcnkgPT09IG9mZmVuc2U7XG5cbiAgaWYgKGJlbmVmaXRzT2ZmZW5zZSkge1xuICAgIGlmIChkaWUgPT09IDYpIHJldHVybiB7IGtpbmQ6IFwib2ZmZW5zZV90ZFwiIH07XG4gICAgaWYgKGRpZSA8PSAzKSByZXR1cm4geyBraW5kOiBcIm9mZmVuc2VfZ2FpblwiLCB5YXJkczogMjUgfTtcbiAgICBjb25zdCBoYWxmVG9Hb2FsID0gTWF0aC5yb3VuZCgoMTAwIC0gYmFsbE9uKSAvIDIpO1xuICAgIHJldHVybiB7IGtpbmQ6IFwib2ZmZW5zZV9nYWluXCIsIHlhcmRzOiBoYWxmVG9Hb2FsID4gNDAgPyBoYWxmVG9Hb2FsIDogNDAgfTtcbiAgfVxuXG4gIC8vIERlZmVuc2UgYmVuZWZpY2lhcnlcbiAgaWYgKGRpZSA8PSAzKSB7XG4gICAgY29uc3QgcmF3WWFyZHMgPSBiYWxsT24gLSAxMCA8IDEgPyAtTWF0aC5mbG9vcihiYWxsT24gLyAyKSA6IC0xMDtcbiAgICByZXR1cm4geyBraW5kOiBcImRlZmVuc2VfcGVuYWx0eVwiLCByYXdZYXJkcyB9O1xuICB9XG4gIGlmIChkaWUgPT09IDYpIHJldHVybiB7IGtpbmQ6IFwiZGVmZW5zZV9mdW1ibGVfdGRcIiB9O1xuICBjb25zdCBoYWxmVG9Hb2FsID0gTWF0aC5yb3VuZCgoMTAwIC0gYmFsbE9uKSAvIDIpO1xuICByZXR1cm4geyBraW5kOiBcImRlZmVuc2VfZnVtYmxlX3JldHVyblwiLCB5YXJkczogaGFsZlRvR29hbCA+IDI1ID8gaGFsZlRvR29hbCA6IDI1IH07XG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBU08sU0FBUyxVQUFVLGFBQWEsT0FBYTtBQUNsRCxTQUFPO0FBQUEsSUFDTCxJQUFJO0FBQUEsSUFDSixJQUFJO0FBQUEsSUFDSixJQUFJO0FBQUEsSUFDSixJQUFJO0FBQUEsSUFDSixJQUFJO0FBQUEsSUFDSixJQUFJLGFBQWEsSUFBSTtBQUFBLEVBQ3ZCO0FBQ0Y7QUFFTyxTQUFTLGFBQW9CO0FBQ2xDLFNBQU8sRUFBRSxXQUFXLEdBQUcsV0FBVyxHQUFHLFdBQVcsR0FBRyxPQUFPLEVBQUU7QUFDOUQ7QUFFTyxTQUFTLHVCQUF5RDtBQUN2RSxTQUFPLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQztBQUNwQjtBQUVPLFNBQVMsaUJBQTJCO0FBQ3pDLFNBQU8sQ0FBQyxHQUFHLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxHQUFHLEdBQUcsR0FBRyxDQUFDO0FBQ3RDO0FBUU8sU0FBUyxhQUFhLE1BQW1DO0FBQzlELFNBQU87QUFBQSxJQUNMLE9BQU87QUFBQSxJQUNQLGVBQWU7QUFBQSxJQUNmLE9BQU87QUFBQSxNQUNMLFNBQVM7QUFBQSxNQUNULGtCQUFrQixLQUFLLHVCQUF1QjtBQUFBLE1BQzlDLHNCQUFzQixLQUFLO0FBQUEsSUFDN0I7QUFBQSxJQUNBLE9BQU87QUFBQSxNQUNMLFFBQVE7QUFBQSxNQUNSLGFBQWE7QUFBQSxNQUNiLE1BQU07QUFBQSxNQUNOLFNBQVM7QUFBQSxJQUNYO0FBQUEsSUFDQSxNQUFNO0FBQUEsTUFDSixhQUFhLHFCQUFxQjtBQUFBLE1BQ2xDLE9BQU8sZUFBZTtBQUFBLElBQ3hCO0FBQUEsSUFDQSxTQUFTO0FBQUEsTUFDUCxHQUFHO0FBQUEsUUFDRCxNQUFNLEtBQUs7QUFBQSxRQUNYLE9BQU87QUFBQSxRQUNQLFVBQVU7QUFBQSxRQUNWLE1BQU0sVUFBVTtBQUFBLFFBQ2hCLE9BQU8sV0FBVztBQUFBLE1BQ3BCO0FBQUEsTUFDQSxHQUFHO0FBQUEsUUFDRCxNQUFNLEtBQUs7QUFBQSxRQUNYLE9BQU87QUFBQSxRQUNQLFVBQVU7QUFBQSxRQUNWLE1BQU0sVUFBVTtBQUFBLFFBQ2hCLE9BQU8sV0FBVztBQUFBLE1BQ3BCO0FBQUEsSUFDRjtBQUFBLElBQ0EsaUJBQWlCO0FBQUEsSUFDakIsVUFBVTtBQUFBLElBQ1YsYUFBYSxFQUFFLGFBQWEsTUFBTSxhQUFhLEtBQUs7QUFBQSxJQUNwRCxxQkFBcUI7QUFBQSxFQUN2QjtBQUNGO0FBRU8sU0FBUyxJQUFJLEdBQXVCO0FBQ3pDLFNBQU8sTUFBTSxJQUFJLElBQUk7QUFDdkI7OztBQzNETyxJQUFNLFVBQXdEO0FBQUEsRUFDbkUsQ0FBQyxHQUFHLEdBQUcsR0FBRyxDQUFDO0FBQUEsRUFDWCxDQUFDLEdBQUcsR0FBRyxHQUFHLENBQUM7QUFBQSxFQUNYLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQztBQUFBLEVBQ1gsQ0FBQyxHQUFHLEdBQUcsR0FBRyxDQUFDO0FBQ2I7QUFJQSxJQUFNLGFBQWlEO0FBQUEsRUFDckQsSUFBSTtBQUFBLEVBQ0osSUFBSTtBQUFBLEVBQ0osSUFBSTtBQUFBLEVBQ0osSUFBSTtBQUNOO0FBa0JPLElBQU0sUUFBOEM7QUFBQSxFQUN6RCxDQUFDLEdBQUcsR0FBRyxHQUFHLEtBQUssQ0FBQztBQUFBLEVBQ2hCLENBQUMsR0FBRyxHQUFHLEdBQUcsR0FBRyxHQUFHO0FBQUEsRUFDaEIsQ0FBQyxHQUFHLEdBQUcsS0FBSyxHQUFHLENBQUM7QUFBQSxFQUNoQixDQUFDLEdBQUcsR0FBRyxHQUFHLElBQUksRUFBRTtBQUNsQjtBQUVPLFNBQVMsZUFBZSxLQUFrQixLQUFrQztBQUNqRixRQUFNLE1BQU0sUUFBUSxXQUFXLEdBQUcsQ0FBQztBQUNuQyxNQUFJLENBQUMsSUFBSyxPQUFNLElBQUksTUFBTSw2QkFBNkIsR0FBRyxFQUFFO0FBQzVELFFBQU0sSUFBSSxJQUFJLFdBQVcsR0FBRyxDQUFDO0FBQzdCLE1BQUksTUFBTSxPQUFXLE9BQU0sSUFBSSxNQUFNLDZCQUE2QixHQUFHLEVBQUU7QUFDdkUsU0FBTztBQUNUOzs7QUNqRE8sSUFBTSx3QkFBd0IsQ0FBQyxRQUFRLFNBQVMsUUFBUSxJQUFJO0FBcUI1RCxTQUFTLGVBQWUsUUFBdUM7QUFDcEUsUUFBTSxVQUFVLGVBQWUsT0FBTyxTQUFTLE9BQU8sT0FBTztBQUM3RCxRQUFNLFdBQVcsTUFBTSxPQUFPLGNBQWM7QUFDNUMsTUFBSSxDQUFDLFNBQVUsT0FBTSxJQUFJLE1BQU0sK0JBQStCLE9BQU8sY0FBYyxFQUFFO0FBQ3JGLFFBQU0sYUFBYSxTQUFTLFVBQVUsQ0FBQztBQUN2QyxNQUFJLGVBQWUsT0FBVyxPQUFNLElBQUksTUFBTSw0QkFBNEIsT0FBTyxFQUFFO0FBRW5GLFFBQU0sUUFBUSxPQUFPLFNBQVM7QUFDOUIsUUFBTSxjQUFjLEtBQUssTUFBTSxhQUFhLE9BQU8sU0FBUyxJQUFJO0FBRWhFLFNBQU87QUFBQSxJQUNMLGdCQUFnQjtBQUFBLElBQ2hCO0FBQUEsSUFDQSxvQkFBb0Isc0JBQXNCLE9BQU8sY0FBYztBQUFBLElBQy9EO0FBQUEsRUFDRjtBQUNGOzs7QUN6Qk8sU0FBUyxlQUFlLE1BQWlCLEtBQTBCO0FBQ3hFLFFBQU0sUUFBUSxDQUFDLEdBQUcsS0FBSyxXQUFXO0FBRWxDLE1BQUk7QUFHSixhQUFTO0FBQ1AsVUFBTSxJQUFJLElBQUksV0FBVyxHQUFHLENBQUM7QUFDN0IsUUFBSSxNQUFNLENBQUMsSUFBSSxHQUFHO0FBQ2hCLGNBQVE7QUFDUjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBRUEsUUFBTSxLQUFLO0FBRVgsTUFBSSxhQUFhO0FBQ2pCLE1BQUksV0FBc0IsRUFBRSxHQUFHLE1BQU0sYUFBYSxNQUFNO0FBQ3hELE1BQUksTUFBTSxNQUFNLENBQUMsTUFBTSxNQUFNLENBQUMsR0FBRztBQUMvQixpQkFBYTtBQUNiLGVBQVcsRUFBRSxHQUFHLFVBQVUsYUFBYSxxQkFBcUIsRUFBRTtBQUFBLEVBQ2hFO0FBRUEsU0FBTztBQUFBLElBQ0wsTUFBTSxzQkFBc0IsS0FBSztBQUFBLElBQ2pDO0FBQUEsSUFDQSxNQUFNO0FBQUEsSUFDTjtBQUFBLEVBQ0Y7QUFDRjtBQVNPLFNBQVMsVUFBVSxNQUFpQixLQUFxQjtBQUM5RCxRQUFNLFFBQVEsQ0FBQyxHQUFHLEtBQUssS0FBSztBQUU1QixNQUFJO0FBQ0osYUFBUztBQUNQLFVBQU0sSUFBSSxJQUFJLFdBQVcsR0FBRyxNQUFNLFNBQVMsQ0FBQztBQUM1QyxVQUFNLE9BQU8sTUFBTSxDQUFDO0FBQ3BCLFFBQUksU0FBUyxVQUFhLE9BQU8sR0FBRztBQUNsQyxjQUFRO0FBQ1I7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUVBLFFBQU0sS0FBSyxLQUFLLE1BQU0sS0FBSyxLQUFLLEtBQUs7QUFFckMsTUFBSSxhQUFhO0FBQ2pCLE1BQUksV0FBc0IsRUFBRSxHQUFHLE1BQU0sTUFBTTtBQUMzQyxNQUFJLE1BQU0sTUFBTSxDQUFDLE1BQU0sTUFBTSxDQUFDLEdBQUc7QUFDL0IsaUJBQWE7QUFDYixlQUFXLEVBQUUsR0FBRyxVQUFVLE9BQU8sZUFBZSxFQUFFO0FBQUEsRUFDcEQ7QUFFQSxTQUFPO0FBQUEsSUFDTCxNQUFNLFFBQVE7QUFBQSxJQUNkLE1BQU07QUFBQSxJQUNOO0FBQUEsRUFDRjtBQUNGOzs7QUNqRkEsSUFBTSxVQUFpQyxvQkFBSSxJQUFJLENBQUMsTUFBTSxNQUFNLE1BQU0sSUFBSSxDQUFDO0FBRWhFLFNBQVMsY0FBYyxHQUErQjtBQUMzRCxTQUFPLFFBQVEsSUFBSSxDQUFDO0FBQ3RCO0FBZ0JPLFNBQVMsbUJBQ2QsT0FDQSxPQUNBLEtBQ2dCO0FBQ2hCLE1BQUksQ0FBQyxjQUFjLE1BQU0sV0FBVyxLQUFLLENBQUMsY0FBYyxNQUFNLFdBQVcsR0FBRztBQUMxRSxVQUFNLElBQUksTUFBTSxtREFBbUQ7QUFBQSxFQUNyRTtBQUVBLFFBQU0sU0FBa0IsQ0FBQztBQUd6QixRQUFNLFdBQVcsZUFBZSxNQUFNLE1BQU0sR0FBRztBQUMvQyxNQUFJLFNBQVMsWUFBWTtBQUN2QixXQUFPLEtBQUssRUFBRSxNQUFNLGlCQUFpQixNQUFNLGFBQWEsQ0FBQztBQUFBLEVBQzNEO0FBQ0EsUUFBTSxZQUFZLFVBQVUsU0FBUyxNQUFNLEdBQUc7QUFDOUMsTUFBSSxVQUFVLFlBQVk7QUFDeEIsV0FBTyxLQUFLLEVBQUUsTUFBTSxpQkFBaUIsTUFBTSxRQUFRLENBQUM7QUFBQSxFQUN0RDtBQUdBLFFBQU0sVUFBVSxlQUFlO0FBQUEsSUFDN0IsU0FBUyxNQUFNO0FBQUEsSUFDZixTQUFTLE1BQU07QUFBQSxJQUNmLGdCQUFnQixTQUFTO0FBQUEsSUFDekIsV0FBVyxVQUFVO0FBQUEsRUFDdkIsQ0FBQztBQUlELFFBQU0sVUFBVSxNQUFNLE1BQU07QUFDNUIsUUFBTSxhQUFhO0FBQUEsSUFDakIsR0FBRyxNQUFNO0FBQUEsSUFDVCxDQUFDLE9BQU8sR0FBRyxjQUFjLE1BQU0sUUFBUSxPQUFPLEdBQUcsTUFBTSxXQUFXO0FBQUEsRUFDcEU7QUFHQSxRQUFNLFlBQVksTUFBTSxNQUFNLFNBQVMsUUFBUTtBQUMvQyxNQUFJLFlBQVk7QUFDaEIsTUFBSSxTQUFpQztBQUNyQyxNQUFJLGFBQWEsS0FBSztBQUNwQixnQkFBWTtBQUNaLGFBQVM7QUFBQSxFQUNYLFdBQVcsYUFBYSxHQUFHO0FBQ3pCLGdCQUFZO0FBQ1osYUFBUztBQUFBLEVBQ1g7QUFFQSxTQUFPLEtBQUs7QUFBQSxJQUNWLE1BQU07QUFBQSxJQUNOLGFBQWEsTUFBTTtBQUFBLElBQ25CLGFBQWEsTUFBTTtBQUFBLElBQ25CLGdCQUFnQixRQUFRO0FBQUEsSUFDeEIsWUFBWSxFQUFFLE1BQU0sUUFBUSxvQkFBb0IsT0FBTyxRQUFRLFdBQVc7QUFBQSxJQUMxRSxXQUFXLFVBQVU7QUFBQSxJQUNyQixhQUFhLFFBQVE7QUFBQSxJQUNyQjtBQUFBLEVBQ0YsQ0FBQztBQUdELE1BQUksV0FBVyxNQUFNO0FBQ25CLFdBQU87QUFBQSxNQUNMLEVBQUUsR0FBRyxPQUFPLE1BQU0sVUFBVSxNQUFNLFNBQVMsWUFBWSxhQUFhLFVBQVUsRUFBRTtBQUFBLE1BQ2hGO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0EsTUFBSSxXQUFXLFVBQVU7QUFDdkIsV0FBTztBQUFBLE1BQ0wsRUFBRSxHQUFHLE9BQU8sTUFBTSxVQUFVLE1BQU0sU0FBUyxZQUFZLGFBQWEsVUFBVSxFQUFFO0FBQUEsTUFDaEY7QUFBQSxNQUNBO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFHQSxRQUFNLG1CQUFtQixhQUFhLE1BQU0sTUFBTTtBQUNsRCxNQUFJLFdBQVcsTUFBTSxNQUFNO0FBQzNCLE1BQUksa0JBQWtCLE1BQU0sTUFBTTtBQUNsQyxNQUFJLG9CQUFvQjtBQUV4QixNQUFJLGtCQUFrQjtBQUNwQixlQUFXO0FBQ1gsc0JBQWtCLEtBQUssSUFBSSxLQUFLLFlBQVksRUFBRTtBQUM5QyxXQUFPLEtBQUssRUFBRSxNQUFNLGFBQWEsQ0FBQztBQUFBLEVBQ3BDLFdBQVcsTUFBTSxNQUFNLFNBQVMsR0FBRztBQUVqQyxlQUFXO0FBQ1gsd0JBQW9CO0FBQ3BCLFdBQU8sS0FBSyxFQUFFLE1BQU0sb0JBQW9CLENBQUM7QUFDekMsV0FBTyxLQUFLLEVBQUUsTUFBTSxZQUFZLFFBQVEsUUFBUSxDQUFDO0FBQUEsRUFDbkQsT0FBTztBQUNMLGVBQVksTUFBTSxNQUFNLE9BQU87QUFBQSxFQUNqQztBQUVBLFFBQU0sY0FBYyxvQkFBb0IsSUFBSSxPQUFPLElBQUk7QUFDdkQsUUFBTSxhQUFhLG9CQUFvQixNQUFNLFlBQVk7QUFDekQsUUFBTSxnQkFBZ0Isb0JBQ2xCLEtBQUssSUFBSSxLQUFLLGFBQWEsRUFBRSxJQUM3QjtBQUVKLFNBQU87QUFBQSxJQUNMLE9BQU87QUFBQSxNQUNMLEdBQUc7QUFBQSxNQUNILE1BQU0sVUFBVTtBQUFBLE1BQ2hCLFNBQVM7QUFBQSxNQUNULGFBQWEsVUFBVTtBQUFBLE1BQ3ZCLE9BQU87QUFBQSxRQUNMLFFBQVE7QUFBQSxRQUNSLGFBQWE7QUFBQSxRQUNiLE1BQU07QUFBQSxRQUNOLFNBQVM7QUFBQSxNQUNYO0FBQUEsSUFDRjtBQUFBLElBQ0E7QUFBQSxFQUNGO0FBQ0Y7QUFFQSxTQUFTLFlBQXNDO0FBQzdDLFNBQU8sRUFBRSxhQUFhLE1BQU0sYUFBYSxLQUFLO0FBQ2hEO0FBTUEsU0FBUyxlQUNQLE9BQ0EsUUFDQSxRQUNnQjtBQUNoQixRQUFNLGFBQWE7QUFBQSxJQUNqQixHQUFHLE1BQU07QUFBQSxJQUNULENBQUMsTUFBTSxHQUFHLEVBQUUsR0FBRyxNQUFNLFFBQVEsTUFBTSxHQUFHLE9BQU8sTUFBTSxRQUFRLE1BQU0sRUFBRSxRQUFRLEVBQUU7QUFBQSxFQUMvRTtBQUNBLFNBQU8sS0FBSyxFQUFFLE1BQU0sYUFBYSxlQUFlLE9BQU8sQ0FBQztBQUN4RCxTQUFPO0FBQUEsSUFDTCxPQUFPLEVBQUUsR0FBRyxPQUFPLFNBQVMsWUFBWSxPQUFPLGFBQWE7QUFBQSxJQUM1RDtBQUFBLEVBQ0Y7QUFDRjtBQU1BLFNBQVMsWUFDUCxPQUNBLFVBQ0EsUUFDZ0I7QUFDaEIsUUFBTSxTQUFTLElBQUksUUFBUTtBQUMzQixRQUFNLGFBQWE7QUFBQSxJQUNqQixHQUFHLE1BQU07QUFBQSxJQUNULENBQUMsTUFBTSxHQUFHLEVBQUUsR0FBRyxNQUFNLFFBQVEsTUFBTSxHQUFHLE9BQU8sTUFBTSxRQUFRLE1BQU0sRUFBRSxRQUFRLEVBQUU7QUFBQSxFQUMvRTtBQUNBLFNBQU8sS0FBSyxFQUFFLE1BQU0sVUFBVSxlQUFlLE9BQU8sQ0FBQztBQUNyRCxTQUFPO0FBQUEsSUFDTCxPQUFPLEVBQUUsR0FBRyxPQUFPLFNBQVMsWUFBWSxPQUFPLFVBQVU7QUFBQSxJQUN6RDtBQUFBLEVBQ0Y7QUFDRjtBQU9BLFNBQVMsY0FDUCxRQUNBLE1BQ3lCO0FBQ3pCLFFBQU0sT0FBTyxFQUFFLEdBQUcsT0FBTyxLQUFLO0FBRTlCLE1BQUksU0FBUyxNQUFNO0FBQ2pCLFNBQUssS0FBSyxLQUFLLElBQUksR0FBRyxLQUFLLEtBQUssQ0FBQztBQUNqQyxXQUFPLEVBQUUsR0FBRyxRQUFRLEtBQUs7QUFBQSxFQUMzQjtBQUVBLE1BQUksU0FBUyxRQUFRLFNBQVMsVUFBVSxTQUFTLFVBQVU7QUFFekQsV0FBTztBQUFBLEVBQ1Q7QUFFQSxPQUFLLElBQUksSUFBSSxLQUFLLElBQUksR0FBRyxLQUFLLElBQUksSUFBSSxDQUFDO0FBRXZDLFFBQU0sbUJBQ0osS0FBSyxPQUFPLEtBQUssS0FBSyxPQUFPLEtBQUssS0FBSyxPQUFPLEtBQUssS0FBSyxPQUFPLEtBQUssS0FBSyxPQUFPO0FBRWxGLE1BQUksa0JBQWtCO0FBQ3BCLFdBQU87QUFBQSxNQUNMLEdBQUc7QUFBQSxNQUNILE1BQU0sRUFBRSxJQUFJLEdBQUcsSUFBSSxHQUFHLElBQUksR0FBRyxJQUFJLEdBQUcsSUFBSSxHQUFHLElBQUksS0FBSyxHQUFHO0FBQUEsSUFDekQ7QUFBQSxFQUNGO0FBRUEsU0FBTyxFQUFFLEdBQUcsUUFBUSxLQUFLO0FBQzNCOzs7QUM1Tk8sU0FBU0EsYUFBc0M7QUFDcEQsU0FBTyxFQUFFLGFBQWEsTUFBTSxhQUFhLEtBQUs7QUFDaEQ7QUFLTyxTQUFTLGVBQ2QsT0FDQSxRQUNBLFFBQ21CO0FBQ25CLFFBQU0sYUFBYTtBQUFBLElBQ2pCLEdBQUcsTUFBTTtBQUFBLElBQ1QsQ0FBQyxNQUFNLEdBQUcsRUFBRSxHQUFHLE1BQU0sUUFBUSxNQUFNLEdBQUcsT0FBTyxNQUFNLFFBQVEsTUFBTSxFQUFFLFFBQVEsRUFBRTtBQUFBLEVBQy9FO0FBQ0EsU0FBTyxLQUFLLEVBQUUsTUFBTSxhQUFhLGVBQWUsT0FBTyxDQUFDO0FBQ3hELFNBQU87QUFBQSxJQUNMLE9BQU87QUFBQSxNQUNMLEdBQUc7QUFBQSxNQUNILFNBQVM7QUFBQSxNQUNULGFBQWFBLFdBQVU7QUFBQSxNQUN2QixPQUFPO0FBQUEsSUFDVDtBQUFBLElBQ0E7QUFBQSxFQUNGO0FBQ0Y7QUFFTyxTQUFTLFlBQ2QsT0FDQSxVQUNBLFFBQ21CO0FBQ25CLFFBQU0sU0FBUyxJQUFJLFFBQVE7QUFDM0IsUUFBTSxhQUFhO0FBQUEsSUFDakIsR0FBRyxNQUFNO0FBQUEsSUFDVCxDQUFDLE1BQU0sR0FBRyxFQUFFLEdBQUcsTUFBTSxRQUFRLE1BQU0sR0FBRyxPQUFPLE1BQU0sUUFBUSxNQUFNLEVBQUUsUUFBUSxFQUFFO0FBQUEsRUFDL0U7QUFDQSxTQUFPLEtBQUssRUFBRSxNQUFNLFVBQVUsZUFBZSxPQUFPLENBQUM7QUFDckQsU0FBTztBQUFBLElBQ0wsT0FBTztBQUFBLE1BQ0wsR0FBRztBQUFBLE1BQ0gsU0FBUztBQUFBLE1BQ1QsYUFBYUEsV0FBVTtBQUFBLE1BQ3ZCLE9BQU87QUFBQSxJQUNUO0FBQUEsSUFDQTtBQUFBLEVBQ0Y7QUFDRjtBQU1PLFNBQVMsb0JBQ2QsT0FDQSxPQUNBLFFBQ21CO0FBQ25CLFFBQU0sVUFBVSxNQUFNLE1BQU07QUFDNUIsUUFBTSxZQUFZLE1BQU0sTUFBTSxTQUFTO0FBRXZDLE1BQUksYUFBYSxJQUFLLFFBQU8sZUFBZSxPQUFPLFNBQVMsTUFBTTtBQUNsRSxNQUFJLGFBQWEsRUFBRyxRQUFPLFlBQVksT0FBTyxTQUFTLE1BQU07QUFFN0QsUUFBTSxtQkFBbUIsYUFBYSxNQUFNLE1BQU07QUFDbEQsTUFBSSxXQUFXLE1BQU0sTUFBTTtBQUMzQixNQUFJLGtCQUFrQixNQUFNLE1BQU07QUFDbEMsTUFBSSxvQkFBb0I7QUFFeEIsTUFBSSxrQkFBa0I7QUFDcEIsZUFBVztBQUNYLHNCQUFrQixLQUFLLElBQUksS0FBSyxZQUFZLEVBQUU7QUFDOUMsV0FBTyxLQUFLLEVBQUUsTUFBTSxhQUFhLENBQUM7QUFBQSxFQUNwQyxXQUFXLE1BQU0sTUFBTSxTQUFTLEdBQUc7QUFDakMsd0JBQW9CO0FBQ3BCLFdBQU8sS0FBSyxFQUFFLE1BQU0sb0JBQW9CLENBQUM7QUFDekMsV0FBTyxLQUFLLEVBQUUsTUFBTSxZQUFZLFFBQVEsUUFBUSxDQUFDO0FBQUEsRUFDbkQsT0FBTztBQUNMLGVBQVksTUFBTSxNQUFNLE9BQU87QUFBQSxFQUNqQztBQUVBLFFBQU0saUJBQWlCLG9CQUFvQixNQUFNLFlBQVk7QUFFN0QsU0FBTztBQUFBLElBQ0wsT0FBTztBQUFBLE1BQ0wsR0FBRztBQUFBLE1BQ0gsYUFBYUEsV0FBVTtBQUFBLE1BQ3ZCLE9BQU87QUFBQSxRQUNMLFFBQVE7QUFBQSxRQUNSLGFBQWEsb0JBQ1QsS0FBSyxJQUFJLEtBQUssaUJBQWlCLEVBQUUsSUFDakM7QUFBQSxRQUNKLE1BQU0sb0JBQW9CLElBQUk7QUFBQSxRQUM5QixTQUFTLG9CQUFvQixJQUFJLE9BQU8sSUFBSTtBQUFBLE1BQzlDO0FBQUEsSUFDRjtBQUFBLElBQ0E7QUFBQSxFQUNGO0FBQ0Y7OztBQy9FTyxTQUFTLGVBQ2QsT0FDQSxhQUNBLEtBQ21CO0FBQ25CLFFBQU0sVUFBVSxNQUFNLE1BQU07QUFDNUIsUUFBTSxNQUFNLElBQUksR0FBRztBQUNuQixRQUFNLFNBQWtCLENBQUMsRUFBRSxNQUFNLFlBQVksYUFBYSxTQUFTLElBQUksQ0FBQztBQUV4RSxNQUFJLGdCQUFnQixTQUFTO0FBQzNCLFdBQU8saUJBQWlCLE9BQU8sU0FBUyxLQUFLLE1BQU07QUFBQSxFQUNyRDtBQUNBLFNBQU8saUJBQWlCLE9BQU8sU0FBUyxLQUFLLE1BQU07QUFDckQ7QUFFQSxTQUFTLGlCQUNQLE9BQ0EsU0FDQSxLQUNBLFFBQ21CO0FBQ25CLE1BQUksUUFBUSxHQUFHO0FBQ2IsV0FBTyxlQUFlLE9BQU8sU0FBUyxNQUFNO0FBQUEsRUFDOUM7QUFHQSxNQUFJO0FBQ0osTUFBSSxPQUFPLEdBQUc7QUFDWixXQUFPO0FBQUEsRUFDVCxPQUFPO0FBQ0wsVUFBTSxhQUFhLEtBQUssT0FBTyxNQUFNLE1BQU0sTUFBTSxVQUFVLENBQUM7QUFDNUQsV0FBTyxhQUFhLEtBQUssYUFBYTtBQUFBLEVBQ3hDO0FBRUEsUUFBTSxZQUFZLE1BQU0sTUFBTSxTQUFTO0FBQ3ZDLE1BQUksYUFBYSxLQUFLO0FBQ3BCLFdBQU8sZUFBZSxPQUFPLFNBQVMsTUFBTTtBQUFBLEVBQzlDO0FBR0EsUUFBTSxtQkFBbUIsYUFBYSxNQUFNLE1BQU07QUFDbEQsUUFBTSxXQUFXLG1CQUFtQixJQUFJLE1BQU0sTUFBTTtBQUNwRCxRQUFNLGtCQUFrQixtQkFDcEIsS0FBSyxJQUFJLEtBQUssWUFBWSxFQUFFLElBQzVCLE1BQU0sTUFBTTtBQUVoQixNQUFJLGlCQUFrQixRQUFPLEtBQUssRUFBRSxNQUFNLGFBQWEsQ0FBQztBQUV4RCxTQUFPO0FBQUEsSUFDTCxPQUFPO0FBQUEsTUFDTCxHQUFHO0FBQUEsTUFDSCxhQUFhQyxXQUFVO0FBQUEsTUFDdkIsT0FBTztBQUFBLFFBQ0wsR0FBRyxNQUFNO0FBQUEsUUFDVCxRQUFRO0FBQUEsUUFDUixNQUFNO0FBQUEsUUFDTixhQUFhO0FBQUEsTUFDZjtBQUFBLElBQ0Y7QUFBQSxJQUNBO0FBQUEsRUFDRjtBQUNGO0FBRUEsU0FBUyxpQkFDUCxPQUNBLFNBQ0EsS0FDQSxRQUNtQjtBQUVuQixNQUFJLE9BQU8sR0FBRztBQUNaLFVBQU0sZUFBZTtBQUNyQixVQUFNQyxjQUFhLENBQUMsS0FBSyxNQUFNLE1BQU0sTUFBTSxTQUFTLENBQUM7QUFDckQsVUFBTSxlQUNKLE1BQU0sTUFBTSxTQUFTLEtBQUssSUFBSUEsY0FBYTtBQUU3QyxXQUFPLEtBQUssRUFBRSxNQUFNLFdBQVcsU0FBUyxTQUFTLE9BQU8sY0FBYyxZQUFZLE1BQU0sQ0FBQztBQUN6RixXQUFPO0FBQUEsTUFDTCxPQUFPO0FBQUEsUUFDTCxHQUFHO0FBQUEsUUFDSCxhQUFhRCxXQUFVO0FBQUEsUUFDdkIsT0FBTztBQUFBLFVBQ0wsR0FBRyxNQUFNO0FBQUEsVUFDVCxRQUFRLEtBQUssSUFBSSxHQUFHLE1BQU0sTUFBTSxTQUFTLFlBQVk7QUFBQSxRQUN2RDtBQUFBLE1BQ0Y7QUFBQSxNQUNBO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFHQSxRQUFNLFdBQVcsSUFBSSxPQUFPO0FBRTVCLE1BQUksUUFBUSxHQUFHO0FBRWIsVUFBTSxhQUFhO0FBQUEsTUFDakIsR0FBRyxNQUFNO0FBQUEsTUFDVCxDQUFDLFFBQVEsR0FBRyxFQUFFLEdBQUcsTUFBTSxRQUFRLFFBQVEsR0FBRyxPQUFPLE1BQU0sUUFBUSxRQUFRLEVBQUUsUUFBUSxFQUFFO0FBQUEsSUFDckY7QUFDQSxXQUFPLEtBQUssRUFBRSxNQUFNLFlBQVksUUFBUSxTQUFTLENBQUM7QUFDbEQsV0FBTyxLQUFLLEVBQUUsTUFBTSxhQUFhLGVBQWUsU0FBUyxDQUFDO0FBQzFELFdBQU87QUFBQSxNQUNMLE9BQU87QUFBQSxRQUNMLEdBQUc7QUFBQSxRQUNILFNBQVM7QUFBQSxRQUNULGFBQWFBLFdBQVU7QUFBQSxRQUN2QixPQUFPO0FBQUEsUUFDUCxPQUFPLEVBQUUsR0FBRyxNQUFNLE9BQU8sU0FBUyxTQUFTO0FBQUEsTUFDN0M7QUFBQSxNQUNBO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFHQSxRQUFNLGFBQWEsS0FBSyxPQUFPLE1BQU0sTUFBTSxNQUFNLFVBQVUsQ0FBQztBQUM1RCxRQUFNLGNBQWMsYUFBYSxLQUFLLGFBQWE7QUFFbkQsU0FBTyxLQUFLLEVBQUUsTUFBTSxZQUFZLFFBQVEsU0FBUyxDQUFDO0FBSWxELFFBQU0sWUFBWSxNQUFNLE1BQU0sU0FBUztBQUN2QyxNQUFJLGFBQWEsS0FBSztBQUVwQixVQUFNLGFBQWE7QUFBQSxNQUNqQixHQUFHLE1BQU07QUFBQSxNQUNULENBQUMsUUFBUSxHQUFHLEVBQUUsR0FBRyxNQUFNLFFBQVEsUUFBUSxHQUFHLE9BQU8sTUFBTSxRQUFRLFFBQVEsRUFBRSxRQUFRLEVBQUU7QUFBQSxJQUNyRjtBQUNBLFdBQU8sS0FBSyxFQUFFLE1BQU0sYUFBYSxlQUFlLFNBQVMsQ0FBQztBQUMxRCxXQUFPO0FBQUEsTUFDTCxPQUFPO0FBQUEsUUFDTCxHQUFHO0FBQUEsUUFDSCxTQUFTO0FBQUEsUUFDVCxhQUFhQSxXQUFVO0FBQUEsUUFDdkIsT0FBTztBQUFBLFFBQ1AsT0FBTyxFQUFFLEdBQUcsTUFBTSxPQUFPLFNBQVMsU0FBUztBQUFBLE1BQzdDO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0EsTUFBSSxhQUFhLEdBQUc7QUFDbEIsV0FBTyxZQUFZLE9BQU8sU0FBUyxNQUFNO0FBQUEsRUFDM0M7QUFHQSxRQUFNLGlCQUFpQixNQUFNO0FBQzdCLFNBQU87QUFBQSxJQUNMLE9BQU87QUFBQSxNQUNMLEdBQUc7QUFBQSxNQUNILGFBQWFBLFdBQVU7QUFBQSxNQUN2QixPQUFPO0FBQUEsUUFDTCxRQUFRO0FBQUEsUUFDUixhQUFhLEtBQUssSUFBSSxLQUFLLGlCQUFpQixFQUFFO0FBQUEsUUFDOUMsTUFBTTtBQUFBLFFBQ04sU0FBUztBQUFBLE1BQ1g7QUFBQSxJQUNGO0FBQUEsSUFDQTtBQUFBLEVBQ0Y7QUFDRjs7O0FDaEtBLElBQU0scUJBQXVFO0FBQUEsRUFDM0UsTUFBTTtBQUFBLEVBQ04sT0FBTztBQUFBLEVBQ1AsTUFBTTtBQUFBLEVBQ04sTUFBTTtBQUNSO0FBT08sU0FBUyxZQUNkLE9BQ0EsS0FDQSxPQUFvQixDQUFDLEdBQ0Y7QUFDbkIsUUFBTSxVQUFVLE1BQU0sTUFBTTtBQUM1QixRQUFNLFdBQVcsSUFBSSxPQUFPO0FBQzVCLFFBQU0sU0FBa0IsQ0FBQztBQUN6QixNQUFJLE9BQU8sTUFBTTtBQUdqQixNQUFJLFVBQVU7QUFDZCxNQUFJLENBQUMsS0FBSyxZQUFZO0FBQ3BCLFFBQUksSUFBSSxHQUFHLE1BQU0sS0FBSyxJQUFJLEdBQUcsTUFBTSxHQUFHO0FBQ3BDLGdCQUFVO0FBQUEsSUFDWjtBQUFBLEVBQ0Y7QUFFQSxNQUFJLFNBQVM7QUFFWCxVQUFNLGlCQUFpQixNQUFNLE1BQU0sTUFBTTtBQUN6QyxXQUFPLEtBQUssRUFBRSxNQUFNLFFBQVEsUUFBUSxTQUFTLGFBQWEsTUFBTSxNQUFNLE9BQU8sQ0FBQztBQUM5RSxXQUFPLEtBQUssRUFBRSxNQUFNLFlBQVksUUFBUSxTQUFTLENBQUM7QUFDbEQsV0FBTztBQUFBLE1BQ0wsT0FBTztBQUFBLFFBQ0wsR0FBRztBQUFBLFFBQ0gsYUFBYUUsV0FBVTtBQUFBLFFBQ3ZCLE9BQU87QUFBQSxVQUNMLFFBQVE7QUFBQSxVQUNSLGFBQWEsS0FBSyxJQUFJLEtBQUssaUJBQWlCLEVBQUU7QUFBQSxVQUM5QyxNQUFNO0FBQUEsVUFDTixTQUFTO0FBQUEsUUFDWDtBQUFBLE1BQ0Y7QUFBQSxNQUNBO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFHQSxRQUFNLE9BQU8sSUFBSSxTQUFTO0FBQzFCLFFBQU0sWUFBWSxVQUFVLE1BQU0sR0FBRztBQUNyQyxNQUFJLFVBQVUsV0FBWSxRQUFPLEtBQUssRUFBRSxNQUFNLGlCQUFpQixNQUFNLFFBQVEsQ0FBQztBQUM5RSxTQUFPLFVBQVU7QUFFakIsUUFBTSxXQUFZLEtBQUssVUFBVSxPQUFRLEtBQUssU0FBUyxVQUFVLEtBQUs7QUFDdEUsUUFBTSxjQUFjLE1BQU0sTUFBTSxTQUFTO0FBQ3pDLFFBQU0sWUFBWSxjQUFjO0FBQ2hDLFNBQU8sS0FBSyxFQUFFLE1BQU0sUUFBUSxRQUFRLFNBQVMsWUFBWSxDQUFDO0FBRzFELE1BQUksU0FBUztBQUNiLE1BQUksQ0FBQyxhQUFhLENBQUMsS0FBSyxZQUFZO0FBQ2xDLFFBQUksSUFBSSxHQUFHLE1BQU0sS0FBSyxJQUFJLEdBQUcsTUFBTSxHQUFHO0FBQ3BDLGVBQVM7QUFBQSxJQUNYO0FBQUEsRUFDRjtBQUVBLE1BQUksUUFBUTtBQUdWLFdBQU8sS0FBSyxFQUFFLE1BQU0sWUFBWSxRQUFRLFNBQVMsQ0FBQztBQUNsRCxXQUFPO0FBQUEsTUFDTCxPQUFPO0FBQUEsUUFDTCxHQUFHO0FBQUEsUUFDSDtBQUFBLFFBQ0EsYUFBYUEsV0FBVTtBQUFBLFFBQ3ZCLE9BQU87QUFBQSxVQUNMLFFBQVEsS0FBSyxJQUFJLElBQUksV0FBVztBQUFBLFVBQ2hDLGFBQWEsS0FBSyxJQUFJLEtBQUssY0FBYyxFQUFFO0FBQUEsVUFDM0MsTUFBTTtBQUFBLFVBQ047QUFBQTtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBS0EsTUFBSSxXQUFXO0FBQ2IsVUFBTSxpQkFBNEIsRUFBRSxHQUFHLE9BQU8sS0FBSztBQUNuRCxXQUFPO0FBQUEsTUFDTCxPQUFPO0FBQUEsUUFDTCxHQUFHO0FBQUEsUUFDSCxhQUFhQSxXQUFVO0FBQUEsUUFDdkIsT0FBTztBQUFBLFVBQ0wsUUFBUTtBQUFBLFVBQ1IsYUFBYTtBQUFBLFVBQ2IsTUFBTTtBQUFBLFVBQ04sU0FBUztBQUFBLFFBQ1g7QUFBQSxNQUNGO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBR0EsUUFBTSxXQUFXLGVBQWUsTUFBTSxHQUFHO0FBQ3pDLE1BQUksU0FBUyxXQUFZLFFBQU8sS0FBSyxFQUFFLE1BQU0saUJBQWlCLE1BQU0sYUFBYSxDQUFDO0FBQ2xGLFNBQU8sU0FBUztBQUVoQixRQUFNLGFBQWEsVUFBVSxNQUFNLEdBQUc7QUFDdEMsTUFBSSxXQUFXLFdBQVksUUFBTyxLQUFLLEVBQUUsTUFBTSxpQkFBaUIsTUFBTSxRQUFRLENBQUM7QUFDL0UsU0FBTyxXQUFXO0FBRWxCLFFBQU0sT0FBTyxtQkFBbUIsU0FBUyxJQUFJO0FBQzdDLFFBQU0sY0FBYyxLQUFLLE1BQU0sT0FBTyxXQUFXLElBQUk7QUFJckQsUUFBTSxpQkFBaUIsTUFBTSxjQUFjO0FBRTNDLFFBQU0sbUJBQThCLEVBQUUsR0FBRyxPQUFPLEtBQUs7QUFHckQsTUFBSSxrQkFBa0IsS0FBSztBQUN6QixVQUFNLHNCQUFzQjtBQUU1QixXQUFPO0FBQUEsTUFDTCxFQUFFLEdBQUcsa0JBQWtCLE9BQU8sRUFBRSxHQUFHLE1BQU0sT0FBTyxTQUFTLFNBQVMsRUFBRTtBQUFBLE1BQ3BFO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBS0EsTUFBSSxrQkFBa0IsR0FBRztBQUN2QixXQUFPO0FBQUEsTUFDTCxFQUFFLEdBQUcsa0JBQWtCLE9BQU8sRUFBRSxHQUFHLE1BQU0sT0FBTyxTQUFTLFNBQVMsRUFBRTtBQUFBLE1BQ3BFO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBRUEsU0FBTztBQUFBLElBQ0wsT0FBTztBQUFBLE1BQ0wsR0FBRztBQUFBLE1BQ0gsYUFBYUEsV0FBVTtBQUFBLE1BQ3ZCLE9BQU87QUFBQSxRQUNMLFFBQVE7QUFBQSxRQUNSLGFBQWEsS0FBSyxJQUFJLEtBQUssaUJBQWlCLEVBQUU7QUFBQSxRQUM5QyxNQUFNO0FBQUEsUUFDTixTQUFTO0FBQUEsTUFDWDtBQUFBLElBQ0Y7QUFBQSxJQUNBO0FBQUEsRUFDRjtBQUNGOzs7QUNuTE8sU0FBUyxlQUFlLE9BQWtCLEtBQTZCO0FBSTVFLFFBQU0sZUFBMEI7QUFBQSxJQUM5QixHQUFHO0FBQUEsSUFDSCxPQUFPLEVBQUUsR0FBRyxNQUFNLE9BQU8sUUFBUSxHQUFHO0FBQUEsRUFDdEM7QUFDQSxRQUFNLFNBQVMsWUFBWSxjQUFjLEtBQUssRUFBRSxZQUFZLEtBQUssQ0FBQztBQUVsRSxTQUFPO0FBQUEsSUFDTCxHQUFHO0FBQUEsSUFDSCxPQUFPLEVBQUUsR0FBRyxPQUFPLE9BQU8sT0FBTyxXQUFXO0FBQUEsRUFDOUM7QUFDRjs7O0FDUE8sU0FBUyxnQkFBZ0IsT0FBa0IsS0FBNkI7QUFDN0UsUUFBTSxVQUFVLE1BQU0sTUFBTTtBQUM1QixRQUFNLE1BQU0sSUFBSSxHQUFHO0FBQ25CLFFBQU0sU0FBa0IsQ0FBQyxFQUFFLE1BQU0sa0JBQWtCLFNBQVMsSUFBSSxDQUFDO0FBR2pFLFFBQU0saUJBQWlCO0FBQUEsSUFDckIsR0FBRyxNQUFNO0FBQUEsSUFDVCxDQUFDLE9BQU8sR0FBRztBQUFBLE1BQ1QsR0FBRyxNQUFNLFFBQVEsT0FBTztBQUFBLE1BQ3hCLE1BQU0sRUFBRSxHQUFHLE1BQU0sUUFBUSxPQUFPLEVBQUUsTUFBTSxJQUFJLEtBQUssSUFBSSxHQUFHLE1BQU0sUUFBUSxPQUFPLEVBQUUsS0FBSyxLQUFLLENBQUMsRUFBRTtBQUFBLElBQzlGO0FBQUEsRUFDRjtBQUNBLFFBQU0sY0FBeUIsRUFBRSxHQUFHLE9BQU8sU0FBUyxlQUFlO0FBR25FLE1BQUksUUFBUSxHQUFHO0FBQ2IsV0FBTyxLQUFLLEVBQUUsTUFBTSxZQUFZLFFBQVEsZUFBZSxDQUFDO0FBQ3hELFdBQU87QUFBQSxNQUNMLE9BQU87QUFBQSxRQUNMLEdBQUc7QUFBQSxRQUNILGFBQWFDLFdBQVU7QUFBQSxRQUN2QixPQUFPO0FBQUEsVUFDTCxHQUFHLFlBQVk7QUFBQSxVQUNmLFNBQVMsSUFBSSxPQUFPO0FBQUEsVUFDcEIsUUFBUSxNQUFNLFlBQVksTUFBTTtBQUFBLFVBQ2hDLGFBQWEsS0FBSyxJQUFJLEtBQUssTUFBTSxZQUFZLE1BQU0sU0FBUyxFQUFFO0FBQUEsVUFDOUQsTUFBTTtBQUFBLFFBQ1I7QUFBQSxNQUNGO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBR0EsTUFBSSxRQUFRLEdBQUc7QUFDYixXQUFPLGVBQWUsYUFBYSxTQUFTLE1BQU07QUFBQSxFQUNwRDtBQUdBLFFBQU0sUUFBUSxRQUFRLElBQUksTUFBTSxRQUFRLElBQUksS0FBSyxRQUFRLElBQUksSUFBSTtBQUNqRSxRQUFNLFlBQVksWUFBWSxNQUFNLFNBQVM7QUFFN0MsTUFBSSxhQUFhLElBQUssUUFBTyxlQUFlLGFBQWEsU0FBUyxNQUFNO0FBQ3hFLE1BQUksYUFBYSxFQUFHLFFBQU8sWUFBWSxhQUFhLFNBQVMsTUFBTTtBQUVuRSxTQUFPLEtBQUs7QUFBQSxJQUNWLE1BQU07QUFBQSxJQUNOLGFBQWE7QUFBQSxJQUNiLGFBQWEsTUFBTSxZQUFZLGVBQWU7QUFBQSxJQUM5QyxnQkFBZ0I7QUFBQSxJQUNoQixZQUFZLEVBQUUsTUFBTSxNQUFNLE9BQU8sRUFBRTtBQUFBLElBQ25DLFdBQVc7QUFBQSxJQUNYLGFBQWE7QUFBQSxJQUNiLFdBQVc7QUFBQSxFQUNiLENBQUM7QUFFRCxTQUFPLG9CQUFvQixhQUFhLE9BQU8sTUFBTTtBQUN2RDs7O0FDakRPLFNBQVMsZ0JBQWdCLE9BQWtCLEtBQTZCO0FBQzdFLFFBQU0sVUFBVSxNQUFNLE1BQU07QUFDNUIsUUFBTSxTQUFrQixDQUFDO0FBRXpCLFFBQU0sT0FBTyxJQUFJLFNBQVM7QUFDMUIsU0FBTyxLQUFLLEVBQUUsTUFBTSxrQkFBa0IsU0FBUyxLQUFLLENBQUM7QUFFckQsUUFBTSxXQUFXLGVBQWUsTUFBTSxNQUFNLEdBQUc7QUFDL0MsTUFBSSxTQUFTLFdBQVksUUFBTyxLQUFLLEVBQUUsTUFBTSxpQkFBaUIsTUFBTSxhQUFhLENBQUM7QUFFbEYsUUFBTSxpQkFBNEIsRUFBRSxHQUFHLE9BQU8sTUFBTSxTQUFTLEtBQUs7QUFDbEUsUUFBTSxRQUFRLFNBQVM7QUFHdkIsTUFBSSxTQUFTLFNBQVMsUUFBUTtBQUM1QixVQUFNLGNBQWMsUUFBUSxVQUFVLElBQUksT0FBTztBQUNqRCxVQUFNLEtBQUssZUFBZSxnQkFBZ0IsYUFBYSxHQUFHO0FBQzFELFdBQU8sRUFBRSxPQUFPLEdBQUcsT0FBTyxRQUFRLENBQUMsR0FBRyxRQUFRLEdBQUcsR0FBRyxNQUFNLEVBQUU7QUFBQSxFQUM5RDtBQUdBLE1BQUksU0FBUyxTQUFTLE1BQU07QUFDMUIsUUFBSSxPQUFPO0FBQ1QsYUFBTyxLQUFLLEVBQUUsTUFBTSxZQUFZLFFBQVEsZUFBZSxDQUFDO0FBQ3hELGFBQU87QUFBQSxRQUNMLE9BQU87QUFBQSxVQUNMLEdBQUc7QUFBQSxVQUNILGFBQWFDLFdBQVU7QUFBQSxVQUN2QixPQUFPO0FBQUEsWUFDTCxHQUFHLGVBQWU7QUFBQSxZQUNsQixTQUFTLElBQUksT0FBTztBQUFBLFlBQ3BCLFFBQVEsTUFBTSxlQUFlLE1BQU07QUFBQSxZQUNuQyxhQUFhLEtBQUssSUFBSSxLQUFLLE1BQU0sZUFBZSxNQUFNLFNBQVMsRUFBRTtBQUFBLFlBQ2pFLE1BQU07QUFBQSxVQUNSO0FBQUEsUUFDRjtBQUFBLFFBQ0E7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUVBLFdBQU8sb0JBQW9CLGdCQUFnQixHQUFHLE1BQU07QUFBQSxFQUN0RDtBQUdBLE1BQUksYUFBYTtBQUNqQixNQUFJLFNBQVMsU0FBUyxRQUFTLGNBQWEsUUFBUSxJQUFJO0FBQ3hELE1BQUksU0FBUyxTQUFTLE9BQVEsY0FBYSxRQUFRLElBQUk7QUFFdkQsTUFBSSxlQUFlLEdBQUc7QUFFcEIsV0FBTyxvQkFBb0IsZ0JBQWdCLEdBQUcsTUFBTTtBQUFBLEVBQ3REO0FBRUEsUUFBTSxZQUFZLFVBQVUsZUFBZSxNQUFNLEdBQUc7QUFDcEQsTUFBSSxVQUFVLFdBQVksUUFBTyxLQUFLLEVBQUUsTUFBTSxpQkFBaUIsTUFBTSxRQUFRLENBQUM7QUFFOUUsUUFBTSxRQUFRLEtBQUssTUFBTSxhQUFhLFVBQVUsSUFBSTtBQUVwRCxTQUFPLEtBQUs7QUFBQSxJQUNWLE1BQU07QUFBQSxJQUNOLGFBQWEsTUFBTSxZQUFZLGVBQWU7QUFBQSxJQUM5QyxhQUFhLE1BQU0sWUFBWSxlQUFlO0FBQUEsSUFDOUMsZ0JBQWdCO0FBQUEsSUFDaEIsWUFBWSxFQUFFLE1BQU0sU0FBUyxNQUFNLE9BQU8sV0FBVztBQUFBLElBQ3JELFdBQVcsVUFBVTtBQUFBLElBQ3JCLGFBQWE7QUFBQSxJQUNiLFdBQVcsS0FBSyxJQUFJLEdBQUcsS0FBSyxJQUFJLEtBQUssZUFBZSxNQUFNLFNBQVMsS0FBSyxDQUFDO0FBQUEsRUFDM0UsQ0FBQztBQUVELFNBQU87QUFBQSxJQUNMLEVBQUUsR0FBRyxnQkFBZ0IsTUFBTSxVQUFVLEtBQUs7QUFBQSxJQUMxQztBQUFBLElBQ0E7QUFBQSxFQUNGO0FBQ0Y7OztBQzdFTyxTQUFTLDBCQUNkLE9BQ0EsS0FDbUI7QUFDbkIsUUFBTSxVQUFVLE1BQU0sTUFBTTtBQUM1QixRQUFNLE1BQU0sSUFBSSxHQUFHO0FBQ25CLFFBQU0sU0FBa0IsQ0FBQyxFQUFFLE1BQU0sbUJBQW1CLFNBQVMsSUFBSSxDQUFDO0FBR2xFLE1BQUksUUFBUSxHQUFHO0FBQ2IsVUFBTSxLQUFLLGVBQWUsT0FBTyxTQUFTLEdBQUc7QUFDN0MsV0FBTyxFQUFFLE9BQU8sR0FBRyxPQUFPLFFBQVEsQ0FBQyxHQUFHLFFBQVEsR0FBRyxHQUFHLE1BQU0sRUFBRTtBQUFBLEVBQzlEO0FBR0EsTUFBSSxRQUFRLEdBQUc7QUFDYixVQUFNLFVBQVU7QUFDaEIsVUFBTSxPQUNKLE1BQU0sTUFBTSxTQUFTLFVBQVUsS0FDM0IsS0FBSyxPQUFPLE1BQU0sTUFBTSxNQUFNLFVBQVUsQ0FBQyxJQUN6QztBQUNOLFdBQU8sS0FBSyxFQUFFLE1BQU0sV0FBVyxTQUFTLFNBQVMsT0FBTyxHQUFHLE9BQU8sTUFBTSxZQUFZLE1BQU0sQ0FBQztBQUMzRixXQUFPO0FBQUEsTUFDTCxPQUFPO0FBQUEsUUFDTCxHQUFHO0FBQUEsUUFDSCxhQUFhQyxXQUFVO0FBQUEsUUFDdkIsT0FBTztBQUFBLFVBQ0wsR0FBRyxNQUFNO0FBQUEsVUFDVCxRQUFRLEtBQUssSUFBSSxLQUFLLE1BQU0sTUFBTSxTQUFTLElBQUk7QUFBQSxRQUNqRDtBQUFBLE1BQ0Y7QUFBQSxNQUNBO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFHQSxNQUFJLFFBQVEsS0FBSyxRQUFRLEdBQUc7QUFDMUIsVUFBTUMsY0FBYSxRQUFRLElBQUksS0FBSztBQUNwQyxVQUFNQyxhQUFZLFVBQVUsTUFBTSxNQUFNLEdBQUc7QUFDM0MsUUFBSUEsV0FBVSxXQUFZLFFBQU8sS0FBSyxFQUFFLE1BQU0saUJBQWlCLE1BQU0sUUFBUSxDQUFDO0FBQzlFLFVBQU1DLFNBQVEsS0FBSyxNQUFNRixjQUFhQyxXQUFVLElBQUk7QUFFcEQsV0FBTyxLQUFLO0FBQUEsTUFDVixNQUFNO0FBQUEsTUFDTixhQUFhO0FBQUEsTUFDYixhQUFhLE1BQU0sWUFBWSxlQUFlO0FBQUEsTUFDOUMsZ0JBQWdCO0FBQUEsTUFDaEIsWUFBWSxFQUFFLE1BQU0sUUFBUSxPQUFPRCxZQUFXO0FBQUEsTUFDOUMsV0FBV0MsV0FBVTtBQUFBLE1BQ3JCLGFBQWFDO0FBQUEsTUFDYixXQUFXLEtBQUssSUFBSSxHQUFHLEtBQUssSUFBSSxLQUFLLE1BQU0sTUFBTSxTQUFTQSxNQUFLLENBQUM7QUFBQSxJQUNsRSxDQUFDO0FBRUQsV0FBTztBQUFBLE1BQ0wsRUFBRSxHQUFHLE9BQU8sTUFBTUQsV0FBVSxLQUFLO0FBQUEsTUFDakNDO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBR0EsUUFBTSxhQUEwQixRQUFRLElBQUksT0FBTztBQUNuRCxRQUFNLFFBQVE7QUFDZCxRQUFNLGNBQWMsTUFBTSxZQUFZLGVBQWU7QUFJckQsUUFBTSxVQUFVLFVBQVUsV0FBVyxJQUFJLGNBQWM7QUFDdkQsUUFBTSxVQUFVLGVBQWUsWUFBWSxPQUFPO0FBRWxELFFBQU0sV0FBVyxlQUFlLE1BQU0sTUFBTSxHQUFHO0FBQy9DLE1BQUksU0FBUyxXQUFZLFFBQU8sS0FBSyxFQUFFLE1BQU0saUJBQWlCLE1BQU0sYUFBYSxDQUFDO0FBQ2xGLFFBQU0sWUFBWSxVQUFVLFNBQVMsTUFBTSxHQUFHO0FBQzlDLE1BQUksVUFBVSxXQUFZLFFBQU8sS0FBSyxFQUFFLE1BQU0saUJBQWlCLE1BQU0sUUFBUSxDQUFDO0FBRTlFLFFBQU0sVUFBVSxNQUFNLFNBQVMsS0FBSztBQUNwQyxRQUFNLGFBQWEsVUFBVSxVQUFVLENBQUMsS0FBSztBQUM3QyxRQUFNLFFBQVEsS0FBSyxNQUFNLGFBQWEsVUFBVSxJQUFJLElBQUk7QUFFeEQsU0FBTyxLQUFLO0FBQUEsSUFDVixNQUFNO0FBQUEsSUFDTixhQUFhO0FBQUEsSUFDYixhQUFhO0FBQUEsSUFDYixnQkFBZ0I7QUFBQSxJQUNoQixZQUFZLEVBQUUsTUFBTSxTQUFTLE1BQU0sT0FBTyxXQUFXO0FBQUEsSUFDckQsV0FBVyxVQUFVO0FBQUEsSUFDckIsYUFBYTtBQUFBLElBQ2IsV0FBVyxLQUFLLElBQUksR0FBRyxLQUFLLElBQUksS0FBSyxNQUFNLE1BQU0sU0FBUyxLQUFLLENBQUM7QUFBQSxFQUNsRSxDQUFDO0FBRUQsU0FBTztBQUFBLElBQ0wsRUFBRSxHQUFHLE9BQU8sTUFBTSxVQUFVLEtBQUs7QUFBQSxJQUNqQztBQUFBLElBQ0E7QUFBQSxFQUNGO0FBQ0Y7QUFFQSxTQUFTLFVBQVUsR0FBNkI7QUFDOUMsU0FBTyxNQUFNLFFBQVEsTUFBTSxRQUFRLE1BQU0sUUFBUSxNQUFNO0FBQ3pEO0FBRUEsU0FBUyxTQUFTLEdBQXVCO0FBQ3ZDLFNBQU8sTUFBTSxJQUFJLElBQUk7QUFDdkI7QUFNTyxTQUFTLDBCQUNkLE9BQ0EsS0FDbUI7QUFDbkIsUUFBTSxVQUFVLE1BQU0sTUFBTTtBQUM1QixRQUFNLFdBQVcsU0FBUyxPQUFPO0FBQ2pDLFFBQU0sTUFBTSxJQUFJLEdBQUc7QUFDbkIsUUFBTSxTQUFrQixDQUFDLEVBQUUsTUFBTSxtQkFBbUIsU0FBUyxJQUFJLENBQUM7QUFHbEUsTUFBSSxRQUFRLEdBQUc7QUFDYixVQUFNLEtBQUssZUFBZSxPQUFPLFVBQVUsR0FBRztBQUM5QyxXQUFPLEVBQUUsT0FBTyxHQUFHLE9BQU8sUUFBUSxDQUFDLEdBQUcsUUFBUSxHQUFHLEdBQUcsTUFBTSxFQUFFO0FBQUEsRUFDOUQ7QUFHQSxNQUFJLFFBQVEsR0FBRztBQUNiLFVBQU0sVUFBVTtBQUNoQixVQUFNLE9BQ0osTUFBTSxNQUFNLFNBQVMsVUFBVSxJQUMzQixDQUFDLEtBQUssTUFBTSxNQUFNLE1BQU0sU0FBUyxDQUFDLElBQ2xDO0FBQ04sV0FBTyxLQUFLLEVBQUUsTUFBTSxXQUFXLFNBQVMsU0FBUyxPQUFPLE1BQU0sWUFBWSxNQUFNLENBQUM7QUFDakYsV0FBTztBQUFBLE1BQ0wsT0FBTztBQUFBLFFBQ0wsR0FBRztBQUFBLFFBQ0gsYUFBYSxFQUFFLGFBQWEsTUFBTSxhQUFhLEtBQUs7QUFBQSxRQUNwRCxPQUFPO0FBQUEsVUFDTCxHQUFHLE1BQU07QUFBQSxVQUNULFFBQVEsS0FBSyxJQUFJLEdBQUcsTUFBTSxNQUFNLFNBQVMsSUFBSTtBQUFBLFFBQy9DO0FBQUEsTUFDRjtBQUFBLE1BQ0E7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUtBLE1BQUksUUFBUSxLQUFLLFFBQVEsR0FBRztBQUMxQixVQUFNRixjQUFhLFFBQVEsSUFBSSxLQUFLO0FBQ3BDLFVBQU1DLGFBQVksVUFBVSxNQUFNLE1BQU0sR0FBRztBQUMzQyxRQUFJQSxXQUFVLFdBQVksUUFBTyxLQUFLLEVBQUUsTUFBTSxpQkFBaUIsTUFBTSxRQUFRLENBQUM7QUFDOUUsVUFBTUMsU0FBUSxLQUFLLE1BQU1GLGNBQWFDLFdBQVUsSUFBSTtBQUVwRCxXQUFPLEtBQUs7QUFBQSxNQUNWLE1BQU07QUFBQSxNQUNOLGFBQWEsTUFBTSxZQUFZLGVBQWU7QUFBQSxNQUM5QyxhQUFhO0FBQUEsTUFDYixnQkFBZ0I7QUFBQSxNQUNoQixZQUFZLEVBQUUsTUFBTSxRQUFRLE9BQU9ELFlBQVc7QUFBQSxNQUM5QyxXQUFXQyxXQUFVO0FBQUEsTUFDckIsYUFBYUM7QUFBQSxNQUNiLFdBQVcsS0FBSyxJQUFJLEdBQUcsS0FBSyxJQUFJLEtBQUssTUFBTSxNQUFNLFNBQVNBLE1BQUssQ0FBQztBQUFBLElBQ2xFLENBQUM7QUFFRCxXQUFPO0FBQUEsTUFDTCxFQUFFLEdBQUcsT0FBTyxNQUFNRCxXQUFVLEtBQUs7QUFBQSxNQUNqQ0M7QUFBQSxNQUNBO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFHQSxRQUFNLGdCQUE2QixRQUFRLElBQUksT0FBTztBQUN0RCxRQUFNLFFBQVE7QUFDZCxRQUFNLGNBQWMsTUFBTSxZQUFZLGVBQWU7QUFDckQsUUFBTSxVQUFVLFVBQVUsV0FBVyxJQUFJLGNBQWM7QUFDdkQsUUFBTSxVQUFVLGVBQWUsU0FBUyxhQUFhO0FBRXJELFFBQU0sV0FBVyxlQUFlLE1BQU0sTUFBTSxHQUFHO0FBQy9DLE1BQUksU0FBUyxXQUFZLFFBQU8sS0FBSyxFQUFFLE1BQU0saUJBQWlCLE1BQU0sYUFBYSxDQUFDO0FBQ2xGLFFBQU0sWUFBWSxVQUFVLFNBQVMsTUFBTSxHQUFHO0FBQzlDLE1BQUksVUFBVSxXQUFZLFFBQU8sS0FBSyxFQUFFLE1BQU0saUJBQWlCLE1BQU0sUUFBUSxDQUFDO0FBRTlFLFFBQU0sVUFBVSxNQUFNLFNBQVMsS0FBSztBQUNwQyxRQUFNLGFBQWEsVUFBVSxVQUFVLENBQUMsS0FBSztBQUM3QyxRQUFNLFFBQVEsS0FBSyxNQUFNLGFBQWEsVUFBVSxJQUFJLElBQUk7QUFFeEQsU0FBTyxLQUFLO0FBQUEsSUFDVixNQUFNO0FBQUEsSUFDTixhQUFhO0FBQUEsSUFDYixhQUFhO0FBQUEsSUFDYixnQkFBZ0I7QUFBQSxJQUNoQixZQUFZLEVBQUUsTUFBTSxTQUFTLE1BQU0sT0FBTyxXQUFXO0FBQUEsSUFDckQsV0FBVyxVQUFVO0FBQUEsSUFDckIsYUFBYTtBQUFBLElBQ2IsV0FBVyxLQUFLLElBQUksR0FBRyxLQUFLLElBQUksS0FBSyxNQUFNLE1BQU0sU0FBUyxLQUFLLENBQUM7QUFBQSxFQUNsRSxDQUFDO0FBRUQsU0FBTztBQUFBLElBQ0wsRUFBRSxHQUFHLE9BQU8sTUFBTSxVQUFVLEtBQUs7QUFBQSxJQUNqQztBQUFBLElBQ0E7QUFBQSxFQUNGO0FBQ0Y7OztBQ3pNTyxTQUFTLGlCQUNkLE9BQ0EsS0FDQSxPQUF5QixDQUFDLEdBQ1A7QUFDbkIsUUFBTSxVQUFVLE1BQU0sTUFBTTtBQUM1QixRQUFNLFdBQVcsTUFBTSxNQUFNLE1BQU0sU0FBUztBQUM1QyxRQUFNLFNBQVMsSUFBSSxHQUFHO0FBQ3RCLFFBQU0sTUFBTSxLQUFLLE9BQU8sS0FBSyxJQUFJLEdBQUcsU0FBUyxDQUFDLElBQUk7QUFFbEQsUUFBTSxTQUFrQixDQUFDO0FBRXpCLE1BQUk7QUFDSixNQUFJLFdBQVcsSUFBSTtBQUVqQixXQUFPLElBQUksV0FBVyxHQUFHLEdBQUksTUFBTTtBQUFBLEVBQ3JDLFdBQVcsWUFBWSxHQUFJLFFBQU8sT0FBTztBQUFBLFdBQ2hDLFlBQVksR0FBSSxRQUFPLE9BQU87QUFBQSxXQUM5QixZQUFZLEdBQUksUUFBTyxPQUFPO0FBQUEsV0FDOUIsWUFBWSxHQUFJLFFBQU8sT0FBTztBQUFBLFdBQzlCLFlBQVksR0FBSSxRQUFPLE9BQU87QUFBQSxNQUNsQyxRQUFPO0FBRVosTUFBSSxNQUFNO0FBQ1IsV0FBTyxLQUFLLEVBQUUsTUFBTSxtQkFBbUIsUUFBUSxRQUFRLENBQUM7QUFDeEQsVUFBTSxhQUFhO0FBQUEsTUFDakIsR0FBRyxNQUFNO0FBQUEsTUFDVCxDQUFDLE9BQU8sR0FBRyxFQUFFLEdBQUcsTUFBTSxRQUFRLE9BQU8sR0FBRyxPQUFPLE1BQU0sUUFBUSxPQUFPLEVBQUUsUUFBUSxFQUFFO0FBQUEsSUFDbEY7QUFDQSxXQUFPO0FBQUEsTUFDTCxPQUFPO0FBQUEsUUFDTCxHQUFHO0FBQUEsUUFDSCxTQUFTO0FBQUEsUUFDVCxhQUFhQyxXQUFVO0FBQUEsUUFDdkIsT0FBTztBQUFBLE1BQ1Q7QUFBQSxNQUNBO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFFQSxTQUFPLEtBQUssRUFBRSxNQUFNLHFCQUFxQixRQUFRLFFBQVEsQ0FBQztBQUMxRCxTQUFPLEtBQUssRUFBRSxNQUFNLFlBQVksUUFBUSxZQUFZLENBQUM7QUFHckQsUUFBTSxXQUFXLElBQUksT0FBTztBQUM1QixRQUFNLGlCQUFpQixNQUFNLE1BQU0sTUFBTTtBQUN6QyxTQUFPO0FBQUEsSUFDTCxPQUFPO0FBQUEsTUFDTCxHQUFHO0FBQUEsTUFDSCxhQUFhQSxXQUFVO0FBQUEsTUFDdkIsT0FBTztBQUFBLFFBQ0wsUUFBUTtBQUFBLFFBQ1IsYUFBYSxLQUFLLElBQUksS0FBSyxpQkFBaUIsRUFBRTtBQUFBLFFBQzlDLE1BQU07QUFBQSxRQUNOLFNBQVM7QUFBQSxNQUNYO0FBQUEsSUFDRjtBQUFBLElBQ0E7QUFBQSxFQUNGO0FBQ0Y7OztBQ3pFTyxTQUFTLDBCQUNkLE9BQ0EsYUFDQSxhQUNBLEtBQ21CO0FBQ25CLFFBQU0sVUFBVSxNQUFNLE1BQU07QUFDNUIsUUFBTSxTQUFrQixDQUFDO0FBRXpCLFFBQU0sV0FBVyxlQUFlLE1BQU0sTUFBTSxHQUFHO0FBQy9DLE1BQUksU0FBUyxXQUFZLFFBQU8sS0FBSyxFQUFFLE1BQU0saUJBQWlCLE1BQU0sYUFBYSxDQUFDO0FBQ2xGLFFBQU0sWUFBWSxVQUFVLFNBQVMsTUFBTSxHQUFHO0FBQzlDLE1BQUksVUFBVSxXQUFZLFFBQU8sS0FBSyxFQUFFLE1BQU0saUJBQWlCLE1BQU0sUUFBUSxDQUFDO0FBRTlFLFFBQU0sVUFBVSxlQUFlO0FBQUEsSUFDN0IsU0FBUztBQUFBLElBQ1QsU0FBUztBQUFBLElBQ1QsZ0JBQWdCLFNBQVM7QUFBQSxJQUN6QixXQUFXLFVBQVU7QUFBQSxFQUN2QixDQUFDO0FBR0QsUUFBTSxjQUFjO0FBQ3BCLFFBQU0sWUFBWSxjQUFjLFFBQVE7QUFDeEMsUUFBTSxPQUFPLGFBQWE7QUFFMUIsU0FBTyxLQUFLO0FBQUEsSUFDVixNQUFNO0FBQUEsSUFDTjtBQUFBLElBQ0E7QUFBQSxJQUNBLGdCQUFnQixRQUFRO0FBQUEsSUFDeEIsWUFBWSxFQUFFLE1BQU0sUUFBUSxvQkFBb0IsT0FBTyxRQUFRLFdBQVc7QUFBQSxJQUMxRSxXQUFXLFVBQVU7QUFBQSxJQUNyQixhQUFhLFFBQVE7QUFBQSxJQUNyQixXQUFXLEtBQUssSUFBSSxHQUFHLEtBQUssSUFBSSxLQUFLLFNBQVMsQ0FBQztBQUFBLEVBQ2pELENBQUM7QUFFRCxRQUFNLGFBQWEsT0FDZDtBQUFBLElBQ0MsR0FBRyxNQUFNO0FBQUEsSUFDVCxDQUFDLE9BQU8sR0FBRyxFQUFFLEdBQUcsTUFBTSxRQUFRLE9BQU8sR0FBRyxPQUFPLE1BQU0sUUFBUSxPQUFPLEVBQUUsUUFBUSxFQUFFO0FBQUEsRUFDbEYsSUFDQSxNQUFNO0FBRVYsU0FBTyxLQUFLO0FBQUEsSUFDVixNQUFNLE9BQU8sbUJBQW1CO0FBQUEsSUFDaEMsUUFBUTtBQUFBLEVBQ1YsQ0FBQztBQUVELFNBQU87QUFBQSxJQUNMLE9BQU87QUFBQSxNQUNMLEdBQUc7QUFBQSxNQUNILE1BQU0sVUFBVTtBQUFBLE1BQ2hCLFNBQVM7QUFBQSxNQUNULGFBQWFDLFdBQVU7QUFBQSxNQUN2QixPQUFPO0FBQUEsSUFDVDtBQUFBLElBQ0E7QUFBQSxFQUNGO0FBQ0Y7OztBQ3ZEQSxJQUFNLGFBQWE7QUFNWixTQUFTLGNBQWMsT0FBeUQ7QUFDckYsUUFBTSxTQUFrQixDQUFDO0FBQ3pCLFFBQU0sZ0JBQTBCLE1BQU0sb0JBQW9CLElBQUksSUFBSTtBQUNsRSxRQUFNLFdBQTBCO0FBQUEsSUFDOUIsUUFBUTtBQUFBLElBQ1IsWUFBWTtBQUFBLElBQ1o7QUFBQSxJQUNBLHNCQUFzQjtBQUFBLEVBQ3hCO0FBQ0EsU0FBTyxLQUFLLEVBQUUsTUFBTSxvQkFBb0IsUUFBUSxHQUFHLFlBQVksY0FBYyxDQUFDO0FBQzlFLFNBQU87QUFBQSxJQUNMLE9BQU87QUFBQSxNQUNMLEdBQUc7QUFBQSxNQUNILE9BQU87QUFBQSxNQUNQO0FBQUEsSUFDRjtBQUFBLElBQ0E7QUFBQSxFQUNGO0FBQ0Y7QUFHTyxTQUFTLHdCQUF3QixPQUF5RDtBQUMvRixNQUFJLENBQUMsTUFBTSxTQUFVLFFBQU8sRUFBRSxPQUFPLFFBQVEsQ0FBQyxFQUFFO0FBRWhELFFBQU0sYUFBYSxNQUFNLFNBQVM7QUFDbEMsUUFBTSxTQUFrQixDQUFDO0FBSXpCLFFBQU0sYUFBYTtBQUFBLElBQ2pCLEdBQUcsTUFBTTtBQUFBLElBQ1QsQ0FBQyxVQUFVLEdBQUc7QUFBQSxNQUNaLEdBQUcsTUFBTSxRQUFRLFVBQVU7QUFBQSxNQUMzQixNQUFNLEVBQUUsR0FBRyxNQUFNLFFBQVEsVUFBVSxFQUFFLE1BQU0sSUFBSSxNQUFNLFNBQVMsVUFBVSxJQUFJLElBQUksRUFBRTtBQUFBLElBQ3BGO0FBQUEsRUFDRjtBQUVBLFNBQU87QUFBQSxJQUNMLE9BQU87QUFBQSxNQUNMLEdBQUc7QUFBQSxNQUNILFNBQVM7QUFBQSxNQUNULE9BQU87QUFBQSxNQUNQLE9BQU87QUFBQSxRQUNMLFFBQVE7QUFBQSxRQUNSLGFBQWEsS0FBSyxJQUFJLEtBQUssYUFBYSxFQUFFO0FBQUEsUUFDMUMsTUFBTTtBQUFBLFFBQ04sU0FBUztBQUFBLE1BQ1g7QUFBQSxJQUNGO0FBQUEsSUFDQTtBQUFBLEVBQ0Y7QUFDRjtBQVNPLFNBQVMsc0JBQXNCLE9BQXlEO0FBQzdGLE1BQUksQ0FBQyxNQUFNLFNBQVUsUUFBTyxFQUFFLE9BQU8sUUFBUSxDQUFDLEVBQUU7QUFFaEQsUUFBTSxTQUFrQixDQUFDO0FBQ3pCLFFBQU0sWUFBWSxNQUFNLFNBQVM7QUFFakMsTUFBSSxjQUFjLEdBQUc7QUFFbkIsVUFBTSxpQkFBaUIsSUFBSSxNQUFNLFNBQVMsVUFBVTtBQUNwRCxVQUFNLGFBQWE7QUFBQSxNQUNqQixHQUFHLE1BQU07QUFBQSxNQUNULENBQUMsY0FBYyxHQUFHO0FBQUEsUUFDaEIsR0FBRyxNQUFNLFFBQVEsY0FBYztBQUFBLFFBQy9CLE1BQU0sRUFBRSxHQUFHLE1BQU0sUUFBUSxjQUFjLEVBQUUsTUFBTSxJQUFJLEVBQUU7QUFBQSxNQUN2RDtBQUFBLElBQ0Y7QUFDQSxXQUFPO0FBQUEsTUFDTCxPQUFPO0FBQUEsUUFDTCxHQUFHO0FBQUEsUUFDSCxTQUFTO0FBQUEsUUFDVCxPQUFPO0FBQUEsUUFDUCxVQUFVLEVBQUUsR0FBRyxNQUFNLFVBQVUsWUFBWSxnQkFBZ0Isc0JBQXNCLEVBQUU7QUFBQSxRQUNuRixPQUFPO0FBQUEsVUFDTCxRQUFRO0FBQUEsVUFDUixhQUFhLEtBQUssSUFBSSxLQUFLLGFBQWEsRUFBRTtBQUFBLFVBQzFDLE1BQU07QUFBQSxVQUNOLFNBQVM7QUFBQSxRQUNYO0FBQUEsTUFDRjtBQUFBLE1BQ0E7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUdBLFFBQU0sS0FBSyxNQUFNLFFBQVEsQ0FBQyxFQUFFO0FBQzVCLFFBQU0sS0FBSyxNQUFNLFFBQVEsQ0FBQyxFQUFFO0FBQzVCLE1BQUksT0FBTyxJQUFJO0FBQ2IsVUFBTSxTQUFtQixLQUFLLEtBQUssSUFBSTtBQUN2QyxXQUFPLEtBQUssRUFBRSxNQUFNLGFBQWEsT0FBTyxDQUFDO0FBQ3pDLFdBQU87QUFBQSxNQUNMLE9BQU87QUFBQSxRQUNMLEdBQUc7QUFBQSxRQUNILE9BQU87QUFBQSxRQUNQLFVBQVUsRUFBRSxHQUFHLE1BQU0sVUFBVSxzQkFBc0IsRUFBRTtBQUFBLE1BQ3pEO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBR0EsUUFBTSxhQUFhLE1BQU0sU0FBUyxTQUFTO0FBQzNDLFFBQU0sWUFBWSxJQUFJLE1BQU0sU0FBUyxhQUFhO0FBQ2xELFNBQU8sS0FBSyxFQUFFLE1BQU0sb0JBQW9CLFFBQVEsWUFBWSxZQUFZLFVBQVUsQ0FBQztBQUNuRixTQUFPO0FBQUEsSUFDTCxPQUFPO0FBQUEsTUFDTCxHQUFHO0FBQUEsTUFDSCxPQUFPO0FBQUEsTUFDUCxVQUFVO0FBQUEsUUFDUixRQUFRO0FBQUEsUUFDUixZQUFZO0FBQUEsUUFDWixlQUFlO0FBQUEsUUFDZixzQkFBc0I7QUFBQSxNQUN4QjtBQUFBO0FBQUEsTUFFQSxNQUFNLEVBQUUsYUFBYSxxQkFBcUIsR0FBRyxPQUFPLGVBQWUsRUFBRTtBQUFBLE1BQ3JFLFNBQVM7QUFBQSxRQUNQLEdBQUcsTUFBTTtBQUFBLFFBQ1QsR0FBRyxFQUFFLEdBQUcsTUFBTSxRQUFRLENBQUMsR0FBRyxNQUFNLFVBQVUsSUFBSSxFQUFFO0FBQUEsUUFDaEQsR0FBRyxFQUFFLEdBQUcsTUFBTSxRQUFRLENBQUMsR0FBRyxNQUFNLFVBQVUsSUFBSSxFQUFFO0FBQUEsTUFDbEQ7QUFBQSxJQUNGO0FBQUEsSUFDQTtBQUFBLEVBQ0Y7QUFDRjtBQU1PLFNBQVMsdUJBQXVCLFFBQXVDO0FBQzVFLGFBQVcsS0FBSyxRQUFRO0FBQ3RCLFlBQVEsRUFBRSxNQUFNO0FBQUEsTUFDZCxLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQ0gsZUFBTztBQUFBLElBQ1g7QUFBQSxFQUNGO0FBQ0EsU0FBTztBQUNUOzs7QUN4SU8sU0FBUyxPQUFPLE9BQWtCLFFBQWdCLEtBQXdCO0FBQy9FLFFBQU0sU0FBUyxXQUFXLE9BQU8sUUFBUSxHQUFHO0FBQzVDLFNBQU8scUJBQXFCLE9BQU8sTUFBTTtBQUMzQztBQU9BLFNBQVMscUJBQXFCLFdBQXNCLFFBQW9DO0FBRXRGLE1BQUksQ0FBQyxVQUFVLFlBQVksQ0FBQyxPQUFPLE1BQU0sU0FBVSxRQUFPO0FBQzFELE1BQUksQ0FBQyxPQUFPLE1BQU0sU0FBVSxRQUFPO0FBQ25DLE1BQUksQ0FBQyx1QkFBdUIsT0FBTyxNQUFNLEVBQUcsUUFBTztBQUtuRCxRQUFNLFFBQVEsc0JBQXNCLE9BQU8sS0FBSztBQUNoRCxTQUFPO0FBQUEsSUFDTCxPQUFPLE1BQU07QUFBQSxJQUNiLFFBQVEsQ0FBQyxHQUFHLE9BQU8sUUFBUSxHQUFHLE1BQU0sTUFBTTtBQUFBLEVBQzVDO0FBQ0Y7QUFFQSxTQUFTLFdBQVcsT0FBa0IsUUFBZ0IsS0FBd0I7QUFDNUUsVUFBUSxPQUFPLE1BQU07QUFBQSxJQUNuQixLQUFLO0FBQ0gsYUFBTztBQUFBLFFBQ0wsT0FBTztBQUFBLFVBQ0wsR0FBRztBQUFBLFVBQ0gsT0FBTztBQUFBLFVBQ1AsT0FBTztBQUFBLFlBQ0wsR0FBRyxNQUFNO0FBQUEsWUFDVCxTQUFTO0FBQUEsWUFDVCxzQkFBc0IsT0FBTztBQUFBLFlBQzdCLGtCQUFrQixPQUFPLHVCQUF1QjtBQUFBLFVBQ2xEO0FBQUEsVUFDQSxTQUFTO0FBQUEsWUFDUCxHQUFHLE1BQU07QUFBQSxZQUNULEdBQUcsRUFBRSxHQUFHLE1BQU0sUUFBUSxDQUFDLEdBQUcsTUFBTSxFQUFFLElBQUksT0FBTyxNQUFNLENBQUMsRUFBRSxFQUFFO0FBQUEsWUFDeEQsR0FBRyxFQUFFLEdBQUcsTUFBTSxRQUFRLENBQUMsR0FBRyxNQUFNLEVBQUUsSUFBSSxPQUFPLE1BQU0sQ0FBQyxFQUFFLEVBQUU7QUFBQSxVQUMxRDtBQUFBLFFBQ0Y7QUFBQSxRQUNBLFFBQVEsQ0FBQyxFQUFFLE1BQU0sZUFBZSxDQUFDO0FBQUEsTUFDbkM7QUFBQSxJQUVGLEtBQUssa0JBQWtCO0FBQ3JCLFlBQU0sU0FBUyxJQUFJLFNBQVM7QUFDNUIsWUFBTSxTQUFTLE9BQU8sU0FBUyxTQUFTLE9BQU8sU0FBUyxJQUFJLE9BQU8sTUFBTTtBQUN6RSxhQUFPO0FBQUEsUUFDTDtBQUFBLFFBQ0EsUUFBUSxDQUFDLEVBQUUsTUFBTSxvQkFBb0IsUUFBUSxRQUFRLE9BQU8sQ0FBQztBQUFBLE1BQy9EO0FBQUEsSUFDRjtBQUFBLElBRUEsS0FBSyxrQkFBa0I7QUFHckIsWUFBTSxXQUFXLE9BQU8sV0FBVyxZQUFZLE9BQU8sU0FBUyxJQUFJLE9BQU8sTUFBTTtBQUVoRixZQUFNLFNBQVMsSUFBSSxRQUFRO0FBQzNCLGFBQU87QUFBQSxRQUNMLE9BQU87QUFBQSxVQUNMLEdBQUc7QUFBQSxVQUNILE9BQU87QUFBQSxVQUNQLGlCQUFpQjtBQUFBLFVBQ2pCLE9BQU8sRUFBRSxHQUFHLE1BQU0sT0FBTyxTQUFTLE9BQU87QUFBQSxRQUMzQztBQUFBLFFBQ0EsUUFBUSxDQUFDLEVBQUUsTUFBTSxXQUFXLGlCQUFpQixVQUFVLFFBQVEsR0FBRyxDQUFDO0FBQUEsTUFDckU7QUFBQSxJQUNGO0FBQUEsSUFFQSxLQUFLLG1CQUFtQjtBQUN0QixZQUFNLFNBQVMsZUFBZSxPQUFPLEdBQUc7QUFDeEMsYUFBTyxFQUFFLE9BQU8sT0FBTyxPQUFPLFFBQVEsT0FBTyxPQUFPO0FBQUEsSUFDdEQ7QUFBQSxJQUVBLEtBQUssdUJBQXVCO0FBQzFCLFlBQU0sSUFBSSx3QkFBd0IsS0FBSztBQUN2QyxhQUFPLEVBQUUsT0FBTyxFQUFFLE9BQU8sUUFBUSxFQUFFLE9BQU87QUFBQSxJQUM1QztBQUFBLElBRUEsS0FBSyxhQUFhO0FBQ2hCLFlBQU0sVUFBVSxNQUFNLE1BQU07QUFDNUIsWUFBTSxrQkFBa0IsT0FBTyxXQUFXO0FBSTFDLFVBQUksT0FBTyxTQUFTLFFBQVEsT0FBTyxTQUFTLFVBQVUsT0FBTyxTQUFTLFVBQVU7QUFDOUUsZUFBTyxFQUFFLE9BQU8sUUFBUSxDQUFDLEVBQUU7QUFBQSxNQUM3QjtBQUNBLFVBQUksT0FBTyxTQUFTLFFBQVEsQ0FBQyxpQkFBaUI7QUFDNUMsZUFBTyxFQUFFLE9BQU8sUUFBUSxDQUFDLEVBQUU7QUFBQSxNQUM3QjtBQUNBLFlBQU0sT0FBTyxNQUFNLFFBQVEsT0FBTyxNQUFNLEVBQUU7QUFDMUMsVUFBSSxPQUFPLFNBQVMsUUFBUSxLQUFLLE1BQU0sR0FBRztBQUN4QyxlQUFPLEVBQUUsT0FBTyxRQUFRLENBQUMsRUFBRTtBQUFBLE1BQzdCO0FBQ0EsV0FDRyxPQUFPLFNBQVMsUUFBUSxPQUFPLFNBQVMsUUFBUSxPQUFPLFNBQVMsUUFBUSxPQUFPLFNBQVMsUUFBUSxPQUFPLFNBQVMsU0FDakgsS0FBSyxPQUFPLElBQUksS0FBSyxHQUNyQjtBQUNBLGVBQU8sRUFBRSxPQUFPLFFBQVEsQ0FBQyxFQUFFO0FBQUEsTUFDN0I7QUFFQSxVQUFJLG1CQUFtQixNQUFNLFlBQVksYUFBYTtBQUNwRCxlQUFPLEVBQUUsT0FBTyxRQUFRLENBQUMsRUFBRTtBQUFBLE1BQzdCO0FBQ0EsVUFBSSxDQUFDLG1CQUFtQixNQUFNLFlBQVksYUFBYTtBQUNyRCxlQUFPLEVBQUUsT0FBTyxRQUFRLENBQUMsRUFBRTtBQUFBLE1BQzdCO0FBRUEsWUFBTSxTQUFrQjtBQUFBLFFBQ3RCLEVBQUUsTUFBTSxlQUFlLFFBQVEsT0FBTyxRQUFRLE1BQU0sT0FBTyxLQUFLO0FBQUEsTUFDbEU7QUFFQSxZQUFNLGNBQWM7QUFBQSxRQUNsQixhQUFhLGtCQUFrQixPQUFPLE9BQU8sTUFBTSxZQUFZO0FBQUEsUUFDL0QsYUFBYSxrQkFBa0IsTUFBTSxZQUFZLGNBQWMsT0FBTztBQUFBLE1BQ3hFO0FBR0EsVUFBSSxZQUFZLGVBQWUsWUFBWSxhQUFhO0FBQ3RELGNBQU0sZ0JBQTJCLEVBQUUsR0FBRyxPQUFPLFlBQVk7QUFNekQsWUFDRSxNQUFNLFVBQVUsaUJBQ2hCLGNBQWMsWUFBWSxXQUFXLEtBQ3JDLGNBQWMsWUFBWSxXQUFXLEdBQ3JDO0FBQ0EsZ0JBQU0sS0FBSztBQUFBLFlBQ1Q7QUFBQSxZQUNBLFlBQVk7QUFBQSxZQUNaLFlBQVk7QUFBQSxZQUNaO0FBQUEsVUFDRjtBQUNBLGlCQUFPLEVBQUUsT0FBTyxHQUFHLE9BQU8sUUFBUSxDQUFDLEdBQUcsUUFBUSxHQUFHLEdBQUcsTUFBTSxFQUFFO0FBQUEsUUFDOUQ7QUFHQSxZQUFJLFlBQVksZ0JBQWdCLE1BQU07QUFDcEMsZ0JBQU0sS0FBSyxnQkFBZ0IsZUFBZSxHQUFHO0FBQzdDLGlCQUFPLEVBQUUsT0FBTyxHQUFHLE9BQU8sUUFBUSxDQUFDLEdBQUcsUUFBUSxHQUFHLEdBQUcsTUFBTSxFQUFFO0FBQUEsUUFDOUQ7QUFJQSxZQUNFLFlBQVksZ0JBQWdCLFFBQzVCLFlBQVksZ0JBQWdCLE1BQzVCO0FBQ0EsZ0JBQU0sS0FBSywwQkFBMEIsZUFBZSxHQUFHO0FBQ3ZELGlCQUFPLEVBQUUsT0FBTyxHQUFHLE9BQU8sUUFBUSxDQUFDLEdBQUcsUUFBUSxHQUFHLEdBQUcsTUFBTSxFQUFFO0FBQUEsUUFDOUQ7QUFDQSxZQUNFLFlBQVksZ0JBQWdCLFFBQzVCLFlBQVksZ0JBQWdCLE1BQzVCO0FBQ0EsZ0JBQU0sS0FBSywwQkFBMEIsZUFBZSxHQUFHO0FBQ3ZELGlCQUFPLEVBQUUsT0FBTyxHQUFHLE9BQU8sUUFBUSxDQUFDLEdBQUcsUUFBUSxHQUFHLEdBQUcsTUFBTSxFQUFFO0FBQUEsUUFDOUQ7QUFDQSxZQUFJLFlBQVksZ0JBQWdCLFFBQVEsWUFBWSxnQkFBZ0IsTUFBTTtBQUV4RSxnQkFBTSxLQUFLLGdCQUFnQixlQUFlLEdBQUc7QUFDN0MsaUJBQU8sRUFBRSxPQUFPLEdBQUcsT0FBTyxRQUFRLENBQUMsR0FBRyxRQUFRLEdBQUcsR0FBRyxNQUFNLEVBQUU7QUFBQSxRQUM5RDtBQUdBLFlBQ0UsY0FBYyxZQUFZLFdBQVcsS0FDckMsY0FBYyxZQUFZLFdBQVcsR0FDckM7QUFHQSxjQUFJLFlBQVksZ0JBQWdCLFlBQVksYUFBYTtBQUN2RCxrQkFBTSxVQUFVLElBQUksU0FBUztBQUM3QixnQkFBSSxZQUFZLFNBQVM7QUFDdkIsb0JBQU0sS0FBSyxnQkFBZ0IsZUFBZSxHQUFHO0FBQzdDLHFCQUFPLEVBQUUsT0FBTyxHQUFHLE9BQU8sUUFBUSxDQUFDLEdBQUcsUUFBUSxHQUFHLEdBQUcsTUFBTSxFQUFFO0FBQUEsWUFDOUQ7QUFBQSxVQUVGO0FBRUEsZ0JBQU0sV0FBVztBQUFBLFlBQ2Y7QUFBQSxZQUNBO0FBQUEsY0FDRSxhQUFhLFlBQVk7QUFBQSxjQUN6QixhQUFhLFlBQVk7QUFBQSxZQUMzQjtBQUFBLFlBQ0E7QUFBQSxVQUNGO0FBQ0EsaUJBQU8sRUFBRSxPQUFPLFNBQVMsT0FBTyxRQUFRLENBQUMsR0FBRyxRQUFRLEdBQUcsU0FBUyxNQUFNLEVBQUU7QUFBQSxRQUMxRTtBQUtBLGVBQU8sRUFBRSxPQUFPLGVBQWUsT0FBTztBQUFBLE1BQ3hDO0FBRUEsYUFBTyxFQUFFLE9BQU8sRUFBRSxHQUFHLE9BQU8sWUFBWSxHQUFHLE9BQU87QUFBQSxJQUNwRDtBQUFBLElBRUEsS0FBSyxnQkFBZ0I7QUFDbkIsWUFBTSxJQUFJLE1BQU0sUUFBUSxPQUFPLE1BQU07QUFDckMsVUFBSSxFQUFFLFlBQVksRUFBRyxRQUFPLEVBQUUsT0FBTyxRQUFRLENBQUMsRUFBRTtBQUNoRCxZQUFNLFlBQVksRUFBRSxXQUFXO0FBQy9CLGFBQU87QUFBQSxRQUNMLE9BQU87QUFBQSxVQUNMLEdBQUc7QUFBQSxVQUNILFNBQVM7QUFBQSxZQUNQLEdBQUcsTUFBTTtBQUFBLFlBQ1QsQ0FBQyxPQUFPLE1BQU0sR0FBRyxFQUFFLEdBQUcsR0FBRyxVQUFVLFVBQVU7QUFBQSxVQUMvQztBQUFBLFFBQ0Y7QUFBQSxRQUNBLFFBQVEsQ0FBQyxFQUFFLE1BQU0sa0JBQWtCLFFBQVEsT0FBTyxRQUFRLFVBQVUsQ0FBQztBQUFBLE1BQ3ZFO0FBQUEsSUFDRjtBQUFBLElBRUEsS0FBSztBQUFBLElBQ0wsS0FBSztBQUlILGFBQU8sRUFBRSxPQUFPLFFBQVEsQ0FBQyxFQUFFO0FBQUEsSUFFN0IsS0FBSyxjQUFjO0FBQ2pCLFlBQU0sU0FBUyxNQUFNLE1BQU07QUFHM0IsWUFBTSxrQkFDSixNQUFNLFlBQVksTUFBTSxTQUFTLFVBQVUsSUFDdkMsY0FDQSxPQUFPO0FBQ2IsVUFBSSxvQkFBb0IsUUFBUTtBQUU5QixjQUFNLGFBQWE7QUFBQSxVQUNqQixHQUFHLE1BQU07QUFBQSxVQUNULENBQUMsTUFBTSxHQUFHLEVBQUUsR0FBRyxNQUFNLFFBQVEsTUFBTSxHQUFHLE9BQU8sTUFBTSxRQUFRLE1BQU0sRUFBRSxRQUFRLEVBQUU7QUFBQSxRQUMvRTtBQUNBLGVBQU87QUFBQSxVQUNMLE9BQU87QUFBQSxZQUNMLEdBQUc7QUFBQSxZQUNILFNBQVM7QUFBQSxZQUNULE9BQU87QUFBQSxVQUNUO0FBQUEsVUFDQSxRQUFRLENBQUMsRUFBRSxNQUFNLFlBQVksUUFBUSxPQUFPLENBQUM7QUFBQSxRQUMvQztBQUFBLE1BQ0Y7QUFFQSxhQUFPO0FBQUEsUUFDTCxPQUFPO0FBQUEsVUFDTCxHQUFHO0FBQUEsVUFDSCxPQUFPO0FBQUEsVUFDUCxPQUFPLEVBQUUsR0FBRyxNQUFNLE9BQU8sUUFBUSxJQUFJLGFBQWEsS0FBSyxNQUFNLEVBQUU7QUFBQSxRQUNqRTtBQUFBLFFBQ0EsUUFBUSxDQUFDO0FBQUEsTUFDWDtBQUFBLElBQ0Y7QUFBQSxJQUVBLEtBQUssc0JBQXNCO0FBQ3pCLFVBQUksT0FBTyxXQUFXLE1BQU07QUFFMUIsZUFBTyxFQUFFLE9BQU8sUUFBUSxDQUFDLEVBQUU7QUFBQSxNQUM3QjtBQUNBLFVBQUksT0FBTyxXQUFXLFFBQVE7QUFDNUIsY0FBTUMsVUFBUyxZQUFZLE9BQU8sR0FBRztBQUNyQyxlQUFPLEVBQUUsT0FBT0EsUUFBTyxPQUFPLFFBQVFBLFFBQU8sT0FBTztBQUFBLE1BQ3REO0FBRUEsWUFBTSxTQUFTLGlCQUFpQixPQUFPLEdBQUc7QUFDMUMsYUFBTyxFQUFFLE9BQU8sT0FBTyxPQUFPLFFBQVEsT0FBTyxPQUFPO0FBQUEsSUFDdEQ7QUFBQSxJQUVBLEtBQUssV0FBVztBQUNkLFlBQU0sU0FBUyxJQUFJLE9BQU8sTUFBTTtBQUNoQyxhQUFPO0FBQUEsUUFDTCxPQUFPLEVBQUUsR0FBRyxPQUFPLE9BQU8sWUFBWTtBQUFBLFFBQ3RDLFFBQVEsQ0FBQyxFQUFFLE1BQU0sYUFBYSxPQUFPLENBQUM7QUFBQSxNQUN4QztBQUFBLElBQ0Y7QUFBQSxJQUVBLEtBQUssY0FBYztBQUNqQixZQUFNLE9BQU8sTUFBTSxNQUFNO0FBQ3pCLFlBQU0sT0FBTyxLQUFLLElBQUksR0FBRyxPQUFPLE9BQU8sT0FBTztBQUM5QyxZQUFNLFNBQWtCLENBQUMsRUFBRSxNQUFNLGdCQUFnQixTQUFTLE9BQU8sUUFBUSxDQUFDO0FBRzFFLFdBQ0csTUFBTSxNQUFNLFlBQVksS0FBSyxNQUFNLE1BQU0sWUFBWSxNQUN0RCxPQUFPLE9BQ1AsUUFBUSxLQUNSO0FBQ0EsZUFBTyxLQUFLLEVBQUUsTUFBTSxxQkFBcUIsQ0FBQztBQUFBLE1BQzVDO0FBRUEsVUFBSSxTQUFTLEdBQUc7QUFDZCxlQUFPLEtBQUssRUFBRSxNQUFNLGlCQUFpQixTQUFTLE1BQU0sTUFBTSxRQUFRLENBQUM7QUFFbkUsWUFBSSxNQUFNLE1BQU0sWUFBWSxLQUFLLE1BQU0sTUFBTSxZQUFZLEdBQUc7QUFDMUQsaUJBQU87QUFBQSxZQUNMLE9BQU87QUFBQSxjQUNMLEdBQUc7QUFBQSxjQUNILE9BQU87QUFBQSxnQkFDTCxHQUFHLE1BQU07QUFBQSxnQkFDVCxTQUFTLE1BQU0sTUFBTSxVQUFVO0FBQUEsZ0JBQy9CLGtCQUFrQixNQUFNLE1BQU0sdUJBQXVCO0FBQUEsY0FDdkQ7QUFBQSxZQUNGO0FBQUEsWUFDQTtBQUFBLFVBQ0Y7QUFBQSxRQUNGO0FBRUEsWUFBSSxNQUFNLE1BQU0sWUFBWSxHQUFHO0FBQzdCLGlCQUFPLEtBQUssRUFBRSxNQUFNLGFBQWEsQ0FBQztBQUVsQyxnQkFBTSxxQkFDSixNQUFNLG9CQUFvQixPQUFPLElBQUksSUFBSSxNQUFNLGVBQWU7QUFDaEUsaUJBQU87QUFBQSxZQUNMLE9BQU87QUFBQSxjQUNMLEdBQUc7QUFBQSxjQUNILE9BQU87QUFBQSxjQUNQLE9BQU87QUFBQSxnQkFDTCxHQUFHLE1BQU07QUFBQSxnQkFDVCxTQUFTO0FBQUEsZ0JBQ1Qsa0JBQWtCLE1BQU0sTUFBTSx1QkFBdUI7QUFBQSxjQUN2RDtBQUFBLGNBQ0EsT0FBTyxFQUFFLEdBQUcsTUFBTSxPQUFPLFNBQVMsSUFBSSxrQkFBa0IsRUFBRTtBQUFBO0FBQUEsY0FFMUQsU0FBUztBQUFBLGdCQUNQLEdBQUcsTUFBTTtBQUFBLGdCQUNULEdBQUcsRUFBRSxHQUFHLE1BQU0sUUFBUSxDQUFDLEdBQUcsVUFBVSxFQUFFO0FBQUEsZ0JBQ3RDLEdBQUcsRUFBRSxHQUFHLE1BQU0sUUFBUSxDQUFDLEdBQUcsVUFBVSxFQUFFO0FBQUEsY0FDeEM7QUFBQSxZQUNGO0FBQUEsWUFDQTtBQUFBLFVBQ0Y7QUFBQSxRQUNGO0FBRUEsY0FBTSxLQUFLLE1BQU0sUUFBUSxDQUFDLEVBQUU7QUFDNUIsY0FBTSxLQUFLLE1BQU0sUUFBUSxDQUFDLEVBQUU7QUFDNUIsWUFBSSxPQUFPLElBQUk7QUFDYixnQkFBTSxTQUFTLEtBQUssS0FBSyxJQUFJO0FBQzdCLGlCQUFPLEtBQUssRUFBRSxNQUFNLGFBQWEsT0FBTyxDQUFDO0FBQ3pDLGlCQUFPLEVBQUUsT0FBTyxFQUFFLEdBQUcsT0FBTyxPQUFPLFlBQVksR0FBRyxPQUFPO0FBQUEsUUFDM0Q7QUFFQSxjQUFNLFVBQVUsRUFBRSxHQUFHLE1BQU0sT0FBTyxTQUFTLEdBQUcsa0JBQWtCLEVBQUU7QUFDbEUsY0FBTSxLQUFLLGNBQWMsRUFBRSxHQUFHLE9BQU8sT0FBTyxRQUFRLENBQUM7QUFDckQsZUFBTyxLQUFLLEdBQUcsR0FBRyxNQUFNO0FBQ3hCLGVBQU8sRUFBRSxPQUFPLEdBQUcsT0FBTyxPQUFPO0FBQUEsTUFDbkM7QUFFQSxhQUFPO0FBQUEsUUFDTCxPQUFPLEVBQUUsR0FBRyxPQUFPLE9BQU8sRUFBRSxHQUFHLE1BQU0sT0FBTyxrQkFBa0IsS0FBSyxFQUFFO0FBQUEsUUFDckU7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLElBRUEsU0FBUztBQUdQLFlBQU0sY0FBcUI7QUFFM0IsYUFBTyxFQUFFLE9BQU8sUUFBUSxDQUFDLEVBQUU7QUFBQSxJQUM3QjtBQUFBLEVBQ0Y7QUFDRjtBQU1PLFNBQVMsV0FDZCxPQUNBLFNBQ0EsS0FDYztBQUNkLE1BQUksVUFBVTtBQUNkLFFBQU0sU0FBa0IsQ0FBQztBQUN6QixhQUFXLFVBQVUsU0FBUztBQUM1QixVQUFNLFNBQVMsT0FBTyxTQUFTLFFBQVEsR0FBRztBQUMxQyxjQUFVLE9BQU87QUFDakIsV0FBTyxLQUFLLEdBQUcsT0FBTyxNQUFNO0FBQUEsRUFDOUI7QUFDQSxTQUFPLEVBQUUsT0FBTyxTQUFTLE9BQU87QUFDbEM7OztBQzNaTyxTQUFTLFVBQVUsTUFBbUI7QUFDM0MsTUFBSSxRQUFRLFNBQVM7QUFFckIsUUFBTSxPQUFPLE1BQWM7QUFDekIsWUFBUyxRQUFRLGVBQWdCO0FBQ2pDLFFBQUksSUFBSTtBQUNSLFFBQUksS0FBSyxLQUFLLElBQUssTUFBTSxJQUFLLElBQUksQ0FBQztBQUNuQyxTQUFLLElBQUksS0FBSyxLQUFLLElBQUssTUFBTSxHQUFJLElBQUksRUFBRTtBQUN4QyxhQUFTLElBQUssTUFBTSxRQUFTLEtBQUs7QUFBQSxFQUNwQztBQUVBLFNBQU87QUFBQSxJQUNMLFdBQVcsS0FBSyxLQUFLO0FBQ25CLGFBQU8sS0FBSyxNQUFNLEtBQUssS0FBSyxNQUFNLE1BQU0sRUFBRSxJQUFJO0FBQUEsSUFDaEQ7QUFBQSxJQUNBLFdBQVc7QUFDVCxhQUFPLEtBQUssSUFBSSxNQUFNLFVBQVU7QUFBQSxJQUNsQztBQUFBLElBQ0EsS0FBSztBQUNILGFBQVEsS0FBSyxNQUFNLEtBQUssSUFBSSxDQUFDLElBQUk7QUFBQSxJQUNuQztBQUFBLEVBQ0Y7QUFDRjs7O0FDZE8sU0FBUyxnQkFDZCxNQUNBLE1BQ2lCO0FBQ2pCLFFBQU0sUUFBUSxTQUFTO0FBQ3ZCLE1BQUksU0FBUyxPQUFRLFFBQU8sRUFBRSxNQUFNLFlBQVksYUFBYSxRQUFRLFlBQVksVUFBVTtBQUMzRixNQUFJLFNBQVMsS0FBTSxRQUFPLFFBQVEsRUFBRSxNQUFNLGVBQWUsSUFBSSxFQUFFLE1BQU0sVUFBVTtBQUMvRSxNQUFJLFNBQVMsU0FBUztBQUNwQixXQUFPLFFBQ0gsRUFBRSxNQUFNLGNBQWMsT0FBTyxHQUFHLFdBQVcsS0FBSyxJQUNoRCxFQUFFLE1BQU0sY0FBYyxPQUFPLEdBQUcsV0FBVyxNQUFNO0FBQUEsRUFDdkQ7QUFFQSxTQUFPLFFBQ0gsRUFBRSxNQUFNLGNBQWMsT0FBTyxHQUFHLFdBQVcsTUFBTSxJQUNqRCxFQUFFLE1BQU0sY0FBYyxPQUFPLElBQUksV0FBVyxLQUFLO0FBQ3ZEO0FBd0JPLFNBQVMsaUJBQ2QsUUFDQSxTQUNBLEtBQ2tCO0FBQ2xCLFFBQU0sa0JBQWtCLFdBQVc7QUFFbkMsTUFBSSxRQUFRLEVBQUcsUUFBTyxFQUFFLE1BQU0sWUFBWSxhQUFhLE9BQU87QUFFOUQsTUFBSSxRQUFRLEdBQUc7QUFDYixVQUFNLFdBQVcsa0JBQWtCLEtBQUs7QUFDeEMsV0FBTyxFQUFFLE1BQU0sV0FBVyxTQUFTO0FBQUEsRUFDckM7QUFFQSxNQUFJLFFBQVEsRUFBRyxRQUFPLEVBQUUsTUFBTSxjQUFjLE9BQU8sR0FBRztBQUN0RCxNQUFJLFFBQVEsRUFBRyxRQUFPLEVBQUUsTUFBTSxjQUFjLE9BQU8sRUFBRTtBQUdyRCxRQUFNLE9BQU8sUUFBUSxJQUFJLE9BQU87QUFDaEMsUUFBTSxRQUFRLGtCQUFrQixJQUFJO0FBQ3BDLFNBQU8sRUFBRSxNQUFNLFdBQVcsTUFBTSxNQUFNO0FBQ3hDO0FBMkJPLFNBQVMscUJBQXFCLE1BQWtDO0FBQ3JFLFVBQVEsTUFBTTtBQUFBLElBQ1osS0FBSztBQUFRLGFBQU87QUFBQSxJQUNwQixLQUFLO0FBQVMsYUFBTztBQUFBLElBQ3JCLEtBQUs7QUFBUSxhQUFPO0FBQUEsSUFDcEIsS0FBSztBQUFNLGFBQU87QUFBQSxFQUNwQjtBQUNGO0FBT08sU0FBUyxpQkFBaUIsV0FBbUIsTUFBaUM7QUFDbkYsU0FBUSxLQUFLLFlBQWEsS0FBSyxTQUFTLFVBQVUsS0FBSztBQUN6RDtBQUVPLFNBQVMsZUFDZCxhQUNBLFNBQ0EsS0FFQSxRQUNnQjtBQUNoQixRQUFNLGtCQUFrQixnQkFBZ0I7QUFFeEMsTUFBSSxpQkFBaUI7QUFDbkIsUUFBSSxRQUFRLEVBQUcsUUFBTyxFQUFFLE1BQU0sYUFBYTtBQUMzQyxRQUFJLE9BQU8sRUFBRyxRQUFPLEVBQUUsTUFBTSxnQkFBZ0IsT0FBTyxHQUFHO0FBQ3ZELFVBQU1DLGNBQWEsS0FBSyxPQUFPLE1BQU0sVUFBVSxDQUFDO0FBQ2hELFdBQU8sRUFBRSxNQUFNLGdCQUFnQixPQUFPQSxjQUFhLEtBQUtBLGNBQWEsR0FBRztBQUFBLEVBQzFFO0FBR0EsTUFBSSxPQUFPLEdBQUc7QUFDWixVQUFNLFdBQVcsU0FBUyxLQUFLLElBQUksQ0FBQyxLQUFLLE1BQU0sU0FBUyxDQUFDLElBQUk7QUFDN0QsV0FBTyxFQUFFLE1BQU0sbUJBQW1CLFNBQVM7QUFBQSxFQUM3QztBQUNBLE1BQUksUUFBUSxFQUFHLFFBQU8sRUFBRSxNQUFNLG9CQUFvQjtBQUNsRCxRQUFNLGFBQWEsS0FBSyxPQUFPLE1BQU0sVUFBVSxDQUFDO0FBQ2hELFNBQU8sRUFBRSxNQUFNLHlCQUF5QixPQUFPLGFBQWEsS0FBSyxhQUFhLEdBQUc7QUFDbkY7IiwKICAibmFtZXMiOiBbImJsYW5rUGljayIsICJibGFua1BpY2siLCAiaGFsZlRvR29hbCIsICJibGFua1BpY2siLCAiYmxhbmtQaWNrIiwgImJsYW5rUGljayIsICJibGFua1BpY2siLCAibXVsdGlwbGllciIsICJ5YXJkc0RyYXciLCAieWFyZHMiLCAiYmxhbmtQaWNrIiwgImJsYW5rUGljayIsICJyZXN1bHQiLCAiaGFsZlRvR29hbCJdCn0K
