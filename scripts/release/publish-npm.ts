import {
	DEFAULT_STAGE_DIR,
	hasFlag,
	publishDistribution,
	readFlagValue,
} from "./shared";

const argv = process.argv.slice(2);

await publishDistribution({
	stageDir: readFlagValue(argv, "--stage-dir") ?? DEFAULT_STAGE_DIR,
	dryRun: hasFlag(argv, "--dry-run"),
	tag: readFlagValue(argv, "--tag"),
	access: readFlagValue(argv, "--access"),
	registry: readFlagValue(argv, "--registry"),
	verify: !hasFlag(argv, "--no-verify"),
});
