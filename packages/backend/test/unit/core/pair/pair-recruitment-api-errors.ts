/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ペア募集の API のエラー定義と、サービスのエラーから API エラーへの変換を確かめる

import { describe, expect, test } from 'vitest';
import { PairRecruitmentError } from '@/core/pair/pair-recruitment.js';
import { ApiError } from '@/server/api/error.js';
import { pairRecruitmentApiErrors, withPairRecruitmentApiErrors } from '@/server/api/pair-recruitment-errors.js';
import * as accept from '@/server/api/endpoints/pair-recruitments/accept.js';
import * as apply from '@/server/api/endpoints/pair-recruitments/apply.js';
import * as cancelInvitation from '@/server/api/endpoints/pair-recruitments/cancel-invitation.js';
import * as close from '@/server/api/endpoints/pair-recruitments/close.js';
import * as create from '@/server/api/endpoints/pair-recruitments/create.js';
import * as decline from '@/server/api/endpoints/pair-recruitments/decline.js';
import * as invite from '@/server/api/endpoints/pair-recruitments/invite.js';
import * as inviteCandidates from '@/server/api/endpoints/pair-recruitments/invite-candidates.js';
import * as update from '@/server/api/endpoints/pair-recruitments/update.js';
import * as list from '@/server/api/endpoints/pair-recruitments/list.js';
import * as projects from '@/server/api/endpoints/pair-recruitments/projects.js';
import * as reject from '@/server/api/endpoints/pair-recruitments/reject.js';
import * as show from '@/server/api/endpoints/pair-recruitments/show.js';
import * as withdraw from '@/server/api/endpoints/pair-recruitments/withdraw.js';

/** エンドポイント固有のエラー (共通の定義に無いもの) */
const ENDPOINT_SPECIFIC_ERRORS = new Set(['announcePermissionDenied']);

describe('pair-recruitments のエラー定義', () => {
	const endpoints = { accept, apply, cancelInvitation, close, create, decline, invite, inviteCandidates, list, projects, reject, show, update, withdraw };

	test.each(Object.entries(endpoints))('%s の meta.errors は共通の定義をそのまま使う', (_name, mod) => {
		const errors = mod.meta.errors as Record<string, unknown>;
		expect(errors.unavailable).toBe(pairRecruitmentApiErrors.unavailable);
		for (const [key, def] of Object.entries(errors)) {
			if (ENDPOINT_SPECIFIC_ERRORS.has(key)) continue;
			expect(def).toBe(pairRecruitmentApiErrors[key as keyof typeof pairRecruitmentApiErrors]);
		}
	});

	test('すべてのエラーの ID は互いに異なる', () => {
		const ids = Object.values(pairRecruitmentApiErrors).map(e => e.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe('withPairRecruitmentApiErrors', () => {
	test('meta.errors にあるコードは API エラーに変換する', async () => {
		const promise = withPairRecruitmentApiErrors({ full: pairRecruitmentApiErrors.full }, async () => {
			throw new PairRecruitmentError('full');
		});
		await expect(promise).rejects.toBeInstanceOf(ApiError);
		await expect(promise).rejects.toMatchObject({ code: 'FULL', id: pairRecruitmentApiErrors.full.id });
	});

	test('meta.errors に無いコードとほかの例外はそのまま投げる', async () => {
		await expect(withPairRecruitmentApiErrors({}, async () => {
			throw new PairRecruitmentError('full');
		})).rejects.toBeInstanceOf(PairRecruitmentError);

		const err = new Error('db');
		await expect(withPairRecruitmentApiErrors({}, async () => {
			throw err;
		})).rejects.toBe(err);
	});

	test('成功したら値を返す', async () => {
		expect(await withPairRecruitmentApiErrors({}, async () => 42)).toBe(42);
	});
});
