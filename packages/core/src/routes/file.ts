import { Hono } from "hono";
import type { RalphCore } from "../ralph.js";
import { sendResult } from "./helpers.js";

export function fileRoutes(core: RalphCore) {
	const app = new Hono();

	app.get("/file", async (c) => {
		const result = await core.file.list({
			path: c.req.query("path") ?? "",
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	app.get("/file/content", async (c) => {
		const result = await core.file.read({
			path: c.req.query("path") ?? "",
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	app.get("/file/status", async (c) => {
		const result = await core.file.status({
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	return app;
}
