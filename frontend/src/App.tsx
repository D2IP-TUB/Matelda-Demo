import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { Placeholder } from './pages/Placeholder'
import { SessionProvider } from './session/SessionProvider'
import { PAGES } from './routes'

const queryClient = new QueryClient()

export function AppRoutes() {
  return (
    <>
      <nav style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        {PAGES.map((p) => (
          <Link key={p.path} to={p.path}>
            {p.title}
          </Link>
        ))}
      </nav>
      <Routes>
        <Route path="/" element={<Navigate to="/lobby" replace />} />
        {PAGES.map((p) => (
          <Route key={p.path} path={p.path} element={<Placeholder title={p.title} />} />
        ))}
      </Routes>
    </>
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
