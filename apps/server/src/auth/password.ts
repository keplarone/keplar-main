import { type Algorithm, hash, verify } from "@node-rs/argon2";

// Algorithm is an ambient const enum; 2 is Algorithm.Argon2id.
const ARGON2ID = 2 as Algorithm;

// OWASP Password Storage Cheat Sheet baseline for Argon2id: m=19 MiB, t=2, p=1.
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Verified against when the account does not exist so response timing does not reveal registered emails.
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword("keplar-timing-equalizer-not-a-real-password");
  return dummyHash;
}
