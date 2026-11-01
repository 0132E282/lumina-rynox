<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mail_folders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('mailbox_id')->constrained()->cascadeOnDelete();
            $table->enum('role', ['inbox', 'sent']);
            // * Real server-side name, e.g. "[Gmail]/Sent Mail".
            $table->string('name');
            $table->unsignedBigInteger('uid_validity')->nullable();
            $table->unsignedBigInteger('last_uid')->default(0);
            $table->timestamp('synced_at')->nullable();
            $table->timestamps();

            $table->unique(['mailbox_id', 'role']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mail_folders');
    }
};
