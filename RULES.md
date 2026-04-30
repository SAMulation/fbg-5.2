# Correctness checklist — football + FootBored

Every rule here is something a game transcript from the narrative harness
should satisfy. When I audit a game, I walk this list literally, one rule
at a time, and report each as ✓ held / ✗ violated (with transcript
evidence). When we find a new bug, its rule gets added here. When a rule
can be checked mechanically, it gets promoted to
`packages/harness/invariants.mjs`.

Each rule has a stable ID (R-NN for real-football rules, F-NN for
FootBored-specific) so audit outputs can reference them.

## Real-football rules (R-NN)

### Start of game
- **R-01 Coin toss decision.** The coin-toss winner chooses `receive` or
  `defer`. If receive → winner gets the opening kickoff. If defer →
  opponent receives first; winner receives opening of second half.
- **R-02 Opening kickoff.** Kicking team kicks from their own 35. Receiving
  team handles return / touchback / onside-counter.
- **R-03 Second-half kickoff.** Opposite team from opening kickoff
  receives (i.e. openingReceiver swaps).

### Scoring
- **R-04 Touchdown = 6 points.** Offense or defense (return TD) can score.
- **R-05 Every TD is followed by a PAT attempt, UNLESS the PAT cannot
  affect the outcome.** On a game-ending TD, if the scoring team's
  lead is now large enough that no PAT outcome can change who wins
  (i.e. lead >= 7, since opponent has no more possessions), the PAT
  is skipped as "frivolous." The PAT can be XP (1 pt) or 2-pt
  conversion (2 pts, from the offense's 3-yd line). Retcon for Game 1:
  SF 28 → 34 ending at Q4 0:30, up 34-21. CHI is out of possessions;
  PAT can't change outcome → correctly skipped. Was NOT a bug.
- **R-06 Field goal = 3 points.** Legal only from within FG range
  (FootBored: ball on offense's own side ≥ 45).
- **R-07 Safety = 2 points.** Conceded when offense is tackled in own
  endzone. Scoring team = opposing team. **The conceder then does a free
  kick** from their own 20.
- **R-08 2-point conversion = 2 points.** One play from the offense's
  97 (= 3-yd line). If crosses goal → good; else failed. No PAT cycle
  after; next is the kickoff.

### Possession
- **R-09 Possession flips on TD, FG (made), safety, turnover.**
- **R-10 Possession does NOT flip on missed FG in FBG** — wait, FBG might
  differ. Classical football: missed FG → defense takes over at spot of
  kick. ← open question, check FBG rule.
- **R-11 Turnover on downs flips possession at the spot.**
- **R-12 Fumble recovered by defense flips possession at recovery spot.**

### Clock
- **R-13 Regulation = 4 quarters.** Each quarter length is configurable;
  default 7 minutes in FBG.
- **R-14 Each play ticks 30 seconds** in FBG (simplified model).
- **R-15 Clock hits 0 → QUARTER_ENDED fires.** Q1 → Q2 transition
  continues. Q2 end → halftime → Q3 (opposite opener kicks off).
  Q4 end → regulation over; go to OT if tied, else GAME_OVER.
- **R-16 Clock does not end a half with a pending PAT.** If a TD scores
  on the last play of Q2 / Q4, the PAT is still played before the
  halftime / end-of-regulation transition.
- **R-17 Two-minute warning** fires once per half when clock passes 2:00.
- **R-25 Penalty that GAINS YARDAGE past the first-down marker →
  automatic first down.** Real football rule. A penalty on defense
  gives the offense yardage; if that yardage crosses `firstDownAt`,
  reset down to 1st and `firstDownAt = ballOn + 10`.
  **Observed bug (Game 1, line 82→87):** SF 2nd & 3 @ own 39, TP die=2
  penalty gives SF +15, ball now at ballOn 54 (past firstDownAt 42),
  but down stays 2nd → narrator renders "2nd & Goal @ CHI 46" which
  is nonsense. Engine's `trickPlay.ts` die=2 branch should check for
  first-down crossing.
- **R-26 Penalty on offense does NOT reset first-down line.** Same-down
  replays with yards-to-go updated. (Game 3 line 141 handled this
  correctly — CHI went from 1st & 10 @ SF 37 to 1st & 25 @ own 48
  after a 15-yd penalty.)
- **R-28 FootBored "zero-second play" mechanic.** At end of quarter,
  clock decrements below 0:00 to signal the period has truly ended.
  A final play fires AT 0:00 (not after), and triggers the "last
  chance timeout" prompt (R-19). User's framing: "there is only
  final play at 0:00 and this triggers the last chance timeout
  mechanism and we can decrement to negative time to tell us for
  sure the period has ended." Currently missing in v6.

### Timeouts
- **R-18 Each team has 3 timeouts per half.** Refreshed at halftime (to 3).
  OT: 2 per OT period (or per rules).
- **R-19 Trailing team with TOs remaining should use them late.** If the
  trailing team has TOs in the final minute of a half or game, they
  should be prompted / the CPU should call at least one to preserve
  clock. ("Final chance" TO — not strictly a rule but a FootBored
  gameplay expectation.)
- **R-20 Timeout stops the clock.** Calling TO doesn't advance the clock.

### Overtime
- **R-21 OT only if tied at end of Q4.**
- **R-22 Each team gets a possession in OT.** If first team scores, the
  second still gets to respond (unless the first's score was a TD that
  the second can't match, depending on ruleset).
- **R-23 No punts in OT.** (Enforced by validator.)
- **R-24 If both teams have possessed and it's still tied**, start another
  OT period.

## FootBored-specific rules (F-NN)

### Plays
- **F-01 Regular plays:** SR, LR, SP, LP (each 3 per hand), TP (1 per hand).
- **F-02 Hail Mary:** 3 per half (HM hand).
- **F-03 Specials:** FG (if spot ≥ 45), PUNT (4th down only, not in OT).
- **F-04 Hand refills when all 5 regular plays hit 0.** (Player.decPlays → fillPlays.)

### Matchup + multipliers
- **F-05 Matchup quality 0-4:** 0 Worst / 1 Okay / 2 Decent / 3 Good / 4 Best.
- **F-06 Multiplier cards:** King (4 per deck), Queen (4), Jack (4), 10 (3).
- **F-07 Multiplier value varies by matchup quality** per the MULTI table.
- **F-08 Yards card 1-10** drawn from a separate deck.
- **F-09 Decks reshuffle** when exhausted; event `DECK_SHUFFLED`.

### Trick Play die
- **F-10 Die = 1:** forced LP with +5 bonus, matchup computed against
  defense's actual pick.
- **F-11 Die = 2:** 15-yd penalty on the opposing side (half-to-goal if tight).
- **F-12 Die = 3:** fixed ×-3 multiplier, draw yards card.
- **F-13 Die = 4:** fixed ×+4 multiplier, draw yards card.
- **F-14 Die = 5:** Big Play for the caller.
- **F-15 Die = 6:** forced LR with +5 bonus.
- **F-15a OPEN QUESTION: defensive TP sign convention.** When defense
  calls TP and rolls die=4, current engine gives **offense +4×yards**
  (offense gains, defense loses their gamble). Alt interpretation:
  defense wins their gamble on die=4 and offense loses 4×yards.
  Observed example: Game 3 line 18-23, SF defense calls TP, rolls 4,
  CHI offense gains +32 for a TD. Needs verification against v5.1.

### Big Play (when triggered by TP die=5 or SAME_PLAY_COIN King)
- **F-16 Offensive Big Play:** die 1-3 → +25 yd; die 4-5 → max(half-to-goal, 40); die 6 → TD.
- **F-17 Defensive Big Play:** die 1-3 → 10-yd penalty on offense (half-to-goal if tight); die 4-5 → fumble + return max(half, 25); die 6 → defensive TD.

### Kickoff picks
- **F-18 Kicker picks RK / OK / SK.** CPU AI picks based on score + clock
  situation (RK default, OK when behind late, SK when ahead late).
- **F-19 Returner picks RR / OR / TB.** Similar situational picker.
- **F-20 Safety kick skips picks** — uses the punt-from-35 path.
- **F-21 RK + RR:** d6 kick distance (35..60), then mult × yards return.
  King 10×, Queen 5×, Jack 1×, 10 0×.
- **F-22 RK + TB:** auto touchback, receiver ball at the 25.
- **F-23 OK:** recovery roll: 1-in-6 normally, 1-in-12 if returner chose OR.
- **F-24 SK + RR:** short kick, 2d6 return.
- **F-25 SK + other:** short kick, no return.

### CPU AI behavior (F-40+)
- **F-40 Simulate the real deck for play selection, not random + retry.**
  FootBored's physical game has TP at 1-per-hand and SR/LR/SP/LP at
  3-per-hand each. A proper CPU draw should mirror this distribution
  (TP shows up ~1 in 13 plays) rather than Math.random from a 5-set
  with retry-on-TP. The engine already tracks the hand in
  `state.players[p].hand`; CPU should draw from it with exhaustion +
  refill semantics like a real hand.
- **F-41 CPU should call timeouts to preserve clock.** The trailing
  team in the final 2 minutes of a half with TOs remaining should
  call at least one to stop the clock. Current AI never calls TO.
- **F-42 (DEPRIORITIZED) TP die=3/4 matchupQuality sentinel.** Narrator
  shows "[Worst]" for TP die 3/4 even though the fixed multiplier is
  what determines the outcome. User: "doesn't matter that it's
  [Worst]" since the ±3/+4 multiplier is the actual mechanic. Cosmetic.
- **F-44 Narrator: FG events need play header.** `FIELD_GOAL_GOOD` and
  `FIELD_GOAL_MISSED` cases in `narrator.mjs` don't call
  `showPlayHeader()`, so a FG attempt shows up without "4th & X @ spot"
  context. Add the call.
- **F-45 Narrator: Hail Mary rendering is wrong.** HM `PLAY_RESOLVED`
  events carry placeholder mult/yards values (`10 (0×) × 0 = -10 yd`)
  that don't reflect HM mechanics. Narrator should skip the "Cards:"
  line for HM plays and just show the HM roll + resulting yardage.
- **F-46 Narrator: 4th-down special at start of quarter.** When a FG
  or PUNT happens as the first event of a new quarter (because the
  prior 3rd down resolved and quarter ticked), the play header is
  missing. Same root cause as F-44.
- **F-47 CPU AI: avoid high-variance plays deep in own territory.**
  Game 2 saw two safeties, both from CHI calling TP/LP with ballOn < 15
  and taking 20+ yard losses into the endzone. AI should down-weight
  TP / LP when ballOn < 15.
- **F-48 Narrator: SAME_PLAY_COIN with 0-yard outcome is invisible.**
  Same-play paths that resolve to 0 yards (Jack+heads, 10+tails)
  emit only SAME_PLAY_COIN, no PLAY_RESOLVED, so the transcript shows
  "Same-play coin flip: tails" with the down silently advancing.
  Either the engine should emit a PLAY_RESOLVED with yardsGained=0
  on those paths, or the narrator should fall back to "no gain"
  rendering when only the coin event is present.
- **F-49 Driver bug: zero-second TD skips PAT.** When a TD is scored
  on the zero-second play (clock=0), the driver dispatches
  TICK_CLOCK(30) which fires QUARTER_ENDED → GAME_OVER before
  _doPat can run. Fix: gameDriver._tickClock early-returns when
  state.phase is PAT_CHOICE or TWO_PT_CONV. Observed Game 6 (audit
  pass #1): CHI TD at Q4 0:00, score 0→6 (no PAT), game ended 7-6.
- **F-50 (FIXED 2026-04-29) Defensive fumble return — direction.**
  Big Play die=4–5 with defense beneficiary: the engine was treating
  `returnYards` as added in old-offense POV (`ballOn + return` then
  mirror), which physically pointed AWAY from defender's scoring
  direction. v5.1's imperative path stored `dist` then called
  `changePoss('to')` which mirrored the spot, then applied dist
  forward in defender POV. Concrete: midfield fumble + 25-yd return
  → engine put defense at their own 25 (75 yards from scoring); v5.1
  put defense at offense's 25 (red zone). Fixed in
  `bigPlay.ts:147-186` — defender starts at `100 - ballOn` and
  advances `returnYards` toward their own goal in defender POV.
  Tests: bigPlay.test.ts midfield-fumble + own-deep + red-zone cases.
- **F-51 (FIXED 2026-04-29) Missed FG — spot of kick + 20-yard rule.**
  Engine was placing defender at LOS mirror (`100 - ballOn`). v5.1
  places ball at SPOT OF KICK (7 yds behind LOS in offense POV →
  `100 - ballOn + 7` in defender POV), and snaps to defender's 20
  whenever the kick spot would be inside their 20 (modern NFL
  obscure-rule). Fixed in `fieldGoal.ts:75-93`. Tests: fieldGoal.test.ts
  added "spot of kick" + "red-zone miss → 20" cases.
- **F-52 (PRE-EXISTING FIX) Onside counter (OR) odds.** v5.1's
  `kickDec` used `retType === 'RK'` to bump onside odds from 1-in-6
  to 1-in-12, which was a typo (RK is a kicker pick, not a returner
  pick), so OR did nothing in v5.1. The engine correctly uses
  `returnType === "OR"` in `kickoff.ts:183`. Considered an
  intentional fix-of-bug, not a fidelity bug. RULES.md should keep
  reflecting the intended behavior, not the original typo.

### Phase transitions (these match what `validate.ts` enforces)
- **F-26** INIT → COIN_TOSS (via START_GAME)
- **F-27** COIN_TOSS → KICKOFF (via COIN_TOSS_CALL then RECEIVE_CHOICE)
- **F-28** KICKOFF → REG_PLAY / PAT_CHOICE (after resolve)
- **F-29** REG_PLAY → PAT_CHOICE (on TD) / TWO_PT_CONV (via PAT_CHOICE) / KICKOFF (on score / safety) / OT_START (end Q4 tie) / GAME_OVER
- **F-30** TWO_PT_CONV → KICKOFF (always)
- **F-31** PAT_CHOICE → KICKOFF (kick) / TWO_PT_CONV (two_point)
- **F-32** OT_START → OT_PLAY
- **F-33** OT_PLAY → OT_PLAY (continuation) / OT_START (next possession) / PAT_CHOICE / GAME_OVER

### Invariants (already mechanical in `invariants.mjs`)
- **F-34** `field.ballOn ∈ [0, 100]` at every state.
- **F-35** `field.down ∈ [1, 4]`.
- **F-36** Neither player's score decreases between states.
- **F-37** Score deltas match emitted scoring events.
- **F-38** No implausibly-high scores (> 200).

## Audit protocol

When auditing a transcript:

1. Read it end-to-end once to get the shape.
2. Walk the checklist above, one rule at a time. For each rule:
   - If the rule didn't apply in this game (e.g. no OT), mark `n/a`.
   - If the rule held, mark ✓.
   - If the rule was violated, mark ✗ and cite the transcript line(s).
3. Produce the audit as a checklist output, not a summary.
4. For anything flagged ✗, decide:
   - Is it a real bug (engine / driver / AI)?
   - Is it a narrator presentation bug?
   - Is it a gap in my rules (we need a NEW rule here)?
5. Promote new rules to this doc. Promote mechanical rules to `invariants.mjs`.
