/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { IntraProjectResultService } from '@/core/intra/IntraProjectResultService.js';
import { IntraProjectNoteEntityService } from '@/core/entities/IntraProjectNoteEntityService.js';

export const meta = {
	tags: ['account'],

	requireCredential: true,

	kind: 'read:account',

	description: '42times: Get your 42 intra project results (projects with a final mark, passed or not), newest first. They are synced when you log in and every hour.',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'IntraProjectResult',
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
		private intraProjectResultService: IntraProjectResultService,
		private intraProjectNoteEntityService: IntraProjectNoteEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const results = await this.intraProjectResultService.list(me.id);
			return await this.intraProjectNoteEntityService.packResults(results, me);
		});
	}
}
