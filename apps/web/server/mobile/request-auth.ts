import { mobileService } from ".";
import { getBearerToken } from "../hosts/request-auth";

export async function requireMobileActor(request: Request) {
  const token = getBearerToken(request);

  if (!token) {
    throw new Error("Invalid mobile token");
  }

  return mobileService.requireMobileActor(token);
}
