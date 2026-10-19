/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { describe, beforeAll, afterAll, test } from 'vitest';
import { DataSource } from 'typeorm';
import { MiIntraProjectResult } from '@/models/IntraProjectResult.js';
import { MiUserProfile } from '@/models/UserProfile.js';
import { genAidx } from '@/misc/id/aidx.js';
import { api, failedApiCall, initTestDb, post, signup, successfulApiCall } from '../utils.js';
import type * as misskey from 'misskey-js';

describe('42 intra の課題の結果', () => {
	let connection: DataSource;
	let alice: misskey.entities.SignupResponse;
	let bob: misskey.entities.SignupResponse;
	let carol: misskey.entities.SignupResponse;
	let webservId: string;

	beforeAll(async () => {
		connection = await initTestDb(true);
		alice = await signup({ username: 'alice' });
		bob = await signup({ username: 'bob' });
		carol = await signup({ username: 'carol' });

		const Profiles = connection.getRepository(MiUserProfile);
		await Profiles.update({ userId: alice.id }, { intraId: 1, intraLogin: 'alice42' });
		await Profiles.update({ userId: bob.id }, { intraId: 2, intraLogin: 'bob42' });

		const Results = connection.getRepository(MiIntraProjectResult);
		webservId = genAidx(Date.now());
		await Results.insert({
			id: webservId, userId: alice.id, projectsUserId: 100, projectSlug: 'webserv', projectName: 'webserv',
			finalMark: 125, validated: true, markedAt: new Date('2026-10-18T10:00:00.000Z'), teamId: 10,
			// detailsTeamId が teamId と同じなので、投稿するときに 42 API を呼ばない
			members: [{ intraId: 1, login: 'alice42' }, { intraId: 2, login: 'bob42' }, { intraId: 3, login: 'dave42' }],
			outstandingCount: 2, detailsTeamId: 10, updatedAt: new Date(),
		});
		await Results.insert({
			id: genAidx(Date.now() + 1), userId: alice.id, projectsUserId: 101, projectSlug: 'ft_irc', projectName: 'ft_irc',
			finalMark: 0, validated: false, markedAt: new Date('2026-10-01T10:00:00.000Z'), teamId: 11,
			members: [], outstandingCount: null, detailsTeamId: null, updatedAt: new Date(),
		});
	}, 1000 * 60 * 2);

	afterAll(async () => {
		await connection.destroy();
	});

	test('自分の課題の結果を、結果が出た日時の新しい順に返す', async () => {
		const res = await successfulApiCall({ endpoint: 'i/intra/project-results', parameters: {}, user: alice });
		assert.deepStrictEqual(res.map(r => [r.projectSlug, r.finalMark, r.validated, r.outstandingCount]), [
			['webserv', 125, true, 2],
			['ft_irc', 0, false, null],
		]);
		assert.deepStrictEqual(res[0].members.map(m => [m.login, m.user?.id ?? null]), [['alice42', alice.id], ['bob42', bob.id], ['dave42', null]]);
		// メンバーをまだ取得していない結果は空
		assert.deepStrictEqual(res[1].members, []);

		const others = await successfulApiCall({ endpoint: 'i/intra/project-results', parameters: {}, user: bob });
		assert.deepStrictEqual(others, []);
	});

	test('本文が無くても課題の結果を付けて投稿でき、メンバーはアカウントがあればユーザーを付ける', async () => {
		const res = await successfulApiCall({ endpoint: 'notes/create', parameters: { intraProjectResultId: webservId }, user: alice });
		const result = res.createdNote.intraProjectResult;
		assert.ok(result);
		assert.strictEqual(result.projectName, 'webserv');
		assert.strictEqual(result.finalMark, 125);
		assert.strictEqual(result.validated, true);
		assert.strictEqual(result.outstandingCount, 2);
		assert.deepStrictEqual(result.members.map(m => [m.login, m.user?.id ?? null]), [
			['alice42', alice.id],
			['bob42', bob.id],
			['dave42', null],
		]);

		const shown = await successfulApiCall({ endpoint: 'notes/show', parameters: { noteId: res.createdNote.id }, user: carol });
		assert.strictEqual(shown.intraProjectResult?.finalMark, 125);

		const timeline = await successfulApiCall({ endpoint: 'users/notes', parameters: { userId: alice.id }, user: carol });
		assert.strictEqual(timeline.find(n => n.id === res.createdNote.id)?.intraProjectResult?.projectSlug, 'webserv');
	});

	test('結果の付いていないノートには無い', async () => {
		const note = await post(alice, { text: 'hello' });
		assert.strictEqual(note.intraProjectResult, undefined);
	});

	test('見られないノートでは課題の結果も隠す', async () => {
		const res = await successfulApiCall({ endpoint: 'notes/create', parameters: { intraProjectResultId: webservId, visibility: 'followers', text: 'secret' }, user: alice });
		const shown = await successfulApiCall({ endpoint: 'notes/show', parameters: { noteId: res.createdNote.id }, user: carol });
		assert.strictEqual(shown.isHidden, true);
		assert.strictEqual(shown.intraProjectResult, undefined);
	});

	test('他人の課題の結果は付けられない', async () => {
		await failedApiCall({ endpoint: 'notes/create', parameters: { intraProjectResultId: webservId, text: 'hi' }, user: bob }, {
			status: 400, code: 'NO_SUCH_INTRA_PROJECT_RESULT', id: '8e0b5273-9262-4653-bbe6-f112a2cc8e3e',
		});
	});

	test('本文などの無いリノートには付けられない', async () => {
		const note = await post(bob, { text: 'renote me' });
		await failedApiCall({ endpoint: 'notes/create', parameters: { intraProjectResultId: webservId, renoteId: note.id }, user: alice }, {
			status: 400, code: 'CANNOT_ATTACH_INTRA_PROJECT_RESULT_TO_PURE_RENOTE', id: '6c96ccd5-e908-497c-b7bb-56702aed3f80',
		});
	});

	test('課題の結果も本文も無ければ投稿できない', async () => {
		const res = await api('notes/create', {}, alice);
		assert.strictEqual(res.status, 400);
	});

	test('intra と連携していなければ再取得できない', async () => {
		await failedApiCall({ endpoint: 'i/intra/refresh-project-results', parameters: {}, user: carol }, {
			status: 400, code: 'NOT_LINKED_WITH_INTRA', id: 'fefe5dd9-090f-47fc-ba47-184420934d3f',
		});
	});
});
