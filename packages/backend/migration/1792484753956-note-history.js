/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ノートを編集する前の本文と CW を残すテーブルを作る

export class NoteHistory1792484753956 {
    name = 'NoteHistory1792484753956'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "note_history" ("id" character varying(32) NOT NULL, "noteId" character varying(32) NOT NULL, "text" text, "cw" character varying(512), CONSTRAINT "PK_b8603c8aa42b803c7687e52c2c0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_1e2492ba7582bf830b750a2962" ON "note_history" ("noteId") `);
        await queryRunner.query(`ALTER TABLE "note_history" ADD CONSTRAINT "FK_1e2492ba7582bf830b750a29627" FOREIGN KEY ("noteId") REFERENCES "note"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "note_history" DROP CONSTRAINT "FK_1e2492ba7582bf830b750a29627"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1e2492ba7582bf830b750a2962"`);
        await queryRunner.query(`DROP TABLE "note_history"`);
    }
}
