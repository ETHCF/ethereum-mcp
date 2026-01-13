// Dune Analytics API adapter
// Requires API key (paid - Dune Pro)

const DUNE_BASE_URL = 'https://api.dune.com/api/v1';
let duneApiKey = process.env.DUNE_API_KEY || '';

export function isConfigured(): boolean {
  return !!duneApiKey;
}

export function setApiKey(key: string): void {
  duneApiKey = key;
}

async function request(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
  if (!duneApiKey) {
    throw new Error('Dune API key not configured. Get one at dune.com (requires Dune Pro).');
  }

  const response = await fetch(`${DUNE_BASE_URL}${endpoint}`, {
    method,
    headers: {
      'X-Dune-API-Key': duneApiKey,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMsg: string;
    try {
      const errorJson = JSON.parse(errorText);
      errorMsg = errorJson.error || errorJson.message || JSON.stringify(errorJson);
    } catch {
      errorMsg = errorText;
    }
    throw new Error(`Dune API error (${response.status}): ${errorMsg}`);
  }

  return response.json();
}

// Execute a query and wait for results
export async function executeQuery(
  queryId: number,
  parameters?: Record<string, any>
): Promise<any> {
  // Start execution
  const execution = await request(`/query/${queryId}/execute`, 'POST', {
    query_parameters: parameters || {},
  });

  const executionId = execution.execution_id;

  // Poll for results (max 60 seconds)
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000));

    const status = await request(`/execution/${executionId}/status`);

    if (status.state === 'QUERY_STATE_COMPLETED') {
      const results = await request(`/execution/${executionId}/results`);
      return results.result?.rows || [];
    }

    if (status.state === 'QUERY_STATE_FAILED') {
      let errorMsg = 'Unknown error';
      if (status.error) {
        if (typeof status.error === 'object' && status.error.message) {
          errorMsg = status.error.message;
        } else if (typeof status.error === 'string') {
          errorMsg = status.error;
        } else {
          errorMsg = JSON.stringify(status.error);
        }
      }
      throw new Error(`Query failed: ${errorMsg}`);
    }
  }

  throw new Error('Query timed out after 60 seconds');
}

// Get results from a previous execution
export async function getQueryResults(queryId: number): Promise<any> {
  const results = await request(`/query/${queryId}/results`);
  return results.result?.rows || [];
}

// Get query metadata
export async function getQueryInfo(queryId: number): Promise<any> {
  return request(`/query/${queryId}`);
}

// Get execution status
export async function getExecutionStatus(executionId: string): Promise<any> {
  return request(`/execution/${executionId}/status`);
}

// Get execution results (without polling)
export async function getExecutionResults(executionId: string): Promise<any> {
  const results = await request(`/execution/${executionId}/results`);
  return {
    rows: results.result?.rows || [],
    metadata: results.result?.metadata || {},
    state: results.state,
    executionId,
  };
}

// Cancel a running execution
export async function cancelExecution(executionId: string): Promise<any> {
  return request(`/execution/${executionId}/cancel`, 'POST');
}

// Get results as CSV (returns raw CSV string)
export async function getResultsCsv(queryId: number): Promise<string> {
  if (!duneApiKey) {
    throw new Error('Dune API key not configured.');
  }

  const response = await fetch(`${DUNE_BASE_URL}/query/${queryId}/results/csv`, {
    headers: {
      'X-Dune-API-Key': duneApiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Dune API error (${response.status}): ${await response.text()}`);
  }

  return response.text();
}

// ============================================
// PRESET ENDPOINTS (no custom query needed)
// ============================================

const ECHO_BASE_URL = 'https://api.dune.com/api';

async function echoRequest(endpoint: string): Promise<any> {
  if (!duneApiKey) {
    throw new Error('Dune API key not configured.');
  }

  const response = await fetch(`${ECHO_BASE_URL}${endpoint}`, {
    headers: {
      'X-Dune-API-Key': duneApiKey,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Dune Echo API error (${response.status}): ${await response.text()}`);
  }

  return response.json();
}

// EigenLayer preset endpoints
export async function getEigenLayerAvsMetadata(): Promise<any> {
  return echoRequest('/echo/v1/eigenlayer/avs-metadata');
}

export async function getEigenLayerAvsMetrics(): Promise<any> {
  return echoRequest('/echo/v1/eigenlayer/avs-metrics');
}

export async function getEigenLayerOperatorMetadata(): Promise<any> {
  return echoRequest('/echo/v1/eigenlayer/operator-metadata');
}

export async function getEigenLayerOperatorMetrics(): Promise<any> {
  return echoRequest('/echo/v1/eigenlayer/operator-metrics');
}

export async function getEigenLayerOperatorAvsMapping(): Promise<any> {
  return echoRequest('/echo/v1/eigenlayer/operator-avs');
}

// ============================================
// TOKEN BALANCES API (Developer API)
// ============================================

const BALANCES_BASE_URL = 'https://api.dune.com/api/beta';

async function balancesRequest(endpoint: string): Promise<any> {
  if (!duneApiKey) {
    throw new Error('Dune API key not configured.');
  }

  const response = await fetch(`${BALANCES_BASE_URL}${endpoint}`, {
    headers: {
      'X-Dune-API-Key': duneApiKey,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Dune Balances API error (${response.status}): ${await response.text()}`);
  }

  return response.json();
}

// Get token balances for an address
export async function getTokenBalances(
  address: string,
  options?: {
    chainIds?: string; // comma-separated chain IDs or 'all'
    filters?: 'erc20' | 'native';
    excludeSpamTokens?: boolean;
  }
): Promise<any> {
  let endpoint = `/balance/${address}`;
  const params: string[] = [];

  if (options?.chainIds) {
    params.push(`chain_ids=${options.chainIds}`);
  }
  if (options?.filters) {
    params.push(`filters=${options.filters}`);
  }
  if (options?.excludeSpamTokens) {
    params.push('exclude_spam_tokens=true');
  }

  if (params.length > 0) {
    endpoint += '?' + params.join('&');
  }

  return balancesRequest(endpoint);
}
