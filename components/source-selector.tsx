"use client";

import {
  getRouteChains,
  getTokensForChain,
  type DeploymentResponse,
  type DeploymentToken,
  type Hex,
  type ProviderChoice,
  type SourcePreference,
  type SelectableToken,
} from "../lib/intent-utils";
import { TokenSelector } from "./token-selector";

type Props = {
  deployment: DeploymentResponse;
  value: SourcePreference[];
  onChange: (next: SourcePreference[]) => void;
  onTokensLoaded: (tokens: DeploymentToken[]) => void;
  destinationToken: SelectableToken;
  provider: ProviderChoice;
};

export function SourceSelector({
  deployment,
  value,
  onChange,
  onTokensLoaded,
  destinationToken,
  provider,
}: Props) {
  function updateSource(index: number, patch: Partial<SourcePreference>) {
    onChange(
      value.map((source, sourceIndex) =>
        sourceIndex === index ? { ...source, ...patch } : source,
      ),
    );
  }

  function moveSource(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= value.length) return;
    const next = [...value];
    const item = next[index];
    next[index] = next[nextIndex];
    next[nextIndex] = item;
    onChange(next);
  }

  function addSource() {
    const firstChain =
      getRouteChains(deployment, "source", provider, destinationToken)[0] ??
      deployment.chains[0];
    if (!firstChain) return;
    onChange([...value, { sourceChain: firstChain.chainId, tokens: [] }]);
  }

  function removeSource(index: number) {
    onChange(value.filter((_, sourceIndex) => sourceIndex !== index));
  }

  function addToken(source: SourcePreference, token: Hex) {
    const exists = source.tokens.some(
      (item) => item.toLowerCase() === token.toLowerCase(),
    );
    return exists ? source.tokens : [...source.tokens, token];
  }

  function removeToken(source: SourcePreference, token: Hex) {
    return source.tokens.filter(
      (item) => item.toLowerCase() !== token.toLowerCase(),
    );
  }

  function moveToken(
    source: SourcePreference,
    tokenIndex: number,
    direction: -1 | 1,
  ) {
    const nextIndex = tokenIndex + direction;
    if (nextIndex < 0 || nextIndex >= source.tokens.length)
      return source.tokens;
    const next = [...source.tokens];
    const item = next[tokenIndex];
    next[tokenIndex] = next[nextIndex];
    next[nextIndex] = item;
    return next;
  }

  function tokenLabel(sourceChain: number, tokenAddress: Hex) {
    const token = getTokensForChain(deployment, sourceChain).find(
      (item) => item.address.toLowerCase() === tokenAddress.toLowerCase(),
    );
    return token ? `${token.symbol} · ${token.address}` : tokenAddress;
  }

  return (
    <div className="tokenList">
      {value.length === 0 ? (
        <div className="empty">
          No source preference means middleware may use all eligible balances.
        </div>
      ) : null}

      {value.map((source, index) => {
        const compatibleChains = getRouteChains(
          deployment,
          "source",
          provider,
          destinationToken,
        );
        const chainOptions = includeCurrentChain(
          compatibleChains,
          deployment,
          source.sourceChain,
        );
        return (
          <div className="sourceCard" key={`${source.sourceChain}-${index}`}>
            <div className="sourceHeader">
              <strong>Source {index + 1}</strong>
              <div className="sourceControls">
                <button
                  type="button"
                  onClick={() => moveSource(index, -1)}
                  disabled={index === 0}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveSource(index, 1)}
                  disabled={index === value.length - 1}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => removeSource(index)}
                >
                  Remove
                </button>
              </div>
            </div>

            <label className="field">
              <span className="label">Source chain</span>
              <select
                value={source.sourceChain}
                onChange={(event) =>
                  updateSource(index, {
                    sourceChain: Number(event.target.value),
                    tokens: [],
                  })
                }
              >
                {chainOptions.map((chain) => (
                  <option key={chain.chainId} value={chain.chainId}>
                    {chain.name} · {chain.chainId}
                  </option>
                ))}
              </select>
            </label>

            <div className="tokenPicker">
              <TokenSelector
                deployment={deployment}
                chainId={source.sourceChain}
                value=""
                placeholder="Add a source token"
                role="source"
                provider={provider}
                oppositeToken={destinationToken}
                onChange={(token) =>
                  updateSource(index, {
                    tokens: addToken(source, token),
                  })
                }
                onTokensLoaded={onTokensLoaded}
              />
            </div>

            <div className="tokenList">
              {source.tokens.map((tokenAddress, tokenIndex) => (
                <div
                  className="tokenRow"
                  key={`${source.sourceChain}-${tokenAddress}`}
                >
                  <span className="tokenMeta">
                    <strong>Token {tokenIndex + 1}</strong>
                    <span>{tokenLabel(source.sourceChain, tokenAddress)}</span>
                  </span>
                  <div className="sourceControls">
                    <button
                      type="button"
                      onClick={() =>
                        updateSource(index, {
                          tokens: moveToken(source, tokenIndex, -1),
                        })
                      }
                      disabled={tokenIndex === 0}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateSource(index, {
                          tokens: moveToken(source, tokenIndex, 1),
                        })
                      }
                      disabled={tokenIndex === source.tokens.length - 1}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() =>
                        updateSource(index, {
                          tokens: removeToken(source, tokenAddress),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              {source.tokens.length === 0 ? (
                <div className="empty">
                  No token selected means middleware may use any token on this
                  chain.
                </div>
              ) : null}
            </div>
          </div>
        );
      })}

      <button type="button" onClick={addSource}>
        Add source
      </button>
    </div>
  );
}

function includeCurrentChain(
  compatibleChains: DeploymentResponse["chains"],
  deployment: DeploymentResponse,
  currentChainId: number,
) {
  if (compatibleChains.some((chain) => chain.chainId === currentChainId)) {
    return compatibleChains;
  }
  const current = deployment.chains.find((chain) => chain.chainId === currentChainId);
  return current ? [current, ...compatibleChains] : compatibleChains;
}
