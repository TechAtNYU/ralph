import { Hono } from "hono";
import type { RalphCore } from "../ralph.js";
import { pathParam, sendResult } from "./helpers.js";

export function questionRoutes(core: RalphCore) {
	const app = new Hono();

	app.get("/question", async (c) => {
		const result = await core.question.list({
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	app.post("/question/:requestID/reply", async (c) => {
		const body = await c.req.json();
		const result = await core.question.reply({
			requestID: pathParam(c, "requestID"),
			directory: c.req.query("directory"),
			answers: body.answers,
		});
		return sendResult(c, result);
	});

	app.post("/question/:requestID/reject", async (c) => {
		const result = await core.question.reject({
			requestID: pathParam(c, "requestID"),
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	return app;
}
