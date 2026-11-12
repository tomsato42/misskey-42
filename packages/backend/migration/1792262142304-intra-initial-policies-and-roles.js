/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 学内SNSとして使い始めるときの基本ポリシーと初期ロールを投入する。
// テーブル構造は変えない (データだけを入れる) ので、entity の変更は無い。

// 基本ロールのポリシー (meta.policies) のうち、Misskey の既定値 (DEFAULT_POLICIES) から変える値と、既定値と同じでも明示しておく値
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

// 初期ロールの id は固定にして、down で id を指定して消せるようにする。
// 形式は aidx (先頭 8 文字が 2000-01-01 からの経過ミリ秒の base36、続く 8 文字が個体 ID とカウンタ)。
// 先頭 8 文字はこの migration のタイムスタンプ (1792262142304) にしてあり、設定の id が aid / aidx なら作成日時として正しく読める。
const INITIAL_ROLES = [
    {
        id: 'asgax10g00000001',
        name: '管理者',
        description: 'インスタンスの管理者',
        isAdministrator: true,
        isModerator: false,
    },
    {
        id: 'asgax10g00000002',
        name: 'モデレーター',
        description: '通報の対応や凍結を行うスタッフ',
        isAdministrator: false,
        isModerator: true,
    },
];

export class IntraInitialPoliciesAndRoles1792262142304 {
    name = 'IntraInitialPoliciesAndRoles1792262142304'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        // 基本ポリシー: 既存の meta.policies に、上の値を上書きでマージする (既存の値 || 新しい値)。
        // 管理者がすでにこれらのキーを変えていた場合も上書きするが、初回投入用として許容する。
        // (管理画面で基本ロールを一度保存すると全キーが保存されるため、「未設定のキーだけ入れる」方式では値が入らないことがある)
        // MetaService と同じく、meta が複数行あるときは id が最も新しい行を使う
        const metas = await queryRunner.query(`SELECT "id" FROM "meta" ORDER BY "id" DESC LIMIT 1`);
        if (metas.length > 0) {
            await queryRunner.query(`UPDATE "meta" SET "policies" = "policies" || $1::jsonb WHERE "id" = $2`, [JSON.stringify(BASE_POLICIES), metas[0].id]);
        } else {
            // 新規インストールでは、migration の時点で meta の行がまだ無い (起動時に MetaService などが id 'x' で作る)。
            // 起動時と同じ id 'x' で先に作っておき、ほかの列は DB の既定値にする
            await queryRunner.query(`INSERT INTO "meta" ("id", "policies") VALUES ('x', $1::jsonb)`, [JSON.stringify(BASE_POLICIES)]);
        }

        // 初期ロール: 同じ名前のロールが無いときだけ作る。ユーザーへの付与はしない
        for (const role of INITIAL_ROLES) {
            const sameNameRoles = await queryRunner.query(`SELECT "id" FROM "role" WHERE "name" = $1 LIMIT 1`, [role.name]);
            if (sameNameRoles.length > 0) continue;

            await queryRunner.query(
                `INSERT INTO "role" ("id", "updatedAt", "lastUsedAt", "name", "description", "target", "isPublic", "asBadge", "isAdministrator", "isModerator", "canEditMembersByModerator", "policies") VALUES ($1, now(), now(), $2, $3, 'manual', true, true, $4, $5, false, '{}'::jsonb) ON CONFLICT ("id") DO NOTHING`,
                [role.id, role.name, role.description, role.isAdministrator, role.isModerator],
            );
        }
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        // 基本ポリシーは、投入前の値を保存していないため巻き戻さない
        // 初期ロールは、この migration で入れた id のものだけを消す (割り当ては role_assignment の外部キーで一緒に消える)
        await queryRunner.query(`DELETE FROM "role" WHERE "id" IN ($1, $2)`, INITIAL_ROLES.map(role => role.id));
    }
}
