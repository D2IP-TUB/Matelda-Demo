import '@testing-library/jest-dom/vitest'
import { MotionGlobalConfig } from 'motion/react'

// Finish animations immediately so tests see the end state.
MotionGlobalConfig.skipAnimations = true
