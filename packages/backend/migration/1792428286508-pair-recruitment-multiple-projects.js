/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ペア募集に複数の課題をまとめられるようにする (pair_recruitment.projects / projectSlugs)。
// 参加希望にやりたい課題 (pair_member.wantedProjectSlugs) を持たせ、招待を受け取るかの設定 (user_profile.pairInvitationsEnabled) を足す。
// 既存の募集は今の 1 つの課題だけをまとめた募集にし、既存の参加希望はその課題をやりたいものとする

export class PairRecruitmentMultipleProjects1792428286508 {
    name = 'PairRecruitmentMultipleProjects1792428286508'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "pair_recruitment" ADD "projects" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "pair_recruitment" ADD "projectSlugs" character varying(128) array NOT NULL DEFAULT '{}'`);
        await queryRunner.query(`ALTER TABLE "pair_member" ADD "wantedProjectSlugs" character varying(128) array NOT NULL DEFAULT '{}'`);
        await queryRunner.query(`ALTER TABLE "user_profile" ADD "pairInvitationsEnabled" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`UPDATE "pair_recruitment" SET "projects" = jsonb_build_array(jsonb_build_object('slug', "projectSlug", 'name', "projectName", 'minGroupSize', "minGroupSize", 'maxGroupSize', "maxGroupSize")), "projectSlugs" = ARRAY["projectSlug"]`);
        await queryRunner.query(`UPDATE "pair_member" SET "wantedProjectSlugs" = ARRAY[r."projectSlug"] FROM "pair_recruitment" r WHERE r."id" = "pair_member"."recruitmentId"`);
        await queryRunner.query(`CREATE INDEX "IDX_PAIR_RECRUITMENT_PROJECT_SLUGS" ON "pair_recruitment" USING GIN ("projectSlugs")`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "public"."IDX_PAIR_RECRUITMENT_PROJECT_SLUGS"`);
        // 招待は前のバージョンに無いので消す
        await queryRunner.query(`DELETE FROM "pair_member" WHERE "status" IN ('invited', 'declined')`);
        await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "pairInvitationsEnabled"`);
        await queryRunner.query(`ALTER TABLE "pair_member" DROP COLUMN "wantedProjectSlugs"`);
        await queryRunner.query(`ALTER TABLE "pair_recruitment" DROP COLUMN "projectSlugs"`);
        await queryRunner.query(`ALTER TABLE "pair_recruitment" DROP COLUMN "projects"`);
    }
}
