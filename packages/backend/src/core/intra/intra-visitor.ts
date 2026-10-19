/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42 intra 連携が有効なとき (学内SNSモード) に、未ログインの訪問者へ見せる範囲を決める純粋関数群。
// DI に依存しないので、ユニットテストから直接呼び出せる。

import type { Config } from '@/config.js';
import type { MiMeta } from '@/models/Meta.js';

/**
 * 学内SNSモードで、トークンなしでも呼び出せる API エンドポイント。
 * フロントエンドの未ログイン時の起動処理・ログイン画面・/intra-complete ページが ApiCallService 経由で呼ぶものだけを入れる。
 * signin-flow、signin-with-passkey、intra/* は ApiCallService を通らない別のルートなので、ここには含めない
 */
export const INTRA_VISITOR_ALLOWED_ENDPOINTS: ReadonlySet<string> = new Set([
	// インスタンスの情報。起動処理 (boot/common.ts の fetchInstance) とログイン画面の表示に使う
	'meta',
	// 最初の管理者アカウントの作成 (pages/welcome.setup.vue)。
	// エンドポイント自身が、管理者がまだいない場合以外はトークンなしの呼び出しを拒否する
	'admin/accounts/create',
]);

/**
 * 学内SNSモードかどうか
 */
export function isIntraMode(config: Pick<Config, 'intra'>): boolean {
	return config.intra != null;
}

/**
 * 学内SNSモードで、すべての応答に付ける X-Robots-Tag の値 (検索エンジンにインデックスさせない)
 */
export const INTRA_X_ROBOTS_TAG = 'noindex, nofollow, noarchive';

/**
 * 学内SNSモードの robots.txt (カレンダー配信の他はすべてのクロールを禁止する)。
 * Google カレンダーの「URL で追加」は robots.txt に従うので、配信 (/calendar/feed/) だけは許可する。
 * 配信の URL は推測できない鍵を含み、X-Robots-Tag でインデックスもさせないので、許可しても検索結果には出ない。
 * Allow を先に書くのは、最初に当てはまった行を使う古いクローラーのため (Google は長く当てはまる方を使う)
 */
export const INTRA_ROBOTS_TXT = 'User-agent: *\nAllow: /calendar/feed/\nDisallow: /\n';

/**
 * トークンなしのリクエストでこのエンドポイントを呼び出してよいか
 */
export function isEndpointAllowedForIntraVisitor(endpointName: string): boolean {
	return INTRA_VISITOR_ALLOWED_ENDPOINTS.has(endpointName);
}

/**
 * 学内SNSモードで固定するサーバー設定の値。
 * admin/update-meta で別の値への変更を拒否したうえで、DB の値が違っていても実効値をこの値にする
 */
export const INTRA_FIXED_META = {
	// 連合しない。ActivityPub、WebFinger、host-meta などはこの値が 'none' のとき 403 を返す
	federation: 'none',
	// 未ログインの訪問者に、ユーザーが作成したコンテンツを見せない
	ugcVisibilityForVisitor: 'none',
} as const satisfies Partial<MiMeta>;

/**
 * 学内SNSモードなら、DB に保存されている値にかかわらず、固定する設定の値を meta に上書きする。
 * meta を直接書き換えて、同じオブジェクトを返す
 */
export function applyIntraMetaOverrides<T extends Pick<MiMeta, keyof typeof INTRA_FIXED_META>>(meta: T, config: Pick<Config, 'intra'>): T {
	if (isIntraMode(config)) {
		Object.assign(meta, INTRA_FIXED_META);
	}
	return meta;
}
