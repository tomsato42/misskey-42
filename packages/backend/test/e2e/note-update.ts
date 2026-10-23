/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { describe, beforeAll, test, vi } from 'vitest';
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

	describe('公開範囲', () => {
		const waitForTl = { timeout: 3000, interval: 25 };

		test('公開範囲だけ変えたときは、編集した日時も履歴も付かない', async () => {
			const note = await post(alice, { text: 'visibility only' });
			const res = await api('notes/update', { noteId: note.id, text: 'visibility only', cw: null, visibility: 'home' }, alice);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.visibility, 'home');
			assert.strictEqual(res.body.updatedAt, undefined);

			const history = await api('notes/history', { noteId: note.id }, alice);
			assert.deepStrictEqual(history.body, []);
		});

		test('フォロワーに狭めると、フォローしていない人のローカルタイムラインから消え、中身も見えなくなる', async () => {
			const carol = await signup();
			const note = await post(alice, { text: 'narrow' });
			await vi.waitFor(async () => {
				const tl = await api('notes/local-timeline', { limit: 100 }, carol);
				assert.ok(tl.body.some(n => n.id === note.id));
			}, waitForTl);

			const res = await api('notes/update', { noteId: note.id, text: 'narrow', cw: null, visibility: 'followers' }, alice);
			assert.strictEqual(res.body.visibility, 'followers');

			await vi.waitFor(async () => {
				const tl = await api('notes/local-timeline', { limit: 100 }, carol);
				assert.ok(!tl.body.some(n => n.id === note.id));
			}, waitForTl);

			const shown = await api('notes/show', { noteId: note.id }, carol);
			assert.notStrictEqual(shown.body.text, 'narrow');
		});

		test('公開に広げると、ローカルタイムラインに出る', async () => {
			const carol = await signup();
			const note = await post(alice, { text: 'widen', visibility: 'followers' });

			const res = await api('notes/update', { noteId: note.id, text: 'widen', cw: null, visibility: 'public' }, alice);
			assert.strictEqual(res.body.visibility, 'public');

			await vi.waitFor(async () => {
				const tl = await api('notes/local-timeline', { limit: 100 }, carol);
				assert.ok(tl.body.some(n => n.id === note.id && n.text === 'widen'));
			}, waitForTl);
		});

		test('返信先より広くはできない', async () => {
			const target = await post(bob, { text: 'home', visibility: 'home' });
			const reply = await post(alice, { text: 'reply', replyId: target.id, visibility: 'followers' });
			const res = await api('notes/update', { noteId: reply.id, text: 'reply', cw: null, visibility: 'public' }, alice);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.visibility, 'home');
		});

		test('ダイレクトは公開範囲を変えられない (公開範囲を送らなければ本文は編集できる)', async () => {
			const note = await post(alice, { text: 'direct', visibility: 'specified', visibleUserIds: [] });
			const res = await api('notes/update', { noteId: note.id, text: 'direct', cw: null, visibility: 'public' }, alice);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body).error.code, 'CANNOT_CHANGE_VISIBILITY');

			const same = await api('notes/update', { noteId: note.id, text: 'direct 2', cw: null }, alice);
			assert.strictEqual(same.status, 200);
			assert.strictEqual(same.body.visibility, 'specified');
		});
	});

	test('存在しないノート', async () => {
		const res = await api('notes/update', { noteId: 'aaaaaaaaaa', text: 'x', cw: null }, alice);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body).error.code, 'NO_SUCH_NOTE');
	});
});
