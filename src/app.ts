// Composition root — instantiates and wires all modules, then starts the server.
// Nothing here contains business logic; it only knows how to assemble and tear down.

import { PriceEventQueue } from './core/queue.ts'
import { createLogger } from './core/logger.ts'

import { PriceStore } from './services/store.ts'
import { BinanceListener } from './services/binance.listener.ts'
import { Broadcaster } from './services/broadcaster.ts'

import { ClientManager } from './ws/clientManager.ts'
import { WsServer } from './ws/server.ts'

import { createPriceController } from './api/price.controller.ts'

const log = createLogger('app')

const PORT = parseInt(process.env['PORT'] ?? '8000', 10)

async function main(): Promise<void> {
  // 1. Core event bus
  const queue = new PriceEventQueue()

  // 2. Consumers subscribe before the producer starts (no lost events)
  const store = new PriceStore(queue)
  const clientManager = new ClientManager()
  const broadcaster = new Broadcaster(queue, clientManager)

  // 3. HTTP + WebSocket server
  const httpHandler = createPriceController(store, {
    getUptimeSeconds: () => Math.floor(process.uptime()),
    getMessageCount: () => broadcaster.totalMessageCount,
  })
  const server = new WsServer(clientManager, httpHandler)
  await server.listen(PORT)

  // 4. Start ingestion last — connections are ready to receive
  const listener = new BinanceListener(queue)
  listener.start()

  // 5. Graceful shutdown
  // Guard: if shutdown takes longer than SHUTDOWN_TIMEOUT_MS the process is
  // force-killed. This prevents the server hanging forever when clients remain
  // connected between closeAll() and server.close() completing.
  const SHUTDOWN_TIMEOUT_MS = 10_000
  let shuttingDown = false

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return // idempotent — multiple signals in flight
    shuttingDown = true

    log.info('Shutdown initiated', { signal })

    // Hard deadline: whatever state we're in, exit after the timeout.
    const forceExit = setTimeout(() => {
      log.error('Shutdown timed out; forcing exit')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)
    // Do not let this timer keep the event loop alive past natural completion.
    forceExit.unref()

    // Stop accepting new Binance data
    listener.close()

    // Disconnect all WebSocket clients cleanly before closing the server.
    // This ensures httpServer.close() completes immediately rather than waiting
    // for lingering upgraded connections to drain.
    clientManager.closeAll()

    // Stop HTTP + WS server (stops new connections and existing upgrades)
    try {
      await server.close()
    } catch (err) {
      log.error('Error closing server', { error: String(err) })
    }

    clearTimeout(forceExit)
    log.info('Shutdown complete')
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  process.on('uncaughtException', err => {
    log.error('Uncaught exception', { error: err.message, stack: err.stack })
    void shutdown('uncaughtException')
  })

  // Treat unhandled promise rejections as fatal — identical to uncaughtException.
  // Logging and swallowing them leaves the process in an undefined state.
  process.on('unhandledRejection', reason => {
    log.error('Unhandled rejection', { reason: String(reason) })
    void shutdown('unhandledRejection')
  })
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  process.stderr.write(JSON.stringify({ level: 'error', service: 'app', message }) + '\n')
  process.exit(1)
})
