import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type {
    Resolver,
    UseFormProps,
    FieldValues,
    Path,
} from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { api } from '@/lib/api';

interface UseAppFormProps<T extends FieldValues> extends Omit<
    UseFormProps<T>,
    'resolver'
> {
    schema?: z.ZodType<T>;
}

interface SubmitOptions {
    /** * Route params, e.g. `{ role: roleId }` for `roles.update`. */
    params?: Record<string, unknown>;
    onSuccess?: (response: { data: any; message?: string }) => void;
    onError?: (errors: Record<string, string>) => void;
    onFinish?: () => void;
}

/** * Any File/Blob (including in arrays) requires multipart instead of JSON. */
function containsFile(data: Record<string, unknown>): boolean {
    return Object.values(data).some(
        (value) =>
            value instanceof Blob ||
            (Array.isArray(value) &&
                value.some((entry) => entry instanceof Blob)),
    );
}

function toFormData(data: Record<string, unknown>): FormData {
    const formData = new FormData();

    Object.entries(data).forEach(([key, value]) => {
        if (value === null || value === undefined) {
            return;
        }

        if (Array.isArray(value)) {
            value.forEach((entry) =>
                formData.append(
                    `${key}[]`,
                    entry instanceof Blob ? entry : String(entry),
                ),
            );
        } else if (value instanceof Blob) {
            formData.append(key, value);
        } else if (typeof value === 'object') {
            formData.append(key, JSON.stringify(value));
        } else {
            formData.append(key, String(value));
        }
    });

    return formData;
}

export function useAppForm<T extends FieldValues>({
    schema,
    ...props
}: UseAppFormProps<T> = {}) {
    // ! zod v4's internal types don't line up with @hookform/resolvers' generic constraints yet; the resolver is sound at runtime.
    const form = useForm<T>({
        ...(schema && {
            resolver: zodResolver(schema) as unknown as Resolver<T>,
        }),
        ...props,
    });

    /**
     * * `name` is a Ziggy route name; Laravel validation errors map onto `form.setError`.
     * ! Payloads with files POST with `_method`: PHP never fills `$_FILES` for native PUT/PATCH.
     */
    const submit = (
        name: string,
        method: 'post' | 'put' | 'patch' | 'delete' = 'post',
        options?: SubmitOptions,
    ) =>
        form.handleSubmit((data) => {
            const url = window.route(name, options?.params);
            const hasFile = containsFile(data as Record<string, unknown>);
            const body = hasFile
                ? toFormData({
                      ...data,
                      ...(method !== 'post' && { _method: method }),
                  })
                : data;
            const requestMethod =
                hasFile && method !== 'post' ? 'post' : method;

            return api[requestMethod](url, body as any)
                .then((response) => options?.onSuccess?.(response.data))
                .catch((error) => {
                    const errors: Record<string, string[]> | undefined =
                        error?.response?.data?.errors;

                    if (!errors) {
                        // * Errors without field messages (e.g. 500) would otherwise stay silent.
                        toast.error(
                            error?.response?.data?.message ??
                                'Đã xảy ra lỗi, vui lòng thử lại.',
                        );

                        return;
                    }

                    const flattened: Record<string, string> = {};

                    Object.entries(errors).forEach(([key, messages]) => {
                        const message = Array.isArray(messages)
                            ? messages[0]
                            : messages;
                        flattened[key] = message;
                        form.setError(key as Path<T>, {
                            type: 'server',
                            message,
                        });
                    });

                    options?.onError?.(flattened);
                })
                .finally(() => options?.onFinish?.());
        });

    return { ...form, submit };
}

export { z };
