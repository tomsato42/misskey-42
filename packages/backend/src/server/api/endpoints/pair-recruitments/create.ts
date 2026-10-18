/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { PairRecruitmentService } from '@/core/pair/PairRecruitmentService.js';
import { PairRecruitmentEntityService } from '@/core/entities/PairRecruitmentEntityService.js';
import { PAIR_RECRUITMENT_COMMENT_MAX_LENGTH, pairStartTimings } from '@/core/pair/pair-recruitment.js';
import { pairRecruitmentApiErrors, withPairRecruitmentApiErrors } from '../../pair-recruitment-errors.js';

export const meta = {
	tags: ['pair-recruitments'],

	requireCredential: true,

	kind: 'write:account',

	description: 'ペア募集を作成する。announce が true なら、募集のページの URL を含むノートをタイムラインにも投稿する (連携アプリのトークンでは write:notes も必要)',

	limit: {
		duration: 1000 * 60 * 60,
		max: 10,
	},

	errors: {
		unavailable: pairRecruitmentApiErrors.unavailable,
		noCampus: pairRecruitmentApiErrors.noCampus,
		noSuchProject: pairRecruitmentApiErrors.noSuchProject,
		notPairProject: pairRecruitmentApiErrors.notPairProject,
		invalidTeamSize: pairRecruitmentApiErrors.invalidTeamSize,
		invalidStartDate: pairRecruitmentApiErrors.invalidStartDate,
		commentTooLong: pairRecruitmentApiErrors.commentTooLong,
		projectNotAvailable: pairRecruitmentApiErrors.projectNotAvailable,
		tooManyOpenRecruitments: pairRecruitmentApiErrors.tooManyOpenRecruitments,
		announcePermissionDenied: {
			message: 'Announcing to the timeline requires the write:notes permission.',
			code: 'ANNOUNCE_PERMISSION_DENIED',
			id: '120fc07a-c896-474e-932f-60ebd268b050',
			kind: 'permission',
		},
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
		projectSlug: { type: 'string', minLength: 1, maxLength: 128 },
		teamSize: { type: 'integer', minimum: 2 },
		startTiming: { type: 'string', enum: pairStartTimings },
		/** startTiming が date のときの日付 (YYYY-MM-DD) */
		startDate: { type: 'string', nullable: true, pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
		comment: { type: 'string', nullable: true, maxLength: PAIR_RECRUITMENT_COMMENT_MAX_LENGTH },
		announce: { type: 'boolean', default: false },
	},
	required: ['projectSlug', 'teamSize', 'startTiming'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private pairRecruitmentService: PairRecruitmentService,
		private pairRecruitmentEntityService: PairRecruitmentEntityService,
	) {
		super(meta, paramDef, async (ps, me, token) => {
			// 告知はノートの投稿になるので、連携アプリのトークンでは write:notes も必要にする (Web クライアントのトークンは null)
			if (ps.announce && token != null && !token.permission.includes('write:notes')) {
				throw new ApiError(meta.errors.announcePermissionDenied);
			}

			const recruitment = await withPairRecruitmentApiErrors(meta.errors, () => this.pairRecruitmentService.create(me, {
				projectSlug: ps.projectSlug,
				teamSize: ps.teamSize,
				startTiming: ps.startTiming,
				startDate: ps.startDate,
				comment: ps.comment,
				announce: ps.announce,
			}));
			return await this.pairRecruitmentEntityService.packDetailed(recruitment, me);
		});
	}
}
