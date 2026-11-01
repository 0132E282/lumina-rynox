<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cvs', function (Blueprint $table) {
            // * Free text such as "35-45 triệu"; only read by the AI that scores jobs against this CV.
            $table->string('expected_salary', 100)->nullable()->after('position');
        });
    }

    public function down(): void
    {
        Schema::table('cvs', function (Blueprint $table) {
            $table->dropColumn('expected_salary');
        });
    }
};
