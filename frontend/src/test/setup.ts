import '@testing-library/jest-dom/vitest'
import { MotionGlobalConfig } from 'motion/react'
import { afterEach } from 'vitest'
import { setLang } from '../i18n'

// Finish animations immediately so tests see the end state.
MotionGlobalConfig.skipAnimations = true

afterEach(() => {
  setLang('en')
  localStorage.removeItem('matelda-lang')
})
