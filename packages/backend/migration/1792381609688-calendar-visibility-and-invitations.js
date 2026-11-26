/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// カレンダー: イベントの公開範囲 (全員・フォロワー・相互フォロー・指定ユーザー・リスト) と、イベントへの招待の表。
// 通知の設定の既定値に「招待」を足す (既に保存されている設定は、項目が無ければオンとして扱う)

export class CalendarVisibilityAndInvitations1792381609688 {
    name = 'CalendarVisibilityAndInvitations1792381609688'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "calendar_event_invitation" ("id" character varying(32) NOT NULL, "eventId" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "inviterId" character varying(32) NOT NULL, CONSTRAINT "PK_0ff587f9243f3dc5e8ba421cbe1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4238f5f8f77990668e71c25481" ON "calendar_event_invitation" ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_d84bab054c6b8ede54a0a6b2a4" ON "calendar_event_invitation" ("inviterId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_17b9e76b89ccbefaf3ca1bd0fc" ON "calendar_event_invitation" ("eventId", "userId") `);
        await queryRunner.query(`ALTER TABLE "calendar_event" ADD "visibility" character varying(16) NOT NULL DEFAULT 'public'`);
        await queryRunner.query(`ALTER TABLE "calendar_event" ADD "visibleUserIds" character varying(32) array NOT NULL DEFAULT '{}'`);
        await queryRunner.query(`ALTER TABLE "calendar_event" ADD "userListId" character varying(32)`);
        await queryRunner.query(`ALTER TABLE "user_profile" ALTER COLUMN "calendarNotificationSettings" SET DEFAULT '{"week":true,"day":true,"today":true,"changes":true,"invited":true}'`);
        await queryRunner.query(`ALTER TABLE "calendar_event" ADD CONSTRAINT "FK_0c6460b322e3702d4d3c12cd2ca" FOREIGN KEY ("userListId") REFERENCES "user_list"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "calendar_event_invitation" ADD CONSTRAINT "FK_d86ea00152fc43b670843881fcb" FOREIGN KEY ("eventId") REFERENCES "calendar_event"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "calendar_event_invitation" ADD CONSTRAINT "FK_4238f5f8f77990668e71c25481a" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "calendar_event_invitation" ADD CONSTRAINT "FK_d84bab054c6b8ede54a0a6b2a43" FOREIGN KEY ("inviterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "calendar_event_invitation" DROP CONSTRAINT "FK_d84bab054c6b8ede54a0a6b2a43"`);
        await queryRunner.query(`ALTER TABLE "calendar_event_invitation" DROP CONSTRAINT "FK_4238f5f8f77990668e71c25481a"`);
        await queryRunner.query(`ALTER TABLE "calendar_event_invitation" DROP CONSTRAINT "FK_d86ea00152fc43b670843881fcb"`);
        await queryRunner.query(`ALTER TABLE "calendar_event" DROP CONSTRAINT "FK_0c6460b322e3702d4d3c12cd2ca"`);
        await queryRunner.query(`ALTER TABLE "user_profile" ALTER COLUMN "calendarNotificationSettings" SET DEFAULT '{"week":true,"day":true,"today":true,"changes":true}'`);
        await queryRunner.query(`ALTER TABLE "calendar_event" DROP COLUMN "userListId"`);
        await queryRunner.query(`ALTER TABLE "calendar_event" DROP COLUMN "visibleUserIds"`);
        await queryRunner.query(`ALTER TABLE "calendar_event" DROP COLUMN "visibility"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_17b9e76b89ccbefaf3ca1bd0fc"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d84bab054c6b8ede54a0a6b2a4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4238f5f8f77990668e71c25481"`);
        await queryRunner.query(`DROP TABLE "calendar_event_invitation"`);
    }
}
