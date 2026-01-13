#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Adapters
import * as etherscan from './adapters/etherscan.js';
import * as defillama from './adapters/defillama.js';
import * as growthepie from './adapters/growthepie.js';
import * as coingecko from './adapters/coingecko.js';
import * as blobscan from './adapters/blobscan.js';
import * as dune from './adapters/dune.js';

// Router (smart routing with fallbacks)
import * as router from './router/index.js';

// Check Etherscan config
if (!etherscan.isConfigured()) {
  console.error('Warning: ETHERSCAN_API_KEY not set - Etherscan tools will be disabled');
  console.error('Get a free API key at: https://etherscan.io/apis');
}

// Helper for formatting
function formatUSD(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

// Fuzzy matching helper - finds best match from a list
function findBestMatch(query: string, items: string[]): string | null {
  const q = query.toLowerCase().trim();

  // Exact match first
  const exact = items.find((i) => i.toLowerCase() === q);
  if (exact) return exact;

  // Starts with match
  const startsWith = items.find((i) => i.toLowerCase().startsWith(q));
  if (startsWith) return startsWith;

  // Contains match (prefer shorter matches)
  const contains = items
    .filter((i) => i.toLowerCase().includes(q))
    .sort((a, b) => a.length - b.length);
  if (contains.length > 0) return contains[0];

  // Reverse contains (query contains item name)
  const reverseContains = items
    .filter((i) => q.includes(i.toLowerCase()))
    .sort((a, b) => b.length - a.length);
  if (reverseContains.length > 0) return reverseContains[0];

  return null;
}

const server = new McpServer({
  name: 'ethereum-mcp',
  version: '2.0.0',
});

// ============================================
// ONBOARDING
// ============================================

server.tool(
  'talk_to_ethereum',
  'Start here - introduction and example queries for Ethereum researchers',
  {},
  async () => {
    const etherscanStatus = etherscan.isConfigured() ? '[OK] Ready' : '[X] Need API key';
    const defillamaProStatus = defillama.isProConfigured() ? '[OK] Pro enabled' : '(Pro optional)';
    const coingeckoProStatus = coingecko.isProConfigured() ? '[OK] Pro enabled' : '(Pro optional)';
    return {
      content: [
        {
          type: 'text' as const,
          text: `* ETHEREUM MCP — Ready

Query Ethereum and DeFi data in plain English. Built by ECF for researchers.

STATUS:
* Etherscan: ${etherscanStatus} (balances, transactions, gas, contracts)
* DefiLlama: [OK] Ready ${defillamaProStatus} (TVL, yields, stablecoins, DEX volumes)
* CoinGecko: [OK] Ready ${coingeckoProStatus} (prices, exchanges, NFTs, derivatives)
* growthepie: [OK] Ready (L2 metrics, fees, activity)
* Blobscan: [OK] Ready (EIP-4844 blob data)
* Dune: Optional (custom queries, free API key available)

WHAT I CAN DO:
• Query 60+ blockchains (Ethereum, Polygon, Base, Arbitrum, etc.)
• Resolve ENS names automatically (vitalik.eth → 0xd8dA6BF...)
• Look up any address or ENS name (e.g., "vitalik.eth balance")
• Get transaction history including internal/contract transfers (up to 10k)
• Track ERC-20/721/1155 token transfers and NFT movements
• Get all tokens and NFTs held by an address
• Get event logs, block info, transaction receipts
• Compare L2 fees, TVL, activity across chains
• Find yield opportunities by chain or protocol
• Get contract source code, ABI, and deployment info

LIMITATIONS:
• Price data may lag 1-5 minutes
• Some queries limited to 10k results (use Dune for complete history)

TRY THESE:
• "Balance of vitalik.eth"
• "What tokens does vitalik.eth hold?"
• "Token transfers for vitalik.eth"
• "Which L2 has the lowest fees?"
• "Internal transactions for 0x..."
• "Who deployed this contract?"
• "List supported chains" or "Switch to Base"

github.com/ethcf/ethereum-mcp`,
        },
      ],
    };
  }
);

// ============================================
// ETHERSCAN TOOLS (requires API key)
// ============================================

server.tool(
  'set_etherscan_key',
  "Set Etherscan API key. When Etherscan tools fail due to missing key, simply ask the user: 'What is your Etherscan API key?' then call this tool with their response.",
  {
    key: z.string().describe("The user's Etherscan API key"),
  },
  async ({ key }) => {
    etherscan.setApiKey(key);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Key set. Now retry the query.`,
        },
      ],
    };
  }
);

server.tool(
  'get_eth_balance',
  'Get the ETH balance for an Ethereum address',
  {
    address: z.string().describe('Ethereum address (0x...) or ENS name'),
  },
  async ({ address }) => {
    // Resolve ENS first to show the resolved address
    const resolvedAddress = await etherscan.resolveAddress(address);
    const balance = await etherscan.getBalance(resolvedAddress);
    const addressDisplay =
      address !== resolvedAddress ? `${address} (${resolvedAddress})` : address;
    return {
      content: [
        {
          type: 'text' as const,
          text: `Balance for ${addressDisplay}: ${balance} ETH\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_transactions',
  'Get recent external transactions for an Ethereum address. For ETH sent via contracts, use get_internal_transactions.',
  {
    address: z.string().describe('Ethereum address (0x...) or ENS name'),
    limit: z.number().optional().default(10).describe('Number of transactions (max 100)'),
  },
  async ({ address, limit }) => {
    const txs = await etherscan.getTransactions(address, limit);
    if (txs.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No transactions found for ${address}\n\n[Source: Etherscan]`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `Recent transactions for ${address}:\n\n${JSON.stringify(txs, null, 2)}\n\nNote: This shows external transactions only. Use get_internal_transactions for ETH transfers via contracts.\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_internal_transactions',
  'Get internal transactions (ETH transfers via contract calls) with aggregate totals. Use this for analyzing deposit/withdrawal history.',
  {
    address: z.string().describe('Ethereum address (0x...) or ENS name'),
    limit: z.number().optional().default(100).describe('Number of transactions (max 10000)'),
  },
  async ({ address, limit }) => {
    const result = await etherscan.getInternalTransactions(address, limit);
    if (result.transactions.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No internal transactions found for ${address}\n\n[Source: Etherscan]`,
          },
        ],
      };
    }

    const summaryText = `Summary (from ${result.transactions.length} internal txs):
• Total ETH In: ${result.summary.totalIn} ETH
• Total ETH Out: ${result.summary.totalOut} ETH
• Net Flow: ${result.summary.netFlow} ETH`;

    return {
      content: [
        {
          type: 'text' as const,
          text: `Internal transactions for ${address}:\n\n${summaryText}\n\nRecent internal transactions:\n${JSON.stringify(result.transactions.slice(0, 20), null, 2)}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_gas_price',
  'Get current Ethereum gas prices (slow, average, fast)',
  {},
  async () => {
    const gas = await etherscan.getGasPrice();
    return {
      content: [
        {
          type: 'text' as const,
          text: `Current Gas Prices:\n- Safe Low: ${gas.SafeGasPrice} Gwei\n- Average: ${gas.ProposeGasPrice} Gwei\n- Fast: ${gas.FastGasPrice} Gwei\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool('get_block_number', 'Get the latest Ethereum block number', {}, async () => {
  const blockNumber = await etherscan.getBlockNumber();
  return {
    content: [
      { type: 'text' as const, text: `Latest block number: ${blockNumber}\n\n[Source: Etherscan]` },
    ],
  };
});

server.tool(
  'get_token_balance',
  'Get ERC-20 token balance for an address',
  {
    address: z.string().describe('Ethereum address (0x...)'),
    contractAddress: z.string().describe('Token contract address (0x...)'),
  },
  async ({ address, contractAddress }) => {
    const balance = await etherscan.getTokenBalance(address, contractAddress);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Token balance for ${address}: ${balance} (raw units - divide by token decimals)\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_contract_abi',
  'Get the ABI for a verified contract',
  {
    address: z.string().describe('Contract address (0x...)'),
  },
  async ({ address }) => {
    const abi = await etherscan.getContractAbi(address);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Contract ABI for ${address}:\n\n${abi}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool('get_eth_price', 'Get current ETH price in USD and BTC', {}, async () => {
  const price = await etherscan.getEthPrice();
  return {
    content: [
      {
        type: 'text' as const,
        text: `ETH Price:\n- USD: $${price.usd.toFixed(2)}\n- BTC: ${price.btc}\n\n[Source: Etherscan]`,
      },
    ],
  };
});

server.tool(
  'get_token_transfers',
  'Get ERC-20 token transfer history for an address. Shows all token movements with token names, symbols, and amounts.',
  {
    address: z.string().describe('Ethereum address (0x...) or ENS name'),
    contractAddress: z.string().optional().describe('Filter by specific token contract address'),
    limit: z.number().optional().default(100).describe('Number of transfers (max 10000)'),
  },
  async ({ address, contractAddress, limit }) => {
    const transfers = await etherscan.getTokenTransfers(address, contractAddress, limit);
    if (transfers.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No token transfers found for ${address}\n\n[Source: Etherscan]`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `Token transfers for ${address}:\n\n${JSON.stringify(transfers, null, 2)}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_nft_transfers',
  'Get ERC-721 NFT transfer history for an address. Shows all NFT movements with token IDs and collection info.',
  {
    address: z.string().describe('Ethereum address (0x...) or ENS name'),
    contractAddress: z.string().optional().describe('Filter by specific NFT contract address'),
    limit: z.number().optional().default(100).describe('Number of transfers (max 10000)'),
  },
  async ({ address, contractAddress, limit }) => {
    const transfers = await etherscan.getNFTTransfers(address, contractAddress, limit);
    if (transfers.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No NFT transfers found for ${address}\n\n[Source: Etherscan]`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `NFT transfers for ${address}:\n\n${JSON.stringify(transfers, null, 2)}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_contract_source',
  'Get verified source code and metadata for a contract. Returns compiler version, optimization settings, and full source.',
  {
    address: z.string().describe('Contract address (0x...)'),
  },
  async ({ address }) => {
    const source = await etherscan.getContractSourceCode(address);
    if (!source) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Contract ${address} is not verified or not found.\n\n[Source: Etherscan]`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `Contract: ${source.contractName}\nCompiler: ${source.compilerVersion}\nOptimization: ${source.optimizationUsed ? `Yes (${source.runs} runs)` : 'No'}\nLicense: ${source.licenseType}\nProxy: ${source.proxy ? `Yes → ${source.implementation}` : 'No'}\n\nSource code length: ${source.sourceCode?.length || 0} chars\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_contract_creator',
  'Get the creator address and deployment transaction for a contract.',
  {
    address: z.string().describe('Contract address (0x...)'),
  },
  async ({ address }) => {
    const results = await etherscan.getContractCreation([address]);
    if (results.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Contract creation info not found for ${address}\n\n[Source: Etherscan]`,
          },
        ],
      };
    }
    const info = results[0];
    return {
      content: [
        {
          type: 'text' as const,
          text: `Contract: ${info.contractAddress}\nCreator: ${info.creatorAddress}\nDeploy TX: ${info.txHash}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

// ============================================
// ADDITIONAL ETHERSCAN TOOLS (multi-chain)
// ============================================

server.tool(
  'list_chains',
  'List all supported blockchain networks (60+ chains). Use set_chain to switch the default chain.',
  {},
  async () => {
    const chains = etherscan.getSupportedChains();
    return {
      content: [
        {
          type: 'text' as const,
          text: `Supported chains (${chains.length}):\n\n${chains.join(', ')}\n\nUse set_chain to switch the default chain, or pass chain parameter to individual tools.\n\n[Source: Etherscan V2 API]`,
        },
      ],
    };
  }
);

server.tool(
  'set_chain',
  'Set the default blockchain for subsequent queries. Affects all Etherscan tools.',
  {
    chain: z
      .string()
      .describe("Chain name (e.g., 'ethereum', 'polygon', 'base', 'arbitrum') or chain ID"),
  },
  async ({ chain }) => {
    const chainId = etherscan.getChainId(chain);
    etherscan.setDefaultChain(chainId);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Default chain set to ${chain} (chain ID: ${chainId}). All subsequent queries will use this chain.`,
        },
      ],
    };
  }
);

server.tool(
  'get_balance_history',
  'Get historical ETH balance at a specific block number. Useful for snapshot analysis.',
  {
    address: z.string().describe('Ethereum address (0x...) or ENS name'),
    blockno: z.number().describe('Block number to check balance at'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ address, blockno, chain }) => {
    const resolvedAddress = await etherscan.resolveAddress(address);
    const balance = await etherscan.getBalanceHistory(resolvedAddress, blockno, false, chain);
    const addressDisplay =
      address !== resolvedAddress ? `${address} (${resolvedAddress})` : address;
    return {
      content: [
        {
          type: 'text' as const,
          text: `Balance for ${addressDisplay} at block ${blockno}: ${balance} ETH\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_erc1155_transfers',
  'Get ERC-1155 multi-token transfer history for an address. Shows NFT and semi-fungible token movements.',
  {
    address: z.string().describe('Ethereum address (0x...) or ENS name'),
    contractAddress: z.string().optional().describe('Filter by specific ERC-1155 contract'),
    limit: z.number().optional().default(100).describe('Number of transfers (max 10000)'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ address, contractAddress, limit, chain }) => {
    const transfers = await etherscan.getERC1155Transfers(
      address,
      contractAddress,
      limit,
      false,
      chain
    );
    if (transfers.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No ERC-1155 transfers found for ${address}\n\n[Source: Etherscan]`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `ERC-1155 transfers for ${address}:\n\n${JSON.stringify(transfers, null, 2)}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_beacon_withdrawals',
  'Get Beacon Chain staking withdrawals for an address. Shows ETH withdrawn from validators.',
  {
    address: z.string().describe('Ethereum address (0x...) or ENS name'),
    limit: z.number().optional().default(100).describe('Number of withdrawals (max 10000)'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ address, limit, chain }) => {
    const withdrawals = await etherscan.getBeaconWithdrawals(address, limit, false, chain);
    if (withdrawals.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No beacon withdrawals found for ${address}\n\n[Source: Etherscan]`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `Beacon withdrawals for ${address}:\n\n${JSON.stringify(withdrawals, null, 2)}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_address_tokens',
  'Get all ERC-20 tokens held by an address with balances. Shows complete token portfolio.',
  {
    address: z.string().describe('Ethereum address (0x...) or ENS name'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ address, chain }) => {
    const tokens = await etherscan.getAddressTokenBalance(address, false, chain);
    if (tokens.length === 0) {
      return {
        content: [
          { type: 'text' as const, text: `No tokens found for ${address}\n\n[Source: Etherscan]` },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `Tokens held by ${address}:\n\n${JSON.stringify(tokens, null, 2)}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_address_nfts',
  'Get all NFTs held by an address. Shows complete NFT collection.',
  {
    address: z.string().describe('Ethereum address (0x...) or ENS name'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ address, chain }) => {
    const nfts = await etherscan.getAddressNFTBalance(address, false, chain);
    if (nfts.length === 0) {
      return {
        content: [
          { type: 'text' as const, text: `No NFTs found for ${address}\n\n[Source: Etherscan]` },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `NFTs held by ${address}:\n\n${JSON.stringify(nfts, null, 2)}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_block_reward',
  'Get block reward and uncle information for a specific block.',
  {
    blockno: z.number().describe('Block number'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ blockno, chain }) => {
    const reward = await etherscan.getBlockReward(blockno, false, chain);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Block ${blockno} reward:\n\n${JSON.stringify(reward, null, 2)}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_block_countdown',
  'Get estimated time remaining until a future block is mined.',
  {
    blockno: z.number().describe('Future block number'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ blockno, chain }) => {
    const countdown = await etherscan.getBlockCountdown(blockno, false, chain);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Block ${blockno} countdown:\n\n${JSON.stringify(countdown, null, 2)}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_block_by_timestamp',
  'Find the block number closest to a given timestamp.',
  {
    timestamp: z.number().describe('Unix timestamp (seconds)'),
    closest: z
      .enum(['before', 'after'])
      .optional()
      .default('before')
      .describe('Find block before or after timestamp'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ timestamp, closest, chain }) => {
    const blockno = await etherscan.getBlockByTimestamp(
      timestamp,
      closest as 'before' | 'after',
      false,
      chain
    );
    return {
      content: [
        {
          type: 'text' as const,
          text: `Block ${closest} timestamp ${timestamp}: ${blockno}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_block',
  'Get detailed block information by block number.',
  {
    blockNumber: z
      .union([z.string(), z.number()])
      .describe("Block number or 'latest', 'pending', 'earliest'"),
    fullTx: z.boolean().optional().default(false).describe('Include full transaction objects'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ blockNumber, fullTx, chain }) => {
    const block = await etherscan.getBlockByNumber(blockNumber, fullTx, false, chain);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Block ${blockNumber}:\n\n${JSON.stringify(block, null, 2)}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_transaction',
  'Get detailed transaction information by hash.',
  {
    txhash: z.string().describe('Transaction hash (0x...)'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ txhash, chain }) => {
    const tx = await etherscan.getTransactionByHash(txhash, false, chain);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Transaction ${txhash}:\n\n${JSON.stringify(tx, null, 2)}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_tx_receipt',
  'Get transaction receipt including gas used, logs, and status.',
  {
    txhash: z.string().describe('Transaction hash (0x...)'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ txhash, chain }) => {
    const receipt = await etherscan.getTransactionReceipt(txhash, false, chain);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Transaction receipt for ${txhash}:\n\n${JSON.stringify(receipt, null, 2)}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'eth_call',
  'Execute a read-only contract call. Returns raw hex result.',
  {
    to: z.string().describe('Contract address (0x...)'),
    data: z.string().describe('Encoded function call data (0x...)'),
    tag: z
      .string()
      .optional()
      .default('latest')
      .describe("Block tag: 'latest', 'pending', or block number"),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ to, data, tag, chain }) => {
    const result = await etherscan.ethCall(to, data, tag, false, chain);
    return {
      content: [
        {
          type: 'text' as const,
          text: `eth_call result: ${result}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_code',
  'Get bytecode at an address. Returns 0x if not a contract.',
  {
    address: z.string().describe('Address (0x...)'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ address, chain }) => {
    const code = await etherscan.getCode(address, 'latest', false, chain);
    const isContract = code !== '0x' && code.length > 2;
    return {
      content: [
        {
          type: 'text' as const,
          text: `Address ${address}: ${isContract ? `Contract (${code.length / 2 - 1} bytes)` : 'Not a contract (EOA)'}\n\nBytecode: ${code.length > 100 ? code.slice(0, 100) + '...' : code}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_storage',
  'Get storage at a specific slot for a contract.',
  {
    address: z.string().describe('Contract address (0x...)'),
    position: z.string().describe('Storage slot position (hex)'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ address, position, chain }) => {
    const value = await etherscan.getStorageAt(address, position, 'latest', false, chain);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Storage at ${address} slot ${position}: ${value}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'estimate_gas',
  'Estimate gas for a transaction.',
  {
    to: z.string().describe('Destination address (0x...)'),
    data: z.string().describe('Transaction data (0x...)'),
    value: z.string().optional().default('0x0').describe('ETH value in wei (hex)'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ to, data, value, chain }) => {
    const gas = await etherscan.estimateGas(to, data, value, false, chain);
    const gasDecimal = parseInt(gas, 16);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Estimated gas: ${gasDecimal.toLocaleString()} (${gas})\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_logs',
  'Get event logs matching filter criteria. Powerful for tracking contract events.',
  {
    address: z.string().describe('Contract address (0x...)'),
    fromBlock: z.union([z.number(), z.string()]).optional().default(0).describe('Start block'),
    toBlock: z.union([z.number(), z.string()]).optional().default('latest').describe('End block'),
    topic0: z.string().optional().describe('Event signature hash (first topic)'),
    topic1: z.string().optional().describe('Second topic (usually first indexed param)'),
    topic2: z.string().optional().describe('Third topic'),
    topic3: z.string().optional().describe('Fourth topic'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ address, fromBlock, toBlock, topic0, topic1, topic2, topic3, chain }) => {
    const logs = await etherscan.getLogs(
      address,
      fromBlock,
      toBlock,
      topic0,
      topic1,
      topic2,
      topic3,
      false,
      chain
    );
    if (logs.length === 0) {
      return {
        content: [
          { type: 'text' as const, text: `No logs found for ${address}\n\n[Source: Etherscan]` },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `Event logs for ${address} (${logs.length} found):\n\n${JSON.stringify(logs.slice(0, 50), null, 2)}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_eth_supply',
  'Get total ETH supply.',
  {
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ chain }) => {
    const supply = await etherscan.getEthSupply(false, chain);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Total ETH supply: ${supply} ETH\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_node_count',
  'Get total number of discoverable Ethereum nodes.',
  {
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ chain }) => {
    const nodes = await etherscan.getNodeCount(false, chain);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Ethereum node count:\n\n${JSON.stringify(nodes, null, 2)}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_tx_status',
  'Check if a transaction was successful or failed with error details.',
  {
    txhash: z.string().describe('Transaction hash (0x...)'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ txhash, chain }) => {
    const status = await etherscan.getTransactionStatus(txhash, false, chain);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Transaction ${txhash}:\nStatus: ${status.isError ? 'FAILED' : 'SUCCESS'}${status.errDescription ? `\nError: ${status.errDescription}` : ''}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_token_supply',
  'Get total supply of an ERC-20 token.',
  {
    contractAddress: z.string().describe('Token contract address (0x...)'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ contractAddress, chain }) => {
    const supply = await etherscan.getTokenSupply(contractAddress, false, chain);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Token supply for ${contractAddress}: ${supply} (raw units)\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_token_info',
  'Get token metadata including name, symbol, decimals, and total supply.',
  {
    contractAddress: z.string().describe('Token contract address (0x...)'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ contractAddress, chain }) => {
    const info = await etherscan.getTokenInfo(contractAddress, false, chain);
    if (!info) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Token info not found for ${contractAddress}\n\n[Source: Etherscan]`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `Token info for ${contractAddress}:\n\n${JSON.stringify(info, null, 2)}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_token_holders',
  'Get list of token holders with balances. Useful for distribution analysis.',
  {
    contractAddress: z.string().describe('Token contract address (0x...)'),
    page: z.number().optional().default(1).describe('Page number'),
    limit: z.number().optional().default(100).describe('Results per page (max 10000)'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ contractAddress, page, limit, chain }) => {
    const holders = await etherscan.getTokenHolders(contractAddress, page, limit, false, chain);
    if (holders.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No holders found for ${contractAddress}\n\n[Source: Etherscan]`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `Token holders for ${contractAddress} (page ${page}):\n\n${JSON.stringify(holders, null, 2)}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

// ============================================
// ADDITIONAL ETHERSCAN TOOLS (Account, Proxy, Gas, Daily Stats)
// ============================================

server.tool(
  'get_balance_multi',
  'Get ETH balances for multiple addresses at once (up to 20)',
  {
    addresses: z.array(z.string()).describe('Array of Ethereum addresses (max 20)'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ addresses, chain }) => {
    if (addresses.length > 20) {
      return {
        content: [{ type: 'text' as const, text: 'Maximum 20 addresses allowed per request.' }],
      };
    }
    const balances = await etherscan.getBalanceMulti(addresses, false, chain);
    const formatted = balances.map((b: any) => `${b.account}: ${b.balance} ETH`);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Balances:\n\n${formatted.join('\n')}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_mined_blocks',
  'Get blocks mined by an address (for miners/validators)',
  {
    address: z.string().describe('Miner/validator address'),
    blocktype: z.enum(['blocks', 'uncles']).optional().default('blocks').describe('Block type'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ address, blocktype, chain }) => {
    const blocks = await etherscan.getMinedBlocks(
      address,
      blocktype as 'blocks' | 'uncles',
      1,
      100,
      false,
      chain
    );
    if (blocks.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No mined ${blocktype} found for ${address}\n\n[Source: Etherscan]`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `Mined ${blocktype} by ${address}:\n\n${JSON.stringify(blocks.slice(0, 20), null, 2)}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_transaction_count',
  'Get the number of transactions (nonce) for an address',
  {
    address: z.string().describe('Ethereum address'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ address, chain }) => {
    const count = await etherscan.getTransactionCount(address, 'latest', false, chain);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Transaction count (nonce) for ${address}: ${count}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_gas_estimate',
  'Get estimated confirmation time for a given gas price',
  {
    gasprice: z.number().describe('Gas price in Gwei'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ gasprice, chain }) => {
    const estimate = await etherscan.getGasEstimate(gasprice, false, chain);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Estimated confirmation time at ${gasprice} Gwei: ${estimate} seconds\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_daily_stats',
  'Get daily blockchain statistics for a date range. Returns metrics like block count, gas usage, tx fees, new addresses, etc.',
  {
    stat: z
      .enum([
        'avgblocksize',
        'blockcount',
        'blockrewards',
        'avgblocktime',
        'unclecount',
        'avggaslimit',
        'gasused',
        'avggasprice',
        'txnfee',
        'newaddress',
        'netutilization',
        'avghashrate',
        'txcount',
      ])
      .describe('Statistic to retrieve'),
    startdate: z.string().describe('Start date (YYYY-MM-DD)'),
    enddate: z.string().describe('End date (YYYY-MM-DD)'),
    chain: z.string().optional().describe('Chain name or ID (default: ethereum)'),
  },
  async ({ stat, startdate, enddate, chain }) => {
    let data: any[];
    switch (stat) {
      case 'avgblocksize':
        data = await etherscan.getDailyAvgBlockSize(startdate, enddate, 'asc', false, chain);
        break;
      case 'blockcount':
        data = await etherscan.getDailyBlockCount(startdate, enddate, 'asc', false, chain);
        break;
      case 'blockrewards':
        data = await etherscan.getDailyBlockRewards(startdate, enddate, 'asc', false, chain);
        break;
      case 'avgblocktime':
        data = await etherscan.getDailyAvgBlockTime(startdate, enddate, 'asc', false, chain);
        break;
      case 'unclecount':
        data = await etherscan.getDailyUncleCount(startdate, enddate, 'asc', false, chain);
        break;
      case 'avggaslimit':
        data = await etherscan.getDailyAvgGasLimit(startdate, enddate, 'asc', false, chain);
        break;
      case 'gasused':
        data = await etherscan.getDailyGasUsed(startdate, enddate, 'asc', false, chain);
        break;
      case 'avggasprice':
        data = await etherscan.getDailyAvgGasPrice(startdate, enddate, 'asc', false, chain);
        break;
      case 'txnfee':
        data = await etherscan.getDailyTxnFee(startdate, enddate, 'asc', false, chain);
        break;
      case 'newaddress':
        data = await etherscan.getDailyNewAddress(startdate, enddate, 'asc', false, chain);
        break;
      case 'netutilization':
        data = await etherscan.getDailyNetUtilization(startdate, enddate, 'asc', false, chain);
        break;
      case 'avghashrate':
        data = await etherscan.getDailyAvgHashrate(startdate, enddate, 'asc', false, chain);
        break;
      case 'txcount':
        data = await etherscan.getDailyTxCount(startdate, enddate, 'asc', false, chain);
        break;
      default:
        data = [];
    }
    if (data.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No data found for ${stat} from ${startdate} to ${enddate}\n\n[Source: Etherscan]`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `Daily ${stat} from ${startdate} to ${enddate}:\n\n${JSON.stringify(data, null, 2)}\n\n[Source: Etherscan]`,
        },
      ],
    };
  }
);

// ============================================
// DEFILLAMA TOOLS (free tier + optional Pro)
// ============================================

server.tool(
  'set_defillama_key',
  'Set DefiLlama Pro API key for access to yields, derivatives, emissions, bridges, and more. Get one at defillama.com/subscription',
  {
    key: z.string().describe("The user's DefiLlama Pro API key"),
  },
  async ({ key }) => {
    defillama.setApiKey(key);
    return {
      content: [
        {
          type: 'text' as const,
          text: `DefiLlama Pro API key set. You now have access to:\n- Yield pool charts & borrow rates\n- Perpetuals & LSD rates\n- Derivatives volumes\n- Token emissions/unlocks\n- Protocol treasuries, hacks, raises\n- Bridge data`,
        },
      ],
    };
  }
);

// ============================================
// DEFILLAMA PRO TOOLS (require API key)
// ============================================

// Yields Pro
server.tool(
  'get_yield_pool_chart',
  'Get historical APY chart data for a specific yield pool (Pro)',
  {
    pool: z.string().describe('Pool UUID from get_top_yields'),
  },
  async ({ pool }) => {
    const data = await defillama.getYieldPoolChart(pool);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Yield Pool Chart for ${pool}:\n\n${JSON.stringify(data, null, 2)}\n\n[Source: DefiLlama Pro]`,
        },
      ],
    };
  }
);

server.tool(
  'get_borrow_rates',
  'Get current borrow rates across lending protocols (Pro)',
  {},
  async () => {
    const data = await defillama.getBorrowRates();
    if (!data.data || data.data.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No borrow rate data available.\n\n[Source: DefiLlama Pro]',
          },
        ],
      };
    }
    const formatted = data.data
      .sort((a: any, b: any) => (b.apyBaseBorrow || 0) - (a.apyBaseBorrow || 0))
      .slice(0, 20)
      .map(
        (p: any) =>
          `${p.symbol} on ${p.project}: ${p.apyBaseBorrow?.toFixed(2) || 'N/A'}% borrow APY`
      );
    return {
      content: [
        {
          type: 'text' as const,
          text: `Top Borrow Rates:\n\n${formatted.join('\n')}\n\n[Source: DefiLlama Pro]`,
        },
      ],
    };
  }
);

server.tool(
  'get_lend_borrow_chart',
  'Get historical lend/borrow rates chart for a pool (Pro)',
  {
    pool: z.string().describe('Pool UUID from get_borrow_rates'),
  },
  async ({ pool }) => {
    const data = await defillama.getLendBorrowChart(pool);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Lend/Borrow Chart for ${pool}:\n\n${JSON.stringify(data, null, 2)}\n\n[Source: DefiLlama Pro]`,
        },
      ],
    };
  }
);

server.tool(
  'get_perps_rates',
  'Get perpetual futures funding rates across protocols (Pro)',
  {},
  async () => {
    const data = await defillama.getPerpsRates();
    if (!data.data || data.data.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No perps rate data available.\n\n[Source: DefiLlama Pro]',
          },
        ],
      };
    }
    const formatted = data.data
      .slice(0, 20)
      .map(
        (p: any) =>
          `${p.symbol} on ${p.marketplace}: ${p.fundingRate?.toFixed(4) || 'N/A'}% funding`
      );
    return {
      content: [
        {
          type: 'text' as const,
          text: `Perpetual Funding Rates:\n\n${formatted.join('\n')}\n\n[Source: DefiLlama Pro]`,
        },
      ],
    };
  }
);

server.tool('get_lsd_rates', 'Get liquid staking derivatives (LSD) rates (Pro)', {}, async () => {
  const data = await defillama.getLsdRates();
  if (!data || data.length === 0) {
    return {
      content: [
        { type: 'text' as const, text: 'No LSD rate data available.\n\n[Source: DefiLlama Pro]' },
      ],
    };
  }
  const formatted = data
    .slice(0, 20)
    .map(
      (p: any) => `${p.name}: ${p.apy?.toFixed(2) || 'N/A'}% APY | ${formatUSD(p.tvl || 0)} TVL`
    );
  return {
    content: [
      {
        type: 'text' as const,
        text: `Liquid Staking Rates:\n\n${formatted.join('\n')}\n\n[Source: DefiLlama Pro]`,
      },
    ],
  };
});

// Derivatives Pro
server.tool(
  'get_derivatives_volumes',
  'Get derivatives trading volumes across protocols (Pro)',
  {},
  async () => {
    const data = await defillama.getDerivativesVolumes();
    if (!data.protocols || data.protocols.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No derivatives volume data available.\n\n[Source: DefiLlama Pro]',
          },
        ],
      };
    }
    const formatted = data.protocols
      .sort((a: any, b: any) => (b.dailyVolume || 0) - (a.dailyVolume || 0))
      .slice(0, 20)
      .map((p: any) => `${p.name}: ${formatUSD(p.dailyVolume || 0)} (24h)`);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Derivatives Volumes (24h):\n\n${formatted.join('\n')}\n\n[Source: DefiLlama Pro]`,
        },
      ],
    };
  }
);

server.tool(
  'get_derivatives_protocol',
  'Get detailed derivatives data for a specific protocol (Pro)',
  {
    protocol: z.string().describe("Protocol slug (e.g., 'gmx', 'dydx', 'synthetix')"),
  },
  async ({ protocol }) => {
    const data = await defillama.getDerivativesProtocol(protocol);
    return {
      content: [
        {
          type: 'text' as const,
          text: `${protocol} Derivatives Data:\n\n${JSON.stringify(data, null, 2)}\n\n[Source: DefiLlama Pro]`,
        },
      ],
    };
  }
);

// Emissions Pro
server.tool(
  'get_emissions',
  'Get token emissions/unlocks overview for all protocols (Pro)',
  {},
  async () => {
    const data = await defillama.getEmissions();
    if (!data || data.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No emissions data available.\n\n[Source: DefiLlama Pro]',
          },
        ],
      };
    }
    const formatted = data
      .slice(0, 20)
      .map((p: any) => `${p.name}: ${formatUSD(p.nextUnlockValue || 0)} next unlock`);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Token Emissions/Unlocks:\n\n${formatted.join('\n')}\n\n[Source: DefiLlama Pro]`,
        },
      ],
    };
  }
);

server.tool(
  'get_emission',
  'Get detailed emission/unlock schedule for a protocol (Pro)',
  {
    protocol: z.string().describe("Protocol slug (e.g., 'arbitrum', 'optimism')"),
  },
  async ({ protocol }) => {
    const data = await defillama.getEmission(protocol);
    return {
      content: [
        {
          type: 'text' as const,
          text: `${protocol} Emission Schedule:\n\n${JSON.stringify(data, null, 2)}\n\n[Source: DefiLlama Pro]`,
        },
      ],
    };
  }
);

// Ecosystem Pro
server.tool('get_categories', 'Get DeFi protocol categories and their TVL (Pro)', {}, async () => {
  const data = await defillama.getCategories();
  if (!data || Object.keys(data).length === 0) {
    return {
      content: [
        { type: 'text' as const, text: 'No category data available.\n\n[Source: DefiLlama Pro]' },
      ],
    };
  }
  const formatted = Object.entries(data)
    .map(([cat, tvl]) => `${cat}: ${formatUSD(tvl as number)}`)
    .slice(0, 20);
  return {
    content: [
      {
        type: 'text' as const,
        text: `DeFi Categories by TVL:\n\n${formatted.join('\n')}\n\n[Source: DefiLlama Pro]`,
      },
    ],
  };
});

server.tool('get_forks', 'Get protocol forks data (Pro)', {}, async () => {
  const data = await defillama.getForks();
  return {
    content: [
      {
        type: 'text' as const,
        text: `Protocol Forks:\n\n${JSON.stringify(data, null, 2)}\n\n[Source: DefiLlama Pro]`,
      },
    ],
  };
});

server.tool('get_oracles', 'Get oracle usage data across DeFi (Pro)', {}, async () => {
  const data = await defillama.getOracles();
  return {
    content: [
      {
        type: 'text' as const,
        text: `Oracle Usage:\n\n${JSON.stringify(data, null, 2)}\n\n[Source: DefiLlama Pro]`,
      },
    ],
  };
});

server.tool('get_treasuries', 'Get protocol treasury holdings (Pro)', {}, async () => {
  const data = await defillama.getTreasuries();
  if (!data || data.length === 0) {
    return {
      content: [
        { type: 'text' as const, text: 'No treasury data available.\n\n[Source: DefiLlama Pro]' },
      ],
    };
  }
  const formatted = data
    .sort((a: any, b: any) => (b.tvl || 0) - (a.tvl || 0))
    .slice(0, 20)
    .map((p: any) => `${p.name}: ${formatUSD(p.tvl || 0)} treasury`);
  return {
    content: [
      {
        type: 'text' as const,
        text: `Protocol Treasuries:\n\n${formatted.join('\n')}\n\n[Source: DefiLlama Pro]`,
      },
    ],
  };
});

server.tool('get_hacks', 'Get historical DeFi hacks and exploits (Pro)', {}, async () => {
  const data = await defillama.getHacks();
  if (!data || data.length === 0) {
    return {
      content: [
        { type: 'text' as const, text: 'No hacks data available.\n\n[Source: DefiLlama Pro]' },
      ],
    };
  }
  const formatted = data
    .sort((a: any, b: any) => (b.amount || 0) - (a.amount || 0))
    .slice(0, 20)
    .map(
      (h: any) => `${h.name} (${h.date}): ${formatUSD(h.amount || 0)} - ${h.technique || 'Unknown'}`
    );
  return {
    content: [
      {
        type: 'text' as const,
        text: `Largest DeFi Hacks:\n\n${formatted.join('\n')}\n\n[Source: DefiLlama Pro]`,
      },
    ],
  };
});

server.tool('get_raises', 'Get crypto funding rounds and raises (Pro)', {}, async () => {
  const data = await defillama.getRaises();
  if (!data.raises || data.raises.length === 0) {
    return {
      content: [
        { type: 'text' as const, text: 'No raises data available.\n\n[Source: DefiLlama Pro]' },
      ],
    };
  }
  const formatted = data.raises
    .sort((a: any, b: any) => (b.amount || 0) - (a.amount || 0))
    .slice(0, 20)
    .map((r: any) => `${r.name}: ${formatUSD(r.amount || 0)} (${r.round || 'Unknown round'})`);
  return {
    content: [
      {
        type: 'text' as const,
        text: `Recent Funding Rounds:\n\n${formatted.join('\n')}\n\n[Source: DefiLlama Pro]`,
      },
    ],
  };
});

// Bridges Pro
server.tool('get_bridges', 'Get all cross-chain bridges data (Pro)', {}, async () => {
  const data = await defillama.getBridges();
  if (!data.bridges || data.bridges.length === 0) {
    return {
      content: [
        { type: 'text' as const, text: 'No bridges data available.\n\n[Source: DefiLlama Pro]' },
      ],
    };
  }
  const formatted = data.bridges
    .sort((a: any, b: any) => (b.lastDayVolume || 0) - (a.lastDayVolume || 0))
    .slice(0, 20)
    .map((b: any) => `${b.displayName}: ${formatUSD(b.lastDayVolume || 0)} (24h)`);
  return {
    content: [
      {
        type: 'text' as const,
        text: `Bridge Volumes (24h):\n\n${formatted.join('\n')}\n\n[Source: DefiLlama Pro]`,
      },
    ],
  };
});

server.tool(
  'get_bridge',
  'Get detailed data for a specific bridge (Pro)',
  {
    id: z.number().describe('Bridge ID from get_bridges'),
  },
  async ({ id }) => {
    const data = await defillama.getBridge(id);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Bridge Details (ID: ${id}):\n\n${JSON.stringify(data, null, 2)}\n\n[Source: DefiLlama Pro]`,
        },
      ],
    };
  }
);

server.tool(
  'get_bridge_volume',
  'Get bridge volume for a specific chain (Pro)',
  {
    chain: z.string().describe("Chain name (e.g., 'ethereum', 'arbitrum', 'polygon')"),
  },
  async ({ chain }) => {
    const data = await defillama.getBridgeVolume(chain);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Bridge Volume for ${chain}:\n\n${JSON.stringify(data, null, 2)}\n\n[Source: DefiLlama Pro]`,
        },
      ],
    };
  }
);

// ============================================
// DEFILLAMA FREE TOOLS
// ============================================

server.tool(
  'get_chain_tvl',
  'Get total TVL (Total Value Locked) for all blockchain networks',
  {},
  async () => {
    const chains = await defillama.getTopChainsByTvl(20);
    const formatted = chains.map((c) => `${c.name}: ${formatUSD(c.tvl)}`);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Top 20 Chains by TVL:\n\n${formatted.join('\n')}\n\n[Source: DefiLlama]`,
        },
      ],
    };
  }
);

server.tool(
  'get_protocol_tvl',
  "Get TVL for a specific DeFi protocol (e.g., 'aave', 'uniswap', 'lido')",
  {
    protocol: z.string().describe("Protocol name (e.g., 'aave', 'uniswap', 'lido')"),
  },
  async ({ protocol }) => {
    // Search for the protocol to get the correct slug
    const protocols = await defillama.searchProtocols(protocol, 10);
    if (protocols.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Protocol "${protocol}" not found. Try a different name.\n\n[Source: DefiLlama]`,
          },
        ],
      };
    }

    // Use the best match (highest TVL among matches)
    const match = protocols[0];
    const slug = match.slug || match.name.toLowerCase().replace(/\s+/g, '-');
    const tvl = await defillama.getProtocolTvl(slug);

    return {
      content: [
        {
          type: 'text' as const,
          text: `${match.name} TVL: ${formatUSD(tvl)}\n\n[Source: DefiLlama]`,
        },
      ],
    };
  }
);

server.tool(
  'get_protocol_info',
  'Get detailed information about a DeFi protocol including TVL by chain',
  {
    protocol: z.string().describe("Protocol name (e.g., 'aave', 'uniswap', 'lido')"),
  },
  async ({ protocol }) => {
    // Search for the protocol to get the correct slug
    const protocols = await defillama.searchProtocols(protocol, 10);
    if (protocols.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Protocol "${protocol}" not found. Try a different name.\n\n[Source: DefiLlama]`,
          },
        ],
      };
    }

    // Use the best match
    const match = protocols[0];
    const slug = match.slug || match.name.toLowerCase().replace(/\s+/g, '-');
    const data = await defillama.getProtocol(slug);
    const chainTvls = Object.entries(data.currentChainTvls || {})
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 10)
      .map(([chain, tvl]) => `  ${chain}: ${formatUSD(tvl as number)}`);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Protocol: ${data.name}\nCategory: ${data.category || 'N/A'}\nTotal TVL: ${formatUSD(data.tvl)}\n\nTVL by Chain:\n${chainTvls.join('\n')}\n\n[Source: DefiLlama]`,
        },
      ],
    };
  }
);

server.tool(
  'search_protocols',
  'Search for DeFi protocols by name or category',
  {
    query: z
      .string()
      .describe("Search query (protocol name or category like 'dex', 'lending', 'yield')"),
  },
  async ({ query }) => {
    const matches = await defillama.searchProtocols(query);
    if (matches.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No protocols found matching "${query}"\n\n[Source: DefiLlama]`,
          },
        ],
      };
    }
    const formatted = matches.map(
      (p: any) => `${p.name} (${p.category || 'N/A'}): ${formatUSD(p.tvl)}`
    );
    return {
      content: [
        {
          type: 'text' as const,
          text: `Protocols matching "${query}":\n\n${formatted.join('\n')}\n\n[Source: DefiLlama]`,
        },
      ],
    };
  }
);

server.tool(
  'get_top_yields',
  'Get top DeFi yield opportunities sorted by APY',
  {
    chain: z.string().optional().describe("Filter by chain (e.g., 'Ethereum', 'Arbitrum', 'Base')"),
    minTvl: z.number().optional().default(1000000).describe('Minimum TVL in USD (default: 1M)'),
    limit: z.number().optional().default(20).describe('Number of results (default: 20)'),
  },
  async ({ chain, minTvl, limit }) => {
    const pools = await defillama.getTopYields(chain, minTvl, limit);
    const formatted = pools.map(
      (p: any) =>
        `${p.symbol} on ${p.chain} (${p.project}): ${p.apy.toFixed(2)}% APY - TVL: ${formatUSD(p.tvlUsd)}`
    );
    return {
      content: [
        {
          type: 'text' as const,
          text: `Top Yield Opportunities${chain ? ` on ${chain}` : ''}:\n\n${formatted.join('\n')}\n\n[Source: DefiLlama]`,
        },
      ],
    };
  }
);

server.tool(
  'get_stablecoins',
  'Get market data for stablecoins including market cap',
  {},
  async () => {
    const stables = await defillama.getTopStablecoins();
    const formatted = stables.map(
      (s) => `${s.symbol} (${s.name}): ${formatUSD(s.marketCap)} market cap`
    );
    return {
      content: [
        {
          type: 'text' as const,
          text: `Top 15 Stablecoins by Market Cap:\n\n${formatted.join('\n')}\n\n[Source: DefiLlama]`,
        },
      ],
    };
  }
);

server.tool(
  'get_dex_volumes',
  'Get 24h trading volume for decentralized exchanges',
  {},
  async () => {
    const dexes = await defillama.getTopDexes();
    const formatted = dexes.map((d) => `${d.name}: ${formatUSD(d.dailyVolume)} (24h volume)`);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Top DEXs by 24h Volume:\n\n${formatted.join('\n')}\n\n[Source: DefiLlama]`,
        },
      ],
    };
  }
);

server.tool(
  'get_dex_volumes_by_chain',
  'Get DEX trading volumes for a specific chain',
  {
    chain: z.string().describe("Chain name (e.g., 'ethereum', 'arbitrum', 'base')"),
  },
  async ({ chain }) => {
    const data = await defillama.getDexVolumesByChain(chain);
    if (!data.protocols || data.protocols.length === 0) {
      return {
        content: [
          { type: 'text' as const, text: `No DEX data found for ${chain}\n\n[Source: DefiLlama]` },
        ],
      };
    }
    const formatted = data.protocols
      .sort((a: any, b: any) => (b.dailyVolume || 0) - (a.dailyVolume || 0))
      .slice(0, 15)
      .map((d: any) => `${d.name}: ${formatUSD(d.dailyVolume || 0)} (24h)`);
    return {
      content: [
        {
          type: 'text' as const,
          text: `DEX Volumes on ${chain}:\n\n${formatted.join('\n')}\n\n[Source: DefiLlama]`,
        },
      ],
    };
  }
);

server.tool(
  'get_dex_protocol',
  'Get detailed volume data for a specific DEX protocol',
  {
    protocol: z.string().describe("Protocol slug (e.g., 'uniswap', 'curve', 'pancakeswap')"),
  },
  async ({ protocol }) => {
    const data = await defillama.getDexProtocol(protocol);
    return {
      content: [
        {
          type: 'text' as const,
          text: `${protocol} DEX Data:\n\n${JSON.stringify(data, null, 2)}\n\n[Source: DefiLlama]`,
        },
      ],
    };
  }
);

server.tool(
  'get_historical_tvl',
  'Get historical TVL data for all chains or a specific chain',
  {
    chain: z.string().optional().describe("Chain name (optional, e.g., 'ethereum', 'arbitrum')"),
  },
  async ({ chain }) => {
    const data = chain
      ? await defillama.getHistoricalChainTvlByChain(chain)
      : await defillama.getHistoricalChainTvl();
    if (!Array.isArray(data) || data.length === 0) {
      return {
        content: [
          { type: 'text' as const, text: `No historical TVL data found\n\n[Source: DefiLlama]` },
        ],
      };
    }
    // Return last 30 data points
    const recent = data.slice(-30);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Historical TVL${chain ? ` for ${chain}` : ''} (last ${recent.length} data points):\n\n${JSON.stringify(recent, null, 2)}\n\n[Source: DefiLlama]`,
        },
      ],
    };
  }
);

server.tool(
  'get_coin_prices',
  'Get current prices for tokens using DefiLlama. Format: "chain:address" (e.g., "ethereum:0x..." or "coingecko:bitcoin")',
  {
    coins: z
      .string()
      .describe(
        'Comma-separated list of coins in format "chain:address" (e.g., "ethereum:0x6b175474e89094c44da98b954eedeac495271d0f,coingecko:bitcoin")'
      ),
  },
  async ({ coins }) => {
    const data = await defillama.getCoinPrices(coins);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Token Prices:\n\n${JSON.stringify(data.coins, null, 2)}\n\n[Source: DefiLlama]`,
        },
      ],
    };
  }
);

server.tool(
  'get_coin_prices_historical',
  'Get historical prices for tokens at a specific timestamp',
  {
    coins: z.string().describe('Comma-separated list of coins in format "chain:address"'),
    timestamp: z.number().describe('Unix timestamp (seconds)'),
  },
  async ({ coins, timestamp }) => {
    const data = await defillama.getCoinPricesHistorical(coins, timestamp);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Token Prices at ${new Date(timestamp * 1000).toISOString()}:\n\n${JSON.stringify(data.coins, null, 2)}\n\n[Source: DefiLlama]`,
        },
      ],
    };
  }
);

server.tool(
  'get_coin_chart',
  'Get price chart data for a token over time',
  {
    coins: z.string().describe('Coin in format "chain:address" (e.g., "ethereum:0x...")'),
    period: z.string().optional().describe("Time period: '1d', '1w', '1m', '1y' (default: 1w)"),
  },
  async ({ coins, period }) => {
    const data = await defillama.getCoinChart(
      coins,
      undefined,
      undefined,
      undefined,
      period || '1w'
    );
    return {
      content: [
        {
          type: 'text' as const,
          text: `Price Chart for ${coins}:\n\n${JSON.stringify(data, null, 2)}\n\n[Source: DefiLlama]`,
        },
      ],
    };
  }
);

server.tool(
  'get_coin_percent_change',
  'Get price change percentages for tokens',
  {
    coins: z.string().describe('Comma-separated list of coins in format "chain:address"'),
  },
  async ({ coins }) => {
    const data = await defillama.getCoinPercentChange(coins);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Price Changes:\n\n${JSON.stringify(data, null, 2)}\n\n[Source: DefiLlama]`,
        },
      ],
    };
  }
);

server.tool(
  'get_coin_first_price',
  'Get the first recorded price for tokens',
  {
    coins: z.string().describe('Comma-separated list of coins in format "chain:address"'),
  },
  async ({ coins }) => {
    const data = await defillama.getCoinFirstPrice(coins);
    return {
      content: [
        {
          type: 'text' as const,
          text: `First Recorded Prices:\n\n${JSON.stringify(data.coins, null, 2)}\n\n[Source: DefiLlama]`,
        },
      ],
    };
  }
);

server.tool(
  'get_block_by_timestamp',
  'Get block number closest to a timestamp (via DefiLlama)',
  {
    chain: z.string().describe("Chain name (e.g., 'ethereum', 'bsc', 'polygon')"),
    timestamp: z.number().describe('Unix timestamp (seconds)'),
  },
  async ({ chain, timestamp }) => {
    const data = await defillama.getBlockByTimestamp(chain, timestamp);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Block on ${chain} at ${new Date(timestamp * 1000).toISOString()}: ${data.height}\n\n[Source: DefiLlama]`,
        },
      ],
    };
  }
);

server.tool(
  'get_stablecoin_dominance',
  'Get stablecoin market dominance for a specific chain',
  {
    chain: z.string().describe("Chain name (e.g., 'ethereum', 'tron', 'bsc')"),
  },
  async ({ chain }) => {
    const data = await defillama.getStablecoinDominance(chain);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Stablecoin Dominance on ${chain}:\n\n${JSON.stringify(data, null, 2)}\n\n[Source: DefiLlama]`,
        },
      ],
    };
  }
);

server.tool(
  'get_stablecoin_detail',
  'Get detailed data for a specific stablecoin',
  {
    asset: z.string().describe("Stablecoin ID (e.g., '1' for USDT, '2' for USDC)"),
  },
  async ({ asset }) => {
    const data = await defillama.getStablecoinDetail(asset);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Stablecoin Details:\n\n${JSON.stringify(data, null, 2)}\n\n[Source: DefiLlama]`,
        },
      ],
    };
  }
);

server.tool('get_stablecoin_chains', 'List all chains with stablecoin data', {}, async () => {
  const chains = await defillama.getStablecoinChains();
  return {
    content: [
      {
        type: 'text' as const,
        text: `Chains with Stablecoin Data:\n\n${JSON.stringify(chains, null, 2)}\n\n[Source: DefiLlama]`,
      },
    ],
  };
});

server.tool(
  'get_options_volumes',
  'Get options trading volumes overview',
  {
    chain: z.string().optional().describe("Filter by chain (e.g., 'ethereum', 'arbitrum')"),
  },
  async ({ chain }) => {
    const data = chain
      ? await defillama.getOptionsVolumesByChain(chain)
      : await defillama.getOptionsVolumes();
    if (!data.protocols || data.protocols.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No options data found${chain ? ` for ${chain}` : ''}\n\n[Source: DefiLlama]`,
          },
        ],
      };
    }
    const formatted = data.protocols
      .sort((a: any, b: any) => (b.dailyNotionalVolume || 0) - (a.dailyNotionalVolume || 0))
      .slice(0, 15)
      .map((p: any) => `${p.name}: ${formatUSD(p.dailyNotionalVolume || 0)} notional (24h)`);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Options Volumes${chain ? ` on ${chain}` : ''}:\n\n${formatted.join('\n')}\n\n[Source: DefiLlama]`,
        },
      ],
    };
  }
);

server.tool(
  'get_options_protocol',
  'Get detailed data for a specific options protocol',
  {
    protocol: z.string().describe("Protocol slug (e.g., 'lyra', 'dopex', 'hegic')"),
  },
  async ({ protocol }) => {
    const data = await defillama.getOptionsProtocol(protocol);
    return {
      content: [
        {
          type: 'text' as const,
          text: `${protocol} Options Data:\n\n${JSON.stringify(data, null, 2)}\n\n[Source: DefiLlama]`,
        },
      ],
    };
  }
);

server.tool(
  'get_fees',
  'Get protocol fees and revenue overview',
  {
    chain: z.string().optional().describe("Filter by chain (e.g., 'ethereum', 'arbitrum')"),
  },
  async ({ chain }) => {
    const data = chain ? await defillama.getFeesByChain(chain) : await defillama.getFees();
    if (!data.protocols || data.protocols.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No fees data found${chain ? ` for ${chain}` : ''}\n\n[Source: DefiLlama]`,
          },
        ],
      };
    }
    const formatted = data.protocols
      .sort((a: any, b: any) => (b.dailyFees || 0) - (a.dailyFees || 0))
      .slice(0, 20)
      .map(
        (p: any) =>
          `${p.name}: ${formatUSD(p.dailyFees || 0)} fees | ${formatUSD(p.dailyRevenue || 0)} revenue (24h)`
      );
    return {
      content: [
        {
          type: 'text' as const,
          text: `Protocol Fees${chain ? ` on ${chain}` : ''} (24h):\n\n${formatted.join('\n')}\n\n[Source: DefiLlama]`,
        },
      ],
    };
  }
);

server.tool(
  'get_protocol_fees',
  'Get detailed fees and revenue for a specific protocol',
  {
    protocol: z.string().describe("Protocol slug (e.g., 'uniswap', 'aave', 'lido')"),
  },
  async ({ protocol }) => {
    const data = await defillama.getProtocolFees(protocol);
    return {
      content: [
        {
          type: 'text' as const,
          text: `${protocol} Fees & Revenue:\n\n${JSON.stringify(data, null, 2)}\n\n[Source: DefiLlama]`,
        },
      ],
    };
  }
);

// ============================================
// GROWTHEPIE TOOLS (free, no key)
// L2 metrics and analytics
// ============================================

server.tool(
  'get_l2_overview',
  'Get overview of Layer 2 networks including TVL, transactions, and activity',
  {},
  async () => {
    const chains = await growthepie.getL2Overview();
    const formatted = chains.map(
      (c) =>
        `${c.chain}: TVL ${formatUSD(c.tvl)} | ${Math.round(c.txcount).toLocaleString()} daily txs`
    );
    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer 2 Overview (Top 15 by TVL):\n\n${formatted.join('\n')}\n\n[Source: growthepie]`,
        },
      ],
    };
  }
);

server.tool('get_l2_fees', 'Compare transaction fees across Layer 2 networks', {}, async () => {
  const chains = await growthepie.getL2Fees();
  const formatted = chains.map((c) => `${c.chain}: $${c.fees.toFixed(4)} avg tx fee`);
  return {
    content: [
      {
        type: 'text' as const,
        text: `L2 Transaction Fees (Lowest to Highest):\n\n${formatted.join('\n')}\n\n[Source: growthepie]`,
      },
    ],
  };
});

server.tool(
  'get_l2_chain',
  'Get detailed metrics for a specific Layer 2 chain',
  {
    chain: z
      .string()
      .describe("L2 chain name (e.g., 'arbitrum', 'optimism', 'base', 'zksync era')"),
  },
  async ({ chain }) => {
    // Get available chains and find best match
    const available = await growthepie.getAvailableChains();
    const matchedChain = findBestMatch(chain, available);

    if (!matchedChain) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Chain "${chain}" not found. Available: ${available.slice(0, 20).join(', ')}...\n\n[Source: growthepie]`,
          },
        ],
      };
    }

    const data = await growthepie.getL2Chain(matchedChain);
    if (!data) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No data available for "${matchedChain}".\n\n[Source: growthepie]`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `${matchedChain.toUpperCase()} Metrics:\n\n- TVL: ${formatUSD(data.tvl)}\n- Market Cap: ${formatUSD(data.marketCap)}\n- FDV: ${formatUSD(data.fdv)}\n- Daily Transactions: ${Math.round(data.txcount).toLocaleString()}\n- Daily Active Addresses: ${Math.round(data.daa).toLocaleString()}\n- Avg Transaction Fee: $${data.fees.toFixed(4)}\n- Stablecoin Market Cap: ${formatUSD(data.stablesMcap)}\n- Onchain Profit: ${formatUSD(data.profit)}\n- Rent Paid to L1: ${formatUSD(data.rentPaid)}\n- Throughput: ${data.throughput?.toLocaleString() || 'N/A'}\n\n[Source: growthepie]`,
        },
      ],
    };
  }
);

server.tool(
  'get_blob_data',
  'Get Ethereum blob data and costs for Layer 2s (EIP-4844)',
  {},
  async () => {
    const chains = await growthepie.getBlobData();
    const formatted = chains.map((c) => `${c.chain}: ${formatUSD(c.blobFees)} blob fees (24h)`);
    return {
      content: [
        {
          type: 'text' as const,
          text: `L2 Blob Fees Paid to Ethereum (EIP-4844):\n\n${formatted.join('\n')}\n\n[Source: growthepie]`,
        },
      ],
    };
  }
);

server.tool(
  'get_l2_metric_ranking',
  'Get L2 chains ranked by a specific metric',
  {
    metric: z
      .enum([
        'daa',
        'fdv',
        'fees',
        'market_cap',
        'profit',
        'rent_paid',
        'stables_mcap',
        'throughput',
        'tvl',
        'txcosts',
        'txcount',
      ])
      .describe(
        'Metric to rank by: daa (daily active addresses), fdv, fees, market_cap, profit, rent_paid (blob fees), stables_mcap, throughput, tvl, txcosts, txcount'
      ),
  },
  async ({ metric }) => {
    const ranking = await growthepie.getMetricRanking(metric, 20);
    if (ranking.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No data for metric "${metric}".\n\n[Source: growthepie]`,
          },
        ],
      };
    }

    const metricLabels: Record<string, string> = {
      daa: 'Daily Active Addresses',
      fdv: 'Fully Diluted Valuation',
      fees: 'Fees Paid',
      market_cap: 'Market Cap',
      profit: 'Onchain Profit',
      rent_paid: 'Rent Paid to L1',
      stables_mcap: 'Stablecoin Market Cap',
      throughput: 'Throughput',
      tvl: 'Total Value Locked',
      txcosts: 'Median Transaction Cost',
      txcount: 'Transaction Count',
    };

    const formatted = ranking.map((r, i) => {
      const value = ['txcosts'].includes(metric)
        ? `$${r.value.toFixed(4)}`
        : ['daa', 'txcount', 'throughput'].includes(metric)
          ? Math.round(r.value).toLocaleString()
          : formatUSD(r.value);
      return `${i + 1}. ${r.chain}: ${value}`;
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: `L2 Ranking by ${metricLabels[metric] || metric}:\n\n${formatted.join('\n')}\n\n[Source: growthepie]`,
        },
      ],
    };
  }
);

server.tool(
  'get_l2_chains_list',
  'List all L2 chains tracked by growthepie with metadata',
  {},
  async () => {
    const chains = await growthepie.listChains();
    if (chains.length === 0) {
      return {
        content: [
          { type: 'text' as const, text: 'Could not fetch chain list.\n\n[Source: growthepie]' },
        ],
      };
    }
    const formatted = chains.map((c) => `${c.name} (${c.key}): ${c.technology}`);
    return {
      content: [
        {
          type: 'text' as const,
          text: `L2 Chains on growthepie:\n\n${formatted.join('\n')}\n\n[Source: growthepie]`,
        },
      ],
    };
  }
);

server.tool(
  'get_l2_all_metrics',
  'Get all metrics for all L2 chains (comprehensive overview)',
  {},
  async () => {
    const chains = await growthepie.getAllL2Metrics();
    const formatted = chains
      .slice(0, 15)
      .map(
        (c) =>
          `${c.chain}: TVL ${formatUSD(c.tvl)} | MCap ${formatUSD(c.marketCap)} | DAA ${Math.round(c.daa).toLocaleString()} | Profit ${formatUSD(c.profit)}`
      );
    return {
      content: [
        {
          type: 'text' as const,
          text: `L2 Comprehensive Metrics (Top 15):\n\n${formatted.join('\n')}\n\n[Source: growthepie]`,
        },
      ],
    };
  }
);

server.tool('get_l2_profitability', 'Compare L2 profitability (revenue - costs)', {}, async () => {
  const ranking = await growthepie.getMetricRanking('profit', 20);
  const formatted = ranking.map((r, i) => `${i + 1}. ${r.chain}: ${formatUSD(r.value)} profit`);
  return {
    content: [
      {
        type: 'text' as const,
        text: `L2 Profitability Ranking:\n\n${formatted.join('\n')}\n\n[Source: growthepie]`,
      },
    ],
  };
});

server.tool('get_l2_activity', 'Compare L2 activity by daily active addresses', {}, async () => {
  const ranking = await growthepie.getMetricRanking('daa', 20);
  const formatted = ranking.map(
    (r, i) => `${i + 1}. ${r.chain}: ${Math.round(r.value).toLocaleString()} daily active addresses`
  );
  return {
    content: [
      {
        type: 'text' as const,
        text: `L2 Activity Ranking (by DAA):\n\n${formatted.join('\n')}\n\n[Source: growthepie]`,
      },
    ],
  };
});

// ============================================
// COINGECKO TOOLS (free tier + optional Pro)
// Market data, exchanges, derivatives, NFTs
// ============================================

server.tool(
  'set_coingecko_key',
  'Set CoinGecko Pro API key for higher rate limits and Pro-only features. Get one at coingecko.com/api/pricing',
  {
    key: z.string().describe("The user's CoinGecko Pro API key"),
  },
  async ({ key }) => {
    coingecko.setApiKey(key);
    return {
      content: [
        {
          type: 'text' as const,
          text: `CoinGecko Pro API key set. You now have access to:\n- Higher rate limits (500 req/min vs 30)\n- Top gainers/losers\n- Recently added coins\n- NFT markets & charts\n- Global market cap history`,
        },
      ],
    };
  }
);

// ============================================
// COINGECKO FREE TOOLS
// ============================================

server.tool(
  'get_token_price',
  'Get current price for a cryptocurrency by name or symbol',
  {
    token: z.string().describe("Token name or symbol (e.g., 'bitcoin', 'eth', 'uniswap')"),
  },
  async ({ token }) => {
    // First try direct lookup (works for well-known tokens)
    let prices = await coingecko.getPrice(token.toLowerCase());
    let data = prices[token.toLowerCase()];
    let tokenId = token.toLowerCase();
    let tokenName = token.toUpperCase();

    // If direct lookup fails, search for the token
    if (!data) {
      const searchResults = await coingecko.searchCoins(token);
      if (!searchResults.coins || searchResults.coins.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Token "${token}" not found.\n\n[Source: CoinGecko]`,
            },
          ],
        };
      }

      // Use the top result (usually most relevant by market cap)
      const match = searchResults.coins[0];
      tokenId = match.id;
      tokenName = `${match.name} (${match.symbol.toUpperCase()})`;

      // Fetch price using the correct ID
      prices = await coingecko.getPrice(tokenId);
      data = prices[tokenId];
    }

    if (!data) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Could not fetch price for "${token}".\n\n[Source: CoinGecko]`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `${tokenName} Price:\n- USD: $${data.usd?.toLocaleString() || 'N/A'}\n- 24h Change: ${data.usd_24h_change?.toFixed(2) || 'N/A'}%\n- Market Cap: ${formatUSD(data.usd_market_cap || 0)}\n\n[Source: CoinGecko]`,
        },
      ],
    };
  }
);

server.tool(
  'get_token_price_by_contract',
  'Get token price by contract address on a specific platform',
  {
    platform: z.string().describe("Platform ID (e.g., 'ethereum', 'polygon-pos', 'arbitrum-one')"),
    address: z.string().describe('Token contract address'),
  },
  async ({ platform, address }) => {
    const data = await coingecko.getTokenPriceByContract(platform, address);
    const tokenData = data[address.toLowerCase()];
    if (!tokenData) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Token not found at ${address} on ${platform}\n\n[Source: CoinGecko]`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `Token at ${address.slice(0, 10)}... on ${platform}:\n- USD: $${tokenData.usd?.toLocaleString() || 'N/A'}\n- 24h Change: ${tokenData.usd_24h_change?.toFixed(2) || 'N/A'}%\n- Market Cap: ${formatUSD(tokenData.usd_market_cap || 0)}\n\n[Source: CoinGecko]`,
        },
      ],
    };
  }
);

server.tool(
  'get_top_tokens',
  'Get top cryptocurrencies by market cap',
  {
    limit: z.number().optional().default(20).describe('Number of results (default: 20)'),
  },
  async ({ limit }) => {
    const coins = await coingecko.getFormattedTopCoins(limit);
    const formatted = coins.map(
      (c, i) =>
        `${i + 1}. ${c.name} (${c.symbol}): $${c.price.toLocaleString()} | ${c.change24h >= 0 ? '+' : ''}${c.change24h.toFixed(2)}% | MCap: ${formatUSD(c.marketCap)}`
    );
    return {
      content: [
        {
          type: 'text' as const,
          text: `Top ${limit} Cryptocurrencies:\n\n${formatted.join('\n')}\n\n[Source: CoinGecko]`,
        },
      ],
    };
  }
);

server.tool('get_trending_tokens', 'Get trending cryptocurrencies on CoinGecko', {}, async () => {
  const trending = await coingecko.getFormattedTrending();
  const formatted = trending.map(
    (c, i) => `${i + 1}. ${c.name} (${c.symbol}) - Rank #${c.marketCapRank}`
  );
  return {
    content: [
      {
        type: 'text' as const,
        text: `Trending Cryptocurrencies:\n\n${formatted.join('\n')}\n\n[Source: CoinGecko]`,
      },
    ],
  };
});

server.tool('get_global_market', 'Get global cryptocurrency market statistics', {}, async () => {
  const data = await coingecko.getFormattedGlobalData();
  return {
    content: [
      {
        type: 'text' as const,
        text: `Global Crypto Market:\n\n- Total Market Cap: ${formatUSD(data.totalMarketCap)}\n- 24h Volume: ${formatUSD(data.totalVolume24h)}\n- BTC Dominance: ${data.btcDominance.toFixed(1)}%\n- ETH Dominance: ${data.ethDominance.toFixed(1)}%\n- Active Cryptocurrencies: ${data.activeCryptos.toLocaleString()}\n\n[Source: CoinGecko]`,
      },
    ],
  };
});

server.tool('get_global_defi', 'Get global DeFi market statistics', {}, async () => {
  const data = await coingecko.getGlobalDefiData();
  return {
    content: [
      {
        type: 'text' as const,
        text: `Global DeFi Market:\n\n- DeFi Market Cap: ${formatUSD(data.data.defi_market_cap)}\n- ETH Market Cap: ${formatUSD(data.data.eth_market_cap)}\n- DeFi/ETH Ratio: ${data.data.defi_to_eth_ratio?.toFixed(2) || 'N/A'}%\n- 24h Trading Volume: ${formatUSD(data.data.trading_volume_24h)}\n- DeFi Dominance: ${data.data.defi_dominance?.toFixed(2) || 'N/A'}%\n\n[Source: CoinGecko]`,
      },
    ],
  };
});

server.tool(
  'search_tokens',
  'Search for cryptocurrencies by name or symbol',
  {
    query: z.string().describe('Search query (token name or symbol)'),
  },
  async ({ query }) => {
    const results = await coingecko.searchCoins(query);
    if (!results.coins || results.coins.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No tokens found matching "${query}"\n\n[Source: CoinGecko]`,
          },
        ],
      };
    }
    const formatted = results.coins
      .slice(0, 10)
      .map(
        (c: any) =>
          `${c.name} (${c.symbol.toUpperCase()}) - ID: ${c.id} - Rank #${c.market_cap_rank || 'N/A'}`
      );
    return {
      content: [
        {
          type: 'text' as const,
          text: `Tokens matching "${query}":\n\n${formatted.join('\n')}\n\nUse the ID with get_token_price for price data.\n\n[Source: CoinGecko]`,
        },
      ],
    };
  }
);

server.tool(
  'get_coin_details',
  'Get detailed information about a cryptocurrency',
  {
    id: z
      .string()
      .describe("Coin ID (e.g., 'bitcoin', 'ethereum') - use search_tokens to find IDs"),
  },
  async ({ id }) => {
    const data = await coingecko.getCoinDetails(id);
    if (!data) {
      return {
        content: [
          { type: 'text' as const, text: `Coin "${id}" not found.\n\n[Source: CoinGecko]` },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `${data.name} (${data.symbol?.toUpperCase()}):\n\n- Current Price: $${data.market_data?.current_price?.usd?.toLocaleString() || 'N/A'}\n- Market Cap: ${formatUSD(data.market_data?.market_cap?.usd || 0)}\n- 24h High/Low: $${data.market_data?.high_24h?.usd?.toLocaleString() || 'N/A'} / $${data.market_data?.low_24h?.usd?.toLocaleString() || 'N/A'}\n- All-Time High: $${data.market_data?.ath?.usd?.toLocaleString() || 'N/A'}\n- Circulating Supply: ${data.market_data?.circulating_supply?.toLocaleString() || 'N/A'}\n- Total Supply: ${data.market_data?.total_supply?.toLocaleString() || 'N/A'}\n- Rank: #${data.market_cap_rank || 'N/A'}\n\n[Source: CoinGecko]`,
        },
      ],
    };
  }
);

server.tool(
  'get_coin_history',
  'Get historical data for a coin on a specific date',
  {
    id: z.string().describe("Coin ID (e.g., 'bitcoin')"),
    date: z.string().describe('Date in dd-mm-yyyy format'),
  },
  async ({ id, date }) => {
    const data = await coingecko.getCoinHistory(id, date);
    if (!data || !data.market_data) {
      return {
        content: [
          { type: 'text' as const, text: `No data for ${id} on ${date}.\n\n[Source: CoinGecko]` },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `${data.name} on ${date}:\n\n- Price: $${data.market_data.current_price?.usd?.toLocaleString() || 'N/A'}\n- Market Cap: ${formatUSD(data.market_data.market_cap?.usd || 0)}\n- Volume: ${formatUSD(data.market_data.total_volume?.usd || 0)}\n\n[Source: CoinGecko]`,
        },
      ],
    };
  }
);

server.tool(
  'get_coin_chart',
  'Get historical price chart data for a coin',
  {
    id: z.string().describe("Coin ID (e.g., 'bitcoin')"),
    days: z.number().optional().default(30).describe('Number of days (1, 7, 30, 90, 365, max)'),
  },
  async ({ id, days }) => {
    const data = await coingecko.getCoinMarketChart(id, days);
    if (!data.prices || data.prices.length === 0) {
      return {
        content: [
          { type: 'text' as const, text: `No chart data for ${id}.\n\n[Source: CoinGecko]` },
        ],
      };
    }
    const first = data.prices[0][1];
    const last = data.prices[data.prices.length - 1][1];
    const change = ((last - first) / first) * 100;
    const high = Math.max(...data.prices.map((p: any) => p[1]));
    const low = Math.min(...data.prices.map((p: any) => p[1]));
    return {
      content: [
        {
          type: 'text' as const,
          text: `${id.toUpperCase()} ${days}-Day Chart:\n\n- Start: $${first.toLocaleString()}\n- End: $${last.toLocaleString()}\n- Change: ${change >= 0 ? '+' : ''}${change.toFixed(2)}%\n- High: $${high.toLocaleString()}\n- Low: $${low.toLocaleString()}\n- Data points: ${data.prices.length}\n\n[Source: CoinGecko]`,
        },
      ],
    };
  }
);

server.tool(
  'get_coin_ohlc',
  'Get OHLC (candlestick) data for a coin',
  {
    id: z.string().describe("Coin ID (e.g., 'bitcoin')"),
    days: z.number().optional().default(30).describe('Days (1, 7, 14, 30, 90, 180, 365, max)'),
  },
  async ({ id, days }) => {
    const data = await coingecko.getCoinOHLC(id, days);
    if (!data || data.length === 0) {
      return {
        content: [
          { type: 'text' as const, text: `No OHLC data for ${id}.\n\n[Source: CoinGecko]` },
        ],
      };
    }
    const recent = data.slice(-5).map((d: any) => {
      const date = new Date(d[0]).toLocaleDateString();
      return `${date}: O:$${d[1].toLocaleString()} H:$${d[2].toLocaleString()} L:$${d[3].toLocaleString()} C:$${d[4].toLocaleString()}`;
    });
    return {
      content: [
        {
          type: 'text' as const,
          text: `${id.toUpperCase()} OHLC (${days} days, last 5):\n\n${recent.join('\n')}\n\nTotal candles: ${data.length}\n\n[Source: CoinGecko]`,
        },
      ],
    };
  }
);

server.tool(
  'get_coin_tickers',
  'Get exchanges and trading pairs for a coin',
  {
    id: z.string().describe("Coin ID (e.g., 'bitcoin')"),
  },
  async ({ id }) => {
    const data = await coingecko.getCoinTickers(id);
    if (!data.tickers || data.tickers.length === 0) {
      return {
        content: [
          { type: 'text' as const, text: `No tickers found for ${id}.\n\n[Source: CoinGecko]` },
        ],
      };
    }
    const formatted = data.tickers
      .slice(0, 15)
      .map(
        (t: any) =>
          `${t.market.name}: ${t.base}/${t.target} @ $${t.converted_last?.usd?.toLocaleString() || 'N/A'} | Vol: ${formatUSD(t.converted_volume?.usd || 0)}`
      );
    return {
      content: [
        {
          type: 'text' as const,
          text: `${id.toUpperCase()} Trading Pairs:\n\n${formatted.join('\n')}\n\n[Source: CoinGecko]`,
        },
      ],
    };
  }
);

server.tool(
  'get_coin_by_contract',
  'Get coin data by contract address',
  {
    platform: z.string().describe("Platform ID (e.g., 'ethereum', 'polygon-pos')"),
    address: z.string().describe('Token contract address'),
  },
  async ({ platform, address }) => {
    const data = await coingecko.getCoinByContract(platform, address);
    if (!data) {
      return {
        content: [
          { type: 'text' as const, text: `Token not found at ${address}.\n\n[Source: CoinGecko]` },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `${data.name} (${data.symbol?.toUpperCase()}):\n\n- Price: $${data.market_data?.current_price?.usd?.toLocaleString() || 'N/A'}\n- Market Cap: ${formatUSD(data.market_data?.market_cap?.usd || 0)}\n- 24h Volume: ${formatUSD(data.market_data?.total_volume?.usd || 0)}\n- Contract: ${address}\n- Platform: ${platform}\n\n[Source: CoinGecko]`,
        },
      ],
    };
  }
);

// Categories & Platforms
server.tool('get_categories', 'Get crypto categories with market data', {}, async () => {
  const data = await coingecko.getCategories();
  if (!data || data.length === 0) {
    return {
      content: [{ type: 'text' as const, text: 'No categories found.\n\n[Source: CoinGecko]' }],
    };
  }
  const formatted = data
    .slice(0, 20)
    .map(
      (c: any) =>
        `${c.name}: ${formatUSD(c.market_cap || 0)} MCap | ${c.market_cap_change_24h?.toFixed(2) || 'N/A'}% 24h`
    );
  return {
    content: [
      {
        type: 'text' as const,
        text: `Crypto Categories (Top 20):\n\n${formatted.join('\n')}\n\n[Source: CoinGecko]`,
      },
    ],
  };
});

server.tool('get_asset_platforms', 'Get list of blockchain platforms', {}, async () => {
  const data = await coingecko.getAssetPlatforms();
  if (!data || data.length === 0) {
    return {
      content: [{ type: 'text' as const, text: 'No platforms found.\n\n[Source: CoinGecko]' }],
    };
  }
  const formatted = data
    .filter((p: any) => p.id)
    .slice(0, 30)
    .map(
      (p: any) =>
        `${p.name || p.id}: ${p.id}${p.chain_identifier ? ` (Chain ${p.chain_identifier})` : ''}`
    );
  return {
    content: [
      {
        type: 'text' as const,
        text: `Asset Platforms:\n\n${formatted.join('\n')}\n\nUse platform ID with get_token_price_by_contract.\n\n[Source: CoinGecko]`,
      },
    ],
  };
});

// Exchanges
server.tool(
  'get_exchanges',
  'Get top cryptocurrency exchanges by volume',
  {
    limit: z.number().optional().default(20).describe('Number of results (default: 20)'),
  },
  async ({ limit }) => {
    const data = await coingecko.getExchanges(limit);
    if (!data || data.length === 0) {
      return {
        content: [{ type: 'text' as const, text: 'No exchanges found.\n\n[Source: CoinGecko]' }],
      };
    }
    const formatted = data.map(
      (e: any, i: number) =>
        `${i + 1}. ${e.name}: ${formatUSD(e.trade_volume_24h_btc * 40000)} (24h) | Trust: ${e.trust_score}/10`
    );
    return {
      content: [
        {
          type: 'text' as const,
          text: `Top Exchanges:\n\n${formatted.join('\n')}\n\n[Source: CoinGecko]`,
        },
      ],
    };
  }
);

server.tool(
  'get_exchange',
  'Get detailed data for a specific exchange',
  {
    id: z.string().describe("Exchange ID (e.g., 'binance', 'coinbase-exchange')"),
  },
  async ({ id }) => {
    const data = await coingecko.getExchange(id);
    if (!data) {
      return {
        content: [
          { type: 'text' as const, text: `Exchange "${id}" not found.\n\n[Source: CoinGecko]` },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `${data.name}:\n\n- Trust Score: ${data.trust_score}/10\n- 24h Volume (BTC): ${data.trade_volume_24h_btc?.toLocaleString() || 'N/A'}\n- Country: ${data.country || 'N/A'}\n- Year Established: ${data.year_established || 'N/A'}\n- Trading Pairs: ${data.tickers?.length || 'N/A'}\n\n[Source: CoinGecko]`,
        },
      ],
    };
  }
);

server.tool(
  'get_exchange_tickers',
  'Get trading pairs for an exchange',
  {
    id: z.string().describe("Exchange ID (e.g., 'binance')"),
  },
  async ({ id }) => {
    const data = await coingecko.getExchangeTickers(id);
    if (!data.tickers || data.tickers.length === 0) {
      return {
        content: [{ type: 'text' as const, text: `No tickers for ${id}.\n\n[Source: CoinGecko]` }],
      };
    }
    const formatted = data.tickers
      .slice(0, 20)
      .map(
        (t: any) =>
          `${t.base}/${t.target}: $${t.converted_last?.usd?.toLocaleString() || 'N/A'} | Vol: ${formatUSD(t.converted_volume?.usd || 0)}`
      );
    return {
      content: [
        {
          type: 'text' as const,
          text: `${data.name} Trading Pairs:\n\n${formatted.join('\n')}\n\n[Source: CoinGecko]`,
        },
      ],
    };
  }
);

server.tool(
  'get_exchange_volume_chart',
  'Get exchange volume history',
  {
    id: z.string().describe("Exchange ID (e.g., 'binance')"),
    days: z.number().optional().default(30).describe('Number of days'),
  },
  async ({ id, days }) => {
    const data = await coingecko.getExchangeVolumeChart(id, days);
    if (!data || data.length === 0) {
      return {
        content: [
          { type: 'text' as const, text: `No volume data for ${id}.\n\n[Source: CoinGecko]` },
        ],
      };
    }
    const first = data[0][1];
    const last = data[data.length - 1][1];
    const change = ((last - first) / first) * 100;
    return {
      content: [
        {
          type: 'text' as const,
          text: `${id} Volume (${days} days):\n\n- Start: ${first.toLocaleString()} BTC\n- End: ${last.toLocaleString()} BTC\n- Change: ${change >= 0 ? '+' : ''}${change.toFixed(2)}%\n- Data points: ${data.length}\n\n[Source: CoinGecko]`,
        },
      ],
    };
  }
);

// Derivatives
server.tool('get_cg_derivatives', 'Get derivatives tickers from CoinGecko', {}, async () => {
  const data = await coingecko.getDerivatives();
  if (!data || data.length === 0) {
    return {
      content: [{ type: 'text' as const, text: 'No derivatives data.\n\n[Source: CoinGecko]' }],
    };
  }
  const formatted = data
    .slice(0, 20)
    .map(
      (d: any) =>
        `${d.symbol} on ${d.market}: $${d.price?.toLocaleString() || 'N/A'} | OI: ${formatUSD(d.open_interest || 0)} | Funding: ${d.funding_rate?.toFixed(4) || 'N/A'}%`
    );
  return {
    content: [
      {
        type: 'text' as const,
        text: `Derivatives Tickers:\n\n${formatted.join('\n')}\n\n[Source: CoinGecko]`,
      },
    ],
  };
});

server.tool('get_derivatives_exchanges', 'Get derivatives exchanges', {}, async () => {
  const data = await coingecko.getDerivativesExchanges();
  if (!data || data.length === 0) {
    return {
      content: [
        { type: 'text' as const, text: 'No derivatives exchanges found.\n\n[Source: CoinGecko]' },
      ],
    };
  }
  const formatted = data
    .slice(0, 15)
    .map(
      (e: any) =>
        `${e.name}: ${e.number_of_perpetual_pairs || 0} perps | OI: ${formatUSD(e.open_interest_btc * 40000 || 0)}`
    );
  return {
    content: [
      {
        type: 'text' as const,
        text: `Derivatives Exchanges:\n\n${formatted.join('\n')}\n\n[Source: CoinGecko]`,
      },
    ],
  };
});

// NFTs (Free endpoints)
server.tool('get_nfts_list', 'Get list of NFT collections on CoinGecko', {}, async () => {
  const data = await coingecko.getNftsList();
  if (!data || data.length === 0) {
    return {
      content: [{ type: 'text' as const, text: 'No NFT data available.\n\n[Source: CoinGecko]' }],
    };
  }
  const formatted = data
    .slice(0, 20)
    .map((n: any) => `${n.name}: ${n.id} (${n.asset_platform_id || 'N/A'})`);
  return {
    content: [
      {
        type: 'text' as const,
        text: `NFT Collections:\n\n${formatted.join('\n')}\n\nUse ID with get_nft_details.\n\n[Source: CoinGecko]`,
      },
    ],
  };
});

server.tool(
  'get_nft_details',
  'Get details for an NFT collection',
  {
    id: z.string().describe("NFT collection ID (e.g., 'cryptopunks', 'bored-ape-yacht-club')"),
  },
  async ({ id }) => {
    const data = await coingecko.getNftDetails(id);
    if (!data) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `NFT collection "${id}" not found.\n\n[Source: CoinGecko]`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `${data.name}:\n\n- Floor Price: ${data.floor_price?.native_currency?.toFixed(4) || 'N/A'} ${data.native_currency_symbol || ''}\n- Floor (USD): $${data.floor_price?.usd?.toLocaleString() || 'N/A'}\n- Market Cap: ${formatUSD(data.market_cap?.usd || 0)}\n- 24h Volume: ${formatUSD(data.volume_24h?.usd || 0)}\n- Total Supply: ${data.total_supply?.toLocaleString() || 'N/A'}\n- Holders: ${data.number_of_unique_addresses?.toLocaleString() || 'N/A'}\n\n[Source: CoinGecko]`,
        },
      ],
    };
  }
);

server.tool('get_exchange_rates', 'Get BTC exchange rates to other currencies', {}, async () => {
  const data = await coingecko.getExchangeRates();
  if (!data.rates) {
    return {
      content: [
        { type: 'text' as const, text: 'Exchange rates unavailable.\n\n[Source: CoinGecko]' },
      ],
    };
  }
  const major = ['usd', 'eur', 'gbp', 'jpy', 'eth', 'xau'];
  const formatted = major
    .map((c) => {
      const rate = data.rates[c];
      return rate ? `${rate.name}: ${rate.value.toLocaleString()} ${rate.unit}` : null;
    })
    .filter(Boolean);
  return {
    content: [
      {
        type: 'text' as const,
        text: `BTC Exchange Rates:\n\n${formatted.join('\n')}\n\n[Source: CoinGecko]`,
      },
    ],
  };
});

// ============================================
// COINGECKO PRO TOOLS
// ============================================

server.tool(
  'get_top_movers',
  'Get top gaining and losing coins (Pro)',
  {
    duration: z
      .string()
      .optional()
      .default('24h')
      .describe("Duration: '1h', '24h', '7d', '14d', '30d', '60d', '1y'"),
  },
  async ({ duration }) => {
    const data = await coingecko.getTopMovers('usd', duration);
    if (!data.top_gainers && !data.top_losers) {
      return {
        content: [
          { type: 'text' as const, text: 'No movers data available.\n\n[Source: CoinGecko Pro]' },
        ],
      };
    }
    const gainers = (data.top_gainers || [])
      .slice(0, 5)
      .map(
        (c: any) =>
          `+${c.price_change_percentage_24h?.toFixed(2) || '?'}% ${c.name} (${c.symbol?.toUpperCase()}): $${c.usd?.toLocaleString() || 'N/A'}`
      );
    const losers = (data.top_losers || [])
      .slice(0, 5)
      .map(
        (c: any) =>
          `${c.price_change_percentage_24h?.toFixed(2) || '?'}% ${c.name} (${c.symbol?.toUpperCase()}): $${c.usd?.toLocaleString() || 'N/A'}`
      );
    return {
      content: [
        {
          type: 'text' as const,
          text: `Top Movers (${duration}):\n\n🟢 GAINERS:\n${gainers.join('\n') || 'None'}\n\n🔴 LOSERS:\n${losers.join('\n') || 'None'}\n\n[Source: CoinGecko Pro]`,
        },
      ],
    };
  }
);

server.tool('get_new_coins', 'Get recently added coins (Pro)', {}, async () => {
  const data = await coingecko.getNewCoins();
  if (!data || data.length === 0) {
    return {
      content: [{ type: 'text' as const, text: 'No new coins data.\n\n[Source: CoinGecko Pro]' }],
    };
  }
  const formatted = data
    .slice(0, 15)
    .map(
      (c: any) =>
        `${c.name} (${c.symbol?.toUpperCase() || '?'}) - Added: ${c.activated_at || 'N/A'}`
    );
  return {
    content: [
      {
        type: 'text' as const,
        text: `Recently Added Coins:\n\n${formatted.join('\n')}\n\n[Source: CoinGecko Pro]`,
      },
    ],
  };
});

server.tool('get_nft_markets', 'Get NFT collections by market cap (Pro)', {}, async () => {
  const data = await coingecko.getNftMarkets();
  if (!data || data.length === 0) {
    return {
      content: [{ type: 'text' as const, text: 'No NFT market data.\n\n[Source: CoinGecko Pro]' }],
    };
  }
  const formatted = data
    .slice(0, 15)
    .map(
      (n: any, i: number) =>
        `${i + 1}. ${n.name}: Floor ${n.floor_price_in_native_currency?.toFixed(4) || 'N/A'} ${n.native_currency_symbol || ''} | MCap: ${formatUSD(n.market_cap?.usd || 0)}`
    );
  return {
    content: [
      {
        type: 'text' as const,
        text: `NFT Markets:\n\n${formatted.join('\n')}\n\n[Source: CoinGecko Pro]`,
      },
    ],
  };
});

server.tool(
  'get_nft_chart',
  'Get NFT collection price history (Pro)',
  {
    id: z.string().describe('NFT collection ID'),
    days: z.number().optional().default(30).describe('Number of days'),
  },
  async ({ id, days }) => {
    const data = await coingecko.getNftMarketChart(id, days);
    if (!data.floor_price_usd || data.floor_price_usd.length === 0) {
      return {
        content: [
          { type: 'text' as const, text: `No chart data for ${id}.\n\n[Source: CoinGecko Pro]` },
        ],
      };
    }
    const prices = data.floor_price_usd;
    const first = prices[0][1];
    const last = prices[prices.length - 1][1];
    const change = ((last - first) / first) * 100;
    return {
      content: [
        {
          type: 'text' as const,
          text: `${id} NFT Floor (${days} days):\n\n- Start: $${first.toLocaleString()}\n- End: $${last.toLocaleString()}\n- Change: ${change >= 0 ? '+' : ''}${change.toFixed(2)}%\n\n[Source: CoinGecko Pro]`,
        },
      ],
    };
  }
);

server.tool(
  'get_global_chart',
  'Get historical global market cap chart (Pro)',
  {
    days: z.number().optional().default(30).describe('Number of days'),
  },
  async ({ days }) => {
    const data = await coingecko.getGlobalMarketCapChart(days);
    if (!data.market_cap_chart || data.market_cap_chart.length === 0) {
      return {
        content: [
          { type: 'text' as const, text: 'No global chart data.\n\n[Source: CoinGecko Pro]' },
        ],
      };
    }
    const chart = data.market_cap_chart;
    const first = chart[0][1];
    const last = chart[chart.length - 1][1];
    const change = ((last - first) / first) * 100;
    return {
      content: [
        {
          type: 'text' as const,
          text: `Global Market Cap (${days} days):\n\n- Start: ${formatUSD(first)}\n- End: ${formatUSD(last)}\n- Change: ${change >= 0 ? '+' : ''}${change.toFixed(2)}%\n- Data points: ${chart.length}\n\n[Source: CoinGecko Pro]`,
        },
      ],
    };
  }
);

// ============================================
// BLOBSCAN TOOLS (free, no key)
// EIP-4844 blob data
// ============================================

server.tool(
  'get_recent_blobs',
  'Get recent EIP-4844 blobs posted to Ethereum',
  {
    limit: z.number().optional().default(10).describe('Number of blobs (default: 10, max: 100)'),
  },
  async ({ limit }) => {
    const blobs = await blobscan.getFormattedRecentBlobs(limit);
    if (blobs.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Unable to fetch blob data. Try again later.\n\n[Source: Blobscan]',
          },
        ],
      };
    }
    const formatted = blobs.map(
      (b, i) =>
        `${i + 1}. Block ${b.block} | ${b.size.toLocaleString()} bytes | ${b.hash.slice(0, 18)}...`
    );
    return {
      content: [
        {
          type: 'text' as const,
          text: `Recent EIP-4844 Blobs:\n\n${formatted.join('\n')}\n\n[Source: Blobscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_blob',
  'Get details for a specific blob by versioned hash',
  {
    hash: z.string().describe('Blob versioned hash (0x...)'),
  },
  async ({ hash }) => {
    const blob = await blobscan.getFormattedBlob(hash);
    if (!blob) {
      return {
        content: [
          { type: 'text' as const, text: `Blob "${hash}" not found.\n\n[Source: Blobscan]` },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `Blob Details:\n\n- Hash: ${blob.hash}\n- Size: ${blob.size.toLocaleString()} bytes\n- Block: ${blob.block}\n- Timestamp: ${blob.timestamp}\n- Transaction: ${blob.txHash}\n- Commitment: ${blob.commitment.slice(0, 20)}...\n\n[Source: Blobscan]`,
        },
      ],
    };
  }
);

server.tool('get_blob_stats', 'Get aggregate statistics for EIP-4844 blobs', {}, async () => {
  const stats = await blobscan.getFormattedBlobStats();
  if (!stats) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Unable to fetch blob stats. Try again later.\n\n[Source: Blobscan]',
        },
      ],
    };
  }
  return {
    content: [
      {
        type: 'text' as const,
        text: `EIP-4844 Blob Statistics:\n\n- Total Blobs: ${stats.totalBlobs.toLocaleString()}\n- Total Size: ${stats.totalSize}\n- Avg Blob Size: ${stats.avgBlobSize.toLocaleString()} bytes\n- Total Blob Transactions: ${stats.totalTransactions.toLocaleString()}\n\n[Source: Blobscan]`,
      },
    ],
  };
});

server.tool(
  'get_blob_transactions',
  'Get recent transactions that posted blobs to Ethereum',
  {
    limit: z
      .number()
      .optional()
      .default(10)
      .describe('Number of transactions (default: 10, max: 100)'),
  },
  async ({ limit }) => {
    const txs = await blobscan.getFormattedTransactions(limit);
    if (txs.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Unable to fetch blob transactions. Try again later.\n\n[Source: Blobscan]',
          },
        ],
      };
    }
    const formatted = txs.map(
      (t, i) =>
        `${i + 1}. Block ${t.block} | ${t.blobCount} blobs | From: ${t.from.slice(0, 10)}... | ${t.hash.slice(0, 18)}...`
    );
    return {
      content: [
        {
          type: 'text' as const,
          text: `Recent Blob Transactions:\n\n${formatted.join('\n')}\n\n[Source: Blobscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_blob_transaction',
  'Get details for a specific blob transaction by hash',
  {
    hash: z.string().describe('Transaction hash (0x...)'),
  },
  async ({ hash }) => {
    const tx = await blobscan.getFormattedTransaction(hash);
    if (!tx) {
      return {
        content: [
          { type: 'text' as const, text: `Transaction "${hash}" not found.\n\n[Source: Blobscan]` },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `Blob Transaction Details:\n\n- Hash: ${tx.hash}\n- Block: ${tx.block}\n- From: ${tx.from}\n- To: ${tx.to}\n- Blob Count: ${tx.blobCount}\n- Blob Gas Used: ${tx.blobGasUsed.toLocaleString()}\n- Blob Gas Price: ${tx.blobGasPrice}\n- Timestamp: ${tx.timestamp}\n\n[Source: Blobscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_blob_counts',
  'Get total counts of blobs, blocks, and transactions',
  {},
  async () => {
    const counts = await blobscan.getFormattedCounts();
    return {
      content: [
        {
          type: 'text' as const,
          text: `Blobscan Counts:\n\n- Total Blobs: ${counts.blobs.toLocaleString()}\n- Blocks with Blobs: ${counts.blocks.toLocaleString()}\n- Blob Transactions: ${counts.transactions.toLocaleString()}\n\n[Source: Blobscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_blob_daily_stats',
  'Get daily blob statistics for the most recent day',
  {},
  async () => {
    const stats = await blobscan.getFormattedDailyStats();
    if (!stats) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Unable to fetch daily stats. Try again later.\n\n[Source: Blobscan]',
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `Latest Blob Activity (${stats.date}):\n\n- Latest Block: ${stats.latestBlock.toLocaleString()}\n- Latest Slot: ${stats.latestSlot.toLocaleString()}\n- Recent Blobs: ${stats.recentBlobs}\n- Recent Transactions: ${stats.recentTransactions}\n\n[Source: Blobscan]`,
        },
      ],
    };
  }
);

server.tool('get_blob_block_stats', 'Get block-level blob statistics', {}, async () => {
  const stats = await blobscan.getFormattedBlockStats();
  if (!stats) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Unable to fetch block stats. Try again later.\n\n[Source: Blobscan]',
        },
      ],
    };
  }
  return {
    content: [
      {
        type: 'text' as const,
        text: `Latest Block Blob Info:\n\n- Latest Block: ${stats.latestBlockNumber.toLocaleString()}\n- Blob Gas Used: ${stats.blobGasUsed}\n- Blob Gas Price: ${stats.blobGasPrice} wei\n\n[Source: Blobscan]`,
      },
    ],
  };
});

server.tool('get_blob_tx_stats', 'Get transaction-level blob statistics', {}, async () => {
  const stats = await blobscan.getFormattedTransactionStats();
  if (!stats) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Unable to fetch transaction stats. Try again later.\n\n[Source: Blobscan]',
        },
      ],
    };
  }
  return {
    content: [
      {
        type: 'text' as const,
        text: `Recent Blob Transactions:\n\n- Recent Transactions: ${stats.recentTransactions}\n- Total Blobs: ${stats.totalBlobs}\n- Avg Blobs/Transaction: ${stats.avgBlobsPerTx}\n\n[Source: Blobscan]`,
      },
    ],
  };
});

server.tool(
  'blobscan_search',
  'Search Blobscan for blobs, blocks, transactions, or addresses',
  {
    query: z.string().describe('Search query (blob hash, tx hash, block number, slot, or address)'),
  },
  async ({ query }) => {
    const results = await blobscan.getFormattedSearch(query);
    if (!results) {
      return {
        content: [
          { type: 'text' as const, text: `No results found for "${query}".\n\n[Source: Blobscan]` },
        ],
      };
    }

    const sections: string[] = [];
    if (results.blobs.length > 0) {
      sections.push(
        `Blobs (${results.blobs.length}):\n` +
          results.blobs.map((b) => `  - ${b.hash.slice(0, 18)}... (block ${b.block})`).join('\n')
      );
    }
    if (results.blocks.length > 0) {
      sections.push(
        `Blocks (${results.blocks.length}):\n` +
          results.blocks.map((b) => `  - Block ${b.number} (slot ${b.slot})`).join('\n')
      );
    }
    if (results.transactions.length > 0) {
      sections.push(
        `Transactions (${results.transactions.length}):\n` +
          results.transactions
            .map((t) => `  - ${t.hash.slice(0, 18)}... (block ${t.block})`)
            .join('\n')
      );
    }
    if (results.addresses.length > 0) {
      sections.push(
        `Addresses (${results.addresses.length}):\n` +
          results.addresses.map((a) => `  - ${a.address}`).join('\n')
      );
    }

    if (sections.length === 0) {
      return {
        content: [
          { type: 'text' as const, text: `No results found for "${query}".\n\n[Source: Blobscan]` },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Search Results for "${query}":\n\n${sections.join('\n\n')}\n\n[Source: Blobscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_blobs_by_address',
  'Get blobs posted by a specific address',
  {
    address: z.string().describe('Ethereum address (0x...)'),
    limit: z.number().optional().default(10).describe('Number of blobs (default: 10, max: 100)'),
  },
  async ({ address, limit }) => {
    const blobs = await blobscan.getBlobsByAddress(address, limit);
    if (blobs.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No blobs found for address "${address}".\n\n[Source: Blobscan]`,
          },
        ],
      };
    }
    const formatted = blobs.map(
      (b: any, i: number) =>
        `${i + 1}. Block ${b.blockNumber || 'N/A'} | ${(b.size || 0).toLocaleString()} bytes | ${(b.versionedHash || b.hash || '').slice(0, 18)}...`
    );
    return {
      content: [
        {
          type: 'text' as const,
          text: `Blobs from ${address.slice(0, 10)}...:\n\n${formatted.join('\n')}\n\n[Source: Blobscan]`,
        },
      ],
    };
  }
);

server.tool(
  'get_blob_block',
  'Get a specific block with its blob details',
  {
    block: z.union([z.number(), z.string()]).describe('Block number or hash'),
  },
  async ({ block }) => {
    const blockData = await blobscan.getBlockBlobs(block);
    if (!blockData) {
      return {
        content: [
          { type: 'text' as const, text: `Block "${block}" not found.\n\n[Source: Blobscan]` },
        ],
      };
    }
    const blobCount = blockData.blobs?.length || blockData.blobsCount || 0;
    const txCount = blockData.transactions?.length || blockData.transactionsCount || 0;
    return {
      content: [
        {
          type: 'text' as const,
          text: `Block ${blockData.number || block}:\n\n- Slot: ${blockData.slot || 'N/A'}\n- Hash: ${blockData.hash?.slice(0, 20) || 'N/A'}...\n- Blobs: ${blobCount}\n- Transactions: ${txCount}\n- Timestamp: ${blockData.timestamp || 'N/A'}\n- Blob Gas Used: ${blockData.blobGasUsed?.toLocaleString() || 'N/A'}\n\n[Source: Blobscan]`,
        },
      ],
    };
  }
);

server.tool('get_latest_blob_block', 'Get the latest block with blob data', {}, async () => {
  const block = await blobscan.getLatestBlock();
  if (!block) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Unable to fetch latest block. Try again later.\n\n[Source: Blobscan]',
        },
      ],
    };
  }
  const blobCount = block.blobs?.length || block.blobsCount || 0;
  const txCount = block.transactions?.length || block.transactionsCount || 0;
  return {
    content: [
      {
        type: 'text' as const,
        text: `Latest Block with Blobs:\n\n- Block: ${block.number}\n- Slot: ${block.slot || 'N/A'}\n- Blobs: ${blobCount}\n- Transactions: ${txCount}\n- Blob Gas Used: ${block.blobGasUsed?.toLocaleString() || 'N/A'}\n- Timestamp: ${block.timestamp || 'N/A'}\n\n[Source: Blobscan]`,
      },
    ],
  };
});

// ============================================
// DUNE TOOLS (optional, requires API key)
// ============================================

server.tool(
  'set_dune_key',
  "Set Dune API key. When Dune tools fail due to missing key, ask user: 'What is your Dune API key?' (requires Dune Pro)",
  {
    key: z.string().describe("The user's Dune API key"),
  },
  async ({ key }) => {
    dune.setApiKey(key);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Dune API key configured. You can now run Dune queries.`,
        },
      ],
    };
  }
);

server.tool(
  'run_dune_query',
  'Execute a Dune Analytics query by ID and get results (requires Dune API key)',
  {
    queryId: z.number().describe('The Dune query ID (from the URL, e.g., 3237721)'),
    parameters: z.record(z.string(), z.any()).optional().describe('Optional query parameters'),
  },
  async ({ queryId, parameters }) => {
    const results = await dune.executeQuery(queryId, parameters);
    if (results.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Query ${queryId} returned no results.\n\n[Source: Dune]`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `Dune Query ${queryId} Results:\n\n${JSON.stringify(results.slice(0, 50), null, 2)}\n\n[Source: Dune]`,
        },
      ],
    };
  }
);

server.tool(
  'get_dune_results',
  'Get cached results from a Dune query (faster, no execution)',
  {
    queryId: z.number().describe('The Dune query ID'),
  },
  async ({ queryId }) => {
    const results = await dune.getQueryResults(queryId);
    if (results.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No cached results for query ${queryId}.\n\n[Source: Dune]`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `Dune Query ${queryId} Cached Results:\n\n${JSON.stringify(results.slice(0, 50), null, 2)}\n\n[Source: Dune]`,
        },
      ],
    };
  }
);

server.tool(
  'get_dune_query_info',
  'Get metadata about a Dune query (name, description, parameters)',
  {
    queryId: z.number().describe('The Dune query ID'),
  },
  async ({ queryId }) => {
    const info = await dune.getQueryInfo(queryId);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Dune Query ${queryId} Info:\n\n- Name: ${info.name || 'N/A'}\n- Description: ${info.description || 'N/A'}\n- Owner: ${info.owner || 'N/A'}\n- Parameters: ${JSON.stringify(info.parameters || [], null, 2)}\n- Is Private: ${info.is_private || false}\n\n[Source: Dune]`,
        },
      ],
    };
  }
);

server.tool(
  'get_dune_execution_status',
  'Check the status of a Dune query execution',
  {
    executionId: z.string().describe('The execution ID returned from run_dune_query'),
  },
  async ({ executionId }) => {
    const status = await dune.getExecutionStatus(executionId);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Dune Execution ${executionId}:\n\n- State: ${status.state}\n- Queue Position: ${status.queue_position || 'N/A'}\n- Submitted At: ${status.submitted_at || 'N/A'}\n- Execution Started: ${status.execution_started_at || 'N/A'}\n- Execution Ended: ${status.execution_ended_at || 'N/A'}\n\n[Source: Dune]`,
        },
      ],
    };
  }
);

server.tool(
  'cancel_dune_execution',
  'Cancel a running Dune query execution',
  {
    executionId: z.string().describe('The execution ID to cancel'),
  },
  async ({ executionId }) => {
    await dune.cancelExecution(executionId);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Dune execution ${executionId} cancelled.\n\n[Source: Dune]`,
        },
      ],
    };
  }
);

server.tool(
  'get_dune_results_csv',
  'Get cached Dune query results as CSV format',
  {
    queryId: z.number().describe('The Dune query ID'),
  },
  async ({ queryId }) => {
    const csv = await dune.getResultsCsv(queryId);
    const lines = csv.split('\n');
    const preview = lines.slice(0, 20).join('\n');
    return {
      content: [
        {
          type: 'text' as const,
          text: `Dune Query ${queryId} CSV Results (first 20 rows):\n\n${preview}\n\n[Total: ${lines.length} rows]\n\n[Source: Dune]`,
        },
      ],
    };
  }
);

// Dune EigenLayer Preset Endpoints
server.tool(
  'get_eigenlayer_avs',
  'Get EigenLayer AVS (Actively Validated Services) metadata and metrics',
  {},
  async () => {
    const [metadata, metrics] = await Promise.all([
      dune.getEigenLayerAvsMetadata().catch(() => null),
      dune.getEigenLayerAvsMetrics().catch(() => null),
    ]);

    if (!metadata && !metrics) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Unable to fetch EigenLayer AVS data. Make sure your Dune API key is configured.\n\n[Source: Dune]',
          },
        ],
      };
    }

    const avsCount = metadata?.result?.rows?.length || 0;
    const avsPreview = (metadata?.result?.rows || []).slice(0, 10);

    return {
      content: [
        {
          type: 'text' as const,
          text: `EigenLayer AVS Data:\n\n- Total AVSs: ${avsCount}\n\nTop AVSs:\n${JSON.stringify(avsPreview, null, 2)}\n\n[Source: Dune]`,
        },
      ],
    };
  }
);

server.tool(
  'get_eigenlayer_operators',
  'Get EigenLayer operator metadata and metrics',
  {},
  async () => {
    const [metadata, metrics] = await Promise.all([
      dune.getEigenLayerOperatorMetadata().catch(() => null),
      dune.getEigenLayerOperatorMetrics().catch(() => null),
    ]);

    if (!metadata && !metrics) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Unable to fetch EigenLayer operator data. Make sure your Dune API key is configured.\n\n[Source: Dune]',
          },
        ],
      };
    }

    const operatorCount = metadata?.result?.rows?.length || 0;
    const operatorPreview = (metadata?.result?.rows || []).slice(0, 10);

    return {
      content: [
        {
          type: 'text' as const,
          text: `EigenLayer Operators:\n\n- Total Operators: ${operatorCount}\n\nTop Operators:\n${JSON.stringify(operatorPreview, null, 2)}\n\n[Source: Dune]`,
        },
      ],
    };
  }
);

server.tool(
  'get_dune_token_balances',
  'Get real-time token balances for an address using Dune Developer API',
  {
    address: z.string().describe('Ethereum address (0x...)'),
    chainIds: z
      .string()
      .optional()
      .describe("Comma-separated chain IDs (e.g., '1,137,42161') or 'all'"),
    tokenType: z.enum(['erc20', 'native']).optional().describe('Filter by token type'),
    excludeSpam: z.boolean().optional().default(true).describe('Exclude spam tokens'),
  },
  async ({ address, chainIds, tokenType, excludeSpam }) => {
    const balances = await dune.getTokenBalances(address, {
      chainIds,
      filters: tokenType,
      excludeSpamTokens: excludeSpam,
    });

    const tokenList = balances?.balances || [];
    if (tokenList.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No token balances found for ${address}.\n\n[Source: Dune]`,
          },
        ],
      };
    }

    const formatted = tokenList.slice(0, 20).map((t: any) => {
      const value = t.value_usd ? `$${t.value_usd.toFixed(2)}` : 'N/A';
      return `- ${t.symbol || 'Unknown'}: ${t.amount || 0} (${value})`;
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: `Token Balances for ${address.slice(0, 10)}...:\n\n${formatted.join('\n')}\n\n[Total: ${tokenList.length} tokens]\n\n[Source: Dune]`,
        },
      ],
    };
  }
);

// ============================================
// SMART ROUTED TOOLS (with fallbacks)
// ============================================

server.tool(
  'smart_get_price',
  'Get price for any token with automatic fallbacks between CoinGecko and DefiLlama. More reliable than single-source tools.',
  {
    token: z
      .string()
      .describe('Token name (e.g., "bitcoin", "ethereum") or contract address (0x...)'),
    chain: z
      .string()
      .optional()
      .default('ethereum')
      .describe('Chain for contract addresses (default: ethereum)'),
  },
  async ({ token, chain }) => {
    try {
      const result = await router.getTokenPrice(token, chain);
      const lines = [
        `**${token.toUpperCase()}**: $${result.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`,
      ];
      if (result.change24h !== undefined) {
        const changeStr =
          result.change24h >= 0
            ? `+${result.change24h.toFixed(2)}%`
            : `${result.change24h.toFixed(2)}%`;
        lines.push(`24h Change: ${changeStr}`);
      }
      if (result.marketCap !== undefined) {
        lines.push(`Market Cap: ${formatUSD(result.marketCap)}`);
      }
      if (result.fallbacksUsed > 0) {
        lines.push(`\n_Note: Primary source unavailable, used ${result.source} as fallback_`);
      }
      lines.push(`\n[Source: ${result.source}]`);
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error.message}` }],
      };
    }
  }
);

server.tool(
  'smart_get_eth_price',
  'Get ETH price with automatic fallbacks: Etherscan → CoinGecko → DefiLlama',
  {},
  async () => {
    try {
      const result = await router.getEthPrice();
      const lines = [
        `**ETH**: $${result.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      ];
      if (result.change24h !== undefined) {
        const changeStr =
          result.change24h >= 0
            ? `+${result.change24h.toFixed(2)}%`
            : `${result.change24h.toFixed(2)}%`;
        lines.push(`24h Change: ${changeStr}`);
      }
      if (result.fallbacksUsed > 0) {
        lines.push(`\n_Note: Used ${result.source} (fallback #${result.fallbacksUsed})_`);
      }
      lines.push(`\n[Source: ${result.source}]`);
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error.message}` }],
      };
    }
  }
);

server.tool(
  'smart_get_l2_tvl',
  'Get L2 TVL with automatic fallbacks: growthepie → DefiLlama',
  {
    chain: z.string().describe('L2 chain name (e.g., "arbitrum", "optimism", "base")'),
  },
  async ({ chain }) => {
    try {
      const result = await router.getL2Tvl(chain);
      const lines = [`**${chain.toUpperCase()} TVL**: ${formatUSD(result.tvl)}`];
      if (result.fallbacksUsed > 0) {
        lines.push(`\n_Note: Used ${result.source} (fallback #${result.fallbacksUsed})_`);
      }
      lines.push(`\n[Source: ${result.source}]`);
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error.message}` }],
      };
    }
  }
);

server.tool(
  'api_health_check',
  'Check health status and latency of all data sources (Etherscan, DefiLlama, CoinGecko, growthepie, Blobscan)',
  {},
  async () => {
    const health = await router.checkHealth();
    const circuitStatus = router.getCircuitStatus();

    const lines = ['**API Health Status**\n'];
    for (const h of health) {
      const status = h.healthy ? '[OK]' : '[X]';
      const circuit = circuitStatus[h.source];
      const circuitInfo = circuit?.isOpen ? ' [CIRCUIT OPEN]' : '';
      lines.push(
        `${status} **${h.source}**: ${h.healthy ? `${h.latencyMs}ms` : h.error}${circuitInfo}`
      );
    }
    return {
      content: [{ type: 'text' as const, text: lines.join('\n') }],
    };
  }
);

server.tool(
  'compare_eth_price_sources',
  'Compare ETH price across all available sources (Etherscan, CoinGecko, DefiLlama) to verify data consistency',
  {},
  async () => {
    const comparison = await router.compareEthPrice();
    const lines = ['**ETH Price Comparison**\n'];

    for (const r of comparison.results) {
      if (r.error) {
        lines.push(`[X] **${r.source}**: Error - ${r.error}`);
      } else {
        lines.push(
          `[OK] **${r.source}**: $${r.value?.toLocaleString(undefined, { minimumFractionDigits: 2 })} (${r.latencyMs}ms)`
        );
      }
    }

    // Calculate variance if we have multiple valid prices
    const validPrices = comparison.results.filter((r) => r.value != null).map((r) => r.value);
    if (validPrices.length >= 2) {
      const avg = validPrices.reduce((a, b) => a + b, 0) / validPrices.length;
      const maxDiff = Math.max(...validPrices.map((p) => Math.abs(p - avg)));
      const diffPct = ((maxDiff / avg) * 100).toFixed(3);
      lines.push(`\nMax variance: ${diffPct}%`);
    }

    return {
      content: [{ type: 'text' as const, text: lines.join('\n') }],
    };
  }
);

// ============================================
// MAIN
// ============================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Ethereum MCP server v2.0 running');
  console.error(
    'Data sources: Etherscan, DefiLlama, CoinGecko, growthepie, Blobscan, Dune (optional)'
  );
}

main().catch(console.error);
