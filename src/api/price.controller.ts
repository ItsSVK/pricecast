import { readFileSync } from 'fs'
import { join } from 'path'
import type { IncomingMessage, ServerResponse } from 'http'
import type { PriceStore } from '../services/store.ts'
import { createLogger } from '../core/logger.ts'

const log = createLogger('rest-api')

const homePagePath = join(import.meta.dir, '../../public/index.html')

function loadHomePage(): string {
  return readFileSync(homePagePath, 'utf-8')
}

function send(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

// Handles:
//   GET /         → static dashboard (index.html)
//   GET /price    → all latest prices as JSON
//   GET /price?symbol=X → single symbol as JSON
//   everything else     → 404
export function createPriceController(store: PriceStore) {
  return function handler(req: IncomingMessage, res: ServerResponse): void {
    const { pathname, searchParams } = new URL(req.url ?? '/', 'http://localhost')

    if (req.method !== 'GET') {
      send(res, 404, 'application/json', JSON.stringify({ error: 'Not found' }))
      return
    }

    if (pathname === '/') {
      send(res, 200, 'text/html; charset=utf-8', loadHomePage())
      return
    }

    if (pathname !== '/price') {
      send(res, 404, 'application/json', JSON.stringify({ error: 'Not found' }))
      return
    }

    const symbol = searchParams.get('symbol')?.toUpperCase()

    if (symbol) {
      const event = store.get(symbol)
      if (!event) {
        log.warn('Symbol not found in store', { symbol })
        send(res, 404, 'application/json', JSON.stringify({ error: `No data for symbol: ${symbol}` }))
        return
      }
      send(res, 200, 'application/json', JSON.stringify(event))
      return
    }

    send(res, 200, 'application/json', JSON.stringify(store.getAll()))
  }
}
