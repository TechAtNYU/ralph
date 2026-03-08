import {
	cancelJob,
	getJob,
	health,
	isDaemonRunning,
	listJobs,
	submit,
} from "./daemon/client";

function usage(): void {
	process.stdout.write(
		[
			"Usage:",
			"  bun run daemon:ctl health",
			'  bun run daemon:ctl submit "your prompt"',
			"  bun run daemon:ctl list",
			"  bun run daemon:ctl get <job-id>",
			"  bun run daemon:ctl cancel <job-id>",
		].join("\n"),
	);
	process.stdout.write("\n");
}

async function run(): Promise<void> {
	const [command, ...args] = Bun.argv.slice(2);

	if (!command) {
		usage();
		process.exit(1);
	}

	if (command !== "health") {
		const running = await isDaemonRunning();
		if (!running) {
			throw new Error("ralphd is not running. Start it with: bun run daemon");
		}
	}

	switch (command) {
		case "health": {
			const status = await health();
			process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
			break;
		}
		case "submit": {
			const prompt = args.join(" ").trim();
			if (!prompt) {
				throw new Error("submit requires a prompt");
			}
			const result = await submit(prompt);
			process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
			break;
		}
		case "list": {
			const result = await listJobs();
			process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
			break;
		}
		case "get": {
			const jobId = args[0];
			if (!jobId) {
				throw new Error("get requires a job id");
			}
			const result = await getJob(jobId);
			process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
			break;
		}
		case "cancel": {
			const jobId = args[0];
			if (!jobId) {
				throw new Error("cancel requires a job id");
			}
			const result = await cancelJob(jobId);
			process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
			break;
		}
		default:
			usage();
			process.exit(1);
	}
}

run().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exit(1);
});
