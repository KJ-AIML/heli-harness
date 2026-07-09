#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const shared = join(here, "..", "..", "shared", "claude-style-pre-tool-use.mjs");
await import(pathToFileURL(shared).href);
