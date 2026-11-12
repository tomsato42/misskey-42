/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { PairRecruitmentService } from '@/core/pair/PairRecruitmentService.js';
import { PairRecruitmentEntityService } from '@/core/entities/PairRecruitmentEntityService.js';
import { pairRecruitmentApiErrors, withPairRecruitmentApiErrors } from '../../pair-recruitment-errors.js';

export const meta = {
	tags: ['pair-recruitments'],

	requireCredential: true,

	kind: 'write:account',

	limit: {
		duration: 1000 * 60 * 60,
		max: 60,
	},

	description: '参加希望を見送る (作成者だけ)。通知はしない。見送られた人は同じ募集に再び参加希望を送れない',

	errors: {
		unavailable: pairRecruitmentApiErrors.unavailable,
		noSuchRecruitment: pairRecruitmentApiErrors.noSuchRecruitment,
		notOwner: pairRecruitmentApiErrors.notOwner,
		recruitmentClosed: pairRecruitmentApiErrors.recruitmentClosed,
		noSuchApplication: pairRecruitmentApiErrors.noSuchApplication,
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'PairRecruitmentDetailed',
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		recruitmentId: { type: 'string', format: 'misskey:id' },
		userId: { type: 'string', format: 'misskey:id' },
	},
	required: ['recruitmentId', 'userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private pairRecruitmentService: PairRecruitmentService,
		private pairRecruitmentEntityService: PairRecruitmentEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const recruitment = await withPairRecruitmentApiErrors(meta.errors, () => this.pairRecruitmentService.reject(me, ps.recruitmentId, ps.userId));
			return await this.pairRecruitmentEntityService.packDetailed(recruitment, me);
		});
	}
}
