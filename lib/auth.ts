import { importSPKI, jwtVerify } from "jose";
import { env, optionalEnv } from "./env";

// Whop apps run inside an iframe on whop.com; Whop forwards each request with
// an `x-whop-user-token` JWT identifying the signed-in user. We verify it with
// Whop's published ES256 public key (WHOP_USER_TOKEN_PUBLIC_KEY, PEM).
// If this app is moved off Whop, replace this with your own session lookup.

let publicKey: Promise<CryptoKey> | undefined;

export class Unauthorized extends Error {}

export async function requireUserId(request: Request): Promise<string> {
  const token = request.headers.get("x-whop-user-token");
  if (!token) throw new Unauthorized("Missing x-whop-user-token");

  publicKey ??= importSPKI(env("WHOP_USER_TOKEN_PUBLIC_KEY").replace(/\\n/g, "\n"), "ES256");
  try {
    const { payload } = await jwtVerify(token, await publicKey, {
      issuer: "urn:whopcom:exp-proxy",
      audience: optionalEnv("WHOP_APP_ID"),
    });
    if (!payload.sub) throw new Unauthorized("Token has no subject");
    return payload.sub;
  } catch (err) {
    if (err instanceof Unauthorized) throw err;
    throw new Unauthorized("Invalid user token");
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof Unauthorized) return Response.json({ error: err.message }, { status: 401 });
  console.error(err);
  return Response.json({ error: "Internal error" }, { status: 500 });
}
