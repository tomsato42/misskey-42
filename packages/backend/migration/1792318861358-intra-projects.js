/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42 intra の課題 (キャンパスごとの登録の条件) のキャッシュと、ユーザーの課題の状態・達成したクエストを保存するテーブルを作る

export class IntraProjects1792318861358 {
    name = 'IntraProjects1792318861358'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "intra_project" ("id" character varying(32) NOT NULL, "projectId" integer NOT NULL, "slug" character varying(128) NOT NULL, "name" character varying(256) NOT NULL, "campusId" integer NOT NULL, "cursusId" integer NOT NULL, "sessionId" integer NOT NULL, "minGroupSize" integer, "maxGroupSize" integer, "requiredQuests" character varying(128) array NOT NULL DEFAULT '{}', "requiredAnyQuests" jsonb NOT NULL DEFAULT '[]', "forbiddenQuests" character varying(128) array NOT NULL DEFAULT '{}', "exclusiveProjects" character varying(128) array NOT NULL DEFAULT '{}', "requiredProjects" character varying(128) array NOT NULL DEFAULT '{}', "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_00b5524064e763578e93244907c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_0b7417ed4ba56c4f9524e34f02" ON "intra_project" ("campusId", "slug") `);
        await queryRunner.query(`CREATE TABLE "intra_user_progress" ("userId" character varying(32) NOT NULL, "campusId" integer, "projectStatuses" jsonb NOT NULL DEFAULT '{}', "validatedQuests" character varying(128) array NOT NULL DEFAULT '{}', "projectsSyncedAt" TIMESTAMP WITH TIME ZONE, "questsSyncedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_6c8ad95ec9c8d79d67e9024f1aa" PRIMARY KEY ("userId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b5d644d6dc60ec1edf9bcd3685" ON "intra_user_progress" ("campusId") `);
        await queryRunner.query(`ALTER TABLE "intra_user_progress" ADD CONSTRAINT "FK_6c8ad95ec9c8d79d67e9024f1aa" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "intra_user_progress" DROP CONSTRAINT "FK_6c8ad95ec9c8d79d67e9024f1aa"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b5d644d6dc60ec1edf9bcd3685"`);
        await queryRunner.query(`DROP TABLE "intra_user_progress"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0b7417ed4ba56c4f9524e34f02"`);
        await queryRunner.query(`DROP TABLE "intra_project"`);
    }
}
