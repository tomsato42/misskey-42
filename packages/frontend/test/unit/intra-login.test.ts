/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test } from 'vitest';
import { isReturnablePath, takeIntraLoginReturnPath } from '@/utility/intra-login.js';

describe('isReturnablePath', () => {
	test('同じオリジンのページのパスなら戻れる', () => {
		expect(isReturnablePath('/pair/abc')).toBe(true);
		expect(isReturnablePath('/pair/abc?x=1')).toBe(true);
	});

	test('トップページ・ログインの完了ページ・別のオリジンには戻らない', () => {
		expect(isReturnablePath('/')).toBe(false);
		expect(isReturnablePath('/intra-complete?code=x')).toBe(false);
		expect(isReturnablePath('//evil.example.com/pair/abc')).toBe(false);
		expect(isReturnablePath('/\\evil.example.com')).toBe(false);
		expect(isReturnablePath('https://evil.example.com/')).toBe(false);
	});
});

describe('takeIntraLoginReturnPath', () => {
	afterEach(() => {
		window.sessionStorage.clear();
	});

	test('覚えておいたパスを返して消す', () => {
		window.sessionStorage.setItem('intraLoginReturnPath', '/pair/abc');
		expect(takeIntraLoginReturnPath()).toBe('/pair/abc');
		expect(takeIntraLoginReturnPath()).toBe('/');
	});

	test('戻れないパスなら / を返す', () => {
		window.sessionStorage.setItem('intraLoginReturnPath', '//evil.example.com');
		expect(takeIntraLoginReturnPath()).toBe('/');
	});
});
