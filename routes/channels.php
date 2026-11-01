<?php

use App\Models\Admin;
use App\Support\ResourcePermission;
use Illuminate\Support\Facades\Broadcast;

// * Realtime /chat signal channel (`private-chat` on the client): only admins who may view conversations.
Broadcast::channel('chat', fn (Admin $user): bool => ResourcePermission::allows($user, 'conversations', 'view'));
