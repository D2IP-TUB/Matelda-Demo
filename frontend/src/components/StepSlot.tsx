import { createContext, useContext } from 'react'

/**
 * The step tracker lives in the floating Back/Continue bar of each page. A page's bar renders a <StepSlot />;
 * Layout hands the tracker to whichever slot is on screen (or shows it at the top when the page has none).
 */
export const StepSlotContext = createContext<(el: HTMLElement | null) => void>(() => {})

export function StepSlot() {
  const register = useContext(StepSlotContext)
  return <div className="bar-steps" ref={register} />
}
