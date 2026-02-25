import { Hono } from "hono";
import { cors } from "hono/cors";
import { RalphCore } from "./ralph.js";
import { appRoutes } from "./routes/app.js";
import { authRoutes } from "./routes/auth.js";
import { commandRoutes } from "./routes/command.js";
import { configRoutes } from "./routes/config.js";
import { eventRoutes } from "./routes/event.js";
import { fileRoutes } from "./routes/file.js";
import { findRoutes } from "./routes/find.js";
import { healthRoutes } from "./routes/health.js";
import { pathRoutes } from "./routes/path.js";
import { permissionRoutes } from "./routes/permission.js";
import { projectRoutes } from "./routes/project.js";
import { providerRoutes } from "./routes/provider.js";
import { questionRoutes } from "./routes/question.js";
import { sessionRoutes } from "./routes/session.js";
import { vcsRoutes } from "./routes/vcs.js";
import type { ServerOptions } from "./types.js";

export async function startServer(options?: ServerOptions) {
	const core = await RalphCore.create(options);

	const app = new Hono();
	app.use("*", cors());
	app.route("/", appRoutes(core));
	app.route("/", authRoutes(core));
	app.route("/", commandRoutes(core));
	app.route("/", configRoutes(core));
	app.route("/", eventRoutes(core));
	app.route("/", fileRoutes(core));
	app.route("/", findRoutes(core));
	app.route("/", healthRoutes(core));
	app.route("/", pathRoutes(core));
	app.route("/", permissionRoutes(core));
	app.route("/", projectRoutes(core));
	app.route("/", providerRoutes(core));
	app.route("/", questionRoutes(core));
	app.route("/", sessionRoutes(core));
	app.route("/", vcsRoutes(core));

	const httpPort = options?.httpPort ?? 3000;

	const server = Bun.serve({
		port: httpPort,
		fetch: app.fetch,
	});

	console.log(`Ralph server listening on http://localhost:${server.port}`);

	return {
		core,
		close() {
			server.stop();
			core.dispose();
		},
	};
}

// When run directly: start the server
const isMainModule =
	typeof Bun !== "undefined" && Bun.main === import.meta.path;

if (isMainModule) {
	startServer();
}
