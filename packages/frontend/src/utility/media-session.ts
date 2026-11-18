/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 画像・添付ファイルをログインしている人にだけ見せる機能 (backend の mediaGate) のための Cookie を更新する。
// Cookie は HttpOnly なのでフロントエンドからは読めない。いつ更新したかを localStorage に記録し、それを見て更新の要否を決める。
// mediaGate が無効なインスタンスではエンドポイントが 404 を返すので、何もせずに終わる

import { apiUrl } from '@@/js/config.js';
import { miLocalStorage } from '@/local-storage.js';

export type MediaSessionState = {
	userId: string;
	/** 最後に更新を試みて、サーバーから応答を得た時刻 (ms) */
	refreshedAt: number;
	/** Cookie の有効期限 (ms)。mediaGate が無効なとき、または発行されなかったときは null */
	expiresAt: number | null;
};

/** Cookie が発行されなかったとき (mediaGate が無効、トークンが無効など) に、確かめ直すまでの間隔 */
const RETRY_WITHOUT_COOKIE_INTERVAL_MS = 1000 * 60 * 60 * 24;
/** 期限までの残りがこれより短ければ、画面を出す前に更新を待つ */
const MIN_REMAINING_MS = 1000 * 60 * 10;
/**
 * 開いたままのタブで、更新が必要かを確かめる間隔。
 * backend の mediaGate.ttlSec の下限 (1 時間) は、この間隔でも期限切れの前に更新できるように決めている
 */
export const MEDIA_SESSION_CHECK_INTERVAL_MS = 1000 * 60 * 15;
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Cookie の更新が必要か。
 * - 'now': Cookie が無い・切れている可能性が高いので、画像を読み込む前に更新を待つ
 * - 'background': 期限まで余裕はあるが更新しておく
 * - 'none': 更新しない
 */
export function decideMediaSessionRefresh(state: MediaSessionState | null, userId: string, now: number): 'now' | 'background' | 'none' {
	if (state == null || state.userId !== userId) return 'now';
	if (state.expiresAt == null) {
		return now - state.refreshedAt >= RETRY_WITHOUT_COOKIE_INTERVAL_MS ? 'background' : 'none';
	}
	if (state.expiresAt - now < MIN_REMAINING_MS) return 'now';
	// 期限の半分を過ぎたら更新する
	if (now - state.refreshedAt >= (state.expiresAt - state.refreshedAt) / 2) return 'background';
	return 'none';
}

function readState(): MediaSessionState | null {
	try {
		const state = miLocalStorage.getItemAsJson('mediaSession') as MediaSessionState | undefined;
		if (state == null || typeof state.userId !== 'string' || typeof state.refreshedAt !== 'number') return null;
		return state;
	} catch {
		return null;
	}
}

function writeState(state: MediaSessionState): void {
	try {
		miLocalStorage.setItemAsJson('mediaSession', state);
	} catch {
		// localStorage が使えない環境では、次の起動時にもう一度更新するだけ
	}
}

/**
 * Cookie を発行してもらう。失敗しても例外は投げない
 */
export async function refreshMediaSession(token: string, userId: string): Promise<void> {
	try {
		// misskeyApi は credentials: 'omit' なので Set-Cookie が保存されない。fetch を直接使う
		const res = await window.fetch(`${apiUrl}/media-session`, {
			method: 'POST',
			credentials: 'same-origin',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ i: token }),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});

		if (res.ok) {
			const body = await res.json().catch(() => null);
			const expiresAt = typeof body?.expiresAt === 'number' ? body.expiresAt : null;
			writeState({ userId, refreshedAt: Date.now(), expiresAt });
		} else if (res.status >= 400 && res.status < 500 && res.status !== 429) {
			// 404 (mediaGate が無効) や 401 (トークンが無効) は、すぐに再試行しても結果が変わらないので記録しておく
			writeState({ userId, refreshedAt: Date.now(), expiresAt: null });
		}
	} catch {
		// ネットワークエラーやタイムアウト。次の確認のときに再試行する
	}
}

/**
 * Cookie を消してもらう。失敗しても例外は投げない
 */
export async function clearMediaSession(): Promise<void> {
	try {
		miLocalStorage.removeItem('mediaSession');
	} catch {
		// 何もしない
	}

	try {
		await window.fetch(`${apiUrl}/media-session/clear`, {
			method: 'POST',
			credentials: 'same-origin',
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch {
		// 何もしない
	}
}

let stopWatching: (() => void) | null = null;

/**
 * 起動時に呼ぶ。必要なら Cookie を更新し、開いている間は 15 分ごとと、タブが表示に戻ったときに更新が必要かを確かめる。
 * 画面を出す前に更新を待つのは、記録が無い・別のアカウント・期限切れ間近のときだけ
 */
export async function setupMediaSession(account: { id: string; token: string; }): Promise<void> {
	// 定期的な確認と visibilitychange が重なっても、同時に 2 回は更新しない
	let inflight: Promise<void> | null = null;
	const refresh = () => {
		inflight ??= refreshMediaSession(account.token, account.id).finally(() => {
			inflight = null;
		});
		return inflight;
	};
	const checkAndRefresh = () => {
		if (decideMediaSessionRefresh(readState(), account.id, Date.now()) !== 'none') void refresh();
	};

	const decision = decideMediaSessionRefresh(readState(), account.id, Date.now());
	if (decision === 'now') {
		await refresh();
	} else if (decision === 'background') {
		void refresh();
	}

	if (stopWatching != null) return;

	// 非表示のタブではタイマーが間引かれることがあるので、表示に戻ったときにも確かめる
	const onVisibilityChange = () => {
		if (window.document.visibilityState === 'visible') checkAndRefresh();
	};
	const timer = window.setInterval(checkAndRefresh, MEDIA_SESSION_CHECK_INTERVAL_MS);
	window.document.addEventListener('visibilitychange', onVisibilityChange);
	stopWatching = () => {
		window.clearInterval(timer);
		window.document.removeEventListener('visibilitychange', onVisibilityChange);
	};
}

/**
 * setupMediaSession が始めた確認を止める (テスト用)
 */
export function stopMediaSessionWatch(): void {
	stopWatching?.();
	stopWatching = null;
}
