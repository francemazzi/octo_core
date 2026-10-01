import { serve } from "./protocol/serve.js";

serve().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "engine failed";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
