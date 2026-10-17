/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { shouldShowIntraSigninOnly } from '@/utility/intra-visitor.js';

describe('shouldShowIntraSigninOnly', () => {
	const visitor = { loggedIn: false, intraLoginEnabled: true };

	test.each([
		'/',
		'/@alice',
		'/notes/9zzzzzzzzz',
		'/explore',
		'/about',
		'/share',
		'/miauth/abc',
		'/admin',
		'/intra-completex',
	])('学内SNSモードで未ログインなら、%s ではログイン画面だけを出す', (pathname) => {
		expect(shouldShowIntraSigninOnly({ ...visitor, pathname })).toBe(true);
	});

	test.each([
		'/intra-complete',
		'/intra-complete/abcdef',
		'/intra-complete/error',
	])('42 ログインの戻り先 %s は通常どおり表示する', (pathname) => {
		expect(shouldShowIntraSigninOnly({ ...visitor, pathname })).toBe(false);
	});

	test('ログインしていれば通常どおり表示する', () => {
		expect(shouldShowIntraSigninOnly({ loggedIn: true, intraLoginEnabled: true, pathname: '/' })).toBe(false);
	});

	test('intra 連携が無効、またはインスタンス情報がまだ無いときは upstream と同じ', () => {
		expect(shouldShowIntraSigninOnly({ loggedIn: false, intraLoginEnabled: false, pathname: '/' })).toBe(false);
		expect(shouldShowIntraSigninOnly({ loggedIn: false, intraLoginEnabled: undefined, pathname: '/' })).toBe(false);
	});
});
