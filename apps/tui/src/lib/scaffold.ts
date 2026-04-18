import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { scaffold } from "@crustjs/create";
import { resolveDaemonPaths } from "@techatnyu/ralphd";

export interface SessionScaffoldOptions {
	instanceId: string;
	sessionId: string;
	ralphHome?: string;
}

function assertValidSegment(value: string, label: string): void {
	if (!value.trim()) {
		throw new Error(`${label} is required`);
	}

	if (value.includes("/") || value.includes("\\")) {
		throw new Error(`${label} must not contain path separators`);
	}
}

export function resolveSessionScaffoldPath(
	options: SessionScaffoldOptions,
): string {
	assertValidSegment(options.instanceId, "instanceId");
	assertValidSegment(options.sessionId, "sessionId");

	const ralphHome =
		options.ralphHome ?? resolveDaemonPaths(process.env).ralphHome;

	return join(ralphHome, "sessions", options.instanceId, options.sessionId);
}

export async function bootstrapSessionScaffold(
	options: SessionScaffoldOptions,
): Promise<string> {
	const sessionPath = resolveSessionScaffoldPath(options);

	await mkdir(sessionPath, { recursive: true });

	await scaffold({
		template: new URL("../templates/ralph-workspace", import.meta.url),
		dest: sessionPath,
		context: {
			instanceId: options.instanceId,
			sessionId: options.sessionId,
		},
	});

	return sessionPath;
}
