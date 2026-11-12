/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class IntraIntegration1792254367909 {
    name = 'IntraIntegration1792254367909'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "intra_role" ("id" character varying(32) NOT NULL, "roleId" character varying(32) NOT NULL, "kind" character varying(16) NOT NULL, "key" character varying(64) NOT NULL, CONSTRAINT "REL_6c7ce714feded05d525c883254" UNIQUE ("roleId"), CONSTRAINT "PK_bf11f0ad5ec3fdcc579319924fe" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_6a2bbe6edfc4fb911822c80f25" ON "intra_role" ("kind", "key") `);
        await queryRunner.query(`ALTER TABLE "user_profile" ADD "intraId" integer`);
        await queryRunner.query(`ALTER TABLE "user_profile" ADD "intraLogin" character varying(32)`);
        await queryRunner.query(`ALTER TABLE "user_profile" ADD "intraPoolYearMonth" character varying(4)`);
        await queryRunner.query(`ALTER TABLE "user_profile" ADD "intraBlackholedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "user_profile" ADD "intraPaceDeadlineAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "user_profile" ADD "intraSyncedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "user_profile" ADD "intraPasswordLoginAllowed" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_55aa846b4138109fb4dd60f0f9" ON "user_profile" ("intraId") `);
        await queryRunner.query(`ALTER TABLE "intra_role" ADD CONSTRAINT "FK_6c7ce714feded05d525c8832543" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        // 学内専用インスタンスとして運用するため、連合を無効にする
        await queryRunner.query(`UPDATE "meta" SET "federation" = 'none'`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        // federation を 'none' にする前の値は保存していないため、meta は巻き戻さない
        await queryRunner.query(`ALTER TABLE "intra_role" DROP CONSTRAINT "FK_6c7ce714feded05d525c8832543"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_55aa846b4138109fb4dd60f0f9"`);
        await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "intraPasswordLoginAllowed"`);
        await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "intraSyncedAt"`);
        await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "intraPaceDeadlineAt"`);
        await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "intraBlackholedAt"`);
        await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "intraPoolYearMonth"`);
        await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "intraLogin"`);
        await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "intraId"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6a2bbe6edfc4fb911822c80f25"`);
        await queryRunner.query(`DROP TABLE "intra_role"`);
    }
}
