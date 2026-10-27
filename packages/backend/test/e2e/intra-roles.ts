/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { describe, beforeAll, afterAll, test } from 'vitest';
import { DataSource } from 'typeorm';
import { MiIntraRole } from '@/models/IntraRole.js';
import { genAidx } from '@/misc/id/aidx.js';
import { api, initTestDb, role, signup, successfulApiCall } from '../utils.js';
import type * as misskey from 'misskey-js';

describe('i/intra-roles', () => {
	let connection: DataSource;
	let root: misskey.entities.SignupResponse;
	let alice: misskey.entities.SignupResponse;
	let bob: misskey.entities.SignupResponse;

	beforeAll(async () => {
		connection = await initTestDb(true);
		root = await signup({ username: 'root' });
		alice = await signup({ username: 'alice' });
		bob = await signup({ username: 'bob' });

		const cohortRole = await role(root, { name: 'Cursus 25/04', isPublic: true, isExplorable: true });
		const poolRole = await role(root, { name: 'Piscine 25/02', isPublic: true, isExplorable: true });
		const manualRole = await role(root, { name: 'Manual' });
		const IntraRoles = connection.getRepository(MiIntraRole);
		await IntraRoles.insert({ id: genAidx(Date.now()), roleId: cohortRole.id, kind: 'cohort', key: '2504' });
		await IntraRoles.insert({ id: genAidx(Date.now()), roleId: poolRole.id, kind: 'pool', key: '2502' });

		await api('admin/roles/assign', { userId: alice.id, roleId: cohortRole.id }, root);
		await api('admin/roles/assign', { userId: alice.id, roleId: manualRole.id }, root);
		await api('admin/roles/assign', { userId: bob.id, roleId: poolRole.id }, root);
	}, 1000 * 60 * 2);

	afterAll(async () => {
		await connection.destroy();
	});

	test('自分に付いている intra のロールだけを返す', async () => {
		const res = await successfulApiCall({ endpoint: 'i/intra-roles', parameters: {}, user: alice });
		assert.strictEqual(res.length, 1);
		assert.strictEqual(res[0].kind, 'cohort');
		assert.strictEqual(res[0].name, 'Cursus 25/04');
	});

	test('入学時期のロールが無い人には含まれない', async () => {
		const res = await successfulApiCall({ endpoint: 'i/intra-roles', parameters: {}, user: bob });
		assert.deepStrictEqual(res.map(r => r.kind), ['pool']);
	});

	test('intra のロールが無ければ空', async () => {
		const res = await successfulApiCall({ endpoint: 'i/intra-roles', parameters: {}, user: root });
		assert.deepStrictEqual(res, []);
	});
});
