import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Configurations } from './pages/Configurations'
import { DevPlayground } from './pages/DevPlayground'
import { DomainFolding } from './pages/DomainFolding'
import { Intro } from './pages/Intro'
import { Labeling } from './pages/Labeling'
import { Lobby } from './pages/Lobby'
import { Placeholder } from './pages/Placeholder'
import { PropagatedErrors } from './pages/PropagatedErrors'
import { QualityFolding } from './pages/QualityFolding'
import { SessionProvider } from './session/SessionProvider'
import { PAGES } from './routes'

const queryClient = new QueryClient()

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/lobby" replace />} />
        <Route path="/lobby" element={<Lobby />} />
        <Route path="/dev" element={<DevPlayground />} />
        <Route path="/intro" element={<Intro />} />
        <Route path="/configuration" element={<Configurations />} />
        <Route path="/domain-folding" element={<DomainFolding />} />
        <Route path="/quality-folding" element={<QualityFolding />} />
        <Route path="/labeling" element={<Labeling />} />
        <Route path="/propagated-errors" element={<PropagatedErrors />} />
        {PAGES.filter((p) => !['/lobby', '/intro', '/configuration', '/domain-folding', '/quality-folding', '/labeling', '/propagated-errors'].includes(p.path)).map((p) => (
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
