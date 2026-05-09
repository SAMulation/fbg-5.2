/* global LZString, location, URLSearchParams, history, localStorage */
/* global prompt, alert */
import Team from './team.js'
import Game from './game.js'
import Site from './site.js'
import { setModalMessage } from './run.js'
import ButtonInput from './buttonInput.js'
import PromptInput from './promptInput.js'
import FormInput from './formInput.js'
import { TEAMS } from './teams.js'
import { animationWaitForCompletion, animationWaitThenHide } from './graphics.js'
import { MODAL_MESSAGES } from './defaults.js'
import { createOnlinePusher } from './onlineChannel.js'
import { createLocalPusher } from './localSession.js'
const channel = null

// Online multi rides on the Cloudflare DO via onlineChannel; local modes
// (single / double / computer) use the same channel surface, but the
// "server" is an in-browser engine.reduce wrapper. The GameDriver is the
// sole consumer of either. The actual pusher is chosen in initGame based
// on site.connectionType.
const onlinePusher = createOnlinePusher()
const localPusher = createLocalPusher()

const isOnlineType = (t) => t === 'host' || t === 'remote' || t === 'computer-host' || t === 'computer-remote'
const pusherFor = (t) => (isOnlineType(t) ? onlinePusher : localPusher)

// pusher.bind('pusher:signin_success', (data) => {
//   channel = pusher.subscribe('private-channel')

//   setTimeout(() => {
//     channel.trigger('client-my-event', { name: 'footbored' })
//   }, 5000)

//   channel.bind('client-my-event', function (data) {
//     alert(JSON.stringify(data))
//   })
// })

// `?fast=1` short-circuits all sleeps + animation waits in graphics.js.
// Used by the multi-game viewer (multi.html) and the cpu-vs-cpu E2E
// smoke so 60-play games finish in seconds. Set BEFORE Site/Game/etc.
// construct so any module that reads window.fbgFast on init sees the
// right value.
if (typeof window !== 'undefined' && new URLSearchParams(location.search).get('fast') === '1') {
  window.fbgFast = true
}

// FIX: REMOVE LATER - Set to window for easy access
const site = new Site(document.querySelector('.main-container'))
const resumeSelection = document.querySelector('.resume-button')
const startScreen = document.querySelector('.start-screen')
const titleBall = startScreen.querySelector('.title-ball')
const setupButtons = document.querySelectorAll('.setup-button')
const loginPanel = document.querySelector('.start-screen-login')
const gamePickPanel = document.querySelector('.start-screen-game-pick')
const multiPickPanel = document.querySelector('.start-screen-multi-pick')
const onlinePickPanel = document.querySelector('.start-screen-online-pick')
const hostCodePanel = document.querySelector('.start-screen-host-code')
const gamecodeSpan = hostCodePanel.querySelector('span')
const joinUrlEl = hostCodePanel.querySelector('.join-url')
const remoteCodePanel = document.querySelector('.start-screen-remote-code')
const gamecodeInput = remoteCodePanel.querySelector('.game-code-input')
const team1Panel = document.querySelector('.start-screen-team1')
const team1SelectionLabel = document.getElementById('p1-selection-label')
const team2Panel = document.querySelector('.start-screen-team2')
const team2SelectionLabel = document.getElementById('p2-selection-label')
const gameOptionsPanel = document.querySelector('.start-screen-game-options')
const pickHome = document.getElementById('pick-home')
const pickQtrLen = document.getElementById('pick-qtrlen')
const loadingPanel = document.querySelector('.start-screen-loading')
const loadingPanelText = loadingPanel.querySelector('h1')
const nicknameInput = document.getElementById('nickname-input')
window.site = site
window.inputType = 'button'

// Restore saved nickname on load.
const savedNick = localStorage.getItem('fbg:nickname')
if (savedNick) nicknameInput.value = savedNick
nicknameInput.addEventListener('input', () => {
  const v = nicknameInput.value.trim()
  if (v) localStorage.setItem('fbg:nickname', v)
  else localStorage.removeItem('fbg:nickname')
})

// FUNCTION DEFINITIONS
const playGame = async (game) => {
  await game.runIt(channel)

  // LATER: Get ready for next game
  // EnablePlayButton(document.querySelector('.playButton'))
}

const hideElement = el => {
  el.style.display = 'none'
}

// Attach 'next' event listeners to setup buttons
const attachNextEvent = async (site, buttons) => {
  buttons.forEach(async button => {
    button.addEventListener('click', async event => {
      const val = event.target.getAttribute('data-button-value')

      if (val === 'login') {
        site.nickname = nicknameInput.value.trim() || ''
        if (site.nickname) localStorage.setItem('fbg:nickname', site.nickname)
        await animationWaitThenHide(loginPanel, 'fade')
        titleBall.classList.toggle('spin', false)
        await animationWaitForCompletion(gamePickPanel, 'fade', false)
      } else if (val === 'resume') {
        // await animationWaitThenHide(startScreen, 'fade')
        site.connectionType = 'resume'
        site.game = initGame(site)
        playGame(site.game)
      } else if (val === 'single') {
        hideElement(multiPickPanel)
        hideElement(onlinePickPanel)
        hideElement(hostCodePanel)
        hideElement(remoteCodePanel)
        site.connectionType = 'single'
        await animationWaitThenHide(gamePickPanel, 'fade')
        await animationWaitForCompletion(team1Panel, 'fade', false)
      } else if (val === 'multi') {
        await animationWaitThenHide(gamePickPanel, 'fade')
        await animationWaitForCompletion(multiPickPanel, 'fade', false)
      } else if (val === 'about') {
        await setModalMessage(MODAL_MESSAGES.welcome)
      } else if (val === 'special') {
        await setModalMessage(MODAL_MESSAGES.special)
      } else if (val === 'strategy') {
        await setModalMessage(MODAL_MESSAGES.strategy)
      } else if (val === 'upcoming') {
        await setModalMessage(MODAL_MESSAGES.upcoming)
      } else if (val === 'overtime') {
        await setModalMessage(MODAL_MESSAGES.overtime)
      } else if (val === 'local-multi') {
        hideElement(onlinePickPanel)
        hideElement(hostCodePanel)
        hideElement(remoteCodePanel)
        site.connectionType = 'double'
        await animationWaitThenHide(multiPickPanel, 'fade')
        team2SelectionLabel.innerText = 'Select player 2\'s team'
        await animationWaitForCompletion(team1Panel, 'fade', false)
      } else if (val === 'online-multi') {
        hideElement(team2Panel)
        await animationWaitThenHide(multiPickPanel, 'fade')
        await animationWaitForCompletion(onlinePickPanel, 'fade', false)
      } else if (val === 'story') {
        hideElement(onlinePickPanel)
        hideElement(hostCodePanel)
        hideElement(remoteCodePanel)
        site.connectionType = 'computer'
        await animationWaitThenHide(multiPickPanel, 'fade')
        team1SelectionLabel.innerText = 'Select player 1\'s team'
        team2SelectionLabel.innerText = 'Select player 2\'s team'
        await animationWaitForCompletion(team1Panel, 'fade', false)
      } else if (val === 'story-online') {
        let storyType = null
        hideElement(onlinePickPanel)
        hideElement(hostCodePanel)
        hideElement(remoteCodePanel)
        hideElement(team2Panel)
        while (storyType !== 'host' && storyType !== 'remote') {
          storyType = prompt('Is this the [host] or the [remote]?')
        }
        site.connectionType = 'computer-' + (storyType === 'host' ? 'host' : 'remote')
        await generateCode(site)
        await animationWaitThenHide(multiPickPanel, 'fade')
        await animationWaitForCompletion(team1Panel, 'fade', false)
      } else if (val === 'host') {
        site.connectionType = 'host'
        hideElement(remoteCodePanel)
        await generateCode(site)
        gamecodeSpan.innerText = site.gamecode

        await animationWaitThenHide(onlinePickPanel, 'fade')
        await animationWaitForCompletion(hostCodePanel, 'fade', false)
      } else if (val === 'remote') {
        site.connectionType = 'remote'
        hideElement(hostCodePanel)

        await animationWaitThenHide(onlinePickPanel, 'fade')
        await animationWaitForCompletion(remoteCodePanel, 'fade', false)
      } else if (val === 'share') {
        const shareUrl = `${location.origin}/?join=${encodeURIComponent(site.gamecode)}`
        const shareData = { title: 'FootBored', text: "Let's play FootBored!", url: shareUrl }
        if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
          navigator.share(shareData).catch(() => {})
        } else {
          navigator.clipboard.writeText(shareUrl).then(() => alert('Link copied!')).catch(() => {})
        }
      } else if (val === 'copy') {
        const copyUrl = `${location.origin}/?join=${encodeURIComponent(site.gamecode)}`
        navigator.clipboard.writeText(copyUrl).then(() => alert('Link copied!')).catch(() => {})
      } else if (val === 'host-next') {
        await animationWaitThenHide(hostCodePanel, 'fade')
        await animationWaitForCompletion(team1Panel, 'fade', false)
      } else if (val === 'paste') {
        gamecodeInput.value = await navigator.clipboard.readText()
      } else if (val === 'remote-next') {
        site.gamecode = gamecodeInput.value
        try {
          await joinOnlineGame(site)
        } catch (err) {
          alert('Could not join game: ' + (err.message || err))
          return
        }
        await animationWaitThenHide(remoteCodePanel, 'fade')
        await animationWaitForCompletion(team1Panel, 'fade', false)
      } else if (val === 'p1-next') {
        await animationWaitThenHide(team1Panel, 'fade')
        if (site.connectionType === 'host' || site.connectionType === 'computer-host') {
          await animationWaitForCompletion(gameOptionsPanel, 'fade', false)
        } else if (site.connectionType === 'remote' || site.connectionType === 'computer-remote') {
          hideElement(gameOptionsPanel)
          await animationWaitForCompletion(loadingPanel, 'fade', false)
          submitGame(site, site.connectionType)
        } else {
          loadingPanelText.innerText = 'Loading game...'
          await animationWaitForCompletion(team2Panel, 'fade', false)
        }
      } else if (val === 'p2-next') {
        await animationWaitThenHide(team2Panel, 'fade')
        await animationWaitForCompletion(gameOptionsPanel, 'fade', false)
      } else if (val === 'game-options-next') {
        site.home = parseInt(pickHome.value)
        site.qtrLength = parseInt(pickQtrLen.value)
        await animationWaitThenHide(gameOptionsPanel, 'fade')
        await animationWaitForCompletion(loadingPanel, 'fade', false)
        submitGame(site, site.connectionType)
      }
    })
  })
}

// SITE FUNCTIONS
const setTeamLists = async lists => {
  lists.forEach(async list => {
    list.removeChild(list.firstElementChild)
    for (let t = 0; t < TEAMS.length; t++) {
      const team = new Team(TEAMS[t])
      const el = document.createElement('option')
      el.textContent = team.print
      el.value = t
      list.appendChild(el)
    }
    // list.selectedIndex = list.id === 'p1Team' ? 24 : 2
    list.selectedIndex = Math.floor(Math.random() * 32)
  })
}

const connections = (site, type) => {
  if (type === 'single') {
    site.connections[1] = 'local'
    site.connections[2] = 'computer'
    site.numberPlayers = 1
    site.me = 1
  } else if (type === 'double') {
    site.connections[1] = 'local'
    site.connections[2] = 'local'
    site.numberPlayers = 2
    site.me = 1
  } else if (type === 'host') {
    site.connections[1] = 'host'
    site.connections[2] = 'remote'
    site.numberPlayers = 2
    site.me = 1
  } else if (type === 'remote') {
    site.connections[1] = 'host'
    site.connections[2] = 'remote'
    site.numberPlayers = 2
    site.me = 2
  } else if (type === 'computer') {
    site.connections[1] = 'computer'
    site.connections[2] = 'computer'
    site.numberPlayers = 0
    site.me = 0
    site.animation = true // false
  } else if (type === 'computer-host') {
    site.connections[1] = 'host'
    site.connections[2] = 'remote'
    site.numberPlayers = 0
    site.me = 0
    site.animation = true // false
  } else if (type === 'computer-remote') {
    site.connections[1] = 'host'
    site.connections[2] = 'remote'
    site.numberPlayers = 0
    site.me = 0
    site.animation = true // false
  }
}

const generateCode = async (site) => {
  if (site.connectionType === 'host' || site.connectionType === 'computer-host') {
    // Open a WebSocket to our relay and ask for a room. The returned code
    // is what the host shares with the remote.
    const { code } = await onlinePusher.createGame()
    site.gamecode = code
    // Rewrite URL so the host can share it directly.
    const joinUrl = `${location.origin}/?join=${encodeURIComponent(code)}`
    history.replaceState(null, '', joinUrl)
    joinUrlEl.textContent = joinUrl
  } else if (site.connectionType === 'remote' || site.connectionType === 'computer-remote') {
    // Remote join is triggered later via joinOnlineGame(site) once the
    // player has typed/pasted a code.
  }
}

const joinOnlineGame = async (site) => {
  const code = String(site.gamecode || '').toUpperCase().trim()
  if (!code) throw new Error('missing game code')
  await onlinePusher.joinGame(code)
  site.gamecode = code
}

// const submitTeams = async (site, submit) => {
//   submit.addEventListener('submit', async event => {
//     event.preventDefault()
//     let el
//     const value = [-1, -1]
//     let valid = true
//     site.connectionType = submit.elements.connection.value
//     connections(site, site.connectionType)

//     await generateCode(site)

//     for (let t = 0; t < 2 && valid; t++) {
//       el = document.getElementById('p' + (t + 1) + 'Team')
//       value[t] = el.selectedIndex

//       if (value[t] === -1) {
//         valid = false
//       }
//     }

//     if (valid && value[0] !== -1 && value[1] !== -1) {
//       site.team1 = value[0]
//       site.team2 = value[1]
//       site.game = initGame(site)
//       window.game = site.game
//       // document.querySelector('.playButton').disabled = false
//       document.querySelector('.playSubmit').disabled = true
//       playGame(site.game)
//     }
//   })
// }

const submitGame = async (site, type) => {
  let el
  const value = [-1, -1]
  let valid = true
  site.connectionType = type

  titleBall.classList.toggle('spin', true)

  connections(site, site.connectionType)

  for (let t = 0; t < 2 && valid; t++) {
    el = document.getElementById('p' + (t + 1) + 'Team')
    value[t] = el.selectedIndex

    if (value[t] === -1) {
      valid = false
    }
  }

  if (valid && value[0] !== -1 && value[1] !== -1) {
    site.team1 = value[0]
    site.team2 = value[1]
    site.game = initGame(site)
    window.game = site.game
    // document.querySelector('.playButton').disabled = false
    // document.querySelector('.playSubmit').disabled = true
    playGame(site.game)
  }
}

// const pressPlayButton = (button, site) => {
//   button.addEventListener('pointerdown', event => {
//     playGame(site.game)
//     event.target.setAttribute('disabled', '')
//   })
// }

// const EnablePlayButton = (button) => {
//   button.innerText = 'Play Again?'
//   button.disabled = false
//   pressPlayButton(button)
// }

const initGame = (site) => {
  const user = [null, null, null]

  if (window.inputType === 'prompt') {
    window.inputType = new PromptInput()
  } else if (window.inputType === 'form') {
    window.inputType = new FormInput()
  } else {
    window.inputType = new ButtonInput()
  }

  // Remote passes team, host waits for it
  // if (site.connectionType === 'host' || site.connectionType === 'computer-host') {

  // } else if (site.connectionType === 'remote') {

  // }

  // // Host passes site, remote waits for it
  // if (site.connectionType === 'host') {

  // } else if (site.connectionType === 'remote' || site.connectionType === 'computer-remote') {

  // }

  const pusher = pusherFor(site.connectionType)
  if (site.connectionType === 'resume') {
    return new Game(LZString.decompressFromUTF16(window.localStorage.getItem('savedGame')), { gamecode: site.gamecode, pusher })
  } else {
    return new Game(null, { me: site.me, connections: site.connections, type: site.connectionType, host: site.host, channel: site.channel, gamecode: site.gamecode, pusher, nickname: site.nickname || '' }, site.team1, site.team2, site.numberPlayers, site.gameType, site.home, site.qtrLength, site.animation, user[1], user[2], window.inputType)
  }
}

// MAIN FUNCTION CALLS
if (window.localStorage.getItem('savedGame')) {
  resumeSelection.removeAttribute('disabled')
}
await setTeamLists(document.querySelectorAll('.teamList'))
attachNextEvent(site, setupButtons)

// Share-link auto-join: ?join=XXXX opens the remote flow immediately.
const joinCode = new URLSearchParams(location.search).get('join')
if (joinCode) {
  site.gamecode = String(joinCode).toUpperCase().trim()
  joinOnlineGame(site)
    .then(() => {
      startScreen.style.display = 'none'
      submitGame(site, 'remote')
    })
    .catch((err) => {
      alert('Could not join game: ' + (err.message || err))
      // Restore clean URL so the user can try a different code.
      history.replaceState(null, '', '/')
    })
}

// Dev shortcut: ?dev=<mode> skips the start screen.
//   ?dev=single            single-player vs CPU
//   ?dev=double            local two-player
//   ?dev=computer          0-player (CPU vs CPU)
//   ?dev=host              online host (creates code, waits)
//   ?dev=remote&code=XXX   online remote (joins code)
// Optional: &t1=NE&t2=GB to pin teams, &q=7 to pin quarter length.
const devMode = new URLSearchParams(location.search).get('dev')
if (devMode) {
  const qs = new URLSearchParams(location.search)
  const t1 = qs.get('t1')
  const t2 = qs.get('t2')
  const q = qs.get('q')
  const pinTeam = (selectId, abrv) => {
    if (!abrv) return
    const sel = document.getElementById(selectId)
    const idx = TEAMS.findIndex((t) => t.abrv === abrv.toUpperCase())
    if (idx >= 0) sel.selectedIndex = idx
  }
  pinTeam('p1Team', t1)
  pinTeam('p2Team', t2)
  if (q) pickQtrLen.value = q
  site.home = parseInt(pickHome.value)
  site.qtrLength = parseInt(pickQtrLen.value)

  if (devMode === 'remote') {
    site.gamecode = qs.get('code') || ''
    if (!site.gamecode) {
      console.error('[dev] ?dev=remote requires &code=XXX')
    } else {
      joinOnlineGame(site)
        .then(() => { startScreen.style.display = 'none'; submitGame(site, 'remote') })
        .catch((err) => console.error('[dev] join failed:', err))
    }
  } else if (devMode === 'host') {
    site.connectionType = 'host'
    generateCode(site).then(() => {
      console.log('[dev] host code:', site.gamecode)
      startScreen.style.display = 'none'
      submitGame(site, 'host')
    })
  } else if (['single', 'double', 'computer'].includes(devMode)) {
    startScreen.style.display = 'none'
    submitGame(site, devMode)
  } else {
    console.error('[dev] unknown mode:', devMode)
  }
}
