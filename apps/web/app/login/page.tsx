import { appInfo } from "../../lib/app-info";
import { sanitizeRedirectPath } from "../../server/auth/session";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const nextPath = sanitizeRedirectPath((await searchParams).next);

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="brand-lockup login-brand">
          <div className="brand-mark">
            <span className="material-symbols-outlined" aria-hidden="true">
              terminal
            </span>
          </div>
          <div>
            <strong>{appInfo.name}</strong>
            <span>Private workspace</span>
          </div>
        </div>

        <form action="/api/login" className="login-form" method="post">
          {nextPath !== "/" ? <input name="next" type="hidden" value={nextPath} /> : null}
          <label>
            Password
            <input
              autoComplete="current-password"
              autoFocus
              name="password"
              required
              type="password"
            />
          </label>
          <button type="submit">Log in</button>
        </form>
      </section>
    </main>
  );
}
