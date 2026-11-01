import { isAxiosError } from 'axios';

/** * The server's fixed AI error text (`message`); anything else gets a generic line, never the raw error. */
export function aiErrorMessage(caught: unknown): string {
    const data = isAxiosError(caught)
        ? (caught.response?.data as { message?: string } | undefined)
        : undefined;

    return data?.message ?? 'Không gọi được trợ lý AI.';
}
