import { Head, router, usePage } from '@inertiajs/react';
import React, { useEffect } from 'react';
import type { FieldValues } from 'react-hook-form';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm-dialog';
import { Form, Field } from '@/components/form';
import {
    FormCollectionContext,
    FormRecordIdContext,
} from '@/components/form/collection-context';
import {
    FormPreviewPane,
    useFormPreview,
} from '@/components/form/form-preview-pane';
import {
    SplitViewContext,
    useSplitView,
} from '@/components/form/split-view-context';
import { FormToolbar } from '@/components/toolbar/form-toolbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useHeaderActions } from '@/contexts/header-actions';
import { useLocale } from '@/contexts/locale-context';
import { useAppForm, z } from '@/hooks/use-app-form';
import { useQuery } from '@/hooks/use-query';
import { api } from '@/lib/api';

interface FormLayoutProps<T extends FieldValues> {
    title: string;
    schema?: z.ZodType<T>;
    defaultValues?: T;
    collection?: string;
    children: React.ReactNode;
    id?: string | number;
    onSaved?: (
        record: { id: string | number } & Record<string, unknown>,
    ) => void;
}

function parseValidateRule(rule: string): z.ZodTypeAny {
    const [name, ...rest] = rule.split(':');

    switch (name) {
        case 'required':
            return z
                .string()
                .min(1, rest.join(':') || 'Trường này là bắt buộc');
        case 'min': {
            const [length, ...msg] = rest;

            return z
                .string()
                .min(
                    Number(length),
                    msg.join(':') || `Tối thiểu ${length} ký tự`,
                );
        }
        case 'max': {
            const [length, ...msg] = rest;

            return z
                .string()
                .max(Number(length), msg.join(':') || `Tối đa ${length} ký tự`);
        }
        case 'email':
            return z.email(rest.join(':') || 'Email không hợp lệ');
        default:
            return z.any().optional().nullable();
    }
}

type FieldConstraint = {
    required?: boolean;
    type?: 'string' | 'integer' | 'number' | 'boolean' | 'array';
    min?: number;
    max?: number;
    in?: string[];
    email?: boolean;
};

function zodFromConstraint(constraint: FieldConstraint): z.ZodTypeAny {
    let validator: z.ZodTypeAny =
        constraint.type === 'integer' || constraint.type === 'number'
            ? z.coerce.number()
            : constraint.type === 'boolean'
              ? z.boolean()
              : constraint.type === 'array'
                ? z.array(z.any())
                : z.coerce.string();

    if (constraint.in?.length) {
        validator = z.enum(constraint.in as [string, ...string[]]);
    }

    if (constraint.email && validator instanceof z.ZodString) {
        validator = validator.pipe(z.email('Email không hợp lệ'));
    }

    if (typeof constraint.min === 'number' && 'min' in validator) {
        validator = (
            validator as z.ZodString | z.ZodNumber | z.ZodArray<z.ZodTypeAny>
        ).min(constraint.min as never);
    }

    if (typeof constraint.max === 'number' && 'max' in validator) {
        validator = (
            validator as z.ZodString | z.ZodNumber | z.ZodArray<z.ZodTypeAny>
        ).max(constraint.max as never);
    }

    return constraint.required ? validator : validator.optional().nullable();
}

/** * Type-appropriate empty value so required fields never start as `null`. */
function defaultForConstraint(constraint?: FieldConstraint): unknown {
    // * `in`-restricted fields can't default to ''/null: prefer "draft" when allowed, else the first option.
    if (constraint?.in?.length) {
        return constraint.in.includes('draft') ? 'draft' : constraint.in[0];
    }

    switch (constraint?.type) {
        case 'string':
            return '';
        case 'boolean':
            return false;
        case 'array':
            return [];
        default:
            return null;
    }
}

function getNestedValue(
    source: Record<string, unknown>,
    path: string,
): unknown {
    return path
        .split('.')
        .reduce<unknown>(
            (acc, key) =>
                acc && typeof acc === 'object'
                    ? (acc as Record<string, unknown>)[key]
                    : undefined,
            source,
        );
}

function setNestedValue(
    target: Record<string, unknown>,
    path: string,
    value: unknown,
) {
    const keys = path.split('.');
    let cursor = target;

    for (const key of keys.slice(0, -1)) {
        if (typeof cursor[key] !== 'object' || cursor[key] === null) {
            cursor[key] = {};
        }

        cursor = cursor[key] as Record<string, unknown>;
    }

    cursor[keys[keys.length - 1]] = value;
}

/** * Seeds nested defaultValues for dotted names (`metadata.title`) from the loaded record. */
function collectFieldConfig(
    node: React.ReactNode,
    schemaAcc: Record<string, z.ZodTypeAny>,
    valuesAcc: Record<string, unknown>,
    remoteConstraints: Record<string, FieldConstraint>,
    record?: Record<string, unknown> | null,
) {
    React.Children.forEach(node, (child) => {
        if (!React.isValidElement(child)) {
            return;
        }

        const props = child.props as {
            name?: string;
            validate?: string;
            default?: unknown;
            children?: React.ReactNode;
        };

        if (child.type === Field && props.name) {
            const remote = remoteConstraints[props.name];

            schemaAcc[props.name] = props.validate
                ? parseValidateRule(props.validate)
                : remote
                  ? zodFromConstraint(remote)
                  : z.any().optional().nullable();

            const recordValue = record
                ? getNestedValue(record, props.name)
                : undefined;

            setNestedValue(
                valuesAcc,
                props.name,
                recordValue ?? props.default ?? defaultForConstraint(remote),
            );
        }

        if (props.children) {
            collectFieldConfig(
                props.children,
                schemaAcc,
                valuesAcc,
                remoteConstraints,
                record,
            );
        }
    });
}

export default function FormLayout<T extends FieldValues>({
    title,
    schema,
    defaultValues,
    id,
    collection,
    children,
    onSaved,
}: FormLayoutProps<T>) {
    const { url, props: pageProps } = usePage<Record<string, unknown>>();
    const [urlCollection, urlId] = url.split('?')[0].split('/').filter(Boolean);
    const preview = useFormPreview(url);

    const resolvedCollection = collection ?? urlCollection;
    // * An explicit `id` (TreeLayout selection) wins over the URL segment; "create" or none means a new record.
    const resolvedId = id ?? (urlId && urlId !== 'create' ? urlId : undefined);

    // * Global content locale, sent as `?locale=` on fetch and submit.
    const [locale] = useLocale();

    const formFields = React.useMemo(() => {
        const list: string[] = [];
        const walk = (node: React.ReactNode) => {
            React.Children.forEach(node, (child) => {
                if (!React.isValidElement(child)) return;
                const props = child.props as {
                    name?: string;
                    fields?: Array<{ name?: string }>;
                    children?: React.ReactNode;
                };
                if (child.type === Field && props.name) {
                    list.push(props.name);
                    if (Array.isArray(props.fields)) {
                        props.fields.forEach((sub) => {
                            if (sub?.name) {
                                list.push(`${props.name}.${sub.name}`);
                            }
                        });
                    }
                }
                if (props.children) {
                    walk(props.children);
                }
            });
        };
        walk(children);
        return list;
    }, [children]);

    const { data: apiRecordResponse, loading: apiLoading } = useQuery<{
        data: Record<string, unknown>;
    }>(resolvedId ? 'items.show' : null, {
        resource: resolvedCollection,
        idOrSlug: resolvedId,
        locale,
        fields: formFields.length > 0 ? formFields : undefined,
    });
    const record = apiRecordResponse?.data ?? null;

    // ! The URL id may be a slug; update/destroy/index-status/frontend-url need the numeric id.
    const numericId = record?.id as string | number | undefined;

    // * Once loaded, the record's own title/name/label replaces the generic action title.
    const recordLabel = record
        ? (record.title ?? record.name ?? record.label)
        : undefined;
    const pageTitle = resolvedId && recordLabel ? String(recordLabel) : title;

    const remoteConstraints =
        (pageProps.schema as Record<string, FieldConstraint> | undefined) ?? {};
    const shape: Record<string, z.ZodTypeAny> = {};
    const derivedValues: Record<string, unknown> = {};

    if (!schema || !defaultValues) {
        collectFieldConfig(
            children,
            shape,
            derivedValues,
            remoteConstraints,
            record,
        );
    }

    const resolvedSchema =
        schema ?? (z.looseObject(shape) as unknown as z.ZodType<T>);
    const resolvedDefaultValues = defaultValues ?? (derivedValues as T);

    const form = useAppForm<T>({
        schema: resolvedSchema,
        defaultValues: resolvedDefaultValues as any,
    });
    const {
        formState: { isSubmitting },
    } = form;

    // * The form doesn't remount on TreeLayout selection, so push fresh values here once `apiLoading` settles.
    useEffect(() => {
        if (apiLoading) {
            return;
        }

        form.reset(resolvedDefaultValues as any);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run when the selected record (id) or its loaded data changes
    }, [resolvedId, record]);

    const routeName = resolvedId ? 'items.update' : 'items.store';

    const onSubmit = form.submit(routeName, resolvedId ? 'put' : 'post', {
        params: { resource: resolvedCollection, id: numericId, locale },
        onSuccess: (response) => {
            toast.success(
                response.message ??
                    (resolvedId ? 'Đã cập nhật.' : 'Đã tạo mới.'),
            );

            if (onSaved) {
                if (response.data) {
                    onSaved(
                        response.data as { id: string | number } & Record<
                            string,
                            unknown
                        >,
                    );
                }

                return;
            }

            // * In split view, stay on the form and refresh the preview to see the save live.
            if (preview.splitUrl) {
                preview.reload();

                return;
            }

            // * Creating moves on to editing the new record.
            if (!resolvedId && response.data?.id) {
                router.visit(`/${resolvedCollection}/${response.data.id}`);
            }
        },
    });

    // * The header button submits via the HTML `form="..."` attribute.
    const formId = 'form-layout-form';

    const confirm = useConfirm();

    const handleDelete = async () => {
        // * The header button can render before the record (and its id) loads.
        if (!numericId) {
            return;
        }

        if (
            !(await confirm({
                title: `Xóa "${title}"?`,
                description: 'Hành động này không thể hoàn tác.',
                confirmLabel: 'Xóa',
                destructive: true,
            }))
        ) {
            return;
        }

        try {
            await api.delete(
                window.route('items.destroy', {
                    resource: resolvedCollection,
                    id: numericId,
                }),
            );
            toast.success('Đã xóa.');
            router.visit(`/${resolvedCollection}`);
        } catch {
            toast.error('Xóa thất bại.');
        }
    };

    useHeaderActions(
        resolvedId ? (
            <FormToolbar
                formId={formId}
                isSubmitting={isSubmitting}
                onDelete={handleDelete}
            />
        ) : null,
        [resolvedId, resolvedCollection, title, formId, isSubmitting],
    );

    // * Set the title before the loading gate so the header and tab don't show the previous page's title.
    if (apiLoading) {
        return <Head title={title} />;
    }

    return (
        <div ref={preview.containerRef} className="flex flex-1">
            <Head title={pageTitle} />

            <div
                className="flex min-w-0 flex-col gap-6 p-4 md:p-6"
                style={
                    preview.splitUrl
                        ? { width: `${preview.splitRatio * 100}%` }
                        : { flex: 1 }
                }
            >
                <FormCollectionContext.Provider value={resolvedCollection}>
                    <FormRecordIdContext.Provider value={numericId}>
                        <SplitViewContext.Provider
                            value={{
                                open: preview.open,
                                isActive: !!preview.splitUrl,
                            }}
                        >
                            <Form
                                id={formId}
                                form={form as any}
                                onSubmit={onSubmit}
                            >
                                <div className="flex flex-wrap gap-4">
                                    {children}
                                </div>
                                <div className="mt-6 flex items-center gap-4">
                                    <Button
                                        type="submit"
                                        disabled={isSubmitting}
                                    >
                                        {isSubmitting ? 'Đang lưu...' : 'Lưu'}
                                    </Button>
                                </div>
                            </Form>
                        </SplitViewContext.Provider>
                    </FormRecordIdContext.Provider>
                </FormCollectionContext.Provider>
            </div>

            {preview.splitUrl && (
                <FormPreviewPane
                    url={preview.splitUrl}
                    reloadKey={preview.reloadKey}
                    onReload={preview.reload}
                    onClose={preview.close}
                    onResizeStart={preview.startResize}
                    isResizing={preview.isResizing}
                    resource={resolvedCollection}
                    recordId={numericId}
                />
            )}
        </div>
    );
}

/** * Flexible card; `withSidebar` gives ~2:1 with a Sidebar and wraps to full width when space runs out (always while the preview is open). */
export function Section({
    children,
    withSidebar,
}: {
    children: React.ReactNode;
    withSidebar?: boolean;
}) {
    const splitView = useSplitView();

    return (
        <Card
            className={
                splitView?.isActive
                    ? 'w-full'
                    : withSidebar
                      ? 'w-full min-w-0 md:min-w-80 md:flex-2'
                      : 'w-full min-w-0 md:min-w-80 md:flex-1'
            }
        >
            <CardContent className="flex flex-col gap-4">
                {children}
            </CardContent>
        </Card>
    );
}

export function Sidebar({
    title,
    children,
}: {
    title?: string;
    children: React.ReactNode;
}) {
    const splitView = useSplitView();

    return (
        <Card
            className={
                splitView?.isActive
                    ? 'w-full'
                    : 'w-full min-w-0 md:min-w-72 md:flex-1'
            }
        >
            {title && (
                <CardHeader>
                    <CardTitle>{title}</CardTitle>
                </CardHeader>
            )}
            <CardContent className="flex flex-col gap-4">
                {children}
            </CardContent>
        </Card>
    );
}

/** * Stacks sections under one heading; `withSidebar` keeps a sibling Sidebar beside it. */
export function Group({
    title,
    children,
    withSidebar,
}: {
    title?: string;
    children: React.ReactNode;
    withSidebar?: boolean;
}) {
    const splitView = useSplitView();

    return (
        <div
            className={
                splitView?.isActive || !withSidebar
                    ? 'flex w-full flex-col gap-4'
                    : 'flex w-full min-w-0 flex-col gap-4 md:min-w-80 md:flex-2'
            }
        >
            {title && <h2 className="text-lg font-semibold">{title}</h2>}
            <div
                className={
                    withSidebar ? 'flex flex-col gap-4' : 'flex flex-wrap gap-4'
                }
            >
                {children}
            </div>
        </div>
    );
}
