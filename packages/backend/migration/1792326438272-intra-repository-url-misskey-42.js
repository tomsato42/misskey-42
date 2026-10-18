/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 「ソースコード」と「フィードバック」のリンクを、公開用のミラー (tomsato42/42times) から、
// public にした本体のリポジトリ (tomsato42/misskey-42) に向け直す。ミラーは削除した。
// 管理者が別の URL に変えていた場合は上書きしない (ミラーの URL のときだけ変える)。
// テーブル構造は変えない (データだけを更新する) ので、entity の変更は無い。

const MIRROR_REPOSITORY_URL = 'https://github.com/tomsato42/42times';
const MIRROR_FEEDBACK_URL = 'https://github.com/tomsato42/42times/issues';
const FORK_REPOSITORY_URL = 'https://github.com/tomsato42/misskey-42';
const FORK_FEEDBACK_URL = 'https://github.com/tomsato42/misskey-42/issues';

export class IntraRepositoryUrlMisskey421792326438272 {
    name = 'IntraRepositoryUrlMisskey421792326438272'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`UPDATE "meta" SET "repositoryUrl" = $1 WHERE "repositoryUrl" = $2`, [FORK_REPOSITORY_URL, MIRROR_REPOSITORY_URL]);
        await queryRunner.query(`UPDATE "meta" SET "feedbackUrl" = $1 WHERE "feedbackUrl" = $2`, [FORK_FEEDBACK_URL, MIRROR_FEEDBACK_URL]);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`UPDATE "meta" SET "repositoryUrl" = $1 WHERE "repositoryUrl" = $2`, [MIRROR_REPOSITORY_URL, FORK_REPOSITORY_URL]);
        await queryRunner.query(`UPDATE "meta" SET "feedbackUrl" = $1 WHERE "feedbackUrl" = $2`, [MIRROR_FEEDBACK_URL, FORK_FEEDBACK_URL]);
    }
}
