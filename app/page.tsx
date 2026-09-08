"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SourceSelector } from "../components/source-selector";
import { TokenSelector } from "../components/token-selector";
import {
  MIDDLEWARE_URL,
  fetchDeployment,
  fetchIntentBalances,
  fetchIntentTokens,
  fetchRouteCatalog,
  pollIntentStatus,
  requestIntentQuote,
  submitIntent,
} from "../lib/intent-flow";
import {
  buildInitialIntentForm,
  buildIntentQuoteRequest,
  connectInjectedWallet,
  executeIntentQuote,
  findInsufficientInputs,
  formatBalanceAmount,
  getChain,
  getMiddlewareErrorPayload,
  getToken,
  getTokensForChain,
  getUsableLogo,
  mergeDeploymentTokens,
  type DeploymentChain,
  type DeploymentToken,
  type DeploymentResponse,
  type Hex,
  type InputLeg,
  type IntentBalance,
  type IntentBalances,
  type IntentFormState,
  type IntentQuote,
  type IntentStatusResponse,
  type IntentSubmitResponse,
  type MiddlewareErrorPayload,
  type SourceVerdict,
  type SelectableToken,
} from "../lib/intent-utils";

export default function Page() {
  const [deployment, setDeployment] = useState<DeploymentResponse | null>(null);
  const [form, setForm] = useState<IntentFormState | null>(null);
  const [balances, setBalances] = useState<IntentBalances | null>(null);
  const [quote, setQuote] = useState<IntentQuote | null>(null);
  const [submitResult, setSubmitResult] = useState<IntentSubmitResponse | null>(
    null,
  );
  const [intentStatus, setIntentStatus] = useState<IntentStatusResponse | null>(
    null,
  );
  const [routeCatalog, setRouteCatalog] = useState<DeploymentResponse | null>(
    null,
  );
  const [structuredError, setStructuredError] =
    useState<MiddlewareErrorPayload | null>(null);
  const [status, setStatus] = useState("Loading intent catalog");
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [rawVisible, setRawVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadDeployment() {
      try {
        const [nextDeployment, initialTokens] = await Promise.all([
          fetchDeployment(),
          fetchIntentTokens({ limit: 100 }),
        ]);
        if (cancelled) return;
        const hydratedDeployment = {
          ...nextDeployment,
          tokens: mergeDeploymentTokens(nextDeployment.tokens, initialTokens),
        };
        setDeployment(hydratedDeployment);
        setForm((current) => current ?? buildInitialIntentForm(hydratedDeployment));
        setStructuredError(null);
        setStatus("Ready to quote intents");
      } catch (nextError) {
        if (!cancelled) {
          setError(readError(nextError));
          setStructuredError(getMiddlewareErrorPayload(nextError));
          setStatus("Could not load middleware catalog");
        }
      }
    }

    loadDeployment();
    return () => {
      cancelled = true;
    };
  }, []);

  const registerTokens = useCallback((tokens: DeploymentToken[]) => {
    setDeployment((current) =>
      current
        ? { ...current, tokens: mergeDeploymentTokens(current.tokens, tokens) }
        : current,
    );
  }, []);

  const effectiveForm = useMemo(() => {
    if (!deployment || !form) return null;
    return buildEffectiveForm(deployment, form, advancedOpen);
  }, [deployment, form, advancedOpen]);

  const sourceLeg = form?.inputs[0] ?? null;

  const requestPreview = useMemo(() => {
    if (!deployment || !effectiveForm) return "";
    try {
      return JSON.stringify(
        buildIntentQuoteRequest(deployment, effectiveForm),
        null,
        2,
      );
    } catch (nextError) {
      return readError(nextError);
    }
  }, [deployment, effectiveForm]);

  function addLog(message: string) {
    setLogs((current) => [...current, message].slice(-18));
  }

  function patchForm(patch: Partial<IntentFormState>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
    setQuote(null);
    setSubmitResult(null);
    setIntentStatus(null);
    setRouteCatalog(null);
    setStructuredError(null);
    setError(null);
    setWarnings([]);
  }

  function setTradeType(tradeType: IntentFormState["tradeType"]) {
    if (!deployment || !form) return;
    patchForm({
      tradeType,
      inputs:
        tradeType === "exactInput" && form.inputs.length === 0
          ? [defaultInputLeg(deployment, form.destinationChainId)]
          : form.inputs,
    });
  }

  function setDestinationChain(chainId: number) {
    if (!deployment) return;
    const token = getTokensForChain(deployment, chainId)[0];
    patchForm({
      destinationChainId: chainId,
      destinationTokenAddress: token.address,
    });
  }

  function setSimpleInput(patch: Partial<InputLeg>) {
    if (!deployment || !form) return;
    const current =
      form.inputs[0] ?? defaultInputLeg(deployment, form.destinationChainId);
    patchForm({ inputs: [{ ...current, ...patch }, ...form.inputs.slice(1)] });
  }

  function setSimpleInputChain(chainId: number) {
    if (!deployment) return;
    const token = getTokensForChain(deployment, chainId)[0];
    setSimpleInput({ chainId, token: token.address });
  }

  async function refreshBalances(account: Hex) {
    if (!deployment) throw new Error("Intent deployment is not loaded");
    const nextBalances = await fetchIntentBalances(account);
    setBalances(nextBalances);
    return nextBalances;
  }

  async function connectWallet() {
    try {
      setBusy(true);
      setError(null);
      const account = await connectInjectedWallet();
      patchForm({ sender: account });
      setStatus("Refreshing balances");
      addLog(`Connected wallet ${shortAddress(account)}`);
      await refreshBalances(account);
      setStatus("Wallet ready");
    } catch (nextError) {
      setError(readError(nextError));
      setStatus("Wallet connection failed");
    } finally {
      setBusy(false);
    }
  }

  async function fetchQuote() {
    if (!deployment || !effectiveForm) return;
    try {
      setBusy(true);
      setError(null);
      setQuote(null);
      setSubmitResult(null);
      setIntentStatus(null);
      setRouteCatalog(null);
      setStructuredError(null);
      setRawVisible(false);
      setWarnings(
        balances
          ? findInsufficientInputs(deployment, effectiveForm, balances)
          : [],
      );
      setStatus("Requesting quote");
      const nextQuote = await requestIntentQuote(deployment, effectiveForm);
      setQuote(nextQuote);
      try {
        setRouteCatalog(await fetchRouteCatalog(deployment, effectiveForm));
      } catch (routeError) {
        addLog(`Route preflight unavailable: ${readError(routeError)}`);
      }
      setStatus(`Quote ready from ${nextQuote.provider}`);
      addLog(`Quote ${shortHash(nextQuote.quoteId)} via ${nextQuote.provider}`);
    } catch (nextError) {
      setError(readError(nextError));
      setStructuredError(getMiddlewareErrorPayload(nextError));
      setStatus("Quote failed");
    } finally {
      setBusy(false);
    }
  }

  async function runWalletFlow() {
    if (!quote || !effectiveForm?.sender) return;
    try {
      setBusy(true);
      setPolling(false);
      setError(null);
      setSubmitResult(null);
      setIntentStatus(null);
      setStructuredError(null);
      const appendLog = (message: string) => addLog(message);
      const execution = await executeIntentQuote(quote, {
        account: effectiveForm.sender,
        onLog: appendLog,
      });

      appendLog("Submitting intent to middleware");
      const submitted = await submitIntent(execution.submitRequest);
      setSubmitResult(submitted);
      setStatus(`Submitted ${shortHash(submitted.quoteId)}`);
      appendLog(`Submitted intent: ${submitted.status}`);

      setPolling(true);
      let lastStatusKey = "";
      const finalStatus = await pollIntentStatus(submitted.quoteId, {
        intervalMs: 2_000,
        onStatus: (nextStatus) => {
          setIntentStatus(nextStatus);
          const statusKey = `${nextStatus.status}:${nextStatus.substatus}`;
          if (statusKey !== lastStatusKey) {
            lastStatusKey = statusKey;
            appendLog(`Status: ${nextStatus.status} / ${nextStatus.substatus}`);
          }
        },
      });

      if (finalStatus.status === "fulfilled") {
        setStatus("Refreshing balances");
        try {
          await refreshBalances(effectiveForm.sender);
          appendLog("Balances refreshed after fulfillment");
        } catch (refreshError) {
          appendLog(`Balance refresh failed: ${readError(refreshError)}`);
        }
      }

      setStatus(`Intent ${finalStatus.status}`);
    } catch (nextError) {
      setError(readError(nextError));
      setStructuredError(getMiddlewareErrorPayload(nextError));
      setStatus("Wallet flow failed");
    } finally {
      setPolling(false);
      setBusy(false);
    }
  }

  function logRequest() {
    if (!deployment || !effectiveForm) return;
    try {
      const request = buildIntentQuoteRequest(deployment, effectiveForm);
      console.log("intent quote request", request);
      addLog("Quote request logged to console");
      setError(null);
    } catch (nextError) {
      setError(readError(nextError));
      setStructuredError(getMiddlewareErrorPayload(nextError));
    }
  }

  if (!deployment || !form || !effectiveForm) {
    return (
      <main className="page">
        <section className="heroShell">
          <div className="brandMark">N</div>
          <div>
            <h1>Intent Bridge + Swap</h1>
            <p>{MIDDLEWARE_URL}</p>
          </div>
        </section>
        <StatusBanner status={status} error={error} busy />
      </main>
    );
  }

  const isExactInput = form.tradeType === "exactInput";
  const showSimpleInput = isExactInput && !advancedOpen;
  const destinationChain = getChain(deployment, form.destinationChainId);
  const destinationToken = getToken(
    deployment,
    form.destinationChainId,
    form.destinationTokenAddress,
  );
  const inputChain = sourceLeg ? getChain(deployment, sourceLeg.chainId) : null;
  const inputToken = sourceLeg
    ? getToken(deployment, sourceLeg.chainId, sourceLeg.token)
    : null;
  const canQuote = Boolean(effectiveForm.sender && !busy);
  const relaySelected = form.provider === "relay";

  return (
    <main className="page">
      <section className="heroShell">
        <div className="brandMark">N</div>
        <div className="heroCopy">
          <span className="eyebrow">Middleware intent demo</span>
          <h1>Intent Bridge + Swap</h1>
          <p>
            Quote, sign, submit, and inspect bridge or cross-chain swap intent
            routes against <code>{MIDDLEWARE_URL}</code>.
          </p>
        </div>
        <button
          type="button"
          className="walletButton"
          onClick={connectWallet}
          disabled={busy}
        >
          {form.sender ? shortAddress(form.sender) : "Connect wallet"}
        </button>
      </section>

      <StatusBanner status={status} error={error} busy={busy || polling} />

      {structuredError ? (
        <MiddlewareErrorPanel error={structuredError} deployment={deployment} />
      ) : null}

      {warnings.length ? (
        <div className="statusBanner warning">
          <span className="dot" />
          <div>
            <strong>Heads up</strong>
            {warnings.map((warning, index) => (
              <p key={index}>{warning}</p>
            ))}
          </div>
        </div>
      ) : null}

      <div className="appGrid">
        <section className="mainStack">
          <div className="panel bridgePanel">
            <div className="panelHeader">
              <div>
                <span className="eyebrow">Route builder</span>
                <h2>Build an intent</h2>
              </div>
              <button
                type="button"
                className="ghostButton"
                onClick={() => setAdvancedOpen((current) => !current)}
              >
                {advancedOpen ? "Hide advanced" : "Advanced options"}
              </button>
            </div>

            <SegmentedControl
              value={form.tradeType}
              options={[
                ["exactOutput", "Exact out"],
                ["exactInput", "Exact in"],
              ]}
              onChange={(value) =>
                setTradeType(value as IntentFormState["tradeType"])
              }
            />

            <div className="routeGrid">
              <div className="routeBlock">
                <span className="label">
                  {isExactInput ? "You send" : "Source"}
                </span>
                {showSimpleInput && sourceLeg && inputChain && inputToken ? (
                  <>
                    <input
                      className="amountInput"
                      inputMode="decimal"
                      value={sourceLeg.amount}
                      onChange={(event) =>
                        setSimpleInput({ amount: event.target.value })
                      }
                    />
                    <SelectionSummary chain={inputChain} token={inputToken} />
                    <div className="selectRow">
                      <select
                        value={sourceLeg.chainId}
                        onChange={(event) =>
                          setSimpleInputChain(Number(event.target.value))
                        }
                      >
                        {deployment.chains.map((chain) => (
                          <option key={chain.chainId} value={chain.chainId}>
                            {chain.name}
                          </option>
                        ))}
                      </select>
                      <TokenSelector
                        deployment={deployment}
                        chainId={sourceLeg.chainId}
                        value={sourceLeg.token}
                        onChange={(token) => setSimpleInput({ token })}
                        onTokensLoaded={registerTokens}
                      />
                    </div>
                  </>
                ) : isExactInput ? (
                  <InputSummary
                    deployment={deployment}
                    inputs={effectiveForm.inputs}
                  />
                ) : (
                  <>
                    <div className="autoRoute">
                      <span className="logoFallback">A</span>
                      <div>
                        <strong>Auto liquidity</strong>
                        <span>
                          {advancedOpen && form.sources.length
                            ? `${form.sources.length} preferred source set`
                            : "Best provider across available balances"}
                        </span>
                      </div>
                    </div>
                    <p className="hint">
                      Open advanced options to choose ordered source chains and
                      tokens. Leave it empty to use all eligible balances.
                    </p>
                  </>
                )}
              </div>

              <div className="routeArrow">↓</div>

              <div className="routeBlock destinationBlock">
                <span className="label">
                  {isExactInput ? "You receive" : "Destination"}
                </span>
                <input
                  className="amountInput"
                  inputMode="decimal"
                  value={
                    isExactInput
                      ? quote
                        ? formatQuoteAmount(
                            deployment,
                            quote.output.chainId,
                            quote.output.tokenAddress,
                            quote.output.amount,
                          )
                        : ""
                      : form.outputAmount
                  }
                  placeholder={isExactInput ? "Quoted output" : "0.0"}
                  disabled={isExactInput}
                  onChange={(event) =>
                    patchForm({ outputAmount: event.target.value })
                  }
                />
                <SelectionSummary
                  chain={destinationChain}
                  token={destinationToken}
                />
                <div className="selectRow">
                  <select
                    value={form.destinationChainId}
                    onChange={(event) =>
                      setDestinationChain(Number(event.target.value))
                    }
                  >
                    {deployment.chains.map((chain) => (
                      <option key={chain.chainId} value={chain.chainId}>
                        {chain.name}
                      </option>
                    ))}
                  </select>
                  <TokenSelector
                    deployment={deployment}
                    chainId={form.destinationChainId}
                    value={form.destinationTokenAddress}
                    onChange={(token) =>
                      patchForm({ destinationTokenAddress: token })
                    }
                    onTokensLoaded={registerTokens}
                  />
                </div>
              </div>
            </div>

            <div className="formGrid compactGrid">
              <label className="field full">
                <span className="label">Sender</span>
                <input
                  value={form.sender}
                  placeholder="0x..."
                  onChange={(event) => {
                    patchForm({ sender: event.target.value as Hex });
                    setBalances(null);
                  }}
                />
              </label>
              <label className="field full">
                <span className="label">Recipient (defaults to sender)</span>
                <input
                  value={form.recipient}
                  placeholder="0x..."
                  onChange={(event) =>
                    patchForm({ recipient: event.target.value })
                  }
                />
              </label>
            </div>

            <div className="actions">
              <button
                type="button"
                className="primary"
                onClick={fetchQuote}
                disabled={!canQuote}
              >
                {busy ? "Working..." : "Get quote"}
              </button>
              <button type="button" onClick={logRequest}>
                Log request
              </button>
              <button
                type="button"
                onClick={() => setRawVisible((current) => !current)}
              >
                {rawVisible ? "Hide payload" : "Show payload"}
              </button>
            </div>

            {rawVisible ? <pre className="raw">{requestPreview}</pre> : null}
          </div>

          <div className={`panel advancedPanel ${advancedOpen ? "open" : ""}`}>
            <button
              type="button"
              className="advancedToggle"
              onClick={() => setAdvancedOpen((current) => !current)}
              aria-expanded={advancedOpen}
            >
              <span>
                <span className="eyebrow">Advanced options</span>
                <strong>
                  Provider, slippage, gas drop, and routing preferences
                </strong>
              </span>
              <span>{advancedOpen ? "−" : "+"}</span>
            </button>
            {advancedOpen ? (
              <div className="panelHeader">
                <div>
                  <span className="eyebrow">Request controls</span>
                  <h2>
                    {isExactInput ? "Exact-in inputs" : "Exact-out sources"}
                  </h2>
                </div>
              </div>
            ) : null}
            {advancedOpen ? (
              <>
                <div className="formGrid">
                  <label className="field">
                    <span className="label">Provider</span>
                    <select
                      value={form.provider}
                      onChange={(event) =>
                        patchForm({
                          provider: event.target
                            .value as IntentFormState["provider"],
                        })
                      }
                    >
                      <option value="auto">Auto (best eligible)</option>
                      <option value="nexus-v2">nexus-v2</option>
                      <option value="mayan">mayan</option>
                      <option value="relay">relay</option>
                    </select>
                  </label>
                  <label className="field">
                    <span className="label">Slippage bps</span>
                    <input
                      inputMode="numeric"
                      value={form.slippageBps}
                      placeholder="300 or auto"
                      onChange={(event) =>
                        patchForm({ slippageBps: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span className="label">
                      Gas drop ({destinationChain.nativeCurrency.symbol})
                    </span>
                    <input
                      inputMode="decimal"
                      value={form.gasDropAmount}
                      placeholder="0.0003"
                      onChange={(event) =>
                        patchForm({ gasDropAmount: event.target.value })
                      }
                    />
                  </label>
                </div>

                {relaySelected ? (
                  <p className="hint">
                    Relay gas drops use the destination native token amount. Relay converts it to
                    USD and caps the provider-managed top-up at $2.00. With exact in, the gas drop
                    reduces the token output; with exact out, it is additional. Exact-out source
                    preferences are considered in the order listed and may be combined.
                  </p>
                ) : null}

                <div className="advancedBlock">
                  {isExactInput ? (
                    <>
                      <h3>Inputs (exactInput)</h3>
                      <InputsEditor
                        deployment={deployment}
                        value={form.inputs}
                        onChange={(inputs) => patchForm({ inputs })}
                        onTokensLoaded={registerTokens}
                      />
                    </>
                  ) : (
                    <>
                      <h3>Sources (optional, exactOutput)</h3>
                      <SourceSelector
                        deployment={deployment}
                        value={form.sources}
                        onChange={(sources) => patchForm({ sources })}
                        onTokensLoaded={registerTokens}
                      />
                    </>
                  )}
                </div>
              </>
            ) : null}
          </div>

          <QuotePanel
            quote={quote}
            deployment={deployment}
            form={effectiveForm}
            onRun={runWalletFlow}
            onLog={() => {
              if (quote) {
                console.log("intent quote", quote);
                addLog("Quote logged to console");
              }
            }}
            busy={busy}
            polling={polling}
          />
          <RoutePreview
            catalog={routeCatalog}
            deployment={deployment}
            form={effectiveForm}
          />
          <StatusPanel
            quote={quote}
            submitResult={submitResult}
            intentStatus={intentStatus}
            logs={logs}
          />
        </section>

        <aside className="sideStack">
          <BalanceList deployment={deployment} balances={balances} />
        </aside>
      </div>
    </main>
  );
}

function StatusBanner({
  status,
  error,
  busy,
}: {
  status: string;
  error: string | null;
  busy: boolean;
}) {
  return (
    <div className={`statusBanner ${error ? "error" : ""}`}>
      <span className={busy ? "pulseDot" : "dot"} />
      <div>
        <strong>{error ? "Something needs attention" : status}</strong>
        {error ? <p>{error}</p> : null}
      </div>
    </div>
  );
}

function SegmentedControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="segment">
      {options.map(([optionValue, label]) => (
        <button
          type="button"
          key={optionValue}
          className={value === optionValue ? "active" : ""}
          onClick={() => onChange(optionValue)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function SelectionSummary({
  chain,
  token,
}: {
  chain: DeploymentChain;
  token: SelectableToken;
}) {
  return (
    <div className="selectionSummary">
      <Logo src={chain.logo} label={chain.name} />
      <div>
        <strong>{chain.name}</strong>
        <span>Chain {chain.chainId}</span>
      </div>
      <Logo src={token.logo} label={token.symbol} />
      <div>
        <strong>{token.symbol}</strong>
        <span>
          {token.native
            ? "Native token"
            : `${token.name} · ${shortAddress(token.address)}`}
        </span>
      </div>
    </div>
  );
}

function InputSummary({
  deployment,
  inputs,
}: {
  deployment: DeploymentResponse;
  inputs: InputLeg[];
}) {
  if (inputs.length === 0) {
    return <div className="emptyState">No input selected.</div>;
  }

  if (inputs.length === 1) {
    const input = inputs[0];
    const chain = getChain(deployment, input.chainId);
    const token = getToken(deployment, input.chainId, input.token);
    return (
      <>
        <div className="amountDisplay">{input.amount || "0"}</div>
        <SelectionSummary chain={chain} token={token} />
        <p className="hint">Edit this input in Advanced options.</p>
      </>
    );
  }

  return (
    <div className="inputSummary">
      <strong>{inputs.length} input legs</strong>
      <span>Advanced options define the exact-in request below.</span>
      <div className="inputChipList">
        {inputs.map((input, index) => {
          const chain = getChain(deployment, input.chainId);
          const token = getToken(deployment, input.chainId, input.token);
          return (
            <span
              className="inputChip"
              key={`${input.chainId}-${input.token}-${index}`}
            >
              {input.amount || "0"} {token.symbol} on {chain.name}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function QuotePanel({
  quote,
  deployment,
  form,
  onRun,
  onLog,
  busy,
  polling,
}: {
  quote: IntentQuote | null;
  deployment: DeploymentResponse;
  form: IntentFormState;
  onRun: () => void;
  onLog: () => void;
  busy: boolean;
  polling: boolean;
}) {
  if (!quote) {
    return (
      <div className="panel">
        <span className="eyebrow">Quote</span>
        <div className="emptyState">
          No quote yet. Build a route and request pricing.
        </div>
      </div>
    );
  }

  return (
    <div className="panel quotePanel">
      <div className="panelHeader">
        <div>
          <span className="eyebrow">Quote</span>
          <h2>{quote.provider}</h2>
        </div>
        <span className="pill">{quote.tradeType}</span>
      </div>
      <p className="hint">
        {quote.tradeType === "exactOutput"
          ? "The destination token amount is exact; any requested gas drop is additional."
          : "The destination token amount is the quoted result after fees and any gas drop."}
        {form.gasDropAmount.trim()
          ? ` Gas drop: ${form.gasDropAmount.trim()} ${getChain(deployment, form.destinationChainId).nativeCurrency.symbol}.`
          : " No gas drop requested."}
      </p>
      <dl className="quoteList">
        <div>
          <dt>Output</dt>
          <dd className="quoteMetric">
            <span>
              {formatQuoteAmount(
                deployment,
                quote.output.chainId,
                quote.output.tokenAddress,
                quote.output.amount,
              )}
            </span>
            <span className="quoteUsd">≈ ${quote.output.amountUsd}</span>
          </dd>
        </div>
        <div>
          <dt>Min received</dt>
          <dd className="quoteMetric">
            <span>
              {formatQuoteAmount(
                deployment,
                quote.output.chainId,
                quote.output.tokenAddress,
                quote.minAmountOut,
              )}
            </span>
            <span className="quoteUsd">≈ ${quote.minAmountOutUsd}</span>
          </dd>
        </div>
        <div>
          <dt>Input legs</dt>
          <dd>{quote.input.length}</dd>
        </div>
        <div>
          <dt>Approvals</dt>
          <dd>{quote.allowances.length}</dd>
        </div>
        <div>
          <dt>Native txs</dt>
          <dd>{quote.nativeTransactions.length}</dd>
        </div>
        <div>
          <dt>Fees</dt>
          <dd className="quoteFeeBreakdown">
            <span>
              Deposit: {quote.fees.deposit} (
              <span className="quoteUsd">${quote.fees.depositUsd}</span>)
            </span>
            <span>
              Fulfillment: {quote.fees.fulfillment} (
              <span className="quoteUsd">${quote.fees.fulfillmentUsd}</span>)
            </span>
            <span>
              Protocol: {quote.fees.protocol} (
              <span className="quoteUsd">${quote.fees.protocolUsd}</span>)
            </span>
            <span>
              Solver: {quote.fees.solver} (
              <span className="quoteUsd">${quote.fees.solverUsd}</span>)
            </span>
          </dd>
        </div>
      </dl>
      <div className="quoteInputs">
        {quote.input.map((input, index) => {
          const chainId = Number(input.chainId.replace("EVM_", ""));
          const chain = getChain(deployment, chainId);
          const token = getToken(deployment, chainId, input.tokenAddress);

          return (
            <div
              className="quoteInputRow"
              key={`${input.chainId}-${input.tokenAddress}-${index}`}
            >
              <span className="pill">Input {index + 1}</span>
              <div className="quoteInputSource">
                <Logo src={chain.logo} label={chain.name} />
                <div>
                  <strong>{chain.name}</strong>
                  <span>Source chain</span>
                </div>
                <Logo src={token.logo} label={token.symbol} />
                <div>
                  <strong>{token.symbol}</strong>
                  <span>{token.name}</span>
                </div>
              </div>
              <div className="quoteInputAmounts">
                <strong>
                  {quote.tradeType === "exactInput" ? "Routed amount: " : ""}
                  {formatBalanceAmount(input.amount, token.decimals)}{" "}
                  {token.symbol}
                </strong>
                <span className="quoteUsd">≈ ${input.amountUsd}</span>
                <span>
                  {quote.tradeType === "exactInput"
                    ? "Total wallet amount: "
                    : "Total with fee: "}
                  {formatBalanceAmount(input.totalRequired, token.decimals)}{" "}
                  {token.symbol}
                </span>
                <span className="quoteUsd">≈ ${input.totalRequiredUsd}</span>
                <span className="quoteInputFee">
                  Deposit fee: {formatBalanceAmount(input.depositFee, token.decimals)} {token.symbol}
                  (≈ ${input.depositFeeUsd})
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <SourceVerdictPanel
        deployment={deployment}
        verdicts={quote.sourceVerdicts}
      />
      <span className="hashText">{quote.quoteId}</span>
      <div className="actions">
        <button type="button" onClick={onLog}>
          Log quote
        </button>
        <button
          type="button"
          className="primary"
          onClick={onRun}
          disabled={busy}
        >
          {polling ? "Polling status" : "Run full flow"}
        </button>
      </div>
    </div>
  );
}

function SourceVerdictPanel({
  deployment,
  verdicts,
}: {
  deployment: DeploymentResponse;
  verdicts: SourceVerdict[];
}) {
  if (verdicts.length === 0) return null;
  return (
    <details className="verdictPanel">
      <summary className="verdictSummary panelHeader">
        <div>
          <span className="eyebrow">Routing diagnostics</span>
          <h3>Source verdicts</h3>
        </div>
        <span className="verdictSummaryMeta">
          <span className="muted">{verdicts.length} considered</span>
          <span className="verdictDisclosure">Show details</span>
        </span>
      </summary>
      <div className="verdictList">
        {verdicts.map((verdict) => (
          <VerdictRow
            key={`${verdict.chainId}-${verdict.tokenAddress}`}
            deployment={deployment}
            verdict={verdict}
          />
        ))}
      </div>
    </details>
  );
}

function VerdictRow({
  deployment,
  verdict,
}: {
  deployment: DeploymentResponse;
  verdict: SourceVerdict;
}) {
  const chainId = Number(verdict.chainId.replace("EVM_", ""));
  const chain = deployment.chains.find((item) => item.chainId === chainId);
  const stateLabel = verdict.state === "unroutable" ? verdict.reason : verdict.state;
  return (
    <div className={`verdictRow ${verdict.state}`}>
      <div>
        <strong>{verdict.tokenSymbol}</strong>
        <span>{chain?.name ?? verdict.chainId}</span>
      </div>
      <span className="verdictState">{stateLabel}</span>
      {verdict.detail ? <small>{verdict.detail}</small> : null}
    </div>
  );
}

function MiddlewareErrorPanel({
  deployment,
  error,
}: {
  deployment: DeploymentResponse;
  error: MiddlewareErrorPayload;
}) {
  const verdicts = error.details?.sourceVerdicts ?? [];
  const providerReasons = error.details?.providerReasons ?? [];
  if (verdicts.length === 0 && providerReasons.length === 0) return null;

  return (
    <div className="structuredError">
      <div>
        <span className="eyebrow">Provider diagnostics</span>
        <strong>{error.subcode ?? error.code ?? "Request details"}</strong>
      </div>
      {providerReasons.length > 0 ? (
        <div className="providerReasons">
          {providerReasons.map((reason) => (
            <span key={reason}>{reason}</span>
          ))}
        </div>
      ) : null}
      {verdicts.length > 0 ? (
        <SourceVerdictPanel deployment={deployment} verdicts={verdicts} />
      ) : null}
    </div>
  );
}

function RoutePreview({
  catalog,
  deployment,
  form,
}: {
  catalog: DeploymentResponse | null;
  deployment: DeploymentResponse;
  form: IntentFormState;
}) {
  if (!catalog) return null;

  const destinationChain = catalog.chains.find(
    (chain) => chain.chainId === form.destinationChainId,
  );
  const destinationProviders = providerNames(destinationChain?.asDestination);

  const sourceDescriptions =
    form.tradeType === "exactInput"
      ? form.inputs.map((input) => {
          const chain = catalog.chains.find((item) => item.chainId === input.chainId);
          const token = getToken(deployment, input.chainId, input.token);
          return `${token.symbol} on ${chain?.name ?? `EVM_${input.chainId}`}: ${providerNames(chain?.asSource)}`;
        })
      : form.sources.length > 0
        ? form.sources.map((source) => {
            const chain = catalog.chains.find(
              (item) => item.chainId === source.sourceChain,
            );
            return `${chain?.name ?? `EVM_${source.sourceChain}`}: ${providerNames(
              chain?.asSource,
            )}`;
          })
        : [
            "Automatic source search across provider-supported balances",
          ];

  return (
    <div className="panel routePreview">
      <div className="panelHeader">
        <div>
          <span className="eyebrow">Route preflight</span>
          <h2>Eligibility under these constraints</h2>
        </div>
        <span className="muted">Quote remains authoritative</span>
      </div>
      <div className="routeCapabilityGrid">
        <div>
          <span className="label">Destination providers</span>
          <strong>{destinationProviders}</strong>
        </div>
        <div>
          <span className="label">Source candidates</span>
          <div className="routeSourceList">
            {sourceDescriptions.map((description) => (
              <span key={description}>{description}</span>
            ))}
          </div>
        </div>
      </div>
      <p className="hint">
        Empty provider lists mean the selected route is not served by that provider. A non-empty
        list still needs a live quote because liquidity and fees can change.
      </p>
    </div>
  );
}

function StatusPanel({
  quote,
  submitResult,
  intentStatus,
  logs,
}: {
  quote: IntentQuote | null;
  submitResult: IntentSubmitResponse | null;
  intentStatus: IntentStatusResponse | null;
  logs: string[];
}) {
  const steps = [
    ["Quote", Boolean(quote)],
    ["Submit", Boolean(submitResult)],
    ["Fulfill", intentStatus?.status === "fulfilled"],
  ] as const;

  return (
    <div className="panel">
      <span className="eyebrow">Status</span>
      <div className="timeline">
        {steps.map(([label, done]) => (
          <div className={done ? "done" : ""} key={label}>
            <span />
            {label}
          </div>
        ))}
      </div>
      <div className="statusText">
        {intentStatus
          ? `${intentStatus.provider}: ${intentStatus.status} / ${intentStatus.substatus}`
          : submitResult
            ? `Submitted ${shortHash(submitResult.quoteId)}`
            : "Submit an intent to start polling."}
      </div>
      {logs.length ? (
        <ul className="logs">
          {logs.map((log, index) => (
            <li key={`${log}-${index}`}>{log}</li>
          ))}
        </ul>
      ) : (
        <div className="emptyState">
          Logs will appear here while you quote and execute.
        </div>
      )}
    </div>
  );
}

function InputsEditor({
  deployment,
  value,
  onChange,
  onTokensLoaded,
}: {
  deployment: DeploymentResponse;
  value: InputLeg[];
  onChange: (next: InputLeg[]) => void;
  onTokensLoaded: (tokens: DeploymentToken[]) => void;
}) {
  function addLeg() {
    onChange([...value, defaultInputLeg(deployment)]);
  }

  function updateLeg(index: number, patch: Partial<InputLeg>) {
    onChange(
      value.map((leg, legIndex) =>
        legIndex === index ? { ...leg, ...patch } : leg,
      ),
    );
  }

  function removeLeg(index: number) {
    onChange(value.filter((_, legIndex) => legIndex !== index));
  }

  return (
    <div className="tokenList">
      {value.length === 0 ? (
        <div className="emptyState">Add at least one input leg.</div>
      ) : null}

      {value.map((leg, index) => {
        const chain = getChain(deployment, leg.chainId);
        const token = getToken(deployment, leg.chainId, leg.token);
        return (
          <div className="sourceCard" key={`${leg.chainId}-${index}`}>
            <div className="sourceHeader">
              <SelectionSummary chain={chain} token={token} />
              <button
                type="button"
                className="danger"
                onClick={() => removeLeg(index)}
              >
                Remove
              </button>
            </div>
            <div className="formGrid">
              <label className="field">
                <span className="label">Chain</span>
                <select
                  value={leg.chainId}
                  onChange={(event) => {
                    const chainId = Number(event.target.value);
                    const nextToken = getTokensForChain(deployment, chainId)[0];
                    updateLeg(index, { chainId, token: nextToken.address });
                  }}
                >
                  {deployment.chains.map((nextChain) => (
                    <option key={nextChain.chainId} value={nextChain.chainId}>
                      {nextChain.name} · {nextChain.chainId}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="label">Amount</span>
                <input
                  inputMode="decimal"
                  value={leg.amount}
                  onChange={(event) =>
                    updateLeg(index, { amount: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span className="label">Token</span>
                <TokenSelector
                  deployment={deployment}
                  chainId={leg.chainId}
                  value={leg.token}
                  onChange={(address) => updateLeg(index, { token: address })}
                  onTokensLoaded={onTokensLoaded}
                />
              </label>
            </div>
          </div>
        );
      })}

      <button type="button" onClick={addLeg}>
        Add input
      </button>
    </div>
  );
}

function BalanceList({
  deployment,
  balances,
}: {
  deployment: DeploymentResponse;
  balances: IntentBalances | null;
}) {
  const grouped = new Map<string, IntentBalance[]>();
  for (const balance of balances?.balances ?? []) {
    const chainBalances = grouped.get(balance.chainId) ?? [];
    chainBalances.push(balance);
    grouped.set(balance.chainId, chainBalances);
  }

  const totalUsd = (balances?.balances ?? []).reduce(
    (sum, balance) => sum + (balance.valueUsd ?? 0),
    0,
  );

  return (
    <div className="panel">
      <div className="panelHeader balancePanelHeader">
        <div>
          <span className="eyebrow">Balances</span>
          <h2>{balances ? `$${totalUsd.toFixed(2)}` : "Wallet assets"}</h2>
        </div>
        {balances ? (
          <span className="muted">{balances.balances.length} assets</span>
        ) : null}
      </div>
      {!balances ? (
        <div className="emptyState">
          Connect a wallet or request a quote to load balances.
        </div>
      ) : null}
      {balances?.errored ? (
        <div className="balanceWarning">
          Some chains could not be refreshed. Showing the balances that were
          returned.
        </div>
      ) : null}
      <div className="balanceList">
        {[...grouped.entries()].map(([chainRef, chainBalances]) => {
          const chainId = Number(chainRef.replace("EVM_", ""));
          const chain = deployment.chains.find(
            (item) => item.chainId === chainId,
          );
          const chainTotalUsd = chainBalances.reduce(
            (sum, balance) => sum + (balance.valueUsd ?? 0),
            0,
          );
          return (
            <div className="balanceGroup" key={chainRef}>
              <div className="balanceHeader">
                <Logo src={chain?.logo} label={chain?.name ?? chainRef} />
                <strong>{chain?.name ?? chainRef}</strong>
                <span>${chainTotalUsd.toFixed(2)}</span>
              </div>
              <div className="balanceTokenGroupList">
                {chainBalances.map((balance) => (
                  <BalanceTokenRow
                    key={`${balance.chainId}-${balance.address}`}
                    balance={balance}
                  />
                ))}
              </div>
            </div>
          );
        })}
        {balances && balances.balances.length === 0 ? (
          <div className="emptyState">No routable balances found.</div>
        ) : null}
      </div>
    </div>
  );
}

function BalanceTokenRow({ balance }: { balance: IntentBalance }) {
  return (
    <div className="balanceToken">
      <Logo src={balance.logo} label={balance.symbol} />
      <span>
        {formatBalanceAmount(balance.balance, balance.decimals)}{" "}
        {balance.symbol}
      </span>
      <small>
        {balance.valueUsd === null
          ? balance.isNative
            ? "Native · no price"
            : "No price"
          : `$${balance.valueUsd.toFixed(2)}`}
      </small>
    </div>
  );
}

function Logo({ src, label }: { src?: string; label: string }) {
  const [failed, setFailed] = useState(false);
  const usableSrc = getUsableLogo(src);
  if (!usableSrc || failed) {
    return (
      <span className="logoFallback">{label.slice(0, 1).toUpperCase()}</span>
    );
  }
  return (
    <img
      className="logo"
      src={usableSrc}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

function buildEffectiveForm(
  deployment: DeploymentResponse,
  form: IntentFormState,
  advancedOpen: boolean,
): IntentFormState {
  if (advancedOpen) return form;
  return {
    ...form,
    provider: "auto",
    gasDropAmount: "",
    slippageBps: "auto",
    sources: [],
    inputs:
      form.tradeType === "exactInput"
        ? [
            form.inputs[0] ??
              defaultInputLeg(deployment, form.destinationChainId),
          ]
        : [],
  };
}

function defaultInputLeg(
  deployment: DeploymentResponse,
  destinationChainId?: number,
): InputLeg {
  const chain =
    deployment.chains.find((item) => item.chainId !== destinationChainId) ??
    deployment.chains[0];
  if (!chain) {
    throw new Error("Deployment has no configured chains");
  }
  const token = getTokensForChain(deployment, chain.chainId)[0];
  return { chainId: chain.chainId, token: token.address, amount: "1" };
}

function formatQuoteAmount(
  deployment: DeploymentResponse,
  chainRef: string,
  tokenAddress: Hex,
  amount: string,
) {
  try {
    const chainId = Number(chainRef.replace("EVM_", ""));
    const token = getToken(deployment, chainId, tokenAddress);
    return `${formatBalanceAmount(amount, token.decimals)} ${token.symbol}`;
  } catch {
    return amount;
  }
}

function shortAddress(value: string) {
  return value.length > 12
    ? `${value.slice(0, 6)}...${value.slice(-4)}`
    : value;
}

function providerNames(
  providers?: Array<{ id: string }> | string[],
): string {
  const ids = [...new Set((providers ?? []).map((provider) =>
    typeof provider === "string" ? provider : provider.id,
  ))];
  return ids.length > 0 ? ids.join(", ") : "No provider";
}

function shortHash(value: string) {
  return value.length > 14
    ? `${value.slice(0, 8)}...${value.slice(-6)}`
    : value;
}

function readError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (typeof record.error === "string") return record.error;
    if (typeof record.code === "string") return record.code;
  }
  return "Unexpected error";
}
