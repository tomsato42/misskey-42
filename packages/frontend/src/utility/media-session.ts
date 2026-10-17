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

/** 少なくともこの間隔で Cookie を更新する */
const REFRESH_INTERVAL_MS = 1000 * 60 * 60 * 24;
/** 期限までの残りがこれより短ければ、画面を出す前に更新を待つ */
const MIN_REMAINING_MS = 1000 * 60 * 10;
/** 開いたままのタブで、更新が必要かを確かめる間隔 */
const CHECK_INTERVAL_MS = 1000 * 60 * 60;
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Cookie の更新が必要か。
 * - 'now': Cookie が無い・切れている可能性が高いので、画像を読み込む前に更新を待つ
 * - 'background': 期限まで余裕はあるが更新しておく
 * - 'none': 更新しない
 */
export function decideMediaSessionRefresh(state: MediaSessionState | null, userId: string, now: number): 'now' | 'background' | 'none' {
	if (state == null || state.userId !== userId) return 'now';
	if (state.expiresAt != null && state.expiresAt - now < MIN_REMAINING_MS) return 'now';
	if (now - state.refreshedAt >= REFRESH_INTERVAL_MS) return 'background';
	// 期限の半分を過ぎたら更新する (ttl が 1 日より短く設定されている場合)
	if (state.expiresAt != null && now - state.refreshedAt >= (state.expiresAt - state.refreshedAt) / 2) return 'background';
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

let checkTimer: number | null = null;

/**
 * 起動時に呼ぶ。必要なら Cookie を更新し、開いている間は定期的に更新が必要かを確かめる
 */
export async function setupMediaSession(account: { id: string; token: string; }): Promise<void> {
	const check = () => decideMediaSessionRefresh(readState(), account.id, Date.now());

	const decision = check();
	if (decision === 'now') {
		await refreshMediaSession(account.token, account.id);
	} else if (decision === 'background') {
		void refreshMediaSession(account.token, account.id);
	}

	if (checkTimer == null) {
		checkTimer = window.setInterval(() => {
			if (check() !== 'none') void refreshMediaSession(account.token, account.id);
		}, CHECK_INTERVAL_MS);
	}
}
