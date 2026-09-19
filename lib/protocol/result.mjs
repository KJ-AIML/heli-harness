import { HELI_PROTOCOL_VERSION } from "./version.mjs";

function asArray(value) {
	if (Array.isArray(value)) return value;
	if (value == null) return [];
	return [value];
}

export function protocolOk(command, data, { warnings = [] } = {}) {
	return {
		protocolVersion: HELI_PROTOCOL_VERSION,
		command: String(command || ""),
		ok: true,
		data: data ?? null,
		warnings: asArray(warnings),
		errors: [],
	};
}

export function protocolError(
	command,
	code,
	message,
	{ details = null, warnings = [] } = {},
) {
	const error = {
		code: String(code || "UNKNOWN_ERROR"),
		message: String(message || ""),
	};
	if (details != null) error.details = details;

	return {
		protocolVersion: HELI_PROTOCOL_VERSION,
		command: String(command || ""),
		ok: false,
		data: null,
		warnings: asArray(warnings),
		errors: [error],
	};
}
