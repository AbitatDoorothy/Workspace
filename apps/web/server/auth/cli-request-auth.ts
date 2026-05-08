import { cliDeviceLoginService } from "./cli-device-login-service";
import { getAccountContextForUserId } from "./request-session";

export async function getRequestCliAccountContext(request: Request) {
  const token = bearerToken(request);
  if (!token) {
    throw new Error("CLI authentication required");
  }

  const actor = await cliDeviceLoginService.verifyCliToken(token);
  if (!actor) {
    throw new Error("Invalid CLI token");
  }

  return getAccountContextForUserId(actor.userId);
}

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/iu.exec(header);
  return match?.[1]?.trim() || null;
}
