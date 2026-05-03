"use client";

import { useState } from "react";

import { Icon } from "./app-shell";

interface PairIphonePanelProps {
  hostMachineId: string;
  workspaceId: string;
}

interface PairingResponse {
  code: string;
  expiresAt: string;
  qrPayload: string;
}

export function PairIphonePanel({ hostMachineId, workspaceId }: PairIphonePanelProps) {
  const [pairing, setPairing] = useState<PairingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function startPairing() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/mobile/pairing/start", {
        body: JSON.stringify({
          hostMachineId,
          workspaceId
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
      const payload = (await response.json()) as PairingResponse | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error ? payload.error : "Unable to pair iPhone"
        );
      }

      setPairing(payload as PairingResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to pair iPhone");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="glass-card phone-pair-card">
      <div className="card-topline">
        <span className="icon-tile">
          <Icon>smartphone</Icon>
        </span>
        <span className="muted">Remote Codex</span>
      </div>

      <div className="phone-pair-copy">
        <h2>Pair iPhone</h2>
        <p>Connect a phone to this Mac for project access, synced chat, and remote control.</p>
      </div>

      {pairing ? (
        <div className="phone-pair-code" aria-live="polite">
          <span>Manual code</span>
          <strong>{pairing.code}</strong>
          <small>Expires {new Date(pairing.expiresAt).toLocaleTimeString()}</small>
          <code>{pairing.qrPayload}</code>
        </div>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}

      <button className="primary-button" disabled={isLoading} onClick={startPairing} type="button">
        <Icon>{isLoading ? "sync" : "qr_code_2"}</Icon>
        {isLoading ? "Creating code" : "Create pairing code"}
      </button>
    </section>
  );
}
