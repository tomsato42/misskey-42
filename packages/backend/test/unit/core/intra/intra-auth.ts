/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { QueryFailedError } from 'typeorm';
import {
	buildIntraAuthorizeUrl,
	buildIntraCompleteUrl,
	buildIntraErrorUrl,
	buildIntraRedirectUri,
	generateIntraToken,
	isIntraToken,
	isSignupConflictError,
} from '@/core/intra/intra-auth.js';

describe('intra-auth', () => {
	describe('generateIntraToken / isIntraToken', () => {
		test('生成した値は検証を通り、毎回異なる', () => {
			const a = generateIntraToken();
			const b = generateIntraToken();
			expect(a).toHaveLength(43);
			expect(isIntraToken(a)).toBe(true);
			expect(isIntraToken(b)).toBe(true);
			expect(a).not.toBe(b);
		});

		test('形式が違う値は拒否する', () => {
			expect(isIntraToken(undefined)).toBe(false);
			expect(isIntraToken(null)).toBe(false);
			expect(isIntraToken(123)).toBe(false);
			expect(isIntraToken(['a'.repeat(43)])).toBe(false);
			expect(isIntraToken('')).toBe(false);
			expect(isIntraToken('a'.repeat(42))).toBe(false);
			expect(isIntraToken('a'.repeat(44))).toBe(false);
			expect(isIntraToken(`${'a'.repeat(42)}:`)).toBe(false);
			expect(isIntraToken(`${'a'.repeat(42)}*`)).toBe(false);
		});
	});

	test('buildIntraAuthorizeUrl', () => {
		const url = new URL(buildIntraAuthorizeUrl({
			apiBaseUrl: 'https://api.intra.42.fr',
			clientId: 'client id',
			redirectUri: buildIntraRedirectUri('https://example.com'),
			state: 'abc',
		}));
		expect(url.origin + url.pathname).toBe('https://api.intra.42.fr/oauth/authorize');
		expect(url.searchParams.get('client_id')).toBe('client id');
		expect(url.searchParams.get('redirect_uri')).toBe('https://example.com/api/intra/callback');
		expect(url.searchParams.get('response_type')).toBe('code');
		expect(url.searchParams.get('scope')).toBe('public');
		expect(url.searchParams.get('state')).toBe('abc');
	});

	test('buildIntraCompleteUrl / buildIntraErrorUrl', () => {
		expect(buildIntraCompleteUrl('https://example.com', 'abc-_')).toBe('https://example.com/intra-complete/abc-_');
		expect(buildIntraErrorUrl('https://example.com', 'not_eligible')).toBe('https://example.com/intra-complete/error?reason=not_eligible');
	});

	describe('isSignupConflictError', () => {
		test('ユーザー名の重複', () => {
			expect(isSignupConflictError(new Error('DUPLICATED_USERNAME'))).toBe(true);
			expect(isSignupConflictError(new Error('USED_USERNAME'))).toBe(true);
			expect(isSignupConflictError(new Error(' the username is already used'))).toBe(true);
		});

		test('一意制約違反', () => {
			const err = new QueryFailedError('INSERT', [], Object.assign(new Error('duplicate key'), { code: '23505' }));
			expect(isSignupConflictError(err)).toBe(true);
		});

		test('それ以外', () => {
			const err = new QueryFailedError('INSERT', [], Object.assign(new Error('not null'), { code: '23502' }));
			expect(isSignupConflictError(err)).toBe(false);
			expect(isSignupConflictError(new Error('INVALID_USERNAME'))).toBe(false);
			expect(isSignupConflictError('DUPLICATED_USERNAME')).toBe(false);
			expect(isSignupConflictError(null)).toBe(false);
		});
	});
});
