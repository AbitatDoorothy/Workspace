import { NextResponse } from "next/server";

import {
  SESSION_COOKIE_NAME,
  createBrowserRedirectUrl,
  isSecureRequest
} from "../../../server/auth/session";

export async function POST(request: Request) {
  const response = NextResponse.redirect(createBrowserRedirectUrl(request, "/login"), 303);
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: isSecureRequest(request)
  });
  return response;
}
