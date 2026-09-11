"use client";

import type { Hex } from "viem";
import {
  assertAddress,
  buildBetterIntentCatalogQuery,
  buildIntentQuoteRequest,
  mergeDeploymentTokens,
  middlewareApiError,
  type DeploymentChain,
  type DeploymentToken,
  type DeploymentResponse,
  type IntentFormState,
  type IntentBalances,
  type IntentQuote,
  type IntentStatusResponse,
  type IntentSubmitRequest,
  type IntentSubmitResponse,
  type ProviderSupport,
  sortDeploymentCatalog,
} from "./intent-utils";

export const MIDDLEWARE_URL =
  process.env.NEXT_PUBLIC_MIDDLEWARE_URL ?? "http://localhost:4050";

export const INTENT_IDENTITY_HEADERS = {
  "x-nexus-client-id": "leouarz-intent-demo-app",
  "x-nexus-surface": "nexus-app",
  "x-nexus-surface-version": "0.0.1",
} as const;

type IntentCatalogChain = Omit<DeploymentChain, "chainId"> & {
  chainId: number | string;
};

type IntentToken = {
  universe: "EVM";
  chainId: string;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  isNative: boolean;
  logo?: string;
  coingeckoId?: string;
  asSource?: ProviderSupport[];
  asDestination?: ProviderSupport[];
};

type IntentTokenPage = {
  tokens: IntentToken[];
  offset: number;
  limit: number;
  total: number;
};

// Loads the provider-backed chain catalog. Tokens are fetched separately from /tokens.
export async function fetchDeployment(
  query?: URLSearchParams,
): Promise<DeploymentResponse> {
  const queryString = query?.toString();
  const url = `${MIDDLEWARE_URL}/api/v1/better-intent/chains${queryString ? `?${queryString}` : ""}`;
  const response = await fetch(url, { headers: INTENT_IDENTITY_HEADERS });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw middlewareApiError(body, response.status);
  }
  if (!Array.isArray(body)) {
    throw middlewareApiError(body, response.status);
  }

  return sortDeploymentCatalog({
    network: "better-intent",
    tokens: [],
    chains: (body as IntentCatalogChain[]).map((chain) => {
      const chainId = parseIntentChainId(chain.chainId);
      return {
        ...chain,
        chainId,
      };
    }),
  });
}

async function fetchTokenPage(
  params: URLSearchParams,
): Promise<IntentTokenPage> {
  const response = await fetch(
    `${MIDDLEWARE_URL}/api/v1/better-intent/tokens?${params.toString()}`,
    { headers: INTENT_IDENTITY_HEADERS },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) throw middlewareApiError(body, response.status);
  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as IntentTokenPage).tokens)
  ) {
    throw middlewareApiError(body, response.status);
  }
  return body as IntentTokenPage;
}

function tokenParams(
  options: { chainId?: number; limit: number },
): URLSearchParams {
  const params = new URLSearchParams({ limit: String(options.limit) });
  if (options.chainId !== undefined) {
    params.set("chainId", `EVM_${options.chainId}`);
  }
  return params;
}

function mapIntentToken(token: IntentToken): DeploymentToken {
  const chainId = parseIntentChainId(token.chainId);
  return {
    chainId,
    symbol: token.symbol,
    name: token.name,
    address: token.address,
    decimals: token.decimals,
    isNative: token.isNative,
    logo: token.logo,
    coingeckoId: token.coingeckoId,
    asSource: token.asSource ?? [],
    asDestination: token.asDestination ?? [],
    sourceKind: [...(token.asSource ?? []), ...(token.asDestination ?? [])].some(
      (provider) => provider.id === "nexus-v2",
    )
      ? "bridge"
      : "swap",
  };
}

// The selector searches name, symbol, and contract independently because the API exposes each
// filter separately. Results are merged and deduplicated before reaching the UI.
export async function fetchIntentTokens(options: {
  chainId?: number;
  search?: string;
  limit?: number;
} = {}): Promise<DeploymentToken[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000);
  const search = options.search?.trim();
  const filters = search ? ["name", "symbol", "contract"] : [undefined];
  const pages = await Promise.all(
    filters.map((filter) => {
      const params = tokenParams({ chainId: options.chainId, limit });
      if (search && filter) params.set(filter, search);
      return fetchTokenPage(params);
    }),
  );

  const tokens = pages.flatMap((page) => page.tokens.map(mapIntentToken));
  return mergeDeploymentTokens([], tokens).slice(0, limit);
}

// Loads every routable balance returned by the provider-backed Ankr balance endpoint.
export async function fetchIntentBalances(
  address: Hex,
): Promise<IntentBalances> {
  const validatedAddress = assertAddress(address, "user address");
  const response = await fetch(
    `${MIDDLEWARE_URL}/api/v1/better-intent/balances/${validatedAddress}?refresh=true`,
    { headers: INTENT_IDENTITY_HEADERS },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw middlewareApiError(body, response.status);
  }
  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as IntentBalances).balances)
  ) {
    throw middlewareApiError(body, response.status);
  }
  return body as IntentBalances;
}

// Requests a quote from the provider-backed intent endpoint.
export async function requestIntentQuote(
  deployment: DeploymentResponse,
  form: IntentFormState,
): Promise<IntentQuote> {
  const response = await fetch(`${MIDDLEWARE_URL}/api/v1/better-intent/quote`, {
    method: "POST",
    headers: { ...INTENT_IDENTITY_HEADERS, "content-type": "application/json" },
    body: JSON.stringify(buildIntentQuoteRequest(deployment, form)),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw middlewareApiError(body, response.status);
  }
  return body as IntentQuote;
}

// Submits the signed intent and any native source tx receipts to middleware.
export async function submitIntent(
  request: IntentSubmitRequest,
): Promise<IntentSubmitResponse> {
  const response = await fetch(
    `${MIDDLEWARE_URL}/api/v1/better-intent/submit`,
    {
      method: "POST",
      headers: { ...INTENT_IDENTITY_HEADERS, "content-type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw middlewareApiError(body, response.status);
  }
  return body as IntentSubmitResponse;
}

// Loads the current intent status by quote id.
export async function fetchIntentStatus(
  quoteId: Hex,
): Promise<IntentStatusResponse> {
  const response = await fetch(
    `${MIDDLEWARE_URL}/api/v1/better-intent/status/${quoteId}`,
    { headers: INTENT_IDENTITY_HEADERS },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw middlewareApiError(body, response.status);
  }
  return body as IntentStatusResponse;
}

// Runs the new Better Intent route preflight for the current form. The returned catalog keeps
// every entry, with asSource/asDestination narrowed to the selected route constraints.
export async function fetchRouteCatalog(
  deployment: DeploymentResponse,
  form: IntentFormState,
): Promise<DeploymentResponse> {
  return fetchDeployment(buildBetterIntentCatalogQuery(deployment, form));
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
