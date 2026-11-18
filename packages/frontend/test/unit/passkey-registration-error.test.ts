/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { WebAuthnError } from '@simplewebauthn/browser';
import { classifyPasskeyRegistrationError } from '@/utility/passkey-registration-error.js';

function domException(name: string): DOMException {
	return new DOMException('message', name);
}

describe('classifyPasskeyRegistrationError', () => {
	test.each([
		['NotAllowedError', 'canceled'],
		['AbortError', 'canceled'],
		['InvalidStateError', 'alreadyRegistered'],
		['ConstraintError', 'unsupported'],
		['NotSupportedError', 'unsupported'],
		['SecurityError', 'other'],
		['UnknownError', 'other'],
	] as const)('ブラウザの %s は %s', (name, kind) => {
		expect(classifyPasskeyRegistrationError(domException(name))).toBe(kind);
	});

	test('@simplewebauthn/browser が包んだエラーも元の名前で分ける', () => {
		const err = new WebAuthnError({
			message: 'The authenticator was previously registered',
			code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED',
			cause: domException('InvalidStateError'),
		});
		expect(classifyPasskeyRegistrationError(err)).toBe('alreadyRegistered');
	});

	test('Error でないものは other', () => {
		expect(classifyPasskeyRegistrationError('oops')).toBe('other');
		expect(classifyPasskeyRegistrationError(null)).toBe('other');
	});
});
