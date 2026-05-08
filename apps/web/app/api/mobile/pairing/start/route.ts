import { phonePairingStartRequestSchema } from "@abitat_reece/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getRequestAccountContext } from "../../../../../server/auth/request-session";
import { createBrowserRedirectUrl, sanitizeRedirectPath } from "../../../../../server/auth/session";
import { mobileService } from "../../../../../server/mobile";
import { mobileActivityLog } from "../../../../../server/mobile/mobile-activity-log";

const requestSchema = phonePairingStartRequestSchema.partial().extend({
  redirectTo: z.string().min(1).optional()
});

export async function POST(request: Request) {
  try {
    const isFormRequest = request.headers
      .get("content-type")
      ?.includes("application/x-www-form-urlencoded");
    const input = requestSchema.parse(await parseRequest(request));
    const account = await getRequestAccountContext(request);
    const pairing = await mobileService.createPhonePairing({
      workspaceId: account.workspaceId,
      hostMachineId: account.hostMachineId,
      createdByUserId: account.userId
    });
    mobileActivityLog.record("mobile_pairing_started", {
      hostMachineId: account.hostMachineId,
      pairingId: pairing.pairingId,
      workspaceId: account.workspaceId
    });

    if (isFormRequest) {
      return NextResponse.redirect(
        createBrowserRedirectUrl(
          request,
          createPhonePairingRedirectPath(input.redirectTo ?? "/#pair-iphone", pairing)
        ),
        303
      );
    }

    return NextResponse.json(pairing, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to start phone pairing" },
      { status: 400 }
    );
  }
}

export function createPhonePairingRedirectPath(
  redirectTo: string,
  pairing: { code: string; expiresAt: string; qrPayload: string }
) {
  const safeRedirect = sanitizeRedirectPath(redirectTo);
  const url = new URL(safeRedirect, "http://abitat.local");

  url.searchParams.set("iphonePairingCode", pairing.code);
  url.searchParams.set("iphonePairingExpiresAt", pairing.expiresAt);
  url.searchParams.set("iphonePairingQrPayload", pairing.qrPayload);

  return `${url.pathname}${url.search}${url.hash}`;
}

async function parseRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(await request.formData());
  }

  return request.json();
}
