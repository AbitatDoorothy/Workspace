import { phonePairingStartRequestSchema } from "@abitat/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createBrowserRedirectUrl, sanitizeRedirectPath } from "../../../../../server/auth/session";
import { mobileService } from "../../../../../server/mobile";

const requestSchema = phonePairingStartRequestSchema.extend({
  createdByUserId: z.string().min(1).default("user_demo"),
  redirectTo: z.string().min(1).optional()
});

export async function POST(request: Request) {
  try {
    const isFormRequest = request.headers
      .get("content-type")
      ?.includes("application/x-www-form-urlencoded");
    const input = requestSchema.parse(await parseRequest(request));
    const pairing = await mobileService.createPhonePairing(input);

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
