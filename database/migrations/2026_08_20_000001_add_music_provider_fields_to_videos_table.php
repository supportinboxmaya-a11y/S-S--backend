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
        Schema::table('videos', function (Blueprint $table) {
            $table->string('provider_track_id')->nullable()->index()->after('sound_id');
            $table->string('music_provider')->nullable()->after('provider_track_id');
            $table->json('music_metadata')->nullable()->after('music_provider');
            $table->json('music_licensing')->nullable()->after('music_metadata');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('videos', function (Blueprint $table) {
            $table->dropColumn(['provider_track_id', 'music_provider', 'music_metadata', 'music_licensing']);
        });
    }
};