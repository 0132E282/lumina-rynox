import { useEffect, useState } from 'react';
import { LoadingRows } from '@/components/ai-chat/loading-rows';
import { api } from '@/lib/api';

type Info = {
    rules: { name: string; description: string; path: string }[];
    hooks: {
        event: string;
        matcher: string;
        command: string;
        source: string;
    }[];
    message: string | null;
};

/** * Read-only list of the rules (`.agents/rules`) or the hooks (`.claude/settings.json`) of the current project. */
export function ChatSettingsInfo({
    kind,
    projects,
}: {
    kind: 'rules' | 'hooks';
    projects: string[];
}) {
    const project = projects[0] ?? null;
    const [info, setInfo] = useState<Info | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        if (project === null) {
            return;
        }

        let cancelled = false;

        api.get<Info>('/ai-chat/tools/info', { params: { project } })
            .then(({ data }) => {
                if (!cancelled) {
                    setInfo(data);
                }
            })
            .catch(() => !cancelled && setError(true));

        return () => {
            cancelled = true;
        };
    }, [project]);

    if (project === null) {
        return (
            <p className="text-sm text-muted-foreground">
                Chọn một dự án để xem {kind === 'rules' ? 'rules' : 'hook'}.
            </p>
        );
    }

    if (error) {
        return (
            <p role="alert" className="text-sm text-destructive">
                Không tải được danh sách.
            </p>
        );
    }

    if (info === null) {
        return <LoadingRows rows={4} />;
    }

    const items = kind === 'rules' ? info.rules : info.hooks;

    return (
        <div className="flex flex-col gap-2">
            {info.message !== null && (
                <p className="text-sm text-muted-foreground">{info.message}</p>
            )}
            {items.length === 0 && info.message === null && (
                <p className="text-sm text-muted-foreground">
                    {kind === 'rules'
                        ? 'Dự án chưa có rule nào trong .agents/rules.'
                        : 'Dự án chưa cấu hình hook nào.'}
                </p>
            )}
            <ul className="flex flex-col gap-2">
                {kind === 'rules'
                    ? info.rules.map((rule) => (
                          <li key={rule.path} className="rounded-md border p-3">
                              <p className="text-sm font-medium">{rule.name}</p>
                              {rule.description !== '' && (
                                  <p className="text-xs text-muted-foreground">
                                      {rule.description}
                                  </p>
                              )}
                              <p className="mt-1 truncate text-[11px] text-muted-foreground">
                                  {rule.path}
                              </p>
                          </li>
                      ))
                    : info.hooks.map((hook, index) => (
                          <li
                              key={`${hook.source}-${index}`}
                              className="rounded-md border p-3"
                          >
                              <p className="text-sm font-medium">
                                  {hook.event}
                                  {hook.matcher !== '' && (
                                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                                          {hook.matcher}
                                      </span>
                                  )}
                              </p>
                              <code className="mt-1 block text-xs break-all">
                                  {hook.command}
                              </code>
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                  {hook.source}
                              </p>
                          </li>
                      ))}
            </ul>
        </div>
    );
}
