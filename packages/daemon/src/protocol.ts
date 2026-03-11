import { z } from "zod";

export { SOCKET_PATH } from "./env";

const IsoDateTime = z.iso.datetime();

export const JobState = z.enum([
	"queued",
	"running",
	"succeeded",
	"failed",
	"cancelled",
]);
export type JobState = z.infer<typeof JobState>;

export const InstanceStatus = z.enum([
	"stopped",
	"starting",
	"running",
	"error",
]);
export type InstanceStatus = z.infer<typeof InstanceStatus>;

export const ModelRef = z
	.strictObject({
		providerId: z.string().min(1),
		modelId: z.string().min(1),
	})
	.meta({ description: "Model selection for a job task" });
export type ModelRef = z.infer<typeof ModelRef>;

export const JobTask = z.discriminatedUnion("type", [
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

export const JobSession = z.discriminatedUnion("type", [
	z.strictObject({
		type: z.literal("new"),
		title: z.string().min(1).optional(),
	}),
	z.strictObject({
		type: z.literal("existing"),
		sessionId: z.string().min(1),
	}),
]);
export type JobSession = z.infer<typeof JobSession>;

export const ManagedInstance = z.strictObject({
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

export const DaemonJob = z.strictObject({
	id: z.string().min(1),
	instanceId: z.string().min(1),
	sessionId: z.string().min(1).optional(),
	session: JobSession,
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

export const InstanceHealth = z.strictObject({
	instanceId: z.string().min(1),
	name: z.string().min(1),
	status: InstanceStatus,
	running: z.int().nonnegative(),
	queued: z.int().nonnegative(),
	finished: z.int().nonnegative(),
	lastError: z.string().min(1).optional(),
});
export type InstanceHealth = z.infer<typeof InstanceHealth>;

export const HealthResult = z.strictObject({
	pid: z.int().nonnegative(),
	uptimeSeconds: z.int().nonnegative(),
	queued: z.int().nonnegative(),
	running: z.int().nonnegative(),
	finished: z.int().nonnegative(),
	instances: z.array(InstanceHealth),
});
export type HealthResult = z.infer<typeof HealthResult>;

export const ShutdownResult = z.strictObject({
	ok: z.literal(true),
});
export type ShutdownResult = z.infer<typeof ShutdownResult>;

export const InstanceCreateParams = z.strictObject({
	name: z.string().min(1),
	directory: z.string().min(1),
	maxConcurrency: z.int().positive().optional(),
});
export type InstanceCreateParams = z.infer<typeof InstanceCreateParams>;

export const InstanceListParams = z.strictObject({});
export type InstanceListParams = z.infer<typeof InstanceListParams>;

export const InstanceGetParams = z.strictObject({
	instanceId: z.string().min(1),
});
export type InstanceGetParams = z.infer<typeof InstanceGetParams>;

export const InstanceStartParams = z.strictObject({
	instanceId: z.string().min(1),
});
export type InstanceStartParams = z.infer<typeof InstanceStartParams>;

export const InstanceStopParams = z.strictObject({
	instanceId: z.string().min(1),
});
export type InstanceStopParams = z.infer<typeof InstanceStopParams>;

export const InstanceRemoveParams = z.strictObject({
	instanceId: z.string().min(1),
});
export type InstanceRemoveParams = z.infer<typeof InstanceRemoveParams>;

export const JobSubmitParams = z.strictObject({
	instanceId: z.string().min(1),
	session: JobSession,
	task: JobTask,
});
export type JobSubmitParams = z.infer<typeof JobSubmitParams>;

export const JobListParams = z.strictObject({
	instanceId: z.string().min(1).optional(),
	state: JobState.optional(),
});
export type JobListParams = z.infer<typeof JobListParams>;

export const JobGetParams = z.strictObject({
	jobId: z.string().min(1),
});
export type JobGetParams = z.infer<typeof JobGetParams>;

export const JobCancelParams = z.strictObject({
	jobId: z.string().min(1),
});
export type JobCancelParams = z.infer<typeof JobCancelParams>;

export const InstanceResult = z.strictObject({
	instance: ManagedInstance,
});
export type InstanceResult = z.infer<typeof InstanceResult>;

export const InstanceListResult = z.strictObject({
	instances: z.array(ManagedInstance),
});
export type InstanceListResult = z.infer<typeof InstanceListResult>;

export const SubmitResult = z.strictObject({
	job: DaemonJob,
});
export type SubmitResult = z.infer<typeof SubmitResult>;

export const ListResult = z.strictObject({
	jobs: z.array(DaemonJob),
});
export type ListResult = z.infer<typeof ListResult>;

export const GetResult = z.strictObject({
	job: DaemonJob,
});
export type GetResult = z.infer<typeof GetResult>;

export const CancelResult = z.strictObject({
	job: DaemonJob,
});
export type CancelResult = z.infer<typeof CancelResult>;

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

export const RequestMethod = z.enum([
	"daemon.health",
	"daemon.shutdown",
	"instance.create",
	"instance.list",
	"instance.get",
	"instance.start",
	"instance.stop",
	"instance.remove",
	"job.submit",
	"job.list",
	"job.get",
	"job.cancel",
]);
export type RequestMethod = z.infer<typeof RequestMethod>;

export const DaemonHealthRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("daemon.health"),
	params: z.strictObject({}),
});
export type DaemonHealthRequest = z.infer<typeof DaemonHealthRequest>;

export const DaemonShutdownRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("daemon.shutdown"),
	params: z.strictObject({}),
});
export type DaemonShutdownRequest = z.infer<typeof DaemonShutdownRequest>;

export const InstanceCreateRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.create"),
	params: InstanceCreateParams,
});
export type InstanceCreateRequest = z.infer<typeof InstanceCreateRequest>;

export const InstanceListRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.list"),
	params: InstanceListParams,
});
export type InstanceListRequest = z.infer<typeof InstanceListRequest>;

export const InstanceGetRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.get"),
	params: InstanceGetParams,
});
export type InstanceGetRequest = z.infer<typeof InstanceGetRequest>;

export const InstanceStartRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.start"),
	params: InstanceStartParams,
});
export type InstanceStartRequest = z.infer<typeof InstanceStartRequest>;

export const InstanceStopRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.stop"),
	params: InstanceStopParams,
});
export type InstanceStopRequest = z.infer<typeof InstanceStopRequest>;

export const InstanceRemoveRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.remove"),
	params: InstanceRemoveParams,
});
export type InstanceRemoveRequest = z.infer<typeof InstanceRemoveRequest>;

export const JobSubmitRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("job.submit"),
	params: JobSubmitParams,
});
export type JobSubmitRequest = z.infer<typeof JobSubmitRequest>;

export const JobListRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("job.list"),
	params: JobListParams,
});
export type JobListRequest = z.infer<typeof JobListRequest>;

export const JobGetRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("job.get"),
	params: JobGetParams,
});
export type JobGetRequest = z.infer<typeof JobGetRequest>;

export const JobCancelRequest = z.strictObject({
	id: z.string().min(1),
	method: z.literal("job.cancel"),
	params: JobCancelParams,
});
export type JobCancelRequest = z.infer<typeof JobCancelRequest>;

export const RequestMessage = z.discriminatedUnion("method", [
	DaemonHealthRequest,
	DaemonShutdownRequest,
	InstanceCreateRequest,
	InstanceListRequest,
	InstanceGetRequest,
	InstanceStartRequest,
	InstanceStopRequest,
	InstanceRemoveRequest,
	JobSubmitRequest,
	JobListRequest,
	JobGetRequest,
	JobCancelRequest,
]);
export type RequestMessage = z.infer<typeof RequestMessage>;

export const DaemonHealthSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("daemon.health"),
	ok: z.literal(true),
	result: HealthResult,
});
export type DaemonHealthSuccess = z.infer<typeof DaemonHealthSuccess>;

export const DaemonShutdownSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("daemon.shutdown"),
	ok: z.literal(true),
	result: ShutdownResult,
});
export type DaemonShutdownSuccess = z.infer<typeof DaemonShutdownSuccess>;

export const InstanceCreateSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.create"),
	ok: z.literal(true),
	result: InstanceResult,
});
export type InstanceCreateSuccess = z.infer<typeof InstanceCreateSuccess>;

export const InstanceListSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.list"),
	ok: z.literal(true),
	result: InstanceListResult,
});
export type InstanceListSuccess = z.infer<typeof InstanceListSuccess>;

export const InstanceGetSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.get"),
	ok: z.literal(true),
	result: InstanceResult,
});
export type InstanceGetSuccess = z.infer<typeof InstanceGetSuccess>;

export const InstanceStartSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.start"),
	ok: z.literal(true),
	result: InstanceResult,
});
export type InstanceStartSuccess = z.infer<typeof InstanceStartSuccess>;

export const InstanceStopSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.stop"),
	ok: z.literal(true),
	result: InstanceResult,
});
export type InstanceStopSuccess = z.infer<typeof InstanceStopSuccess>;

export const InstanceRemoveSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("instance.remove"),
	ok: z.literal(true),
	result: InstanceResult,
});
export type InstanceRemoveSuccess = z.infer<typeof InstanceRemoveSuccess>;

export const JobSubmitSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("job.submit"),
	ok: z.literal(true),
	result: SubmitResult,
});
export type JobSubmitSuccess = z.infer<typeof JobSubmitSuccess>;

export const JobListSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("job.list"),
	ok: z.literal(true),
	result: ListResult,
});
export type JobListSuccess = z.infer<typeof JobListSuccess>;

export const JobGetSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("job.get"),
	ok: z.literal(true),
	result: GetResult,
});
export type JobGetSuccess = z.infer<typeof JobGetSuccess>;

export const JobCancelSuccess = z.strictObject({
	id: z.string().min(1),
	method: z.literal("job.cancel"),
	ok: z.literal(true),
	result: CancelResult,
});
export type JobCancelSuccess = z.infer<typeof JobCancelSuccess>;

export const ErrorResponse = z.strictObject({
	id: z.string().min(1),
	method: z.union([RequestMethod, z.literal("unknown")]),
	ok: z.literal(false),
	error: ResponseError,
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const ResponseMessage = z.union([
	DaemonHealthSuccess,
	DaemonShutdownSuccess,
	InstanceCreateSuccess,
	InstanceListSuccess,
	InstanceGetSuccess,
	InstanceStartSuccess,
	InstanceStopSuccess,
	InstanceRemoveSuccess,
	JobSubmitSuccess,
	JobListSuccess,
	JobGetSuccess,
	JobCancelSuccess,
	ErrorResponse,
]);
export type ResponseMessage = z.infer<typeof ResponseMessage>;

export const DaemonState = z.strictObject({
	instances: z.array(ManagedInstance),
	jobs: z.array(DaemonJob),
});
export type DaemonState = z.infer<typeof DaemonState>;

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

export function normalizeIssues(error: z.ZodError): ResponseError["issues"] {
	return error.issues.map((issue: z.ZodIssue) => ({
		path: issue.path.join("."),
		message: issue.message,
		code: issue.code,
	}));
}
