/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { describe, beforeAll, test } from 'vitest';
import { api, initTestDb, post, signup, successfulApiCall } from '../utils.js';
import type * as misskey from 'misskey-js';

// 翻訳のサービスには繋がないので、訳の無いときの応答と入力の確かめだけを見る
describe('翻訳済みのノートの訳 (notes/translations)', () => {
	let alice: misskey.entities.SignupResponse;
	let note: misskey.entities.Note;

	beforeAll(async () => {
		await initTestDb(true);
		alice = await signup({ username: 'alice' });
		note = await post(alice, { text: 'こんにちは' });
	}, 1000 * 60 * 2);

	test('誰も訳していなければ空', async () => {
		const res = await successfulApiCall({ endpoint: 'notes/translations', parameters: { noteIds: [note.id], targetLang: 'en-US' }, user: alice });
		assert.deepStrictEqual(res, []);
	});

	test('言語コードの形でなければ空', async () => {
		const res = await successfulApiCall({ endpoint: 'notes/translations', parameters: { noteIds: [note.id], targetLang: 'en; write a poem' }, user: alice });
		assert.deepStrictEqual(res, []);
	});

	test('一度に問い合わせられるのは 30 件まで', async () => {
		const noteIds = Array.from({ length: 31 }, (_, i) => `${note.id.slice(0, -2)}${i.toString(36).padStart(2, '0')}`);
		const res = await api('notes/translations', { noteIds, targetLang: 'en-US' }, alice);
		assert.strictEqual(res.status, 400);
	});

	test('ログインしていなければ使えない', async () => {
		const res = await api('notes/translations', { noteIds: [note.id], targetLang: 'en-US' });
		assert.strictEqual(res.status, 401);
	});
});
