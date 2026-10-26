/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { describe, beforeAll, test } from 'vitest';
import { api, castAsError, initTestDb, role, signup, successfulApiCall, uploadFile } from '../utils.js';
import type * as misskey from 'misskey-js';

// Claude の API には繋がないので、キーの保存と権限だけを確かめる
describe('絵文字のタグの提案', () => {
	let root: misskey.entities.SignupResponse;
	let alice: misskey.entities.SignupResponse;
	let moderator: misskey.entities.SignupResponse;

	const apiKey = 'sk-ant-api03-e2e-test-key-Qx7A';

	beforeAll(async () => {
		await initTestDb(true);
		root = await signup({ username: 'root' });
		alice = await signup({ username: 'alice' });
		moderator = await signup({ username: 'carol' });
		const moderatorRole = await role(root, { isModerator: true, target: 'manual' });
		await api('admin/roles/assign', { userId: moderator.id, roleId: moderatorRole.id }, root);
	}, 1000 * 60 * 2);

	test('キーが無ければ admin/meta は null を返し、モデルは既定', async () => {
		const meta = await successfulApiCall({ endpoint: 'admin/meta', parameters: {}, user: root });
		assert.strictEqual(meta.anthropicApiKeyHint, null);
		assert.strictEqual(meta.anthropicModel, 'claude-sonnet-5-5');
	});

	test('キーが無ければ使えない', async () => {
		const res = await api('admin/emoji/test-tagging', {}, root);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'EMOJI_TAGGING_NOT_CONFIGURED');
	});

	test('管理者でなければ、モデレーターでも使えない', async () => {
		for (const user of [alice, moderator]) {
			assert.strictEqual((await api('admin/emoji/suggest-tags', { fileId: 'xxxxxxxxxx', name: 'happy' }, user)).status, 403);
			assert.strictEqual((await api('admin/emoji/test-tagging', {}, user)).status, 403);
		}
	});

	test('選べないモデルは保存できない', async () => {
		const res = await api('admin/update-meta', { anthropicModel: 'claude-3-opus' as any }, root);
		assert.strictEqual(res.status, 400);
	});

	test('無い絵文字には NO_SUCH_EMOJI', async () => {
		const res = await api('admin/emoji/suggest-tags', { emojiId: 'xxxxxxxxxx' }, root);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_EMOJI');
	});

	test('保存したキーは返さず、末尾 4 文字だけ返す。モデレーションログにも残さない', async () => {
		await successfulApiCall({ endpoint: 'admin/update-meta', parameters: { anthropicApiKey: apiKey, anthropicModel: 'claude-haiku-5-5' }, user: root });

		const meta = await successfulApiCall({ endpoint: 'admin/meta', parameters: {}, user: root });
		assert.strictEqual(meta.anthropicApiKeyHint, 'Qx7A');
		assert.strictEqual(meta.anthropicModel, 'claude-haiku-5-5');
		assert.ok(!JSON.stringify(meta).includes(apiKey));

		// モデレーションログは応答の後に書かれることがあるので、現れるまで待つ
		let logs: misskey.entities.AdminShowModerationLogsResponse = [];
		for (let i = 0; i < 50 && logs.length === 0; i++) {
			logs = await successfulApiCall({ endpoint: 'admin/show-moderation-logs', parameters: { type: 'updateServerSettings', search: 'claude-haiku-5-5', limit: 1 }, user: root });
			if (logs.length === 0) await new Promise(resolve => setTimeout(resolve, 100));
		}
		assert.strictEqual(logs.length, 1);
		assert.ok(!JSON.stringify(logs[0]).includes(apiKey));
	});

	test('空にするとキーを消す', async () => {
		await successfulApiCall({ endpoint: 'admin/update-meta', parameters: { anthropicApiKey: '' }, user: root });
		const meta = await successfulApiCall({ endpoint: 'admin/meta', parameters: {}, user: root });
		assert.strictEqual(meta.anthropicApiKeyHint, null);
	});
});

describe('カテゴリをまとめる', () => {
	let root: misskey.entities.SignupResponse;
	let alice: misskey.entities.SignupResponse;

	beforeAll(async () => {
		await initTestDb(true);
		root = await signup({ username: 'root' });
		alice = await signup({ username: 'alice' });

		const file = (await uploadFile(root)).body!;
		for (const [name, category] of [['blob_a', 'blob'], ['blob_b', 'blob'], ['other_a', 'other']] as const) {
			await successfulApiCall({ endpoint: 'admin/emoji/add', parameters: { name, category, fileId: file.id, aliases: [] }, user: root });
		}
	}, 1000 * 60 * 2);

	test('カテゴリの絵文字をすべて別のカテゴリに移す', async () => {
		const res = await successfulApiCall({ endpoint: 'admin/emoji/merge-category', parameters: { from: 'blob', to: 'other' }, user: root });
		assert.strictEqual(res.count, 2);

		const emojis = await successfulApiCall({ endpoint: 'admin/emoji/list', parameters: { limit: 100 }, user: root });
		assert.deepStrictEqual(emojis.map(it => it.category).sort(), ['other', 'other', 'other']);
	});

	test('絵文字の無いカテゴリは NO_SUCH_CATEGORY', async () => {
		const res = await api('admin/emoji/merge-category', { from: 'blob', to: 'other' }, root);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_CATEGORY');
	});

	test('絵文字を管理できない人は使えない', async () => {
		const res = await api('admin/emoji/merge-category', { from: 'other', to: 'blob' }, alice);
		assert.strictEqual(res.status, 403);
	});
});
