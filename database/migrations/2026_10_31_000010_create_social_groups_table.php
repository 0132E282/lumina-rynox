<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('social_groups', function (Blueprint $table) {
            $table->id();
            // * The posting provider key (`facebook_personal`, `linkedin_personal`).
            $table->string('provider', 32);
            $table->string('external_id', 100);
            $table->string('name', 150);
            $table->string('url', 2048);
            $table->timestamp('synced_at');
            $table->timestamps();

            $table->unique(['provider', 'external_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('social_groups');
    }
};
