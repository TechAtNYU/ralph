import { z } from "zod";

export { SOCKET_PATH } from "./env";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const IsoDateTime = z.iso.datetime();

const JobState = z.enum([
	"queued",
	"running",
	"succeeded",
	"failed",
	"cancelled",
]);
export type JobState = z.infer<typeof JobState>;

const InstanceStatus = z.enum(["stopped", "starting", "running", "error"]);
export type InstanceStatus = z.infer<typeof InstanceStatus>;

// ---------------------------------------------------------------------------
// Domain models — core entities referenced by requests and responses
// ---------------------------------------------------------------------------

/** Which provider + model a job task should target. */
const ModelRef = z
	.strictObject({
		providerId: z.string().min(1),
		modelId: z.string().min(1),
	})
	.meta({ description: "Model selection for a job task" });
export type ModelRef = z.infer<typeof ModelRef>;

/** The unit of work inside a job (currently only "prompt"). */
const JobTask = z.discriminatedUnion("type", [
	z.strictObject({
		type: z.literal("prompt"),
		prompt: z.string().min(1),
		agent: z.string().min(1).optional(),
		model: ModelRef.optional(),
		system: z.string().min(1).optional(),
		variant: z.string().min(1).optional(),
	}),
]);
export type JobTask = z.infer<typeof JobTask>;

const PermissionRule = z.strictObject({
	permission: z.string().min(1),
	pattern: z.string().min(1),
	action: z.enum(["allow", "deny", "ask"]),
});
export type PermissionRule = z.infer<typeof PermissionRule>;

/** Whether the job starts a new conversation or continues an existing one. */
const JobSession = z.discriminatedUnion("type", [
	z.strictObject({
		type: z.literal("new"),
		title: z.string().min(1).optional(),
		permission: z.array(PermissionRule).optional(),
	}),
	z.strictObject({
		type: z.literal("existing"),
		sessionId: z.string().min(1),
	}),
]);
export type JobSession = z.infer<typeof JobSession>;

/** A registered Claude Code instance the daemon manages. */
const ManagedInstance = z.strictObject({
	id: z.string().min(1),
	name: z.string().min(1),
	directory: z.string().min(1),
	status: InstanceStatus,
	maxConcurrency: z.int().positive(),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	lastError: z.string().min(1).optional(),
});
export type ManagedInstance = z.infer<typeof ManagedInstance>;

/** A job that has been submitted to the daemon for execution. */
export const DaemonJob = z.strictObject({
	id: z.string().min(1),
	instanceId: z.string().min(1),
	sessionId: z.string().min(1).optional(),
	task: JobTask,
	state: JobState,
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	startedAt: IsoDateTime.optional(),
	endedAt: IsoDateTime.optional(),
	error: z.string().min(1).optional(),
	outputText: z.string().optional(),
	messageId: z.string().min(1).optional(),
});
export type DaemonJob = z.infer<typeof DaemonJob>;

/** A conversation session belonging to an instance (id is the remote OpenCode session id). */
export const DaemonSession = z.strictObject({
	id: z.string().min(1),
	instanceId: z.string().min(1),
	title: z.string().min(1),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
});
export type DaemonSession = z.infer<typeof DaemonSession>;

// ---------------------------------------------------------------------------
// Request params — per-method input payloads
// ---------------------------------------------------------------------------

// Instance operations

const InstanceCreateParams = z.strictObject({
	name: z.string().min(1),
	directory: z.string().min(1),
	maxConcurrency: z.int().positive().optional(),
});
export type InstanceCreateParams = z.infer<typeof InstanceCreateParams>;

const InstanceListParams = z.strictObject({});
export type InstanceListParams = z.infer<typeof InstanceListParams>;

const InstanceGetParams = z.strictObject({
	instanceId: z.string().min(1),
});
export type InstanceGetParams = z.infer<typeof InstanceGetParams>;

const InstanceStartParams = z.strictObject({
	instanceId: z.string().min(1),
});
export type InstanceStartParams = z.infer<typeof InstanceStartParams>;

const InstanceStopParams = z.strictObject({
	instanceId: z.string().min(1),
});
export type InstanceStopParams = z.infer<typeof InstanceStopParams>;

const InstanceRemoveParams = z.strictObject({
	instanceId: z.string().min(1),
});
export type InstanceRemoveParams = z.infer<typeof InstanceRemoveParams>;

// Provider operations

const ProviderListParams = z.strictObject({
	directory: z.string().min(1).optional(),
	/** When true, dispose the cached OpenCode instance before querying so
	 *  provider data (including newly-connected credentials) is re-read. */
	refresh: z.boolean().optional(),
});
export type ProviderListParams = z.infer<typeof ProviderListParams>;

// Session operations

const SessionListParams = z.strictObject({
	instanceId: z.string().min(1),
});
export type SessionListParams = z.infer<typeof SessionListParams>;

const SessionGetParams = z.strictObject({
	sessionId: z.string().min(1),
});
export type SessionGetParams = z.infer<typeof SessionGetParams>;

// Job operations

const JobSubmitParams = z.strictObject({
	instanceId: z.string().min(1),
	session: JobSession,
	task: JobTask,
});
export type JobSubmitParams = z.infer<typeof JobSubmitParams>;

const JobListParams = z.strictObject({
	instanceId: z.string().min(1).optional(),
	sessionId: z.string().min(1).optional(),
	state: JobState.optional(),
});
export type JobListParams = z.infer<typeof JobListParams>;

const JobGetParams = z.strictObject({
	jobId: z.string().min(1),
});
export type JobGetParams = z.infer<typeof JobGetParams>;

const JobCancelParams = z.strictObject({
	jobId: z.string().min(1),
});
export type JobCancelParams = z.infer<typeof JobCancelParams>;

const JobStreamParams = z.strictObject({
	jobId: z.string().min(1),
});
export type JobStreamParams = z.infer<typeof JobStreamParams>;

const QuestionAnswer = z.array(z.string().min(1));
export type QuestionAnswer = z.infer<typeof QuestionAnswer>;

const QuestionReplyParams = z.strictObject({
	instanceId: z.string().min(1),
	requestId: z.string().min(1),
	answers: z.array(QuestionAnswer),
});
export type QuestionReplyParams = z.infer<typeof QuestionReplyParams>;

// ---------------------------------------------------------------------------
// Result schemas — per-method response payloads (success path)
// ---------------------------------------------------------------------------

// Daemon-level results

const InstanceHealth = z.strictObject({
	instanceId: z.string().min(1),
	name: z.string().min(1),
	status: InstanceStatus,
	running: z.int().nonnegative(),
	queued: z.int().nonnegative(),
	finished: z.int().nonnegative(),
	lastError: z.string().min(1).optional(),
});
export type InstanceHealth = z.infer<typeof InstanceHealth>;

const HealthResult = z.strictObject({
	pid: z.int().nonnegative(),
	uptimeSeconds: z.int().nonnegative(),
	queued: z.int().nonnegative(),
	running: z.int().nonnegative(),
	finished: z.int().nonnegative(),
	instances: z.array(InstanceHealth),
});
export type HealthResult = z.infer<typeof HealthResult>;

const ShutdownResult = z.strictObject({
	ok: z.literal(true),
});
export type ShutdownResult = z.infer<typeof ShutdownResult>;

// Instance results

const InstanceResult = z.strictObject({
	instance: ManagedInstance,
});
export type InstanceResult = z.infer<typeof InstanceResult>;

const InstanceListResult = z.strictObject({
	instances: z.array(ManagedInstance),
});
export type InstanceListResult = z.infer<typeof InstanceListResult>;

// Session results

const SessionListResult = z.strictObject({
	sessions: z.array(DaemonSession),
});
export type SessionListResult = z.infer<typeof SessionListResult>;

const SessionGetResult = z.strictObject({
	session: DaemonSession,
});
export type SessionGetResult = z.infer<typeof SessionGetResult>;

// Job results

const SubmitResult = z.strictObject({
	job: DaemonJob,
});
export type SubmitResult = z.infer<typeof SubmitResult>;

const ListResult = z.strictObject({
	jobs: z.array(DaemonJob),
});
export type ListResult = z.infer<typeof ListResult>;

const GetResult = z.strictObject({
	job: DaemonJob,
});
export type GetResult = z.infer<typeof GetResult>;

const CancelResult = z.strictObject({
	job: DaemonJob,
});
export type CancelResult = z.infer<typeof CancelResult>;

const StreamAckResult = z.strictObject({
	jobId: z.string().min(1),
});
export type StreamAckResult = z.infer<typeof StreamAckResult>;

const QuestionReplyResult = z.strictObject({
	ok: z.literal(true),
});
export type QuestionReplyResult = z.infer<typeof QuestionReplyResult>;

// ---------------------------------------------------------------------------
// Job stream events — pushed over an open socket after the stream ack
// ---------------------------------------------------------------------------

const JobStreamSnapshot = z.strictObject({
	type: z.literal("snapshot"),
	jobId: z.string().min(1),
	text: z.string(),
});

const JobStreamDelta = z.strictObject({
	type: z.literal("delta"),
	jobId: z.string().min(1),
	field: z.string().min(1),
	delta: z.string(),
});

const JobStreamDone = z.strictObject({
	type: z.literal("done"),
	jobId: z.string().min(1),
	job: DaemonJob,
});

const JobStreamError = z.strictObject({
	type: z.literal("error"),
	jobId: z.string().min(1),
	error: z.string().min(1),
});

const QuestionOption = z.strictObject({
	label: z.string().min(1),
	description: z.string(),
});
export type QuestionOption = z.infer<typeof QuestionOption>;

const QuestionInfo = z.strictObject({
	question: z.string().min(1),
	header: z.string().min(1),
	options: z.array(QuestionOption),
	multiple: z.boolean().optional(),
	custom: z.boolean().optional(),
});
export type QuestionInfo = z.infer<typeof QuestionInfo>;

const JobStreamQuestion = z.strictObject({
	type: z.literal("question"),
	jobId: z.string().min(1),
	requestId: z.string().min(1),
	sessionId: z.string().min(1),
	questions: z.array(QuestionInfo),
});

export const JobStreamEvent = z.discriminatedUnion("type", [
	JobStreamSnapshot,
	JobStreamDelta,
	JobStreamQuestion,
	JobStreamDone,
	JobStreamError,
]);
export type JobStreamEvent = z.infer<typeof JobStreamEvent>;
// Provider results

const ProviderModel = z.strictObject({
	id: z.string().min(1),
	name: z.string().min(1),
	family: z.string().optional(),
	attachment: z.boolean().optional(),
	reasoning: z.boolean().optional(),
	tool_call: z.boolean().optional(),
});

const ProviderEntry = z.strictObject({
	id: z.string().min(1),
	name: z.string().min(1),
	models: z.record(z.string(), ProviderModel),
});

const ProviderListResult = z.strictObject({
	providers: z.array(ProviderEntry),
	connected: z.array(z.string()),
});
export type ProviderListResult = z.infer<typeof ProviderListResult>;

// ---------------------------------------------------------------------------
// Error schema
// ---------------------------------------------------------------------------

export const ResponseError = z.strictObject({
	code: z.enum([
		"invalid_json",
		"invalid_request",
		"not_found",
		"conflict",
		"instance_unavailable",
		"shutdown",
		"internal",
	]),
	message: z.string().min(1),
	issues: z
		.array(
			z.strictObject({
				path: z.string(),
				message: z.string().min(1),
				code: z.string().min(1),
			}),
		)
		.optional(),
});
export type ResponseError = z.infer<typeof ResponseError>;

// ---------------------------------------------------------------------------
// Request messages — each pairs a method literal with its params schema
// ---------------------------------------------------------------------------

const RequestMethod = z.enum([
	"daemon.health",
	"daemon.shutdown",
	"instance.create",
	"instance.list",
	"instance.get",
	"instance.start",
	"instance.stop",
	"instance.remove",
	"provider.list",
	"session.list",
	"session.get",
	"job.submit",
	"job.list",
	"job.get",
	"job.cancel",
	"job.stream",
	"job.submit_and_stream",
	"question.reply",
]);
export type RequestMethod = z.infer<typeof RequestMethod>;

// Daemon requests

const DaemonHealthRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("daemon.health"),
	params: z.strictObject({}),
});

const DaemonShutdownRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("daemon.shutdown"),
	params: z.strictObject({}),
});

// Instance requests

const InstanceCreateRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.create"),
	params: InstanceCreateParams,
});

const InstanceListRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.list"),
	params: InstanceListParams,
});

const InstanceGetRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.get"),
	params: InstanceGetParams,
});

const InstanceStartRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.start"),
	params: InstanceStartParams,
});

const InstanceStopRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.stop"),
	params: InstanceStopParams,
});

const InstanceRemoveRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.remove"),
	params: InstanceRemoveParams,
});

// Provider requests

const ProviderListRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("provider.list"),
	params: ProviderListParams,
});

// Session requests

const SessionListRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("session.list"),
	params: SessionListParams,
});

const SessionGetRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("session.get"),
	params: SessionGetParams,
});

// Job requests

const JobSubmitRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("job.submit"),
	params: JobSubmitParams,
});

const JobListRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("job.list"),
	params: JobListParams,
});

const JobGetRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("job.get"),
	params: JobGetParams,
});

const JobCancelRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("job.cancel"),
	params: JobCancelParams,
});

const JobStreamRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("job.stream"),
	params: JobStreamParams,
});

const JobSubmitAndStreamRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("job.submit_and_stream"),
	params: JobSubmitParams,
});

const QuestionReplyRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("question.reply"),
	params: QuestionReplyParams,
});

/** Union of every valid request the daemon accepts. */
export const RequestMessage = z.discriminatedUnion("method", [
	DaemonHealthRequest,
	DaemonShutdownRequest,
	InstanceCreateRequest,
	InstanceListRequest,
	InstanceGetRequest,
	InstanceStartRequest,
	InstanceStopRequest,
	InstanceRemoveRequest,
	ProviderListRequest,
	SessionListRequest,
	SessionGetRequest,
	JobSubmitRequest,
	JobListRequest,
	JobGetRequest,
	JobCancelRequest,
	JobStreamRequest,
	JobSubmitAndStreamRequest,
	QuestionReplyRequest,
]);
export type RequestMessage = z.infer<typeof RequestMessage>;

// ---------------------------------------------------------------------------
// Success responses — each pairs a method literal with its result schema
// ---------------------------------------------------------------------------

// Daemon successes

const DaemonHealthSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("daemon.health"),
	ok: z.literal(true),
	result: HealthResult,
});

const DaemonShutdownSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("daemon.shutdown"),
	ok: z.literal(true),
	result: ShutdownResult,
});

// Instance successes

const InstanceCreateSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.create"),
	ok: z.literal(true),
	result: InstanceResult,
});

const InstanceListSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.list"),
	ok: z.literal(true),
	result: InstanceListResult,
});

const InstanceGetSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.get"),
	ok: z.literal(true),
	result: InstanceResult,
});

const InstanceStartSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.start"),
	ok: z.literal(true),
	result: InstanceResult,
});

const InstanceStopSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.stop"),
	ok: z.literal(true),
	result: InstanceResult,
});

const InstanceRemoveSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.remove"),
	ok: z.literal(true),
	result: InstanceResult,
});

// Provider successes

const ProviderListSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("provider.list"),
	ok: z.literal(true),
	result: ProviderListResult,
});

// Session successes

const SessionListSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("session.list"),
	ok: z.literal(true),
	result: SessionListResult,
});

const SessionGetSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("session.get"),
	ok: z.literal(true),
	result: SessionGetResult,
});

// Job successes

const JobSubmitSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("job.submit"),
	ok: z.literal(true),
	result: SubmitResult,
});

const JobListSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("job.list"),
	ok: z.literal(true),
	result: ListResult,
});

const JobGetSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("job.get"),
	ok: z.literal(true),
	result: GetResult,
});

const JobCancelSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("job.cancel"),
	ok: z.literal(true),
	result: CancelResult,
});

const JobStreamSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("job.stream"),
	ok: z.literal(true),
	result: StreamAckResult,
});

const JobSubmitAndStreamSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("job.submit_and_stream"),
	ok: z.literal(true),
	result: SubmitResult,
});

const QuestionReplySuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("question.reply"),
	ok: z.literal(true),
	result: QuestionReplyResult,
});

// Error response

const ErrorResponse = z.strictObject({
	id: z.string().min(1),
	method: z.union([RequestMethod, z.literal("unknown")]),
	ok: z.literal(false),
	error: ResponseError,
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

/** Union of every possible response (success for each method + error). */
export const ResponseMessage = z.union([
	DaemonHealthSuccess,
	DaemonShutdownSuccess,
	InstanceCreateSuccess,
	InstanceListSuccess,
	InstanceGetSuccess,
	InstanceStartSuccess,
	InstanceStopSuccess,
	InstanceRemoveSuccess,
	ProviderListSuccess,
	SessionListSuccess,
	SessionGetSuccess,
	JobSubmitSuccess,
	JobListSuccess,
	JobGetSuccess,
	JobCancelSuccess,
	JobStreamSuccess,
	JobSubmitAndStreamSuccess,
	QuestionReplySuccess,
	ErrorResponse,
]);
export type ResponseMessage = z.infer<typeof ResponseMessage>;

// ---------------------------------------------------------------------------
// Utility types — type-level helpers for method-based dispatch
// ---------------------------------------------------------------------------

export type RequestByMethod<M extends RequestMethod> = Extract<
	RequestMessage,
	{ method: M }
>;
export type SuccessByMethod<M extends RequestMethod> = Extract<
	ResponseMessage,
	{ method: M; ok: true }
>;
export type ParamsByMethod<M extends RequestMethod> =
	RequestByMethod<M>["params"];
export type ResultByMethod<M extends RequestMethod> =
	SuccessByMethod<M>["result"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function normalizeIssues(error: z.ZodError): ResponseError["issues"] {
	return error.issues.map((issue: z.ZodIssue) => ({
		path: issue.path.join("."),
		message: issue.message,
		code: issue.code,
	}));
}
