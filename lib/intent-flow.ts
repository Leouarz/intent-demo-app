"use client";

import type { Hex } from "viem";
import {
  assertAddress,
  buildIntentQuoteRequest,
  readMiddlewareError,
  type DeploymentChain,
  type DeploymentResponse,
  type IntentFormState,
  type IntentBalances,
  type IntentQuote,
  type IntentStatusResponse,
  type IntentSubmitRequest,
  type IntentSubmitResponse,
} from "./intent-utils";

export const MIDDLEWARE_URL =
  process.env.NEXT_PUBLIC_MIDDLEWARE_URL ?? "http://localhost:4050";

type IntentCatalogChain = Omit<DeploymentChain, "chainId" | "tokens"> & {
  chainId: number | string;
  tokens?: Array<{
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    isNative: boolean;
    logo?: string;
    providers?: Array<{ id: "nexus-v2" | "mayan"; currencyId?: number }>;
  }>;
};

// Loads the provider catalog used to populate chains and tokens.
export async function fetchDeployment(): Promise<DeploymentResponse> {
  const response = await fetch(`${MIDDLEWARE_URL}/api/v1/better-intent/chains`);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readMiddlewareError(body, response.status));
  }
  if (!Array.isArray(body)) {
    throw new Error(readMiddlewareError(body, response.status));
  }

  return {
    network: "better-intent",
    chains: (body as IntentCatalogChain[]).map((chain) => {
      const chainId = parseIntentChainId(chain.chainId);
      return {
        ...chain,
        chainId,
        tokens: (chain.tokens ?? [])
          .filter((token) => !token.isNative)
          .map((token) => ({
            symbol: token.symbol,
            name: token.name,
            address: token.address,
            decimals: token.decimals,
            logo: token.logo,
            providers: token.providers?.map((provider) => provider.id),
            sourceKind: "bridge" as const,
          })),
      };
    }),
  };
}

// Loads every routable balance returned by the provider-backed Ankr balance endpoint.
export async function fetchIntentBalances(
  address: Hex,
): Promise<IntentBalances> {
  const validatedAddress = assertAddress(address, "user address");
  const response = await fetch(
    `${MIDDLEWARE_URL}/api/v1/better-intent/balances/${validatedAddress}?refresh=true`,
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readMiddlewareError(body, response.status));
  }
  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as IntentBalances).balances)
  ) {
    throw new Error(readMiddlewareError(body, response.status));
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
  const response = await fetch(
    `${MIDDLEWARE_URL}/api/v1/better-intent/submit`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    },
  );

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
    `${MIDDLEWARE_URL}/api/v1/better-intent/status/${quoteId}`,
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
