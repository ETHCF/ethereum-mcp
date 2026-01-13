/**
 * Endpoint Validation Tests
 *
 * Run with: npm test
 *
 * This test suite validates all API endpoints are working.
 * Run regularly to catch API changes or breakages.
 *
 * Required: ETHERSCAN_API_KEY environment variable
 * Optional: DEFILLAMA_PRO_KEY, COINGECKO_API_KEY, DUNE_API_KEY
 */

import * as etherscan from '../adapters/etherscan.js';
import * as defillama from '../adapters/defillama.js';
import * as coingecko from '../adapters/coingecko.js';
import * as growthepie from '../adapters/growthepie.js';
import * as blobscan from '../adapters/blobscan.js';
import * as dune from '../adapters/dune.js';
import * as router from '../router/index.js';

// Test configuration
const TEST_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'; // vitalik.eth
const TEST_CONTRACT = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // WETH
const TEST_TX_HASH = '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060'; // Historic tx
const TEST_BLOCK = 19000000;
const RATE_LIMIT_DELAY = 250; // ms between calls

interface TestResult {
  name: string;
  provider: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTest(
  name: string,
  provider: string,
  fn: () => Promise<any>,
  validator?: (result: any) => boolean
): Promise<void> {
  const start = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - start;

    // Default validator: result is truthy and not empty
    const isValid = validator ? validator(result) : result !== null && result !== undefined;

    if (isValid) {
      results.push({ name, provider, passed: true, duration });
      console.log(`  [PASS] ${name} (${duration}ms)`);
    } else {
      results.push({ name, provider, passed: false, error: 'Invalid response', duration });
      console.log(`  [FAIL] ${name} - Invalid response (${duration}ms)`);
    }
  } catch (error: any) {
    const duration = Date.now() - start;
    const errorMsg = error.message || String(error);
    results.push({ name, provider, passed: false, error: errorMsg, duration });
    console.log(`  [FAIL] ${name} - ${errorMsg.slice(0, 60)} (${duration}ms)`);
  }
  await sleep(RATE_LIMIT_DELAY);
}

// ============================================
// ETHERSCAN TESTS
// ============================================
async function testEtherscan(): Promise<void> {
  console.log('\n[1] ETHERSCAN');

  if (!process.env.ETHERSCAN_API_KEY) {
    console.log('  [SKIP] Skipped - ETHERSCAN_API_KEY not set');
    return;
  }

  // Account endpoints
  await runTest('getBalance', 'etherscan', () => etherscan.getBalance(TEST_ADDRESS));
  await runTest('getTransactions', 'etherscan', () => etherscan.getTransactions(TEST_ADDRESS, 5));
  await runTest('getInternalTransactions', 'etherscan', () =>
    etherscan.getInternalTransactions(TEST_ADDRESS, 5)
  );
  await runTest('getTokenTransfers', 'etherscan', () =>
    etherscan.getTokenTransfers(TEST_ADDRESS, undefined, 5)
  );
  await runTest('getAddressTokenBalance', 'etherscan', () =>
    etherscan.getAddressTokenBalance(TEST_ADDRESS)
  );
  await runTest('getAddressNFTBalance', 'etherscan', () =>
    etherscan.getAddressNFTBalance(TEST_ADDRESS)
  );

  // Block endpoints
  await runTest('getBlockNumber', 'etherscan', () => etherscan.getBlockNumber());
  await runTest('getBlockByNumber', 'etherscan', () =>
    etherscan.getBlockByNumber(TEST_BLOCK.toString())
  );
  await runTest('getBlockReward', 'etherscan', () => etherscan.getBlockReward(TEST_BLOCK));

  // Transaction endpoints
  await runTest('getTransactionByHash', 'etherscan', () =>
    etherscan.getTransactionByHash(TEST_TX_HASH)
  );
  await runTest('getTransactionReceipt', 'etherscan', () =>
    etherscan.getTransactionReceipt(TEST_TX_HASH)
  );

  // Contract endpoints
  await runTest('getContractAbi', 'etherscan', () => etherscan.getContractAbi(TEST_CONTRACT));
  await runTest('getContractSourceCode', 'etherscan', () =>
    etherscan.getContractSourceCode(TEST_CONTRACT)
  );
  await runTest('getContractCreation', 'etherscan', () =>
    etherscan.getContractCreation([TEST_CONTRACT])
  );

  // Stats endpoints
  await runTest('getGasPrice', 'etherscan', () => etherscan.getGasPrice());
  await runTest('getEthPrice', 'etherscan', () => etherscan.getEthPrice());
  await runTest('getEthSupply', 'etherscan', () => etherscan.getEthSupply());

  // Token endpoints
  await runTest('getTokenBalance', 'etherscan', () =>
    etherscan.getTokenBalance(TEST_ADDRESS, TEST_CONTRACT)
  );
}

// ============================================
// DEFILLAMA TESTS
// ============================================
async function testDefillama(): Promise<void> {
  console.log('\n[2] DEFILLAMA');

  // Free endpoints
  await runTest('getChains', 'defillama', () => defillama.getChains());
  await runTest('getProtocolTvl', 'defillama', () => defillama.getProtocolTvl('aave'));
  await runTest('getProtocol', 'defillama', () => defillama.getProtocol('uniswap'));
  await runTest('searchProtocols', 'defillama', () => defillama.searchProtocols('lending'));
  await runTest('getTopYields', 'defillama', () => defillama.getTopYields(undefined, 1000000, 10));
  await runTest('getStablecoins', 'defillama', () => defillama.getStablecoins());
  await runTest('getDexVolumes', 'defillama', () => defillama.getDexVolumes());
  await runTest('getOptionsVolumes', 'defillama', () => defillama.getOptionsVolumes());
  await runTest('getFees', 'defillama', () => defillama.getFees());
  await runTest('getCoinPrices', 'defillama', () =>
    defillama.getCoinPrices('ethereum:' + TEST_CONTRACT)
  );

  // Pro endpoints (skip if no key)
  if (defillama.isProConfigured()) {
    console.log('  [Pro endpoints]');
    await runTest('getBorrowRates', 'defillama', () => defillama.getBorrowRates());
    await runTest('getDerivativesVolumes', 'defillama', () => defillama.getDerivativesVolumes());
    await runTest('getEmissions', 'defillama', () => defillama.getEmissions());
    await runTest('getBridges', 'defillama', () => defillama.getBridges());
  } else {
    console.log('  [SKIP] Pro endpoints skipped - DEFILLAMA_PRO_KEY not set');
  }
}

// ============================================
// COINGECKO TESTS
// ============================================
async function testCoingecko(): Promise<void> {
  console.log('\n[3] COINGECKO');

  await runTest('getPrice', 'coingecko', () => coingecko.getPrice('ethereum'));
  await runTest('getTopCoins', 'coingecko', () => coingecko.getTopCoins(10));
  await runTest('getTrending', 'coingecko', () => coingecko.getTrending());
  await runTest('getGlobalData', 'coingecko', () => coingecko.getGlobalData());
  await runTest('searchCoins', 'coingecko', () => coingecko.searchCoins('uniswap'));
  await runTest('getCoinDetails', 'coingecko', () => coingecko.getCoinDetails('ethereum'));
  await runTest('getExchanges', 'coingecko', () => coingecko.getExchanges(10));
  await runTest('getCategories', 'coingecko', () => coingecko.getCategories());
  await runTest('getDerivatives', 'coingecko', () => coingecko.getDerivatives());

  // Pro endpoints (skip if no key)
  if (coingecko.isProConfigured()) {
    console.log('  [Pro endpoints]');
    await runTest('getTopMovers', 'coingecko', () => coingecko.getTopMovers());
    await runTest('getNewCoins', 'coingecko', () => coingecko.getNewCoins());
  } else {
    console.log('  [SKIP] Pro endpoints skipped - COINGECKO_API_KEY not set');
  }
}

// ============================================
// GROWTHEPIE TESTS
// ============================================
async function testGrowthepie(): Promise<void> {
  console.log('\n[4] GROWTHEPIE');

  await runTest('getL2Overview', 'growthepie', () => growthepie.getL2Overview(10));
  await runTest('getL2Fees', 'growthepie', () => growthepie.getL2Fees());
  await runTest('getL2Chain', 'growthepie', () => growthepie.getL2Chain('arbitrum'));
  await runTest('getBlobData', 'growthepie', () => growthepie.getBlobData());
  await runTest('getAllL2Metrics', 'growthepie', () => growthepie.getAllL2Metrics());
  await runTest('getMetricRanking', 'growthepie', () => growthepie.getMetricRanking('tvl', 10));
  await runTest('listChains', 'growthepie', () => growthepie.listChains());
  await runTest('getMaster', 'growthepie', () => growthepie.getMaster());
}

// ============================================
// BLOBSCAN TESTS
// ============================================
async function testBlobscan(): Promise<void> {
  console.log('\n[5] BLOBSCAN');

  await runTest('getRecentBlobs', 'blobscan', () => blobscan.getRecentBlobs(5));
  await runTest('getBlobStats', 'blobscan', () => blobscan.getBlobStats());
  await runTest('getOverallStats', 'blobscan', () => blobscan.getOverallStats());
  await runTest('getFormattedBlobStats', 'blobscan', () => blobscan.getFormattedBlobStats());
  await runTest('getTransactions', 'blobscan', () => blobscan.getTransactions(5));
  await runTest('getBlobCount', 'blobscan', () => blobscan.getBlobCount());
  await runTest('getBlockCount', 'blobscan', () => blobscan.getBlockCount());
  await runTest('getTransactionCount', 'blobscan', () => blobscan.getTransactionCount());
  await runTest('getLatestBlock', 'blobscan', () => blobscan.getLatestBlock());
  await runTest('getDailyStats', 'blobscan', () => blobscan.getDailyStats());
}

// ============================================
// DUNE TESTS
// ============================================
async function testDune(): Promise<void> {
  console.log('\n[6] DUNE');

  if (!dune.isConfigured()) {
    console.log('  [SKIP] Skipped - DUNE_API_KEY not set');
    return;
  }

  // Use a simple public query for testing
  const TEST_QUERY_ID = 3237721; // A known public query

  // Free tier endpoints
  await runTest('getQueryResults', 'dune', () => dune.getQueryResults(TEST_QUERY_ID));

  // Pro/Plus tier endpoints (skip on free tier)
  console.log('  [SKIP] getQueryInfo skipped - requires Pro/Plus tier');
  console.log('  [SKIP] executeQuery skipped - consumes API credits');
}

// ============================================
// ROUTER TESTS (Smart routing with fallbacks)
// ============================================

async function testRouter(): Promise<void> {
  console.log('\n[7] ROUTER (Smart Fallbacks)');

  // ETH Price with fallbacks
  await runTest(
    'getEthPrice (routed)',
    'router',
    () => router.getEthPrice(),
    (r) => r.price > 0
  );

  // Token price by name
  await runTest(
    'getTokenPrice("bitcoin")',
    'router',
    () => router.getTokenPrice('bitcoin'),
    (r) => r.price > 0
  );

  // L2 TVL with fallbacks
  await runTest(
    'getL2Tvl("arbitrum")',
    'router',
    () => router.getL2Tvl('arbitrum'),
    (r) => r.tvl > 0
  );

  // Blob stats with fallbacks
  await runTest(
    'getBlobStats (routed)',
    'router',
    () => router.getBlobStats(),
    (r) => r.recentBlobCount >= 0
  );

  // Health check
  await runTest(
    'checkHealth',
    'router',
    () => router.checkHealth(),
    (r) => Array.isArray(r) && r.length > 0
  );

  // Source comparison
  await runTest(
    'compareEthPrice',
    'router',
    () => router.compareEthPrice(),
    (r) => r.results.length > 0
  );
}

// ============================================
// MAIN
// ============================================
async function main(): Promise<void> {
  console.log('===========================================================');
  console.log('  ETHEREUM MCP - ENDPOINT VALIDATION TESTS');
  console.log('===========================================================');
  console.log(`  Time: ${new Date().toISOString()}`);
  console.log(`  Etherscan Key: ${process.env.ETHERSCAN_API_KEY ? '[OK]' : '[FAIL]'}`);
  console.log(`  DefiLlama Pro: ${process.env.DEFILLAMA_PRO_KEY ? '[OK]' : '[FAIL]'}`);
  console.log(`  CoinGecko Pro: ${process.env.COINGECKO_API_KEY ? '[OK]' : '[FAIL]'}`);
  console.log(`  Dune Key: ${process.env.DUNE_API_KEY ? '[OK]' : '[FAIL]'}`);
  console.log('===========================================================');

  const startTime = Date.now();

  await testEtherscan();
  await testDefillama();
  await testCoingecko();
  await testGrowthepie();
  await testBlobscan();
  await testDune();
  await testRouter();

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // Summary
  console.log('\n===========================================================');
  console.log('  SUMMARY');
  console.log('===========================================================');

  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);

  const byProvider = results.reduce(
    (acc, r) => {
      if (!acc[r.provider]) acc[r.provider] = { passed: 0, failed: 0 };
      if (r.passed) acc[r.provider].passed++;
      else acc[r.provider].failed++;
      return acc;
    },
    {} as Record<string, { passed: number; failed: number }>
  );

  for (const [provider, counts] of Object.entries(byProvider)) {
    const status = counts.failed === 0 ? '[OK]' : '[FAIL]';
    console.log(
      `  ${status} ${provider}: ${counts.passed}/${counts.passed + counts.failed} passed`
    );
  }

  console.log('-----------------------------------------------------------');
  console.log(`  Total: ${passed.length}/${results.length} passed (${totalTime}s)`);

  if (failed.length > 0) {
    console.log('\n  FAILURES:');
    for (const f of failed) {
      console.log(`    • ${f.provider}/${f.name}: ${f.error?.slice(0, 50)}`);
    }
  }

  console.log('===========================================================\n');

  // Exit with error code if any tests failed
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
