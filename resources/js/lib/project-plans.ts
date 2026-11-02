import { file as fileRoute } from '@/actions/App/Http/Controllers/AiChatController';
import { api } from '@/lib/api';

export type PlanEntry = { title: string; path: string };

export type PlanTask = {
    id: string | null;
    title: string;
    status: 'todo' | 'doing' | 'blocked' | 'done';
    /** * What the task asks for, as labelled lines (scope, approach, acceptance criteria, files...). Empty for a plain text task. */
    details: { label: string; lines: string[] }[];
};

// * Task fields of the planner's schema, in reading order, with their labels.
const DETAIL_FIELDS: [string, string][] = [
    ['priority', 'Ưu tiên'],
    ['priorityReason', 'Lý do ưu tiên'],
    ['description', 'Mô tả'],
    ['inScope', 'Trong phạm vi'],
    ['outOfScope', 'Ngoài phạm vi'],
    ['approach', 'Cách làm'],
    ['dependencies', 'Phụ thuộc'],
    ['requirements', 'Yêu cầu'],
    ['acceptanceCriteria', 'Tiêu chí nghiệm thu'],
    ['filesToChange', 'File cần sửa'],
    ['test', 'Kiểm thử'],
    ['doneWhen', 'Xong khi'],
];

/** * One value of a task field as plain lines: text, a list of texts, or a list of `{path, changes}`. */
const lines = (value: unknown): string[] => {
    if (typeof value === 'string') {
        return value.trim() ? [value.trim()] : [];
    }

    if (typeof value === 'number') {
        return [String(value)];
    }

    if (!Array.isArray(value)) {
        return [];
    }

    return value.flatMap((item): string[] => {
        if (item !== null && typeof item === 'object') {
            const { path, changes } = item as Record<string, unknown>;
            const text = [path, changes]
                .filter((part): part is string => typeof part === 'string')
                .join(': ');

            return text ? [text] : [];
        }

        return lines(item);
    });
};

const INDEX_PATH = 'docs/plans/index.json';

/** * Plan files the AI has proposed but the project does not have yet (path => proposed text): they count as part of the project. */
export type PlanDrafts = Map<string, string>;

/** * Reads one text file of the picked project (read-only): `local:{id}` is a folder of this machine, anything else a GitHub repo. A proposed (not yet saved) file is read from `drafts` first. */
async function readProjectFile(
    repo: string,
    path: string,
    drafts: PlanDrafts,
): Promise<string> {
    const draft = drafts.get(path);

    if (draft !== undefined) {
        return draft;
    }

    const { data } = repo.startsWith('local:')
        ? await api.get<{ content: string }>('/ai-chat/local/file', {
              params: { root: repo.slice(6), path },
          })
        : await api.get<{ content: string }>(
              fileRoute.url({ query: { repo, path } }),
          );

    return data.content;
}

const text = (value: unknown): string =>
    typeof value === 'string' ? value.trim() : '';

/** * The plans listed in `docs/plans/index.json` of the project (`title` + `path`), newest first as written there. Empty when the project has none. */
export async function loadPlanIndex(
    repo: string,
    drafts: PlanDrafts,
): Promise<PlanEntry[]> {
    let parsed: unknown = [];

    try {
        parsed = JSON.parse(await readProjectFile(repo, INDEX_PATH, drafts));
    } catch {
        // * No index yet: the proposed plan files below still show.
    }

    const listed = (Array.isArray(parsed) ? parsed : []).flatMap(
        (item): PlanEntry[] => {
            const title = text(item?.title);
            const path = text(item?.path);

            // * Only files of docs/plans are read, whatever the index says.
            return title && /^docs\/plans\/[\w.-]+\.json$/.test(path)
                ? [{ title, path }]
                : [];
        },
    );

    // * A proposed plan file the index does not list yet (it is named after its own title).
    const proposed = [...drafts.entries()]
        .filter(
            ([path]) =>
                /^docs\/plans\/(?!index\.json$)[\w.-]+\.json$/.test(path) &&
                !listed.some((entry) => entry.path === path),
        )
        .flatMap(([path, content]): PlanEntry[] => {
            try {
                const title = text(JSON.parse(content)?.title);

                return title ? [{ title, path }] : [];
            } catch {
                return [];
            }
        });

    return [...proposed, ...listed];
}

const STATUS: Record<string, PlanTask['status']> = {
    TODO: 'todo',
    IN_PROGRESS: 'doing',
    BLOCKED: 'blocked',
    DONE: 'done',
};

const toTask = (item: unknown, group: string | null): PlanTask | null => {
    if (typeof item === 'string') {
        return item.trim()
            ? { id: group, title: item.trim(), status: 'todo', details: [] }
            : null;
    }

    const task = (item ?? {}) as Record<string, unknown>;
    const title = text(task.title) || text(task.name) || text(task.description);

    return title
        ? {
              id: text(task.id) || group,
              title,
              status: STATUS[text(task.status).toUpperCase()] ?? 'todo',
              details: DETAIL_FIELDS.map(([key, label]) => ({
                  label,
                  lines: lines(task[key]),
              })).filter((detail) => detail.lines.length > 0),
          }
        : null;
};

/** * Tasks of one plan file: the planner's `content.tasks` (with a status), else the lines of `phases` / `milestones` (no status, so they wait). */
export async function loadPlanTasks(
    repo: string,
    path: string,
    drafts: PlanDrafts,
): Promise<PlanTask[]> {
    const content = (JSON.parse(await readProjectFile(repo, path, drafts))
        ?.content ?? {}) as Record<string, unknown>;

    if (Array.isArray(content.tasks) && content.tasks.length > 0) {
        return content.tasks
            .map((task) => toTask(task, null))
            .filter((task): task is PlanTask => task !== null);
    }

    return [content.phases, content.milestones]
        .flatMap((groups) => (Array.isArray(groups) ? groups : []))
        .flatMap((group) =>
            (Array.isArray(group?.tasks) ? group.tasks : []).map(
                (task: unknown) => toTask(task, text(group?.id) || null),
            ),
        )
        .filter((task): task is PlanTask => task !== null);
}

/** * The message that hands an approved plan to the AI: the plan file and its tasks (id and title, trimmed to fit a chat message). The server recognises it by the opening words, so a change here needs the same change in AiChatController. */
export function planRunMessage(
    path: string,
    tasks: { id: string | null; title: string }[],
): string {
    const list = tasks
        .map((task) => `- ${task.id ?? ''} ${task.title}`.trim())
        .join('\n');

    return `Plan ${path} đã được duyệt (chưa ghi vào repo, không tạo Pull Request). Hãy làm theo plan, lần lượt từng task, cập nhật trạng thái và báo kết quả sau mỗi task.${list ? `\n\nCác task:\n${list}` : ''}`.slice(
        0,
        1900,
    );
}
