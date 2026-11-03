export interface Page {
  path: string
  title: string
}

// Flow order of the original Streamlit app.
export const PAGES: Page[] = [
  { path: '/lobby', title: 'Lobby' },
  { path: '/intro', title: 'InputOutput' },
  { path: '/configuration', title: 'Configurations' },
  { path: '/domain-folding', title: 'DomainBasedFolding' },
  { path: '/quality-folding', title: 'QualityBasedFolding' },
  { path: '/labeling', title: 'Labeling' },
  { path: '/error-detection', title: 'ErrorDetection' },
  { path: '/propagated-errors', title: 'PropagatedErrors' },
  { path: '/results', title: 'Results' },
]
