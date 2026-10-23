/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// キャンパス・ピシンごとの本科への入学時期 (42 API の 42cursus の在籍者から集計する) を保存するテーブルを作る

export class IntraCohorts1792429993337 {
    name = 'IntraCohorts1792429993337'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "intra_cohort" ("id" character varying(32) NOT NULL, "campusId" integer NOT NULL, "poolYearMonth" character varying(4) NOT NULL, "cohortYearMonth" character varying(4) NOT NULL, "userCount" integer NOT NULL, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_b2fb10eecd873e9e918aa42ae03" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e717926276bcccf14f146deed1" ON "intra_cohort" ("campusId", "poolYearMonth") `);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "public"."IDX_e717926276bcccf14f146deed1"`);
        await queryRunner.query(`DROP TABLE "intra_cohort"`);
    }
}
