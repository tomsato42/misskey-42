/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
	pairClosedReasons,
	pairMemberStatuses,
	pairRecruitmentStatuses,
	pairStartTimings,
	pairViewerStatuses,
} from '@/core/pair/pair-recruitment.js';

/** 課題の判定 (judgeProjectAvailability の state) */
const projectStates = ['available', 'in_progress', 'finished', 'locked'] as const;

/** 課題の判定の理由 (judgeProjectAvailability の reason) */
const projectStateReasons = [
	'registered',
	'validated',
	'equivalentValidated',
	'equivalentInProgress',
	'forbiddenQuestValidated',
	'requiredQuestMissing',
	'requiredProjectMissing',
] as const;

/**
 * 募集の作成と一覧の絞り込みで使う課題 (自分のキャンパスの、2 人以上で取り組む課題) と、自分の判定
 */
export const packedPairRecruitmentProjectSchema = {
	type: 'object',
	properties: {
		slug: {
			type: 'string',
			optional: false, nullable: false,
		},
		name: {
			type: 'string',
			optional: false, nullable: false,
		},
		minGroupSize: {
			type: 'integer',
			optional: false, nullable: false,
		},
		maxGroupSize: {
			type: 'integer',
			optional: false, nullable: false,
		},
		state: {
			type: 'string',
			optional: false, nullable: false,
			enum: projectStates,
		},
		reason: {
			type: 'string',
			optional: false, nullable: true,
			enum: projectStateReasons,
		},
		openRecruitmentCount: {
			type: 'integer',
			optional: false, nullable: false,
		},
	},
} as const;

const packedPairRecruitmentProperties = {
	id: {
		type: 'string',
		optional: false, nullable: false,
		format: 'id',
	},
	createdAt: {
		type: 'string',
		optional: false, nullable: false,
		format: 'date-time',
	},
	expiresAt: {
		type: 'string',
		optional: false, nullable: false,
		format: 'date-time',
	},
	closedAt: {
		type: 'string',
		optional: false, nullable: true,
		format: 'date-time',
	},
	status: {
		type: 'string',
		optional: false, nullable: false,
		enum: pairRecruitmentStatuses,
	},
	closedReason: {
		type: 'string',
		optional: false, nullable: true,
		enum: pairClosedReasons,
	},
	userId: {
		type: 'string',
		optional: false, nullable: false,
		format: 'id',
	},
	user: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'UserLite',
	},
	project: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			slug: {
				type: 'string',
				optional: false, nullable: false,
			},
			name: {
				type: 'string',
				optional: false, nullable: false,
			},
			minGroupSize: {
				type: 'integer',
				optional: false, nullable: false,
			},
			maxGroupSize: {
				type: 'integer',
				optional: false, nullable: false,
			},
		},
	},
	projects: {
		type: 'array',
		optional: false, nullable: false,
		description: 'まとめた課題 (1 つ以上)。project は最初の課題で、名前は課題の名前を / でつないだもの',
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				slug: {
					type: 'string',
					optional: false, nullable: false,
				},
				name: {
					type: 'string',
					optional: false, nullable: false,
				},
				minGroupSize: {
					type: 'integer',
					optional: false, nullable: false,
				},
				maxGroupSize: {
					type: 'integer',
					optional: false, nullable: false,
				},
				myState: {
					type: 'string',
					optional: false, nullable: true,
					enum: projectStates,
				},
				wantedCount: {
					type: 'integer',
					optional: false, nullable: false,
					description: 'この課題をやりたい参加希望中・参加中の人数 (作成者を含まない)',
				},
			},
		},
	},
	teamSize: {
		type: 'integer',
		optional: false, nullable: false,
	},
	acceptedCount: {
		type: 'integer',
		optional: false, nullable: false,
	},
	pendingCount: {
		type: 'integer',
		optional: false, nullable: true,
	},
	startTiming: {
		type: 'string',
		optional: false, nullable: false,
		enum: pairStartTimings,
	},
	startDate: {
		type: 'string',
		optional: false, nullable: true,
		format: 'date',
	},
	comment: {
		type: 'string',
		optional: false, nullable: true,
	},
	noteId: {
		type: 'string',
		optional: false, nullable: true,
		format: 'id',
	},
	myProjectState: {
		type: 'string',
		optional: false, nullable: true,
		enum: projectStates,
	},
	myStatus: {
		type: 'string',
		optional: false, nullable: true,
		enum: pairViewerStatuses,
	},
	myWantedProjectSlugs: {
		type: 'array',
		optional: false, nullable: true,
		description: '自分のやりたい課題 (参加希望中・参加中のときだけ)',
		items: {
			type: 'string',
			optional: false, nullable: false,
		},
	},
} as const;

export const packedPairRecruitmentSchema = {
	type: 'object',
	properties: packedPairRecruitmentProperties,
} as const;

export const packedPairMemberSchema = {
	type: 'object',
	properties: {
		id: {
			type: 'string',
			optional: false, nullable: false,
			format: 'id',
		},
		createdAt: {
			type: 'string',
			optional: false, nullable: false,
			format: 'date-time',
		},
		updatedAt: {
			type: 'string',
			optional: false, nullable: false,
			format: 'date-time',
		},
		userId: {
			type: 'string',
			optional: false, nullable: false,
			format: 'id',
		},
		user: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'UserLite',
		},
		status: {
			type: 'string',
			optional: false, nullable: false,
			enum: pairMemberStatuses,
		},
		projectState: {
			type: 'string',
			optional: false, nullable: true,
			enum: projectStates,
		},
		wantedProjectSlugs: {
			type: 'array',
			optional: false, nullable: false,
			items: {
				type: 'string',
				optional: false, nullable: false,
			},
		},
	},
} as const;

export const packedPairRecruitmentDetailedSchema = {
	type: 'object',
	properties: {
		...packedPairRecruitmentProperties,
		ownerIntraProjectUrl: {
			type: 'string',
			optional: false, nullable: true,
			description: '作成者の 42 intra の課題のページ。作成者がその課題に登録したことが無ければ null',
		},
		ownerIntraLogin: {
			type: 'string',
			optional: false, nullable: true,
			description: '作成者の 42 intra のログイン名 (共有の文章に使う)',
		},
		members: {
			type: 'array',
			optional: false, nullable: false,
			description: '参加希望中・参加中・見送った人など (招待は含まない)',
			items: {
				type: 'object',
				optional: false, nullable: false,
				ref: 'PairMember',
			},
		},
		invitations: {
			type: 'array',
			optional: false, nullable: false,
			description: '返事待ちと断られた招待。作成者にだけ返す (ほかの人には空)',
			items: {
				type: 'object',
				optional: false, nullable: false,
				ref: 'PairMember',
			},
		},
	},
} as const;

/**
 * 招待の候補
 */
export const packedPairInviteCandidateSchema = {
	type: 'object',
	properties: {
		user: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'UserLite',
		},
		projectSlugs: {
			type: 'array',
			optional: false, nullable: false,
			description: 'その人が取り組める、募集の課題の slug',
			items: {
				type: 'string',
				optional: false, nullable: false,
			},
		},
	},
} as const;
