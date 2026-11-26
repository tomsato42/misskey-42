/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { PairRecruitmentService } from '@/core/pair/PairRecruitmentService.js';
import { pairRecruitmentApiErrors, withPairRecruitmentApiErrors } from '../../pair-recruitment-errors.js';

export const meta = {
	tags: ['pair-recruitments'],

	requireCredential: true,

	kind: 'read:account',

	description: '自分のキャンパスの 2 人以上で取り組む課題と、自分のその課題の判定の一覧。取り組める課題 (available, in_progress) を上に並べる。キャンパスが分からなければ空',

	errors: {
		unavailable: pairRecruitmentApiErrors.unavailable,
	},

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'PairRecruitmentProject',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private pairRecruitmentService: PairRecruitmentService,
	) {
		super(meta, paramDef, async (ps, me) => {
			return await withPairRecruitmentApiErrors(meta.errors, () => this.pairRecruitmentService.getProjects(me));
		});
	}
}
