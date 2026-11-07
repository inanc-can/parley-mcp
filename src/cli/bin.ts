#!/usr/bin/env node
import { buildProgram } from "./index.js";

/**
 * The `mcp-parley` executable entry point. Packaging (the compiled bin path and
 * the package.json `bin` field) is finalised in M12; this file is the source of
 * truth for the program's startup.
 */
await buildProgram().parseAsync(process.argv);
