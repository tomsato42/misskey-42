/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 絵文字のタグとカテゴリの提案すべてに添える、管理者の指示

export class EmojiTaggingInstructions1793042571900 {
    name = 'EmojiTaggingInstructions1793042571900'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" ADD "anthropicEmojiTaggingInstructions" character varying(2000)`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "anthropicEmojiTaggingInstructions"`);
    }
}
