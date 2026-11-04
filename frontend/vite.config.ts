import { networkInterfaces } from 'node:os'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * This machine's address on the local network, so a join link / QR code made on a page opened as "localhost"
 * still works on a phone. Skips loopback and virtual interfaces (Docker, bridges, VPN tunnels).
 */
function lanHost(): string {
  const virtual = /^(docker|br-|veth|virbr|vmnet|vboxnet|tun|tap|wg|tailscale|zt|lo)/
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (virtual.test(name)) continue
    const v4 = addrs?.find((a) => a.family === 'IPv4' && !a.internal)
    if (v4) return v4.address
  }
  return ''
}

export default defineConfig({
  plugins: [react()],
  define: {
    // VITE_JOIN_ORIGIN (e.g. http://192.168.1.5:5173) overrides the detected address.
    'import.meta.env.VITE_LAN_HOST': JSON.stringify(lanHost()),
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
})
