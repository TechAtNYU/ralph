import type { Event, GlobalEvent, OpencodeClient } from "@opencode-ai/sdk/v2";

type EventStream<T> = { stream: AsyncGenerator<T> };

export class EventService {
	constructor(private client: OpencodeClient) {}

	async subscribe(params?: {
		directory?: string;
	}): Promise<EventStream<Event>> {
		return this.client.event.subscribe(params);
	}

	async subscribeGlobal(): Promise<EventStream<GlobalEvent>> {
		return this.client.global.event();
	}
}
