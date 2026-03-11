import {
	buildBinaries,
	DEFAULT_COMPILED_DIR,
	getCurrentTarget,
	hasFlag,
	parseTargets,
	readFlagValue,
} from "./shared";

const argv = process.argv.slice(2);
const outDir = readFlagValue(argv, "--outdir") ?? DEFAULT_COMPILED_DIR;
const targets = hasFlag(argv, "--current")
	? [getCurrentTarget()]
	: (parseTargets(argv) ?? undefined);

await buildBinaries({
	outDir,
	targets,
});
