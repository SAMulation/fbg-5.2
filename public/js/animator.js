/**
 * Event-driven play animator.
 *
 * The Durable Object hands every play resolution back as a list of
 * engine events. This module walks them and drives the matching DOM
 * animations using v5.1's existing card / ball / scoreboard helpers.
 *
 * Replaces the bypass `_narratePlayResolution` that ran during the
 * server-auth migration. Single-player and online both eventually
 * funnel through here once the v5.1 collapse lands; for now only
 * online-multi calls it.
 *
 * Designed to be additive: anything we don't yet animate falls
 * through to a `console.debug` no-op so an event the engine grows
 * doesn't crash the screen.
 */

import { alertBox, sleep, setBallSpot, firstDownLine, animationSimple } from './graphics.js'

const CARD_CLASSES = {
  King: 'times-king',
  Queen: 'times-queen',
  Jack: 'times-jack',
  10: 'times-10',
  '/': null
}

const QUALITY_LABEL = ['', 'Best', 'Good', 'Decent', 'Okay', 'Worst']
const QUALITY_CLASS = ['', 'qual-best', 'qual-good', 'qual-decent', 'qual-okay', 'qual-worst']

/**
 * Reset the per-play UI bits to their starting state. Called before we
 * start dispatching `picked`/`active` classes for a new play.
 */
function resetPlayUI (run) {
  for (const card of [run.plCard1, run.plCard2, run.multCard, run.yardCard]) {
    card.classList.remove('picked')
    const back = card.querySelector('.back')
    back.innerText = ''
    back.className = 'back'
  }
  if (run.qualityFooter) {
    run.qualityFooter.querySelectorAll('.qual-worst, .qual-okay, .qual-decent, .qual-good, .qual-best')
      .forEach(el => el.classList.remove('active'))
  }
  if (run.qualityOffPlays) run.qualityOffPlays.forEach(el => el.classList.remove('active'))
  if (run.qualityDefPlays) run.qualityDefPlays.forEach(el => el.classList.remove('active'))
  if (run.timesHeader) {
    run.timesHeader.className = 'times-header'
    run.timesHeader.innerText = 'Call Quality:'
  }
}

function flipPlayCard (cardEl, play, isHome) {
  const back = cardEl.querySelector('.back')
  back.innerText = play
  if (isHome) back.classList.add('back-home')
  cardEl.classList.add('picked')
}

function highlightQualityRow (run, quality) {
  if (!run.qualityFooter || quality < 1 || quality > 5) return
  const cls = QUALITY_CLASS[quality]
  const cell = run.qualityFooter.querySelector('.' + cls)
  if (cell) cell.classList.add('active')
  if (run.timesHeader) {
    run.timesHeader.classList.add(cls)
    run.timesHeader.innerText = 'Call Quality: ' + QUALITY_LABEL[quality]
  }
}

function flipMultiplierCard (run, cardName, multiplier) {
  const back = run.multCard.querySelector('.back')
  back.innerText = cardName === '/' ? '/' : cardName
  const cls = CARD_CLASSES[cardName]
  if (cls) back.classList.add(cls)
  run.multCard.classList.add('picked')
  if (run.timesHeader && cardName !== '/') {
    // Optionally show the multiplier value alongside the card name.
    void multiplier
  }
}

function flipYardsCard (run, value, isHomeOffense) {
  const back = run.yardCard.querySelector('.back')
  back.innerText = value === '/' ? '/' : value
  if (isHomeOffense) back.classList.add('back-home')
  run.yardCard.classList.add('picked')
}

/**
 * Main entry. Given a play that just resolved on the server, walk
 * its event stream and animate. The `state` is the post-resolution
 * GameState; v5.1's game object should already have its scalar
 * fields (spot, down, scores) synced from it before we're called.
 */
export async function animateResolution (run, game, events, state) {
  resetPlayUI(run)

  const playCalled = events.filter(e => e.type === 'PLAY_CALLED')
  const playResolved = events.find(e => e.type === 'PLAY_RESOLVED')
  const sameCoin = events.find(e => e.type === 'SAME_PLAY_COIN')
  const trickRoll = events.find(e => e.type === 'TRICK_PLAY_ROLL')
  const hailRoll = events.find(e => e.type === 'HAIL_MARY_ROLL')
  const bigPlay = events.find(e => e.type === 'BIG_PLAY')
  const fgGood = events.some(e => e.type === 'FIELD_GOAL_GOOD')
  const fgMiss = events.some(e => e.type === 'FIELD_GOAL_MISSED')
  const punt = events.find(e => e.type === 'PUNT')
  const td = events.some(e => e.type === 'TOUCHDOWN')
  const safety = events.some(e => e.type === 'SAFETY')
  const interception = events.some(e => e.type === 'TURNOVER' && e.reason === 'interception')
  const fumble = events.some(e => e.type === 'TURNOVER' && e.reason === 'fumble')
  const turnoverDowns = events.some(e => e.type === 'TURNOVER_ON_DOWNS')
  const firstDown = events.some(e => e.type === 'FIRST_DOWN')
  const penalty = events.find(e => e.type === 'PENALTY')

  // 1. Reveal the play picks. PLAY_CALLED events are in dispatch order:
  //    offense's first, defense's second.
  for (const ev of playCalled) {
    const isOffense = ev.player === game.offNum
    const card = isOffense ? run.plCard1 : run.plCard2
    flipPlayCard(card, ev.play, ev.player === game.home)
    await sleep(250)
  }

  // 2. Special-play narration (die rolls, coin flip).
  if (sameCoin) await alertBox(run, 'Same play! Coin: ' + sameCoin.outcome)
  if (trickRoll) await alertBox(run, 'Trick play! Rolled ' + trickRoll.outcome)
  if (hailRoll) await alertBox(run, 'Hail Mary! Rolled ' + hailRoll.outcome)
  if (bigPlay) await alertBox(run, 'BIG PLAY for ' + game.players[bigPlay.beneficiary].team.name + '!')

  // 3. Multiplier + yards card reveal (regular plays + Same Play).
  if (playResolved) {
    flipMultiplierCard(run, playResolved.multiplier.card, playResolved.multiplier.value)
    await sleep(300)
    flipYardsCard(run, playResolved.yardsCard, game.offNum === game.home)
    await sleep(300)
    highlightQualityRow(run, playResolved.matchupQuality)
    await sleep(400)
  }

  // 4. Outcome line.
  const offName = game.players[game.offNum]?.team?.name ?? 'Offense'
  const defName = game.players[game.defNum]?.team?.name ?? 'Defense'
  let resultLine = null
  if (playResolved) {
    const yards = playResolved.yardsGained
    if (yards > 0) resultLine = yards + '-yard gain'
    else if (yards < 0) resultLine = Math.abs(yards) + '-yard loss'
    else resultLine = 'No gain'
  } else if (penalty) {
    const team = penalty.against === game.offNum ? offName : defName
    resultLine = 'Penalty on ' + team + ' (' + Math.abs(penalty.yards) + ' yds)'
  } else if (punt) {
    resultLine = offName + ' punt away'
  }
  if (resultLine) await alertBox(run, resultLine)

  // 5. Move the ball to the new spot, refresh the first-down line.
  await setBallSpot(run)
  await firstDownLine(run)

  // 6. Big calls.
  if (td) await alertBox(run, offName + ' — TOUCHDOWN!')
  else if (safety) await alertBox(run, defName + ' — SAFETY!')
  else if (interception) await alertBox(run, defName + ' INTERCEPTED the ball!')
  else if (fumble) await alertBox(run, defName + ' recovered a FUMBLE!')
  else if (fgGood) await alertBox(run, offName + ' field goal is GOOD!')
  else if (fgMiss) await alertBox(run, offName + ' field goal is no good.')
  else if (turnoverDowns) await alertBox(run, 'Turnover on downs.')
  else if (firstDown) await alertBox(run, 'First down!')

  // 7. Scoreboard refresh — text only (animations for TD/Safety/FG live in v5.1's
  //    scoreChange and run on game.status === 101 / 102 in endPlay).
  if (run.printMsgDown) run.printMsgDown(game, run.scoreboardContainer)
  if (run.printMsgSpot) run.printMsgSpot(game, run.scoreboardContainer)
  void state

  // Soft pause so the user sees the result before the next snap.
  animationSimple(run.qualityContainer, 'fade', false)
  await sleep(400)
}
