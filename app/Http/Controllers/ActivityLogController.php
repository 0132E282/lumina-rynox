<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Inertia\Inertia;
use Inertia\Response;
use Spatie\Activitylog\Models\Activity;

class ActivityLogController extends Controller
{
    private const GROUPS = [
        'login' => ['login', 'logout'],
        'admin_crud' => ['created', 'updated', 'deleted', 'import', 'export'],
    ];

    public function index(Request $request): Response
    {
        $search = $request->string('search')->trim()->toString();
        $group = $request->string('group')->trim()->toString();
        $group = array_key_exists($group, self::GROUPS) ? $group : 'admin_crud';
        $event = $request->string('event')->trim()->toString();
        $logName = $request->string('log_name')->trim()->toString();
        $from = $request->string('from')->trim()->toString();
        $to = $request->string('to')->trim()->toString();

        $groupEvents = self::GROUPS[$group];

        $logs = Activity::query()
            ->with('causer', 'subject')
            ->whereIn('event', $groupEvents)
            ->when($search, fn ($query) => $query->where('description', 'like', "%{$search}%"))
            ->when($event && in_array($event, $groupEvents, true), fn ($query) => $query->where('event', $event))
            ->when($logName, fn ($query) => $query->where('log_name', $logName))
            ->when($from, fn ($query) => $query->whereDate('created_at', '>=', $from))
            ->when($to, fn ($query) => $query->whereDate('created_at', '<=', $to))
            ->latest()
            ->paginate(20)
            ->withQueryString()
            ->through(fn (Activity $activity) => [
                'id' => $activity->id,
                'description' => $activity->description,
                'event' => $activity->event,
                'log_name' => $activity->log_name,
                'subject_type' => $activity->subject_type ? class_basename($activity->subject_type) : null,
                'subject_id' => $activity->subject_id,
                'causer_name' => $activity->causer?->name ?? 'Hệ thống',
                'properties' => $activity->properties,
                'created_at' => $activity->created_at,
            ]);

        $groupCounts = Activity::query()
            ->selectRaw('event, count(*) as total')
            ->whereNotNull('event')
            ->groupBy('event')
            ->pluck('total', 'event');

        $countsByGroup = [];
        foreach (self::GROUPS as $groupKey => $events) {
            $countsByGroup[$groupKey] = collect($events)->sum(fn ($event) => $groupCounts->get($event, 0));
        }

        return Inertia::render('activity-logs/index', [
            'logs' => $logs,
            'search' => $search,
            'group' => $group,
            'event' => $event,
            'logName' => $logName,
            'from' => $from,
            'to' => $to,
            'logNames' => Activity::query()->whereIn('event', $groupEvents)->distinct()->orderBy('log_name')->pluck('log_name'),
            'groupCounts' => $countsByGroup,
            'stats' => [
                'total' => Activity::query()->whereIn('event', $groupEvents)->count(),
                'today' => Activity::query()->whereIn('event', $groupEvents)->whereDate('created_at', Carbon::today())->count(),
                'events' => $groupCounts->only($groupEvents),
            ],
        ]);
    }
}
