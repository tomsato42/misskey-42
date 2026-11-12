/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	MEDIA_SESSION_CHECK_INTERVAL_MS,
	clearMediaSession,
	decideMediaSessionRefresh,
	refreshMediaSession,
	setupMediaSession,
	stopMediaSessionWatch,
} from '@/utility/media-session.js';

const storage = vi.hoisted(() => {
	const map = new Map<string, string>();
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => { map.set(key, value); },
		removeItem: (key: string) => { map.delete(key); },
	};
});

vi.mock('@/local-storage.js', () => ({
	miLocalStorage: {
		...storage,
		getItemAsJson: (key: string) => {
			const item = storage.getItem(key);
			return item == null ? undefined : JSON.parse(item);
		},
		setItemAsJson: (key: string, value: unknown) => storage.setItem(key, JSON.stringify(value)),
	},
}));

const MINUTE = 1000 * 60;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;
const now = 1760000000000;

describe('decideMediaSessionRefresh', () => {
	test('記録が無い、または別のアカウントの記録なら、画面を出す前に更新する', () => {
		expect(decideMediaSessionRefresh(null, 'a', now)).toBe('now');
		expect(decideMediaSessionRefresh({ userId: 'b', refreshedAt: now, expiresAt: now + 2 * HOUR }, 'a', now)).toBe('now');
	});

	test('期限まで 10 分を切っている、または切れているなら、画面を出す前に更新する', () => {
		expect(decideMediaSessionRefresh({ userId: 'a', refreshedAt: now - 2 * HOUR + 9 * MINUTE, expiresAt: now + 9 * MINUTE }, 'a', now)).toBe('now');
		expect(decideMediaSessionRefresh({ userId: 'a', refreshedAt: now - 3 * HOUR, expiresAt: now - HOUR }, 'a', now)).toBe('now');
	});

	test('期限の半分を過ぎたら、裏で更新する (既定の 2 時間なら 1 時間後)', () => {
		expect(decideMediaSessionRefresh({ userId: 'a', refreshedAt: now - HOUR, expiresAt: now + HOUR }, 'a', now)).toBe('background');
		expect(decideMediaSessionRefresh({ userId: 'a', refreshedAt: now - HOUR + MINUTE, expiresAt: now + HOUR + MINUTE }, 'a', now)).toBe('none');
		// 上限の 1 日なら 12 時間後
		expect(decideMediaSessionRefresh({ userId: 'a', refreshedAt: now - 12 * HOUR, expiresAt: now + 12 * HOUR }, 'a', now)).toBe('background');
	});

	test('Cookie が発行されなかった (expiresAt が null) ときは、1 日に 1 回だけ確かめ直す', () => {
		expect(decideMediaSessionRefresh({ userId: 'a', refreshedAt: now - DAY, expiresAt: null }, 'a', now)).toBe('background');
		expect(decideMediaSessionRefresh({ userId: 'a', refreshedAt: now - HOUR, expiresAt: null }, 'a', now)).toBe('none');
	});

	test('最近更新していれば何もしない', () => {
		expect(decideMediaSessionRefresh({ userId: 'a', refreshedAt: now - 10 * MINUTE, expiresAt: now + 2 * HOUR - 10 * MINUTE }, 'a', now)).toBe('none');
	});

	test('ttlSec の下限 (1 時間) でも、15 分ごとの確認で期限切れの前に更新が始まる', () => {
		const ttl = HOUR;
		const refreshedAt = now;
		const state = { userId: 'a', refreshedAt, expiresAt: refreshedAt + ttl };
		// 確認のタイミングがどこにずれていても、期限より前のどこかの確認で 'none' 以外になる
		for (let offset = 0; offset < MEDIA_SESSION_CHECK_INTERVAL_MS; offset += MINUTE) {
			let firstRefreshAt: number | null = null;
			for (let t = refreshedAt + offset; t < refreshedAt + ttl; t += MEDIA_SESSION_CHECK_INTERVAL_MS) {
				if (decideMediaSessionRefresh(state, 'a', t) !== 'none') {
					firstRefreshAt = t;
					break;
				}
			}
			expect(firstRefreshAt).not.toBeNull();
			expect(refreshedAt + ttl - firstRefreshAt!).toBeGreaterThanOrEqual(10 * MINUTE);
		}
	});
});

describe('setupMediaSession', () => {
	let visibilityState: DocumentVisibilityState;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(now);
		visibilityState = 'visible';
		vi.spyOn(window.document, 'visibilityState', 'get').mockImplementation(() => visibilityState);
	});

	afterEach(() => {
		stopMediaSessionWatch();
		vi.useRealTimers();
		vi.restoreAllMocks();
		storage.removeItem('mediaSession');
	});

	function mockFetch() {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ expiresAt: Date.now() + 2 * HOUR }), { status: 200 }));
		vi.spyOn(window, 'fetch').mockImplementation(fetchMock);
		return fetchMock;
	}

	test('記録が無ければ、画面を出す前に更新を待つ', async () => {
		const fetchMock = mockFetch();
		await setupMediaSession({ id: 'a', token: 'token' });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(JSON.parse(storage.getItem('mediaSession')!).userId).toBe('a');
	});

	test('15 分ごとに確かめ、期限の半分を過ぎたら更新する', async () => {
		storage.setItem('mediaSession', JSON.stringify({ userId: 'a', refreshedAt: now, expiresAt: now + 2 * HOUR }));
		const fetchMock = mockFetch();
		await setupMediaSession({ id: 'a', token: 'token' });
		expect(fetchMock).not.toHaveBeenCalled();

		// 45 分後の確認ではまだ半分を過ぎていない
		await vi.advanceTimersByTimeAsync(45 * MINUTE);
		expect(fetchMock).not.toHaveBeenCalled();

		// 60 分後の確認で更新する
		await vi.advanceTimersByTimeAsync(15 * MINUTE);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		// 更新した直後の確認では何もしない
		await vi.advanceTimersByTimeAsync(15 * MINUTE);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test('タブが表示に戻ったときにも確かめる', async () => {
		storage.setItem('mediaSession', JSON.stringify({ userId: 'a', refreshedAt: now, expiresAt: now + 2 * HOUR }));
		const fetchMock = mockFetch();
		await setupMediaSession({ id: 'a', token: 'token' });

		// タイマーを進めずに時刻だけ進める (非表示のタブでタイマーが止まっていた場合)
		vi.setSystemTime(now + 70 * MINUTE);

		// 非表示になったときには確かめない
		visibilityState = 'hidden';
		window.document.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMock).not.toHaveBeenCalled();

		visibilityState = 'visible';
		window.document.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test('更新中にもう一度確かめても、同時に 2 回は送らない', async () => {
		storage.setItem('mediaSession', JSON.stringify({ userId: 'a', refreshedAt: now, expiresAt: now + 2 * HOUR }));
		let resolveFetch: (res: Response) => void = () => {};
		const fetchMock = vi.fn(() => new Promise<Response>(resolve => { resolveFetch = resolve; }));
		vi.spyOn(window, 'fetch').mockImplementation(fetchMock);
		await setupMediaSession({ id: 'a', token: 'token' });

		vi.setSystemTime(now + 70 * MINUTE);
		window.document.dispatchEvent(new Event('visibilitychange'));
		window.document.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		resolveFetch(new Response(JSON.stringify({ expiresAt: Date.now() + 2 * HOUR }), { status: 200 }));
		await vi.advanceTimersByTimeAsync(0);
		expect(JSON.parse(storage.getItem('mediaSession')!).refreshedAt).toBe(now + 70 * MINUTE);
	});
});

describe('refreshMediaSession / clearMediaSession', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		storage.removeItem('mediaSession');
	});

	test('Cookie を受け取れるよう credentials: same-origin で送り、期限を記録する', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ expiresAt: now + 7 * DAY }), { status: 200 }));
		vi.spyOn(window, 'fetch').mockImplementation(fetchMock);

		await refreshMediaSession('token', 'a');

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toMatch(/\/api\/media-session$/);
		expect(init.credentials).toBe('same-origin');
		expect(JSON.parse(init.body as string)).toEqual({ i: 'token' });

		const state = JSON.parse(storage.getItem('mediaSession')!);
		expect(state.userId).toBe('a');
		expect(state.expiresAt).toBe(now + 7 * DAY);
	});

	test('mediaGate が無効 (404) でも例外を投げず、期限なしとして記録する', async () => {
		vi.spyOn(window, 'fetch').mockImplementation(async () => new Response('', { status: 404 }));

		await refreshMediaSession('token', 'a');

		const state = JSON.parse(storage.getItem('mediaSession')!);
		expect(state.expiresAt).toBeNull();
	});

	test('ネットワークエラーでは例外を投げず、記録もしない (次の確認で再試行する)', async () => {
		vi.spyOn(window, 'fetch').mockImplementation(async () => { throw new TypeError('network error'); });

		await refreshMediaSession('token', 'a');

		expect(storage.getItem('mediaSession')).toBeNull();
	});

	test('clear は記録を消して、Cookie の削除を依頼する', async () => {
		storage.setItem('mediaSession', JSON.stringify({ userId: 'a', refreshedAt: now, expiresAt: null }));
		const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
		vi.spyOn(window, 'fetch').mockImplementation(fetchMock);

		await clearMediaSession();

		expect(storage.getItem('mediaSession')).toBeNull();
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toMatch(/\/api\/media-session\/clear$/);
		expect(init.credentials).toBe('same-origin');
	});
});
