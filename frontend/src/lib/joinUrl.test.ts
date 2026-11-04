import { joinOrigin } from './joinUrl'

const at = (hostname: string, port = '5173', protocol = 'http:') => ({
  protocol, hostname, port, origin: `${protocol}//${hostname}${port ? `:${port}` : ''}`,
})

describe('joinOrigin', () => {
  it('swaps localhost for the network address, keeping the port', () => {
    expect(joinOrigin(at('localhost'), undefined, '192.168.1.5')).toBe('http://192.168.1.5:5173')
    expect(joinOrigin(at('127.0.0.1'), undefined, '192.168.1.5')).toBe('http://192.168.1.5:5173')
    expect(joinOrigin(at('[::1]'), undefined, '192.168.1.5')).toBe('http://192.168.1.5:5173')
  })

  it('keeps the address the page was opened with when it already works for others', () => {
    expect(joinOrigin(at('192.168.1.9'), undefined, '192.168.1.5')).toBe('http://192.168.1.9:5173')
    expect(joinOrigin(at('matelda.example.org', '', 'https:'), undefined, '192.168.1.5')).toBe('https://matelda.example.org')
  })

  it('stays on localhost when no network address is known', () => {
    expect(joinOrigin(at('localhost'), undefined, '')).toBe('http://localhost:5173')
  })

  it('uses VITE_JOIN_ORIGIN when set', () => {
    expect(joinOrigin(at('localhost'), 'http://10.0.0.2:5173/', '192.168.1.5')).toBe('http://10.0.0.2:5173')
  })
})
