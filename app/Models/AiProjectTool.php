<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * One skill, agent or MCP server switched on for one project (`owner/name` or `local:<root>`) of one admin.
 *
 * @property int $user_id
 * @property string $project
 * @property string $kind skill|agent|mcp
 * @property string $name
 */
class AiProjectTool extends Model
{
    public const KINDS = ['skill', 'agent', 'mcp'];

    protected $fillable = ['user_id', 'project', 'kind', 'name'];
}
