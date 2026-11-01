<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mailboxes', function (Blueprint $table) {
            $table->id();
            $table->string('label')->nullable();
            $table->string('email');
            $table->enum('provider_preset', ['gmail', 'outlook', 'imap'])->default('imap');
            $table->string('imap_host');
            $table->unsignedSmallInteger('imap_port')->default(993);
            $table->enum('imap_encryption', ['ssl', 'starttls'])->default('ssl');
            $table->string('smtp_host');
            $table->unsignedSmallInteger('smtp_port')->default(587);
            $table->enum('smtp_encryption', ['ssl', 'starttls'])->default('starttls');
            $table->string('username');
            // * Encrypted array `{password}` (cast `encrypted:array`); never exposed to the client.
            $table->text('credentials')->nullable();
            $table->unsignedSmallInteger('sync_interval_minutes')->default(5);
            $table->boolean('save_sent_copy')->default(false);
            $table->enum('status', ['connected', 'error', 'disconnected'])->default('connected');
            // * Fixed sentences only (never a library exception message): it is shown in the UI and must not leak hosts or addresses.
            $table->text('last_error')->nullable();
            $table->timestamp('last_synced_at')->nullable();
            $table->timestamp('next_sync_at')->nullable();
            // * Set on a wrong-password reply: `mail:sync` skips the mailbox until the credentials are saved again (avoids provider lockouts).
            $table->timestamp('auth_failed_at')->nullable();
            $table->timestamps();

            $table->unique('email');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mailboxes');
    }
};
