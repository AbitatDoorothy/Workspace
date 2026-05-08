import { appInfo } from "../../lib/app-info";
import { sanitizeRedirectPath } from "../../server/auth/session";

export default async function RegisterPage({
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
            <span>Create workspace account</span>
          </div>
        </div>

        <form action="/api/register" className="login-form" method="post">
          {nextPath !== "/" ? <input name="next" type="hidden" value={nextPath} /> : null}
          <label>
            Email
            <input autoComplete="email" autoFocus name="email" required type="email" />
          </label>
          <label>
            Display name
            <input autoComplete="name" name="displayName" type="text" />
          </label>
          <label>
            Password
            <input
              autoComplete="new-password"
              minLength={8}
              name="password"
              required
              type="password"
            />
          </label>
          {params.error ? (
            <p className="form-error">
              Use a valid email and a password with at least 8 characters.
            </p>
          ) : null}
          <button type="submit">Create account</button>
          <a
            className="login-secondary-link"
            href={`/login${nextPath !== "/" ? `?next=${encodeURIComponent(nextPath)}` : ""}`}
          >
            Log in
          </a>
        </form>
      </section>
    </main>
  );
}
