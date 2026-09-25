import "server-only";

import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidSessionValue } from "@/lib/admin/token";

/**
 * Whether the current request carries this deployment's admin session.
 *
 * The cookie is httpOnly and holds only a hash of the configured token, so
 * this check is a constant-time comparison of hashes — the token itself never
 * leaves the server.
 */
export async function isAdminAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return isValidSessionValue(store.get(ADMIN_COOKIE)?.value);
}
