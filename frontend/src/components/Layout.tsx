import { Outlet, useLocation } from 'react-router-dom'
import { StepTracker } from './StepTracker'
import { TopBar } from './TopBar'

export function Layout() {
  const { pathname } = useLocation()
  return (
    <>
      <TopBar />
      <StepTracker currentPath={pathname} />
      <main className="page">
        <Outlet />
      </main>
    </>
  )
}
