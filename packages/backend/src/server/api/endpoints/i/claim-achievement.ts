/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { AchievementService } from '@/core/AchievementService.js';
import { ACHIEVEMENT_TYPES, SERVER_ONLY_ACHIEVEMENT_TYPES } from '@/models/UserProfile.js';

export const meta = {
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:account',
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		name: { type: 'string', enum: ACHIEVEMENT_TYPES },
	},
	required: ['name'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private achievementService: AchievementService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// 42times: 招待した人数の実績は backend が数えて付けるので、クライアントからは付けられない
			if (SERVER_ONLY_ACHIEVEMENT_TYPES.includes(ps.name)) return;
			await this.achievementService.create(me.id, ps.name);
		});
	}
}
