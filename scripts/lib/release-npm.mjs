// Pure resolver for how the release script should invoke `npm run check`.
//
// Spawning "npm.cmd" directly EINVALs on current Node (CVE-2024-27980 hardening),
// so when npm hands us a JS entry point via npm_execpath we run it with the
// running node binary instead — no shell, fully portable. When npm_execpath is
// absent (release invoked outside `npm run`) or points at a native launcher
// (.cmd/.exe), fall back to the platform npm name.
//
// Kept pure — no process access — so scripts/smoke-release-npm.mjs can prove the
// decision matrix without running a real release.

/**
 * @param {{ npmExecpath?: string | undefined, platform: string, execPath: string }} env
 * @returns {{ command: string, args: string[] }}
 */
export function resolveNpmCheckInvocation({ npmExecpath, platform, execPath }) {
	if (npmExecpath && !npmExecpath.endsWith(".cmd") && !npmExecpath.endsWith(".exe")) {
		return { command: execPath, args: [npmExecpath, "run", "check"] };
	}
	return { command: platform === "win32" ? "npm.cmd" : "npm", args: ["run", "check"] };
}
