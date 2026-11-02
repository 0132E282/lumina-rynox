import { AxiosError } from 'axios';
import type { AxiosResponse } from 'axios';
import { xsrfToken } from '@/lib/xsrf';
import type { AiPlanItem, AiSubagentEvent } from '@/types';

type StreamEvent =
    | { type: 'step'; kind: string; source: string; detail: string }
    | ({ type: 'agent' } & AiSubagentEvent)
    | { type: 'plan'; todos: AiPlanItem[] }
    | { type: 'done'; status: number; data: unknown };

/**
 * POSTs a form to a route that answers in lines of JSON (`application/x-ndjson`): `onStep` gets each step as the server does it, and the result is the body of the final `done` line.
 * A `done` line with a status of 400 or more throws an AxiosError carrying that body, so error text is read the same way as for a plain request.
 */
export async function postStream<T>(
    url: string,
    form: FormData,
    options: {
        signal?: AbortSignal;
        onStep: (step: {
            kind: string;
            source: string;
            detail: string;
        }) => void;
        onAgent?: (event: AiSubagentEvent) => void;
        onPlan?: (todos: AiPlanItem[]) => void;
    },
): Promise<T> {
    const response = await fetch(url, {
        method: 'POST',
        body: form,
        signal: options.signal,
        credentials: 'same-origin',
        headers: {
            Accept: 'application/x-ndjson, application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'X-XSRF-TOKEN': xsrfToken(),
        },
    });

    const fail = (status: number, data: unknown): never => {
        throw new AxiosError(
            'Request failed',
            undefined,
            undefined,
            undefined,
            {
                status,
                data,
                headers: {},
                statusText: '',
                config: {},
            } as AxiosResponse,
        );
    };

    // * A refusal before the stream starts (validation, permission, rate limit) is ordinary JSON.
    if (!response.ok || response.body === null) {
        return fail(response.status, await response.json().catch(() => ({})));
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done: Extract<StreamEvent, { type: 'done' }> | null = null;

    const handle = (line: string) => {
        if (line.trim() === '') {
            return;
        }

        const event = JSON.parse(line) as StreamEvent;

        if (event.type === 'step') {
            options.onStep(event);
        } else if (event.type === 'plan') {
            options.onPlan?.(event.todos);
        } else if (event.type === 'agent') {
            options.onAgent?.(event);
        } else {
            done = event;
        }
    };

    for (;;) {
        const { value, done: finished } = await reader.read();

        buffer += decoder.decode(value, { stream: !finished });

        let newline = buffer.indexOf('\n');

        while (newline !== -1) {
            handle(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf('\n');
        }

        if (finished) {
            handle(buffer);
            break;
        }
    }

    const last = done as Extract<StreamEvent, { type: 'done' }> | null;

    if (last === null) {
        return fail(502, { message: 'Mất kết nối khi chờ trợ lý AI.' });
    }

    if (last.status >= 400) {
        return fail(last.status, last.data);
    }

    return last.data as T;
}
