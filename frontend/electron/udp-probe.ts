import dgram from 'node:dgram'

export interface UdpFrame {
  hex: string
  size: number
  time: number
}

export interface UdpProbe {
  start(onFrame: (frame: UdpFrame) => void): void
  stop(): void
}

export function createUdpProbe(port = 4000, host = '127.0.0.1'): UdpProbe {
  let socket: dgram.Socket | null = null

  const start = (onFrame: (frame: UdpFrame) => void) => {
    if (socket) return
    socket = dgram.createSocket('udp4')
    socket.on('message', (msg) => {
      onFrame({
        hex: Array.from(msg).map((b) => b.toString(16).padStart(2, '0')).join(' '),
        size: msg.length,
        time: Date.now(),
      })
    })
    socket.bind(port, host)
  }

  const stop = () => {
    if (!socket) return
    socket.close()
    socket = null
  }

  return { start, stop }
}
