<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('apps', function (Blueprint $table) {
            // Port reserved for the idle blue/green slot during zero-downtime deploys
            $table->integer('standby_port')->nullable()->after('port');
            // null = app runs from deploy_path (classic deploy), otherwise 'blue' or 'green'
            $table->string('active_slot')->nullable()->after('standby_port');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('apps', function (Blueprint $table) {
            $table->dropColumn(['standby_port', 'active_slot']);
        });
    }
};
