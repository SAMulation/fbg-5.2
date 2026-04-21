/* global location */
/**
 * fbgLog — namespaced, URL-gated console logging.
 *
 * Usage:
 *   import { fbgLog } from './log.js'
 *   fbgLog('driver', 'phase=', state.phase)
 *
 * Enable by URL:
 *   ?log=driver                   // just 'driver'
 *   ?log=driver,input,channel     // multiple
 *   ?log=*                        // everything
 *
 * In headless harness contexts where there's no location, call
 * `setFbgLogNamespaces('driver,input')` at startup.
 */

let enabled = new Set()

function parseFromQuery () {
  try {
    const m = (typeof location !== 'undefined' ? location.search : '')
      .match(/[?&]log=([^&]+)/)
    if (!m) return new Set()
    return new Set(decodeURIComponent(m[1]).split(',').map((s) => s.trim()).filter(Boolean))
  } catch {
    return new Set()
  }
}

enabled = parseFromQuery()

export function setFbgLogNamespaces (spec) {
  if (typeof spec === 'string') {
    enabled = new Set(spec.split(',').map((s) => s.trim()).filter(Boolean))
  } else if (spec instanceof Set) {
    enabled = new Set(spec)
  } else if (Array.isArray(spec)) {
    enabled = new Set(spec)
  }
}

export function fbgLogEnabled (ns) {
  return enabled.has('*') || enabled.has(ns)
}

export function fbgLog (ns, ...args) {
  if (fbgLogEnabled(ns)) console.log('[' + ns + ']', ...args)
}
