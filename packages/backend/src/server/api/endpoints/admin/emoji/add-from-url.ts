/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MiDriveFile } from '@/models/_.js';
import { CustomEmojiService } from '@/core/CustomEmojiService.js';
import { DriveService } from '@/core/DriveService.js';
import { EmojiEntityService } from '@/core/entities/EmojiEntityService.js';
import { FILE_TYPE_IMAGE } from '@/const.js';
import { ApiError } from '../../../error.js';

export const meta = {
	tags: ['admin'],

	description: 'Download an image from the specified URL and register it as a local custom emoji. The file is not stored in anyone\'s drive.',

	requireCredential: true,
	requiredRolePolicy: 'canManageCustomEmojis',
	kind: 'write:admin:emoji',

	errors: {
		failedToDownload: {
			message: 'Failed to download the file.',
			code: 'FAILED_TO_DOWNLOAD',
			id: '36c01d71-3da0-40a0-80f0-ab74217d39c3',
		},
		unsupportedFileType: {
			message: 'Unsupported file type.',
			code: 'UNSUPPORTED_FILE_TYPE',
			id: '90ed7eb5-9da6-45c7-89b0-7c5ff64c9634',
		},
		duplicateName: {
			message: 'Duplicate name.',
			code: 'DUPLICATE_NAME',
			id: 'f7a3462c-4e6e-4069-8421-b9bd4f4c3975',
		},
	},

	res: {
		type: 'object',
		ref: 'EmojiDetailed',
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		name: { type: 'string', pattern: '^[a-zA-Z0-9_]+$' },
		url: { type: 'string', pattern: '^https?://' },
		category: {
			type: 'string',
			nullable: true,
			description: 'Use `null` to reset the category.',
		},
		aliases: {
			type: 'array',
			items: {
				type: 'string',
			},
		},
		license: { type: 'string', nullable: true },
		isSensitive: { type: 'boolean' },
		localOnly: { type: 'boolean' },
	},
	required: ['name', 'url'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private customEmojiService: CustomEmojiService,
		private emojiEntityService: EmojiEntityService,
		private driveService: DriveService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// 取り込む前に名前の重複を確かめ、使わないファイルを作らないようにする
			const isDuplicate = await this.customEmojiService.checkDuplicate(ps.name);
			if (isDuplicate) throw new ApiError(meta.errors.duplicateName);

			let driveFile: MiDriveFile;
			try {
				// admin/emoji/copy と同じく、誰のドライブにも入れない
				driveFile = await this.driveService.uploadFromUrl({ url: ps.url, user: null, force: true });
			} catch {
				throw new ApiError(meta.errors.failedToDownload);
			}

			if (!FILE_TYPE_IMAGE.includes(driveFile.type)) {
				await this.driveService.deleteFileSync(driveFile);
				throw new ApiError(meta.errors.unsupportedFileType);
			}

			const emoji = await this.customEmojiService.add({
				originalUrl: driveFile.url,
				publicUrl: driveFile.webpublicUrl ?? driveFile.url,
				fileType: driveFile.webpublicType ?? driveFile.type,
				name: ps.name,
				category: ps.category ?? null,
				aliases: ps.aliases ?? [],
				host: null,
				license: ps.license ?? null,
				isSensitive: ps.isSensitive ?? false,
				localOnly: ps.localOnly ?? false,
				roleIdsThatCanBeUsedThisEmojiAsReaction: [],
			}, me);

			return this.emojiEntityService.packDetailed(emoji);
		});
	}
}
