export function normalizeCliLoginCode(value: FormDataEntryValue | string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

export function createCliAuthSwitchHref(
  path: "/login" | "/register",
  nextPath: string,
  code: string
) {
  const params = new URLSearchParams();
  if (nextPath !== "/") {
    params.set("next", nextPath);
  }
  if (code) {
    params.set("cliCode", code);
  }

  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
