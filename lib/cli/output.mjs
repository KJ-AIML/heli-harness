export function wantsJson(args = []) {
	return args.includes("--json");
}

export function stripOutputFlags(args = []) {
	return args.filter((arg) => arg !== "--json");
}

export function printProtocolResult(result) {
	process.stdout.write(`${JSON.stringify(result)}\n`);
}
