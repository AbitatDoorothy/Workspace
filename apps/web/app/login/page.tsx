import { appInfo } from "../../lib/app-info";
import { sanitizeRedirectPath } from "../../server/auth/session";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const nextPath = sanitizeRedirectPath(params.next);

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
            Email
            <input autoComplete="email" autoFocus name="email" required type="email" />
          </label>
          <label>
            Password
            <input autoComplete="current-password" name="password" required type="password" />
          </label>
          {params.error ? <p className="form-error">Email or password is incorrect.</p> : null}
          <button type="submit">Log in</button>
          <a
            className="login-secondary-link"
            href={`/register${nextPath !== "/" ? `?next=${encodeURIComponent(nextPath)}` : ""}`}
          >
            Create an account
          </a>
        </form>
      </section>
    </main>
  );
}
