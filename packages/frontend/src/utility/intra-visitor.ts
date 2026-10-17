/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42 intra 連携が有効なとき (学内SNSモード) に、未ログインの訪問者へ見せる範囲を決める。
// backend も未ログインのリクエストをほとんど拒否するので、フロントエンドではログイン画面以外を出さず、拒否される API も呼ばない

import { $i } from '@/i.js';
import { instance } from '@/instance.js';

/**
 * 学内SNSモードで未ログインでも表示するページ (42 ログインの戻り先)
 */
const INTRA_VISITOR_ALLOWED_PATHS = ['/intra-complete'];

/**
 * ログイン画面だけを表示すべきか
 */
export function shouldShowIntraSigninOnly(ctx: {
	loggedIn: boolean;
	intraLoginEnabled: boolean | undefined;
	pathname: string;
}): boolean {
	if (ctx.loggedIn || ctx.intraLoginEnabled !== true) return false;
	return !INTRA_VISITOR_ALLOWED_PATHS.some(path => ctx.pathname === path || ctx.pathname.startsWith(path + '/'));
}

/**
 * 今のページでログイン画面だけを表示すべきか
 */
export function isIntraSigninOnly(): boolean {
	return shouldShowIntraSigninOnly({
		loggedIn: $i != null,
		intraLoginEnabled: instance.intraLoginEnabled,
		pathname: window.location.pathname,
	});
}

/**
 * 学内SNSモードで、未ログインのため API を呼べない状態か (ページの場所は問わない)
 */
export function isIntraVisitor(): boolean {
	return $i == null && instance.intraLoginEnabled === true;
}

/**
 * URL プレビュー (/url) を取得するときの fetch のオプション。
 * 学内SNSモードの backend はログインしたユーザーにだけプレビューを返すので、トークンを Authorization ヘッダーで送る
 */
export function getUrlPreviewRequestInit(): RequestInit | undefined {
	if ($i == null || instance.intraLoginEnabled !== true) return undefined;
	return {
		headers: {
			Authorization: `Bearer ${$i.token}`,
		},
	};
}
