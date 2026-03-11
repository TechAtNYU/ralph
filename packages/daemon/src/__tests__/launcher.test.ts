import { describe, expect, test } from "bun:test";

import {
	resolveDaemonLaunchSpec,
	resolveSiblingDaemonPath,
} from "../launcher";

describe("launcher", () => {
	test("uses RALPHD_BIN when provided", () => {
		const launch = resolveDaemonLaunchSpec({
			env: { RALPHD_BIN: "/tmp/custom-ralphd" },
			execPath: "/usr/local/bin/ralph",
		});
		expect(launch.mode).toBe("override");
		expect(launch.command).toBe("/tmp/custom-ralphd");
		expect(launch.args).toEqual([]);
	});

	test("resolves a sibling packaged binary", () => {
		expect(resolveSiblingDaemonPath("/opt/ralph/bin/ralph")).toBe(
			"/opt/ralph/bin/ralphd",
		);
		expect(resolveSiblingDaemonPath("C:\\Ralph\\ralph.exe")).toBe(
			"C:\\Ralph\\ralphd.exe",
		);
	});

	test("falls back to bun run in source mode", () => {
		const launch = resolveDaemonLaunchSpec({
			execPath: "/usr/local/bin/bun",
			sourceDir: "/repo/packages/daemon/src",
			env: {},
		});
		expect(launch.mode).toBe("source");
		expect(launch.command).toBe("/usr/local/bin/bun");
		expect(launch.args).toEqual([
			"run",
			"/repo/packages/daemon/src/bin/ralphd.ts",
		]);
	});
});
