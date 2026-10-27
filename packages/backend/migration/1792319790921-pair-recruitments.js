/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42 の課題のペア募集 (pair_recruitment) と、募集への参加希望・参加 (pair_member) のテーブルを作る

export class PairRecruitments1792319790921 {
    name = 'PairRecruitments1792319790921'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "pair_recruitment" ("id" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "campusId" integer NOT NULL, "projectSlug" character varying(128) NOT NULL, "projectName" character varying(256) NOT NULL, "minGroupSize" integer NOT NULL, "maxGroupSize" integer NOT NULL, "teamSize" integer NOT NULL, "startTiming" character varying(16) NOT NULL, "startDate" date, "comment" character varying(512), "status" character varying(16) NOT NULL DEFAULT 'open', "closedReason" character varying(16), "acceptedCount" integer NOT NULL DEFAULT 0, "noteId" character varying(32), "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "closedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_f74f8b63c3444937bddcb6937be" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_2e2e8a36405f93dde11a33ad88" ON "pair_recruitment" ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_94bd7c2c53bc4a61347ea4929c" ON "pair_recruitment" ("campusId", "projectSlug") `);
        await queryRunner.query(`CREATE INDEX "IDX_3c2c57c111dc67b2282fc3e9c3" ON "pair_recruitment" ("status", "expiresAt") `);
        await queryRunner.query(`CREATE TABLE "pair_member" ("id" character varying(32) NOT NULL, "recruitmentId" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "status" character varying(16) NOT NULL, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_aa1a5e86486781f44a8a9815ffd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_59559c675b8c369f03317285f3" ON "pair_member" ("userId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_21978ffa72d1a45adcda0585c8" ON "pair_member" ("recruitmentId", "userId") `);
        await queryRunner.query(`ALTER TABLE "pair_recruitment" ADD CONSTRAINT "FK_2e2e8a36405f93dde11a33ad884" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "pair_recruitment" ADD CONSTRAINT "FK_171030c5e31f54a0ee8ac7cd0f1" FOREIGN KEY ("noteId") REFERENCES "note"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "pair_member" ADD CONSTRAINT "FK_2481ac8808ab184667a1bf88345" FOREIGN KEY ("recruitmentId") REFERENCES "pair_recruitment"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "pair_member" ADD CONSTRAINT "FK_59559c675b8c369f03317285f30" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "pair_member" DROP CONSTRAINT "FK_59559c675b8c369f03317285f30"`);
        await queryRunner.query(`ALTER TABLE "pair_member" DROP CONSTRAINT "FK_2481ac8808ab184667a1bf88345"`);
        await queryRunner.query(`ALTER TABLE "pair_recruitment" DROP CONSTRAINT "FK_171030c5e31f54a0ee8ac7cd0f1"`);
        await queryRunner.query(`ALTER TABLE "pair_recruitment" DROP CONSTRAINT "FK_2e2e8a36405f93dde11a33ad884"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_21978ffa72d1a45adcda0585c8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_59559c675b8c369f03317285f3"`);
        await queryRunner.query(`DROP TABLE "pair_member"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3c2c57c111dc67b2282fc3e9c3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_94bd7c2c53bc4a61347ea4929c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2e2e8a36405f93dde11a33ad88"`);
        await queryRunner.query(`DROP TABLE "pair_recruitment"`);
    }
}
