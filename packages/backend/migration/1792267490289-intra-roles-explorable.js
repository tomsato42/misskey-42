/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42 intra の情報から自動で付与するロール (intra_role で管理しているロール) のタイムラインを公開する。
// 新しく作るロールは IntraSyncService が isExplorable: true で作るので、ここでは作成済みのロールだけを更新する。
// 管理者・モデレーターの初期ロールなど、intra_role に無いロールは対象外。
// テーブル構造は変えない (データだけを変える) ので、entity の変更は無い。

export class IntraRolesExplorable1792267490289 {
    name = 'IntraRolesExplorable1792267490289'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`UPDATE "role" SET "isExplorable" = true WHERE "id" IN (SELECT "roleId" FROM "intra_role")`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        // 巻き戻した後のコードは自動ロールを isExplorable: false で作るため、それに合わせて非公開に戻す。
        // up の前の値は保存していないので、管理者が up の前に手動で公開していたロールも非公開になる
        await queryRunner.query(`UPDATE "role" SET "isExplorable" = false WHERE "id" IN (SELECT "roleId" FROM "intra_role")`);
    }
}
