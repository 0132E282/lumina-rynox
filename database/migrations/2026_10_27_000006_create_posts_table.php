<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('posts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('admin_id')->nullable()->constrained('admins')->nullOnDelete();
            $table->string('title')->nullable();
            $table->text('body');
            // * List of `{url, type: image|video}` attachments; platforms fetch them by public URL.
            $table->json('media')->nullable();
            // * UTC instant; the form reads and writes it in `cms.personal_timezone`.
            $table->timestamp('scheduled_at')->nullable();
            // * `missed`: scheduled time passed by more than `posting.late_after_minutes`; waits for a manual decision.
            $table->enum('status', ['draft', 'scheduled', 'publishing', 'published', 'partial', 'failed', 'missed'])->default('draft');
            $table->timestamps();

            $table->index(['status', 'scheduled_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('posts');
    }
};
