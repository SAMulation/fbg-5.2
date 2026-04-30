/**
 * Minimal DOM stub — enough for run.js / animator.js / graphics.js /
 * gameDriver.js to load and run without a browser.
 *
 * What it provides:
 *   • globalThis.document with querySelector/All, createElement,
 *     documentElement, body
 *   • globalThis.window with addEventListener, localStorage
 *   • globalThis.localStorage
 *   • Any returned "element" is a proxy that accepts every chained
 *     call without throwing (classList, querySelector, style, events,
 *     attributes, innerText, appendChild, etc).
 *   • transitionend fires synchronously on classList changes so
 *     animationWaitForCompletion resolves immediately.
 *   • setTimeout is left alone (real timing), but scoreboard sleeps
 *     can be skipped by stubbing alertBox at the graphics layer or by
 *     monkey-patching `run.game.animation = false`.
 */

function makeElement (tagHint = 'div') {
  const classes = new Set()
  const listeners = new Map()
  const attrs = new Map()
  let innerText = ''
  let innerHTML = ''
  const el = {
    _classes: classes,
    tagName: tagHint.toUpperCase(),
    get innerText () { return innerText },
    set innerText (v) { innerText = String(v) },
    get innerHTML () { return innerHTML },
    set innerHTML (v) { innerHTML = String(v) },
    get className () { return [...classes].join(' ') },
    set className (v) {
      classes.clear()
      for (const c of String(v).split(/\s+/)) if (c) classes.add(c)
    },
    disabled: false,
    scrollTop: 0,
    offsetHeight: 100,
    offsetWidth: 100,
    style: {
      setProperty () {},
      getPropertyValue () { return '' },
      removeProperty () {}
    },
    classList: {
      add (...cs) {
        for (const c of cs) classes.add(c)
        fire('transitionend')
      },
      remove (...cs) {
        for (const c of cs) classes.delete(c)
        fire('transitionend')
      },
      toggle (c, force) {
        const should = force === undefined ? !classes.has(c) : !!force
        if (should) classes.add(c); else classes.delete(c)
        fire('transitionend')
      },
      contains (c) { return classes.has(c) }
    },
    querySelector () { return makeElement() },
    querySelectorAll () { return [makeElement()] },
    addEventListener (ev, cb) {
      if (!listeners.has(ev)) listeners.set(ev, new Set())
      listeners.get(ev).add(cb)
    },
    removeEventListener (ev, cb) {
      const set = listeners.get(ev)
      if (set) set.delete(cb)
    },
    dispatchEvent () { return true },
    setAttribute (k, v) { attrs.set(k, String(v)) },
    getAttribute (k) { return attrs.has(k) ? attrs.get(k) : null },
    removeAttribute (k) { attrs.delete(k) },
    hasAttribute (k) { return attrs.has(k) },
    appendChild (child) { return child },
    removeChild () {},
    cloneNode () { return makeElement() },
    focus () {},
    blur () {},
    click () {
      const set = listeners.get('click')
      if (set) for (const cb of set) try { cb({ target: el }) } catch (e) { console.error(e) }
    },
    children: [],
    childNodes: [],
    firstChild: null,
    firstElementChild: null,
    parentElement: null,
    parentNode: null,
    nextElementSibling: null,
    previousElementSibling: null,
    textContent: ''
  }
  function fire (event) {
    const set = listeners.get(event)
    if (!set) return
    for (const cb of set) {
      try { cb({ target: el, currentTarget: el }) } catch (e) { console.error('stub event handler:', e) }
    }
  }
  return el
}

class LocalStorageStub {
  constructor () { this._map = new Map() }
  getItem (k) { return this._map.has(k) ? this._map.get(k) : null }
  setItem (k, v) { this._map.set(k, String(v)) }
  removeItem (k) { this._map.delete(k) }
  clear () { this._map.clear() }
  get length () { return this._map.size }
  key (i) { return [...this._map.keys()][i] ?? null }
}

/**
 * Capture the real setTimeout BEFORE any monkey-patching so callers
 * (like the harness's per-game watchdog) can use it.
 */
export const realSetTimeout = globalThis.setTimeout.bind(globalThis)
export const realClearTimeout = globalThis.clearTimeout.bind(globalThis)

/**
 * Short-circuit setTimeout for in-game sleeps in the [minMs, maxMs]
 * band. Very short timers (< minMs) are left alone so Node's undici
 * fetch internals (which use 0-ms scheduling) aren't starved. Very
 * long timers (> maxMs) are assumed to be watchdogs and also pass
 * through.
 */
export function installFastTimers (minMs = 50, maxMs = 3100) {
  const origSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = (fn, ms, ...rest) => {
    if (typeof ms === 'number' && ms >= minMs && ms <= maxMs) {
      Promise.resolve().then(() => { try { fn(...rest) } catch (e) { console.error(e) } })
      return 0
    }
    return origSetTimeout(fn, ms, ...rest)
  }
}

/**
 * Replace `Math.random` with a Mulberry32 PRNG seeded by `seed`. Used by
 * the harness so v5.1's CPU AI (which still calls Math.random for play
 * weighting, coin calls, and onside picks) becomes deterministic
 * alongside the engine's seeded reducer.
 */
export function installSeededRandom (seed) {
  let state = (seed >>> 0) || 1
  globalThis.Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Pin Date.now to a fixed value. localSession.js seeds its rng base from
 * `Date.now() ^ Math.floor(Math.random() * 0xffffffff)` — once both are
 * deterministic, the entire engine + harness becomes reproducible.
 */
export function installFakeNow (fixed = 1700000000000) {
  globalThis.Date.now = () => fixed
}

export function setupDomStub () {
  const documentElement = makeElement('html')
  // documentElement.style needs setProperty for run.prepareHTML
  documentElement.style = {
    setProperty () {},
    getPropertyValue () { return '' },
    removeProperty () {}
  }
  const body = makeElement('body')
  documentElement.body = body

  const doc = {
    documentElement,
    body,
    head: makeElement('head'),
    querySelector () { return makeElement() },
    querySelectorAll () { return [makeElement()] },
    getElementById () { return makeElement() },
    createElement (tag) { return makeElement(tag) },
    createTextNode (text) {
      return { nodeType: 3, textContent: String(text), data: String(text) }
    },
    addEventListener () {},
    removeEventListener () {}
  }

  globalThis.document = doc
  globalThis.window = globalThis.window || {}
  globalThis.window.addEventListener = () => {}
  globalThis.window.removeEventListener = () => {}
  globalThis.window.localStorage = new LocalStorageStub()

  globalThis.localStorage = globalThis.window.localStorage
  // Don't overwrite Node globals used by undici fetch / AbortController:
  //   Event, EventTarget, Node (some versions), AbortSignal
  // Only define if missing, and don't touch navigator (read-only in Node 22+).
  if (!globalThis.HTMLElement) globalThis.HTMLElement = class HTMLElement {}
  if (!globalThis.Element) globalThis.Element = class Element {}
  if (!globalThis.location) globalThis.location = { search: '', protocol: 'http:', host: 'localhost:3000', port: '3000' }
}
