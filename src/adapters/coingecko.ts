// CoinGecko API adapter (free demo tier + optional Pro API)
import { cachedFetch, TTL } from '../utils/cache.js';
import { RateLimiter } from '../utils/security.js';

const DEMO_URL = 'https://api.coingecko.com/api/v3';
const PRO_URL = 'https://pro-api.coingecko.com/api/v3';

let coingeckoApiKey = process.env.COINGECKO_API_KEY || '';

// Rate limiter: 30 requests per minute for demo, 500 for pro
let rateLimiter = new RateLimiter(30, 60 * 1000);

export function isProConfigured(): boolean {
  return !!coingeckoApiKey;
}

export function setApiKey(key: string): void {
  coingeckoApiKey = key;
  // Pro tier has much higher rate limits (500/min for Analyst plan)
  rateLimiter = new RateLimiter(500, 60 * 1000);
}

async function request(endpoint: string, requiresPro = false): Promise<any> {
  await rateLimiter.waitForSlot();

  const baseUrl = coingeckoApiKey ? PRO_URL : DEMO_URL;
  let url = `${baseUrl}${endpoint}`;

  if (requiresPro && !coingeckoApiKey) {
    throw new Error(
      'This endpoint requires a CoinGecko Pro API key. Get one at coingecko.com/api/pricing, then call set_coingecko_key.'
    );
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
  };

  if (coingeckoApiKey) {
    headers['x-cg-pro-api-key'] = coingeckoApiKey;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('CoinGecko rate limit exceeded. Please wait a moment.');
    }
    throw new Error(`CoinGecko API error: ${response.statusText}`);
  }
  return response.json();
}

// ============================================
// SIMPLE ENDPOINTS (Free)
// ============================================

// Get token price by ID
export async function getPrice(
  ids: string | string[],
  vsCurrencies: string = 'usd',
  noCache = false
): Promise<Record<string, Record<string, number>>> {
  const idList = Array.isArray(ids) ? ids.join(',') : ids;
  const cacheKey = `coingecko:price:${idList}:${vsCurrencies}`;

  return cachedFetch(
    cacheKey,
    TTL.PRICE,
    () =>
      request(
        `/simple/price?ids=${idList}&vs_currencies=${vsCurrencies}&include_24hr_change=true&include_market_cap=true`
      ),
    noCache
  );
}

// Get token price by contract address
export async function getTokenPriceByContract(
  platform: string,
  contractAddresses: string | string[],
  vsCurrencies: string = 'usd',
  noCache = false
): Promise<any> {
  const addresses = Array.isArray(contractAddresses)
    ? contractAddresses.join(',')
    : contractAddresses;
  return cachedFetch(
    `coingecko:tokenprice:${platform}:${addresses}`,
    TTL.PRICE,
    () =>
      request(
        `/simple/token_price/${platform}?contract_addresses=${addresses}&vs_currencies=${vsCurrencies}&include_24hr_change=true&include_market_cap=true`
      ),
    noCache
  );
}

// Get supported vs currencies
export async function getSupportedCurrencies(noCache = false): Promise<string[]> {
  return cachedFetch(
    'coingecko:currencies',
    TTL.STATIC,
    () => request('/simple/supported_vs_currencies'),
    noCache
  );
}

// ============================================
// COINS ENDPOINTS (Free)
// ============================================

// Get all coins list (ID map)
export async function getCoinsList(noCache = false): Promise<any[]> {
  return cachedFetch('coingecko:coins:list', TTL.STATIC, () => request('/coins/list'), noCache);
}

// Get top coins by market cap
export async function getTopCoins(limit: number = 20, noCache = false): Promise<any[]> {
  return cachedFetch(
    `coingecko:top:${limit}`,
    TTL.PRICE,
    () =>
      request(
        `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false`
      ),
    noCache
  );
}

// Get coin details
export async function getCoinDetails(id: string, noCache = false): Promise<any> {
  return cachedFetch(
    `coingecko:coin:${id}`,
    TTL.PROTOCOL,
    () =>
      request(
        `/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`
      ),
    noCache
  );
}

// Get coin tickers (exchanges where coin is traded)
export async function getCoinTickers(id: string, noCache = false): Promise<any> {
  return cachedFetch(
    `coingecko:tickers:${id}`,
    TTL.PRICE,
    () => request(`/coins/${id}/tickers`),
    noCache
  );
}

// Get historical data for a coin on a specific date
export async function getCoinHistory(id: string, date: string, noCache = false): Promise<any> {
  // date format: dd-mm-yyyy
  return cachedFetch(
    `coingecko:history:${id}:${date}`,
    TTL.STATIC,
    () => request(`/coins/${id}/history?date=${date}`),
    noCache
  );
}

// Get historical market chart data
export async function getCoinMarketChart(
  id: string,
  days: number | string = 30,
  noCache = false
): Promise<any> {
  return cachedFetch(
    `coingecko:chart:${id}:${days}`,
    TTL.TVL,
    () => request(`/coins/${id}/market_chart?vs_currency=usd&days=${days}`),
    noCache
  );
}

// Get historical market chart in time range
export async function getCoinMarketChartRange(
  id: string,
  from: number,
  to: number,
  noCache = false
): Promise<any> {
  return cachedFetch(
    `coingecko:chartrange:${id}:${from}:${to}`,
    TTL.TVL,
    () => request(`/coins/${id}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`),
    noCache
  );
}

// Get OHLC data
export async function getCoinOHLC(id: string, days: number = 30, noCache = false): Promise<any[]> {
  return cachedFetch(
    `coingecko:ohlc:${id}:${days}`,
    TTL.PRICE,
    () => request(`/coins/${id}/ohlc?vs_currency=usd&days=${days}`),
    noCache
  );
}

// Get coin data by contract address
export async function getCoinByContract(
  platform: string,
  contractAddress: string,
  noCache = false
): Promise<any> {
  return cachedFetch(
    `coingecko:contract:${platform}:${contractAddress}`,
    TTL.PROTOCOL,
    () => request(`/coins/${platform}/contract/${contractAddress}`),
    noCache
  );
}

// Get coin market chart by contract address
export async function getCoinChartByContract(
  platform: string,
  contractAddress: string,
  days: number = 30,
  noCache = false
): Promise<any> {
  return cachedFetch(
    `coingecko:contractchart:${platform}:${contractAddress}:${days}`,
    TTL.TVL,
    () =>
      request(
        `/coins/${platform}/contract/${contractAddress}/market_chart?vs_currency=usd&days=${days}`
      ),
    noCache
  );
}

// ============================================
// CATEGORIES & PLATFORMS (Free)
// ============================================

// Get asset platforms (blockchains)
export async function getAssetPlatforms(noCache = false): Promise<any[]> {
  return cachedFetch('coingecko:platforms', TTL.STATIC, () => request('/asset_platforms'), noCache);
}

// Get categories list
export async function getCategoriesList(noCache = false): Promise<any[]> {
  return cachedFetch(
    'coingecko:categories:list',
    TTL.STATIC,
    () => request('/coins/categories/list'),
    noCache
  );
}

// Get categories with market data
export async function getCategories(noCache = false): Promise<any[]> {
  return cachedFetch('coingecko:categories', TTL.TVL, () => request('/coins/categories'), noCache);
}

// ============================================
// EXCHANGES (Free)
// ============================================

// Get all exchanges
export async function getExchanges(limit: number = 100, noCache = false): Promise<any[]> {
  return cachedFetch(
    `coingecko:exchanges:${limit}`,
    TTL.TVL,
    () => request(`/exchanges?per_page=${limit}`),
    noCache
  );
}

// Get exchanges list (ID map)
export async function getExchangesList(noCache = false): Promise<any[]> {
  return cachedFetch(
    'coingecko:exchanges:list',
    TTL.STATIC,
    () => request('/exchanges/list'),
    noCache
  );
}

// Get exchange details
export async function getExchange(id: string, noCache = false): Promise<any> {
  return cachedFetch(
    `coingecko:exchange:${id}`,
    TTL.TVL,
    () => request(`/exchanges/${id}`),
    noCache
  );
}

// Get exchange tickers
export async function getExchangeTickers(id: string, noCache = false): Promise<any> {
  return cachedFetch(
    `coingecko:exchangetickers:${id}`,
    TTL.PRICE,
    () => request(`/exchanges/${id}/tickers`),
    noCache
  );
}

// Get exchange volume chart
export async function getExchangeVolumeChart(
  id: string,
  days: number = 30,
  noCache = false
): Promise<any[]> {
  return cachedFetch(
    `coingecko:exchangevolume:${id}:${days}`,
    TTL.TVL,
    () => request(`/exchanges/${id}/volume_chart?days=${days}`),
    noCache
  );
}

// ============================================
// DERIVATIVES (Free)
// ============================================

// Get all derivatives tickers
export async function getDerivatives(noCache = false): Promise<any[]> {
  return cachedFetch('coingecko:derivatives', TTL.PRICE, () => request('/derivatives'), noCache);
}

// Get derivatives exchanges
export async function getDerivativesExchanges(noCache = false): Promise<any[]> {
  return cachedFetch(
    'coingecko:derivatives:exchanges',
    TTL.TVL,
    () => request('/derivatives/exchanges'),
    noCache
  );
}

// Get specific derivatives exchange
export async function getDerivativesExchange(id: string, noCache = false): Promise<any> {
  return cachedFetch(
    `coingecko:derivatives:exchange:${id}`,
    TTL.TVL,
    () => request(`/derivatives/exchanges/${id}`),
    noCache
  );
}

// ============================================
// GLOBAL & SEARCH (Free)
// ============================================

// Search for coins
export async function searchCoins(query: string, noCache = false): Promise<any> {
  return cachedFetch(
    `coingecko:search:${query}`,
    TTL.PROTOCOL,
    () => request(`/search?query=${encodeURIComponent(query)}`),
    noCache
  );
}

// Get trending coins
export async function getTrending(noCache = false): Promise<any> {
  return cachedFetch('coingecko:trending', TTL.TVL, () => request('/search/trending'), noCache);
}

// Get global market data
export async function getGlobalData(noCache = false): Promise<any> {
  return cachedFetch('coingecko:global', TTL.PRICE, () => request('/global'), noCache);
}

// Get global DeFi data
export async function getGlobalDefiData(noCache = false): Promise<any> {
  return cachedFetch(
    'coingecko:global:defi',
    TTL.PRICE,
    () => request('/global/decentralized_finance_defi'),
    noCache
  );
}

// Get exchange rates (BTC to other currencies)
export async function getExchangeRates(noCache = false): Promise<any> {
  return cachedFetch(
    'coingecko:exchangerates',
    TTL.PRICE,
    () => request('/exchange_rates'),
    noCache
  );
}

// ============================================
// NFTs (Free base, Pro for some)
// ============================================

// Get NFTs list
export async function getNftsList(noCache = false): Promise<any[]> {
  return cachedFetch('coingecko:nfts:list', TTL.STATIC, () => request('/nfts/list'), noCache);
}

// Get NFT collection details
export async function getNftDetails(id: string, noCache = false): Promise<any> {
  return cachedFetch(`coingecko:nft:${id}`, TTL.TVL, () => request(`/nfts/${id}`), noCache);
}

// Get NFT by contract address
export async function getNftByContract(
  platform: string,
  contractAddress: string,
  noCache = false
): Promise<any> {
  return cachedFetch(
    `coingecko:nftcontract:${platform}:${contractAddress}`,
    TTL.TVL,
    () => request(`/nfts/${platform}/contract/${contractAddress}`),
    noCache
  );
}

// ============================================
// PRO ENDPOINTS (require API key)
// ============================================

// Get API usage (Pro)
export async function getApiUsage(noCache = false): Promise<any> {
  return cachedFetch('coingecko:key', TTL.PRICE, () => request('/key', true), noCache);
}

// Get top gainers and losers (Pro)
export async function getTopMovers(
  vsCurrency: string = 'usd',
  duration: string = '24h',
  noCache = false
): Promise<any> {
  return cachedFetch(
    `coingecko:movers:${vsCurrency}:${duration}`,
    TTL.PRICE,
    () => request(`/coins/top_gainers_losers?vs_currency=${vsCurrency}&duration=${duration}`, true),
    noCache
  );
}

// Get recently added coins (Pro)
export async function getNewCoins(noCache = false): Promise<any[]> {
  return cachedFetch(
    'coingecko:coins:new',
    TTL.TVL,
    () => request('/coins/list/new', true),
    noCache
  );
}

// Get exchange volume chart range (Pro)
export async function getExchangeVolumeChartRange(
  id: string,
  from: number,
  to: number,
  noCache = false
): Promise<any[]> {
  return cachedFetch(
    `coingecko:exchangevolumerange:${id}:${from}:${to}`,
    TTL.TVL,
    () => request(`/exchanges/${id}/volume_chart/range?from=${from}&to=${to}`, true),
    noCache
  );
}

// Get NFT markets (Pro)
export async function getNftMarkets(limit: number = 100, noCache = false): Promise<any[]> {
  return cachedFetch(
    `coingecko:nfts:markets:${limit}`,
    TTL.TVL,
    () => request(`/nfts/markets?per_page=${limit}`, true),
    noCache
  );
}

// Get NFT market chart (Pro)
export async function getNftMarketChart(
  id: string,
  days: number = 30,
  noCache = false
): Promise<any> {
  return cachedFetch(
    `coingecko:nft:chart:${id}:${days}`,
    TTL.TVL,
    () => request(`/nfts/${id}/market_chart?days=${days}`, true),
    noCache
  );
}

// Get NFT tickers (Pro)
export async function getNftTickers(id: string, noCache = false): Promise<any> {
  return cachedFetch(
    `coingecko:nft:tickers:${id}`,
    TTL.PRICE,
    () => request(`/nfts/${id}/tickers`, true),
    noCache
  );
}

// Get global market cap chart (Pro)
export async function getGlobalMarketCapChart(days: number = 30, noCache = false): Promise<any> {
  return cachedFetch(
    `coingecko:global:chart:${days}`,
    TTL.TVL,
    () => request(`/global/market_cap_chart?days=${days}`, true),
    noCache
  );
}

// ============================================
// FORMATTED HELPERS
// ============================================

export async function getFormattedTopCoins(
  limit: number = 20,
  noCache = false
): Promise<
  Array<{
    name: string;
    symbol: string;
    price: number;
    marketCap: number;
    change24h: number;
  }>
> {
  const coins = await getTopCoins(limit, noCache);
  return coins.map((c: any) => ({
    name: c.name,
    symbol: c.symbol.toUpperCase(),
    price: c.current_price,
    marketCap: c.market_cap,
    change24h: c.price_change_percentage_24h || 0,
  }));
}

export async function getFormattedTrending(noCache = false): Promise<
  Array<{
    name: string;
    symbol: string;
    marketCapRank: number;
  }>
> {
  const data = await getTrending(noCache);
  return data.coins.map((item: any) => ({
    name: item.item.name,
    symbol: item.item.symbol.toUpperCase(),
    marketCapRank: item.item.market_cap_rank || 'N/A',
  }));
}

export async function getFormattedGlobalData(noCache = false): Promise<{
  totalMarketCap: number;
  totalVolume24h: number;
  btcDominance: number;
  ethDominance: number;
  activeCryptos: number;
}> {
  const data = await getGlobalData(noCache);
  return {
    totalMarketCap: data.data.total_market_cap.usd,
    totalVolume24h: data.data.total_volume.usd,
    btcDominance: data.data.market_cap_percentage.btc,
    ethDominance: data.data.market_cap_percentage.eth,
    activeCryptos: data.data.active_cryptocurrencies,
  };
}
