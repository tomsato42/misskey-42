/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { describe, beforeAll, test } from 'vitest';
import { api, castAsError, initTestDb, post, signup } from '../utils.js';
import type * as misskey from 'misskey-js';

// 42times: ノートの編集 (notes/update)
describe('Note update', () => {
	let alice: misskey.entities.SignupResponse;
	let bob: misskey.entities.SignupResponse;

	beforeAll(async () => {
		await initTestDb(true);
		alice = await signup({ username: 'alice' });
		bob = await signup({ username: 'bob' });
	}, 1000 * 60 * 2);

	test('自分のノートの本文と CW を編集でき、編集した日時が付く', async () => {
		const note = await post(alice, { text: 'before' });
		assert.strictEqual(note.updatedAt, undefined);

		const res = await api('notes/update', { noteId: note.id, text: 'after #edited', cw: 'cw' }, alice);
		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.body.text, 'after #edited');
		assert.strictEqual(res.body.cw, 'cw');
		assert.deepStrictEqual(res.body.tags, ['edited']);
		assert.ok(res.body.updatedAt != null);

		const shown = await api('notes/show', { noteId: note.id }, bob);
		assert.strictEqual(shown.body.text, 'after #edited');
		assert.strictEqual(shown.body.cw, 'cw');
		assert.strictEqual(shown.body.updatedAt, res.body.updatedAt);
	});

	test('変わらなければ編集した日時は付かない', async () => {
		const note = await post(alice, { text: 'same' });
		const res = await api('notes/update', { noteId: note.id, text: 'same', cw: null }, alice);
		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.body.updatedAt, undefined);
	});

	test('人のノートは編集できない', async () => {
		const note = await post(alice, { text: 'alice' });
		const res = await api('notes/update', { noteId: note.id, text: 'bob', cw: null }, bob);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body).error.code, 'ACCESS_DENIED');
	});

	test('リノートは編集できない', async () => {
		const note = await post(bob, { text: 'bob' });
		const renote = await post(alice, { renoteId: note.id });
		const res = await api('notes/update', { noteId: renote.id, text: 'quote', cw: null }, alice);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body).error.code, 'CANNOT_EDIT_RENOTE');
	});

	test('本文を消して空にはできない', async () => {
		const note = await post(alice, { text: 'text' });
		const res = await api('notes/update', { noteId: note.id, text: null, cw: null }, alice);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body).error.code, 'EMPTY_NOTE');
	});

	test('引用の本文を消してリノートにはできない', async () => {
		const note = await post(bob, { text: 'bob' });
		const quote = await post(alice, { text: 'quote', renoteId: note.id });
		const res = await api('notes/update', { noteId: quote.id, text: null, cw: null }, alice);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body).error.code, 'EMPTY_NOTE');
	});

	test('編集する前の版が新しい順に履歴に残る', async () => {
		const note = await post(alice, { text: 'v1' });
		await api('notes/update', { noteId: note.id, text: 'v2', cw: null }, alice);
		await api('notes/update', { noteId: note.id, text: 'v3', cw: 'cw' }, alice);

		const res = await api('notes/history', { noteId: note.id }, bob);
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(res.body.map(v => [v.text, v.cw]), [['v2', null], ['v1', null]]);
		assert.strictEqual(res.body[1].createdAt, note.createdAt);
		assert.strictEqual(res.body[0].createdAt, res.body[1].replacedAt);
	});

	test('見られないノートの履歴は見られない', async () => {
		const note = await post(alice, { text: 'secret', visibility: 'specified', visibleUserIds: [] });
		await api('notes/update', { noteId: note.id, text: 'secret 2', cw: null }, alice);

		const own = await api('notes/history', { noteId: note.id }, alice);
		assert.strictEqual(own.status, 200);
		assert.strictEqual(own.body.length, 1);

		const res = await api('notes/history', { noteId: note.id }, bob);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_NOTE');
	});

	test('存在しないノート', async () => {
		const res = await api('notes/update', { noteId: 'aaaaaaaaaa', text: 'x', cw: null }, alice);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body).error.code, 'NO_SUCH_NOTE');
	});
});
