/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ノートの翻訳に DeepL ではなく Claude を使う設定と、そのモデル

export class ClaudeTranslation1793001171800 {
    name = 'ClaudeTranslation1793001171800'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" ADD "anthropicTranslationEnabled" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "meta" ADD "anthropicTranslationModel" character varying(128) NOT NULL DEFAULT 'claude-haiku-5-5'`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "anthropicTranslationModel"`);
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "anthropicTranslationEnabled"`);
    }
}
