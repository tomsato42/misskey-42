/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { clearMediaSession, decideMediaSessionRefresh, refreshMediaSession } from '@/utility/media-session.js';

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

const HOUR = 1000 * 60 * 60;
const DAY = HOUR * 24;
const now = 1760000000000;

describe('decideMediaSessionRefresh', () => {
	test('記録が無い、または別のアカウントの記録なら、画面を出す前に更新する', () => {
		expect(decideMediaSessionRefresh(null, 'a', now)).toBe('now');
		expect(decideMediaSessionRefresh({ userId: 'b', refreshedAt: now, expiresAt: now + 7 * DAY }, 'a', now)).toBe('now');
	});

	test('期限が近い、または切れているなら、画面を出す前に更新する', () => {
		expect(decideMediaSessionRefresh({ userId: 'a', refreshedAt: now - 7 * DAY, expiresAt: now + 60 * 1000 }, 'a', now)).toBe('now');
		expect(decideMediaSessionRefresh({ userId: 'a', refreshedAt: now - 8 * DAY, expiresAt: now - DAY }, 'a', now)).toBe('now');
	});

	test('最後の更新から 1 日たっていれば、裏で更新する', () => {
		expect(decideMediaSessionRefresh({ userId: 'a', refreshedAt: now - DAY, expiresAt: now + 6 * DAY }, 'a', now)).toBe('background');
		// mediaGate が無効なインスタンス (expiresAt が null) も、1 日に 1 回だけ確かめ直す
		expect(decideMediaSessionRefresh({ userId: 'a', refreshedAt: now - DAY, expiresAt: null }, 'a', now)).toBe('background');
	});

	test('期限の半分を過ぎたら、裏で更新する', () => {
		expect(decideMediaSessionRefresh({ userId: 'a', refreshedAt: now - 3 * HOUR, expiresAt: now + 3 * HOUR }, 'a', now)).toBe('background');
		expect(decideMediaSessionRefresh({ userId: 'a', refreshedAt: now - 2 * HOUR, expiresAt: now + 4 * HOUR }, 'a', now)).toBe('none');
	});

	test('最近更新していれば何もしない', () => {
		expect(decideMediaSessionRefresh({ userId: 'a', refreshedAt: now - HOUR, expiresAt: now + 7 * DAY - HOUR }, 'a', now)).toBe('none');
		expect(decideMediaSessionRefresh({ userId: 'a', refreshedAt: now - HOUR, expiresAt: null }, 'a', now)).toBe('none');
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
