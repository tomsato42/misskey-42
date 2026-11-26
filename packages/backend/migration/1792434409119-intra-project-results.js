/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42 intra の課題の結果 (点数・チーム・outstanding) と、それを付けたノートを保存するテーブルを作る

export class IntraProjectResults1792434409119 {
    name = 'IntraProjectResults1792434409119'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "intra_project_result" ("id" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "projectsUserId" integer NOT NULL, "projectSlug" character varying(128) NOT NULL, "projectName" character varying(256) NOT NULL, "finalMark" integer NOT NULL, "validated" boolean NOT NULL, "markedAt" TIMESTAMP WITH TIME ZONE, "teamId" integer, "members" jsonb NOT NULL DEFAULT '[]', "outstandingCount" integer, "detailsTeamId" integer, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_d5322982097d586042025e0f7a6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_7f8a336cbc7afc27d39813411b" ON "intra_project_result"  ("userId", "projectsUserId") `);
        await queryRunner.query(`CREATE TABLE "intra_project_note" ("noteId" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "projectSlug" character varying(128) NOT NULL, "projectName" character varying(256) NOT NULL, "finalMark" integer NOT NULL, "validated" boolean NOT NULL, "outstandingCount" integer, "members" jsonb NOT NULL DEFAULT '[]', CONSTRAINT "PK_776d512a1d9895cff7f978d01df" PRIMARY KEY ("noteId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3f1f08b792f66e2aa8c681caca" ON "intra_project_note"  ("userId") `);
        await queryRunner.query(`ALTER TABLE "intra_user_progress" ADD "resultsSyncedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "intra_project_result" ADD CONSTRAINT "FK_ed21ffef126b50e430d31877bb6" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "intra_project_note" ADD CONSTRAINT "FK_776d512a1d9895cff7f978d01df" FOREIGN KEY ("noteId") REFERENCES "note"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "intra_project_note" ADD CONSTRAINT "FK_3f1f08b792f66e2aa8c681cacab" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "intra_project_note" DROP CONSTRAINT "FK_3f1f08b792f66e2aa8c681cacab"`);
        await queryRunner.query(`ALTER TABLE "intra_project_note" DROP CONSTRAINT "FK_776d512a1d9895cff7f978d01df"`);
        await queryRunner.query(`ALTER TABLE "intra_project_result" DROP CONSTRAINT "FK_ed21ffef126b50e430d31877bb6"`);
        await queryRunner.query(`ALTER TABLE "intra_user_progress" DROP COLUMN "resultsSyncedAt"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3f1f08b792f66e2aa8c681caca"`);
        await queryRunner.query(`DROP TABLE "intra_project_note"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7f8a336cbc7afc27d39813411b"`);
        await queryRunner.query(`DROP TABLE "intra_project_result"`);
    }
}
