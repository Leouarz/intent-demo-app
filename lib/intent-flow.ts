"use client";

import type { Hex } from "viem";
import {
  assertAddress,
  buildIntentQuoteRequest,
  readMiddlewareError,
  type BalancesByChain,
  type DeploymentChain,
  type DeploymentResponse,
  type DeploymentToken,
  type IntentFormState,
  type IntentQuote,
  type IntentStatusResponse,
  type IntentSubmitRequest,
  type IntentSubmitResponse,
} from "./intent-utils";

export const MIDDLEWARE_URL =
  process.env.NEXT_PUBLIC_MIDDLEWARE_URL ?? "http://localhost:4050";

type IntentCatalogChain = Omit<DeploymentChain, "chainId" | "tokens"> & {
  chainId: number | string;
  tokens?: DeploymentToken[];
};

type IntentTokenGroup = {
  symbol: string;
  name: string;
  decimals: number;
  byChain: Record<
    string,
    {
      address: string;
      decimals: number;
      currencyId?: number;
      coingeckoId?: string;
      mayanEnabled?: boolean;
      sourceKind?: "bridge" | "swap";
      logo?: string;
    }
  >;
};

// Loads the intent module catalog used to populate chains and tokens.
export async function fetchDeployment(): Promise<DeploymentResponse> {
  const [chainsResponse, tokensResponse] = await Promise.all([
    fetch(`${MIDDLEWARE_URL}/api/v1/intent/chains`),
    fetch(`${MIDDLEWARE_URL}/api/v1/intent/tokens`),
  ]);
  const [chainsBody, tokensBody] = await Promise.all([
    chainsResponse.json().catch(() => null),
    tokensResponse.json().catch(() => null),
  ]);

  if (!chainsResponse.ok) {
    throw new Error(readMiddlewareError(chainsBody, chainsResponse.status));
  }
  if (!tokensResponse.ok) {
    throw new Error(readMiddlewareError(tokensBody, tokensResponse.status));
  }

  const catalogTokens = buildTokensByChain(tokensBody as IntentTokenGroup[]);
  return {
    network: "intent",
    chains: (chainsBody as IntentCatalogChain[]).map((chain) => {
      const chainId = parseIntentChainId(chain.chainId);
      return {
        ...chain,
        chainId,
        tokens: catalogTokens.get(chainId) ?? chain.tokens ?? [],
      };
    }),
  };
}

// Loads regular and swap balances for the address before asking middleware for a quote. The
// regular snapshot remains authoritative for duplicate tokens; swap-only currencies are added.
export async function fetchBridgeBalances(
  address: Hex,
  deployment: DeploymentResponse,
): Promise<BalancesByChain> {
  const validatedAddress = assertAddress(address, "user address");
  const bridgeBalances = await fetchBalanceSnapshot("balance", validatedAddress);

  // Swap balances are an enhancement for the demo. A regular balance response is still useful
  // when Ankr or a swap-chain RPC is unavailable, so only the required bridge request is fatal.
  try {
    const swapBalances = await fetchBalanceSnapshot("swap-balance", validatedAddress);
    return mergeBalances(bridgeBalances, swapBalances, deployment);
  } catch {
    return bridgeBalances;
  }
}

async function fetchBalanceSnapshot(
  endpoint: "balance" | "swap-balance",
  address: Hex,
): Promise<BalancesByChain> {
  const response = await fetch(
    `${MIDDLEWARE_URL}/api/v1/${endpoint}/evm/${address}`,
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readMiddlewareError(body, response.status));
  }
  return body as BalancesByChain;
}

// Merges the two balance views without double-counting tokens returned by both endpoints.
export function mergeBalances(
  primary: BalancesByChain,
  secondary: BalancesByChain,
  deployment: DeploymentResponse,
): BalancesByChain {
  const merged: BalancesByChain = { ...primary };

  for (const [chainId, extra] of Object.entries(secondary)) {
    const swapCurrencies = extra.currencies.filter((currency) =>
      getMayanSwapAddresses(deployment, Number(chainId)).has(
        currency.token_address.toLowerCase(),
      ),
    );
    const base = merged[chainId];
    if (!base) {
      merged[chainId] = {
        ...extra,
        currencies: swapCurrencies,
        total_usd: swapCurrencies
          .reduce((sum, currency) => sum + (Number(currency.value) || 0), 0)
          .toFixed(2),
      };
      continue;
    }

    const currencies = [...base.currencies];
    const seen = new Set(
      currencies.map((currency) => currency.token_address.toLowerCase()),
    );
    for (const currency of swapCurrencies) {
      const token = currency.token_address.toLowerCase();
      if (seen.has(token)) continue;
      seen.add(token);
      currencies.push(currency);
    }

    merged[chainId] = {
      ...base,
      currencies,
      total_usd: currencies
        .reduce((sum, currency) => sum + (Number(currency.value) || 0), 0)
        .toFixed(2),
      errored: base.errored || extra.errored,
    };
  }

  return merged;
}

function getMayanSwapAddresses(
  deployment: DeploymentResponse,
  chainId: number,
): Set<string> {
  return new Set(
    getTokensForDeploymentChain(deployment, chainId)
      .filter((token) => token.sourceKind === "swap" && token.mayanEnabled === true)
      .map((token) => token.address.toLowerCase()),
  );
}

function getTokensForDeploymentChain(
  deployment: DeploymentResponse,
  chainId: number,
): DeploymentToken[] {
  return deployment.chains.find((chain) => chain.chainId === chainId)?.tokens ?? [];
}

// Requests a quote from the middleware intent quote endpoint.
export async function requestIntentQuote(
  deployment: DeploymentResponse,
  form: IntentFormState,
): Promise<IntentQuote> {
  const response = await fetch(`${MIDDLEWARE_URL}/api/v1/intent/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildIntentQuoteRequest(deployment, form)),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readMiddlewareError(body, response.status));
  }
  return body as IntentQuote;
}

// Submits the signed intent and any native source tx receipts to middleware.
export async function submitIntent(
  request: IntentSubmitRequest,
): Promise<IntentSubmitResponse> {
  const response = await fetch(`${MIDDLEWARE_URL}/api/v1/intent/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readMiddlewareError(body, response.status));
  }
  return body as IntentSubmitResponse;
}

// Loads the current intent status by quote id.
export async function fetchIntentStatus(
  quoteId: Hex,
): Promise<IntentStatusResponse> {
  const response = await fetch(
    `${MIDDLEWARE_URL}/api/v1/intent/status/${quoteId}`,
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readMiddlewareError(body, response.status));
  }
  return body as IntentStatusResponse;
}

// Polls status until the intent reaches a terminal status.
export async function pollIntentStatus(
  quoteId: Hex,
  options: {
    intervalMs?: number;
    onStatus?: (status: IntentStatusResponse) => void;
  } = {},
): Promise<IntentStatusResponse> {
  const intervalMs = options.intervalMs ?? 2_000;

  while (true) {
    const status = await fetchIntentStatus(quoteId);
    options.onStatus?.(status);
    if (status.status === "fulfilled" || status.status === "expired") {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function parseIntentChainId(value: number | string): number {
  if (typeof value === "number") return value;
  const match = /^EVM_(\d+)$/.exec(value);
  if (!match) throw new Error(`Unsupported intent chain id ${value}`);
  return Number(match[1]);
}

function buildTokensByChain(
  groups: IntentTokenGroup[],
): Map<number, DeploymentToken[]> {
  const byChain = new Map<number, DeploymentToken[]>();

  for (const group of groups) {
    for (const [chainRef, token] of Object.entries(group.byChain)) {
      const chainId = parseIntentChainId(chainRef);
      const tokens = byChain.get(chainId) ?? [];
      tokens.push({
        symbol: group.symbol,
        name: group.name,
        address: token.address,
        decimals: token.decimals,
        logo: token.logo,
        sourceKind: token.sourceKind ?? "bridge",
        mayanEnabled: token.mayanEnabled,
      });
      byChain.set(chainId, tokens);
    }
  }

  return byChain;
}
