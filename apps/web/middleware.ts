import { NextResponse, type NextRequest } from "next/server";

import {
  SESSION_COOKIE_NAME,
  createBrowserRedirectUrl,
  getSessionSecret,
  verifySessionToken
} from "./server/auth/session";

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/login",
  "/register",
  "/api/register",
  "/api/logout",
  "/api/health",
  "/api/cli/device-login/start",
  "/api/cli/device-login/poll"
]);
const HOST_API_PATHS = new Set([
  "/api/hosts/register",
  "/api/hosts/pair",
  "/api/hosts/heartbeat",
  "/api/hosts/tools",
  "/api/hosts/codex/snapshot",
  "/api/daemon/jobs/poll"
]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isHostedMobileControlRequest(pathname)) {
    return NextResponse.json(
      {
        error:
          "Hosted mobile control has been retired. Run abitat iphone on the Mac and pair the iPhone with the QR/manual payload from that local command."
      },
      { status: 410 }
    );
  }

  if (isPublicRequest(request)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (await verifySessionToken(token, getSessionSecret())) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const loginUrl = createBrowserRedirectUrl(request, "/login");
  loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

function isPublicRequest(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasBearerToken = request.headers.get("authorization")?.startsWith("Bearer ");

  return (
    PUBLIC_PATHS.has(pathname) ||
    HOST_API_PATHS.has(pathname) ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname.match(/\.[a-z0-9]+$/iu) !== null ||
    (request.method === "POST" &&
      hasBearerToken &&
      /^\/api\/conversations\/[^/]+\/(?:events|changeset)$/u.test(pathname)) ||
    (request.method === "POST" &&
      hasBearerToken &&
      /^\/api\/daemon\/jobs\/[^/]+\/ack$/u.test(pathname))
  );
}

function isHostedMobileControlRequest(pathname: string) {
  return pathname.startsWith("/api/mobile/") || pathname.startsWith("/api/remote-control/");
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"]
};
