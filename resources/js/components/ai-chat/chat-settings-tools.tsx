import { isAxiosError } from 'axios';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export type ToolKind = 'skill' | 'agent' | 'mcp';

type Item = { name: string; description: string; sources?: string[] };

// * Which tool folder holds the file: `.agents` is the copy shared by every tool.
const SOURCE_LABELS: Record<string, string> = {
    agents: 'Dùng chung',
    claude: 'Claude',
    codex: 'Codex',
};

function SourceBadges({ sources }: { sources?: string[] }) {
    return (
        <>
            {(sources ?? []).map((source) => (
                <span
                    key={source}
                    className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground"
                >
                    {SOURCE_LABELS[source] ?? source}
                </span>
            ))}
        </>
    );
}

type Catalog = {
    skills: Item[];
    agents: Item[];
    global_skills: Item[];
    global_agents: Item[];
    mcp: { name: string; status: string }[];
    enabled: Record<
        ToolKind | 'global_skill' | 'global_agent' | 'global_mcp',
        string[]
    >;
    can_create: boolean;
    message: string | null;
};

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}$/;

const COPY: Record<ToolKind, { empty: string; hint: string }> = {
    skill: {
        empty: 'Dự án chưa có skill nào (.agents, .claude, .codex).',
        hint: 'Mặc định bật. AI biết tên các skill đang bật; nội dung SKILL.md được gửi kèm khi bạn nhắc tên skill trong tin nhắn.',
    },
    agent: {
        empty: 'Dự án chưa có subagent nào (.agents, .claude, .codex).',
        hint: 'Mặc định bật. AI biết tên các subagent đang bật; định nghĩa được gửi kèm khi bạn nhắc tên trong tin nhắn.',
    },
    mcp: {
        empty: 'Claude CLI trên máy chưa có MCP server nào (claude mcp list).',
        hint: 'Lấy từ Claude CLI trên máy chủ. Mặc định tắt: server không bật sẽ bị chặn khi chat. Thêm server mới bằng `claude mcp add` trong terminal, không thêm từ giao diện.',
    },
};

/** * `claude mcp list` status text → what the person should do about it. */
const mcpStatus = (status: string) =>
    /^needs auth/i.test(status)
        ? 'Cần xác thực: chạy `claude` rồi gõ /mcp trong terminal để đăng nhập'
        : /^connected/i.test(status)
          ? 'Đã kết nối'
          : /^failed/i.test(status)
            ? `Lỗi kết nối: ${status.replace(/^failed to connect\s*/i, '') || 'xem /mcp trong terminal'}`
            : status;

const labelOf = (project: string) =>
    project.startsWith('local:') ? project.slice(6) : project;

/** * Settings tab for one kind (Skill, Agent or MCP): tick what is on for the chosen project (everything starts off); skills and agents can be added into a local project's shared `.agents/` folder. */
export function ChatSettingsTools({
    kind,
    projects,
    aiCount = 0,
}: {
    kind: ToolKind;
    /** * The current project (`owner/name` or `local:<root>`); empty when none is picked. */
    projects: string[];
    /** * Distinct AI vendors connected: with more than 2, the list splits into tabs by tool folder. */
    aiCount?: number;
}) {
    const [filter, setFilter] = useState('all');
    // * No project picked: skills and MCP servers of the whole machine only ("global").
    const project = projects[0] ?? 'global';
    const none = project === 'global';
    const globalKey = `global_${kind}` as const;
    const [catalog, setCatalog] = useState<Catalog | null>(null);
    const [failed, setFailed] = useState(false);
    const [adding, setAdding] = useState(false);

    const load = useCallback(() => {
        setFailed(false);
        api.get<Catalog>('/ai-chat/tools', { params: { project } })
            .then(({ data }) => setCatalog(data))
            .catch(() => setFailed(true));
    }, [project]);

    useEffect(() => {
        setCatalog(null);
        load();
    }, [load]);

    const items: Item[] =
        kind === 'skill'
            ? (catalog?.skills ?? [])
            : kind === 'agent'
              ? (catalog?.agents ?? [])
              : (catalog?.mcp ?? []).map(({ name, status }) => ({
                    name,
                    description: status,
                }));
    const globalItems =
        kind === 'skill'
            ? (catalog?.global_skills ?? [])
            : kind === 'agent'
              ? (catalog?.global_agents ?? [])
              : [];
    const present = [
        ...new Set([
            ...items.flatMap((item) => item.sources ?? []),
            ...globalItems.flatMap((item) => item.sources ?? []),
        ]),
    ];
    const tabs = aiCount > 2 && kind !== 'mcp' && present.length > 1;
    const visible = (list: Item[]) =>
        tabs && filter !== 'all'
            ? list.filter((item) => item.sources?.includes(filter))
            : list;
    const enabled = catalog?.enabled[none ? globalKey : kind] ?? [];

    const toggle = async (name: string, on: boolean, global = false) => {
        const key = global || (none && kind === 'mcp') ? globalKey : kind;

        try {
            await api.put('/ai-chat/tools', {
                project: global || none ? 'global' : project,
                kind,
                name,
                on,
            });

            setCatalog((current) =>
                current
                    ? {
                          ...current,
                          enabled: {
                              ...current.enabled,
                              [key]: on
                                  ? [...current.enabled[key], name]
                                  : current.enabled[key].filter(
                                        (value) => value !== name,
                                    ),
                          },
                      }
                    : current,
            );
        } catch {
            toast.error('Không lưu được lựa chọn.');
        }
    };

    return (
        <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
                {none ? (
                    <strong>Toàn cục (chưa chọn dự án).</strong>
                ) : (
                    <>
                        Dự án: <strong>{labelOf(project)}</strong>.
                    </>
                )}{' '}
                {COPY[kind].hint}
            </p>
            {failed && (
                <p role="alert" className="text-sm text-destructive">
                    Không tải được danh sách.{' '}
                    <button type="button" className="underline" onClick={load}>
                        Thử lại
                    </button>
                </p>
            )}
            {catalog?.message && kind !== 'mcp' && (
                <p className="text-sm text-muted-foreground">
                    {catalog.message}
                </p>
            )}
            {catalog === null && !failed && (
                <p className="text-sm text-muted-foreground">Đang tải...</p>
            )}
            {catalog &&
                items.length === 0 &&
                !catalog.message &&
                (!none || kind === 'mcp') && (
                    <p className="text-sm text-muted-foreground">
                        {COPY[kind].empty}
                    </p>
                )}
            {tabs && (
                <div
                    role="tablist"
                    aria-label="Nguồn"
                    className="flex flex-wrap gap-1"
                >
                    {['all', ...present].map((value) => (
                        <button
                            key={value}
                            type="button"
                            role="tab"
                            aria-selected={filter === value}
                            onClick={() => setFilter(value)}
                            className={cn(
                                'rounded-md px-2.5 py-1 text-xs',
                                filter === value
                                    ? 'bg-accent text-accent-foreground'
                                    : 'text-muted-foreground hover:bg-muted',
                            )}
                        >
                            {value === 'all'
                                ? 'Tất cả'
                                : (SOURCE_LABELS[value] ?? value)}
                        </button>
                    ))}
                </div>
            )}
            {items.length > 0 && (
                <ul className="flex flex-col divide-y rounded-md border">
                    {visible(items).map((item) => (
                        <li
                            key={item.name}
                            className="flex items-center gap-3 px-3 py-2"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                    <p className="truncate text-sm font-medium">
                                        {item.name}
                                    </p>
                                    <SourceBadges sources={item.sources} />
                                </div>
                                {item.description && (
                                    <p className="truncate text-xs text-muted-foreground">
                                        {kind === 'mcp'
                                            ? mcpStatus(item.description)
                                            : item.description}
                                    </p>
                                )}
                            </div>
                            <Switch
                                aria-label={`Bật ${item.name}`}
                                checked={enabled.includes(item.name)}
                                onCheckedChange={(on) =>
                                    void toggle(item.name, on)
                                }
                            />
                        </li>
                    ))}
                </ul>
            )}
            {kind !== 'mcp' && globalItems.length > 0 && (
                <>
                    <p className="text-xs text-muted-foreground">
                        <strong>
                            {kind === 'skill' ? 'Skill' : 'Subagent'} toàn cục
                        </strong>{' '}
                        (trên máy này, dùng cho mọi dự án):
                    </p>
                    <ul className="flex flex-col divide-y rounded-md border">
                        {visible(globalItems).map((item) => (
                            <li
                                key={item.name}
                                className="flex items-center gap-3 px-3 py-2"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                        <p className="truncate text-sm font-medium">
                                            {item.name}
                                        </p>
                                        <SourceBadges sources={item.sources} />
                                    </div>
                                    {item.description && (
                                        <p className="truncate text-xs text-muted-foreground">
                                            {item.description}
                                        </p>
                                    )}
                                </div>
                                <Switch
                                    aria-label={`Bật ${item.name} (toàn cục)`}
                                    checked={catalog?.enabled[
                                        globalKey
                                    ]?.includes(item.name)}
                                    onCheckedChange={(on) =>
                                        void toggle(item.name, on, true)
                                    }
                                />
                            </li>
                        ))}
                    </ul>
                </>
            )}
            {kind !== 'mcp' && catalog?.can_create && (
                <>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="self-start"
                        onClick={() => setAdding(true)}
                    >
                        <Plus aria-hidden="true" />
                        Thêm {kind === 'skill' ? 'skill' : 'subagent'} mới
                    </Button>
                    <Dialog open={adding} onOpenChange={setAdding}>
                        <DialogContent className="sm:max-w-xl">
                            <DialogHeader>
                                <DialogTitle>
                                    Thêm{' '}
                                    {kind === 'skill' ? 'skill' : 'subagent'}{' '}
                                    mới
                                </DialogTitle>
                                <DialogDescription>
                                    Tạo tệp mới trong dự án đang chọn.
                                </DialogDescription>
                            </DialogHeader>
                            <CreateForm
                                kind={kind}
                                project={project}
                                onCancel={() => setAdding(false)}
                                onCreated={() => {
                                    setAdding(false);
                                    load();
                                }}
                            />
                        </DialogContent>
                    </Dialog>
                </>
            )}
            {kind !== 'mcp' && !none && catalog && !catalog.can_create && (
                <p className="text-xs text-muted-foreground">
                    Chỉ thêm mới được trong dự án local (cần quyền ghi tệp
                    local).
                </p>
            )}
        </div>
    );
}

function CreateForm({
    kind,
    project,
    onCancel,
    onCreated,
}: {
    kind: 'skill' | 'agent';
    project: string;
    onCancel: () => void;
    onCreated: () => void;
}) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [body, setBody] = useState('');
    const [error, setError] = useState<string | undefined>();
    const [busy, setBusy] = useState(false);
    const valid =
        NAME_PATTERN.test(name) &&
        description.trim() !== '' &&
        body.trim() !== '';

    const submit = async () => {
        setBusy(true);
        setError(undefined);

        try {
            const { data } = await api.post<{ path: string }>(
                '/ai-chat/tools',
                { project, kind, name, description, body },
            );

            toast.success(`Đã tạo ${data.path}`);
            onCreated();
        } catch (caught) {
            const data = isAxiosError(caught)
                ? (caught.response?.data as
                      | {
                            message?: string;
                            errors?: Record<string, string[]>;
                        }
                      | undefined)
                : undefined;

            setError(
                Object.values(data?.errors ?? {})[0]?.[0] ??
                    data?.message ??
                    'Không tạo được.',
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
                <Label htmlFor={`new-${kind}-name`}>Tên</Label>
                <Input
                    id={`new-${kind}-name`}
                    value={name}
                    maxLength={50}
                    placeholder="vd: code-review"
                    onChange={(event) => setName(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                    Chữ thường, số và dấu gạch ngang. Tạo tại{' '}
                    {kind === 'skill'
                        ? `.agents/skills/${name || '<tên>'}/SKILL.md`
                        : `.agents/agents/${name || '<tên>'}.md`}
                    ; không ghi đè tệp có sẵn.
                </p>
            </div>
            <div className="flex flex-col gap-1.5">
                <Label htmlFor={`new-${kind}-description`}>Mô tả</Label>
                <Input
                    id={`new-${kind}-description`}
                    value={description}
                    maxLength={300}
                    onChange={(event) => setDescription(event.target.value)}
                />
            </div>
            <div className="flex flex-col gap-1.5">
                <Label htmlFor={`new-${kind}-body`}>Nội dung</Label>
                <textarea
                    id={`new-${kind}-body`}
                    value={body}
                    maxLength={20000}
                    rows={8}
                    onChange={(event) => setBody(event.target.value)}
                    className="rounded-md border bg-transparent px-3 py-2 text-sm"
                />
            </div>
            {error && (
                <p role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            )}
            <div className="flex justify-end gap-2">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={onCancel}
                >
                    Hủy
                </Button>
                <Button
                    type="button"
                    size="sm"
                    disabled={busy || !valid}
                    onClick={() => void submit()}
                >
                    {busy ? 'Đang tạo...' : 'Tạo'}
                </Button>
            </div>
        </div>
    );
}
