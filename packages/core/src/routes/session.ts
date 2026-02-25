import { Hono } from "hono";
import type { RalphCore } from "../ralph.js";
import { pathParam, queryInt, sendResult } from "./helpers.js";

export function sessionRoutes(core: RalphCore) {
	const app = new Hono();

	// ── Lifecycle ──────────────────────────────────────────────

	app.get("/session", async (c) => {
		const result = await core.session.list({
			directory: c.req.query("directory"),
			roots: c.req.query("roots") === "true" ? true : undefined,
			start: queryInt(c, "start"),
			search: c.req.query("search"),
			limit: queryInt(c, "limit"),
		});
		return sendResult(c, result);
	});

	app.post("/session", async (c) => {
		const body = await c.req.json();
		const result = await core.session.create({
			directory: c.req.query("directory"),
			parentID: body.parentID,
			title: body.title,
			permission: body.permission,
		});
		return sendResult(c, result);
	});

	app.get("/session/status", async (c) => {
		const result = await core.session.status({
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	app.get("/session/:sessionID", async (c) => {
		const result = await core.session.get({
			sessionID: pathParam(c, "sessionID"),
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	app.patch("/session/:sessionID", async (c) => {
		const body = await c.req.json();
		const result = await core.session.update({
			sessionID: pathParam(c, "sessionID"),
			directory: c.req.query("directory"),
			title: body.title,
			time: body.time,
		});
		return sendResult(c, result);
	});

	app.delete("/session/:sessionID", async (c) => {
		const result = await core.session.delete({
			sessionID: pathParam(c, "sessionID"),
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	app.get("/session/:sessionID/children", async (c) => {
		const result = await core.session.children({
			sessionID: pathParam(c, "sessionID"),
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	app.post("/session/:sessionID/fork", async (c) => {
		const body = await c.req.json();
		const result = await core.session.fork({
			sessionID: pathParam(c, "sessionID"),
			directory: c.req.query("directory"),
			messageID: body.messageID,
		});
		return sendResult(c, result);
	});

	// ── Messaging ──────────────────────────────────────────────

	app.post("/session/:sessionID/message", async (c) => {
		const body = await c.req.json();
		const result = await core.session.prompt({
			sessionID: pathParam(c, "sessionID"),
			directory: c.req.query("directory"),
			messageID: body.messageID,
			model: body.model,
			agent: body.agent,
			noReply: body.noReply,
			tools: body.tools,
			format: body.format,
			system: body.system,
			variant: body.variant,
			parts: body.parts,
		});
		return sendResult(c, result);
	});

	app.post("/session/:sessionID/prompt_async", async (c) => {
		const body = await c.req.json();
		const result = await core.session.promptAsync({
			sessionID: pathParam(c, "sessionID"),
			directory: c.req.query("directory"),
			messageID: body.messageID,
			model: body.model,
			agent: body.agent,
			noReply: body.noReply,
			tools: body.tools,
			format: body.format,
			system: body.system,
			variant: body.variant,
			parts: body.parts,
		});
		return sendResult(c, result);
	});

	app.get("/session/:sessionID/message", async (c) => {
		const result = await core.session.messages({
			sessionID: pathParam(c, "sessionID"),
			directory: c.req.query("directory"),
			limit: queryInt(c, "limit"),
		});
		return sendResult(c, result);
	});

	app.get("/session/:sessionID/message/:messageID", async (c) => {
		const result = await core.session.message({
			sessionID: pathParam(c, "sessionID"),
			messageID: pathParam(c, "messageID"),
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	// ── Commands ───────────────────────────────────────────────

	app.post("/session/:sessionID/command", async (c) => {
		const body = await c.req.json();
		const result = await core.session.command({
			sessionID: pathParam(c, "sessionID"),
			directory: c.req.query("directory"),
			messageID: body.messageID,
			agent: body.agent,
			model: body.model,
			arguments: body.arguments,
			command: body.command,
			variant: body.variant,
			parts: body.parts,
		});
		return sendResult(c, result);
	});

	app.post("/session/:sessionID/shell", async (c) => {
		const body = await c.req.json();
		const result = await core.session.shell({
			sessionID: pathParam(c, "sessionID"),
			directory: c.req.query("directory"),
			agent: body.agent,
			model: body.model,
			command: body.command,
		});
		return sendResult(c, result);
	});

	// ── Control ────────────────────────────────────────────────

	app.post("/session/:sessionID/abort", async (c) => {
		const result = await core.session.abort({
			sessionID: pathParam(c, "sessionID"),
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	app.post("/session/:sessionID/revert", async (c) => {
		const body = await c.req.json();
		const result = await core.session.revert({
			sessionID: pathParam(c, "sessionID"),
			directory: c.req.query("directory"),
			messageID: body.messageID,
			partID: body.partID,
		});
		return sendResult(c, result);
	});

	app.post("/session/:sessionID/unrevert", async (c) => {
		const result = await core.session.unrevert({
			sessionID: pathParam(c, "sessionID"),
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	// ── Analysis ───────────────────────────────────────────────

	app.get("/session/:sessionID/todo", async (c) => {
		const result = await core.session.todo({
			sessionID: pathParam(c, "sessionID"),
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	app.get("/session/:sessionID/diff", async (c) => {
		const result = await core.session.diff({
			sessionID: pathParam(c, "sessionID"),
			directory: c.req.query("directory"),
			messageID: c.req.query("messageID"),
		});
		return sendResult(c, result);
	});

	app.post("/session/:sessionID/summarize", async (c) => {
		const body = await c.req.json();
		const result = await core.session.summarize({
			sessionID: pathParam(c, "sessionID"),
			directory: c.req.query("directory"),
			providerID: body.providerID,
			modelID: body.modelID,
			auto: body.auto,
		});
		return sendResult(c, result);
	});

	app.post("/session/:sessionID/init", async (c) => {
		const body = await c.req.json();
		const result = await core.session.init({
			sessionID: pathParam(c, "sessionID"),
			directory: c.req.query("directory"),
			modelID: body.modelID,
			providerID: body.providerID,
			messageID: body.messageID,
		});
		return sendResult(c, result);
	});

	// ── Sharing ────────────────────────────────────────────────

	app.post("/session/:sessionID/share", async (c) => {
		const result = await core.session.share({
			sessionID: pathParam(c, "sessionID"),
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	app.delete("/session/:sessionID/share", async (c) => {
		const result = await core.session.unshare({
			sessionID: pathParam(c, "sessionID"),
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	return app;
}
