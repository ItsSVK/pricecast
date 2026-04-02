import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { WebSocketServer } from 'ws'
import type { ClientManager } from './clientManager.ts'
import { IpRateLimiter } from './rateLimiter.ts'
import { createLogger } from '../core/logger.ts'

const log = createLogger('ws-server')

const WS_PATH = '/ws'

// Seconds to advertise in Retry-After; matches the refill interval default.
const RETRY_AFTER_SEC = parseInt(process.env['RL_REFILL_INTERVAL_MS'] ?? '10000', 10) / 1000

export class WsServer {
  private readonly httpServer
  private readonly wss: WebSocketServer
  private readonly rateLimiter = new IpRateLimiter()

  constructor(
    private readonly clientManager: ClientManager,
    private readonly httpHandler: (req: IncomingMessage, res: ServerResponse) => void,
  ) {
    this.httpServer = createServer(this.httpHandler)

    // noServer: we own the upgrade event to restrict the accepted path.
    this.wss = new WebSocketServer({ noServer: true })

    this.httpServer.on('upgrade', (req, socket, head) => {
      const { pathname } = new URL(req.url ?? '/', 'http://localhost')

      if (pathname !== WS_PATH) {
        socket.destroy()
        return
      }

      // Rate-limit check happens here — before the WebSocket upgrade — so we
      // can still send a valid HTTP 429 response the client can parse.
      const ip = req.socket.remoteAddress ?? 'unknown'
      if (!this.rateLimiter.consume(ip)) {
        this.rateLimiter.reject(socket, RETRY_AFTER_SEC)
        return
      }

      this.wss.handleUpgrade(req, socket, head, ws => {
        this.wss.emit('connection', ws, req)
      })
    })

    this.wss.on('connection', (ws, req) => {
      const ip = req.socket.remoteAddress ?? 'unknown'
      const id = this.clientManager.register(ws)
      if (id === null) {
        // register() already sent close(1013) — nothing more to do here.
        log.warn('WebSocket connection rejected (limit)', { ip })
        return
      }
      log.info('WebSocket upgrade accepted', { ip, id })
    })

    this.wss.on('error', err => {
      log.error('WebSocketServer error', { error: err.message })
    })
  }

  listen(port: number): Promise<void> {
    return new Promise(resolve => {
      this.httpServer.listen(port, () => {
        log.info(`Server listening`, {
          port,
          wsPath: WS_PATH,
          restPath: '/price',
        })
        resolve()
      })
    })
  }

  close(): Promise<void> {
    this.rateLimiter.destroy()
    return new Promise((resolve, reject) => {
      this.wss.close(() => {
        this.httpServer.close(err => {
          if (err) reject(err)
          else resolve()
        })
      })
    })
  }
}
