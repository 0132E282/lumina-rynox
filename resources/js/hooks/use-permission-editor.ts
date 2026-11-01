import { useEffect, useState } from 'react';

type PermissionCatalogResponse = {
    name?: string;
    permissions?: string[];
    groups: Record<string, string[]>;
};

const EMPTY_PERMISSIONS: string[] = [];
const EMPTY_GROUPS: Record<string, string[]> = {};

export function usePermissionCatalog(url: string | null, open: boolean) {
    const [data, setData] = useState<PermissionCatalogResponse | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open || !url) {
            return;
        }

        setData(null);
        setLoading(true);

        fetch(url, { headers: { Accept: 'application/json' } })
            .then((response) => response.json())
            .then((response: PermissionCatalogResponse) => setData(response))
            .finally(() => setLoading(false));
    }, [open, url]);

    return {
        name: data?.name ?? '',
        permissions: data?.permissions ?? EMPTY_PERMISSIONS,
        groups: data?.groups ?? EMPTY_GROUPS,
        loading,
    };
}

export function togglePermission(
    selected: string[],
    groupKey: string,
    actionKey: string,
    checked: boolean,
): string[] {
    const permissionName = `${groupKey}.${actionKey}`;

    return checked
        ? Array.from(new Set([...selected, permissionName]))
        : selected.filter((name) => name !== permissionName);
}

export function toggleGroupPermissions(
    selected: string[],
    groupNames: string[],
    checked: boolean,
): string[] {
    return checked
        ? Array.from(new Set([...selected, ...groupNames]))
        : selected.filter((name) => !groupNames.includes(name));
}
