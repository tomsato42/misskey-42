/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 「ソースコード」と「フィードバック」のリンクを、このフォークの公開リポジトリに向ける。
// AGPL のため、利用者が改変後のソースコードを入手できるようにする。
// 管理者が既に別の URL に変えていた場合は上書きしない (upstream の既定値か未設定のときだけ変える)。
// テーブル構造は変えない (データだけを更新する) ので、entity の変更は無い。

const UPSTREAM_REPOSITORY_URL = 'https://github.com/misskey-dev/misskey';
const UPSTREAM_FEEDBACK_URL = 'https://github.com/misskey-dev/misskey/issues/new';
const FORK_REPOSITORY_URL = 'https://github.com/tomsato42/42times';
const FORK_FEEDBACK_URL = 'https://github.com/tomsato42/42times/issues';

export class IntraRepositoryUrl1792303562067 {
    name = 'IntraRepositoryUrl1792303562067'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`UPDATE "meta" SET "repositoryUrl" = $1 WHERE "repositoryUrl" IS NULL OR "repositoryUrl" = $2`, [FORK_REPOSITORY_URL, UPSTREAM_REPOSITORY_URL]);
        await queryRunner.query(`UPDATE "meta" SET "feedbackUrl" = $1 WHERE "feedbackUrl" IS NULL OR "feedbackUrl" = $2`, [FORK_FEEDBACK_URL, UPSTREAM_FEEDBACK_URL]);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`UPDATE "meta" SET "repositoryUrl" = $1 WHERE "repositoryUrl" = $2`, [UPSTREAM_REPOSITORY_URL, FORK_REPOSITORY_URL]);
        await queryRunner.query(`UPDATE "meta" SET "feedbackUrl" = $1 WHERE "feedbackUrl" = $2`, [UPSTREAM_FEEDBACK_URL, FORK_FEEDBACK_URL]);
    }
}
