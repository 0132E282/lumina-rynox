<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * One Zalo account signed in on the Zalo sidecar. Owns its session: scopes, group mode and state are per account.
 *
 * @property int $id
 * @property int $integration_id
 * @property string $account_key the Zalo uid
 * @property string|null $name
 * @property array<string, string>|null $credentials encrypted; never leaves the server
 * @property string $status `connected|error|disconnected`
 * @property array<int, string>|null $permissions scopes ticked for this account; null = defaults
 * @property string|null $group_mode
 * @property string|null $last_error
 * @property string|null $bridge_state
 * @property Carbon|null $bridge_state_at
 * @property Carbon|null $connected_at
 * @property Carbon|null $contacts_synced_at
 */
class ZaloAccount extends Model
{
    public const PERMISSIONS = ['receive', 'reply', 'proactive'];

    // * An account without stored scopes keeps the channel defaults: `proactive` off (unofficial channel), the others on.
    public const DEFAULT_PERMISSIONS = ['receive', 'reply'];

    public const GROUP_MODE_MENTION_ONLY = 'mention_only';

    public const GROUP_MODE_ALL = 'all';

    public const GROUP_MODE_OFF = 'off';

    public const GROUP_MODES = [self::GROUP_MODE_MENTION_ONLY, self::GROUP_MODE_ALL, self::GROUP_MODE_OFF];

    protected $fillable = [
        'integration_id',
        'account_key',
        'name',
        'credentials',
        'status',
        'permissions',
        'group_mode',
        'last_error',
        'bridge_state',
        'bridge_state_at',
        'connected_at',
        'contacts_synced_at',
    ];

    // ! The session is a login credential: hidden from serialisation.
    protected $hidden = ['credentials'];

    protected $casts = [
        'credentials' => 'encrypted:array',
        'permissions' => 'array',
        'bridge_state_at' => 'datetime',
        'connected_at' => 'datetime',
        'contacts_synced_at' => 'datetime',
    ];

    /** @return BelongsTo<Integration, $this> */
    public function integration(): BelongsTo
    {
        return $this->belongsTo(Integration::class);
    }

    /** @return HasMany<Conversation, $this> */
    public function conversations(): HasMany
    {
        return $this->hasMany(Conversation::class);
    }

    /** @return list<string> */
    public function effectivePermissions(): array
    {
        return is_array($this->permissions) ? array_values($this->permissions) : self::DEFAULT_PERMISSIONS;
    }

    public function allows(string $permission): bool
    {
        return in_array($permission, $this->effectivePermissions(), true);
    }

    public function effectiveGroupMode(): string
    {
        return in_array($this->group_mode, [self::GROUP_MODE_ALL, self::GROUP_MODE_OFF], true) ? $this->group_mode : self::GROUP_MODE_MENTION_ONLY;
    }
}
