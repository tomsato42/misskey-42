/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { apiUrl } from '@@/js/config.js';
import { misskeyApi } from '@/utility/misskey-api.js';

/** ログインの後に戻るページのパスを入れる sessionStorage のキー */
const RETURN_PATH_KEY = 'intraLoginReturnPath';

/**
 * 42 intra の認可画面へページ遷移する。
 * backend が state を Cookie に保存してから 42 へリダイレクトするので、fetch ではなくページごと移動する。
 * 初めてログインした 42 のユーザーには、backend がアカウントを自動で作成する。
 * 今いるページ (共有されたペア募集のページなど) は、ログインの後に戻れるよう覚えておく
 */
export function startIntraLogin(): void {
	const path = `${window.location.pathname}${window.location.search}`;
	try {
		if (isReturnablePath(path)) {
			window.sessionStorage.setItem(RETURN_PATH_KEY, path);
		} else {
			window.sessionStorage.removeItem(RETURN_PATH_KEY);
		}
	} catch {
		// sessionStorage が使えなければトップページに戻る
	}
	window.location.href = `${apiUrl}/intra/authorize`;
}

/**
 * ログインの後に戻ってよいパスか。同じオリジンのパス (/ で始まり // で始まらない) で、トップページとログインの完了ページ以外
 */
export function isReturnablePath(path: string): boolean {
	if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return false;
	if (path === '/' || path.startsWith('/intra-complete')) return false;
	return true;
}

/**
 * startIntraLogin で覚えておいた、ログインの後に戻るページのパスを取り出す (取り出したら消す)。無ければ '/'
 */
export function takeIntraLoginReturnPath(): string {
	try {
		const path = window.sessionStorage.getItem(RETURN_PATH_KEY);
		window.sessionStorage.removeItem(RETURN_PATH_KEY);
		if (path != null && isReturnablePath(path)) return path;
	} catch {
		// sessionStorage が使えなければトップページに戻る
	}
	return '/';
}

/**
 * ログイン中のユーザーの本人確認のために、42 intra でログインし直す。
 * 終わると backend が設定のセキュリティのページへ戻す (クエリの intraReauth に結果が入る)
 */
export async function startIntraReauth(): Promise<void> {
	const { url } = await misskeyApi('i/intra/start-reauth', {});
	window.location.href = url;
}

/**
 * 42 intra のプロフィールページの URL
 */
export function getIntraProfileUrl(login: string): string {
	return `https://profile.intra.42.fr/users/${encodeURIComponent(login)}`;
}

/**
 * 42 から戻ってきたときに受け取ったコードを、ログイン用のトークンと交換する。
 * backend がコードと Cookie (intra_login) を照合するため、misskeyApi (credentials: 'omit') は使わずに Cookie を送る
 */
export async function exchangeIntraLoginCode(code: string): Promise<{ id: string; i: string; }> {
	const res = await window.fetch(`${apiUrl}/intra/exchange`, {
		method: 'POST',
		credentials: 'same-origin',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ code }),
	});

	const body = await res.json().catch(() => null);
	if (!res.ok || body == null || typeof body.i !== 'string') {
		throw new IntraExchangeError(res.status, body?.error?.code ?? null);
	}

	return { id: body.id, i: body.i };
}

export class IntraExchangeError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string | null,
	) {
		super(`intra exchange failed: ${status} ${code ?? ''}`);
	}
}
