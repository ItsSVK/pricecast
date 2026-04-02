// Normalized internal price event — the canonical shape used across the entire service.
export type PriceEvent = {
  symbol: string
  price: number
  change24h: number
  timestamp: number
}

// Typed representation of the relevant fields from Binance @ticker stream payload.
export type RawBinanceTicker = {
  s: string // symbol
  c: string // last price
  P: string // 24h price change percent
  E: number // event time (ms) — present in @ticker; T (trade time) is NOT in this stream
  e: string // event type (should be "24hrTicker")
}

// Combined stream wrapper when using /stream?streams=... endpoint.
export type BinanceCombinedMessage = {
  stream: string
  data: RawBinanceTicker
}

export const SUPPORTED_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'] as const
export type SupportedSymbol = (typeof SUPPORTED_SYMBOLS)[number]
