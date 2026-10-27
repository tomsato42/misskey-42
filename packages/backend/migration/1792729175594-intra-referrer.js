/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 2次元コードから登録した人に、コードを見せた人 (招待した人) のユーザー ID を残す。招待した人数の実績に使う

export class IntraReferrer1792729175594 {
    name = 'IntraReferrer1792729175594'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_profile" ADD "intraReferrerId" character varying(32)`);
        await queryRunner.query(`CREATE INDEX "IDX_8fb16ff6e5e6114cef979895f3" ON "user_profile" ("intraReferrerId") `);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "public"."IDX_8fb16ff6e5e6114cef979895f3"`);
        await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "intraReferrerId"`);
    }
}
