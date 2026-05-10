import { Icon } from "./app-shell";

export function PairIphonePanel() {
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
        <p>
          Pairing is issued by the Mac-local control server. Run the command on this Mac, then scan
          the QR code or paste the manual payload in the iPhone app.
        </p>
      </div>

      <div className="phone-pair-code" aria-live="polite">
        <span>Mac command</span>
        <strong>abitat iphone</strong>
        <small>Uses the Abitat relay for off-network control.</small>
        <code>abitat iphone</code>
      </div>
    </section>
  );
}
