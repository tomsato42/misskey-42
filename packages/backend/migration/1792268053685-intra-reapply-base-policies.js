/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 学内SNSの基本ポリシーを入れ直す。
// 1792262142304-intra-initial-policies-and-roles で投入した値が、初期設定のウィザードの
// admin/roles/update-default-policies (基本ポリシーを丸ごと置き換える) で上書きされていたため。
// テーブル構造は変えない (データだけを更新する) ので、entity の変更は無い。

// 1792262142304 と同じ値 (マージ済みの migration は編集しないため、ここに写す)
const BASE_POLICIES = {
    driveCapacityMb: 500,
    maxFileSizeMb: 30,
    canManageCustomEmojis: true,
    antennaLimit: 3,
    clipLimit: 30,
    noteEachClipsLimit: 200,
    canSearchNotes: true,
    canInvite: false,
    canImportAntennas: false,
    canImportBlocking: false,
    canImportFollowing: false,
    canImportMuting: false,
    canImportUserLists: false,
    scheduledNoteLimit: 5,
    canManageAvatarDecorations: false,
};

export class IntraReapplyBasePolicies1792268053685 {
    name = 'IntraReapplyBasePolicies1792268053685'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        // 上のキーだけを上書きでマージする。それ以外のキー (ウィザードや管理者が設定した値) はそのまま残す。
        // meta の行が無い (新規インストール) ときは、1792262142304 が作った行に値が入っているので何もしない
        const metas = await queryRunner.query(`SELECT "id" FROM "meta" ORDER BY "id" DESC LIMIT 1`);
        if (metas.length === 0) return;
        await queryRunner.query(`UPDATE "meta" SET "policies" = "policies" || $1::jsonb WHERE "id" = $2`, [JSON.stringify(BASE_POLICIES), metas[0].id]);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        // up の前の値は保存していないので、上のキーを取り除いて Misskey の既定値 (DEFAULT_POLICIES) に戻す
        const metas = await queryRunner.query(`SELECT "id" FROM "meta" ORDER BY "id" DESC LIMIT 1`);
        if (metas.length === 0) return;
        await queryRunner.query(`UPDATE "meta" SET "policies" = "policies" - $1::text[] WHERE "id" = $2`, [Object.keys(BASE_POLICIES), metas[0].id]);
    }
}
