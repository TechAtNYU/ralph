import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";

import {
	DEFAULT_DAEMON_MAX_CONCURRENCY,
	resolveDaemonLauncherEnv,
	resolveDaemonPaths,
	resolveDaemonRuntimeEnv,
} from "../env";

describe("env", () => {
	test("resolves daemon paths from defaults", () => {
		const env = resolveDaemonPaths({});
		const ralphHome = join(homedir(), ".ralph");

		expect(env).toEqual({
			ralphHome,
			socketPath: join(ralphHome, "ralphd.sock"),
			statePath: join(ralphHome, "state.json"),
		});
	});

	test("trims configured home and launcher overrides", () => {
		expect(
			resolveDaemonPaths({
				RALPH_HOME: "  /tmp/ralph  ",
			}),
		).toEqual({
			ralphHome: "/tmp/ralph",
			socketPath: "/tmp/ralph/ralphd.sock",
			statePath: "/tmp/ralph/state.json",
		});

		expect(
			resolveDaemonLauncherEnv({
				RALPHD_BIN: "  /tmp/custom-ralphd  ",
			}),
		).toEqual({
			daemonBinOverride: "/tmp/custom-ralphd",
		});
	});

	test("uses the default max concurrency when unset", () => {
		expect(resolveDaemonRuntimeEnv({}).maxConcurrency).toBe(
			DEFAULT_DAEMON_MAX_CONCURRENCY,
		);
	});

	test("rejects invalid max concurrency values", () => {
		expect(() =>
			resolveDaemonRuntimeEnv({
				RALPHD_MAX_CONCURRENCY: "0",
			}),
		).toThrow("RALPHD_MAX_CONCURRENCY must be a positive integer");
	});
});
