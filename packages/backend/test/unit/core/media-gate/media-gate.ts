/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs';
import { describe, expect, test } from 'vitest';
import { convertMediaGateConfig } from '@/config.js';
import {
	MEDIA_GATE_SERVER_SUBJECT,
	buildMediaGateCookie,
	buildMediaGateCookieClear,
	issueMediaGateToken,
	signMediaGateToken,
	toPrivateCacheControl,
	verifyMediaGateToken,
} from '@/core/media-gate/media-gate.js';

type Vectors = {
	secret: string;
	now: number;
	valid: { subject: string; exp: number; token: string }[];
	invalid: { name: string; token: string }[];
};

// Cloudflare Worker 側 (cloudflare/media-worker) のテストと同じテストベクタを使い、両方の実装が同じ結果になることを確かめる
const vectors = JSON.parse(fs.readFileSync(
	new URL('../../../../../../cloudflare/media-worker/test/token-vectors.json', import.meta.url),
	'utf8',
)) as Vectors;

describe('media-gate', () => {
	describe('テストベクタ', () => {
		test.each(vectors.valid)('有効: $subject', ({ subject, exp, token }) => {
			expect(signMediaGateToken(vectors.secret, subject, exp)).toBe(token);
			expect(verifyMediaGateToken(vectors.secret, token, vectors.now)).toEqual({ subject, exp });
		});

		test.each(vectors.invalid)('無効: $name', ({ token }) => {
			expect(verifyMediaGateToken(vectors.secret, token, vectors.now)).toBeNull();
		});
	});

	test('文字列以外は無効', () => {
		expect(verifyMediaGateToken(vectors.secret, null, vectors.now)).toBeNull();
		expect(verifyMediaGateToken(vectors.secret, undefined, vectors.now)).toBeNull();
		expect(verifyMediaGateToken(vectors.secret, 123, vectors.now)).toBeNull();
	});

	test('不正な subject や exp では署名しない', () => {
		expect(() => signMediaGateToken(vectors.secret, 'a.b', 1)).toThrow();
		expect(() => signMediaGateToken(vectors.secret, 'abc', 0)).toThrow();
		expect(() => signMediaGateToken(vectors.secret, 'abc', 1.5)).toThrow();
	});

	test('issueMediaGateToken は ttl 秒後を期限にする', () => {
		const config = { secret: vectors.secret, cookieName: 'c', ttlSec: 100 };
		const issued = issueMediaGateToken(config, 'a1b2c3d4e5', 1000);
		expect(issued.exp).toBe(1100);
		expect(verifyMediaGateToken(vectors.secret, issued.token, 1099)).toEqual({ subject: 'a1b2c3d4e5', exp: 1100 });
		expect(verifyMediaGateToken(vectors.secret, issued.token, 1100)).toBeNull();

		const server = issueMediaGateToken(config, MEDIA_GATE_SERVER_SUBJECT, 1000, 5);
		expect(server.exp).toBe(1005);
	});

	test('Cookie の属性', () => {
		expect(buildMediaGateCookie('mi_media_session', 'tok', 604800, true))
			.toBe('mi_media_session=tok; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax; Secure');
		expect(buildMediaGateCookie('mi_media_session', 'tok', 60, false))
			.toBe('mi_media_session=tok; Path=/; Max-Age=60; HttpOnly; SameSite=Lax');
		expect(buildMediaGateCookieClear('mi_media_session', true))
			.toBe('mi_media_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure');
	});

	describe('toPrivateCacheControl', () => {
		test.each([
			['max-age=31536000, immutable', 'private, max-age=31536000, immutable'],
			['public, max-age=86400', 'private, max-age=86400'],
			['Public, max-age=60, s-maxage=600', 'private, max-age=60'],
			['private, max-age=0, must-revalidate', 'private, max-age=0, must-revalidate'],
			['no-store', 'no-store'],
			['max-age=300', 'private, max-age=300'],
		])('%s → %s', (input, expected) => {
			expect(toPrivateCacheControl(input)).toBe(expected);
		});

		test('指定が無ければ private', () => {
			expect(toPrivateCacheControl(undefined)).toBe('private');
			expect(toPrivateCacheControl('')).toBe('private');
		});
	});

	describe('convertMediaGateConfig', () => {
		const secret = 'x'.repeat(32);

		test('既定値', () => {
			expect(convertMediaGateConfig({ secret })).toEqual({ secret, cookieName: 'mi_media_session', ttlSec: 7200 });
		});

		test('指定した値', () => {
			expect(convertMediaGateConfig({ secret, cookieName: '__Host-media', ttlSec: 3600 })).toEqual({ secret, cookieName: '__Host-media', ttlSec: 3600 });
		});

		test('短すぎる secret は起動時に拒否する', () => {
			expect(() => convertMediaGateConfig({ secret: 'x'.repeat(31) })).toThrow();
		});

		test('Cookie 名に使えない文字は拒否する', () => {
			expect(() => convertMediaGateConfig({ secret, cookieName: 'a b' })).toThrow();
			expect(() => convertMediaGateConfig({ secret, cookieName: 'a;b' })).toThrow();
		});

		test('範囲の両端の ttlSec は受け付ける', () => {
			expect(convertMediaGateConfig({ secret, ttlSec: 3600 }).ttlSec).toBe(3600);
			expect(convertMediaGateConfig({ secret, ttlSec: 86400 }).ttlSec).toBe(86400);
		});

		test('範囲外の ttlSec は拒否する', () => {
			// 1 時間未満は、フロントエンドの 15 分ごとの確認では期限切れ前に更新が間に合わないことがある
			expect(() => convertMediaGateConfig({ secret, ttlSec: 3599 })).toThrow();
			expect(() => convertMediaGateConfig({ secret, ttlSec: 86401 })).toThrow();
			expect(() => convertMediaGateConfig({ secret, ttlSec: 3600.5 })).toThrow();
		});
	});
});
