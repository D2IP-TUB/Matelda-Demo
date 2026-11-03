// crypto.randomUUID() is unavailable on plain-http LAN origins; getRandomValues is not.
export function randomToken(bytes = 12): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}
