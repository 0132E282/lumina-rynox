import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { MessengerAccountPermission } from '@/types';

// * Not offered as a choice: it stays off for new accounts and keeps whatever an existing account already has.
const HIDDEN_PERMISSION = 'proactive';

/** * "Quyền và phạm vi" of ONE account: a checkbox per scope the channel offers. */
export function AccountPermissionsFieldset({
    idPrefix,
    permissions,
    selected,
    onToggle,
}: {
    idPrefix: string;
    permissions: MessengerAccountPermission[];
    selected: string[];
    onToggle: (key: string, checked: boolean) => void;
}) {
    return (
        <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-medium">
                Quyền và phạm vi
            </legend>
            {permissions
                .filter((permission) => permission.key !== HIDDEN_PERMISSION)
                .map((permission) => (
                    <div
                        key={permission.key}
                        className="flex items-start gap-3"
                    >
                        <Checkbox
                            id={`${idPrefix}-permission-${permission.key}`}
                            className="mt-0.5"
                            checked={selected.includes(permission.key)}
                            onCheckedChange={(checked) =>
                                onToggle(permission.key, checked === true)
                            }
                        />
                        <div className="grid gap-0.5">
                            <Label
                                htmlFor={`${idPrefix}-permission-${permission.key}`}
                            >
                                {permission.label}
                            </Label>
                            {permission.description !== '' && (
                                <span className="text-xs text-muted-foreground">
                                    {permission.description}
                                </span>
                            )}
                        </div>
                    </div>
                ))}
        </fieldset>
    );
}
