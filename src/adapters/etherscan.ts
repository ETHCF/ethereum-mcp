// Etherscan API adapter - supports 60+ chains via Etherscan V2 API
import { cachedFetch, TTL } from '../utils/cache.js';
import { sanitizeError } from '../utils/security.js';

const ETHERSCAN_BASE_URL = 'https://api.etherscan.io/v2/api';
let etherscanApiKey = process.env.ETHERSCAN_API_KEY || '';
let defaultChainId = '1'; // Ethereum mainnet

// Supported chains with their chain IDs
export const SUPPORTED_CHAINS: Record<string, string> = {
  // Mainnets
  ethereum: '1',
  bnb: '56',
  polygon: '137',
  base: '8453',
  arbitrum: '42161',
  'arbitrum-nova': '42170',
  optimism: '10',
  linea: '59144',
  blast: '81457',
  avalanche: '43114',
  gnosis: '100',
  celo: '42220',
  mantle: '5000',
  scroll: '534352',
  taiko: '167000',
  moonbeam: '1284',
  moonriver: '1285',
  fantom: '250',
  cronos: '25',
  fraxtal: '252',
  opbnb: '204',
  world: '480',
  sonic: '146',
  unichain: '130',
  abstract: '2741',
  berachain: '80094',
  sei: '1329',
  apechain: '33139',
  xdc: '50',
  bittorrent: '199',
  // Testnets
  sepolia: '11155111',
  holesky: '17000',
  'base-sepolia': '84532',
  'arbitrum-sepolia': '421614',
  'optimism-sepolia': '11155420',
};

export function isConfigured(): boolean {
  return !!etherscanApiKey;
}

export function setApiKey(key: string): void {
  etherscanApiKey = key;
}

export function setDefaultChain(chainId: string): void {
  defaultChainId = chainId;
}

export function getChainId(chainNameOrId?: string): string {
  if (!chainNameOrId) return defaultChainId;
  // If it's already a number, use it directly
  if (/^\d+$/.test(chainNameOrId)) return chainNameOrId;
  // Otherwise look up by name
  const chainId = SUPPORTED_CHAINS[chainNameOrId.toLowerCase()];
  if (!chainId) {
    throw new Error(
      `Unknown chain: ${chainNameOrId}. Use chain ID directly or one of: ${Object.keys(SUPPORTED_CHAINS).join(', ')}`
    );
  }
  return chainId;
}

export function getSupportedChains(): string[] {
  return Object.keys(SUPPORTED_CHAINS);
}

export async function request(params: Record<string, string>, chainId?: string): Promise<any> {
  if (!etherscanApiKey) {
    throw new Error(
      'Need Etherscan API key. Ask user for their key (free at etherscan.io/apis), then call set_etherscan_key.'
    );
  }

  const url = new URL(ETHERSCAN_BASE_URL);
  url.searchParams.set('chainid', getChainId(chainId));
  url.searchParams.set('apikey', etherscanApiKey);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  try {
    const response = await fetch(url.toString());
    const data = await response.json();

    if (
      data.status === '0' &&
      data.message !== 'No transactions found' &&
      data.message !== 'No records found'
    ) {
      throw new Error(data.result || data.message || 'Etherscan API error');
    }

    return data.result;
  } catch (error) {
    throw new Error(sanitizeError(error, [etherscanApiKey]));
  }
}

// Cached request wrapper
export async function cachedRequest(
  cacheKey: string,
  ttl: number,
  params: Record<string, string>,
  noCache: boolean = false,
  chainId?: string
): Promise<any> {
  const chain = getChainId(chainId);
  return cachedFetch(
    `etherscan:${chain}:${cacheKey}`,
    ttl,
    () => request(params, chainId),
    noCache
  );
}

// Helper functions
export function weiToEth(wei: string): string {
  const weiBigInt = BigInt(wei);
  const ethWhole = weiBigInt / BigInt(10 ** 18);
  const ethFraction = weiBigInt % BigInt(10 ** 18);
  const fractionStr = ethFraction.toString().padStart(18, '0').slice(0, 6);
  return `${ethWhole}.${fractionStr}`;
}

export function formatTimestamp(timestamp: string): string {
  return new Date(parseInt(timestamp) * 1000).toISOString();
}

// ENS Resolution using ensdata.net (reliable ENS resolver API)
export async function resolveAddress(addressOrEns: string): Promise<string> {
  // If it's already a valid address, return it
  if (/^0x[a-fA-F0-9]{40}$/.test(addressOrEns)) {
    return addressOrEns;
  }

  // If it looks like an ENS name, try to resolve it
  if (addressOrEns.includes('.')) {
    try {
      const ensResponse = await fetch(
        `https://api.ensdata.net/${encodeURIComponent(addressOrEns)}`
      );

      if (ensResponse.ok) {
        const ensData = await ensResponse.json();
        if (ensData.address) {
          return ensData.address;
        }
      }

      throw new Error(
        `Could not resolve ENS name "${addressOrEns}". Make sure the name is correct and has an address set.`
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('Could not resolve')) {
        throw error;
      }
      throw new Error(
        `Failed to resolve ENS name "${addressOrEns}": ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  throw new Error(
    `Invalid address format: "${addressOrEns}". Expected a 0x address or ENS name (e.g., vitalik.eth)`
  );
}

// API methods
export async function getBalance(addressOrEns: string, noCache = false): Promise<string> {
  const address = await resolveAddress(addressOrEns);
  const balance = await cachedRequest(
    `balance:${address}`,
    TTL.PRICE,
    { module: 'account', action: 'balance', address, tag: 'latest' },
    noCache
  );
  return weiToEth(balance);
}

export async function getTransactions(
  addressOrEns: string,
  limit: number = 10,
  noCache = false
): Promise<any[]> {
  const address = await resolveAddress(addressOrEns);
  const txs = await cachedRequest(
    `txs:${address}:${limit}`,
    TTL.TVL,
    {
      module: 'account',
      action: 'txlist',
      address,
      startblock: '0',
      endblock: '99999999',
      page: '1',
      offset: String(Math.min(limit, 100)),
      sort: 'desc',
    },
    noCache
  );

  if (!Array.isArray(txs)) return [];

  return txs.map((tx: any) => ({
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    value: `${weiToEth(tx.value)} ETH`,
    timestamp: formatTimestamp(tx.timeStamp),
    status: tx.isError === '0' ? 'success' : 'failed',
  }));
}

// Internal transactions (ETH transfers via contract calls)
export async function getInternalTransactions(
  addressOrEns: string,
  limit: number = 100,
  noCache = false
): Promise<{
  transactions: any[];
  summary: { totalIn: string; totalOut: string; netFlow: string };
}> {
  const address = await resolveAddress(addressOrEns);
  const txs = await cachedRequest(
    `internaltxs:${address}:${limit}`,
    TTL.TVL,
    {
      module: 'account',
      action: 'txlistinternal',
      address,
      startblock: '0',
      endblock: '99999999',
      page: '1',
      offset: String(Math.min(limit, 10000)),
      sort: 'desc',
    },
    noCache
  );

  if (!Array.isArray(txs)) {
    return {
      transactions: [],
      summary: { totalIn: '0', totalOut: '0', netFlow: '0' },
    };
  }

  // Calculate totals
  let totalIn = BigInt(0);
  let totalOut = BigInt(0);
  const lowerAddress = address.toLowerCase();

  for (const tx of txs) {
    if (tx.isError === '0') {
      const value = BigInt(tx.value || '0');
      if (tx.to?.toLowerCase() === lowerAddress) {
        totalIn += value;
      }
      if (tx.from?.toLowerCase() === lowerAddress) {
        totalOut += value;
      }
    }
  }

  const transactions = txs.map((tx: any) => ({
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    value: `${weiToEth(tx.value)} ETH`,
    timestamp: formatTimestamp(tx.timeStamp),
    type: tx.type || 'call',
    status: tx.isError === '0' ? 'success' : 'failed',
  }));

  return {
    transactions,
    summary: {
      totalIn: weiToEth(totalIn.toString()),
      totalOut: weiToEth(totalOut.toString()),
      netFlow: weiToEth((totalIn - totalOut).toString()),
    },
  };
}

export async function getGasPrice(noCache = false): Promise<any> {
  return cachedRequest(
    'gasoracle',
    TTL.GAS,
    { module: 'gastracker', action: 'gasoracle' },
    noCache
  );
}

export async function getBlockNumber(noCache = false): Promise<number> {
  const blockNumber = await cachedRequest(
    'blocknumber',
    TTL.GAS,
    { module: 'proxy', action: 'eth_blockNumber' },
    noCache
  );
  return parseInt(blockNumber, 16);
}

export async function getTokenBalance(
  address: string,
  contractAddress: string,
  noCache = false
): Promise<string> {
  return cachedRequest(
    `token:${address}:${contractAddress}`,
    TTL.PRICE,
    {
      module: 'account',
      action: 'tokenbalance',
      contractaddress: contractAddress,
      address,
      tag: 'latest',
    },
    noCache
  );
}

export async function getContractAbi(address: string, noCache = false): Promise<string> {
  return cachedRequest(
    `abi:${address}`,
    TTL.STATIC,
    { module: 'contract', action: 'getabi', address },
    noCache
  );
}

export async function getEthPrice(noCache = false): Promise<{ usd: number; btc: string }> {
  const price = await cachedRequest(
    'ethprice',
    TTL.PRICE,
    { module: 'stats', action: 'ethprice' },
    noCache
  );
  return {
    usd: parseFloat(price.ethusd),
    btc: price.ethbtc,
  };
}

// ERC-20 Token Transfers
export async function getTokenTransfers(
  addressOrEns: string,
  contractAddress?: string,
  limit: number = 100,
  noCache = false
): Promise<any[]> {
  const address = await resolveAddress(addressOrEns);
  const params: Record<string, string> = {
    module: 'account',
    action: 'tokentx',
    address,
    page: '1',
    offset: String(Math.min(limit, 10000)),
    sort: 'desc',
  };
  if (contractAddress) {
    params.contractaddress = contractAddress;
  }

  const txs = await cachedRequest(
    `tokentx:${address}:${contractAddress || 'all'}:${limit}`,
    TTL.TVL,
    params,
    noCache
  );

  if (!Array.isArray(txs)) return [];

  return txs.map((tx: any) => ({
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    value: tx.value,
    tokenName: tx.tokenName,
    tokenSymbol: tx.tokenSymbol,
    tokenDecimal: tx.tokenDecimal,
    contractAddress: tx.contractAddress,
    timestamp: formatTimestamp(tx.timeStamp),
  }));
}

// ERC-721 NFT Transfers
export async function getNFTTransfers(
  addressOrEns: string,
  contractAddress?: string,
  limit: number = 100,
  noCache = false
): Promise<any[]> {
  const address = await resolveAddress(addressOrEns);
  const params: Record<string, string> = {
    module: 'account',
    action: 'tokennfttx',
    address,
    page: '1',
    offset: String(Math.min(limit, 10000)),
    sort: 'desc',
  };
  if (contractAddress) {
    params.contractaddress = contractAddress;
  }

  const txs = await cachedRequest(
    `nfttx:${address}:${contractAddress || 'all'}:${limit}`,
    TTL.TVL,
    params,
    noCache
  );

  if (!Array.isArray(txs)) return [];

  return txs.map((tx: any) => ({
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    tokenID: tx.tokenID,
    tokenName: tx.tokenName,
    tokenSymbol: tx.tokenSymbol,
    contractAddress: tx.contractAddress,
    timestamp: formatTimestamp(tx.timeStamp),
  }));
}

// Contract Source Code
export async function getContractSourceCode(address: string, noCache = false): Promise<any> {
  const result = await cachedRequest(
    `sourcecode:${address}`,
    TTL.STATIC,
    { module: 'contract', action: 'getsourcecode', address },
    noCache
  );
  if (!Array.isArray(result) || result.length === 0) {
    return null;
  }
  const contract = result[0];
  return {
    contractName: contract.ContractName,
    compilerVersion: contract.CompilerVersion,
    optimizationUsed: contract.OptimizationUsed === '1',
    runs: parseInt(contract.Runs) || 0,
    sourceCode: contract.SourceCode,
    abi: contract.ABI,
    constructorArguments: contract.ConstructorArguments,
    evmVersion: contract.EVMVersion,
    library: contract.Library,
    licenseType: contract.LicenseType,
    proxy: contract.Proxy === '1',
    implementation: contract.Implementation,
  };
}

// Contract Creation Info
export async function getContractCreation(
  addresses: string[],
  noCache = false,
  chainId?: string
): Promise<any[]> {
  const result = await cachedRequest(
    `creation:${addresses.join(',')}`,
    TTL.STATIC,
    {
      module: 'contract',
      action: 'getcontractcreation',
      contractaddresses: addresses.join(','),
    },
    noCache,
    chainId
  );
  if (!Array.isArray(result)) return [];
  return result.map((item: any) => ({
    contractAddress: item.contractAddress,
    creatorAddress: item.contractCreator,
    txHash: item.txHash,
  }));
}

// ============================================
// ADDITIONAL ACCOUNT ENDPOINTS
// ============================================

// Historical balance at specific block
export async function getBalanceHistory(
  addressOrEns: string,
  blockno: number,
  noCache = false,
  chainId?: string
): Promise<string> {
  const address = await resolveAddress(addressOrEns);
  const balance = await cachedRequest(
    `balancehistory:${address}:${blockno}`,
    TTL.STATIC,
    { module: 'account', action: 'balancehistory', address, blockno: String(blockno) },
    noCache,
    chainId
  );
  return weiToEth(balance);
}

// ERC-1155 Token Transfers
export async function getERC1155Transfers(
  addressOrEns: string,
  contractAddress?: string,
  limit: number = 100,
  noCache = false,
  chainId?: string
): Promise<any[]> {
  const address = await resolveAddress(addressOrEns);
  const params: Record<string, string> = {
    module: 'account',
    action: 'token1155tx',
    address,
    page: '1',
    offset: String(Math.min(limit, 10000)),
    sort: 'desc',
  };
  if (contractAddress) params.contractaddress = contractAddress;

  const txs = await cachedRequest(
    `erc1155tx:${address}:${contractAddress || 'all'}:${limit}`,
    TTL.TVL,
    params,
    noCache,
    chainId
  );

  if (!Array.isArray(txs)) return [];
  return txs.map((tx: any) => ({
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    tokenID: tx.tokenID,
    tokenValue: tx.tokenValue,
    tokenName: tx.tokenName,
    tokenSymbol: tx.tokenSymbol,
    contractAddress: tx.contractAddress,
    timestamp: formatTimestamp(tx.timeStamp),
  }));
}

// Beacon Chain Withdrawals
export async function getBeaconWithdrawals(
  addressOrEns: string,
  limit: number = 100,
  noCache = false,
  chainId?: string
): Promise<any[]> {
  const address = await resolveAddress(addressOrEns);
  const result = await cachedRequest(
    `beaconwithdrawals:${address}:${limit}`,
    TTL.TVL,
    {
      module: 'account',
      action: 'txsbeaconwithdrawal',
      address,
      page: '1',
      offset: String(Math.min(limit, 10000)),
      sort: 'desc',
    },
    noCache,
    chainId
  );
  if (!Array.isArray(result)) return [];
  return result;
}

// Get all ERC-20 tokens held by address
export async function getAddressTokenBalance(
  addressOrEns: string,
  noCache = false,
  chainId?: string
): Promise<any[]> {
  const address = await resolveAddress(addressOrEns);
  const result = await cachedRequest(
    `addresstokenbalance:${address}`,
    TTL.PRICE,
    { module: 'account', action: 'addresstokenbalance', address, page: '1', offset: '100' },
    noCache,
    chainId
  );
  if (!Array.isArray(result)) return [];
  return result;
}

// Get all NFTs held by address
export async function getAddressNFTBalance(
  addressOrEns: string,
  noCache = false,
  chainId?: string
): Promise<any[]> {
  const address = await resolveAddress(addressOrEns);
  const result = await cachedRequest(
    `addressnftbalance:${address}`,
    TTL.PRICE,
    { module: 'account', action: 'addresstokennftbalance', address, page: '1', offset: '100' },
    noCache,
    chainId
  );
  if (!Array.isArray(result)) return [];
  return result;
}

// ============================================
// BLOCK ENDPOINTS
// ============================================

export async function getBlockReward(
  blockno: number,
  noCache = false,
  chainId?: string
): Promise<any> {
  return cachedRequest(
    `blockreward:${blockno}`,
    TTL.STATIC,
    { module: 'block', action: 'getblockreward', blockno: String(blockno) },
    noCache,
    chainId
  );
}

export async function getBlockCountdown(
  blockno: number,
  noCache = false,
  chainId?: string
): Promise<any> {
  return cachedRequest(
    `blockcountdown:${blockno}`,
    TTL.GAS,
    { module: 'block', action: 'getblockcountdown', blockno: String(blockno) },
    noCache,
    chainId
  );
}

export async function getBlockByTimestamp(
  timestamp: number,
  closest: 'before' | 'after' = 'before',
  noCache = false,
  chainId?: string
): Promise<number> {
  const result = await cachedRequest(
    `blockbytime:${timestamp}:${closest}`,
    TTL.STATIC,
    { module: 'block', action: 'getblocknobytime', timestamp: String(timestamp), closest },
    noCache,
    chainId
  );
  return parseInt(result);
}

// ============================================
// PROXY ENDPOINTS (Geth/Parity)
// ============================================

export async function getBlockByNumber(
  blockNumber: string | number,
  fullTx: boolean = false,
  noCache = false,
  chainId?: string
): Promise<any> {
  const tag = typeof blockNumber === 'number' ? `0x${blockNumber.toString(16)}` : blockNumber;
  return cachedRequest(
    `block:${tag}:${fullTx}`,
    TTL.STATIC,
    { module: 'proxy', action: 'eth_getBlockByNumber', tag, boolean: String(fullTx) },
    noCache,
    chainId
  );
}

export async function getTransactionByHash(
  txhash: string,
  noCache = false,
  chainId?: string
): Promise<any> {
  return cachedRequest(
    `tx:${txhash}`,
    TTL.STATIC,
    { module: 'proxy', action: 'eth_getTransactionByHash', txhash },
    noCache,
    chainId
  );
}

export async function getTransactionReceipt(
  txhash: string,
  noCache = false,
  chainId?: string
): Promise<any> {
  return cachedRequest(
    `txreceipt:${txhash}`,
    TTL.STATIC,
    { module: 'proxy', action: 'eth_getTransactionReceipt', txhash },
    noCache,
    chainId
  );
}

export async function ethCall(
  to: string,
  data: string,
  tag: string = 'latest',
  noCache = false,
  chainId?: string
): Promise<string> {
  return cachedRequest(
    `ethcall:${to}:${data}:${tag}`,
    TTL.GAS,
    { module: 'proxy', action: 'eth_call', to, data, tag },
    noCache,
    chainId
  );
}

export async function getCode(
  address: string,
  tag: string = 'latest',
  noCache = false,
  chainId?: string
): Promise<string> {
  return cachedRequest(
    `code:${address}:${tag}`,
    TTL.STATIC,
    { module: 'proxy', action: 'eth_getCode', address, tag },
    noCache,
    chainId
  );
}

export async function getStorageAt(
  address: string,
  position: string,
  tag: string = 'latest',
  noCache = false,
  chainId?: string
): Promise<string> {
  return cachedRequest(
    `storage:${address}:${position}:${tag}`,
    TTL.GAS,
    { module: 'proxy', action: 'eth_getStorageAt', address, position, tag },
    noCache,
    chainId
  );
}

export async function estimateGas(
  to: string,
  data: string,
  value: string = '0x0',
  noCache = false,
  chainId?: string
): Promise<string> {
  return cachedRequest(
    `estimategas:${to}:${data}`,
    TTL.GAS,
    { module: 'proxy', action: 'eth_estimateGas', to, data, value },
    noCache,
    chainId
  );
}

// ============================================
// LOGS ENDPOINTS
// ============================================

export async function getLogs(
  address: string,
  fromBlock: number | string = 0,
  toBlock: number | string = 'latest',
  topic0?: string,
  topic1?: string,
  topic2?: string,
  topic3?: string,
  noCache = false,
  chainId?: string
): Promise<any[]> {
  const params: Record<string, string> = {
    module: 'logs',
    action: 'getLogs',
    address,
    fromBlock: String(fromBlock),
    toBlock: String(toBlock),
  };
  if (topic0) params.topic0 = topic0;
  if (topic1) params.topic1 = topic1;
  if (topic2) params.topic2 = topic2;
  if (topic3) params.topic3 = topic3;

  const result = await cachedRequest(
    `logs:${address}:${fromBlock}:${toBlock}:${topic0 || ''}`,
    TTL.TVL,
    params,
    noCache,
    chainId
  );
  if (!Array.isArray(result)) return [];
  return result;
}

// ============================================
// STATS ENDPOINTS
// ============================================

export async function getEthSupply(noCache = false, chainId?: string): Promise<string> {
  const result = await cachedRequest(
    'ethsupply',
    TTL.TVL,
    { module: 'stats', action: 'ethsupply' },
    noCache,
    chainId
  );
  return weiToEth(result);
}

export async function getEthSupply2(noCache = false, chainId?: string): Promise<any> {
  return cachedRequest(
    'ethsupply2',
    TTL.TVL,
    { module: 'stats', action: 'ethsupply2' },
    noCache,
    chainId
  );
}

export async function getNodeCount(noCache = false, chainId?: string): Promise<any> {
  return cachedRequest(
    'nodecount',
    TTL.TVL,
    { module: 'stats', action: 'nodecount' },
    noCache,
    chainId
  );
}

// ============================================
// TRANSACTION STATUS ENDPOINTS
// ============================================

export async function getTransactionStatus(
  txhash: string,
  noCache = false,
  chainId?: string
): Promise<{ isError: boolean; errDescription: string }> {
  const result = await cachedRequest(
    `txstatus:${txhash}`,
    TTL.STATIC,
    { module: 'transaction', action: 'getstatus', txhash },
    noCache,
    chainId
  );
  return {
    isError: result.isError === '1',
    errDescription: result.errDescription || '',
  };
}

export async function getTransactionReceiptStatus(
  txhash: string,
  noCache = false,
  chainId?: string
): Promise<boolean> {
  const result = await cachedRequest(
    `txreceiptstatus:${txhash}`,
    TTL.STATIC,
    { module: 'transaction', action: 'gettxreceiptstatus', txhash },
    noCache,
    chainId
  );
  return result.status === '1';
}

// ============================================
// TOKEN ENDPOINTS
// ============================================

export async function getTokenSupply(
  contractAddress: string,
  noCache = false,
  chainId?: string
): Promise<string> {
  return cachedRequest(
    `tokensupply:${contractAddress}`,
    TTL.PRICE,
    { module: 'stats', action: 'tokensupply', contractaddress: contractAddress },
    noCache,
    chainId
  );
}

export async function getTokenInfo(
  contractAddress: string,
  noCache = false,
  chainId?: string
): Promise<any> {
  const result = await cachedRequest(
    `tokeninfo:${contractAddress}`,
    TTL.STATIC,
    { module: 'token', action: 'tokeninfo', contractaddress: contractAddress },
    noCache,
    chainId
  );
  if (!Array.isArray(result) || result.length === 0) return null;
  return result[0];
}

export async function getTokenHolders(
  contractAddress: string,
  page: number = 1,
  offset: number = 100,
  noCache = false,
  chainId?: string
): Promise<any[]> {
  const result = await cachedRequest(
    `tokenholders:${contractAddress}:${page}:${offset}`,
    TTL.TVL,
    {
      module: 'token',
      action: 'tokenholderlist',
      contractaddress: contractAddress,
      page: String(page),
      offset: String(offset),
    },
    noCache,
    chainId
  );
  if (!Array.isArray(result)) return [];
  return result;
}

// ============================================
// ADDITIONAL ACCOUNT ENDPOINTS
// ============================================

// Multi-address balance (up to 20 addresses)
export async function getBalanceMulti(
  addresses: string[],
  noCache = false,
  chainId?: string
): Promise<any[]> {
  const result = await cachedRequest(
    `balancemulti:${addresses.join(',')}`,
    TTL.PRICE,
    { module: 'account', action: 'balancemulti', address: addresses.join(','), tag: 'latest' },
    noCache,
    chainId
  );
  if (!Array.isArray(result)) return [];
  return result.map((item: any) => ({
    account: item.account,
    balance: weiToEth(item.balance),
  }));
}

// Blocks mined by address
export async function getMinedBlocks(
  addressOrEns: string,
  blocktype: 'blocks' | 'uncles' = 'blocks',
  page: number = 1,
  offset: number = 100,
  noCache = false,
  chainId?: string
): Promise<any[]> {
  const address = await resolveAddress(addressOrEns);
  const result = await cachedRequest(
    `minedblocks:${address}:${blocktype}:${page}:${offset}`,
    TTL.TVL,
    {
      module: 'account',
      action: 'getminedblocks',
      address,
      blocktype,
      page: String(page),
      offset: String(offset),
    },
    noCache,
    chainId
  );
  if (!Array.isArray(result)) return [];
  return result;
}

// ============================================
// ADDITIONAL PROXY ENDPOINTS
// ============================================

export async function getTransactionCount(
  address: string,
  tag: string = 'latest',
  noCache = false,
  chainId?: string
): Promise<number> {
  const result = await cachedRequest(
    `txcount:${address}:${tag}`,
    TTL.GAS,
    { module: 'proxy', action: 'eth_getTransactionCount', address, tag },
    noCache,
    chainId
  );
  return parseInt(result, 16);
}

export async function getGasPriceProxy(noCache = false, chainId?: string): Promise<string> {
  const result = await cachedRequest(
    'gasprice_proxy',
    TTL.GAS,
    { module: 'proxy', action: 'eth_gasPrice' },
    noCache,
    chainId
  );
  return result;
}

// ============================================
// ADDITIONAL GAS TRACKER ENDPOINTS
// ============================================

export async function getGasEstimate(
  gasprice: number,
  noCache = false,
  chainId?: string
): Promise<string> {
  return cachedRequest(
    `gasestimate:${gasprice}`,
    TTL.GAS,
    { module: 'gastracker', action: 'gasestimate', gasprice: String(gasprice) },
    noCache,
    chainId
  );
}

// ============================================
// DAILY STATS ENDPOINTS
// ============================================

export async function getDailyAvgBlockSize(
  startdate: string,
  enddate: string,
  sort: 'asc' | 'desc' = 'asc',
  noCache = false,
  chainId?: string
): Promise<any[]> {
  const result = await cachedRequest(
    `dailyavgblocksize:${startdate}:${enddate}`,
    TTL.STATIC,
    { module: 'stats', action: 'dailyavgblocksize', startdate, enddate, sort },
    noCache,
    chainId
  );
  if (!Array.isArray(result)) return [];
  return result;
}

export async function getDailyBlockCount(
  startdate: string,
  enddate: string,
  sort: 'asc' | 'desc' = 'asc',
  noCache = false,
  chainId?: string
): Promise<any[]> {
  const result = await cachedRequest(
    `dailyblkcount:${startdate}:${enddate}`,
    TTL.STATIC,
    { module: 'stats', action: 'dailyblkcount', startdate, enddate, sort },
    noCache,
    chainId
  );
  if (!Array.isArray(result)) return [];
  return result;
}

export async function getDailyBlockRewards(
  startdate: string,
  enddate: string,
  sort: 'asc' | 'desc' = 'asc',
  noCache = false,
  chainId?: string
): Promise<any[]> {
  const result = await cachedRequest(
    `dailyblockrewards:${startdate}:${enddate}`,
    TTL.STATIC,
    { module: 'stats', action: 'dailyblockrewards', startdate, enddate, sort },
    noCache,
    chainId
  );
  if (!Array.isArray(result)) return [];
  return result;
}

export async function getDailyAvgBlockTime(
  startdate: string,
  enddate: string,
  sort: 'asc' | 'desc' = 'asc',
  noCache = false,
  chainId?: string
): Promise<any[]> {
  const result = await cachedRequest(
    `dailyavgblocktime:${startdate}:${enddate}`,
    TTL.STATIC,
    { module: 'stats', action: 'dailyavgblocktime', startdate, enddate, sort },
    noCache,
    chainId
  );
  if (!Array.isArray(result)) return [];
  return result;
}

export async function getDailyUncleCount(
  startdate: string,
  enddate: string,
  sort: 'asc' | 'desc' = 'asc',
  noCache = false,
  chainId?: string
): Promise<any[]> {
  const result = await cachedRequest(
    `dailyuncleblkcount:${startdate}:${enddate}`,
    TTL.STATIC,
    { module: 'stats', action: 'dailyuncleblkcount', startdate, enddate, sort },
    noCache,
    chainId
  );
  if (!Array.isArray(result)) return [];
  return result;
}

export async function getDailyAvgGasLimit(
  startdate: string,
  enddate: string,
  sort: 'asc' | 'desc' = 'asc',
  noCache = false,
  chainId?: string
): Promise<any[]> {
  const result = await cachedRequest(
    `dailyavggaslimit:${startdate}:${enddate}`,
    TTL.STATIC,
    { module: 'stats', action: 'dailyavggaslimit', startdate, enddate, sort },
    noCache,
    chainId
  );
  if (!Array.isArray(result)) return [];
  return result;
}

export async function getDailyGasUsed(
  startdate: string,
  enddate: string,
  sort: 'asc' | 'desc' = 'asc',
  noCache = false,
  chainId?: string
): Promise<any[]> {
  const result = await cachedRequest(
    `dailygasused:${startdate}:${enddate}`,
    TTL.STATIC,
    { module: 'stats', action: 'dailygasused', startdate, enddate, sort },
    noCache,
    chainId
  );
  if (!Array.isArray(result)) return [];
  return result;
}

export async function getDailyAvgGasPrice(
  startdate: string,
  enddate: string,
  sort: 'asc' | 'desc' = 'asc',
  noCache = false,
  chainId?: string
): Promise<any[]> {
  const result = await cachedRequest(
    `dailyavggasprice:${startdate}:${enddate}`,
    TTL.STATIC,
    { module: 'stats', action: 'dailyavggasprice', startdate, enddate, sort },
    noCache,
    chainId
  );
  if (!Array.isArray(result)) return [];
  return result;
}

export async function getDailyTxnFee(
  startdate: string,
  enddate: string,
  sort: 'asc' | 'desc' = 'asc',
  noCache = false,
  chainId?: string
): Promise<any[]> {
  const result = await cachedRequest(
    `dailytxnfee:${startdate}:${enddate}`,
    TTL.STATIC,
    { module: 'stats', action: 'dailytxnfee', startdate, enddate, sort },
    noCache,
    chainId
  );
  if (!Array.isArray(result)) return [];
  return result;
}

export async function getDailyNewAddress(
  startdate: string,
  enddate: string,
  sort: 'asc' | 'desc' = 'asc',
  noCache = false,
  chainId?: string
): Promise<any[]> {
  const result = await cachedRequest(
    `dailynewaddress:${startdate}:${enddate}`,
    TTL.STATIC,
    { module: 'stats', action: 'dailynewaddress', startdate, enddate, sort },
    noCache,
    chainId
  );
  if (!Array.isArray(result)) return [];
  return result;
}

export async function getDailyNetUtilization(
  startdate: string,
  enddate: string,
  sort: 'asc' | 'desc' = 'asc',
  noCache = false,
  chainId?: string
): Promise<any[]> {
  const result = await cachedRequest(
    `dailynetutilization:${startdate}:${enddate}`,
    TTL.STATIC,
    { module: 'stats', action: 'dailynetutilization', startdate, enddate, sort },
    noCache,
    chainId
  );
  if (!Array.isArray(result)) return [];
  return result;
}

export async function getDailyAvgHashrate(
  startdate: string,
  enddate: string,
  sort: 'asc' | 'desc' = 'asc',
  noCache = false,
  chainId?: string
): Promise<any[]> {
  const result = await cachedRequest(
    `dailyavghashrate:${startdate}:${enddate}`,
    TTL.STATIC,
    { module: 'stats', action: 'dailyavghashrate', startdate, enddate, sort },
    noCache,
    chainId
  );
  if (!Array.isArray(result)) return [];
  return result;
}

export async function getDailyTxCount(
  startdate: string,
  enddate: string,
  sort: 'asc' | 'desc' = 'asc',
  noCache = false,
  chainId?: string
): Promise<any[]> {
  const result = await cachedRequest(
    `dailytx:${startdate}:${enddate}`,
    TTL.STATIC,
    { module: 'stats', action: 'dailytx', startdate, enddate, sort },
    noCache,
    chainId
  );
  if (!Array.isArray(result)) return [];
  return result;
}
