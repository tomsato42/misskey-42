/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ペア募集の API (pair-recruitments/*) が返すエラー。
// 同じ種類のエラーはどのエンドポイントでも同じ ID を返し、各エンドポイントは返しうるものだけを meta.errors に並べる。

import { PairRecruitmentError } from '@/core/pair/pair-recruitment.js';
import type { PairRecruitmentErrorCode } from '@/core/pair/pair-recruitment.js';
import { ApiError } from './error.js';

type ErrorDef = { message: string; code: string; id: string };

export const pairRecruitmentApiErrors = {
	unavailable: {
		message: 'Pair recruitment is not available on this server or for your account.',
		code: 'PAIR_RECRUITMENT_UNAVAILABLE',
		id: '1b2244bd-e80a-4f77-8eb4-6722aa224b63',
	},
	noCampus: {
		message: 'Your campus is unknown. Sign in with 42 intra again.',
		code: 'NO_CAMPUS',
		id: '60fcbcda-10a5-485c-ad5e-3ec964937911',
	},
	noSuchProject: {
		message: 'No such project in your campus.',
		code: 'NO_SUCH_PROJECT',
		id: '559e0985-f0ea-4959-bef4-2965c1990dd5',
	},
	notPairProject: {
		message: 'The project is not for a group of two or more.',
		code: 'NOT_PAIR_PROJECT',
		id: 'fa4a1841-5961-49ab-9000-7c7424838f8c',
	},
	invalidTeamSize: {
		message: 'The team size is out of the range of the project.',
		code: 'INVALID_TEAM_SIZE',
		id: '9c390fcd-caa4-4ef2-82d5-830249c33fde',
	},
	invalidStartDate: {
		message: 'Invalid start date.',
		code: 'INVALID_START_DATE',
		id: 'ca55c4c1-7843-4964-ae51-9f73b3b1bca3',
	},
	commentTooLong: {
		message: 'The comment is too long.',
		code: 'COMMENT_TOO_LONG',
		id: '852c4d79-7942-4f92-a4ed-12fc9f347b44',
	},
	projectNotAvailable: {
		message: 'You cannot work on this project (locked or finished).',
		code: 'PROJECT_NOT_AVAILABLE',
		id: '238e4c3f-3b66-45c0-a543-f20e748502fc',
	},
	tooManyOpenRecruitments: {
		message: 'You have too many open recruitments.',
		code: 'TOO_MANY_OPEN_RECRUITMENTS',
		id: '9fe1ccd2-0867-4c29-b530-a72cdecc197b',
	},
	noSuchRecruitment: {
		message: 'No such recruitment.',
		code: 'NO_SUCH_RECRUITMENT',
		id: 'a2478ed7-94d4-4964-a6ce-dfb5f8a302ba',
	},
	recruitmentClosed: {
		message: 'The recruitment is closed.',
		code: 'RECRUITMENT_CLOSED',
		id: '9f5ade45-3220-4646-9507-0d616976f6d3',
	},
	cannotApplyOwn: {
		message: 'You cannot apply to your own recruitment.',
		code: 'CANNOT_APPLY_OWN',
		id: 'cd082af4-0988-4593-aba3-411ecf233dec',
	},
	alreadyApplied: {
		message: 'You have already applied to this recruitment.',
		code: 'ALREADY_APPLIED',
		id: '29b34d88-a934-4a52-9775-ccf7839b1bd5',
	},
	rejectedBefore: {
		message: 'Your application to this recruitment was declined.',
		code: 'REJECTED_BEFORE',
		id: '507cc7c2-ead7-4ca0-ab4d-f2bdb728fe20',
	},
	notOwner: {
		message: 'You are not the owner of this recruitment.',
		code: 'NOT_OWNER',
		id: 'b6a7c61c-b867-4c11-99af-6ffbedcb858b',
	},
	noSuchApplication: {
		message: 'No such pending application.',
		code: 'NO_SUCH_APPLICATION',
		id: '033fe4de-c66b-4586-9425-aebd707cc371',
	},
	applicantNotAvailable: {
		message: 'The applicant cannot work on this project (locked or finished).',
		code: 'APPLICANT_NOT_AVAILABLE',
		id: 'f5db883e-cf6f-490e-97a4-7f9346995f53',
	},
	full: {
		message: 'The team is already full.',
		code: 'FULL',
		id: '5b6e57b1-415f-4243-a976-469d859e7faf',
	},
	notMember: {
		message: 'You have not applied to this recruitment.',
		code: 'NOT_MEMBER',
		id: 'cfab8870-7773-48a7-91ec-261c0ecc6e7e',
	},
	blocked: {
		message: 'You cannot apply to this recruitment.',
		code: 'BLOCKED',
		id: '755c961f-15c4-4aaa-8e87-437e2764fab7',
	},
	tooManyProjects: {
		message: 'Too many projects in one recruitment.',
		code: 'TOO_MANY_PROJECTS',
		id: 'b80ab931-0ccf-44ef-ba57-ccb18c7641be',
	},
	invalidProjects: {
		message: 'The list of projects is empty or has duplicates.',
		code: 'INVALID_PROJECTS',
		id: '8cba6a88-19ce-4bbc-92fb-37680d640880',
	},
	noCommonTeamSize: {
		message: 'The projects have no team size in common.',
		code: 'NO_COMMON_TEAM_SIZE',
		id: '2bfcf2d3-3f03-4809-b08f-06c4b6e4715d',
	},
	invalidWantedProjects: {
		message: 'The wanted projects are empty or not in this recruitment.',
		code: 'INVALID_WANTED_PROJECTS',
		id: '0e4d1095-ff81-406b-9b12-25608d84440d',
	},
	memberWouldLoseProject: {
		message: 'A member would lose all of their wanted projects.',
		code: 'MEMBER_WOULD_LOSE_PROJECT',
		id: 'afa88b31-7cfc-46d8-b993-88e503c2a875',
	},
	teamSizeBelowMembers: {
		message: 'The team size is smaller than the accepted members.',
		code: 'TEAM_SIZE_BELOW_MEMBERS',
		id: '03ae61ef-8493-4c30-be04-4a828f7bed8d',
	},
	tooManyInvitations: {
		message: 'Too many invitations for this recruitment.',
		code: 'TOO_MANY_INVITATIONS',
		id: '7f8c0e3e-4ba0-4c62-a437-7733e35098c4',
	},
	cannotInvite: {
		message: 'The user cannot be invited to this recruitment.',
		code: 'CANNOT_INVITE',
		id: 'fae204ef-0e88-4730-a156-4047d3ba2c02',
	},
	notInvited: {
		message: 'You are not invited to this recruitment.',
		code: 'NOT_INVITED',
		id: '928a3f41-1077-4e75-a866-c6406d089124',
	},
} as const satisfies Record<PairRecruitmentErrorCode, ErrorDef>;

/**
 * サービスの PairRecruitmentError を、エンドポイントの meta.errors にある同じ名前の API エラーに変換する。
 * meta.errors に無いもの (想定外) とその他の例外はそのまま投げる
 */
export async function withPairRecruitmentApiErrors<T>(errors: Partial<Record<PairRecruitmentErrorCode, ErrorDef>>, fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof PairRecruitmentError) {
			const def = errors[err.code];
			if (def != null) throw new ApiError(def);
		}
		throw err;
	}
}
