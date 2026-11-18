/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ノートに付けた 42 intra のレベルを保存するテーブルを作る

export class IntraLevelNotes1792443292129 {
    name = 'IntraLevelNotes1792443292129'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "intra_level_note" ("noteId" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "level" integer NOT NULL, CONSTRAINT "PK_9dc7b89fb6eaa1474afe929f4aa" PRIMARY KEY ("noteId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b96bfae403a56d2d56e947dd41" ON "intra_level_note"  ("userId") `);
        await queryRunner.query(`ALTER TABLE "intra_level_note" ADD CONSTRAINT "FK_9dc7b89fb6eaa1474afe929f4aa" FOREIGN KEY ("noteId") REFERENCES "note"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "intra_level_note" ADD CONSTRAINT "FK_b96bfae403a56d2d56e947dd41b" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "intra_level_note" DROP CONSTRAINT "FK_b96bfae403a56d2d56e947dd41b"`);
        await queryRunner.query(`ALTER TABLE "intra_level_note" DROP CONSTRAINT "FK_9dc7b89fb6eaa1474afe929f4aa"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b96bfae403a56d2d56e947dd41"`);
        await queryRunner.query(`DROP TABLE "intra_level_note"`);
    }
}
