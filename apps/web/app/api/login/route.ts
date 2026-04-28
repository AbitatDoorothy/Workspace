import { NextResponse } from "next/server";

import {
  DEFAULT_SESSION_TTL_MS,
  SESSION_COOKIE_NAME,
  createPublicRedirectUrl,
  createSessionToken,
  getLoginPassword,
  getSessionSecret,
  isSecureRequest,
  sanitizeRedirectPath,
  verifyLoginPassword
} from "../../../server/auth/session";

export async function POST(request: Request) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const nextPath = sanitizeRedirectPath(form.get("next"));
  const loginUrl = createPublicRedirectUrl(request, "/login");

  if (!verifyLoginPassword(password, getLoginPassword())) {
    loginUrl.searchParams.set("error", "1");
    if (nextPath !== "/") {
      loginUrl.searchParams.set("next", nextPath);
    }
    return NextResponse.redirect(loginUrl, 303);
  }

  const response = NextResponse.redirect(createPublicRedirectUrl(request, nextPath), 303);
  response.cookies.set(SESSION_COOKIE_NAME, await createSessionToken(getSessionSecret()), {
    httpOnly: true,
    maxAge: DEFAULT_SESSION_TTL_MS / 1000,
    path: "/",
    sameSite: "lax",
    secure: isSecureRequest(request)
  });
  return response;
}
