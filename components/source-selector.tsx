"use client";

import {
  getTokensForChain,
  type DeploymentResponse,
  type Hex,
  type SourcePreference,
} from "../lib/intent-utils";

type Props = {
  deployment: DeploymentResponse;
  value: SourcePreference[];
  onChange: (next: SourcePreference[]) => void;
};

export function SourceSelector({ deployment, value, onChange }: Props) {
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
    const firstChain = deployment.chains[0];
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
        const tokens = getTokensForChain(deployment, source.sourceChain);
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
                {deployment.chains.map((chain) => (
                  <option key={chain.chainId} value={chain.chainId}>
                    {chain.name} · {chain.chainId}
                  </option>
                ))}
              </select>
            </label>

            <div className="tokenPicker">
              {tokens.map((token) => {
                const selected = source.tokens.some(
                  (item) => item.toLowerCase() === token.address.toLowerCase(),
                );
                return (
                  <button
                    type="button"
                    key={`${token.chainId}-${token.address}`}
                    onClick={() =>
                      updateSource(index, {
                        tokens: addToken(source, token.address),
                      })
                    }
                    disabled={selected}
                  >
                    Add {token.symbol}
                  </button>
                );
              })}
              {tokens.length === 0 ? (
                <div className="empty">
                  No known tokens configured for this chain.
                </div>
              ) : null}
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
