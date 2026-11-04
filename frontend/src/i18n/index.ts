import { useSyncExternalStore } from 'react'
import { de } from './de'
import { en, type Messages } from './en'

export type Lang = 'en' | 'de'
export const LANG_KEY = 'matelda-lang'

const messages: Record<Lang, Messages> = { en, de }
const listeners = new Set<() => void>()

export function getLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'de' ? 'de' : 'en'
  } catch {
    return 'en'
  }
}

// Storage can be unavailable; keep the choice for this page view then.
let current: Lang = getLang()

export function setLang(lang: Lang): void {
  current = lang
  try {
    localStorage.setItem(LANG_KEY, lang)
  } catch {
    /* storage unavailable: choice lasts for this page view */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang
  listeners.forEach((l) => l())
}

if (typeof document !== 'undefined' && current === 'de') document.documentElement.lang = 'de'

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, () => current)
}

export function useT(): Messages {
  return messages[useLang()]
}

export function t(): Messages {
  return messages[current]
}
