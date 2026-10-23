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
		max: 30,
	},

	description: '募集に招待する (作成者だけ)。同じキャンパスで、募集の課題のどれかに取り組めて、招待を受け取る人だけを招待できる。全員を招待できるときだけ送り、招待した人に通知する',

	errors: {
		unavailable: pairRecruitmentApiErrors.unavailable,
		noSuchRecruitment: pairRecruitmentApiErrors.noSuchRecruitment,
		notOwner: pairRecruitmentApiErrors.notOwner,
		recruitmentClosed: pairRecruitmentApiErrors.recruitmentClosed,
		full: pairRecruitmentApiErrors.full,
		tooManyInvitations: pairRecruitmentApiErrors.tooManyInvitations,
		cannotInvite: pairRecruitmentApiErrors.cannotInvite,
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
		userIds: { type: 'array', minItems: 1, maxItems: 10, uniqueItems: true, items: { type: 'string', format: 'misskey:id' } },
	},
	required: ['recruitmentId', 'userIds'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private pairRecruitmentService: PairRecruitmentService,
		private pairRecruitmentEntityService: PairRecruitmentEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const recruitment = await withPairRecruitmentApiErrors(meta.errors, () => this.pairRecruitmentService.invite(me, ps.recruitmentId, ps.userIds));
			return await this.pairRecruitmentEntityService.packDetailed(recruitment, me);
		});
	}
}
