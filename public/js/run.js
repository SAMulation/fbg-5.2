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

  async cpuPages (game, p, state = 'reg') {
    if (game.players[p].currentPlay) return game.players[p].currentPlay

    if (state === 'reg') {
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
