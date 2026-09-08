"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchIntentTokens } from "../lib/intent-flow";
import {
  getTokensForChain,
  type DeploymentResponse,
  type DeploymentToken,
  type Hex,
  type SelectableToken,
} from "../lib/intent-utils";

type Props = {
  deployment: DeploymentResponse;
  chainId: number;
  value?: Hex | "";
  onChange: (address: Hex) => void;
  onTokensLoaded?: (tokens: DeploymentToken[]) => void;
  placeholder?: string;
};

export function TokenSelector({
  deployment,
  chainId,
  value = "",
  onChange,
  onTokensLoaded,
  placeholder = "Select token",
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [remoteTokens, setRemoteTokens] = useState<DeploymentToken[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const options = useMemo(() => {
    const loadedDeployment = {
      ...deployment,
      tokens: remoteTokens ?? deployment.tokens,
    };
    return getTokensForChain(loadedDeployment, chainId);
  }, [chainId, deployment, remoteTokens]);

  const selected = options.find(
    (token) => token.address.toLowerCase() === value.toLowerCase(),
  );
  const normalizedSearch = search.trim().toLowerCase();
  const visibleOptions = normalizedSearch
    ? options.filter((token) =>
        [token.symbol, token.name, token.address].some((field) =>
          field.toLowerCase().includes(normalizedSearch),
        ),
      )
    : options;

  useEffect(() => {
    setOpen(false);
    setSearch("");
    setRemoteTokens(null);
    setLoadError(null);
  }, [chainId]);

  useEffect(() => {
    if (!open) return;

    const currentRequest = ++requestId.current;
    const timer = window.setTimeout(
      async () => {
        setLoading(true);
        setLoadError(null);
        try {
          const tokens = await fetchIntentTokens({
            chainId,
            search: search.trim() || undefined,
            limit: 100,
          });
          if (currentRequest !== requestId.current) return;
          setRemoteTokens(tokens);
          onTokensLoaded?.(tokens);
        } catch (error) {
          if (currentRequest !== requestId.current) return;
          setLoadError(error instanceof Error ? error.message : String(error));
        } finally {
          if (currentRequest === requestId.current) setLoading(false);
        }
      },
      search.trim() ? 300 : 0,
    );

    return () => window.clearTimeout(timer);
  }, [chainId, onTokensLoaded, open, search]);

  useEffect(() => {
    if (!open) return;
    function closeOnOutside(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, [open]);

  function choose(token: SelectableToken) {
    onChange(token.address);
    setOpen(false);
    setSearch("");
  }

  return (
    <div className="tokenSelect" ref={rootRef}>
      <button
        type="button"
        className="tokenSelectTrigger"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {selected ? (
          <>
            <TokenLogo src={selected.logo} label={selected.symbol} />
            <span className="tokenSelectValue">
              <strong>{selected.symbol}</strong>
              <small>{selected.native ? "Native token" : selected.name}</small>
            </span>
          </>
        ) : (
          <span className="tokenSelectPlaceholder">
            {value ? shortAddress(value) : placeholder}
          </span>
        )}
        <span className="tokenSelectChevron">{open ? "↑" : "↓"}</span>
      </button>

      {open ? (
        <div className="tokenSelectMenu">
          <input
            autoFocus
            value={search}
            placeholder="Search symbol, name, or contract"
            onChange={(event) => setSearch(event.target.value)}
          />
          {loading ? <div className="tokenSelectMessage">Searching…</div> : null}
          {loadError ? <div className="tokenSelectError">{loadError}</div> : null}
          <div className="tokenSelectOptions">
            {visibleOptions.map((token) => (
              <button
                type="button"
                className="tokenSelectOption"
                key={`${token.chainId}-${token.address}`}
                onClick={() => choose(token)}
              >
                <TokenLogo src={token.logo} label={token.symbol} />
                <span className="tokenSelectValue">
                  <strong>{token.symbol}</strong>
                  <small>
                    {token.native
                      ? "Native token"
                      : `${token.name} · ${shortAddress(token.address)}`}
                  </small>
                </span>
              </button>
            ))}
          </div>
          {!loading && visibleOptions.length === 0 ? (
            <div className="tokenSelectMessage">No matching tokens.</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TokenLogo({ src, label }: { src?: string; label: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <span className="logoFallback">{label.slice(0, 1).toUpperCase()}</span>;
  }
  return <img className="logo" src={src} alt="" onError={() => setFailed(true)} />;
}

function shortAddress(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}
