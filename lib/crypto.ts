import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env";

// AES-256-GCM for the per-user OpenRouter keys we store. KEY_ENCRYPTION_KEY is
// 32 random bytes, base64 encoded (`openssl rand -base64 32`).

function key(): Buffer {
  const k = Buffer.from(env("KEY_ENCRYPTION_KEY"), "base64");
  if (k.length !== 32) throw new Error("KEY_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return k;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
