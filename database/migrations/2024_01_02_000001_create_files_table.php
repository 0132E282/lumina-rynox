<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('files', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->nullable()->unique();
            $table->foreignId('parent_id')->nullable()->constrained('files')->cascadeOnDelete();
            $table->enum('type', ['file', 'folder'])->default('file');
            $table->string('name');
            $table->string('original_name')->nullable();
            $table->string('path')->nullable();
            $table->string('full_path')->nullable();
            $table->string('disk')->nullable();
            $table->string('mime_type')->nullable();
            $table->string('extension', 16)->nullable();
            $table->unsignedBigInteger('size')->default(0);
            $table->string('alt')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('admins')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('files');
    }
};
