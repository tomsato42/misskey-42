/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { IntraNotLinkedError, IntraProjectRefreshService, IntraRefreshInProgressError } from '@/core/intra/IntraProjectRefreshService.js';

export const meta = {
	tags: ['account'],

	requireCredential: true,

	kind: 'write:account',

	description: '42times: Fetch your 42 intra information (including project results) now instead of waiting for the hourly sync. It returns immediately, and an intraProjectsRefreshed notification arrives when fetching finishes.',

	// 42 API の制限に掛からないよう、1 人あたりの回数を絞る
	limit: {
		duration: ms('1minute'),
		max: 1,
	},

	errors: {
		notLinked: {
			message: 'You are not linked with 42 intra.',
			code: 'NOT_LINKED_WITH_INTRA',
			id: 'fefe5dd9-090f-47fc-ba47-184420934d3f',
		},

		inProgress: {
			message: 'Fetching is already in progress.',
			code: 'INTRA_REFRESH_IN_PROGRESS',
			id: '4c3c4369-c06d-4a10-a2ee-2b684d284df9',
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
		private intraProjectRefreshService: IntraProjectRefreshService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				await this.intraProjectRefreshService.requestRefresh(me.id);
			} catch (err) {
				if (err instanceof IntraNotLinkedError) throw new ApiError(meta.errors.notLinked);
				if (err instanceof IntraRefreshInProgressError) throw new ApiError(meta.errors.inProgress);
				throw err;
			}
		});
	}
}
