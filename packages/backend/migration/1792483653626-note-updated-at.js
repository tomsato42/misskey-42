/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ノートの本文・CW を編集した日時

export class NoteUpdatedAt1792483653626 {
    name = 'NoteUpdatedAt1792483653626'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "note" ADD "updatedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`COMMENT ON COLUMN "note"."updatedAt" IS 'The updated date of the Note.'`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "note" DROP COLUMN "updatedAt"`);
    }
}
