<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('events', function (Blueprint $table) {
            $table->id();
            // * Recipient of in-app reminders: the admin who created the event.
            $table->foreignId('admin_id')->nullable()->constrained('admins')->nullOnDelete();
            $table->string('title');
            $table->string('type')->default('meeting');
            // * Wall-clock date and times in `cms.personal_timezone`; for a repeating event `date` is the first occurrence.
            $table->date('date');
            $table->time('starts_at');
            $table->time('ends_at');
            $table->string('repeat')->default('none');
            $table->text('location')->nullable();
            // * Minutes before the start to remind, e.g. [1440, 30].
            $table->json('remind_before_minutes')->nullable();
            // * Reminders already sent, as "{occurrence date}|{minutes}", so none is sent twice.
            $table->json('reminders_sent')->nullable();
            $table->timestamps();

            $table->index(['date', 'starts_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('events');
    }
};
