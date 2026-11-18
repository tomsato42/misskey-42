/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import bcrypt from 'bcryptjs';
import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UserProfilesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { WebAuthnService } from '@/core/WebAuthnService.js';
import { ApiError } from '@/server/api/error.js';
import { UserAuthService } from '@/core/UserAuthService.js';
import { IntraAuthService } from '@/core/intra/IntraAuthService.js';

export const meta = {
	requireCredential: true,

	secure: true,

	errors: {
		intraReauthRequired: {
			message: 'Verify yourself by signing in to 42 intra again.',
			code: 'INTRA_REAUTH_REQUIRED',
			id: '9aeff541-7333-43b9-9015-b749135ee62a',
		},

		userNotFound: {
			message: 'User not found.',
			code: 'USER_NOT_FOUND',
			id: '652f899f-66d4-490e-993e-6606c8ec04c3',
		},

		incorrectPassword: {
			message: 'Incorrect password.',
			code: 'INCORRECT_PASSWORD',
			id: '38769596-efe2-4faf-9bec-abbb3f2cd9ba',
		},

		twoFactorNotEnabled: {
			message: '2fa not enabled.',
			code: 'TWO_FACTOR_NOT_ENABLED',
			id: 'bf32b864-449b-47b8-974e-f9a5468546f1',
		},
	},

	res: {
		type: 'object',
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		password: { type: 'string' },
		token: { type: 'string', nullable: true },
	},
	required: [],
} as const;

// eslint-disable-next-line import/no-default-export
@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private webAuthnService: WebAuthnService,
		private userAuthService: UserAuthService,
		private intraAuthService: IntraAuthService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const token = ps.token;
			const profile = await this.userProfilesRepository.findOne({
				where: {
					userId: me.id,
				},
				relations: { user: true },
			});

			if (profile == null) {
				throw new ApiError(meta.errors.userNotFound);
			}

			if (profile.twoFactorEnabled) {
				if (token == null) {
					throw new Error('authentication failed');
				}

				try {
					await this.userAuthService.twoFactorAuthenticate(profile, token);
				} catch (_) {
					throw new Error('authentication failed');
				}
			}

			// 42 intra で作ったアカウントはパスワードを持たないので、パスワード (と TOTP の登録) の代わりに 42 での本人確認を求める
			const usesIntraReauth = this.intraAuthService.usesIntraReauth(profile);
			if (usesIntraReauth) {
				if (!await this.intraAuthService.hasRecentReauth(me.id)) {
					throw new ApiError(meta.errors.intraReauthRequired);
				}
			} else {
				const passwordMatched = await bcrypt.compare(ps.password ?? '', profile.password ?? '');
				if (!passwordMatched) {
					throw new ApiError(meta.errors.incorrectPassword);
				}

				if (!profile.twoFactorEnabled) {
					throw new ApiError(meta.errors.twoFactorNotEnabled);
				}
			}

			return await this.webAuthnService.initiateRegistration(
				me.id,
				profile.user?.username ?? me.id,
				profile.user?.name ?? undefined,
			);
		});
	}
}
