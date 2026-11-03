/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import bcrypt from 'bcryptjs';
import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UserProfilesRepository, UserSecurityKeysRepository } from '@/models/_.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { DI } from '@/di-symbols.js';
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
			id: '45d3560c-49ef-48e3-b35b-925a97008798',
		},

		incorrectPassword: {
			message: 'Incorrect password.',
			code: 'INCORRECT_PASSWORD',
			id: '141c598d-a825-44c8-9173-cfb9d92be493',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		password: { type: 'string' },
		token: { type: 'string', nullable: true },
		credentialId: { type: 'string' },
	},
	required: ['credentialId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.userSecurityKeysRepository)
		private userSecurityKeysRepository: UserSecurityKeysRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private userEntityService: UserEntityService,
		private userAuthService: UserAuthService,
		private globalEventService: GlobalEventService,
		private intraAuthService: IntraAuthService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const token = ps.token;
			const profile = await this.userProfilesRepository.findOneByOrFail({ userId: me.id });

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
			}

			// Make sure we only delete the user's own creds
			await this.userSecurityKeysRepository.delete({
				userId: me.id,
				id: ps.credentialId,
			});

			// 使われているキーがなくなったらパスワードレスログインをやめる
			const keyCount = await this.userSecurityKeysRepository.count({
				where: {
					userId: me.id,
				},
				select: {
					id: true,
					name: true,
					lastUsed: true,
				},
			});

			if (keyCount === 0) {
				await this.userProfilesRepository.update(me.id, {
					usePasswordLessLogin: false,
				});
			}

			// Publish meUpdated event
			this.globalEventService.publishMainStream(me.id, 'meUpdated', await this.userEntityService.pack(me.id, me, {
				schema: 'MeDetailed',
				includeSecrets: true,
			}));

			return {};
		});
	}
}
