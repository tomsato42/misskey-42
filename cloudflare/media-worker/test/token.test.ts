/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { getCookieValue, signMediaGateToken, verifyMediaGateToken } from '../src/token.ts';

type Vectors = {
	secret: string;
	now: number;
	valid: { subject: string; exp: number; token: string }[];
	invalid: { name: string; token: string }[];
};

// backend (packages/backend/test/unit/core/media-gate/media-gate.ts) と同じテストベクタ
const vectors = JSON.parse(readFileSync(join(import.meta.dirname, 'token-vectors.json'), 'utf8')) as Vectors;

describe('トークン (テストベクタ)', () => {
	for (const { subject, exp, token } of vectors.valid) {
		test(`有効: ${subject}`, async () => {
			assert.equal(await signMediaGateToken(vectors.secret, subject, exp), token);
			assert.deepEqual(await verifyMediaGateToken(vectors.secret, token, vectors.now), { subject, exp });
		});
	}

	for (const { name, token } of vectors.invalid) {
		test(`無効: ${name}`, async () => {
			assert.equal(await verifyMediaGateToken(vectors.secret, token, vectors.now), null);
		});
	}

	test('文字列以外は無効', async () => {
		assert.equal(await verifyMediaGateToken(vectors.secret, null, vectors.now), null);
		assert.equal(await verifyMediaGateToken(vectors.secret, 1, vectors.now), null);
	});
});

describe('getCookieValue', () => {
	test('指定した名前の値を取り出す', () => {
		assert.equal(getCookieValue('a=1; mi_media_session=tok; b=2', 'mi_media_session'), 'tok');
		assert.equal(getCookieValue('mi_media_session=tok', 'mi_media_session'), 'tok');
	});

	test('無ければ null', () => {
		assert.equal(getCookieValue(null, 'mi_media_session'), null);
		assert.equal(getCookieValue('a=1; xmi_media_session=tok', 'mi_media_session'), null);
	});
});
