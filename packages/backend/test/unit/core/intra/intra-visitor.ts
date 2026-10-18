/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import {
	INTRA_FIXED_META,
	INTRA_VISITOR_ALLOWED_ENDPOINTS,
	applyIntraMetaOverrides,
	isEndpointAllowedForIntraVisitor,
	isIntraMode,
} from '@/core/intra/intra-visitor.js';
import * as metaEndpoint from '@/server/api/endpoints/meta.js';
import * as adminAccountsCreateEndpoint from '@/server/api/endpoints/admin/accounts/create.js';
import type { Config } from '@/config.js';
import type { IEndpointMeta } from '@/server/api/endpoints.js';

type EndpointModule = { meta: IEndpointMeta };

// 許可リストを変えたら、ここにもそのエンドポイントのモジュールを追加する
const allowedEndpointModules: Record<string, EndpointModule> = {
	'meta': metaEndpoint,
	'admin/accounts/create': adminAccountsCreateEndpoint,
};

const intraConfig = {
	intra: {
		clientId: 'id',
		clientSecret: 'secret',
		cursusId: 21,
		apiBaseUrl: 'https://api.intra.42.fr',
		levelBadgeUrl: null,
	},
} satisfies Pick<Config, 'intra'>;

const noIntraConfig = { intra: undefined } satisfies Pick<Config, 'intra'>;

describe('INTRA_VISITOR_ALLOWED_ENDPOINTS', () => {
	test('ログイン画面と最初の管理者の作成に必要なものだけを許可する', () => {
		expect([...INTRA_VISITOR_ALLOWED_ENDPOINTS].sort()).toEqual(['admin/accounts/create', 'meta']);
	});

	test('許可するエンドポイントは実在し、トークンなしで呼び出せるものである', async () => {
		// endpoint-list.ts を import するとすべてのエンドポイントを読み込んで遅いので、登録は文字列で確かめる
		const endpointList = await readFile(new URL('../../../../src/server/api/endpoint-list.ts', import.meta.url), 'utf-8');
		for (const name of INTRA_VISITOR_ALLOWED_ENDPOINTS) {
			expect(endpointList, name).toContain(`export * as '${name}' from './endpoints/${name}.js';`);
			const ep = allowedEndpointModules[name];
			expect(ep, name).toBeDefined();
			expect(ep.meta.requireCredential ?? false, name).toBe(false);
			expect(ep.meta.requireModerator ?? false, name).toBe(false);
			expect(ep.meta.requireAdmin ?? false, name).toBe(false);
			expect(ep.meta.secure ?? false, name).toBe(false);
		}
	});
});

describe('isEndpointAllowedForIntraVisitor', () => {
	test('許可リストにあるものだけ true', () => {
		expect(isEndpointAllowedForIntraVisitor('meta')).toBe(true);
		expect(isEndpointAllowedForIntraVisitor('admin/accounts/create')).toBe(true);
	});

	test('投稿・ユーザー・統計・絵文字などは false', () => {
		for (const name of ['notes/timeline', 'notes/local-timeline', 'notes/show', 'users/show', 'users', 'stats', 'emojis', 'emoji', 'get-online-users-count', 'pinned-users', 'hashtags/trend', 'server-info', 'endpoints']) {
			expect(isEndpointAllowedForIntraVisitor(name), name).toBe(false);
		}
	});

	test('前方一致や大文字小文字の違いでは許可しない', () => {
		expect(isEndpointAllowedForIntraVisitor('meta/')).toBe(false);
		expect(isEndpointAllowedForIntraVisitor('Meta')).toBe(false);
		expect(isEndpointAllowedForIntraVisitor('admin/accounts')).toBe(false);
	});
});

describe('isIntraMode', () => {
	test('config.intra の有無で判定する', () => {
		expect(isIntraMode(intraConfig)).toBe(true);
		expect(isIntraMode(noIntraConfig)).toBe(false);
	});
});

describe('applyIntraMetaOverrides', () => {
	test('学内SNSモードでは DB の値にかかわらず固定値にする', () => {
		const meta = { federation: 'all' as const, ugcVisibilityForVisitor: 'local' as const, name: 'test' };
		const result = applyIntraMetaOverrides(meta, intraConfig);
		expect(result).toBe(meta);
		expect(meta).toEqual({ ...INTRA_FIXED_META, name: 'test' });
		expect(meta.federation).toBe('none');
		expect(meta.ugcVisibilityForVisitor).toBe('none');
	});

	test('連携が無効なら変更しない', () => {
		const meta = { federation: 'all' as const, ugcVisibilityForVisitor: 'local' as const };
		applyIntraMetaOverrides(meta, noIntraConfig);
		expect(meta).toEqual({ federation: 'all', ugcVisibilityForVisitor: 'local' });
	});
});
