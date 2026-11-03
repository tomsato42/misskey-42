/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { DriveFilesRepository, EmojisRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { EmojiTagSuggestionService } from '@/core/emoji-tagging/EmojiTagSuggestionService.js';
import { MAX_CURRENT_TAGS, MAX_EXCLUDED_TAGS, MAX_HINT_LENGTH, MAX_PROMPT_NAME_LENGTH, summarizeCategories } from '@/core/emoji-tagging/emoji-tagging.js';
import { CustomEmojiService } from '@/core/CustomEmojiService.js';
import { emojiTaggingApiErrors, withEmojiTaggingApiErrors } from '@/server/api/emoji-tagging-errors.js';
import { ApiError } from '../../../error.js';

export const meta = {
	tags: ['admin'],

	description: 'Ask Claude to suggest tags (aliases) and a category for a local custom emoji, or for an image that is about to be registered as one. The category is one of the existing categories, or a new one if none fits. Nothing is saved. Requires the Claude API key in the server settings.',

	requireCredential: true,
	// 費用がかかるので、絵文字を管理できる人やモデレーターではなく管理者だけ
	requireAdmin: true,
	// 何も保存しないが Claude の費用がかかるので、読み取りだけの権限では呼べないようにする
	kind: 'write:admin:emoji',

	// 画面からは同時に 4 件ずつ送る。速いモデルでも引っかからない程度にし、Claude 側の上限は Claude のエラーで分かる
	limit: {
		duration: 1000 * 60,
		max: 300,
	},

	errors: {
		noSuchEmoji: {
			message: 'No such emoji.',
			code: 'NO_SUCH_EMOJI',
			id: '71adde95-6a5a-4ad6-9d61-ec0697b2a385',
		},
		noSuchFile: {
			message: 'No such image file.',
			code: 'NO_SUCH_FILE',
			id: 'cd3846f8-3999-4d6e-b1d6-7d28dccef088',
		},
		...emojiTaggingApiErrors,
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			tags: {
				type: 'array',
				optional: false, nullable: false,
				items: {
					type: 'string',
					optional: false, nullable: false,
				},
			},
			category: {
				type: 'object',
				optional: false, nullable: true,
				properties: {
					name: {
						type: 'string',
						optional: false, nullable: false,
					},
					isNew: {
						type: 'boolean',
						optional: false, nullable: false,
						description: 'Whether the category does not exist yet.',
					},
				},
			},
		},
	},
} as const;

export const paramDef = {
	allOf: [
		{
			anyOf: [
				{
					type: 'object',
					properties: {
						emojiId: { type: 'string', format: 'misskey:id' },
					},
					required: ['emojiId'],
				},
				{
					type: 'object',
					properties: {
						fileId: { type: 'string', format: 'misskey:id' },
						name: { type: 'string', minLength: 1, maxLength: MAX_PROMPT_NAME_LENGTH },
					},
					required: ['fileId', 'name'],
				},
			],
		},
		{
			type: 'object',
			properties: {
				category: { type: 'string', nullable: true, maxLength: MAX_PROMPT_NAME_LENGTH },
				currentTags: {
					type: 'array',
					description: 'Tags the emoji already has. They are not suggested again. Defaults to the aliases of the emoji.',
					maxItems: MAX_CURRENT_TAGS,
					items: { type: 'string', maxLength: MAX_PROMPT_NAME_LENGTH },
				},
				excludedTags: {
					type: 'array',
					description: 'Tags suggested before. Claude suggests other words instead.',
					maxItems: MAX_EXCLUDED_TAGS,
					items: { type: 'string', maxLength: MAX_PROMPT_NAME_LENGTH },
				},
				hint: { type: 'string', nullable: true, maxLength: MAX_HINT_LENGTH },
			},
		},
	],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.emojisRepository)
		private emojisRepository: EmojisRepository,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		private emojiTagSuggestionService: EmojiTagSuggestionService,
		private customEmojiService: CustomEmojiService,
	) {
		super(meta, paramDef, async (ps) => {
			let imageUrl: string;
			let name: string;
			let category: string | null;
			let currentTags: string[];

			if ('emojiId' in ps) {
				const emoji = await this.emojisRepository.findOneBy({ id: ps.emojiId, host: IsNull() });
				if (emoji == null) throw new ApiError(meta.errors.noSuchEmoji);
				imageUrl = emoji.originalUrl;
				name = emoji.name;
				category = ps.category !== undefined ? ps.category : emoji.category;
				currentTags = ps.currentTags ?? emoji.aliases;
			} else {
				const file = await this.driveFilesRepository.findOneBy({ id: ps.fileId });
				// SVG なども画像にして送れるので、画像なら種類は問わない
				if (file == null || !file.type.startsWith('image/')) throw new ApiError(meta.errors.noSuchFile);
				imageUrl = file.url;
				name = ps.name;
				category = ps.category ?? null;
				currentTags = ps.currentTags ?? [];
			}

			const localEmojis = await this.customEmojiService.localEmojisCache.fetch();
			const categories = summarizeCategories([...localEmojis.values()]);

			return await withEmojiTaggingApiErrors(() => this.emojiTagSuggestionService.suggest(imageUrl, {
				name,
				category,
				currentTags,
				excludedTags: ps.excludedTags ?? [],
				hint: ps.hint ?? null,
			}, categories));
		});
	}
}
