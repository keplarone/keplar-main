import { WhopClient } from "@whop/sdk";
import { env } from "./env";

let client: WhopClient | undefined;

export function whop(): WhopClient {
  client ??= new WhopClient({ token: env("WHOP_API_KEY") });
  return client;
}
