const LOOPBACK = /^(localhost|127(\.\d+){3}|\[::1\]|::1)$/

interface Where {
  protocol: string
  hostname: string
  port: string
  origin: string
}

/**
 * The origin other devices should use to reach this app. A page opened as localhost would hand out a link that
 * only works on this computer, so then the machine's network address is used instead (detected when the dev
 * server starts, or set with VITE_JOIN_ORIGIN).
 */
export function joinOrigin(
  where: Where = window.location,
  override: string | undefined = import.meta.env.VITE_JOIN_ORIGIN,
  lanHost: string | undefined = import.meta.env.VITE_LAN_HOST,
): string {
  if (override) return override.replace(/\/+$/, '')
  if (!LOOPBACK.test(where.hostname) || !lanHost) return where.origin
  return `${where.protocol}//${lanHost}${where.port ? `:${where.port}` : ''}`
}

/** The link that drops someone straight into a room's lobby. */
export const joinUrl = (room: string) => `${joinOrigin()}/lobby?room=${encodeURIComponent(room)}`
