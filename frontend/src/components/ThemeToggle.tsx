import { useState } from 'react'
import { useT } from '../i18n'
import { storedTheme, setTheme, THEME_ORDER, type ThemePref } from '../lib/theme'

export function ThemeToggle() {
  const [pref, set] = useState<ThemePref>(() => storedTheme())
  const common = useT().common
  const names: Record<ThemePref, string> = {
    system: common.themeSystem,
    light: common.themeLight,
    dark: common.themeDark,
  }
  const next = THEME_ORDER[(THEME_ORDER.indexOf(pref) + 1) % THEME_ORDER.length]
  const label = `${common.theme}: ${names[pref]}`
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={label}
      title={`${label} → ${names[next]}`}
      onClick={() => {
        setTheme(next)
        set(next)
      }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {pref === 'light' ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        ) : pref === 'dark' ? (
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        ) : (
          <>
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path d="M8 20h8M12 16v4" />
          </>
        )}
      </svg>
    </button>
  )
}
