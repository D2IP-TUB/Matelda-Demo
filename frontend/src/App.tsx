import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Configurations } from './pages/Configurations'
import { DevPlayground } from './pages/DevPlayground'
import { DomainFolding } from './pages/DomainFolding'
import { ErrorDetection } from './pages/ErrorDetection'
import { Labeling } from './pages/Labeling'
import { LabelingStats } from './pages/LabelingStats'
import { Landing } from './pages/Landing'
import { Lobby } from './pages/Lobby'
import { Placeholder } from './pages/Placeholder'
import { PropagatedErrors } from './pages/PropagatedErrors'
import { QualityFolding } from './pages/QualityFolding'
import { Results } from './pages/Results'
import { SessionProvider } from './session/SessionProvider'
import { PAGES } from './routes'

const queryClient = new QueryClient()

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route element={<Layout />}>
        <Route path="/lobby" element={<Lobby />} />
        <Route path="/dev" element={<DevPlayground />} />
        <Route path="/configuration" element={<Configurations />} />
        <Route path="/domain-folding" element={<DomainFolding />} />
        <Route path="/quality-folding" element={<QualityFolding />} />
        <Route path="/labeling" element={<Labeling />} />
        <Route path="/labeling-stats" element={<LabelingStats />} />
        <Route path="/propagated-errors" element={<PropagatedErrors />} />
        <Route path="/error-detection" element={<ErrorDetection />} />
        <Route path="/results" element={<Results />} />
        {PAGES.filter((p) => !['/lobby', '/configuration', '/domain-folding', '/quality-folding', '/labeling', '/labeling-stats', '/propagated-errors', '/error-detection', '/results'].includes(p.path)).map((p) => (
          <Route key={p.path} path={p.path} element={<Placeholder title={p.title} />} />
        ))}
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  )
}
