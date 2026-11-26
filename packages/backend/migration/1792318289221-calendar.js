/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// カレンダー機能: イベント・購読・ノートとの紐づけ・送ったリマインダーの記録のテーブルと、
// user_profile のカレンダー配信の鍵と通知の設定

export class Calendar1792318289221 {
    name = 'Calendar1792318289221'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "calendar_event" ("id" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "title" character varying(128) NOT NULL, "startsAt" TIMESTAMP WITH TIME ZONE NOT NULL, "endsAt" TIMESTAMP WITH TIME ZONE, "isAllDay" boolean NOT NULL DEFAULT false, "location" character varying(256), "description" text, "hashtag" character varying(128), "announcementNoteId" character varying(32), "canceledAt" TIMESTAMP WITH TIME ZONE, "updatedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_176fe24e6eb48c3fef696c7641f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_791a98103dd3b4cb694b254b97" ON "calendar_event" ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_9cb45137f5b36b0fb28ca243ef" ON "calendar_event" ("startsAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_2382a55caa8a2840e16a93e46a" ON "calendar_event" ("announcementNoteId") `);
        await queryRunner.query(`CREATE TABLE "calendar_event_subscription" ("id" character varying(32) NOT NULL, "eventId" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, CONSTRAINT "PK_2c5b5685f4cf59edccdb5e0a87b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_f6500c2e4ac2cb6f23b85d0366" ON "calendar_event_subscription" ("userId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_bcaac9893ff6906329c1df2597" ON "calendar_event_subscription" ("eventId", "userId") `);
        await queryRunner.query(`CREATE TABLE "calendar_event_note" ("id" character varying(32) NOT NULL, "eventId" character varying(32) NOT NULL, "noteId" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, CONSTRAINT "REL_d793eb9b39ed707fbec989633a" UNIQUE ("noteId"), CONSTRAINT "PK_5b057fbd513856de8ab4aaacc29" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9621767daf95b88604fa2a4c35" ON "calendar_event_note" ("eventId") `);
        await queryRunner.query(`CREATE INDEX "IDX_75737d3b5408834bbd6abc18eb" ON "calendar_event_note" ("userId") `);
        await queryRunner.query(`CREATE TABLE "calendar_event_reminder" ("id" character varying(32) NOT NULL, "eventId" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "kind" character varying(16) NOT NULL, CONSTRAINT "PK_0e0f661ec2919996f9468954919" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_18dd910c0855c1a4306de53a01" ON "calendar_event_reminder" ("userId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_384164eb28025ab36b77b6b4f4" ON "calendar_event_reminder" ("eventId", "userId", "kind") `);
        await queryRunner.query(`ALTER TABLE "user_profile" ADD "calendarFeedToken" character varying(64)`);
        await queryRunner.query(`ALTER TABLE "user_profile" ADD "calendarNotificationSettings" jsonb NOT NULL DEFAULT '{"week":true,"day":true,"today":true,"changes":true}'`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c68f79a9c48a84c500e490a9dc" ON "user_profile" ("calendarFeedToken") `);
        await queryRunner.query(`ALTER TABLE "calendar_event" ADD CONSTRAINT "FK_791a98103dd3b4cb694b254b972" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "calendar_event" ADD CONSTRAINT "FK_2382a55caa8a2840e16a93e46a4" FOREIGN KEY ("announcementNoteId") REFERENCES "note"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "calendar_event_subscription" ADD CONSTRAINT "FK_50ce93b3834ecec2c12a6d5163c" FOREIGN KEY ("eventId") REFERENCES "calendar_event"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "calendar_event_subscription" ADD CONSTRAINT "FK_f6500c2e4ac2cb6f23b85d03663" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "calendar_event_note" ADD CONSTRAINT "FK_9621767daf95b88604fa2a4c353" FOREIGN KEY ("eventId") REFERENCES "calendar_event"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "calendar_event_note" ADD CONSTRAINT "FK_d793eb9b39ed707fbec989633a5" FOREIGN KEY ("noteId") REFERENCES "note"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "calendar_event_note" ADD CONSTRAINT "FK_75737d3b5408834bbd6abc18ebb" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "calendar_event_reminder" ADD CONSTRAINT "FK_d0b44947a5d55a34db6e0ed0b85" FOREIGN KEY ("eventId") REFERENCES "calendar_event"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "calendar_event_reminder" ADD CONSTRAINT "FK_18dd910c0855c1a4306de53a013" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "calendar_event_reminder" DROP CONSTRAINT "FK_18dd910c0855c1a4306de53a013"`);
        await queryRunner.query(`ALTER TABLE "calendar_event_reminder" DROP CONSTRAINT "FK_d0b44947a5d55a34db6e0ed0b85"`);
        await queryRunner.query(`ALTER TABLE "calendar_event_note" DROP CONSTRAINT "FK_75737d3b5408834bbd6abc18ebb"`);
        await queryRunner.query(`ALTER TABLE "calendar_event_note" DROP CONSTRAINT "FK_d793eb9b39ed707fbec989633a5"`);
        await queryRunner.query(`ALTER TABLE "calendar_event_note" DROP CONSTRAINT "FK_9621767daf95b88604fa2a4c353"`);
        await queryRunner.query(`ALTER TABLE "calendar_event_subscription" DROP CONSTRAINT "FK_f6500c2e4ac2cb6f23b85d03663"`);
        await queryRunner.query(`ALTER TABLE "calendar_event_subscription" DROP CONSTRAINT "FK_50ce93b3834ecec2c12a6d5163c"`);
        await queryRunner.query(`ALTER TABLE "calendar_event" DROP CONSTRAINT "FK_2382a55caa8a2840e16a93e46a4"`);
        await queryRunner.query(`ALTER TABLE "calendar_event" DROP CONSTRAINT "FK_791a98103dd3b4cb694b254b972"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c68f79a9c48a84c500e490a9dc"`);
        await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "calendarNotificationSettings"`);
        await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "calendarFeedToken"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_384164eb28025ab36b77b6b4f4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_18dd910c0855c1a4306de53a01"`);
        await queryRunner.query(`DROP TABLE "calendar_event_reminder"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_75737d3b5408834bbd6abc18eb"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9621767daf95b88604fa2a4c35"`);
        await queryRunner.query(`DROP TABLE "calendar_event_note"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bcaac9893ff6906329c1df2597"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f6500c2e4ac2cb6f23b85d0366"`);
        await queryRunner.query(`DROP TABLE "calendar_event_subscription"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2382a55caa8a2840e16a93e46a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9cb45137f5b36b0fb28ca243ef"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_791a98103dd3b4cb694b254b97"`);
        await queryRunner.query(`DROP TABLE "calendar_event"`);
    }
}
