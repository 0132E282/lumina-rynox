<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mail_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('mailbox_id')->constrained()->cascadeOnDelete();
            $table->foreignId('mail_folder_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('uid');
            // * Long header values are `text` (no index) so MySQL utf8mb4 index limits are never hit; lookups use `thread_key`.
            $table->text('message_id')->nullable();
            $table->text('in_reply_to')->nullable();
            $table->text('references')->nullable();
            // * sha1 of the thread's root Message-ID (see App\Services\Mail\ThreadKey).
            $table->string('thread_key', 64);
            $table->string('from_name')->nullable();
            $table->string('from_email')->nullable();
            $table->json('reply_to')->nullable();
            $table->json('to')->nullable();
            $table->json('cc')->nullable();
            $table->string('subject', 998)->nullable();
            $table->string('snippet', 255)->default('');
            $table->timestamp('sent_at')->nullable();
            $table->timestamp('received_at')->nullable();
            $table->boolean('seen')->default(false);
            $table->boolean('flagged')->default(false);
            $table->boolean('answered')->default(false);
            // * Local \Seen change not yet pushed to the server; pushed (idempotent) by the next sync.
            $table->boolean('flags_dirty')->default(false);
            $table->boolean('has_attachments')->default(false);
            // * Metadata only `[{name, mime, size}]`; attachment content is never stored.
            $table->json('attachments')->nullable();
            $table->unsignedInteger('size')->default(0);
            // * `body_html` is stored already sanitised (HtmlBodySanitizer); never write raw HTML here.
            $table->longText('body_html')->nullable();
            $table->longText('body_text')->nullable();
            $table->boolean('body_truncated')->default(false);
            $table->timestamp('body_fetched_at')->nullable();
            $table->timestamps();

            $table->unique(['mail_folder_id', 'uid']);
            $table->index('thread_key');
            $table->index(['mailbox_id', 'received_at']);
            $table->index(['mail_folder_id', 'seen']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mail_messages');
    }
};
