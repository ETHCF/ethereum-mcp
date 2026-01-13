// Blobscan API adapter (free, no key needed)
// Per-blob granularity and real-time blobspace stats
import { cachedFetch, TTL } from '../utils/cache.js';
import { RateLimiter } from '../utils/security.js';

const BASE_URL = 'https://api.blobscan.com';

// Rate limiter: ~60 req/min, use 50 to be safe
const rateLimiter = new RateLimiter(50, 60 * 1000);

async function request(endpoint: string): Promise<any> {
  await rateLimiter.waitForSlot();

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('Blobscan rate limit exceeded. Please wait a moment.');
    }
    throw new Error(`Blobscan API error: ${response.statusText}`);
  }

  return response.json();
}

// Get a specific blob by versioned hash
export async function getBlob(hash: string, noCache = false): Promise<any> {
  return cachedFetch(
    `blobscan:blob:${hash}`,
    TTL.STATIC, // Blobs are immutable
    () => request(`/blobs/${hash}`),
    noCache
  );
}

// Get recent blobs
export async function getRecentBlobs(limit: number = 10, noCache = false): Promise<any[]> {
  const data = await cachedFetch(
    `blobscan:recent:${limit}`,
    30 * 1000, // 30 second cache
    () => request(`/blobs?ps=${Math.min(limit, 100)}&sort=desc`),
    noCache
  );
  return data.blobs || data || [];
}

// Get blob statistics - derived from recent data since /stats endpoints are deprecated
export async function getBlobStats(noCache = false): Promise<any> {
  // Get recent blobs to derive stats
  const blobs = await getRecentBlobs(100, noCache);
  const totalSize = blobs.reduce((sum: number, b: any) => sum + (b.size || 0), 0);
  return {
    recentBlobCount: blobs.length,
    avgBlobSize: blobs.length > 0 ? Math.round(totalSize / blobs.length) : 0,
    totalRecentSize: totalSize,
  };
}

// Get overall stats - derived from recent data
export async function getOverallStats(noCache = false): Promise<any> {
  const blobs = await getRecentBlobs(50, noCache);
  const txs = await getTransactions(50, noCache);
  return {
    recentBlobs: blobs.length,
    recentTransactions: txs.length,
  };
}

// Get daily stats - derived from recent blocks
export async function getDailyStats(noCache = false): Promise<any> {
  const block = await getLatestBlock(noCache);
  return {
    latestBlock: block?.number || 0,
    latestSlot: block?.slot || 0,
    timestamp: block?.timestamp || new Date().toISOString(),
  };
}

// Get block stats - derived from latest block
export async function getBlockStats(noCache = false): Promise<any> {
  const block = await getLatestBlock(noCache);
  return {
    latestBlockNumber: block?.number || 0,
    blobGasUsed: block?.blobGasUsed || '0',
    blobGasPrice: block?.blobGasPrice || '0',
  };
}

// Get transaction stats - derived from recent transactions
export async function getTransactionStats(noCache = false): Promise<any> {
  const txs = await getTransactions(50, noCache);
  const totalBlobs = txs.reduce((sum: number, t: any) => sum + (t.blobs?.length || 0), 0);
  return {
    recentTransactions: txs.length,
    totalBlobs,
    avgBlobsPerTx: txs.length > 0 ? (totalBlobs / txs.length).toFixed(2) : '0',
  };
}

// Get counts - derived from pagination info or recent queries
export async function getBlobCount(noCache = false): Promise<number> {
  // API no longer exposes count endpoint, return recent count
  const blobs = await getRecentBlobs(1, noCache);
  return blobs.length > 0 ? -1 : 0; // -1 indicates "many" since exact count unavailable
}

export async function getBlockCount(noCache = false): Promise<number> {
  const block = await getLatestBlock(noCache);
  return block?.number || 0; // Use latest block number as approximate count
}

export async function getTransactionCount(noCache = false): Promise<number> {
  const txs = await getTransactions(1, noCache);
  return txs.length > 0 ? -1 : 0; // -1 indicates "many" since exact count unavailable
}

// Get latest block with blobs
export async function getLatestBlock(noCache = false): Promise<any> {
  return cachedFetch(
    'blobscan:latest-block',
    30 * 1000, // 30 second cache
    () => request('/blocks/latest'),
    noCache
  );
}

// Get transactions with blobs
export async function getTransactions(limit: number = 10, noCache = false): Promise<any[]> {
  const data = await cachedFetch(
    `blobscan:transactions:${limit}`,
    30 * 1000,
    () => request(`/transactions?ps=${Math.min(limit, 100)}&sort=desc`),
    noCache
  );
  return data.transactions || data || [];
}

// Get transaction by hash
export async function getTransaction(hash: string, noCache = false): Promise<any> {
  return cachedFetch(
    `blobscan:tx:${hash}`,
    TTL.STATIC, // Transactions are immutable
    () => request(`/transactions/${hash}`),
    noCache
  );
}

// Search across blobs, blocks, transactions, addresses
export async function search(query: string, noCache = false): Promise<any> {
  return cachedFetch(
    `blobscan:search:${query}`,
    60 * 1000,
    () => request(`/search?query=${encodeURIComponent(query)}`),
    noCache
  );
}

// Get blobs by address (sender)
export async function getBlobsByAddress(
  address: string,
  limit: number = 10,
  noCache = false
): Promise<any[]> {
  const data = await cachedFetch(
    `blobscan:address:${address}:${limit}`,
    30 * 1000,
    () => request(`/blobs?from=${address}&ps=${Math.min(limit, 100)}&sort=desc`),
    noCache
  );
  return data.blobs || data || [];
}

// Get block with blobs
export async function getBlockBlobs(blockNumber: number | string, noCache = false): Promise<any> {
  return cachedFetch(
    `blobscan:block:${blockNumber}`,
    TTL.STATIC, // Blocks are immutable
    () => request(`/blocks/${blockNumber}`),
    noCache
  );
}

// Formatted getters for tools
export async function getFormattedRecentBlobs(
  limit: number = 10,
  noCache = false
): Promise<
  Array<{
    hash: string;
    size: number;
    block: number;
    timestamp: string;
    txHash: string;
  }>
> {
  try {
    const blobs = await getRecentBlobs(limit, noCache);
    return blobs.map((b: any) => ({
      hash: b.versionedHash || b.hash,
      size: b.size || 0,
      block: b.blockNumber || b.block,
      timestamp: b.blockTimestamp || b.timestamp || 'N/A',
      txHash: b.txHash || 'N/A',
    }));
  } catch (error) {
    console.error('Blobscan recent blobs error:', error);
    return [];
  }
}

export async function getFormattedBlobStats(noCache = false): Promise<{
  totalBlobs: number;
  totalSize: string;
  avgBlobSize: number;
  totalTransactions: number;
} | null> {
  try {
    const stats = await getBlobStats(noCache);
    const overall = await getOverallStats(noCache);

    return {
      totalBlobs: stats.recentBlobCount || 0,
      totalSize: formatBytes(stats.totalRecentSize || 0),
      avgBlobSize: stats.avgBlobSize || 0,
      totalTransactions: overall.recentTransactions || 0,
    };
  } catch (error) {
    console.error('Blobscan stats error:', error);
    return null;
  }
}

export async function getFormattedBlob(
  hash: string,
  noCache = false
): Promise<{
  hash: string;
  size: number;
  block: number;
  timestamp: string;
  txHash: string;
  commitment: string;
} | null> {
  try {
    const blob = await getBlob(hash, noCache);
    return {
      hash: blob.versionedHash || hash,
      size: blob.size || 0,
      block: blob.blockNumber || 0,
      timestamp: blob.blockTimestamp || 'N/A',
      txHash: blob.txHash || 'N/A',
      commitment: blob.commitment || 'N/A',
    };
  } catch (error) {
    console.error('Blobscan blob error:', error);
    return null;
  }
}

// Helper
function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(2)} KB`;
  return `${bytes} B`;
}

// Formatted transaction getter
export async function getFormattedTransaction(
  hash: string,
  noCache = false
): Promise<{
  hash: string;
  block: number;
  from: string;
  to: string;
  blobCount: number;
  blobGasUsed: number;
  blobGasPrice: string;
  timestamp: string;
} | null> {
  try {
    const tx = await getTransaction(hash, noCache);
    return {
      hash: tx.hash || hash,
      block: tx.blockNumber || 0,
      from: tx.from || 'N/A',
      to: tx.to || 'N/A',
      blobCount: tx.blobs?.length || 0,
      blobGasUsed: tx.blobGasUsed || 0,
      blobGasPrice: tx.blobGasPrice || '0',
      timestamp: tx.blockTimestamp || 'N/A',
    };
  } catch (error) {
    console.error('Blobscan transaction error:', error);
    return null;
  }
}

// Formatted transactions list
export async function getFormattedTransactions(
  limit: number = 10,
  noCache = false
): Promise<
  Array<{
    hash: string;
    block: number;
    from: string;
    blobCount: number;
    timestamp: string;
  }>
> {
  try {
    const txs = await getTransactions(limit, noCache);
    return txs.map((tx: any) => ({
      hash: tx.hash,
      block: tx.blockNumber || 0,
      from: tx.from || 'N/A',
      blobCount: tx.blobs?.length || tx.blobsCount || 0,
      timestamp: tx.blockTimestamp || 'N/A',
    }));
  } catch (error) {
    console.error('Blobscan transactions error:', error);
    return [];
  }
}

// Formatted daily stats - derived from latest block and recent data
export async function getFormattedDailyStats(noCache = false): Promise<{
  date: string;
  latestBlock: number;
  latestSlot: number;
  recentBlobs: number;
  recentTransactions: number;
} | null> {
  try {
    const stats = await getDailyStats(noCache);
    const overall = await getOverallStats(noCache);
    return {
      date: stats.timestamp || new Date().toISOString(),
      latestBlock: stats.latestBlock || 0,
      latestSlot: stats.latestSlot || 0,
      recentBlobs: overall.recentBlobs || 0,
      recentTransactions: overall.recentTransactions || 0,
    };
  } catch (error) {
    console.error('Blobscan daily stats error:', error);
    return null;
  }
}

// Formatted block stats - derived from latest block
export async function getFormattedBlockStats(noCache = false): Promise<{
  latestBlockNumber: number;
  blobGasUsed: string;
  blobGasPrice: string;
} | null> {
  try {
    const stats = await getBlockStats(noCache);
    return {
      latestBlockNumber: stats.latestBlockNumber || 0,
      blobGasUsed: stats.blobGasUsed || '0',
      blobGasPrice: stats.blobGasPrice || '0',
    };
  } catch (error) {
    console.error('Blobscan block stats error:', error);
    return null;
  }
}

// Formatted transaction stats - derived from recent transactions
export async function getFormattedTransactionStats(noCache = false): Promise<{
  recentTransactions: number;
  totalBlobs: number;
  avgBlobsPerTx: string;
} | null> {
  try {
    const stats = await getTransactionStats(noCache);
    return {
      recentTransactions: stats.recentTransactions || 0,
      totalBlobs: stats.totalBlobs || 0,
      avgBlobsPerTx: stats.avgBlobsPerTx || '0',
    };
  } catch (error) {
    console.error('Blobscan transaction stats error:', error);
    return null;
  }
}

// Formatted search results
export async function getFormattedSearch(
  query: string,
  noCache = false
): Promise<{
  blobs: Array<{ hash: string; block: number }>;
  blocks: Array<{ number: number; slot: number }>;
  transactions: Array<{ hash: string; block: number }>;
  addresses: Array<{ address: string }>;
} | null> {
  try {
    const results = await search(query, noCache);
    if (!results) return null;

    return {
      blobs: (results.blobs || []).map((b: any) => ({
        hash: b.versionedHash || b.hash,
        block: b.blockNumber || 0,
      })),
      blocks: (results.blocks || []).map((b: any) => ({
        number: b.number || b.blockNumber || 0,
        slot: b.slot || 0,
      })),
      transactions: (results.transactions || []).map((t: any) => ({
        hash: t.hash,
        block: t.blockNumber || 0,
      })),
      addresses: (results.addresses || []).map((a: any) => ({
        address: a.address || a,
      })),
    };
  } catch (error) {
    console.error('Blobscan search error:', error);
    return null;
  }
}

// Get counts summary
export async function getFormattedCounts(noCache = false): Promise<{
  blobs: number;
  blocks: number;
  transactions: number;
}> {
  try {
    const [blobs, blocks, transactions] = await Promise.all([
      getBlobCount(noCache),
      getBlockCount(noCache),
      getTransactionCount(noCache),
    ]);
    return { blobs, blocks, transactions };
  } catch (error) {
    console.error('Blobscan counts error:', error);
    return { blobs: 0, blocks: 0, transactions: 0 };
  }
}
