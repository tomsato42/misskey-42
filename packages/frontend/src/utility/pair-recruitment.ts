/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ペア募集 (/pair) の表示で使う判定と文言。API の呼び出しは pair-recruitment-action.ts に置く

import { versatileLang } from '@@/js/intl-const.js';
import type * as Misskey from 'misskey-js';
import { i18n } from '@/i18n.js';

export type PairProjectState = NonNullable<Misskey.entities.PairRecruitment['myProjectState']>;

type RecruitmentForCount = Pick<Misskey.entities.PairRecruitment, 'teamSize' | 'acceptedCount'>;

/** 募集のページの URL のパス (/pair/<id>) から募集の ID を取り出す */
const PAIR_RECRUITMENT_PATH = /^\/pair\/([0-9a-z]+)\/?$/;

/**
 * 自分のインスタンスの募集のページの URL なら、募集の ID を返す。それ以外 (別のホスト、/pair/new など) は null
 */
export function parsePairRecruitmentUrl(url: string, localUrl: string): string | null {
	let target: URL;
	let local: URL;
	try {
		target = new URL(url);
		local = new URL(localUrl);
	} catch {
		return null;
	}
	if (target.origin !== local.origin) return null;
	const m = PAIR_RECRUITMENT_PATH.exec(target.pathname);
	if (m == null || m[1] === 'new') return null;
	return m[1];
}

/**
 * 空いている枠の数 (作成者と承認済みのメンバーを除いた人数)
 */
export function getRemainingSlots(recruitment: RecruitmentForCount): number {
	return Math.max(0, recruitment.teamSize - 1 - recruitment.acceptedCount);
}

/**
 * 締め切りまでの残り日数 (切り上げ)。過ぎていれば 0
 */
export function getDaysUntil(expiresAt: string, now: Date): number {
	const ms = new Date(expiresAt).getTime() - now.getTime();
	if (ms <= 0) return 0;
	return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

/**
 * その課題の判定で、募集の作成と参加ができるか (バックエンドの canWorkOn と同じ)
 */
export function canWorkOn(state: PairProjectState | null | undefined): boolean {
	return state === 'available' || state === 'in_progress';
}

/**
 * 閲覧者がこの募集に参加希望を送れるか。送れない理由の判定はバックエンドに任せ、ボタンを押せるかだけを決める
 */
export function canApply(recruitment: Pick<Misskey.entities.PairRecruitment, 'status' | 'myStatus' | 'myProjectState'> & RecruitmentForCount): boolean {
	if (recruitment.status !== 'open') return false;
	// 取り下げた人と、招待された人 (返事待ち・見送り) は送れる
	if (recruitment.myStatus != null && recruitment.myStatus !== 'withdrawn' && recruitment.myStatus !== 'invited' && recruitment.myStatus !== 'declined') return false;
	if (getRemainingSlots(recruitment) === 0) return false;
	return canWorkOn(recruitment.myProjectState);
}

/**
 * 選んだ課題のどれでも組める人数 (作成者を含む)。バックエンドの getCommonTeamSizeRange と同じ
 */
export function getCommonTeamSizes(projects: Pick<Misskey.entities.PairRecruitmentProject, 'minGroupSize' | 'maxGroupSize'>[]): number[] {
	if (projects.length === 0) return [];
	const min = Math.max(2, ...projects.map(p => p.minGroupSize));
	const max = Math.min(...projects.map(p => p.maxGroupSize));
	return getTeamSizeRange({ minGroupSize: min, maxGroupSize: max });
}

/**
 * 複数の課題をまとめた募集か
 */
export function isMultiProject(recruitment: Pick<Misskey.entities.PairRecruitment, 'projects'>): boolean {
	return recruitment.projects.length > 1;
}

/**
 * 募集のページの URL
 */
export function getPairRecruitmentUrl(localUrl: string, id: string): string {
	return `${localUrl}/pair/${id}`;
}

/**
 * ほかの場所に貼る募集の文章。分かる項目は埋め、分からない項目 (活動可能時間) は空けておく
 */
export function buildPairShareText(recruitment: Misskey.entities.PairRecruitmentDetailed, url: string, now = new Date()): string {
	const t = i18n.ts._pairRecruitment._shareTemplate;
	const names = recruitment.projects.map(p => p.name);
	const current = recruitment.acceptedCount + 1;
	const lines = [
		t.name,
		recruitment.ownerIntraLogin ?? recruitment.user.username,
		'',
		t.project,
		names.length > 1 ? i18n.tsx._pairRecruitment._shareTemplate.projectAny({ projects: names.join('/') }) : names[0],
		'',
		t.period,
		getStartTimingText(recruitment, now),
		'',
		t.teamSize,
		i18n.tsx._pairRecruitment._shareTemplate.teamSizeText({ n: recruitment.teamSize, current, remaining: getRemainingSlots(recruitment) }),
		'',
		t.status,
		recruitment.myStatus === 'owner' && recruitment.myProjectState === 'in_progress' ? t.inProgress : t.notStarted,
		'',
		t.availableTime,
		'',
		'',
		t.motivation,
		recruitment.comment ?? '',
		'',
		t.link,
		url,
	];
	return lines.join('\n');
}

/**
 * 募集で選べる人数 (作成者を含む) の範囲。バックエンドの getTeamSizeRange と同じで、下限は 2 から
 */
export function getTeamSizeRange(project: Pick<Misskey.entities.PairRecruitmentProject, 'minGroupSize' | 'maxGroupSize'>): number[] {
	const min = Math.max(2, project.minGroupSize);
	const sizes: number[] = [];
	for (let n = min; n <= project.maxGroupSize; n++) sizes.push(n);
	return sizes;
}

/**
 * 始める時期の表示 (今すぐ / 来週から / 来月から / 10月25日から)
 */
export function getStartTimingText(recruitment: Pick<Misskey.entities.PairRecruitment, 'startTiming' | 'startDate'>, now = new Date()): string {
	if (recruitment.startTiming !== 'date') return i18n.ts._pairRecruitment._startTiming[recruitment.startTiming];
	if (recruitment.startDate == null) return i18n.ts._pairRecruitment._startTiming.date;
	const [y, m, d] = recruitment.startDate.split('-').map(v => parseInt(v, 10));
	const date = new Date(y, m - 1, d);
	const text = date.toLocaleDateString(versatileLang, y === now.getFullYear()
		? { month: 'long', day: 'numeric' }
		: { year: 'numeric', month: 'long', day: 'numeric' });
	return i18n.tsx._pairRecruitment.startFrom({ date: text });
}

/**
 * 課題の人数の表示 (2人で取り組む課題 / 2〜4人で取り組む課題)
 */
export function getGroupSizeText(project: Pick<Misskey.entities.PairRecruitment['project'], 'minGroupSize' | 'maxGroupSize'>): string {
	const min = Math.max(2, project.minGroupSize);
	if (min >= project.maxGroupSize) return i18n.tsx._pairRecruitment.groupSizeProject({ n: project.maxGroupSize });
	return i18n.tsx._pairRecruitment.groupSizeRangeProject({ min, max: project.maxGroupSize });
}

const errorCodeToKey = {
	PAIR_RECRUITMENT_UNAVAILABLE: 'unavailable',
	NO_CAMPUS: 'noCampus',
	NO_SUCH_PROJECT: 'noSuchProject',
	NOT_PAIR_PROJECT: 'notPairProject',
	INVALID_TEAM_SIZE: 'invalidTeamSize',
	INVALID_START_DATE: 'invalidStartDate',
	COMMENT_TOO_LONG: 'commentTooLong',
	PROJECT_NOT_AVAILABLE: 'projectNotAvailable',
	TOO_MANY_OPEN_RECRUITMENTS: 'tooManyOpenRecruitments',
	NO_SUCH_RECRUITMENT: 'noSuchRecruitment',
	RECRUITMENT_CLOSED: 'recruitmentClosed',
	CANNOT_APPLY_OWN: 'cannotApplyOwn',
	ALREADY_APPLIED: 'alreadyApplied',
	REJECTED_BEFORE: 'rejectedBefore',
	NOT_OWNER: 'notOwner',
	NO_SUCH_APPLICATION: 'noSuchApplication',
	APPLICANT_NOT_AVAILABLE: 'applicantNotAvailable',
	FULL: 'full',
	NOT_MEMBER: 'notMember',
	BLOCKED: 'blocked',
	ANNOUNCE_PERMISSION_DENIED: 'announcePermissionDenied',
	TOO_MANY_PROJECTS: 'tooManyProjects',
	INVALID_PROJECTS: 'invalidProjects',
	NO_COMMON_TEAM_SIZE: 'noCommonTeamSize',
	INVALID_WANTED_PROJECTS: 'invalidWantedProjects',
	MEMBER_WOULD_LOSE_PROJECT: 'memberWouldLoseProject',
	TEAM_SIZE_BELOW_MEMBERS: 'teamSizeBelowMembers',
	TOO_MANY_INVITATIONS: 'tooManyInvitations',
	CANNOT_INVITE: 'cannotInvite',
	NOT_INVITED: 'notInvited',
} as const satisfies Record<string, keyof typeof i18n.ts._pairRecruitment._errors>;

/**
 * ペア募集の API のエラーを、利用者に見せる文に変える。知らないエラーは null
 */
export function getPairRecruitmentErrorText(err: unknown): string | null {
	if (err == null || typeof err !== 'object' || !('code' in err) || typeof err.code !== 'string') return null;
	if (!Object.hasOwn(errorCodeToKey, err.code)) return null;
	const key = errorCodeToKey[err.code as keyof typeof errorCodeToKey];
	return i18n.ts._pairRecruitment._errors[key];
}
