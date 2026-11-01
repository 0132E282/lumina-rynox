import { Search, Shield } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';

export type PermissionAction = {
    key: string;
    checked: boolean;
};

export type PermissionGroup = {
    key: string;
    actions: PermissionAction[];
};

function permissionName(groupKey: string, actionKey: string): string {
    return `${groupKey}.${actionKey}`;
}

export function toPermissionGroups(
    permissions: Record<string, string[]>,
    selected: string[],
): PermissionGroup[] {
    return Object.entries(permissions).map(([groupKey, names]) => ({
        key: groupKey,
        actions: names.map((name) => ({
            key: name.split('.')[1],
            checked: selected.includes(name),
        })),
    }));
}

export function PermissionMatrix({
    groups,
    onToggle,
    onToggleGroup,
    onToggleAll,
}: {
    groups: PermissionGroup[];
    onToggle: (groupKey: string, actionKey: string, checked: boolean) => void;
    onToggleGroup: (groupKey: string, checked: boolean) => void;
    onToggleAll: (checked: boolean) => void;
}) {
    const [search, setSearch] = useState('');
    const [actionFilter, setActionFilter] = useState('all');
    const [onlySelected, setOnlySelected] = useState(false);

    const actionOptions = useMemo(
        () =>
            Array.from(
                new Set(
                    groups.flatMap((group) =>
                        group.actions.map((action) => action.key),
                    ),
                ),
            ).sort(),
        [groups],
    );

    const totalCount = useMemo(
        () => groups.reduce((sum, group) => sum + group.actions.length, 0),
        [groups],
    );
    const selectedCount = useMemo(
        () =>
            groups.reduce(
                (sum, group) =>
                    sum +
                    group.actions.filter((action) => action.checked).length,
                0,
            ),
        [groups],
    );

    const visibleGroups = useMemo(() => {
        const query = search.trim().toLowerCase();

        return groups
            .map((group) => ({
                ...group,
                actions: group.actions.filter((action) => {
                    if (actionFilter !== 'all' && action.key !== actionFilter) {
                        return false;
                    }

                    if (onlySelected && !action.checked) {
                        return false;
                    }

                    if (!query) {
                        return true;
                    }

                    return (
                        group.key.toLowerCase().includes(query) ||
                        action.key.toLowerCase().includes(query) ||
                        permissionName(group.key, action.key)
                            .toLowerCase()
                            .includes(query)
                    );
                }),
            }))
            .filter((group) => group.actions.length > 0);
    }, [groups, search, actionFilter, onlySelected]);

    return (
        <div className="flex flex-col gap-3">
            <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Tìm kiếm quyền, tên nhóm, technical key..."
                    className="pl-9"
                />
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <Badge
                    variant={onlySelected ? 'default' : 'outline'}
                    className="h-8 cursor-pointer gap-2 px-3 text-[10px] font-bold uppercase"
                    onClick={() => setOnlySelected((prev) => !prev)}
                >
                    <Checkbox
                        checked={onlySelected}
                        className="pointer-events-none size-3.5"
                    />
                    Đã chọn ({selectedCount})
                </Badge>

                <Select value={actionFilter} onValueChange={setActionFilter}>
                    <SelectTrigger className="h-8 w-56">
                        <SelectValue placeholder="Lọc theo hành động..." />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Tất cả hành động</SelectItem>
                        {actionOptions.map((action) => (
                            <SelectItem key={action} value={action}>
                                {action}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <label className="ml-auto flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5 text-sm">
                    <Checkbox
                        checked={
                            selectedCount === totalCount
                                ? true
                                : selectedCount > 0
                                  ? 'indeterminate'
                                  : false
                        }
                        onCheckedChange={(checked) => onToggleAll(!!checked)}
                    />
                    Chọn tất cả
                    <span className="font-mono text-xs text-primary">
                        {selectedCount}/{totalCount}
                    </span>
                </label>
            </div>

            <div className="max-h-[420px] overflow-y-auto rounded-md border">
                <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background">
                        <TableRow className="bg-muted/50">
                            <TableHead className="w-12 text-center">
                                <Shield className="mx-auto size-4 text-muted-foreground" />
                            </TableHead>
                            <TableHead>Tên quyền (Title)</TableHead>
                            <TableHead>Mã kỹ thuật (Key)</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {visibleGroups.length === 0 ? (
                            <TableRow>
                                <TableCell
                                    colSpan={3}
                                    className="h-24 text-center text-muted-foreground"
                                >
                                    Không có quyền nào phù hợp.
                                </TableCell>
                            </TableRow>
                        ) : (
                            visibleGroups.map((group) => {
                                const groupChecked = group.actions.filter(
                                    (action) => action.checked,
                                ).length;

                                return (
                                    <Fragment key={group.key}>
                                        <TableRow className="border-y-2 bg-muted/30">
                                            <TableCell className="py-2 text-center">
                                                <Checkbox
                                                    checked={
                                                        groupChecked ===
                                                        group.actions.length
                                                            ? true
                                                            : groupChecked > 0
                                                              ? 'indeterminate'
                                                              : false
                                                    }
                                                    onCheckedChange={(
                                                        checked,
                                                    ) =>
                                                        onToggleGroup(
                                                            group.key,
                                                            !!checked,
                                                        )
                                                    }
                                                />
                                            </TableCell>
                                            <TableCell
                                                colSpan={2}
                                                className="py-2"
                                            >
                                                <div className="flex items-center justify-between">
                                                    <span className="text-sm font-bold tracking-widest text-primary uppercase">
                                                        {group.key}
                                                    </span>
                                                    <Badge
                                                        variant="secondary"
                                                        className="h-5 font-mono text-[10px]"
                                                    >
                                                        {groupChecked}/
                                                        {group.actions.length}
                                                    </Badge>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                        {group.actions.map((action) => (
                                            <TableRow
                                                key={permissionName(
                                                    group.key,
                                                    action.key,
                                                )}
                                                className="cursor-pointer"
                                                onClick={() =>
                                                    onToggle(
                                                        group.key,
                                                        action.key,
                                                        !action.checked,
                                                    )
                                                }
                                            >
                                                <TableCell
                                                    className="py-2 text-center"
                                                    onClick={(event) =>
                                                        event.stopPropagation()
                                                    }
                                                >
                                                    <Checkbox
                                                        checked={action.checked}
                                                        onCheckedChange={(
                                                            checked,
                                                        ) =>
                                                            onToggle(
                                                                group.key,
                                                                action.key,
                                                                !!checked,
                                                            )
                                                        }
                                                    />
                                                </TableCell>
                                                <TableCell className="py-2 text-sm font-medium capitalize">
                                                    {action.key}
                                                </TableCell>
                                                <TableCell className="py-2">
                                                    <span className="w-fit rounded border border-border/20 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/80">
                                                        {permissionName(
                                                            group.key,
                                                            action.key,
                                                        )}
                                                    </span>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </Fragment>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>

            <p className="text-xs text-muted-foreground italic">
                * Nhấp vào hàng để chọn nhanh quyền
            </p>
        </div>
    );
}
