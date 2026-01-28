#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Ethereum MCP server v2.0 running');
  console.error(
    'Data sources: Etherscan, JSON-RPC, DefiLlama, CoinGecko, growthepie, Blobscan, Dune (optional)'
  );
}

main().catch(console.error);
