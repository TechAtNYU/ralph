import { Hono } from "hono";
import type { RalphCore } from "../ralph.js";
import { queryInt, sendResult } from "./helpers.js";

export function findRoutes(core: RalphCore) {
	const app = new Hono();

	app.get("/find", async (c) => {
		const result = await core.find.text({
			pattern: c.req.query("pattern") ?? "",
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	app.get("/find/file", async (c) => {
		const result = await core.find.files({
			query: c.req.query("query") ?? "",
			directory: c.req.query("directory"),
			dirs: c.req.query("dirs") as "true" | "false" | undefined,
			type: c.req.query("type") as "file" | "directory" | undefined,
			limit: queryInt(c, "limit"),
		});
		return sendResult(c, result);
	});

	app.get("/find/symbol", async (c) => {
		const result = await core.find.symbols({
			query: c.req.query("query") ?? "",
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	return app;
}
