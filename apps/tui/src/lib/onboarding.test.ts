import { describe, expect, test } from "bun:test";
import type { CommandRunner } from "./onboarding";
import { runOnboardingChecks } from "./onboarding";

const healthyDaemon = {
	isDaemonRunning: async () => true,
	health: async () => ({
		pid: 123,
		uptimeSeconds: 5,
		queued: 0,
		running: 0,
		finished: 0,
		instances: [],
	}),
};

function createCommandRunner(
	responses: Record<
		string,
		{ exitCode: number; stdout: string; stderr: string }
	>,
): CommandRunner {
	return async (command, args) => {
		const key = `${command} ${args.join(" ")}`;
		const response = responses[key];
		if (!response) {
			throw new Error(`unexpected command: ${key}`);
		}
		return response;
	};
}

describe("runOnboardingChecks", () => {
	test("reports success when opencode and daemon are ready", async () => {
		const result = await runOnboardingChecks({
			commandRunner: createCommandRunner({
				"opencode --version": { exitCode: 0, stdout: "1.0.0", stderr: "" },
				"opencode auth list": { exitCode: 0, stdout: "anthropic", stderr: "" },
			}),
			daemonClient: healthyDaemon,
			ensureDaemon: async () => true,
		});

		expect(result.ok).toBe(true);
		expect(result.checks.every((check) => check.ok)).toBe(true);
	});

	test("doctor mode does not try to autostart the daemon", async () => {
		let autostarted = false;
		const result = await runOnboardingChecks({
			autoStartDaemon: false,
			commandRunner: createCommandRunner({
				"opencode --version": { exitCode: 0, stdout: "1.0.0", stderr: "" },
				"opencode auth list": { exitCode: 0, stdout: "anthropic", stderr: "" },
			}),
			daemonClient: {
				isDaemonRunning: async () => false,
				health: healthyDaemon.health,
			},
			ensureDaemon: async () => {
				autostarted = true;
				return true;
			},
		});

		expect(autostarted).toBe(false);
		expect(result.ok).toBe(false);
		expect(
			result.checks.find((check) => check.label === "Daemon running")?.ok,
		).toBe(false);
	});

	test("setup mode tries to autostart the daemon", async () => {
		let autostarted = false;
		const result = await runOnboardingChecks({
			autoStartDaemon: true,
			commandRunner: createCommandRunner({
				"opencode --version": { exitCode: 0, stdout: "1.0.0", stderr: "" },
				"opencode auth list": { exitCode: 0, stdout: "anthropic", stderr: "" },
			}),
			daemonClient: {
				isDaemonRunning: async () => false,
				health: healthyDaemon.health,
			},
			ensureDaemon: async () => {
				autostarted = true;
				return false;
			},
		});

		expect(autostarted).toBe(true);
		expect(result.ok).toBe(false);
	});

	test("marks auth as missing when opencode auth output is empty", async () => {
		const result = await runOnboardingChecks({
			commandRunner: createCommandRunner({
				"opencode --version": { exitCode: 0, stdout: "1.0.0", stderr: "" },
				"opencode auth list": { exitCode: 0, stdout: "", stderr: "" },
			}),
			daemonClient: healthyDaemon,
			ensureDaemon: async () => true,
		});

		expect(result.ok).toBe(false);
		expect(
			result.checks.find((check) => check.label === "OpenCode authenticated")
				?.message,
		).toContain("opencode auth login");
	});
});
