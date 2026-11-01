<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // * Databases created before pinning existed lack the column; fresh ones already have it from the create migration.
        if (Schema::hasColumn('conversations', 'pinned_at')) {
            return;
        }

        Schema::table('conversations', function (Blueprint $table) {
            $table->timestamp('pinned_at')->nullable();
            $table->index('pinned_at');
        });
    }

    public function down(): void
    {
        // * The create migration owns the column on fresh databases, so a rollback here must not remove it.
    }
};
