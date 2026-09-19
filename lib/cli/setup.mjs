import { ensureGlobalSetup, readWorkspaceRegistry } from "../concurrency/project-binding.mjs";
import { wantsJson, stripOutputFlags, printProtocolResult } from "./output.mjs";
import { protocolOk } from "../protocol/result.mjs";
import { ensureDefaultUserPolicy, userPolicyPath } from "../concurrency/policy-composition.mjs";

export function setupHeli({ env = process.env } = {}) {
	const setup = ensureGlobalSetup(env);
	ensureDefaultUserPolicy(env);
	return {
		configDir: setup.configDir,
		dataDir: setup.dataDir,
		machineId: setup.machine.machineId,
		registryPath: setup.registryPath,
		registryEntries: readWorkspaceRegistry(env).workspaces.length,
		userPolicyPath: userPolicyPath(env),
	};
}

export function runSetup(args = []) {
	const json = wantsJson(args);
	const result = setupHeli();
	if (json) {
		printProtocolResult(protocolOk("setup", result));
		return result;
	}
	console.log("Heli global environment ready.");
	console.log(`  config: ${result.configDir}`);
	console.log(`  data: ${result.dataDir}`);
	console.log(`  machine: ${result.machineId}`);
	console.log(`  registry: ${result.registryPath} (locator only, not authority)`);
	console.log(`  trusted user policy: ${result.userPolicyPath}`);
	console.log("Next: cd <project> && heli link");
	return result;
}
