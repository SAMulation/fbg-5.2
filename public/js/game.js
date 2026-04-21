import Player from './player.js'
import Play from './play.js'
import Run from './run.js'
import ButtonInput from './buttonInput.js'
import Utils from './remoteUtils.js'
import { CHANGE, INIT, INIT_OTC } from './defaults.js'
import PromptInput from './promptInput.js'
import FormInput from './formInput.js'
// Engine: card-deck primitives. The async wrapper around Utils.randInt is
// preserved so multiplayer RNG-sync continues to work; the deck-state math
// itself is delegated to the engine via a one-shot replay-rng adapter.
import {
  freshDeckMultipliers as engineFreshMults,
  freshDeckYards as engineFreshYards,
  drawMultiplier as engineDrawMultiplier,
  drawYards as engineDrawYards
} from './engine.js'

export default class Game {
  constructor (resume = null, connection = null, team1 = null, team2 = null, numberPlayers = 1, gameType = 'reg', home = 1, qtrLength = 7, animation = true, stats1 = null, stats2 = null, input = new ButtonInput(), mults = null, yards = null) {
    if (resume) {
      const tempGame = JSON.parse(resume)

      this.resume = true
      this.gameType = tempGame.gameType
      this.numberPlayers = tempGame.numberPlayers
      this.home = tempGame.home
      this.away = this.opp(this.home)
      this.down = tempGame.down
      this.firstDown = tempGame.firstDown
      this.lastCallTO = tempGame.lastCallTO
      this.otPoss = tempGame.otPoss
      this.qtr = tempGame.qtr
      this.qtrLength = tempGame.qtrLength
      this.recFirst = tempGame.recFirst
      this.spot = tempGame.spot
      this.status = tempGame.status
      this.changeTime = tempGame.changeTime
      this.turnover = tempGame.turnover
      this.twoMinWarning = tempGame.twoMinWarning
      this.twoPtConv = tempGame.twoPtConv
      this.offNum = tempGame.offNum
      this.defNum = tempGame.defNum
      this.currentTime = tempGame.currentTime
      this.thisPlay = new Play()
      this.players = { 1: new Player(JSON.parse(tempGame.players)[1], this, team1, stats1), 2: new Player(JSON.parse(tempGame.players)[2], this, team2, stats2) }
      this.mults = JSON.parse(tempGame.mults)
      this.yards = JSON.parse(tempGame.yards)
      this.lastSpot = tempGame.lastSpot
      this.recap = JSON.parse(tempGame.recap)
      this.statusOnExit = tempGame.statusOnExit
      this.lastPlay = tempGame.lastPlay
      this.animation = tempGame.animation
      this.connection = JSON.parse(tempGame.connection)
      this.connection.pusher = connection.pusher
      this.connection.gamecode = connection.gamecode
      if (this.connection.connections) {
        this.connection.connections = JSON.parse(this.connection.connections)
      }
      this.me = this.connection.me
      this.run = JSON.parse(tempGame.run)
    } else {
      this.resume = false
      this.gameType = gameType
      this.numberPlayers = numberPlayers
      this.home = home
      this.away = this.opp(this.home)
      this.down = 0
      this.firstDown = null
      this.lastCallTO = 0
      this.otPoss = 2
      this.qtr = 0
      this.qtrLength = qtrLength
      this.recFirst = null // Set in coin toss
      this.spot = 65
      this.status = INIT // Defined in defaults.js, diff nums for diff plays
      this.changeTime = CHANGE // Defined in defaults.js, diff nums for diff states of time change
      this.turnover = false
      this.twoMinWarning = false
      this.twoPtConv = false
      this.offNum = this.opp(this.recFirst)
      this.defNum = this.recFirst
      this.currentTime = this.qtrLength
      this.thisPlay = new Play()
      this.players = { 1: new Player(null, this, team1, stats1), 2: new Player(null, this, team2, stats2) }
      this.mults = mults
      this.yards = yards
      this.lastSpot = this.spot
      this.recap = []
      this.me = connection.me
      this.statusOnExit = INIT
      this.lastPlay = 'Start of game'
      this.animation = animation
      this.connection = connection
    }

    // Pass input class to game constructor
    if (resume) {
      const tempRun = this.run
      let inputType = null

      // Get last input type used
      if (this.run.input === 'prompt') {
        inputType = new PromptInput()
      } else if (this.run.input === 'form') {
        inputType = new FormInput()
      } else {
        inputType = new ButtonInput()
      }
      this.run = new Run(this, inputType)

      // Reset the following values
      this.run.alert = tempRun.alert
      this.run.transmissions = JSON.parse(tempRun.transmissions)
      this.run.gameLog = JSON.parse(tempRun.gameLog)
    } else {
      this.run = new Run(this, input)
    }

    if (!this.mults) {
      this.fillMults()
    }

    if (!this.yards) {
      this.fillYards()
    }

    if (this.gameType === 'otc') {
      this.status = INIT_OTC
    }

    this.connection.toJSON = () => {
      return {
        channel: this.connection.channel,
        connections: JSON.stringify(this.connection.connections),
        gamecode: null,
        host: this.connection.host,
        me: this.connection.me,
        pusher: null,
        type: this.connection.type
      }
    }

    this.toJSON = () => {
      return {
        gameType: this.gameType,
        numberPlayers: this.numberPlayers,
        home: this.home,
        down: this.down,
        firstDown: this.firstDown,
        lastCallTO: this.lastCallTO,
        otPoss: this.otPoss,
        qtr: this.qtr,
        qtrLength: this.qtrLength,
        recFirst: this.recFirst,
        spot: this.spot,
        status: this.status,
        changeTime: this.changeTime,
        turnover: this.turnover,
        twoMinWarning: this.twoMinWarning,
        twoPtConv: this.twoPtConv,
        offNum: this.offNum,
        defNum: this.defNum,
        currentTime: this.currentTime,
        thisPlay: JSON.stringify(this.thisPlay), // null, // this.thisPlay,
        players: JSON.stringify({ 1: JSON.stringify(this.players[1]), 2: JSON.stringify(this.players[2]) }), // this.players,
        mults: JSON.stringify(this.mults), // this.mults,
        yards: JSON.stringify(this.yards), // this.yards,
        lastSpot: this.lastSpot,
        recap: JSON.stringify(this.recap), // this.recap,
        me: this.me,
        statusOnExit: this.status,
        lastPlay: this.lastPlay,
        animation: this.animation,
        connection: JSON.stringify(this.connection), // this.connection
        run: JSON.stringify(this.run)
      }
    }
  }

  async runIt (channel) {
    await this.run.playGame(this.connection)
  }

  opp (num) {
    return num === 1 ? 2 : 1
  }

  isMultiplayer () {
    return this.connection.type === 'host' || this.connection.type === 'remote' || this.connection.type === 'computer-host' || this.connection.type === 'computer-remote'
  }

  isReal (num) {
    const notZeroPlayer = this.numberPlayers !== 0
    const localTwoPlayer = this.connection.type === 'double'
    const localSinglePlayerAndMe = this.connection.type === 'single' && num === this.me
    const onlineTwoPlayerAndMe = (this.connection.type === 'host' || this.connection.type === 'remote') && num === this.me
    return notZeroPlayer && (localTwoPlayer || onlineTwoPlayerAndMe || localSinglePlayerAndMe)
  }

  isComputer (num) {
    const ZeroPlayer = this.numberPlayers === 0
    const localSinglePlayerAndNotMe = this.connection.type === 'single' && num !== this.me
    return ZeroPlayer || localSinglePlayerAndNotMe
  }

  isOT () {
    return this.qtr > 4
  }

  isPlayer (p, cond) {
    if (cond === 'local') {
      return p === this.me || this.connection.connections[p] === 'local'
    } else if (cond === 'host') {
      return this.connection.connections[p] === 'host'
    } else if (cond === 'remote') {
      return this.connection.connections[p] === 'remote'
    }
  }

  fillMults () {
    this.mults = engineFreshMults()
  }

  // Pre-fetches random indices async (so multiplayer Pusher-RNG sync still
  // works), then replays them through the pure engine for the actual deck
  // arithmetic + reshuffle. The engine is the single source of truth for the
  // result; v5.1 just owns the random source.
  // Pre-fetches random indices async (so multiplayer Pusher-RNG sync still
  // works — the `p` arg routes the draw through the right player), then
  // replays them through the pure engine for the actual deck arithmetic +
  // reshuffle. The engine is the source of truth for the result.
  async _drawWithReplay (deckKey, randomMax, drawFn, p) {
    const indices = []
    while (true) {
      const i = await Utils.randInt(0, randomMax, this, p)
      indices.push(i)
      if (this[deckKey][i] > 0) break
    }
    const replayRng = {
      intBetween: () => indices.shift() ?? 0,
      coinFlip: () => 'heads',
      d6: () => 1
    }
    const result = drawFn({ multipliers: this.mults, yards: this.yards }, replayRng)
    this.mults = result.deck.multipliers
    this.yards = result.deck.yards
    return result
  }

  async decMults (p = null) {
    const result = await this._drawWithReplay('mults', 3, engineDrawMultiplier, p)
    return { card: result.card, num: result.index + 1 }
  }

  async decYards (p = null) {
    const result = await this._drawWithReplay('yards', 9, engineDrawYards, p)
    return result.card
  }

  fillYards () {
    this.yards = engineFreshYards()
  }

  callTime (p) {
    this.players[p].timeouts--
    return this.players[p].timeouts + 1 // Stop showing this timeout
  }

  over () {
    return this.qtr >= 4 && this.players[1].score !== this.players[2].score
  }
}
