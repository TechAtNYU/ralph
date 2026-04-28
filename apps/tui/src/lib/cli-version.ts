async function readPackageVersion(packageJsonUrl: URL): Promise<string> {
	const packageJson = (await Bun.file(packageJsonUrl).json()) as {
		version?: string;
	};
	return packageJson.version ?? "0.0.0";
}

export async function resolveCliVersion(packageJsonUrl: URL): Promise<string> {
	return (
		process.env.PUBLIC_RALPH_VERSION ??
		process.env.RALPH_VERSION ??
		(await readPackageVersion(packageJsonUrl))
	);
}
