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

	description: 'ペア募集の一覧。open: 自分と同じキャンパスの募集中の募集、mine: 自分の募集 (締め切ったものを含む)、joined: 参加希望を送った・参加している募集 (締め切ったものを含む)。新しい順',

	errors: {
		unavailable: pairRecruitmentApiErrors.unavailable,
	},

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'PairRecruitment',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		tab: { type: 'string', enum: ['open', 'mine', 'joined'], default: 'open' },
		projectSlug: { type: 'string', nullable: true, minLength: 1, maxLength: 128 },
		/** 自分が取り組める (available / in_progress の) 課題の募集だけにする */
		onlyWorkable: { type: 'boolean', default: false },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private pairRecruitmentService: PairRecruitmentService,
		private pairRecruitmentEntityService: PairRecruitmentEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const recruitments = await withPairRecruitmentApiErrors(meta.errors, () => this.pairRecruitmentService.list(me, {
				tab: ps.tab,
				projectSlug: ps.projectSlug,
				onlyWorkable: ps.onlyWorkable,
				sinceId: ps.sinceId,
				untilId: ps.untilId,
				limit: ps.limit,
			}));
			return await this.pairRecruitmentEntityService.packMany(recruitments, me);
		});
	}
}
