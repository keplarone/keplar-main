// Read lazily so `next build` and tests do not need every secret present.
export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}
