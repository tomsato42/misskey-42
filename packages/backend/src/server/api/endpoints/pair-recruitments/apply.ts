/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { PairRecruitmentService } from '@/core/pair/PairRecruitmentService.js';
import { PairRecruitmentEntityService } from '@/core/entities/PairRecruitmentEntityService.js';
import { PAIR_RECRUITMENT_MAX_PROJECTS } from '@/core/pair/pair-recruitment.js';
import { pairRecruitmentApiErrors, withPairRecruitmentApiErrors } from '../../pair-recruitment-errors.js';

export const meta = {
	tags: ['pair-recruitments'],

	requireCredential: true,

	kind: 'write:account',

	description: 'ペア募集に参加希望を送る。wantedProjectSlugs (やりたい課題) のすべてで自分の判定が available か in_progress のときだけ送れる。指定しなければ取り組める課題すべてになる。招待された人も送れる。作成者に通知する',

	limit: {
		duration: 1000 * 60 * 60,
		max: 30,
	},

	errors: {
		unavailable: pairRecruitmentApiErrors.unavailable,
		noSuchRecruitment: pairRecruitmentApiErrors.noSuchRecruitment,
		blocked: pairRecruitmentApiErrors.blocked,
		cannotApplyOwn: pairRecruitmentApiErrors.cannotApplyOwn,
		recruitmentClosed: pairRecruitmentApiErrors.recruitmentClosed,
		alreadyApplied: pairRecruitmentApiErrors.alreadyApplied,
		rejectedBefore: pairRecruitmentApiErrors.rejectedBefore,
		full: pairRecruitmentApiErrors.full,
		projectNotAvailable: pairRecruitmentApiErrors.projectNotAvailable,
		invalidWantedProjects: pairRecruitmentApiErrors.invalidWantedProjects,
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
		wantedProjectSlugs: { type: 'array', nullable: true, minItems: 1, maxItems: PAIR_RECRUITMENT_MAX_PROJECTS, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 128 } },
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
			const recruitment = await withPairRecruitmentApiErrors(meta.errors, () => this.pairRecruitmentService.apply(me, ps.recruitmentId, ps.wantedProjectSlugs));
			return await this.pairRecruitmentEntityService.packDetailed(recruitment, me);
		});
	}
}
