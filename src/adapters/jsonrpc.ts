// JSON-RPC adapter for local/self-hosted Ethereum nodes
import { cachedFetch, TTL } from '../utils/cache.js';
import { sanitizeError } from '../utils/security.js';

let nodeUrl = process.env.ETH_NODE_URL || '';
let nodeChainId: string | null = null;
let requestId = 1;

const RPC_TIMEOUT_MS = 30_000;

// ============================================
// VALIDATORS
// ============================================

function validateAddress(address: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`Invalid address: expected 0x followed by 40 hex characters, got "${address}"`);
  }
}

function validateHex(value: string, label: string): void {
  if (!/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`Invalid ${label}: expected 0x-prefixed hex string, got "${value}"`);
  }
}

const NAMED_BLOCK_TAGS = ['latest', 'earliest', 'pending', 'safe', 'finalized'];

function validateBlockTag(tag: string | number): void {
  if (typeof tag === 'number') {
    if (!Number.isInteger(tag) || tag < 0) {
      throw new Error(`Invalid block number: expected non-negative integer, got ${tag}`);
    }
    return;
  }
  if (NAMED_BLOCK_TAGS.includes(tag)) return;
  if (/^0x[0-9a-fA-F]+$/.test(tag)) return;
  throw new Error(
    `Invalid block tag: expected a number, hex string, or one of ${NAMED_BLOCK_TAGS.join(', ')}; got "${tag}"`
  );
}

// ============================================
// URL SANITIZATION
// ============================================

function sanitizeUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return '[invalid URL]';
  }

  if (parsed.username) parsed.username = '[REDACTED]';
  if (parsed.password) parsed.password = '[REDACTED]';

  // Mask 32+ hex path segments (Infura keys, Alchemy keys, etc.)
  parsed.pathname = parsed.pathname.replace(/[a-fA-F0-9]{32,}/g, '[REDACTED]');

  return parsed.toString();
}

function buildSensitiveKeys(url: string): string[] {
  const keys: string[] = [];
  try {
    const parsed = new URL(url);
    if (parsed.password) keys.push(parsed.password);
    if (parsed.username) keys.push(parsed.username);
  } catch {
    // not a valid URL, nothing to extract
  }
  // 32+ hex segments anywhere in the URL (API keys in path)
  const hexMatches = url.match(/[a-fA-F0-9]{32,}/g);
  if (hexMatches) keys.push(...hexMatches);
  return keys.filter((k) => k.length > 0);
}

// ============================================
// EXPORTS: state accessors
// ============================================

export function getNodeChainId(): string | null {
  return nodeChainId;
}

export function getNodeUrl(): string {
  return nodeUrl;
}

export function getNodeUrlDisplay(): string {
  if (!nodeUrl) return '';
  return sanitizeUrl(nodeUrl);
}

export function isConfigured(): boolean {
  return !!nodeUrl;
}

// ============================================
// setNodeUrl -- async with validation
// ============================================

export async function setNodeUrl(url: string): Promise<{ chainId: string; blockNumber: number }> {
  // Validate URL format
  try {
    new URL(url);
  } catch {
    throw new Error(`Invalid URL: "${url}" is not a valid URL. Expected something like http://localhost:8545`);
  }

  const previousUrl = nodeUrl;
  const previousChainId = nodeChainId;

  // Temporarily set so rpcCall can use it
  nodeUrl = url;

  try {
    const chainIdHex = await rpcCall('eth_chainId');
    const blockNumberHex = await rpcCall('eth_blockNumber');

    const chainId = parseInt(chainIdHex, 16).toString();
    const blockNumber = parseInt(blockNumberHex, 16);

    nodeChainId = chainId;
    return { chainId, blockNumber };
  } catch (error) {
    // Rollback
    nodeUrl = previousUrl;
    nodeChainId = previousChainId;
    throw error;
  }
}

// ============================================
// HELPERS
// ============================================

function weiToEth(wei: string): string {
  const weiBigInt = BigInt(wei);
  const ethWhole = weiBigInt / BigInt(10 ** 18);
  const ethFraction = weiBigInt % BigInt(10 ** 18);
  const fractionStr = ethFraction.toString().padStart(18, '0').slice(0, 6);
  return `${ethWhole}.${fractionStr}`;
}

function hexToGwei(hex: string): string {
  const wei = BigInt(hex);
  const gwei = Number(wei) / 1e9;
  return gwei.toFixed(2);
}

// ============================================
// CORE JSON-RPC 2.0
// ============================================

async function rpcCall(method: string, params: any[] = []): Promise<any> {
  if (!nodeUrl) {
    throw new Error(
      'ETH_NODE_URL not set. Call set_node_url with your node URL (e.g. http://localhost:8545).'
    );
  }

  if (requestId >= Number.MAX_SAFE_INTEGER) {
    requestId = 1;
  }
  const id = requestId++;

  const body = JSON.stringify({
    jsonrpc: '2.0',
    method,
    params,
    id,
  });

  try {
    const response = await fetch(nodeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Node returned HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message || JSON.stringify(data.error));
    }

    return data.result;
  } catch (error) {
    const sensitiveKeys = buildSensitiveKeys(nodeUrl);
    throw new Error(sanitizeError(error, sensitiveKeys));
  }
}

// Cached RPC wrapper
async function cachedRpcCall(
  cacheKey: string,
  ttl: number,
  method: string,
  params: any[] = [],
  noCache: boolean = false
): Promise<any> {
  return cachedFetch(
    `jsonrpc:${cacheKey}`,
    ttl,
    () => rpcCall(method, params),
    noCache
  );
}

// ============================================
// API METHODS
// ============================================

export async function getBalance(address: string, noCache = false): Promise<string> {
  validateAddress(address);
  const result = await cachedRpcCall(
    `balance:${address}`,
    TTL.PRICE,
    'eth_getBalance',
    [address, 'latest'],
    noCache
  );
  return weiToEth(BigInt(result).toString());
}

export async function getBlockNumber(noCache = false): Promise<number> {
  const result = await cachedRpcCall(
    'blocknumber',
    TTL.GAS,
    'eth_blockNumber',
    [],
    noCache
  );
  return parseInt(result, 16);
}

export async function getBlockByNumber(
  blockNumber: string | number,
  fullTx: boolean = false,
  noCache = false
): Promise<any> {
  validateBlockTag(blockNumber);
  const tag = typeof blockNumber === 'number' ? `0x${blockNumber.toString(16)}` : blockNumber;
  return cachedRpcCall(
    `block:${tag}:${fullTx}`,
    TTL.STATIC,
    'eth_getBlockByNumber',
    [tag, fullTx],
    noCache
  );
}

export async function getTransactionByHash(txhash: string, noCache = false): Promise<any> {
  validateHex(txhash, 'transaction hash');
  return cachedRpcCall(
    `tx:${txhash}`,
    TTL.STATIC,
    'eth_getTransactionByHash',
    [txhash],
    noCache
  );
}

export async function getTransactionReceipt(txhash: string, noCache = false): Promise<any> {
  validateHex(txhash, 'transaction hash');
  return cachedRpcCall(
    `txreceipt:${txhash}`,
    TTL.STATIC,
    'eth_getTransactionReceipt',
    [txhash],
    noCache
  );
}

export async function ethCall(
  to: string,
  data: string,
  tag: string = 'latest',
  noCache = false
): Promise<string> {
  validateAddress(to);
  validateHex(data, 'call data');
  validateBlockTag(tag);
  return cachedRpcCall(
    `ethcall:${to}:${data}:${tag}`,
    TTL.GAS,
    'eth_call',
    [{ to, data }, tag],
    noCache
  );
}

export async function getCode(
  address: string,
  tag: string = 'latest',
  noCache = false
): Promise<string> {
  validateAddress(address);
  validateBlockTag(tag);
  return cachedRpcCall(
    `code:${address}:${tag}`,
    TTL.STATIC,
    'eth_getCode',
    [address, tag],
    noCache
  );
}

export async function getStorageAt(
  address: string,
  position: string,
  tag: string = 'latest',
  noCache = false
): Promise<string> {
  validateAddress(address);
  validateHex(position, 'storage position');
  validateBlockTag(tag);
  return cachedRpcCall(
    `storage:${address}:${position}:${tag}`,
    TTL.GAS,
    'eth_getStorageAt',
    [address, position, tag],
    noCache
  );
}

export async function estimateGas(
  to: string,
  data: string,
  value: string = '0x0',
  noCache = false
): Promise<string> {
  validateAddress(to);
  validateHex(data, 'call data');
  validateHex(value, 'value');
  return cachedRpcCall(
    `estimategas:${to}:${data}`,
    TTL.GAS,
    'eth_estimateGas',
    [{ to, data, value }],
    noCache
  );
}

// Returns gas price in Etherscan gasoracle format so existing tool formatting works
export async function getGasPrice(noCache = false): Promise<any> {
  const result = await cachedRpcCall(
    'gasprice',
    TTL.GAS,
    'eth_gasPrice',
    [],
    noCache
  );
  const gwei = hexToGwei(result);
  return {
    SafeGasPrice: gwei,
    ProposeGasPrice: gwei,
    FastGasPrice: gwei,
  };
}

// Raw hex gas price for proxy-style calls
export async function getGasPriceRaw(noCache = false): Promise<string> {
  return cachedRpcCall(
    'gasprice_raw',
    TTL.GAS,
    'eth_gasPrice',
    [],
    noCache
  );
}

export async function getLogs(
  address: string,
  fromBlock: number | string = 0,
  toBlock: number | string = 'latest',
  topic0?: string,
  topic1?: string,
  topic2?: string,
  topic3?: string,
  noCache = false
): Promise<any[]> {
  validateAddress(address);
  validateBlockTag(fromBlock);
  validateBlockTag(toBlock);

  // Block range guard
  if (typeof fromBlock === 'number' && typeof toBlock === 'number') {
    const range = toBlock - fromBlock;
    if (range > 10_000) {
      throw new Error(
        `Block range too large: ${range} blocks (from ${fromBlock} to ${toBlock}). Narrow the range to 10,000 blocks or fewer.`
      );
    }
  }

  if (topic0) validateHex(topic0, 'topic0');
  if (topic1) validateHex(topic1, 'topic1');
  if (topic2) validateHex(topic2, 'topic2');
  if (topic3) validateHex(topic3, 'topic3');

  const filter: Record<string, any> = {
    address,
    fromBlock: typeof fromBlock === 'number' ? `0x${fromBlock.toString(16)}` : fromBlock,
    toBlock: typeof toBlock === 'number' ? `0x${toBlock.toString(16)}` : toBlock,
  };
  const topics: (string | null)[] = [];
  if (topic0) topics.push(topic0);
  else if (topic1 || topic2 || topic3) topics.push(null);
  if (topic1) topics.push(topic1);
  else if (topic2 || topic3) topics.push(null);
  if (topic2) topics.push(topic2);
  else if (topic3) topics.push(null);
  if (topic3) topics.push(topic3);
  if (topics.length > 0) filter.topics = topics;

  const result = await cachedRpcCall(
    `logs:${address}:${fromBlock}:${toBlock}:${topic0 || ''}`,
    TTL.TVL,
    'eth_getLogs',
    [filter],
    noCache
  );
  if (!Array.isArray(result)) return [];
  return result;
}

export async function getTransactionCount(
  address: string,
  tag: string = 'latest',
  noCache = false
): Promise<number> {
  validateAddress(address);
  validateBlockTag(tag);
  const result = await cachedRpcCall(
    `txcount:${address}:${tag}`,
    TTL.GAS,
    'eth_getTransactionCount',
    [address, tag],
    noCache
  );
  return parseInt(result, 16);
}

// Batch balance fetch for multiple addresses (up to 20)
export async function getBalanceMulti(
  addresses: string[],
  noCache = false
): Promise<any[]> {
  for (const addr of addresses) {
    validateAddress(addr);
  }

  if (!nodeUrl) {
    throw new Error(
      'ETH_NODE_URL not set. Call set_node_url with your node URL (e.g. http://localhost:8545).'
    );
  }

  // Build JSON-RPC 2.0 batch request
  if (requestId >= Number.MAX_SAFE_INTEGER) {
    requestId = 1;
  }
  const startId = requestId;
  const batchBody = addresses.map((address, i) => ({
    jsonrpc: '2.0' as const,
    method: 'eth_getBalance',
    params: [address, 'latest'],
    id: startId + i,
  }));
  requestId = startId + addresses.length;

  try {
    const response = await fetch(nodeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batchBody),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Node returned HTTP ${response.status}`);
    }

    const data = await response.json();

    // If response is not an array, node doesn't support batch -- fall back to parallel individual calls
    if (!Array.isArray(data)) {
      return fallbackGetBalanceMulti(addresses, noCache);
    }

    // Sort by id to match input order
    const sorted = data.sort((a: any, b: any) => a.id - b.id);

    return sorted.map((item: any, i: number) => {
      if (item.error) {
        return { account: addresses[i], balance: `Error: ${item.error.message || JSON.stringify(item.error)}` };
      }
      return { account: addresses[i], balance: weiToEth(BigInt(item.result).toString()) };
    });
  } catch (error) {
    // If batch fails entirely, try parallel individual calls
    const sensitiveKeys = buildSensitiveKeys(nodeUrl);
    try {
      return await fallbackGetBalanceMulti(addresses, noCache);
    } catch {
      throw new Error(sanitizeError(error, sensitiveKeys));
    }
  }
}

async function fallbackGetBalanceMulti(
  addresses: string[],
  noCache: boolean
): Promise<any[]> {
  const results = await Promise.all(
    addresses.map(async (address) => {
      const balance = await getBalance(address, noCache);
      return { account: address, balance };
    })
  );
  return results;
}
