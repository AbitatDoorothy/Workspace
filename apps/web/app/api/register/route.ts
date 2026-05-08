import { NextResponse } from "next/server";

import { accountService } from "../../../server/auth/accounts";
import { normalizeCliLoginCode } from "../../../server/auth/cli-device-login-browser";
import { cliDeviceLoginService } from "../../../server/auth/cli-device-login-service";
import {
  DEFAULT_SESSION_TTL_MS,
  SESSION_COOKIE_NAME,
  createBrowserRedirectUrl,
  createSessionToken,
  getSessionSecret,
  isSecureRequest,
  sanitizeRedirectPath
} from "../../../server/auth/session";

export async function POST(request: Request) {
  const form = await request.formData();
  const nextPath = sanitizeRedirectPath(form.get("next"));
  const cliCode = normalizeCliLoginCode(form.get("cliCode"));
  const registerUrl = createBrowserRedirectUrl(request, "/register");

  try {
    const result = await accountService.register({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      displayName: String(form.get("displayName") ?? "")
    });
    if (cliCode) {
      await cliDeviceLoginService.completeLogin({ code: cliCode, userId: result.user.id });
    }
    const response = NextResponse.redirect(createBrowserRedirectUrl(request, nextPath), 303);
    response.cookies.set(
      SESSION_COOKIE_NAME,
      await createSessionToken(result.user.id, getSessionSecret()),
      {
        httpOnly: true,
        maxAge: DEFAULT_SESSION_TTL_MS / 1000,
        path: "/",
        sameSite: "lax",
        secure: isSecureRequest(request)
      }
    );
    return response;
  } catch {
    registerUrl.searchParams.set("error", "1");
    if (nextPath !== "/") {
      registerUrl.searchParams.set("next", nextPath);
    }
    if (cliCode) {
      registerUrl.searchParams.set("cliCode", cliCode);
    }
    return NextResponse.redirect(registerUrl, 303);
  }
}
