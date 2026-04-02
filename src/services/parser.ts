import type { PriceEvent, BinanceCombinedMessage, RawBinanceTicker } from '../core/types.ts'

// Pure transformation layer. Knows Binance wire format; nothing else in the system needs to.
// Returns null on any malformed input so callers can skip/log without crashing.

function parseTicker(raw: RawBinanceTicker): PriceEvent | null {
  const price = parseFloat(raw.c)
  const change24h = parseFloat(raw.P)

  if (!raw.s || isNaN(price) || isNaN(change24h)) {
    return null
  }

  return {
    symbol: raw.s,
    price,
    change24h,
    timestamp: raw.E,
  }
}

export function parse(data: unknown): PriceEvent | null {
  if (typeof data !== 'object' || data === null) return null

  // Combined stream envelope: { stream: "btcusdt@ticker", data: {...} }
  if ('stream' in data && 'data' in data) {
    const combined = data as BinanceCombinedMessage
    return parseTicker(combined.data)
  }

  // Raw single-stream message
  if ('s' in data && 'c' in data && 'P' in data && 'E' in data) {
    return parseTicker(data as RawBinanceTicker)
  }

  return null
}
