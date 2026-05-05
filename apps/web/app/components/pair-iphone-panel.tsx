import { Icon } from "./app-shell";

interface PairIphonePanelProps {
  hostMachineId: string;
  initialPairing?: PairingResponse | null;
  workspaceId: string;
}

interface PairingResponse {
  code: string;
  expiresAt: string;
  qrPayload: string;
}

export function PairIphonePanel({
  hostMachineId,
  initialPairing,
  workspaceId
}: PairIphonePanelProps) {
  return (
    <section className="glass-card phone-pair-card" id="pair-iphone">
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

      {initialPairing ? (
        <div className="phone-pair-code" aria-live="polite">
          <span>Manual code</span>
          <strong>{initialPairing.code}</strong>
          <small>Expires {new Date(initialPairing.expiresAt).toLocaleTimeString()}</small>
          <code>{initialPairing.qrPayload}</code>
        </div>
      ) : null}

      <form action="/api/mobile/pairing/start" method="post">
        <input name="hostMachineId" type="hidden" value={hostMachineId} />
        <input name="workspaceId" type="hidden" value={workspaceId} />
        <input name="redirectTo" type="hidden" value="/#pair-iphone" />
        <button className="primary-button" type="submit">
          <Icon>qr_code_2</Icon>
          Create pairing code
        </button>
      </form>
    </section>
  );
}
