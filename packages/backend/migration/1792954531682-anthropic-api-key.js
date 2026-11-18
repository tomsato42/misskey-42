/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 絵文字のタグを Claude に提案させるための API キーとモデル。管理者だけが使う

export class AnthropicApiKey1792954531682 {
    name = 'AnthropicApiKey1792954531682'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" ADD "anthropicApiKey" character varying(1024)`);
        await queryRunner.query(`ALTER TABLE "meta" ADD "anthropicModel" character varying(128) NOT NULL DEFAULT 'claude-sonnet-5-5'`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "anthropicModel"`);
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "anthropicApiKey"`);
    }
}
