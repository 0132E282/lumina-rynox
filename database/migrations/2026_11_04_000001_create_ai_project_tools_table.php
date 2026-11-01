<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // * A row exists only while a skill, agent or MCP server is switched ON for one project of one admin (default: off).
        Schema::create('ai_project_tools', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('admins')->cascadeOnDelete();
            $table->string('project', 120);
            $table->string('kind', 10);
            $table->string('name', 120);
            $table->timestamps();

            $table->unique(['user_id', 'project', 'kind', 'name']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_project_tools');
    }
};
