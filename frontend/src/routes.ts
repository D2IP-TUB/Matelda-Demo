export interface Page {
  path: string
  title: string
}

// Step order of the Streamlit sidebar.
export const PAGES: Page[] = [
  { path: '/lobby', title: 'Lobby' },
  { path: '/intro', title: 'Intro' },
  { path: '/configuration', title: 'Configurations' },
  { path: '/domain-folding', title: 'Domain Folding' },
  { path: '/quality-folding', title: 'Quality Folding' },
  { path: '/labeling', title: 'Labeling' },
  { path: '/propagated-errors', title: 'Propagated Errors' },
  { path: '/error-detection', title: 'Error Detection' },
  { path: '/results', title: 'Results' },
]

export function stepIndex(path: string): number {
  return PAGES.findIndex((p) => p.path === path)
}

export function pageTitle(path: string): string {
  return PAGES.find((p) => p.path === path)?.title ?? ''
}
