/**
 * run.js — DOM helpers + light peer-relay.
 *
 * Prior to Session 4, this file drove the entire game: ~3500 lines of
 * imperative state machines (gameLoop, playMechanism, endPlay,
 * timeChanger, etc). The engine now owns game logic and GameDriver
 * owns the play loop; run.js just holds DOM element references and
 * the animation helpers GameDriver/animator/ButtonInput call out to.
 *
 * Intentionally thin. Resist adding logic here.
 */

import { Queue } from './queue.js'
import { GameDriver } from './gameDriver.js'
import {
  alertBox, sleep, setBallSpot, setSpot,
  animationSimple, animationWaitForCompletion, animationWaitThenHide
} from './graphics.js'

export default class Run {
  constructor (game, input) {
    this.game = game
    this.input = input
    this.alert = 'bar'
    this.startScreen = document.querySelector('.start-screen')
    this.scoreboardContainer = document.querySelector('.scoreboard-container')
    this.scoreboardContainerTopLeft = document.querySelector('.scoreboard-container .away-msg.top-msg')
    this.scoreboardContainerTopRight = document.querySelector('.scoreboard-container .home-msg.top-msg')
    this.scoreboardContainerBotLeft = document.querySelector('.scoreboard-container .away-msg.bot-msg')
    this.scoreboardContainerBotRight = document.querySelector('.scoreboard-container .home-msg.bot-msg')
    this.fieldContainer = document.querySelector('.field-container')
    this.field = this.fieldContainer.querySelector('.field')
    this.coinImage = this.field.querySelector('.coin')
    this.boardContainer = document.querySelector('.board-container')
    this.plCard1 = document.querySelector('.board-container .pl-card1')
    this.plCard2 = document.querySelector('.board-container .pl-card2')
    this.multCard = document.querySelector('.board-container .mult-card')
    this.yardCard = document.querySelector('.board-container .yard-card')
    this.cardsContainer = document.querySelector('.cards-container')
    this.actualCards = this.cardsContainer.querySelector('.cards')
    this.timeoutButton = this.cardsContainer.querySelector('.to-butt')
    this.alertMessage = this.cardsContainer.querySelector('.bar-msg')
    this.qualityContainer = document.querySelector('.call-quality-container')
    this.qualityHeader = this.qualityContainer.querySelector('.qual-header')
    this.qualityFooter = this.qualityContainer.querySelector('.qual-footer')
    this.qualityTable = this.qualityContainer.querySelector('.qual-table')
    this.qualityOffPlays = this.qualityTable.querySelectorAll('.off-play')
    this.qualityDefPlays = this.qualityTable.querySelectorAll('.def-play')
    this.timesContainer = document.querySelector('.times-reporter')
    this.timesHeader = this.timesContainer.querySelector('.times-header')
    this.timesFooter = this.timesContainer.querySelector('.times-footer')
    this.ball = document.querySelector('.field-container .ball')
    this.playerContainer = this.fieldContainer.querySelector('.player-container')
    this.defHelms = this.playerContainer.querySelectorAll('.def-helms > div')
    this.offHelms = this.playerContainer.querySelectorAll('.off-helms > div')
    this.homeCity = document.querySelector('.home-city')
    this.awayCity = document.querySelector('.away-city')
    this.tdAnim = this.fieldContainer.querySelector('.td-anim')
    this.firstAnim = this.fieldContainer.querySelector('.first-anim')
    this.firstStick = this.firstAnim.querySelector('.first-stick')
    this.loadingPanelText = document.querySelector('.start-screen-loading h1')
    this.docStyle = document.documentElement.style
    this.channel = null
    this.inbox = new Queue()
    this.transmissions = []
    this.gameLog = []
    this.p2Team = ''
    this.chatTray = document.querySelector('.chat-tray')
    this.chatMessages = document.querySelector('.chat-messages')
    this.chatBadge = document.querySelector('.chat-badge')
    this.chatInput = document.querySelector('.chat-input')
    this.chatToggle = document.querySelector('.chat-toggle')
    this._chatUnread = 0
    this._chatOpen = false
    this.rematchBar = document.querySelector('.rematch-bar')
    this.rematchBtn = document.querySelector('.rematch-btn')
    this.newgameBtn = document.querySelector('.newgame-btn')
  }

  // -------------------- chat --------------------

  initChat (onSend) {
    if (!this.chatTray) return
    this.chatTray.classList.remove('hidden')
    this.chatTray.classList.add('collapsed')

    this.chatToggle.addEventListener('click', () => {
      this._chatOpen = !this._chatOpen
      this.chatTray.classList.toggle('collapsed', !this._chatOpen)
      if (this._chatOpen) {
        this._chatUnread = 0
        this.chatBadge.textContent = '0'
        this.chatBadge.classList.add('zero')
        this.chatInput.focus()
      }
    })

    const form = document.querySelector('.chat-input-form')
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const text = this.chatInput.value.trim()
      if (!text) return
      this.chatInput.value = ''
      onSend(text)
    })
  }

  appendChatMessage (from, text, isMine = false) {
    if (!this.chatMessages) return
    const li = document.createElement('li')
    li.textContent = (isMine ? 'You' : from) + ': ' + text
    this.chatMessages.appendChild(li)
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight
    if (!this._chatOpen) {
      this._chatUnread++
      this.chatBadge.textContent = String(this._chatUnread)
      this.chatBadge.classList.remove('zero')
    }
  }

  showRematchPrompt () {
    return new Promise((resolve) => {
      this.rematchBar.classList.remove('hidden')
      const onRematch = () => {
        this.rematchBar.classList.add('hidden')
        cleanup()
        resolve(true)
      }
      const onNewGame = () => {
        this.rematchBar.classList.add('hidden')
        cleanup()
        resolve(false)
      }
      const cleanup = () => {
        this.rematchBtn.removeEventListener('click', onRematch)
        this.newgameBtn.removeEventListener('click', onNewGame)
      }
      this.rematchBtn.addEventListener('click', onRematch)
      this.newgameBtn.addEventListener('click', onNewGame)
    })
  }

  // -------------------- entry point --------------------

  async playGame () {
    const driver = new GameDriver(this, this.game)
    await driver.run_()
  }

  // -------------------- board setup --------------------

  makeBarSlideable (el) {
    document.querySelector('.bar-msg').disabled = true
    document.querySelector('.bar-msg').addEventListener('click', async () => {
      await animationWaitForCompletion(el, 'slide-down', !this.cardsContainer.classList.contains('slide-down'))
      if (this.cardsContainer.classList.contains('slide-down')) {
        this.timeoutButton.disabled = true
      }
    })
  }

  async prepareHTML (game) {
    this.docStyle.setProperty('--ball-spot', (100 - game.spot) + '%')
    this.docStyle.setProperty('--first-down', (100 - game.firstDown) + '%')
    window.addEventListener('resize', () => {
      this.docStyle.setProperty('--ball-spot', (100 - game.spot) + '%')
      this.docStyle.setProperty('--first-down', (100 - game.firstDown) + '%')
    })

    setSpot(this, game.resume ? game.spot : 65)
    await setBallSpot(this)
    await this.moveBall(game, game.resume ? 'show' : 'show/clear')

    document.documentElement.style.setProperty('--away-color1', game.players[game.away].team.color1)
    document.documentElement.style.setProperty('--away-color2', game.players[game.away].team.color2)
    document.documentElement.style.setProperty('--home-color1', game.players[game.home].team.color1)
    document.documentElement.style.setProperty('--home-color2', game.players[game.home].team.color2)
    if (game.me) {
      document.documentElement.style.setProperty('--me-color1', game.players[game.me].team.color1)
      document.documentElement.style.setProperty('--me-color2', game.players[game.me].team.color2)
    }

    this.homeCity.innerText = game.players[game.home].team.city.toUpperCase()
    this.awayCity.innerText = game.players[game.away].team.city.toUpperCase()

    animationSimple(this.cardsContainer, 'slide-down')
    this.showBoard(game, this.scoreboardContainer)
    this.actualCards.innerText = ''
    if (game.resume) {
      this.coinImage.classList.toggle('fade', true)
      this.coinImage.classList.toggle('hidden', true)
    }
    await animationWaitThenHide(this.startScreen, 'fade')
    this.makeBarSlideable(this.cardsContainer)
  }

  async moveBall (game, mode = null) {
    if (mode === 'clear') {
      // intentional no-op (ball stays where it is on 'clear' today)
    } else if (mode === 'show') {
      this.ball.classList.toggle('hidden', false)
      this.ball.classList.toggle('fade', false)
    } else {
      if (mode !== 'kick') {
        await alertBox(this, 'The ball is hiked...')
      }
      this.ball.classList.toggle('hidden', false)
      await setBallSpot(this)
      if (mode === 'show/clear') {
        await this.moveBall(game, 'clear')
      }
    }
  }

  // -------------------- peer relay --------------------
  //
  // Online-multi ButtonInput uses this narrow channel for the pre-play
  // picks (coin toss call, kick/receive decision) where the AWAY player
  // types locally and the HOST needs the value to dispatch the action.
  // Regular play picks do NOT go through here — they dispatch straight
  // to the DO from each client's GameDriver.

  async sendInputToRemote (value) {
    if (value === null || value === undefined) throw new Error('attempted to send empty value')
    this.gameLog.push('Sent from player ' + this.game.me + ': ' + value)
    this.transmissions.push({ msg: value, type: 'sent' })
    this.channel.trigger('client-value', { value })
    await sleep(100)
  }

  async receiveInputFromRemote () {
    await sleep(100)
    const value = await this.inbox.dequeue()
    this.transmissions.push({ msg: value, type: 'recd' })
    this.gameLog.push('Received from player ' + this.game.opp(this.game.me) + ': ' + value)
    return value
  }

  _inServerAuthMode (game) {
    return game.isMultiplayer() &&
      this.channel &&
      typeof this.channel.dispatchAction === 'function' &&
      game.engineState
  }

  // -------------------- CPU strategy --------------------
  //
  // Situational play-picker (4th-down decisions, end-of-half FG attempts,
  // Hail Marys) — ported from v5.1's Run.cpuPlay. Writes into
  // `game.players[p].currentPlay` so that cpuPages returns it directly on
  // the next 'reg' pick instead of rolling a random play.
  //
  // v5.1 constants: TIMEOUT=4 (changeTime flag), REG=11 (score-diff upper
  // bound for "down a possession + FG"). Hoisted as local consts to keep
  // the port self-contained.

  async cpuPlay (game, p) {
    // Only the offense makes these decisions.
    if (game.offNum !== p) return

    const TIMEOUT_FLAG = 4
    const REG_DIFF = 11

    const qtr = game.qtr
    const curtim = game.currentTime
    const toCount = game.players[p].timeouts
    const tchg = game.changeTime
    const qlen = game.qtrLength
    const spt = game.spot
    const hm = game.players[p].hm
    const dwn = game.down
    const fdn = game.firstDown
    const diff = game.players[game.opp(p)].score - game.players[p].score
    let scoreBlock = 0
    let timeBlock = 0
    let dec = null

    // Time block — what horizon are we playing on?
    if (curtim === 0 && (qtr === 2 || qtr === 4) && toCount === 0 && tchg !== TIMEOUT_FLAG) {
      timeBlock = 1 // Last play of half/game
    } else if (curtim <= 0.5 && qtr === 4) {
      timeBlock = 2 // Very late
    } else if ((qlen <= 2 && qtr >= 3 && qtr <= 4) || (curtim <= 4 && qtr === 4)) {
      timeBlock = 3 // Some time left
    } else if ((qlen <= 4 && qtr >= 3 && qtr <= 4) || (curtim <= 8 && qtr === 4)) {
      timeBlock = 4 // Plenty of time
    }

    // Score block — how far behind is the offense?
    if (diff >= 1) {
      if (diff <= 3) scoreBlock = 1 // Down a FG
      else if (diff <= 8) scoreBlock = 2 // Down a possession
      else if (diff <= REG_DIFF) scoreBlock = 3 // Down a poss + FG
      else scoreBlock = 4 // Down 2+ TDs
    }

    // Half over, kick a FG if in range
    if (spt >= 60 && ((timeBlock === 1 && qtr === 2) || (scoreBlock === 0 && timeBlock === 1 && qtr === 4))) {
      dec = 'FG'
    }

    // Hail Mary from distance
    if (!dec && hm && (
      (timeBlock === 1 && scoreBlock > 1) ||
      (timeBlock === 2 && scoreBlock === 1 && spt < 70) ||
      (timeBlock === 2 && scoreBlock > 1)
    )) {
      dec = 'HM'
    }

    // Final possession and down a FG
    if (!dec && timeBlock === 1 && scoreBlock === 1) {
      if (spt >= 60) dec = 'FG'
      else if (hm) dec = 'HM'
    }

    // OT go-for-it (no punts in OT)
    if (!dec && qtr > 4 && scoreBlock === 2 && dwn === 4) {
      if (hm && fdn - spt > 10) dec = 'HM'
      else dec = 'GO'
    }

    // 4th down, dire situation
    if (!dec && dwn === 4 && (
      (timeBlock >= 1 && timeBlock <= 2 && scoreBlock === 1) ||
      (timeBlock >= 3 && scoreBlock === 3)
    )) {
      if (spt >= 60) dec = 'FG'
      else if (hm && fdn - spt > 10) dec = 'HM'
      else dec = 'GO'
    }

    // 4th down, generally go for it
    if (!dec && dwn === 4 && (
      (timeBlock === 3 && scoreBlock >= 1 && scoreBlock <= 4) ||
      (timeBlock === 4 && scoreBlock === 4)
    )) {
      if (hm && fdn - spt > 10) dec = 'HM'
      else dec = 'GO'
    }

    // 4th down, default behavior: sneak if short + in sneak range,
    // otherwise FG if in range, otherwise PUNT.
    if (!dec && dwn === 4) {
      if ((spt >= 98 || (spt >= 50 && spt <= 70)) && fdn - spt <= 3 && Math.random() < 0.5) {
        dec = 'GO'
      }
      if (!dec) {
        if (spt >= 60) dec = 'FG'
        else dec = 'PUNT' // engine's SpecialPlay id (frontend legacy button is 'PT')
      }
    }

    // Commit the decision (don't pre-set for GO / 2pt-conv — let random fallback).
    const inTwoPt = game.engineState?.phase === 'TWO_PT_CONV'
    if (dec && dec !== 'GO' && !inTwoPt) {
      game.players[p].currentPlay = dec
    }
  }

  async cpuPages (game, p, state = 'reg') {
    if (state === 'reg') {
      // Situational AI first — may pre-set currentPlay to FG/PUNT/HM.
      // Only honored for 'reg': for kick / ret / pat / coin / kickDec*,
      // stale currentPlay (e.g. "LP" from the previous scoring play, or
      // "/" set by _doKickoff) would short-circuit with a nonsense value.
      await this.cpuPlay(game, p)
      if (game.players[p].currentPlay) return game.players[p].currentPlay

      let playAbrv = ''
      let total = 0
      while (total === 0) {
        let playNum = Math.floor(Math.random() * 5)
        if (playNum === 4) playNum = Math.floor(Math.random() * 5) // trick is rarer
        playAbrv = 'SRLRSPLPTP'.substring(2 * playNum, 2 * playNum + 2)
        total = game.players[p].plays[playAbrv].count
      }
      return playAbrv
    }

    if (state === 'pat') {
      await alertBox(this, game.players[p].team.name + ' selecting PAT type...')
      const diff = game.players[game.opp(p)].score - game.players[p].score
      if ([-5, -1, 2, 5, 9, 10, 13, 17, 18].includes(diff)) return '2P'
      return 'XP'
    }

    if (state === 'coin') {
      return Math.random() < 0.5 ? 'H' : 'T'
    }

    if (state === 'kickDecOT' || state === 'kickDecReg') {
      let decPick = Math.floor(Math.random() * 2) + 1
      if (game.qtr < 4) decPick = decPick === 1 ? 'K' : 'R'
      return decPick
    }

    // Kickoff kick-type selection: RK default, OK when behind late, SK to
    // bleed clock when ahead.
    if (state === 'kick') {
      const qtr = game.qtr
      const ctim = game.currentTime
      const pScore = game.players[p].score
      const oppScore = game.players[game.opp(p)].score
      if (
        (qtr === 4 && ctim <= 3 && pScore < oppScore) ||
        (((qtr === 3 && ctim <= 7) || qtr === 4) && oppScore - pScore > 8)
      ) {
        return 'OK'
      }
      if ((qtr === 2 || qtr === 4) && ctim <= 1 && pScore > oppScore) {
        return 'SK'
      }
      return 'RK'
    }

    // Kickoff return-type selection: RR by default; OR to counter a likely
    // onside when late/behind; TB on a coin flip otherwise (mild variety).
    if (state === 'ret') {
      const qtr = game.qtr
      const ctim = game.currentTime
      const pScore = game.players[p].score
      const oppScore = game.players[game.opp(p)].score
      if (
        (qtr === 4 && ctim <= 3 && oppScore < pScore) ||
        (((qtr === 3 && ctim <= 7) || qtr === 4) && pScore - oppScore > 8)
      ) {
        return 'OR'
      }
      if (Math.random() < 0.5) return 'TB'
      return 'RR'
    }

    return null
  }

  // -------------------- legal-choice check (used by BaseInput) --------------------

  playLegal (p, passedType, abrv, thisType) {
    if (passedType !== 'reg') return passedType === thisType

    const playIndex = 'SR,LR,SP,LP,TP,HM,FG,PT'.indexOf(abrv) / 3
    if (playIndex === -1) return false

    let totalPlays = 0
    if (abrv === 'FG' || abrv === 'PT') totalPlays = -1
    else if (abrv === 'HM') totalPlays = this.game.players[p].hm
    else totalPlays = this.game.players[p].plays[abrv].count

    if (playIndex >= 0 && playIndex <= 5 && totalPlays === 0) return false
    if (playIndex >= 5 && playIndex <= 7 && this.game.defNum === p) return false
    if (abrv === 'FG' && this.game.spot < 45) return false
    if (abrv === 'PT' && this.game.down !== 4) return false
    if (abrv === 'PT' && this.game.isOT()) return false
    if (totalPlays === -1 && this.game.twoPtConv) return false
    return true
  }

  // -------------------- scoreboard formatters --------------------

  topMessageDown (aTop, hTop) {
    aTop.classList.toggle('top-up', false)
    hTop.classList.toggle('top-up', false)
    aTop.classList.toggle('top-down', true)
    hTop.classList.toggle('top-down', true)
  }

  botMessageDown (aBot, hBot) {
    aBot.classList.toggle('bot-up', false)
    hBot.classList.toggle('bot-up', false)
    aBot.classList.toggle('bot-down', true)
    hBot.classList.toggle('bot-down', true)
  }

  botMessageUp (aBot, hBot) {
    aBot.classList.toggle('bot-up', false)
    hBot.classList.toggle('bot-up', false)
    aBot.classList.toggle('bot-down', true)
    hBot.classList.toggle('bot-down', true)
  }

  topMessageUp (aTop, hTop) {
    aTop.classList.toggle('top-down', false)
    hTop.classList.toggle('top-down', false)
    aTop.classList.toggle('top-up', true)
    hTop.classList.toggle('top-up', true)
  }

  printPoss (game, scoreboard) {
    const clockPoss = scoreboard.querySelector('.clock-poss')
    clockPoss.classList.toggle('fade', false)
    clockPoss.classList.toggle('poss-home', game.away !== game.offNum)
  }

  printName (game, scoreboard) {
    const homeNick = game.players[game.home].nickname
    const awayNick = game.players[game.away].nickname
    scoreboard.querySelector('.home.team').innerText = homeNick
      ? game.players[game.home].team.abrv + ' (' + homeNick + ')'
      : game.players[game.home].team.abrv
    scoreboard.querySelector('.away.team').innerText = awayNick
      ? game.players[game.away].team.abrv + ' (' + awayNick + ')'
      : game.players[game.away].team.abrv
  }

  printScore (game, scoreboard) {
    scoreboard.querySelector('.home.score').innerText = game.players[game.home].score
    scoreboard.querySelector('.away.score').innerText = game.players[game.away].score
  }

  printClock (game, scoreboard) {
    const clockTime = scoreboard.querySelector('.clock .time')
    if (game.qtr < 5) clockTime.innerText = this.printTime(game.currentTime)
  }

  printMsgDown (game, scoreboard) {
    const blMsg = scoreboard.querySelector('.away-msg.bot-msg')
    const brMsg = scoreboard.querySelector('.home-msg.bot-msg')
    const msg = game.down + this.ending(game.down) + ' & ' + this.downDist(game.firstDown, game.spot)
    if (game.away === game.offNum) blMsg.innerText = msg
    else brMsg.innerText = msg
  }

  printMsgSpot (game, scoreboard) {
    const blMsg = scoreboard.querySelector('.away-msg.bot-msg')
    const brMsg = scoreboard.querySelector('.home-msg.bot-msg')
    const msg = this.printSpot(game, game.spot)
    if (game.away === game.offNum) brMsg.innerText = msg
    else blMsg.innerText = msg
  }

  printQuarter (game, scoreboard) {
    scoreboard.querySelector('.clock .qtr').innerText = this.showQuarter(game.qtr)
  }

  showBoard (game, scoreboard) {
    this.printPoss(game, scoreboard)
    this.printName(game, scoreboard)
    this.printScore(game, scoreboard)
    this.printClock(game, scoreboard)
    this.printMsgDown(game, scoreboard)
    this.printMsgSpot(game, scoreboard)
    this.printQuarter(game, scoreboard)
  }

  showQuarter (qtr) {
    if (qtr > 4) {
      const ot = qtr - 4
      return ot === 1 ? 'OT' : ot + 'OT'
    }
    return qtr + this.ending(qtr)
  }

  ending (num) {
    if (num === 1) return 'st'
    if (num === 2) return 'nd'
    if (num === 3) return 'rd'
    return 'th'
  }

  downDist (f, s) {
    if (f === 100) return 'G'
    if (f === s) return 'IN'
    return f - s
  }

  printTime (time) {
    if (time === -0.5) return 'End'
    const min = Math.trunc(time)
    let sec = Math.round((time - min) * 60)
    if (sec < 10) sec = '0' + sec
    return min + ':' + sec
  }

  printSpot (game, s) {
    if (s === 50) return '50'
    if (s < 50) return game.players[game.offNum].team.abrv + ' ' + s
    return game.players[game.defNum].team.abrv + ' ' + (100 - s)
  }

  // -------------------- score + FG animations --------------------

  async scoreChange (game, scrNo, pts) {
    const nameEl = game.run.scoreboardContainer.querySelector((scrNo === game.away ? '.away' : '.home') + '.team')
    const scoreEl = game.run.scoreboardContainer.querySelector((scrNo === game.away ? '.away' : '.home') + '.score')
    const temp = nameEl.innerText
    let msg1
    let msg2
    let msg3 = null

    if (pts === 1) {
      msg1 = 'XP'
      msg2 = 'extra point was good!'
    } else if (pts === 2 && scrNo === game.defNum) {
      msg1 = 'SAFE'
      msg2 = 'forced a safety!!'
    } else if (pts === 2) {
      msg1 = '2-PT'
      msg2 = '2-point conversion is good!!'
    } else if (pts === 3) {
      msg1 = 'FG'
      msg2 = 'field goal is good!!'
    } else {
      msg1 = 'TD'
      msg2 = 'scored a touchdown!!!'
      msg3 = 'TOUCHDOWN'
    }

    if (msg1 === 'TD') await setBallSpot(this, 105)
    else if (msg1 === 'SAFE') await setBallSpot(this, -5)

    if (msg3 !== null) {
      this.tdAnim.querySelector('.td-text').innerText = msg3
      if (scrNo === game.home) {
        this.tdAnim.querySelectorAll('path').forEach(path => path.classList.add('td-home'))
      }
      this.tdAnim.classList.toggle('hidden', false)
      this.tdAnim.classList.toggle('fade', false)
      this.tdAnim.querySelector('.td-frame1').classList.toggle('spin', true)
      await sleep(2000)
    }

    await animationWaitForCompletion(nameEl, 'just-scored')
    await animationWaitForCompletion(scoreEl, 'just-scored')
    nameEl.innerText = msg1
    await animationWaitForCompletion(nameEl, 'just-scored', false)
    await alertBox(this, game.players[scrNo].team.name + ' ' + msg2)

    game.players[scrNo].score += pts
    this.printScore(game, this.scoreboardContainer)

    await animationWaitForCompletion(scoreEl, 'just-scored', false)
    await animationWaitForCompletion(nameEl, 'just-scored')
    nameEl.innerText = temp
    animationSimple(nameEl, 'just-scored', false)

    if (msg3 !== null) {
      this.tdAnim.classList.toggle('fade', true)
      this.tdAnim.querySelector('.td-frame1').classList.toggle('spin', false)
      if (scrNo === game.home) {
        this.tdAnim.querySelectorAll('path').forEach(path => path.classList.remove('td-home'))
      }
      this.tdAnim.classList.toggle('hidden', true)
    }
  }

  async fgAnimation (game, fgSpot, result = true) {
    await animationWaitForCompletion(this.scoreboardContainer, 'slide-up')
    await setBallSpot(this, 100 - fgSpot)
    this.ball.classList.add(result ? 'fg-good' : 'fg-bad')
    await sleep(3000)
    this.ball.classList.toggle('fg-good', false)
    this.ball.classList.toggle('fg-bad', false)
    await animationWaitForCompletion(this.scoreboardContainer, 'slide-up', false)
  }
}

export const setModalMessage = async (modalMessage) => {
  const modal = document.querySelector('.modal-message')
  const modalButton = modal.querySelector('.modal-button')

  modal.querySelector('.modal-header').innerText = modalMessage.header
  modal.querySelector('.modal-body').innerText = modalMessage.body
  modalButton.innerText = modalMessage.buttonText
  modalButton.setAttribute('data-button-value', modalMessage.buttonGoTo)
  modal.scrollTop = 0
  modalButton.addEventListener('click', async () => {
    if (modalMessage.buttonAction === 'next') {
      return modalMessage.buttonGoTo
    } else {
      await animationWaitForCompletion(modal, 'fade')
      modal.scrollTop = 0
      modal.classList.add('hidden')
      return null
    }
  })

  modal.classList.toggle('hidden', false)
  modal.classList.toggle('fade', false)
}
