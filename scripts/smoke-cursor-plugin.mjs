import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCurrentVersion } from "./lib/release-version.mjs";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const marketplaceRoot = join(root, ".heli-harness", "adapters", "cursor-plugin");
const marketplace = JSON.parse(readFileSync(join(marketplaceRoot, ".cursor-plugin", "marketplace.json"), "utf8"));
const pluginRoot = join(marketplaceRoot, "plugins", "heli-harness");
const manifest = JSON.parse(readFileSync(join(pluginRoot, ".cursor-plugin", "plugin.json"), "utf8"));

const required = [
	".cursor-plugin/marketplace.json",
	"plugins/heli-harness/.cursor-plugin/plugin.json",
	"plugins/heli-harness/rules/harness.mdc",
	"plugins/heli-harness/skills/heli-governance/SKILL.md",
	"plugins/heli-harness/skills/heli-install/SKILL.md",
	"plugins/heli-harness/skills/heli-target/SKILL.md"
];

for (const relativePath of required) {
	if (!existsSync(join(marketplaceRoot, relativePath))) throw new Error(`Missing Cursor marketplace file: ${relativePath}`);
}

if (manifest.name !== "heli-harness") throw new Error("Cursor plugin name must be heli-harness");
assertCurrentVersion(root, manifest.version, "Cursor plugin");
assertCurrentVersion(root, marketplace.metadata?.version, "Cursor marketplace");
assertCurrentVersion(root, marketplace.plugins?.[0]?.version, "Cursor marketplace entry");
if (marketplace.metadata?.pluginRoot !== "plugins") throw new Error("Cursor marketplace pluginRoot is invalid");
if (marketplace.plugins?.[0]?.source !== "heli-harness") throw new Error("Cursor marketplace source is invalid");

console.log("Cursor marketplace smoke passed: marketplace, plugin manifest, rule, and skills are valid.");
