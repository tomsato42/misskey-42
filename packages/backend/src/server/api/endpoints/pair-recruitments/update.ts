/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { PairRecruitmentService } from '@/core/pair/PairRecruitmentService.js';
import { PairRecruitmentEntityService } from '@/core/entities/PairRecruitmentEntityService.js';
import { PAIR_RECRUITMENT_COMMENT_MAX_LENGTH, PAIR_RECRUITMENT_MAX_PROJECTS, pairStartTimings } from '@/core/pair/pair-recruitment.js';
import { pairRecruitmentApiErrors, withPairRecruitmentApiErrors } from '../../pair-recruitment-errors.js';

export const meta = {
	tags: ['pair-recruitments'],

	requireCredential: true,

	kind: 'write:account',

	limit: {
		duration: 1000 * 60 * 60,
		max: 60,
	},

	description: '募集を編集する (作成者だけ、募集中の間だけ)。指定した項目だけを変える。課題を外すと、その課題だけをやりたい参加希望は取り下げになり、本人に通知する。参加が決まったメンバーのやりたい課題をすべて外すことはできない。人数を参加が決まった人数ちょうどにすると締め切る',

	errors: {
		unavailable: pairRecruitmentApiErrors.unavailable,
		noSuchRecruitment: pairRecruitmentApiErrors.noSuchRecruitment,
		notOwner: pairRecruitmentApiErrors.notOwner,
		recruitmentClosed: pairRecruitmentApiErrors.recruitmentClosed,
		noCampus: pairRecruitmentApiErrors.noCampus,
		noSuchProject: pairRecruitmentApiErrors.noSuchProject,
		notPairProject: pairRecruitmentApiErrors.notPairProject,
		projectNotAvailable: pairRecruitmentApiErrors.projectNotAvailable,
		tooManyProjects: pairRecruitmentApiErrors.tooManyProjects,
		invalidProjects: pairRecruitmentApiErrors.invalidProjects,
		noCommonTeamSize: pairRecruitmentApiErrors.noCommonTeamSize,
		invalidTeamSize: pairRecruitmentApiErrors.invalidTeamSize,
		teamSizeBelowMembers: pairRecruitmentApiErrors.teamSizeBelowMembers,
		memberWouldLoseProject: pairRecruitmentApiErrors.memberWouldLoseProject,
		invalidStartDate: pairRecruitmentApiErrors.invalidStartDate,
		commentTooLong: pairRecruitmentApiErrors.commentTooLong,
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
		projectSlugs: { type: 'array', minItems: 1, maxItems: PAIR_RECRUITMENT_MAX_PROJECTS, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 128 } },
		teamSize: { type: 'integer', minimum: 2 },
		startTiming: { type: 'string', enum: pairStartTimings },
		/** startTiming が date のときの日付 (YYYY-MM-DD)。startTiming を指定したときだけ使う */
		startDate: { type: 'string', nullable: true, pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
		comment: { type: 'string', nullable: true, maxLength: PAIR_RECRUITMENT_COMMENT_MAX_LENGTH },
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
			const recruitment = await withPairRecruitmentApiErrors(meta.errors, () => this.pairRecruitmentService.update(me, ps.recruitmentId, {
				projectSlugs: ps.projectSlugs,
				teamSize: ps.teamSize,
				startTiming: ps.startTiming,
				startDate: ps.startDate,
				comment: ps.comment,
			}));
			return await this.pairRecruitmentEntityService.packDetailed(recruitment, me);
		});
	}
}
