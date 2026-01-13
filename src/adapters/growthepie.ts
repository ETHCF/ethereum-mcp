// growthepie API adapter (free, no key needed)
// L2 metrics and analytics
import { cachedFetch, TTL } from '../utils/cache.js';

const BASE_URL = 'https://api.growthepie.com/v1';

// Available metrics from the API
export const AVAILABLE_METRICS = [
  'daa', // Daily Active Addresses
  'fdv', // Fully Diluted Valuation
  'fees', // Fees Paid by Users
  'market_cap', // Market Cap
  'profit', // Onchain Profit
  'rent_paid', // Rent Paid to L1 (blob fees)
  'stables_mcap', // Stablecoin Market Cap
  'throughput', // Throughput
  'tvl', // Total Value Secured
  'txcosts', // Median Transaction Costs
  'txcount', // Transaction Count
] as const;

export type MetricKey = (typeof AVAILABLE_METRICS)[number];

async function request(endpoint: string): Promise<any> {
  const response = await fetch(`${BASE_URL}${endpoint}`);
  if (!response.ok) {
    throw new Error(`growthepie API error: ${response.statusText}`);
  }
  return response.json();
}

// Process flat array into chain -> metrics map
function processData(data: any[]): Map<string, Map<string, number>> {
  const chainMetrics = new Map<string, Map<string, number>>();
  const latestDates = new Map<string, string>();

  // Find latest date for each chain/metric combo
  for (const item of data) {
    const key = `${item.origin_key}_${item.metric_key}`;
    if (!latestDates.has(key) || item.date > latestDates.get(key)!) {
      latestDates.set(key, item.date);
    }
  }

  // Extract latest values
  for (const item of data) {
    const key = `${item.origin_key}_${item.metric_key}`;
    if (item.date === latestDates.get(key)) {
      if (!chainMetrics.has(item.origin_key)) {
        chainMetrics.set(item.origin_key, new Map());
      }
      chainMetrics.get(item.origin_key)!.set(item.metric_key, item.value);
    }
  }

  return chainMetrics;
}

// ============================================
// CORE ENDPOINTS
// ============================================

// Get master data (chain metadata)
export async function getMaster(noCache = false): Promise<any> {
  return cachedFetch('growthepie:master', TTL.STATIC, () => request('/master.json'), noCache);
}

// Get fundamentals data (cached)
async function getFundamentals(noCache = false): Promise<Map<string, Map<string, number>>> {
  const data = await cachedFetch(
    'growthepie:fundamentals',
    TTL.TVL,
    () => request('/fundamentals.json'),
    noCache
  );
  return processData(data);
}

// Get specific metric data with historical values
export async function getMetricData(metric: MetricKey, noCache = false): Promise<any[]> {
  return cachedFetch(
    `growthepie:metric:${metric}`,
    TTL.TVL,
    () => request(`/export/${metric}.json`),
    noCache
  );
}

// ============================================
// FORMATTED GETTERS
// ============================================

export async function getL2Overview(
  limit: number = 15,
  noCache = false
): Promise<
  Array<{
    chain: string;
    tvl: number;
    txcount: number;
  }>
> {
  const chainMetrics = await getFundamentals(noCache);

  return Array.from(chainMetrics.entries())
    .map(([chain, metrics]) => ({
      chain,
      tvl: metrics.get('tvl') || 0,
      txcount: metrics.get('txcount') || 0,
    }))
    .sort((a, b) => b.tvl - a.tvl)
    .slice(0, limit);
}

export async function getL2Fees(noCache = false): Promise<
  Array<{
    chain: string;
    fees: number;
  }>
> {
  const chainMetrics = await getFundamentals(noCache);

  return Array.from(chainMetrics.entries())
    .map(([chain, metrics]) => ({
      chain,
      fees: metrics.get('txcosts') || 0,
    }))
    .filter((c) => c.fees > 0)
    .sort((a, b) => a.fees - b.fees);
}

export async function getL2Chain(
  chain: string,
  noCache = false
): Promise<{
  chain: string;
  tvl: number;
  txcount: number;
  fees: number;
  daa: number;
  stablesMcap: number;
  fdv: number;
  marketCap: number;
  profit: number;
  throughput: number;
  rentPaid: number;
} | null> {
  const chainMetrics = await getFundamentals(noCache);
  const metrics = chainMetrics.get(chain.toLowerCase());

  if (!metrics) return null;

  return {
    chain: chain.toLowerCase(),
    tvl: metrics.get('tvl') || 0,
    txcount: metrics.get('txcount') || 0,
    fees: metrics.get('txcosts') || 0,
    daa: metrics.get('daa') || 0,
    stablesMcap: metrics.get('stables_mcap') || 0,
    fdv: metrics.get('fdv') || 0,
    marketCap: metrics.get('market_cap') || 0,
    profit: metrics.get('profit') || 0,
    throughput: metrics.get('throughput') || 0,
    rentPaid: metrics.get('rent_paid') || 0,
  };
}

export async function getAvailableChains(noCache = false): Promise<string[]> {
  const chainMetrics = await getFundamentals(noCache);
  return Array.from(chainMetrics.keys());
}

export async function getBlobData(noCache = false): Promise<
  Array<{
    chain: string;
    blobFees: number;
  }>
> {
  const chainMetrics = await getFundamentals(noCache);

  return Array.from(chainMetrics.entries())
    .map(([chain, metrics]) => ({
      chain,
      blobFees: metrics.get('rent_paid') || 0,
    }))
    .filter((c) => c.blobFees > 0)
    .sort((a, b) => b.blobFees - a.blobFees);
}

// Get all chains with all metrics
export async function getAllL2Metrics(noCache = false): Promise<
  Array<{
    chain: string;
    tvl: number;
    txcount: number;
    fees: number;
    daa: number;
    stablesMcap: number;
    fdv: number;
    marketCap: number;
    profit: number;
  }>
> {
  const chainMetrics = await getFundamentals(noCache);

  return Array.from(chainMetrics.entries())
    .map(([chain, metrics]) => ({
      chain,
      tvl: metrics.get('tvl') || 0,
      txcount: metrics.get('txcount') || 0,
      fees: metrics.get('txcosts') || 0,
      daa: metrics.get('daa') || 0,
      stablesMcap: metrics.get('stables_mcap') || 0,
      fdv: metrics.get('fdv') || 0,
      marketCap: metrics.get('market_cap') || 0,
      profit: metrics.get('profit') || 0,
    }))
    .sort((a, b) => b.tvl - a.tvl);
}

// Get metric rankings across all chains
export async function getMetricRanking(
  metric: MetricKey,
  limit: number = 20,
  noCache = false
): Promise<Array<{ chain: string; value: number }>> {
  const chainMetrics = await getFundamentals(noCache);

  return Array.from(chainMetrics.entries())
    .map(([chain, metrics]) => ({
      chain,
      value: metrics.get(metric) || 0,
    }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

// Get chain metadata from master
export async function getChainMetadata(chain: string, noCache = false): Promise<any | null> {
  const master = await getMaster(noCache);

  // Master is an object with chain keys
  if (master && master[chain.toLowerCase()]) {
    return master[chain.toLowerCase()];
  }

  // Try to find by searching
  for (const [key, data] of Object.entries(master || {})) {
    if (key.toLowerCase() === chain.toLowerCase()) {
      return data;
    }
  }

  return null;
}

// List all supported chains with metadata
export async function listChains(noCache = false): Promise<
  Array<{
    key: string;
    name: string;
    technology: string;
  }>
> {
  const master = await getMaster(noCache);

  if (!master || typeof master !== 'object') {
    return [];
  }

  return Object.entries(master)
    .filter(([key]) => key !== 'metrics') // Filter out non-chain entries
    .map(([key, data]: [string, any]) => ({
      key,
      name: data?.chain_name || key,
      technology: data?.technology || 'Unknown',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
