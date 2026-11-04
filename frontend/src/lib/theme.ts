/** Appearance preference: follow the OS (default) or force light/dark. */
export type ThemePref = 'system' | 'light' | 'dark'
const KEY = 'matelda-theme'

export const THEME_ORDER: ThemePref[] = ['system', 'light', 'dark']

export function storedTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

/** Apply and remember a preference. 'system' removes the override so CSS follows the OS. */
export function setTheme(pref: ThemePref) {
  if (pref === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = pref
  try {
    if (pref === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch {
    /* storage unavailable: choice lasts for this page view */
  }
}
