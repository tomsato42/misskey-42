/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import type { UserProfilesRepository, UsersRepository } from '@/models/_.js';
import type { Config } from '@/config.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'write:admin:account',

	errors: {
		intraDisabled: {
			message: '42 intra integration is not enabled.',
			code: 'INTRA_DISABLED',
			id: '3522766a-d779-438a-8971-e87ed415974a',
		},

		noSuchUser: {
			message: 'No such user.',
			code: 'NO_SUCH_USER',
			id: '44e23d49-8bce-4940-b852-e7050181067c',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
		allowed: { type: 'boolean' },
	},
	required: ['userId', 'allowed'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private moderationLogService: ModerationLogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (this.config.intra == null) {
				throw new ApiError(meta.errors.intraDisabled);
			}

			const user = await this.usersRepository.findOneBy({ id: ps.userId, host: IsNull() });
			if (user == null) {
				throw new ApiError(meta.errors.noSuchUser);
			}

			const currentProfile = await this.userProfilesRepository.findOneByOrFail({ userId: user.id });

			await this.userProfilesRepository.update({ userId: user.id }, {
				intraPasswordLoginAllowed: ps.allowed,
			});

			this.moderationLogService.log(me, 'updateIntraPasswordLoginAllowed', {
				userId: user.id,
				userUsername: user.username,
				userHost: user.host,
				before: currentProfile.intraPasswordLoginAllowed,
				after: ps.allowed,
			});
		});
	}
}
