import { Crust } from "@crustjs/core";
import { helpPlugin, versionPlugin } from "@crustjs/plugins";
import { runDaemonServer } from "./server";

async function readPackageVersion(): Promise<string> {
	if (process.env.PUBLIC_RALPH_VERSION || process.env.RALPH_VERSION) {
		return (
			process.env.PUBLIC_RALPH_VERSION ?? process.env.RALPH_VERSION ?? "0.0.0"
		);
	}

	const packageJson = (await Bun.file(
		new URL("../../../apps/tui/package.json", import.meta.url),
	).json()) as {
		version?: string;
	};

	return packageJson.version ?? "0.0.0";
}

const cliVersion = await readPackageVersion();

export function createDaemonCli() {
	return new Crust("ralphd")
		.meta({ description: "Ralph background daemon" })
		.use(versionPlugin(cliVersion))
		.use(helpPlugin())
		.run(async () => {
			await runDaemonServer();
		})
		.command("serve", (cmd) =>
			cmd
				.meta({ description: "Run the daemon in the foreground" })
				.run(async () => {
					await runDaemonServer();
				}),
		);
}

export const app = createDaemonCli();

export default app;
