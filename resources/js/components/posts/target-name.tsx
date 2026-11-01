import type { PostTargetRow } from '@/types';

/** * Name of a posting target. A group links to the group page; a target without a group (a personal account) links to the post once it is live. */
export function TargetName({
    target,
}: {
    target: Pick<
        PostTargetRow,
        'group' | 'group_url' | 'label' | 'external_url'
    >;
}) {
    const name = target.group ?? target.label;
    const href = target.group
        ? (target.group_url ?? target.external_url)
        : target.external_url;

    return href ? (
        <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="min-w-0 truncate hover:underline"
        >
            {name}
        </a>
    ) : (
        <span className="min-w-0 truncate">{name}</span>
    );
}
