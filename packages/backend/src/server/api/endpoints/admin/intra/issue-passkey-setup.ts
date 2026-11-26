/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import type { UsersRepository } from '@/models/_.js';
import type { Config } from '@/config.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { RoleService } from '@/core/RoleService.js';
import { SystemAccountService } from '@/core/SystemAccountService.js';
import { IntraAccountService } from '@/core/intra/IntraAccountService.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireAdmin: true,
	// 発行する登録リンクはアカウントにログインできる鍵なので、公式のクライアントだけが使えるようにする
	secure: true,
	kind: 'write:admin:account',

	description: 'Issue a link to register a passkey to an existing local account. Used for people who cannot sign in to 42 intra (e.g. after the black hole).',

	errors: {
		intraDisabled: {
			message: '42 intra integration is not enabled.',
			code: 'INTRA_DISABLED',
			id: '01f39509-4f7a-4ddb-aba1-28d28520499f',
		},

		noSuchUser: {
			message: 'No such user.',
			code: 'NO_SUCH_USER',
			id: '08555453-a067-4b02-90a8-0068e8b2df04',
		},

		accessDenied: {
			message: 'Cannot issue a passkey setup link for another administrator.',
			code: 'ACCESS_DENIED',
			id: '9968189d-bbd4-4046-a970-dadf4f67cb13',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			url: {
				type: 'string',
				optional: false, nullable: false,
			},
			expiresAt: {
				type: 'string',
				optional: false, nullable: false,
				format: 'date-time',
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
	},
	required: ['userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private intraAccountService: IntraAccountService,
		private moderationLogService: ModerationLogService,
		private roleService: RoleService,
		private systemAccountService: SystemAccountService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (this.config.intra == null) {
				throw new ApiError(meta.errors.intraDisabled);
			}

			const user = await this.usersRepository.findOneBy({ id: ps.userId, host: IsNull(), isDeleted: false });
			if (user == null) {
				throw new ApiError(meta.errors.noSuchUser);
			}

			// システムアカウントにはログインさせない
			if ((await this.systemAccountService.list()).some(account => account.userId === user.id)) {
				throw new ApiError(meta.errors.noSuchUser);
			}

			// 登録リンクはそのアカウントにログインできる鍵になるので、ほかの管理者 (root を含む) のアカウントには出さない (reset-password と同じ)
			if (await this.roleService.isAdministrator(user) && me.id !== user.id) {
				throw new ApiError(meta.errors.accessDenied);
			}

			const { url, expiresAt } = await this.intraAccountService.issuePasskeySetup(user.id);

			this.moderationLogService.log(me, 'issueIntraPasskeySetup', {
				userId: user.id,
				userUsername: user.username,
				intraLogin: null,
				created: false,
				linked: null,
				manuallyVerified: null,
			});

			return {
				url,
				expiresAt: expiresAt.toISOString(),
			};
		});
	}
}
