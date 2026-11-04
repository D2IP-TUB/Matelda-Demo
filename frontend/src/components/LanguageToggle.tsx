import { setLang, useLang, useT } from '../i18n'

export function LanguageToggle({ className }: { className?: string }) {
  const lang = useLang()
  const label = useT().common.langSwitchLabel
  const target = lang === 'en' ? 'de' : 'en'
  return (
    <button
      type="button"
      className={className ? `lang-toggle ${className}` : 'lang-toggle'}
      aria-label={label}
      title={label}
      onClick={() => setLang(target)}
    >
      {lang.toUpperCase()}
    </button>
  )
}
