import { basename, resolve } from "node:path";
import type { ManagedInstance } from "@techatnyu/ralphd";
import { daemon } from "@techatnyu/ralphd";

type InstanceClient = {
	listInstances(): Promise<{ instances: ManagedInstance[] }>;
	createInstance(input: {
		name: string;
		directory: string;
		maxConcurrency?: number;
	}): Promise<{ instance: ManagedInstance }>;
};

function instanceNameForDirectory(directory: string): string {
	return basename(directory) || directory;
}

async function findInstanceByDirectory(
	client: InstanceClient,
	directory: string,
): Promise<ManagedInstance | undefined> {
	const result = await client.listInstances();
	return result.instances.find(
		(instance) => resolve(instance.directory) === directory,
	);
}

export async function ensureDirectoryInstance(
	directory = process.cwd(),
	client: InstanceClient = daemon,
): Promise<ManagedInstance> {
	const normalizedDirectory = resolve(directory);
	const existing = await findInstanceByDirectory(client, normalizedDirectory);
	if (existing) {
		return existing;
	}

	try {
		const created = await client.createInstance({
			name: instanceNameForDirectory(normalizedDirectory),
			directory: normalizedDirectory,
		});
		return created.instance;
	} catch (error) {
		const code = (error as { code?: string } | undefined)?.code;
		if (code !== "conflict") {
			throw error;
		}

		const raced = await findInstanceByDirectory(client, normalizedDirectory);
		if (raced) {
			return raced;
		}
		throw error;
	}
}
