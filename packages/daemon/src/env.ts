import { homedir } from "node:os";
import { join } from "node:path";

export const RALPH_HOME = process.env.RALPH_HOME?.trim()
	? process.env.RALPH_HOME
	: join(homedir(), ".ralph");

export const SOCKET_PATH = join(RALPH_HOME, "ralphd.sock");
export const STATE_PATH = join(RALPH_HOME, "state.json");
