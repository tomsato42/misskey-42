/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const resultProperties = {
	projectSlug: {
		type: 'string',
		optional: false, nullable: false,
		example: 'webserv',
	},
	projectName: {
		type: 'string',
		optional: false, nullable: false,
		example: 'webserv',
	},
	finalMark: {
		type: 'integer',
		optional: false, nullable: false,
		example: 125,
	},
	validated: {
		type: 'boolean',
		optional: false, nullable: false,
	},
	outstandingCount: {
		type: 'integer',
		optional: false, nullable: true,
		description: 'The number of evaluations flagged as outstanding. null if unknown.',
	},
	members: {
		type: 'array',
		optional: false, nullable: false,
		description: 'The team members (including yourself). Empty if unknown.',
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				login: {
					type: 'string',
					optional: false, nullable: false,
				},
				user: {
					type: 'object',
					optional: false, nullable: true,
					ref: 'UserLite',
					description: 'null if the member has no account on this server.',
				},
			},
		},
	},
} as const;

/** 自分の課題の結果 (点数を共有するときに選ぶ) */
export const packedIntraProjectResultSchema = {
	type: 'object',
	properties: {
		id: {
			type: 'string',
			optional: false, nullable: false,
			format: 'id',
		},
		...resultProperties,
		markedAt: {
			type: 'string',
			optional: false, nullable: true,
			format: 'date-time',
		},
	},
} as const;

/** ノートに付けた課題の結果 (投稿した時点の値) */
export const packedIntraProjectNoteSchema = {
	type: 'object',
	properties: {
		...resultProperties,
	},
} as const;
