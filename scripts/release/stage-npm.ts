import {
	DEFAULT_COMPILED_DIR,
	DEFAULT_STAGE_DIR,
	parseTargets,
	readFlagValue,
	stageDistribution,
} from "./shared";

const argv = process.argv.slice(2);

await stageDistribution({
	targets: parseTargets(argv),
	compiledDir: readFlagValue(argv, "--compiled-dir") ?? DEFAULT_COMPILED_DIR,
	stageDir: readFlagValue(argv, "--stage-dir") ?? DEFAULT_STAGE_DIR,
	version: readFlagValue(argv, "--version"),
});
