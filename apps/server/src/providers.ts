import type { AppConfig } from "./config.js";
import { AnthropicProvider } from "./models/anthropic.js";
import type { ModelProvider } from "./models/types.js";

/** Only providers with configured credentials are constructed; nothing assumes access it does not have. */
export function configuredProviders(config: AppConfig): ModelProvider[] {
  const providers: ModelProvider[] = [];
  if (config.ANTHROPIC_API_KEY) providers.push(new AnthropicProvider(config.ANTHROPIC_API_KEY));
  return providers;
}

export function jsonLogger(component: string) {
  return (level: "info" | "warn" | "error", msg: string, fields: Record<string, unknown> = {}) => {
    const line = JSON.stringify({ time: new Date().toISOString(), level, component, msg, ...fields });
    (level === "error" ? console.error : console.log)(line);
  };
}
