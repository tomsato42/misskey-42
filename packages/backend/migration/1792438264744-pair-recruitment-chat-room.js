/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ペア募集にチーム候補で話すチャットルームを持たせる

export class PairRecruitmentChatRoom1792438264744 {
    name = 'PairRecruitmentChatRoom1792438264744'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "pair_recruitment" ADD "chatRoomId" character varying(32)`);
        await queryRunner.query(`ALTER TABLE "pair_recruitment" ADD CONSTRAINT "FK_b411575fac0746fd8029fd4b6b3" FOREIGN KEY ("chatRoomId") REFERENCES "chat_room"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "pair_recruitment" DROP CONSTRAINT "FK_b411575fac0746fd8029fd4b6b3"`);
        await queryRunner.query(`ALTER TABLE "pair_recruitment" DROP COLUMN "chatRoomId"`);
    }
}
