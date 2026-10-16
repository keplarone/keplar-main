import { checklistCompose, docCompose } from "./compose.js";
import type { CapabilityHandlers } from "./types.js";
import { webFetch } from "./web-fetch.js";

export const DEFAULT_HANDLERS: CapabilityHandlers = {
  "web.fetch": webFetch,
  "doc.compose": docCompose,
  "checklist.compose": checklistCompose,
};
