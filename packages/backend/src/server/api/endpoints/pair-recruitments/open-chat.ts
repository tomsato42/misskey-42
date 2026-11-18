/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { PairRecruitmentService } from '@/core/pair/PairRecruitmentService.js';
import { pairRecruitmentApiErrors, withPairRecruitmentApiErrors } from '../../pair-recruitment-errors.js';

export const meta = {
	tags: ['pair-recruitments', 'chat'],

	requireCredential: true,

	kind: 'write:chat',

	limit: {
		duration: 1000 * 60 * 60,
		max: 60,
	},

	description: '募集のチーム候補で話すチャットルームを開く。作成者・参加希望中・参加が決まった人 (締め切った後は作成者と参加が決まった人) だけ。ルームが無ければ作り、自分が入っていなければ入れる',

	errors: {
		unavailable: pairRecruitmentApiErrors.unavailable,
		noSuchRecruitment: pairRecruitmentApiErrors.noSuchRecruitment,
		notMember: pairRecruitmentApiErrors.notMember,
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			roomId: { type: 'string', optional: false, nullable: false, format: 'id' },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		recruitmentId: { type: 'string', format: 'misskey:id' },
	},
	required: ['recruitmentId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private pairRecruitmentService: PairRecruitmentService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const roomId = await withPairRecruitmentApiErrors(meta.errors, () => this.pairRecruitmentService.openChat(me, ps.recruitmentId));
			return { roomId };
		});
	}
}
