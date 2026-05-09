import { NextResponse } from "next/server";

import {
  DEFAULT_SESSION_TTL_MS,
  SESSION_COOKIE_NAME,
  createBrowserRedirectUrl,
  createSessionToken,
  getSessionSecret,
  isSecureRequest,
  sanitizeRedirectPath
} from "../../../server/auth/session";
import { accountService } from "../../../server/auth/accounts";
import { normalizeCliLoginCode } from "../../../server/auth/cli-device-login-browser";
import { cliDeviceLoginService } from "../../../server/auth/cli-device-login-service";

export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const nextPath = sanitizeRedirectPath(form.get("next"));
  const cliCode = normalizeCliLoginCode(form.get("cliCode"));
  const loginUrl = createBrowserRedirectUrl(request, "/login");
  let user: Awaited<ReturnType<typeof accountService.login>> | null;
  try {
    user = await accountService.login({ email, password });
  } catch (error) {
    console.warn("account login failed", {
      message: error instanceof Error ? error.message : String(error)
    });
    user = null;
  }

  if (!user) {
    loginUrl.searchParams.set("error", "1");
    if (nextPath !== "/") {
      loginUrl.searchParams.set("next", nextPath);
    }
    if (cliCode) {
      loginUrl.searchParams.set("cliCode", cliCode);
    }
    return NextResponse.redirect(loginUrl, 303);
  }

  if (cliCode) {
    const workspace = await accountService.findDefaultWorkspace(user.id).catch((error: unknown) => {
      console.warn("CLI login workspace lookup skipped", {
        message: error instanceof Error ? error.message : String(error)
      });
      return null;
    });
    await cliDeviceLoginService.completeLogin({
      code: cliCode,
      userId: user.id,
      workspaceId: workspace?.id
    });
  }

  const response = NextResponse.redirect(createBrowserRedirectUrl(request, nextPath), 303);
  response.cookies.set(SESSION_COOKIE_NAME, await createSessionToken(user.id, getSessionSecret()), {
    httpOnly: true,
    maxAge: DEFAULT_SESSION_TTL_MS / 1000,
    path: "/",
    sameSite: "lax",
    secure: isSecureRequest(request)
  });
  return response;
}
