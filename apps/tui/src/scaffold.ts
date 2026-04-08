import { basename, resolve } from "node:path";
import { scaffold } from "@crustjs/create";

export async function bootstrapRalphWorkspace(
	projectDirectory: string,
): Promise<void> {
	const absoluteProjectDirectory = resolve(projectDirectory);
	const projectName = basename(absoluteProjectDirectory);

	await scaffold({
		template: new URL("../templates/ralph-workspace", import.meta.url),
		dest: resolve(absoluteProjectDirectory, ".ralph"),
		context: {
			projectName,
		},
	});
}
