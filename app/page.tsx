"use client";

import { useEffect, useMemo, useState } from "react";
import { SourceSelector } from "../components/source-selector";
import {
  MIDDLEWARE_URL,
  fetchBridgeBalances,
  fetchDeployment,
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
  getToken,
  getTokensForChain,
  type BalancesByChain,
  type DeploymentChain,
  type DeploymentResponse,
  type Hex,
  type InputLeg,
  type IntentFormState,
  type IntentQuote,
  type IntentStatusResponse,
  type IntentSubmitResponse,
  type SelectableToken,
} from "../lib/intent-utils";

export default function Page() {
  const [deployment, setDeployment] = useState<DeploymentResponse | null>(null);
  const [form, setForm] = useState<IntentFormState | null>(null);
  const [balances, setBalances] = useState<BalancesByChain | null>(null);
  const [quote, setQuote] = useState<IntentQuote | null>(null);
  const [submitResult, setSubmitResult] = useState<IntentSubmitResponse | null>(
    null,
  );
  const [intentStatus, setIntentStatus] = useState<IntentStatusResponse | null>(
    null,
  );
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
        const nextDeployment = await fetchDeployment();
        if (cancelled) return;
        setDeployment(nextDeployment);
        setForm((current) => current ?? buildInitialIntentForm(nextDeployment));
        setStatus("Ready to quote intents");
      } catch (nextError) {
        if (!cancelled) {
          setError(readError(nextError));
          setStatus("Could not load middleware catalog");
        }
      }
    }

    loadDeployment();
    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveForm = useMemo(() => {
    if (!deployment || !form) return null;
    return buildEffectiveForm(deployment, form, advancedOpen);
  }, [deployment, form, advancedOpen]);

  const destinationTokens = useMemo(() => {
    if (!deployment || !form) return [];
    return getTokensForChain(deployment, form.destinationChainId);
  }, [deployment, form]);

  const sourceLeg = form?.inputs[0] ?? null;
  const sourceTokens = useMemo(() => {
    if (!deployment || !sourceLeg) return [];
    return getTokensForChain(deployment, sourceLeg.chainId);
  }, [deployment, sourceLeg]);

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
    const nextBalances = await fetchBridgeBalances(account);
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
      setRawVisible(false);
      setWarnings([]);
      setStatus("Refreshing balances");
      const freshBalances = await refreshBalances(effectiveForm.sender);
      setWarnings(findInsufficientInputs(deployment, effectiveForm, freshBalances));
      setStatus("Requesting quote");
      const nextQuote = await requestIntentQuote(deployment, effectiveForm);
      setQuote(nextQuote);
      setStatus(`Quote ready from ${nextQuote.provider}`);
      addLog(`Quote ${shortHash(nextQuote.quoteId)} via ${nextQuote.provider}`);
    } catch (nextError) {
      setError(readError(nextError));
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
      setStatus(`Intent ${finalStatus.status}`);
    } catch (nextError) {
      setError(readError(nextError));
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
                      <select
                        value={sourceLeg.token}
                        onChange={(event) =>
                          setSimpleInput({ token: event.target.value as Hex })
                        }
                      >
                        {sourceTokens.map((token) => (
                          <option key={token.address} value={token.address}>
                            {token.symbol}
                            {token.sourceKind === "swap" ? " · swap" : ""}
                          </option>
                        ))}
                      </select>
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
                            : "Best eligible provider across available balances"}
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
                  <select
                    value={form.destinationTokenAddress}
                    onChange={(event) =>
                      patchForm({
                        destinationTokenAddress: event.target.value as Hex,
                      })
                    }
                  >
                    {destinationTokens.map((token) => (
                      <option key={token.address} value={token.address}>
                        {token.symbol}
                        {token.sourceKind === "swap" ? " · swap" : ""}
                      </option>
                    ))}
                  </select>
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
                      onChange={(event) =>
                        patchForm({ gasDropAmount: event.target.value })
                      }
                    />
                  </label>
                </div>

                <div className="advancedBlock">
                  {isExactInput ? (
                    <>
                      <h3>Inputs (exactInput)</h3>
                      <InputsEditor
                        deployment={deployment}
                        value={form.inputs}
                        onChange={(inputs) => patchForm({ inputs })}
                      />
                    </>
                  ) : (
                    <>
                      <h3>Sources (optional, exactOutput)</h3>
                      <SourceSelector
                        deployment={deployment}
                        value={form.sources}
                        onChange={(sources) => patchForm({ sources })}
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
            : `${token.sourceKind === "swap" ? "Swap" : "Regular"} · ${shortAddress(token.address)}`}
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
  onRun,
  onLog,
  busy,
  polling,
}: {
  quote: IntentQuote | null;
  deployment: DeploymentResponse;
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
      <dl className="quoteList">
        <div>
          <dt>Output</dt>
          <dd>
            {formatQuoteAmount(
              deployment,
              quote.output.chainId,
              quote.output.tokenAddress,
              quote.output.amount,
            )}
          </dd>
        </div>
        <div>
          <dt>Min received</dt>
          <dd>
            {formatQuoteAmount(
              deployment,
              quote.output.chainId,
              quote.output.tokenAddress,
              quote.minAmountOut,
            )}
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
          <dd>
            {quote.fees.deposit} deposit · {quote.fees.fulfillment} fulfillment
          </dd>
        </div>
      </dl>
      <div className="quoteInputs">
        {quote.input.map((input, index) => (
          <div
            className="quoteInputRow"
            key={`${input.chainId}-${input.tokenAddress}-${index}`}
          >
            <span className="pill">Input {index + 1}</span>
            <strong>
              {formatQuoteAmount(
                deployment,
                input.chainId,
                input.tokenAddress,
                input.amount,
              )}
            </strong>
            <span>
              Total with fee:{" "}
              {formatQuoteAmount(
                deployment,
                input.chainId,
                input.tokenAddress,
                input.totalRequired,
              )}
            </span>
          </div>
        ))}
      </div>
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
}: {
  deployment: DeploymentResponse;
  value: InputLeg[];
  onChange: (next: InputLeg[]) => void;
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
        const tokens = getTokensForChain(deployment, leg.chainId);
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
                <select
                  value={leg.token}
                  onChange={(event) =>
                    updateLeg(index, { token: event.target.value as Hex })
                  }
                >
                  {tokens.map((nextToken) => (
                    <option key={nextToken.address} value={nextToken.address}>
                      {nextToken.symbol}
                      {nextToken.sourceKind === "swap" ? " · swap" : ""}
                    </option>
                  ))}
                </select>
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
  balances: BalancesByChain | null;
}) {
  return (
    <div className="panel">
      <span className="eyebrow">Balances</span>
      {!balances ? (
        <div className="emptyState">
          Connect a wallet or request a quote to load balances.
        </div>
      ) : null}
      <div className="balanceList">
        {deployment.chains.map((chain) => {
          const chainBalance = balances?.[String(chain.chainId)];
          const tokens = getTokensForChain(deployment, chain.chainId);
          return (
            <div className="balanceGroup" key={chain.chainId}>
              <div className="balanceHeader">
                <Logo src={chain.logo} label={chain.name} />
                <strong>{chain.name}</strong>
                <span>${chainBalance?.total_usd ?? "0"}</span>
              </div>
              {chainBalance?.errored ? (
                <span className="errorText">
                  Balance fetch failed for this chain.
                </span>
              ) : null}
              <BalanceTokenGroups
                tokens={tokens}
                currencies={chainBalance?.currencies ?? []}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BalanceTokenGroups({
  tokens,
  currencies,
}: {
  tokens: SelectableToken[];
  currencies: BalancesByChain[string]["currencies"];
}) {
  const regularTokens = tokens.filter((token) => token.sourceKind !== "swap");
  const swapTokens = tokens.filter((token) => token.sourceKind === "swap");

  return (
    <>
      <BalanceTokenGroup
        title="Regular"
        tokens={regularTokens}
        currencies={currencies}
      />
      <BalanceTokenGroup
        title="Swap"
        tokens={swapTokens}
        currencies={currencies}
      />
    </>
  );
}

function BalanceTokenGroup({
  title,
  tokens,
  currencies,
}: {
  title: string;
  tokens: SelectableToken[];
  currencies: BalancesByChain[string]["currencies"];
}) {
  const [open, setOpen] = useState(true);
  if (!tokens.length) return null;

  return (
    <div className="balanceTokenGroup">
      <button
        type="button"
        className="balanceTokenGroupHeader"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{title}</span>
        <span>{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div className="balanceTokenGroupList">
          {tokens.map((token) => (
            <BalanceTokenRow
              key={`${token.chainId}-${token.address}`}
              token={token}
              currency={findBalanceCurrency(currencies, token)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BalanceTokenRow({
  token,
  currency,
}: {
  token: SelectableToken;
  currency?: BalancesByChain[string]["currencies"][number];
}) {
  return (
    <div className="balanceToken">
      <Logo src={token.logo ?? currency?.logo} label={token.symbol} />
      <span>
        {token.symbol}:{" "}
        {currency
          ? formatBalanceAmount(currency.balance, currency.decimals)
          : "0"}
      </span>
      <small>
        {currency
          ? `$${currency.value}`
          : token.native
            ? "Native"
            : shortAddress(token.address)}
      </small>
    </div>
  );
}

function findBalanceCurrency(
  currencies: BalancesByChain[string]["currencies"],
  token: SelectableToken,
) {
  const tokenAddress = token.address.toLowerCase();
  return currencies.find(
    (currency) => currency.token_address.toLowerCase() === tokenAddress,
  );
}

function Logo({ src, label }: { src?: string; label: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="logoFallback">{label.slice(0, 1).toUpperCase()}</span>
    );
  }
  return (
    <img className="logo" src={src} alt="" onError={() => setFailed(true)} />
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

function shortHash(value: string) {
  return value.length > 14
    ? `${value.slice(0, 8)}...${value.slice(-6)}`
    : value;
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error";
}
