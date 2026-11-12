/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { IntraAuthService } from '@/core/intra/IntraAuthService.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';

export const meta = {
	tags: ['account'],

	requireCredential: true,

	// パスキーの登録の前に求める本人確認なので、公式のクライアントだけが始められるようにする
	secure: true,

	limit: {
		duration: 1000 * 60 * 60,
		max: 30,
	},

	description: 'Start verifying yourself by signing in to 42 intra again. Open the returned URL in the browser; after that, you can register or remove passkeys for a while.',

	errors: {
		notIntraUser: {
			message: 'Your account is not linked to 42 intra.',
			code: 'NOT_INTRA_USER',
			id: '7d5cd999-e922-4101-ab05-ecacc15e7eb1',
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
		@Inject(DI.config)
		private config: Config,

		private intraAuthService: IntraAuthService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const ticket = await this.intraAuthService.createReauthTicket(me.id);
			if (ticket == null) {
				throw new ApiError(meta.errors.notIntraUser);
			}

			return {
				url: `${this.config.apiUrl}/intra/authorize?reauth=${encodeURIComponent(ticket)}`,
			};
		});
	}
}
