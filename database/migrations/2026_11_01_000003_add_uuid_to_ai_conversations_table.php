<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        // * Public id of a chat thread (URLs and the API use it): the numeric id stays internal and cannot be guessed or counted from outside.
        Schema::table('ai_conversations', function (Blueprint $table) {
            $table->uuid('uuid')->nullable()->after('id');
        });

        DB::table('ai_conversations')->whereNull('uuid')->orderBy('id')->each(
            fn (object $row) => DB::table('ai_conversations')->where('id', $row->id)->update(['uuid' => (string) Str::uuid()]),
        );

        Schema::table('ai_conversations', function (Blueprint $table) {
            $table->unique('uuid');
        });
    }

    public function down(): void
    {
        Schema::table('ai_conversations', function (Blueprint $table) {
            $table->dropUnique(['uuid']);
            $table->dropColumn('uuid');
        });
    }
};
