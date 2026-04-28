import { hostService } from ".";

export async function requireHostToken(request: Request, machineId?: string) {
  const token = getBearerToken(request);
  const isValid = machineId
    ? await hostService.verifyHostToken(machineId, token)
    : await hostService.verifyAnyHostToken(token);

  if (!isValid) {
    throw new Error("Invalid host token");
  }

  return token;
}

export function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
}
