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

	kind: 'read:account',

	limit: {
		duration: 1000 * 60 * 60,
		max: 300,
	},

	description: '招待の候補 (作成者だけ)。同じキャンパスで、募集の課題のどれか (projectSlug を指定したらその課題) に取り組めて、招待を受け取る人。既に参加希望を送った人と招待した人は除く',

	errors: {
		unavailable: pairRecruitmentApiErrors.unavailable,
		noSuchRecruitment: pairRecruitmentApiErrors.noSuchRecruitment,
		notOwner: pairRecruitmentApiErrors.notOwner,
		recruitmentClosed: pairRecruitmentApiErrors.recruitmentClosed,
	},

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'PairInviteCandidate',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		recruitmentId: { type: 'string', format: 'misskey:id' },
		projectSlug: { type: 'string', nullable: true, minLength: 1, maxLength: 128 },
		/** 名前・ユーザー名・intra のログイン名の一部 */
		query: { type: 'string', nullable: true, maxLength: 128 },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
	},
	required: ['recruitmentId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private pairRecruitmentService: PairRecruitmentService,
		private pairRecruitmentEntityService: PairRecruitmentEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const candidates = await withPairRecruitmentApiErrors(meta.errors, () => this.pairRecruitmentService.getInviteCandidates(me, ps.recruitmentId, {
				projectSlug: ps.projectSlug,
				query: ps.query,
				limit: ps.limit,
			}));
			return await this.pairRecruitmentEntityService.packInviteCandidates(candidates, me);
		});
	}
}
