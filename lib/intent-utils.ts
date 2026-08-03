"use client";

import {
  encodeFunctionData,
  erc20Abi,
  isAddress,
  parseUnits,
  type Abi,
  type Hex,
} from "viem";

export type { Hex } from "viem";

export const DEFAULT_SLIPPAGE_BPS_MAX = 300;
export const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as const;
const TRANSACTION_RECEIPT_POLL_INTERVAL_MS = 1_500;
const TRANSACTION_RECEIPT_TIMEOUT_MS = 180_000;

export type DeploymentToken = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  logo?: string;
  sourceKind?: "bridge" | "swap";
  mayanEnabled?: boolean;
  providers?: Array<"nexus-v2" | "mayan">;
};

export type DeploymentChain = {
  chainId: number;
  name: string;
  logo?: string;
  nativeCurrency: {
    symbol: string;
    name: string;
    decimals: number;
    logo?: string;
  };
  tokens: DeploymentToken[];
};

export type DeploymentResponse = {
  network: string;
  mayanEnabled?: boolean;
  mayanThresholdUsd?: number;
  chains: DeploymentChain[];
};

function alphabetical(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function compareDeploymentTokens(left: DeploymentToken, right: DeploymentToken): number {
  return (
    alphabetical(left.symbol, right.symbol) ||
    alphabetical(left.name, right.name) ||
    left.address.localeCompare(right.address)
  );
}

function compareDeploymentChains(left: DeploymentChain, right: DeploymentChain): number {
  return alphabetical(left.name, right.name) || left.chainId - right.chainId;
}

export function sortDeploymentCatalog(
  deployment: DeploymentResponse,
): DeploymentResponse {
  return {
    ...deployment,
    chains: [...deployment.chains]
      .sort(compareDeploymentChains)
      .map((chain) => ({
        ...chain,
        tokens: [...chain.tokens].sort(compareDeploymentTokens),
      })),
  };
}

export type SelectableToken = {
  chainId: number;
  symbol: string;
  name: string;
  address: Hex;
  decimals: number;
  logo?: string;
  native: boolean;
  sourceKind: "bridge" | "swap";
  mayanEnabled?: boolean;
};

export type IntentBalance = {
  universe: "EVM";
  chainId: string;
  address: Hex;
  name: string;
  symbol: string;
  decimals: number;
  isNative: boolean;
  logo?: string;
  coingeckoId?: string;
  providers: Array<{ id: "nexus-v2" | "mayan"; currencyId?: number }>;
  balance: string;
  valueUsd: number | null;
  priceSource: "oracle" | "indexer" | null;
  usable: boolean;
};

export type IntentBalances = {
  balances: IntentBalance[];
  errored: boolean;
};

export type SourcePreference = {
  sourceChain: number;
  tokens: Hex[];
};

export type InputLeg = {
  chainId: number;
  token: Hex;
  amount: string; // human decimal
};

export type TradeType = "exactInput" | "exactOutput";

// "auto" maps to an empty preferredProviders array (best of all).
export type ProviderChoice = "auto" | "nexus-v2" | "mayan";

export type IntentFormState = {
  sender: Hex;
  recipient: string;
  tradeType: TradeType;
  provider: ProviderChoice;
  destinationChainId: number;
  destinationTokenAddress: Hex;
  outputAmount: string;
  inputs: InputLeg[];
  gasDropAmount: string;
  slippageBps: string;
  sources: SourcePreference[];
};

export type IntentInputLeg = {
  chainId: string; // "EVM_<chainId>"
  tokenAddress: Hex;
  tokenSymbol: string;
  amount: string;
  depositFee: string;
  totalRequired: string;
};

export type RoutingPayload = {
  protocol_tag: string;
  target: Hex;
  calldata: Hex;
  arbitrary_data: Hex;
};

export type IntentRff = {
  sources: Array<{
    payload?: RoutingPayload;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

export type IntentQuote = {
  quoteId: Hex;
  provider: "nexus-v2" | "mayan";
  tradeType: TradeType;
  input: IntentInputLeg[];
  output: {
    chainId: string; // "EVM_<chainId>"
    tokenAddress: Hex;
    amount: string;
  };
  minAmountOut: string;
  fees: {
    deposit: string;
    fulfillment: string;
    protocol: string;
    solver: string;
    caGas: string;
  };
  expiry: string;
  rff: IntentRff;
  rffHash: Hex;
  signing: {
    type: "personal_sign";
    messagePrefix: string;
    message: Hex;
    hash: Hex;
  };
  allowances: Array<{
    chainId: number;
    tokenAddress: Hex;
    spender: Hex;
    owner: Hex;
    current: string;
    required: string;
    deficit: string;
    approval?: {
      type: "erc20_approve";
      to: Hex;
      data: Hex;
      value: "0";
    };
  }>;
  nativeTransactions: Array<{
    chainId: number;
    sourceIndex: number;
    to: Hex;
    value: string;
    functionName: "deposit" | "depositRouter";
    abi: Abi;
    vaultRequest: Record<string, unknown>;
    payload?: Hex;
    argsTemplate: {
      request: "nativeTransactions[n].vaultRequest";
      signature: string;
      sourceIndex: number;
      payload?: string;
      authorization?: "0x";
    };
  }>;
  submitRequirements?: {
    requiresIntentSignature: boolean;
    requiresApprovals: boolean;
    requiresNativeTxReceipts: boolean;
  };
};

export type IntentLifecycleStatus =
  | "created"
  | "deposited"
  | "fulfilled"
  | "expired";

export type IntentSubmitRequest = {
  provider?: "nexus-v2" | "mayan";
  rff: IntentRff;
  rffSignature: Hex;
  nativeTxReceipts?: Array<{ sourceIndex: number; txHash: Hex }>;
};

export type IntentSubmitResponse = {
  quoteId: Hex;
  status: IntentLifecycleStatus;
};

export type IntentStatusResponse = {
  quoteId: Hex;
  provider: "nexus-v2" | "mayan";
  status: IntentLifecycleStatus;
  substatus: string;
  rff: IntentRff;
};

export type IntentExecutionResult = {
  approvals: Array<IntentQuote["allowances"][number] & { hash: Hex }>;
  rffSignature: Hex;
  nativeTransactions: Array<{
    chainId: number;
    sourceIndex: number;
    hash: Hex;
  }>;
  nativeTxReceipts: Array<{ sourceIndex: number; txHash: Hex }>;
  submitRequest: IntentSubmitRequest;
};

type EthereumProvider = {
  request<T = unknown>(args: {
    method: string;
    params?: unknown[] | object;
  }): Promise<T>;
};

type TransactionReceipt = {
  blockNumber: Hex;
  status: "0x0" | "0x1";
};

// Returns the injected browser wallet provider used by MetaMask and compatible wallets.
export function getInjectedProvider(): EthereumProvider {
  const provider = (
    globalThis as typeof globalThis & { ethereum?: EthereumProvider }
  ).ethereum;
  if (!provider) {
    throw new Error("No injected wallet found");
  }
  return provider;
}

// Requests the connected wallet account from MetaMask or another injected wallet.
export async function connectInjectedWallet(): Promise<Hex> {
  const provider = getInjectedProvider();
  const accounts = await provider.request<string[]>({
    method: "eth_requestAccounts",
  });
  const account = accounts[0];
  if (!account || !isAddress(account)) {
    throw new Error("Wallet did not return a valid account");
  }
  return account as Hex;
}

// Builds the first valid form state once deployment metadata has loaded.
export function buildInitialIntentForm(
  deployment: DeploymentResponse,
  sender = "" as Hex,
): IntentFormState {
  const firstChain = getFirstChain(deployment);
  const firstToken = getTokensForChain(deployment, firstChain.chainId)[0];
  return {
    sender,
    recipient: "",
    tradeType: "exactOutput",
    provider: "auto",
    destinationChainId: firstChain.chainId,
    destinationTokenAddress: firstToken.address,
    outputAmount: "1",
    inputs: [],
    gasDropAmount: "0",
    slippageBps: String(DEFAULT_SLIPPAGE_BPS_MAX),
    sources: [],
  };
}

// Finds the display chain configuration for a chain id.
export function getChain(
  deployment: DeploymentResponse,
  chainId: number,
): DeploymentChain {
  const chain = deployment.chains.find((item) => item.chainId === chainId);
  if (!chain) {
    throw new Error(`Unsupported chain ${chainId}`);
  }
  return chain;
}

// Lists the selectable native token and every provider-catalog token for a chain.
export function getTokensForChain(
  deployment: DeploymentResponse,
  chainId: number,
): SelectableToken[] {
  const chain = getChain(deployment, chainId);
  const tokens: SelectableToken[] = [
    {
      chainId: chain.chainId,
      symbol: chain.nativeCurrency.symbol,
      name: chain.nativeCurrency.name,
      address: ZERO_ADDRESS,
      decimals: chain.nativeCurrency.decimals,
      logo: chain.nativeCurrency.logo,
      native: true,
      sourceKind: "bridge",
    },
    ...chain.tokens.map((token) => ({
      chainId: chain.chainId,
      symbol: token.symbol,
      name: token.name,
      address: assertAddress(token.address, `${token.symbol} token`) as Hex,
      decimals: token.decimals,
      logo: token.logo,
      native: false,
      sourceKind: token.sourceKind ?? "bridge",
      mayanEnabled: token.mayanEnabled,
    })),
  ];
  return tokens.sort(
    (left, right) =>
      alphabetical(left.symbol, right.symbol) ||
      alphabetical(left.name, right.name) ||
      left.address.localeCompare(right.address),
  );
}

// Finds token metadata needed to convert a human amount into raw units.
export function getToken(
  deployment: DeploymentResponse,
  chainId: number,
  address: Hex,
): SelectableToken {
  const token = getTokensForChain(deployment, chainId).find(
    (item) => item.address.toLowerCase() === address.toLowerCase(),
  );
  if (!token) {
    throw new Error(`Unsupported token ${address} on chain ${chainId}`);
  }
  return token;
}

// Formats a raw balance string using deployment token decimals for display only.
export function formatBalanceAmount(balance: string, decimals: number): string {
  const raw = BigInt(balance);
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const fraction = raw % scale;
  if (fraction === 0n) return whole.toString();
  const trimmed = fraction
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "")
    .slice(0, 6);
  return `${whole}.${trimmed}`;
}

// Flags exactInput legs whose amount exceeds the sender's on-chain balance. A quote is pure price
// discovery (the middleware never checks balances, so you can preview routes without funds), so this
// returns non-blocking warnings rather than throwing — the shortfall only actually bites at deposit.
export function findInsufficientInputs(
  deployment: DeploymentResponse,
  form: IntentFormState,
  balances: IntentBalances,
): string[] {
  if (form.tradeType !== "exactInput") return [];
  const warnings: string[] = [];
  form.inputs.forEach((leg) => {
    let required: bigint;
    try {
      const token = getToken(deployment, leg.chainId, leg.token);
      required = parseUnits(leg.amount.trim() || "0", token.decimals);
      const balance = balances.balances.find(
        (item) =>
          item.chainId === `EVM_${leg.chainId}` &&
          item.address.toLowerCase() === token.address.toLowerCase(),
      );
      const available = balance ? BigInt(balance.balance) : 0n;
      if (required > available) {
        const chain = getChain(deployment, leg.chainId);
        const tokenLabel =
          token.name && token.name !== token.symbol
            ? `${token.symbol} (${token.name})`
            : token.symbol;
        warnings.push(
          `You send ${formatBalanceAmount(required.toString(), token.decimals)} ${tokenLabel} ` +
            `on ${chain.name} but only hold ` +
            `${formatBalanceAmount(available.toString(), token.decimals)} — the quote is valid, ` +
            `but the deposit will fail unless you fund the wallet.`,
        );
      }
    } catch {
      // Ignore legs we cannot parse; buildIntentQuoteRequest surfaces those errors.
    }
  });
  return warnings;
}

// Builds the middleware quote request from deployment metadata and form state.
export function buildIntentQuoteRequest(
  deployment: DeploymentResponse,
  form: IntentFormState,
) {
  const destinationToken = getToken(
    deployment,
    form.destinationChainId,
    form.destinationTokenAddress,
  );
  const gasDropAmount = form.gasDropAmount.trim()
    ? parseHumanAmount(
        form.gasDropAmount,
        getChain(deployment, form.destinationChainId).nativeCurrency.decimals,
        "gas drop amount",
      )
    : 0n;
  const slippageBps = parseSlippageBps(form.slippageBps);

  const isExactInput = form.tradeType === "exactInput";

  const output = {
    chainId: `EVM_${form.destinationChainId}`,
    token: destinationToken.address,
    amount: isExactInput
      ? undefined
      : parseHumanAmount(
          form.outputAmount,
          destinationToken.decimals,
          "output amount",
        ).toString(),
  };

  const input = isExactInput
    ? form.inputs.map((leg, index) => {
        const token = getToken(deployment, leg.chainId, leg.token);
        return {
          chainId: `EVM_${leg.chainId}`,
          token: token.address,
          amount: parseHumanAmount(
            leg.amount,
            token.decimals,
            `input ${index + 1} amount`,
          ).toString(),
        };
      })
    : undefined;

  if (isExactInput && (!input || input.length === 0)) {
    throw new Error("exactInput requires at least one input leg");
  }

  const request = {
    sender: assertAddress(form.sender, "sender"),
    recipient: form.recipient.trim()
      ? assertAddress(form.recipient, "recipient")
      : undefined,
    tradeType: form.tradeType,
    preferredProviders: form.provider === "auto" ? undefined : [form.provider],
    slippageBps,
    input,
    output,
    sources:
      !isExactInput && form.sources.length > 0
        ? normalizeSources(form.sources)
        : undefined,
    gasDrop:
      gasDropAmount > 0n ? { amount: gasDropAmount.toString() } : undefined,
  };

  return JSON.parse(JSON.stringify(request)) as unknown;
}

// Executes the wallet portion of a quote: approvals, intent signature, and native txs.
export async function executeIntentQuote(
  quote: IntentQuote,
  options: { account: Hex; onLog?: (message: string) => void },
): Promise<IntentExecutionResult> {
  const provider = getInjectedProvider();
  const log = options.onLog ?? (() => undefined);

  const approvals = await approveAllowances(
    provider,
    options.account,
    quote.allowances,
    log,
  );
  const rffSignature = await signIntentHash(
    provider,
    options.account,
    quote.signing,
    log,
  );
  log("Intent signature received");
  const nativeTransactions = await sendNativeTransactions(
    provider,
    options.account,
    quote.nativeTransactions,
    rffSignature,
    log,
  );
  const nativeTxReceipts = nativeTransactions.map((tx) => ({
    sourceIndex: tx.sourceIndex,
    txHash: tx.hash,
  }));

  const submitRequest: IntentSubmitRequest = {
    provider: quote.provider,
    rff: quote.rff,
    rffSignature,
    ...(nativeTxReceipts.length ? { nativeTxReceipts } : {}),
  };

  log("Wallet flow is ready to submit");
  return {
    approvals,
    rffSignature,
    nativeTransactions,
    nativeTxReceipts,
    submitRequest,
  };
}

// Sends all missing ERC20 approval transactions requested by the quote.
export async function approveAllowances(
  provider: EthereumProvider,
  account: Hex,
  allowances: IntentQuote["allowances"],
  log: (message: string) => void,
) {
  const sent = [];
  for (const allowance of allowances) {
    if (BigInt(allowance.deficit) === 0n) {
      log(
        `Approval already satisfied for ${allowance.tokenAddress} on ${allowance.chainId}`,
      );
      continue;
    }

    await switchChain(provider, allowance.chainId);
    const data =
      allowance.approval?.data ??
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [allowance.spender, BigInt(allowance.required)],
      });
    const to = allowance.approval?.to ?? allowance.tokenAddress;
    const value = bigintToRpcQuantity(BigInt(allowance.approval?.value ?? "0"));

    log(`Approving ${allowance.tokenAddress} on ${allowance.chainId}`);
    const hash = await provider.request<Hex>({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to,
          data,
          value,
        },
      ],
    });
    log(`Approval submitted: ${hash}`);
    await waitForSuccessfulTransactionReceipt(provider, hash, log);
    sent.push({ ...allowance, hash });
  }
  return sent;
}

// Signs the middleware-provided intent message with personal_sign.
export async function signIntentHash(
  provider: EthereumProvider,
  account: Hex,
  signing: IntentQuote["signing"],
  log: (message: string) => void,
) {
  log("Signing intent hash");
  return provider.request<Hex>({
    method: "personal_sign",
    params: [signing.message, account],
  });
}

// Sends the native deposit transactions requested by the quote.
export async function sendNativeTransactions(
  provider: EthereumProvider,
  account: Hex,
  nativeTransactions: IntentQuote["nativeTransactions"],
  rffSignature: Hex,
  log: (message: string) => void,
) {
  const sent = [];
  for (const nativeTx of nativeTransactions) {
    log(
      `Switching wallet to chain ${nativeTx.chainId} for native transaction`,
    );
    await switchChain(provider, nativeTx.chainId);
    log(`Wallet switched to chain ${nativeTx.chainId}`);
    const args = buildNativeTxArgs(nativeTx, rffSignature);
    const data = encodeFunctionData({
      abi: nativeTx.abi,
      functionName: nativeTx.functionName,
      args,
    });
    log(`Native deposit transaction prepared on chain ${nativeTx.chainId}`);

    log(
      `Requesting native deposit transaction signature on chain ${nativeTx.chainId}`,
    );
    const hash = await provider.request<Hex>({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: nativeTx.to,
          value: bigintToRpcQuantity(BigInt(nativeTx.value)),
          data,
        },
      ],
    });
    log(`Native deposit submitted: ${hash}`);
    await waitForSuccessfulTransactionReceipt(provider, hash, log);
    sent.push({
      chainId: nativeTx.chainId,
      sourceIndex: nativeTx.sourceIndex,
      hash,
    });
  }
  return sent;
}

// Waits for the transaction to be included successfully, including transactions submitted through
// a private/MEV route that may not be visible through public RPC while pending.
async function waitForSuccessfulTransactionReceipt(
  provider: EthereumProvider,
  hash: Hex,
  log: (message: string) => void,
): Promise<void> {
  const deadline = Date.now() + TRANSACTION_RECEIPT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const receipt = await provider.request<TransactionReceipt | null>({
      method: "eth_getTransactionReceipt",
      params: [hash],
    });
    if (receipt) {
      if (receipt.status !== "0x1") {
        throw new Error(
          `Transaction ${hash} reverted in block ${Number(receipt.blockNumber)}`,
        );
      }
      log(`Transaction confirmed in block ${Number(receipt.blockNumber)}`);
      return;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, TRANSACTION_RECEIPT_POLL_INTERVAL_MS),
    );
  }

  throw new Error(`Transaction ${hash} was not confirmed within 3 minutes`);
}

// Builds the exact ABI arguments for a middleware-provided native tx.
export function buildNativeTxArgs(
  nativeTx: IntentQuote["nativeTransactions"][number],
  rffSignature: Hex,
) {
  const baseArgs = [
    nativeTx.vaultRequest,
    rffSignature,
    BigInt(nativeTx.sourceIndex),
  ];
  if (nativeTx.functionName === "deposit") return baseArgs;

  if (!nativeTx.payload) {
    throw new Error(`Missing encoded routing payload for native source ${nativeTx.sourceIndex}`);
  }

  return [...baseArgs, nativeTx.payload, "0x" as Hex];
}

// Switches the connected wallet to the requested chain.
export async function switchChain(provider: EthereumProvider, chainId: number) {
  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: bigintToRpcQuantity(BigInt(chainId)) }],
  });
}

// Ensures a user-provided value is an EVM address.
export function assertAddress(value: string, label: string): Hex {
  if (!isAddress(value, { strict: false })) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Hex;
}

// Reads a useful error from middleware responses.
export function readMiddlewareError(body: unknown, status: number) {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    if (typeof record.message === "string") return record.message;
    if (typeof record.code === "string") return record.code;
  }
  if (typeof body === "string" && body.trim()) return body;
  return `Request failed with HTTP ${status}`;
}

// Picks the first chain from a deployment response or throws if it is empty.
function getFirstChain(deployment: DeploymentResponse): DeploymentChain {
  const first = deployment.chains[0];
  if (!first) {
    throw new Error("Deployment has no configured chains");
  }
  return first;
}

// Converts a decimal string such as "1.25" into bigint units for a token.
function parseHumanAmount(value: string, decimals: number, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  try {
    return parseUnits(trimmed, decimals);
  } catch {
    throw new Error(`${label} must be a valid decimal amount`);
  }
}

function parseSlippageBps(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.toLowerCase() === "auto") return "auto";
  const slippageBps = Number(trimmed);
  if (
    !Number.isInteger(slippageBps) ||
    slippageBps < 0 ||
    slippageBps > 10_000
  ) {
    throw new Error(
      "Slippage bps must be a whole number from 0 to 10000, or auto",
    );
  }
  return slippageBps;
}

// Normalizes the ordered source preference list for middleware (exactOutput only).
function normalizeSources(sources: SourcePreference[]) {
  return sources.map((source) => ({
    chainId: `EVM_${source.sourceChain}`,
    tokens: source.tokens.length > 0 ? source.tokens : undefined,
  }));
}

// Converts bigint values to the hex quantity format expected by Ethereum RPC.
function bigintToRpcQuantity(value: bigint): Hex {
  return `0x${value.toString(16)}` as Hex;
}
