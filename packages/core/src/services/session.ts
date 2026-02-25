import type {
	AgentPartInput,
	AssistantMessage,
	FileDiff,
	FilePartInput,
	FilePartSource,
	Message,
	OpencodeClient,
	OutputFormat,
	Part,
	PermissionRuleset,
	Session,
	SessionStatus,
	SubtaskPartInput,
	TextPartInput,
	Todo,
} from "@opencode-ai/sdk/v2";
import { wrapSdkCall } from "../errors.js";
import type { RalphResult } from "../types.js";

type MessageWithParts = { info: Message; parts: Array<Part> };
type AssistantWithParts = { info: AssistantMessage; parts: Array<Part> };

export class SessionService {
	constructor(private client: OpencodeClient) {}

	// ── Lifecycle ──────────────────────────────────────────────

	async list(params?: {
		directory?: string;
		roots?: boolean;
		start?: number;
		search?: string;
		limit?: number;
	}): Promise<RalphResult<Array<Session>>> {
		return wrapSdkCall(() => this.client.session.list(params));
	}

	async create(params?: {
		directory?: string;
		parentID?: string;
		title?: string;
		permission?: PermissionRuleset;
	}): Promise<RalphResult<Session>> {
		return wrapSdkCall(() => this.client.session.create(params));
	}

	async get(params: {
		sessionID: string;
		directory?: string;
	}): Promise<RalphResult<Session>> {
		return wrapSdkCall(() => this.client.session.get(params));
	}

	async update(params: {
		sessionID: string;
		directory?: string;
		title?: string;
		time?: { archived?: number };
	}): Promise<RalphResult<Session>> {
		return wrapSdkCall(() => this.client.session.update(params));
	}

	async delete(params: {
		sessionID: string;
		directory?: string;
	}): Promise<RalphResult<boolean>> {
		return wrapSdkCall(() => this.client.session.delete(params));
	}

	async status(params?: {
		directory?: string;
	}): Promise<RalphResult<{ [key: string]: SessionStatus }>> {
		return wrapSdkCall(() => this.client.session.status(params));
	}

	async children(params: {
		sessionID: string;
		directory?: string;
	}): Promise<RalphResult<Array<Session>>> {
		return wrapSdkCall(() => this.client.session.children(params));
	}

	async fork(params: {
		sessionID: string;
		directory?: string;
		messageID?: string;
	}): Promise<RalphResult<Session>> {
		return wrapSdkCall(() => this.client.session.fork(params));
	}

	// ── Messaging ──────────────────────────────────────────────

	async prompt(params: {
		sessionID: string;
		directory?: string;
		messageID?: string;
		model?: { providerID: string; modelID: string };
		agent?: string;
		noReply?: boolean;
		tools?: { [key: string]: boolean };
		format?: OutputFormat;
		system?: string;
		variant?: string;
		parts?: Array<
			TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput
		>;
	}): Promise<RalphResult<AssistantWithParts>> {
		return wrapSdkCall(() => this.client.session.prompt(params));
	}

	async promptAsync(params: {
		sessionID: string;
		directory?: string;
		messageID?: string;
		model?: { providerID: string; modelID: string };
		agent?: string;
		noReply?: boolean;
		tools?: { [key: string]: boolean };
		format?: OutputFormat;
		system?: string;
		variant?: string;
		parts?: Array<
			TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput
		>;
	}): Promise<RalphResult<void>> {
		return wrapSdkCall(() => this.client.session.promptAsync(params));
	}

	async messages(params: {
		sessionID: string;
		directory?: string;
		limit?: number;
	}): Promise<RalphResult<Array<MessageWithParts>>> {
		return wrapSdkCall(() => this.client.session.messages(params));
	}

	async message(params: {
		sessionID: string;
		messageID: string;
		directory?: string;
	}): Promise<RalphResult<MessageWithParts>> {
		return wrapSdkCall(() => this.client.session.message(params));
	}

	// ── Commands ───────────────────────────────────────────────

	async command(params: {
		sessionID: string;
		directory?: string;
		messageID?: string;
		agent?: string;
		model?: string;
		arguments?: string;
		command?: string;
		variant?: string;
		parts?: Array<{
			id?: string;
			type: "file";
			mime: string;
			filename?: string;
			url: string;
			source?: FilePartSource;
		}>;
	}): Promise<RalphResult<AssistantWithParts>> {
		return wrapSdkCall(() => this.client.session.command(params));
	}

	async shell(params: {
		sessionID: string;
		directory?: string;
		agent?: string;
		model?: { providerID: string; modelID: string };
		command?: string;
	}): Promise<RalphResult<AssistantMessage>> {
		return wrapSdkCall(() => this.client.session.shell(params));
	}

	// ── Control ────────────────────────────────────────────────

	async abort(params: {
		sessionID: string;
		directory?: string;
	}): Promise<RalphResult<boolean>> {
		return wrapSdkCall(() => this.client.session.abort(params));
	}

	async revert(params: {
		sessionID: string;
		directory?: string;
		messageID?: string;
		partID?: string;
	}): Promise<RalphResult<Session>> {
		return wrapSdkCall(() => this.client.session.revert(params));
	}

	async unrevert(params: {
		sessionID: string;
		directory?: string;
	}): Promise<RalphResult<Session>> {
		return wrapSdkCall(() => this.client.session.unrevert(params));
	}

	// ── Analysis ───────────────────────────────────────────────

	async todo(params: {
		sessionID: string;
		directory?: string;
	}): Promise<RalphResult<Array<Todo>>> {
		return wrapSdkCall(() => this.client.session.todo(params));
	}

	async diff(params: {
		sessionID: string;
		directory?: string;
		messageID?: string;
	}): Promise<RalphResult<Array<FileDiff>>> {
		return wrapSdkCall(() => this.client.session.diff(params));
	}

	async summarize(params: {
		sessionID: string;
		directory?: string;
		providerID?: string;
		modelID?: string;
		auto?: boolean;
	}): Promise<RalphResult<boolean>> {
		return wrapSdkCall(() => this.client.session.summarize(params));
	}

	async init(params: {
		sessionID: string;
		directory?: string;
		modelID?: string;
		providerID?: string;
		messageID?: string;
	}): Promise<RalphResult<boolean>> {
		return wrapSdkCall(() => this.client.session.init(params));
	}

	// ── Sharing ────────────────────────────────────────────────

	async share(params: {
		sessionID: string;
		directory?: string;
	}): Promise<RalphResult<Session>> {
		return wrapSdkCall(() => this.client.session.share(params));
	}

	async unshare(params: {
		sessionID: string;
		directory?: string;
	}): Promise<RalphResult<Session>> {
		return wrapSdkCall(() => this.client.session.unshare(params));
	}
}
