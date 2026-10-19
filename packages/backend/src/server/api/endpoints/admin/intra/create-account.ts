/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Config } from '@/config.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { IntraAccountError, IntraAccountService } from '@/core/intra/IntraAccountService.js';
import type { IntraAccountFailureReason } from '@/core/intra/IntraAccountService.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireAdmin: true,
	// 発行する登録リンクはアカウントにログインできる鍵なので、公式のクライアントだけが使えるようにする
	secure: true,
	kind: 'write:admin:account',

	description: 'Find or create the account of a 42 intra user by their login, and issue a link to register a passkey. Used for people who cannot sign in to 42 intra (e.g. after the black hole).',

	errors: {
		intraDisabled: {
			message: '42 intra integration is not enabled.',
			code: 'INTRA_DISABLED',
			id: '55d203c3-b1d8-4d99-a347-7a5bba378204',
		},

		intraError: {
			message: 'Failed to fetch the user from 42 intra.',
			code: 'INTRA_ERROR',
			id: 'cd346a85-2801-4b02-bab5-86faafe8f1e7',
		},

		noSuchIntraUser: {
			message: 'No such 42 intra user.',
			code: 'NO_SUCH_INTRA_USER',
			id: 'cd5a27fa-74e1-414c-b27a-4f48fd54336d',
		},

		notEligible: {
			message: 'The 42 intra user has no record of the cursus.',
			code: 'NOT_ELIGIBLE',
			id: 'f4b8e116-5fc4-478d-ac5b-814e24052274',
		},

		suspended: {
			message: 'The account is suspended.',
			code: 'SUSPENDED',
			id: '6c592365-0569-4f2b-b0d1-e14eada1e3cd',
		},

		usernameTaken: {
			message: 'The username is already taken.',
			code: 'USERNAME_TAKEN',
			id: 'debc8a42-e3d2-4f41-b67d-5a2fdbb4ce2a',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			userId: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
			},
			username: {
				type: 'string',
				optional: false, nullable: false,
			},
			created: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			linked: {
				type: 'boolean',
				optional: false, nullable: false,
			},
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
		login: { type: 'string', pattern: '^[a-zA-Z0-9-]{1,32}$' },
		// 42 の API で確かめられなかったとき (見つからない・在籍記録が無い・通信の失敗) に、管理者が別の方法で確かめたものとして作る
		manuallyVerified: { type: 'boolean', default: false },
	},
	required: ['login'],
} as const;

const errorsByReason: Record<IntraAccountFailureReason, typeof meta.errors[keyof typeof meta.errors]> = {
	intra_error: meta.errors.intraError,
	not_found: meta.errors.noSuchIntraUser,
	not_eligible: meta.errors.notEligible,
	suspended: meta.errors.suspended,
	username_taken: meta.errors.usernameTaken,
};

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.config)
		private config: Config,

		private intraAccountService: IntraAccountService,
		private moderationLogService: ModerationLogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (this.config.intra == null) {
				throw new ApiError(meta.errors.intraDisabled);
			}

			let result;
			try {
				result = await this.intraAccountService.findOrCreateAccount(ps.login, ps.manuallyVerified);
			} catch (err) {
				if (err instanceof IntraAccountError) {
					throw new ApiError(errorsByReason[err.reason]);
				}
				throw err;
			}

			const { url, expiresAt } = await this.intraAccountService.issuePasskeySetup(result.user.id);

			this.moderationLogService.log(me, 'issueIntraPasskeySetup', {
				userId: result.user.id,
				userUsername: result.user.username,
				intraLogin: ps.login,
				created: result.created,
				linked: result.linked,
				manuallyVerified: ps.manuallyVerified,
			});

			return {
				userId: result.user.id,
				username: result.user.username,
				created: result.created,
				linked: result.linked,
				url,
				expiresAt: expiresAt.toISOString(),
			};
		});
	}
}
