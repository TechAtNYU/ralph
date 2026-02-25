import {
	createOpencode,
	createOpencodeClient,
	type OpencodeClient,
} from "@opencode-ai/sdk/v2";
import { AppService } from "./services/app.js";
import { AuthService } from "./services/auth.js";
import { CommandService } from "./services/command.js";
import { ConfigService } from "./services/config.js";
import { EventService } from "./services/event.js";
import { FileService } from "./services/file.js";
import { FindService } from "./services/find.js";
import { HealthService } from "./services/health.js";
import { PathService } from "./services/path.js";
import { PermissionService } from "./services/permission.js";
import { ProjectService } from "./services/project.js";
import { ProviderService } from "./services/provider.js";
import { QuestionService } from "./services/question.js";
import { SessionService } from "./services/session.js";
import { VcsService } from "./services/vcs.js";
import type { RalphOptions } from "./types.js";

export class RalphCore {
	private _app?: AppService;
	private _auth?: AuthService;
	private _command?: CommandService;
	private _config?: ConfigService;
	private _event?: EventService;
	private _file?: FileService;
	private _find?: FindService;
	private _health?: HealthService;
	private _path?: PathService;
	private _permission?: PermissionService;
	private _project?: ProjectService;
	private _provider?: ProviderService;
	private _question?: QuestionService;
	private _session?: SessionService;
	private _vcs?: VcsService;

	private constructor(
		private client: OpencodeClient,
		private serverClose?: () => void,
	) {}

	get app(): AppService {
		this._app ??= new AppService(this.client);
		return this._app;
	}

	get auth(): AuthService {
		this._auth ??= new AuthService(this.client);
		return this._auth;
	}

	get command(): CommandService {
		this._command ??= new CommandService(this.client);
		return this._command;
	}

	get config(): ConfigService {
		this._config ??= new ConfigService(this.client);
		return this._config;
	}

	get event(): EventService {
		this._event ??= new EventService(this.client);
		return this._event;
	}

	get file(): FileService {
		this._file ??= new FileService(this.client);
		return this._file;
	}

	get find(): FindService {
		this._find ??= new FindService(this.client);
		return this._find;
	}

	get health(): HealthService {
		this._health ??= new HealthService(this.client);
		return this._health;
	}

	get path(): PathService {
		this._path ??= new PathService(this.client);
		return this._path;
	}

	get permission(): PermissionService {
		this._permission ??= new PermissionService(this.client);
		return this._permission;
	}

	get project(): ProjectService {
		this._project ??= new ProjectService(this.client);
		return this._project;
	}

	get provider(): ProviderService {
		this._provider ??= new ProviderService(this.client);
		return this._provider;
	}

	get question(): QuestionService {
		this._question ??= new QuestionService(this.client);
		return this._question;
	}

	get session(): SessionService {
		this._session ??= new SessionService(this.client);
		return this._session;
	}

	get vcs(): VcsService {
		this._vcs ??= new VcsService(this.client);
		return this._vcs;
	}

	/**
	 * Create a RalphCore instance.
	 * - "spawn" mode (default): starts a new OpenCode server as a child process
	 * - "connect" mode: connects to an existing OpenCode server at baseUrl
	 */
	static async create(options?: RalphOptions): Promise<RalphCore> {
		const mode = options?.mode ?? "spawn";

		if (mode === "connect") {
			const baseUrl = options?.baseUrl;
			if (!baseUrl) {
				throw new Error("baseUrl is required in connect mode");
			}
			const client = createOpencodeClient({ baseUrl });
			return new RalphCore(client);
		}

		const serverOpts: Record<string, unknown> = {
			port: options?.port ?? 4096,
		};
		if (options?.hostname) serverOpts.hostname = options.hostname;
		if (options?.timeout) serverOpts.timeout = options.timeout;
		if (options?.signal) serverOpts.signal = options.signal;
		if (options?.config) serverOpts.config = options.config;

		const { client, server } = await createOpencode(serverOpts);

		return new RalphCore(client, () => server.close());
	}

	async dispose(): Promise<void> {
		await this.client.instance.dispose();
		this.serverClose?.();
	}
}
