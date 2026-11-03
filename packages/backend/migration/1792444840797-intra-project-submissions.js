/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42 intra の課題の結果に提出 (チーム) ごとの結果を、ノートに付けた結果に何回目の提出かと intra のログイン名を足す

export class IntraProjectSubmissions1792444840797 {
    name = 'IntraProjectSubmissions1792444840797'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "intra_project_result" ADD "submissions" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "intra_project_result" ADD "submissionsTeamId" integer`);
        await queryRunner.query(`ALTER TABLE "intra_project_note" ADD "attemptNumber" integer`);
        await queryRunner.query(`ALTER TABLE "intra_project_note" ADD "attemptCount" integer`);
        await queryRunner.query(`ALTER TABLE "intra_project_note" ADD "markedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "intra_project_note" ADD "intraLogin" character varying(64)`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "intra_project_note" DROP COLUMN "intraLogin"`);
        await queryRunner.query(`ALTER TABLE "intra_project_note" DROP COLUMN "markedAt"`);
        await queryRunner.query(`ALTER TABLE "intra_project_note" DROP COLUMN "attemptCount"`);
        await queryRunner.query(`ALTER TABLE "intra_project_note" DROP COLUMN "attemptNumber"`);
        await queryRunner.query(`ALTER TABLE "intra_project_result" DROP COLUMN "submissionsTeamId"`);
        await queryRunner.query(`ALTER TABLE "intra_project_result" DROP COLUMN "submissions"`);
    }
}
