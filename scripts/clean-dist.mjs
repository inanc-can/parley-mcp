// Start every build from an empty dist/, so a release never ships stale files.
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

rmSync(join(dirname(fileURLToPath(import.meta.url)), "..", "dist"), { recursive: true, force: true });
