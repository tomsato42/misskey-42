/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { EmojisRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { CustomEmojiService } from '@/core/CustomEmojiService.js';
import { ApiError } from '../../../error.js';

export const meta = {
	tags: ['admin'],

	description: 'Move every local custom emoji in a category to another category, so that the old category disappears.',

	requireCredential: true,
	requiredRolePolicy: 'canManageCustomEmojis',
	kind: 'write:admin:emoji',

	errors: {
		noSuchCategory: {
			message: 'No local emoji is in the category.',
			code: 'NO_SUCH_CATEGORY',
			id: '46fd85f0-852c-49d8-a897-39361be2d098',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			count: {
				type: 'integer',
				optional: false, nullable: false,
				description: 'The number of emojis moved.',
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		from: { type: 'string', minLength: 1 },
		to: {
			type: 'string',
			nullable: true,
			maxLength: 512,
			description: 'Use `null` to remove the category from the emojis.',
		},
	},
	required: ['from', 'to'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.emojisRepository)
		private emojisRepository: EmojisRepository,

		private customEmojiService: CustomEmojiService,
	) {
		super(meta, paramDef, async (ps) => {
			const to = ps.to?.trim() || null;

			const emojis = await this.emojisRepository.find({
				where: { host: IsNull(), category: ps.from },
				select: { id: true },
			});
			if (emojis.length === 0) throw new ApiError(meta.errors.noSuchCategory);
			if (to === ps.from) return { count: 0 };

			await this.customEmojiService.setCategoryBulk(emojis.map(it => it.id), to);
			return { count: emojis.length };
		});
	}
}
