// DefiLlama API adapter (free tier + optional Pro API)
import { cachedFetch, TTL } from '../utils/cache.js';

const BASE_URL = 'https://api.llama.fi';
const PRO_BASE_URL = 'https://pro-api.llama.fi';
const YIELDS_URL = 'https://yields.llama.fi';
const STABLECOINS_URL = 'https://stablecoins.llama.fi';
const COINS_URL = 'https://coins.llama.fi';

let defillamaApiKey = process.env.DEFILLAMA_API_KEY || '';

export function isProConfigured(): boolean {
  return !!defillamaApiKey;
}

export function setApiKey(key: string): void {
  defillamaApiKey = key;
}

async function request(baseUrl: string, endpoint: string, requiresPro = false): Promise<any> {
  let url = `${baseUrl}${endpoint}`;

  // Use Pro API if key is set and endpoint requires it
  if (requiresPro && defillamaApiKey) {
    url = `${PRO_BASE_URL}${endpoint}`;
    const separator = endpoint.includes('?') ? '&' : '?';
    url += `${separator}apiKey=${defillamaApiKey}`;
  } else if (requiresPro && !defillamaApiKey) {
    throw new Error(
      'This endpoint requires a DefiLlama Pro API key. Get one at defillama.com/subscription, then call set_defillama_key.'
    );
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`DefiLlama API error: ${response.statusText}`);
  }
  return response.json();
}

// Cached fetchers
export async function getChains(noCache = false): Promise<any[]> {
  return cachedFetch('defillama:chains', TTL.TVL, () => request(BASE_URL, '/v2/chains'), noCache);
}

export async function getProtocolTvl(protocol: string, noCache = false): Promise<number> {
  return cachedFetch(
    `defillama:tvl:${protocol}`,
    TTL.TVL,
    () => request(BASE_URL, `/tvl/${protocol}`),
    noCache
  );
}

export async function getProtocol(protocol: string, noCache = false): Promise<any> {
  return cachedFetch(
    `defillama:protocol:${protocol}`,
    TTL.PROTOCOL,
    () => request(BASE_URL, `/protocol/${protocol}`),
    noCache
  );
}

export async function getProtocols(noCache = false): Promise<any[]> {
  return cachedFetch(
    'defillama:protocols',
    TTL.PROTOCOL,
    () => request(BASE_URL, '/protocols'),
    noCache
  );
}

export async function getYieldPools(noCache = false): Promise<any> {
  return cachedFetch('defillama:yields', TTL.TVL, () => request(YIELDS_URL, '/pools'), noCache);
}

export async function getStablecoins(noCache = false): Promise<any> {
  return cachedFetch(
    'defillama:stablecoins',
    TTL.TVL,
    () => request(STABLECOINS_URL, '/stablecoins?includePrices=true'),
    noCache
  );
}

export async function getDexVolumes(noCache = false): Promise<any> {
  return cachedFetch(
    'defillama:dexvolumes',
    TTL.TVL,
    () =>
      request(
        BASE_URL,
        '/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyVolume'
      ),
    noCache
  );
}

// Formatted getters for tools
export async function getTopChainsByTvl(
  limit: number = 20,
  noCache = false
): Promise<Array<{ name: string; tvl: number }>> {
  const chains = await getChains(noCache);
  return chains
    .sort((a: any, b: any) => b.tvl - a.tvl)
    .slice(0, limit)
    .map((c: any) => ({ name: c.name, tvl: c.tvl }));
}

export async function searchProtocols(
  query: string,
  limit: number = 15,
  noCache = false
): Promise<any[]> {
  const protocols = await getProtocols(noCache);
  return protocols
    .filter(
      (p: any) =>
        p.name.toLowerCase().includes(query.toLowerCase()) ||
        (p.category && p.category.toLowerCase().includes(query.toLowerCase()))
    )
    .sort((a: any, b: any) => b.tvl - a.tvl)
    .slice(0, limit);
}

export async function getTopYields(
  chain?: string,
  minTvl: number = 1000000,
  limit: number = 20,
  noCache = false
): Promise<any[]> {
  const data = await getYieldPools(noCache);
  let pools = data.data.filter((p: any) => p.tvlUsd >= minTvl);

  if (chain) {
    pools = pools.filter((p: any) => p.chain.toLowerCase() === chain.toLowerCase());
  }

  return pools.sort((a: any, b: any) => b.apy - a.apy).slice(0, limit);
}

export async function getTopStablecoins(limit: number = 15, noCache = false): Promise<any[]> {
  const data = await getStablecoins(noCache);
  return data.peggedAssets
    .sort((a: any, b: any) => b.circulating.peggedUSD - a.circulating.peggedUSD)
    .slice(0, limit)
    .map((s: any) => ({
      symbol: s.symbol,
      name: s.name,
      marketCap: s.circulating.peggedUSD,
    }));
}

export async function getTopDexes(limit: number = 15, noCache = false): Promise<any[]> {
  const data = await getDexVolumes(noCache);
  return data.protocols
    .sort((a: any, b: any) => (b.dailyVolume || 0) - (a.dailyVolume || 0))
    .slice(0, limit)
    .map((d: any) => ({
      name: d.name,
      dailyVolume: d.dailyVolume || 0,
    }));
}

// ============================================
// HISTORICAL TVL
// ============================================

export async function getHistoricalChainTvl(noCache = false): Promise<any[]> {
  return cachedFetch(
    'defillama:historicalchaintvl',
    TTL.TVL,
    () => request(BASE_URL, '/v2/historicalChainTvl'),
    noCache
  );
}

export async function getHistoricalChainTvlByChain(chain: string, noCache = false): Promise<any[]> {
  return cachedFetch(
    `defillama:historicalchaintvl:${chain}`,
    TTL.TVL,
    () => request(BASE_URL, `/v2/historicalChainTvl/${chain}`),
    noCache
  );
}

// ============================================
// COIN PRICES
// ============================================

// coins format: "ethereum:0x...,bsc:0x..." or "coingecko:bitcoin"
export async function getCoinPrices(coins: string, noCache = false): Promise<any> {
  return cachedFetch(
    `defillama:coinprices:${coins}`,
    TTL.PRICE,
    () => request(COINS_URL, `/prices/current/${encodeURIComponent(coins)}`),
    noCache
  );
}

export async function getCoinPricesHistorical(
  coins: string,
  timestamp: number,
  noCache = false
): Promise<any> {
  return cachedFetch(
    `defillama:coinpriceshistorical:${coins}:${timestamp}`,
    TTL.STATIC,
    () => request(COINS_URL, `/prices/historical/${timestamp}/${encodeURIComponent(coins)}`),
    noCache
  );
}

export async function getCoinChart(
  coins: string,
  start?: number,
  end?: number,
  span?: number,
  period?: string,
  noCache = false
): Promise<any> {
  let endpoint = `/chart/${encodeURIComponent(coins)}?`;
  if (start) endpoint += `start=${start}&`;
  if (end) endpoint += `end=${end}&`;
  if (span) endpoint += `span=${span}&`;
  if (period) endpoint += `period=${period}&`;
  return cachedFetch(
    `defillama:coinchart:${coins}:${start}:${end}:${span}:${period}`,
    TTL.TVL,
    () => request(COINS_URL, endpoint),
    noCache
  );
}

export async function getCoinPercentChange(coins: string, noCache = false): Promise<any> {
  return cachedFetch(
    `defillama:coinpercent:${coins}`,
    TTL.PRICE,
    () => request(COINS_URL, `/percentage/${encodeURIComponent(coins)}`),
    noCache
  );
}

export async function getCoinFirstPrice(coins: string, noCache = false): Promise<any> {
  return cachedFetch(
    `defillama:coinfirst:${coins}`,
    TTL.STATIC,
    () => request(COINS_URL, `/prices/first/${encodeURIComponent(coins)}`),
    noCache
  );
}

export async function getBlockByTimestamp(
  chain: string,
  timestamp: number,
  noCache = false
): Promise<any> {
  return cachedFetch(
    `defillama:block:${chain}:${timestamp}`,
    TTL.STATIC,
    () => request(COINS_URL, `/block/${chain}/${timestamp}`),
    noCache
  );
}

// ============================================
// STABLECOINS (Extended)
// ============================================

export async function getStablecoinDominance(chain: string, noCache = false): Promise<any> {
  return cachedFetch(
    `defillama:stabledominance:${chain}`,
    TTL.TVL,
    () => request(STABLECOINS_URL, `/stablecoindominance/${chain}`),
    noCache
  );
}

export async function getStablecoinCharts(chain?: string, noCache = false): Promise<any[]> {
  const endpoint = chain ? `/stablecoincharts/${chain}` : '/stablecoincharts/all';
  return cachedFetch(
    `defillama:stablecharts:${chain || 'all'}`,
    TTL.TVL,
    () => request(STABLECOINS_URL, endpoint),
    noCache
  );
}

export async function getStablecoinDetail(asset: string, noCache = false): Promise<any> {
  return cachedFetch(
    `defillama:stablecoin:${asset}`,
    TTL.TVL,
    () => request(STABLECOINS_URL, `/stablecoin/${asset}`),
    noCache
  );
}

export async function getStablecoinChains(noCache = false): Promise<any[]> {
  return cachedFetch(
    'defillama:stablechains',
    TTL.TVL,
    () => request(STABLECOINS_URL, '/stablecoinchains'),
    noCache
  );
}

export async function getStablecoinPrices(noCache = false): Promise<any> {
  return cachedFetch(
    'defillama:stableprices',
    TTL.PRICE,
    () => request(STABLECOINS_URL, '/stablecoinprices'),
    noCache
  );
}

// ============================================
// DEX VOLUMES (Extended)
// ============================================

export async function getDexVolumesByChain(chain: string, noCache = false): Promise<any> {
  return cachedFetch(
    `defillama:dexvolumes:${chain}`,
    TTL.TVL,
    () =>
      request(
        BASE_URL,
        `/overview/dexs/${chain}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyVolume`
      ),
    noCache
  );
}

export async function getDexProtocol(protocol: string, noCache = false): Promise<any> {
  return cachedFetch(
    `defillama:dexprotocol:${protocol}`,
    TTL.TVL,
    () => request(BASE_URL, `/summary/dexs/${protocol}?dataType=dailyVolume`),
    noCache
  );
}

// ============================================
// OPTIONS
// ============================================

export async function getOptionsVolumes(noCache = false): Promise<any> {
  return cachedFetch(
    'defillama:options',
    TTL.TVL,
    () =>
      request(
        BASE_URL,
        '/overview/options?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true'
      ),
    noCache
  );
}

export async function getOptionsVolumesByChain(chain: string, noCache = false): Promise<any> {
  return cachedFetch(
    `defillama:options:${chain}`,
    TTL.TVL,
    () =>
      request(
        BASE_URL,
        `/overview/options/${chain}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`
      ),
    noCache
  );
}

export async function getOptionsProtocol(protocol: string, noCache = false): Promise<any> {
  return cachedFetch(
    `defillama:optionsprotocol:${protocol}`,
    TTL.TVL,
    () => request(BASE_URL, `/summary/options/${protocol}`),
    noCache
  );
}

// ============================================
// FEES & REVENUE
// ============================================

export async function getFees(noCache = false): Promise<any> {
  return cachedFetch(
    'defillama:fees',
    TTL.TVL,
    () =>
      request(
        BASE_URL,
        '/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true'
      ),
    noCache
  );
}

export async function getFeesByChain(chain: string, noCache = false): Promise<any> {
  return cachedFetch(
    `defillama:fees:${chain}`,
    TTL.TVL,
    () =>
      request(
        BASE_URL,
        `/overview/fees/${chain}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`
      ),
    noCache
  );
}

export async function getProtocolFees(protocol: string, noCache = false): Promise<any> {
  return cachedFetch(
    `defillama:protocolFees:${protocol}`,
    TTL.TVL,
    () => request(BASE_URL, `/summary/fees/${protocol}`),
    noCache
  );
}

// ============================================
// PRO API ENDPOINTS (require API key)
// ============================================

// Yields - Pro endpoints
export async function getYieldPoolChart(pool: string, noCache = false): Promise<any> {
  return cachedFetch(
    `defillama:yieldchart:${pool}`,
    TTL.TVL,
    () => request(YIELDS_URL, `/chart/${pool}`, true),
    noCache
  );
}

export async function getBorrowRates(noCache = false): Promise<any> {
  return cachedFetch(
    'defillama:borrowrates',
    TTL.TVL,
    () => request(YIELDS_URL, '/poolsBorrow', true),
    noCache
  );
}

export async function getLendBorrowChart(pool: string, noCache = false): Promise<any> {
  return cachedFetch(
    `defillama:lendborrow:${pool}`,
    TTL.TVL,
    () => request(YIELDS_URL, `/chartLendBorrow/${pool}`, true),
    noCache
  );
}

export async function getPerpsRates(noCache = false): Promise<any> {
  return cachedFetch(
    'defillama:perps',
    TTL.TVL,
    () => request(YIELDS_URL, '/perps', true),
    noCache
  );
}

export async function getLsdRates(noCache = false): Promise<any> {
  return cachedFetch(
    'defillama:lsdrates',
    TTL.TVL,
    () => request(YIELDS_URL, '/lsdRates', true),
    noCache
  );
}

// Derivatives
export async function getDerivativesVolumes(noCache = false): Promise<any> {
  return cachedFetch(
    'defillama:derivatives',
    TTL.TVL,
    () =>
      request(
        BASE_URL,
        '/overview/derivatives?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true',
        true
      ),
    noCache
  );
}

export async function getDerivativesProtocol(protocol: string, noCache = false): Promise<any> {
  return cachedFetch(
    `defillama:derivativesprotocol:${protocol}`,
    TTL.TVL,
    () => request(BASE_URL, `/summary/derivatives/${protocol}`, true),
    noCache
  );
}

// Emissions/Unlocks
export async function getEmissions(noCache = false): Promise<any> {
  return cachedFetch(
    'defillama:emissions',
    TTL.TVL,
    () => request(BASE_URL, '/emissions', true),
    noCache
  );
}

export async function getEmission(protocol: string, noCache = false): Promise<any> {
  return cachedFetch(
    `defillama:emission:${protocol}`,
    TTL.TVL,
    () => request(BASE_URL, `/emission/${protocol}`, true),
    noCache
  );
}

// Ecosystem data
export async function getCategories(noCache = false): Promise<any> {
  return cachedFetch(
    'defillama:categories',
    TTL.TVL,
    () => request(BASE_URL, '/categories', true),
    noCache
  );
}

export async function getForks(noCache = false): Promise<any> {
  return cachedFetch('defillama:forks', TTL.TVL, () => request(BASE_URL, '/forks', true), noCache);
}

export async function getOracles(noCache = false): Promise<any> {
  return cachedFetch(
    'defillama:oracles',
    TTL.TVL,
    () => request(BASE_URL, '/oracles', true),
    noCache
  );
}

export async function getTreasuries(noCache = false): Promise<any> {
  return cachedFetch(
    'defillama:treasuries',
    TTL.TVL,
    () => request(BASE_URL, '/treasuries', true),
    noCache
  );
}

export async function getHacks(noCache = false): Promise<any> {
  return cachedFetch(
    'defillama:hacks',
    TTL.STATIC,
    () => request(BASE_URL, '/hacks', true),
    noCache
  );
}

export async function getRaises(noCache = false): Promise<any> {
  return cachedFetch(
    'defillama:raises',
    TTL.TVL,
    () => request(BASE_URL, '/raises', true),
    noCache
  );
}

// Bridges
export async function getBridges(noCache = false): Promise<any> {
  return cachedFetch(
    'defillama:bridges',
    TTL.TVL,
    () => request(BASE_URL, '/bridges', true),
    noCache
  );
}

export async function getBridge(id: number, noCache = false): Promise<any> {
  return cachedFetch(
    `defillama:bridge:${id}`,
    TTL.TVL,
    () => request(BASE_URL, `/bridge/${id}`, true),
    noCache
  );
}

export async function getBridgeVolume(chain: string, noCache = false): Promise<any> {
  return cachedFetch(
    `defillama:bridgevolume:${chain}`,
    TTL.TVL,
    () => request(BASE_URL, `/bridgevolume/${chain}`, true),
    noCache
  );
}
