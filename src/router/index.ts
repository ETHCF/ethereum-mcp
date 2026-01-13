/**
 * Router Layer - Smart API routing with fallbacks
 *
 * This module provides intelligent routing between data sources with:
 * - Primary/fallback chains for redundancy
 * - Circuit breaker pattern for failed sources
 * - Health monitoring
 * - Cross-source result normalization
 */

import * as etherscan from '../adapters/etherscan.js';
import * as defillama from '../adapters/defillama.js';
import * as coingecko from '../adapters/coingecko.js';
import * as growthepie from '../adapters/growthepie.js';
import * as blobscan from '../adapters/blobscan.js';

// ============================================
// CIRCUIT BREAKER
// ============================================

interface CircuitState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
}

const FAILURE_THRESHOLD = 3; // Open circuit after 3 consecutive failures
const RECOVERY_TIME = 60 * 1000; // Try again after 60 seconds

const circuitBreakers: Map<string, CircuitState> = new Map();

function getCircuit(source: string): CircuitState {
  if (!circuitBreakers.has(source)) {
    circuitBreakers.set(source, { failures: 0, lastFailure: 0, isOpen: false });
  }
  return circuitBreakers.get(source)!;
}

function recordSuccess(source: string): void {
  const circuit = getCircuit(source);
  circuit.failures = 0;
  circuit.isOpen = false;
}

function recordFailure(source: string): void {
  const circuit = getCircuit(source);
  circuit.failures++;
  circuit.lastFailure = Date.now();
  if (circuit.failures >= FAILURE_THRESHOLD) {
    circuit.isOpen = true;
  }
}

function isCircuitOpen(source: string): boolean {
  const circuit = getCircuit(source);
  if (!circuit.isOpen) return false;

  // Check if recovery time has passed
  if (Date.now() - circuit.lastFailure > RECOVERY_TIME) {
    circuit.isOpen = false; // Half-open: allow one request through
    return false;
  }
  return true;
}

export function getCircuitStatus(): Record<string, { isOpen: boolean; failures: number }> {
  const status: Record<string, { isOpen: boolean; failures: number }> = {};
  for (const [source, state] of circuitBreakers) {
    status[source] = { isOpen: state.isOpen, failures: state.failures };
  }
  return status;
}

// ============================================
// FALLBACK EXECUTOR
// ============================================

interface FallbackOptions<T> {
  sources: Array<{
    name: string;
    fn: () => Promise<T>;
  }>;
  validate?: (result: T) => boolean;
}

async function executeWithFallback<T>(options: FallbackOptions<T>): Promise<{
  result: T;
  source: string;
  fallbacksUsed: number;
}> {
  const errors: Array<{ source: string; error: string }> = [];

  for (let i = 0; i < options.sources.length; i++) {
    const { name, fn } = options.sources[i];

    // Skip if circuit is open
    if (isCircuitOpen(name)) {
      errors.push({ source: name, error: 'Circuit breaker open' });
      continue;
    }

    try {
      const result = await fn();

      // Validate result if validator provided
      if (options.validate && !options.validate(result)) {
        throw new Error('Validation failed');
      }

      recordSuccess(name);
      return { result, source: name, fallbacksUsed: i };
    } catch (error: any) {
      recordFailure(name);
      errors.push({ source: name, error: error.message || String(error) });
    }
  }

  // All sources failed
  const errorSummary = errors.map((e) => `${e.source}: ${e.error}`).join('; ');
  throw new Error(`All sources failed: ${errorSummary}`);
}

// ============================================
// PRICE ROUTING
// ============================================

export interface PriceResult {
  price: number;
  currency: string;
  source: string;
  change24h?: number;
  marketCap?: number;
  fallbacksUsed: number;
}

interface NormalizedPrice {
  price: number;
  currency: string;
  change24h?: number;
  marketCap?: number;
}

/**
 * Get ETH price with fallback chain: Etherscan → CoinGecko → DefiLlama
 */
export async function getEthPrice(): Promise<PriceResult> {
  const { result, source, fallbacksUsed } = await executeWithFallback<NormalizedPrice>({
    sources: [
      {
        name: 'etherscan',
        fn: async () => {
          const data = await etherscan.getEthPrice();
          return {
            price: data.usd,
            currency: 'USD',
            change24h: undefined,
            marketCap: undefined,
          };
        },
      },
      {
        name: 'coingecko',
        fn: async () => {
          const data = await coingecko.getPrice('ethereum');
          // CoinGecko returns { ethereum: { usd: 3000, usd_24h_change: 1.5, ... } }
          const ethData = data['ethereum'];
          if (!ethData) throw new Error('No data returned');
          return {
            price: ethData.usd || ethData['usd'],
            currency: 'USD',
            change24h: ethData.usd_24h_change || ethData['usd_24h_change'],
            marketCap: ethData.usd_market_cap || ethData['usd_market_cap'],
          };
        },
      },
      {
        name: 'defillama',
        fn: async () => {
          const data = await defillama.getCoinPrices('coingecko:ethereum');
          const coins = data.coins || data;
          const coin = Object.values(coins)[0] as any;
          if (!coin?.price) throw new Error('No price data');
          return {
            price: coin.price,
            currency: 'USD',
            change24h: undefined,
            marketCap: undefined,
          };
        },
      },
    ],
    validate: (r) => r.price > 0,
  });

  return { ...result, source, fallbacksUsed };
}

/**
 * Get token price with smart routing:
 * - By name: CoinGecko → DefiLlama
 * - By contract: DefiLlama → CoinGecko
 */
export async function getTokenPrice(
  token: string,
  chain: string = 'ethereum'
): Promise<PriceResult> {
  const isContract = token.startsWith('0x') && token.length === 42;

  if (isContract) {
    // Contract address: DefiLlama first (native format)
    const { result, source, fallbacksUsed } = await executeWithFallback<NormalizedPrice>({
      sources: [
        {
          name: 'defillama',
          fn: async () => {
            const data = await defillama.getCoinPrices(`${chain}:${token}`);
            const coins = data.coins || data;
            const coin = Object.values(coins)[0] as any;
            if (!coin?.price) throw new Error('Token not found');
            return {
              price: coin.price,
              currency: 'USD',
              change24h: undefined,
              marketCap: undefined,
            };
          },
        },
        {
          name: 'coingecko',
          fn: async () => {
            const data = await coingecko.getTokenPriceByContract(chain, token);
            if (!data?.usd) throw new Error('Token not found');
            return {
              price: data.usd,
              currency: 'USD',
              change24h: data.usd_24h_change,
              marketCap: data.usd_market_cap,
            };
          },
        },
      ],
      validate: (r) => r.price > 0,
    });
    return { ...result, source, fallbacksUsed };
  } else {
    // Token name: CoinGecko first (better name resolution)
    const { result, source, fallbacksUsed } = await executeWithFallback<NormalizedPrice>({
      sources: [
        {
          name: 'coingecko',
          fn: async () => {
            const tokenId = token.toLowerCase();
            const data = await coingecko.getPrice(tokenId);
            // CoinGecko returns { [tokenId]: { usd: ..., usd_24h_change: ..., ... } }
            const tokenData = data[tokenId];
            if (!tokenData?.usd) throw new Error('Token not found');
            return {
              price: tokenData.usd,
              currency: 'USD',
              change24h: tokenData.usd_24h_change,
              marketCap: tokenData.usd_market_cap,
            };
          },
        },
        {
          name: 'defillama',
          fn: async () => {
            // Try common token mappings for DefiLlama
            const mappings: Record<string, string> = {
              bitcoin: 'coingecko:bitcoin',
              btc: 'coingecko:bitcoin',
              ethereum: 'coingecko:ethereum',
              eth: 'coingecko:ethereum',
              usdc: 'ethereum:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
              usdt: 'ethereum:0xdAC17F958D2ee523a2206206994597C13D831ec7',
              dai: 'ethereum:0x6B175474E89094C44Da98b954EesadadcD732172601',
            };
            const key = mappings[token.toLowerCase()] || `coingecko:${token.toLowerCase()}`;
            const data = await defillama.getCoinPrices(key);
            const coins = data.coins || data;
            const coin = Object.values(coins)[0] as any;
            if (!coin?.price) throw new Error('Token not found');
            return {
              price: coin.price,
              currency: 'USD',
              change24h: undefined,
              marketCap: undefined,
            };
          },
        },
      ],
      validate: (r) => r.price > 0,
    });
    return { ...result, source, fallbacksUsed };
  }
}

// ============================================
// TVL ROUTING
// ============================================

export interface TvlResult {
  tvl: number;
  source: string;
  fallbacksUsed: number;
  breakdown?: Record<string, number>;
}

interface NormalizedTvl {
  tvl: number;
  breakdown?: Record<string, number>;
}

/**
 * Get L2 TVL with fallback: growthepie → DefiLlama
 */
export async function getL2Tvl(chain: string): Promise<TvlResult> {
  const normalizedChain = chain.toLowerCase();

  const { result, source, fallbacksUsed } = await executeWithFallback<NormalizedTvl>({
    sources: [
      {
        name: 'growthepie',
        fn: async () => {
          const data = await growthepie.getL2Chain(normalizedChain);
          if (!data?.tvl) throw new Error('Chain not found');
          return {
            tvl: data.tvl,
            breakdown: undefined,
          };
        },
      },
      {
        name: 'defillama',
        fn: async () => {
          const chains = await defillama.getChains();
          const chainData = chains.find((c: any) => c.name.toLowerCase() === normalizedChain);
          if (!chainData?.tvl) throw new Error('Chain not found');
          return {
            tvl: chainData.tvl,
            breakdown: undefined,
          };
        },
      },
    ],
    validate: (r) => r.tvl >= 0,
  });

  return { ...result, source, fallbacksUsed };
}

/**
 * Get protocol TVL (DefiLlama only - authoritative source)
 */
export async function getProtocolTvl(protocol: string): Promise<TvlResult> {
  const data = await defillama.getProtocolTvl(protocol);
  return {
    tvl: data,
    source: 'defillama',
    fallbacksUsed: 0,
  };
}

// ============================================
// BLOB DATA ROUTING
// ============================================

export interface BlobStatsResult {
  recentBlobCount: number;
  avgBlobSize: number;
  source: string;
  fallbacksUsed: number;
}

interface NormalizedBlobStats {
  recentBlobCount: number;
  avgBlobSize: number;
}

/**
 * Get blob stats with fallback: Blobscan → growthepie
 */
export async function getBlobStats(): Promise<BlobStatsResult> {
  const { result, source, fallbacksUsed } = await executeWithFallback<NormalizedBlobStats>({
    sources: [
      {
        name: 'blobscan',
        fn: async () => {
          const stats = await blobscan.getBlobStats();
          return {
            recentBlobCount: stats.recentBlobCount || 0,
            avgBlobSize: stats.avgBlobSize || 0,
          };
        },
      },
      {
        name: 'growthepie',
        fn: async () => {
          const data = await growthepie.getBlobData();
          // Aggregate from L2 blob data
          const totalBlobs = data.reduce((sum: number, d: any) => sum + (d.blob_count || 0), 0);
          return {
            recentBlobCount: totalBlobs,
            avgBlobSize: 128 * 1024, // Standard blob size
          };
        },
      },
    ],
    validate: (r) => r.recentBlobCount >= 0,
  });

  return { ...result, source, fallbacksUsed };
}

// ============================================
// HEALTH CHECK
// ============================================

export interface HealthStatus {
  source: string;
  healthy: boolean;
  latencyMs: number;
  error?: string;
}

export async function checkHealth(): Promise<HealthStatus[]> {
  const checks = [
    {
      source: 'etherscan',
      fn: () => etherscan.getBlockNumber(),
    },
    {
      source: 'defillama',
      fn: () => defillama.getChains(),
    },
    {
      source: 'coingecko',
      fn: () => coingecko.getGlobalData(),
    },
    {
      source: 'growthepie',
      fn: () => growthepie.listChains(),
    },
    {
      source: 'blobscan',
      fn: () => blobscan.getLatestBlock(),
    },
  ];

  const results: HealthStatus[] = [];

  for (const check of checks) {
    const start = Date.now();
    try {
      await check.fn();
      results.push({
        source: check.source,
        healthy: true,
        latencyMs: Date.now() - start,
      });
    } catch (error: any) {
      results.push({
        source: check.source,
        healthy: false,
        latencyMs: Date.now() - start,
        error: error.message || String(error),
      });
    }
  }

  return results;
}

// ============================================
// COMPARE SOURCES (Debug tool)
// ============================================

export interface SourceComparison {
  query: string;
  results: Array<{
    source: string;
    value: any;
    latencyMs: number;
    error?: string;
  }>;
}

export async function compareEthPrice(): Promise<SourceComparison> {
  const results: SourceComparison['results'] = [];

  // Etherscan
  const ethStart = Date.now();
  try {
    const data = await etherscan.getEthPrice();
    results.push({
      source: 'etherscan',
      value: data.usd,
      latencyMs: Date.now() - ethStart,
    });
  } catch (e: any) {
    results.push({
      source: 'etherscan',
      value: null,
      latencyMs: Date.now() - ethStart,
      error: e.message,
    });
  }

  // CoinGecko
  const cgStart = Date.now();
  try {
    const data = await coingecko.getPrice('ethereum');
    const ethData = data['ethereum'];
    results.push({
      source: 'coingecko',
      value: ethData?.usd || null,
      latencyMs: Date.now() - cgStart,
    });
  } catch (e: any) {
    results.push({
      source: 'coingecko',
      value: null,
      latencyMs: Date.now() - cgStart,
      error: e.message,
    });
  }

  // DefiLlama
  const dlStart = Date.now();
  try {
    const data = await defillama.getCoinPrices('coingecko:ethereum');
    const coins = data.coins || data;
    const coin = Object.values(coins)[0] as any;
    results.push({
      source: 'defillama',
      value: coin?.price || null,
      latencyMs: Date.now() - dlStart,
    });
  } catch (e: any) {
    results.push({
      source: 'defillama',
      value: null,
      latencyMs: Date.now() - dlStart,
      error: e.message,
    });
  }

  return { query: 'ETH Price (USD)', results };
}
