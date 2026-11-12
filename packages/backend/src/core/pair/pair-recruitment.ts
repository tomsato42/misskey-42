/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ペア募集の判定 (人数の範囲、作成・参加・承認の可否、締め切り) と告知の文面を作る純粋関数群。
// DI に依存しないので、ユニットテストから直接呼び出せる。

import type { IntraProjectAvailabilityState } from '@/core/intra/intra-project.js';

/** 募集を自動で締め切るまでの期間 */
export const PAIR_RECRUITMENT_LIFETIME_MS = 1000 * 60 * 60 * 24 * 14;

/** 1 人が同時に持てる募集中の募集の数 */
export const PAIR_RECRUITMENT_MAX_OPEN_PER_USER = 5;

/** ひとことの最大の長さ */
export const PAIR_RECRUITMENT_COMMENT_MAX_LENGTH = 500;

/** 1 つの募集にまとめられる課題の最大の数 */
export const PAIR_RECRUITMENT_MAX_PROJECTS = 4;

/** 1 つの募集から送れる招待の最大の数 (見送られた招待を含む) */
export const PAIR_RECRUITMENT_MAX_INVITATIONS = 30;

/** 始める日として指定できる、今日からの最大の日数 */
export const PAIR_RECRUITMENT_START_DATE_MAX_DAYS = 366;

export const pairStartTimings = ['now', 'nextWeek', 'nextMonth', 'date'] as const;
export type PairStartTiming = typeof pairStartTimings[number];

export const pairRecruitmentStatuses = ['open', 'closed'] as const;
export type PairRecruitmentStatus = typeof pairRecruitmentStatuses[number];

/** full: 人数がそろった、manual: 作成者が締め切った、expired: 期限が過ぎた */
export const pairClosedReasons = ['full', 'manual', 'expired'] as const;
export type PairClosedReason = typeof pairClosedReasons[number];

/**
 * pending: 参加希望、accepted: 承認された、rejected: 見送られた、withdrawn: 取り下げた (本人か、編集で希望した課題が外れた)、
 * invited: 作成者に招待された (まだ返事をしていない)、declined: 招待を断った
 */
export const pairMemberStatuses = ['pending', 'accepted', 'rejected', 'withdrawn', 'invited', 'declined'] as const;
export type PairMemberStatus = typeof pairMemberStatuses[number];

/** 閲覧者から見た募集との関係。owner は作成者 */
export const pairViewerStatuses = ['owner', ...pairMemberStatuses] as const;
export type PairViewerStatus = typeof pairViewerStatuses[number];

export const pairRecruitmentErrorCodes = [
	/** 学内SNSモードではないか、凍結・削除されたユーザー */
	'unavailable',
	/** 自分のキャンパスが分からない (intra_user_progress が無い) */
	'noCampus',
	/** 自分のキャンパスにその課題が無い */
	'noSuchProject',
	/** 2 人以上で取り組む課題ではない */
	'notPairProject',
	/** 人数が課題の範囲の外 */
	'invalidTeamSize',
	/** 始める日の指定が正しくない */
	'invalidStartDate',
	/** ひとことが長すぎる */
	'commentTooLong',
	/** 自分がその課題に取り組めない (locked / finished) */
	'projectNotAvailable',
	/** 募集中の募集が多すぎる */
	'tooManyOpenRecruitments',
	/** 募集が無い (別のキャンパスの募集を含む) */
	'noSuchRecruitment',
	/** 募集が締め切られている */
	'recruitmentClosed',
	/** 自分の募集には参加できない */
	'cannotApplyOwn',
	/** 既に参加希望を送ったか、参加している */
	'alreadyApplied',
	/** 見送られた募集には再び送れない */
	'rejectedBefore',
	/** 作成者ではない */
	'notOwner',
	/** 参加希望が無い (承認・見送りの対象が見つからない) */
	'noSuchApplication',
	/** 参加希望を送った人が、その課題に取り組めなくなっている */
	'applicantNotAvailable',
	/** 人数がそろっている */
	'full',
	/** 参加希望も参加もしていない */
	'notMember',
	/** ブロックの関係にある */
	'blocked',
	/** 課題が多すぎる */
	'tooManyProjects',
	/** 課題の指定が正しくない (空、重複) */
	'invalidProjects',
	/** まとめた課題に共通して組める人数が無い */
	'noCommonTeamSize',
	/** やりたい課題の指定が正しくない (空、募集に無い課題) */
	'invalidWantedProjects',
	/** 参加が決まったメンバーのやりたい課題をすべて外そうとした */
	'memberWouldLoseProject',
	/** 参加が決まったメンバーより少ない人数にしようとした */
	'teamSizeBelowMembers',
	/** 招待が多すぎる */
	'tooManyInvitations',
	/** 招待できない人 (別のキャンパス、招待を受け取らない、取り組めない、既に参加希望を送ったなど) */
	'cannotInvite',
	/** 招待されていない */
	'notInvited',
] as const;
export type PairRecruitmentErrorCode = typeof pairRecruitmentErrorCodes[number];

/**
 * ペア募集の操作の失敗。API では code を同じ名前の API エラーに変換する
 */
export class PairRecruitmentError extends Error {
	public readonly code: PairRecruitmentErrorCode;

	constructor(code: PairRecruitmentErrorCode) {
		super(code);
		this.name = 'PairRecruitmentError';
		this.code = code;
	}
}

export type PairProjectGroupSize = {
	minGroupSize: number | null;
	maxGroupSize: number | null;
};

/**
 * 募集で選べる人数 (作成者を含む) の範囲。2 人以上で取り組む課題でなければ null。
 * 下限のルールが無ければ 2 から
 */
export function getTeamSizeRange(project: PairProjectGroupSize): { min: number; max: number } | null {
	if (project.maxGroupSize == null || project.maxGroupSize < 2) return null;
	const min = Math.max(2, project.minGroupSize ?? 2);
	if (min > project.maxGroupSize) return null;
	return { min, max: project.maxGroupSize };
}

/**
 * まとめた課題のどれでも組める人数の範囲 (それぞれの範囲の重なり)。重なりが無いか、2 人以上で取り組む課題でないものがあれば null
 */
export function getCommonTeamSizeRange(projects: PairProjectGroupSize[]): { min: number; max: number } | null {
	if (projects.length === 0) return null;
	let min = 2;
	let max = Infinity;
	for (const project of projects) {
		const range = getTeamSizeRange(project);
		if (range == null) return null;
		min = Math.max(min, range.min);
		max = Math.min(max, range.max);
	}
	return min <= max ? { min, max } : null;
}

/**
 * 募集の課題の slug (古い行で projectSlugs が空のときは projectSlug)
 */
export function getRecruitmentSlugs(recruitment: { projectSlug: string; projectSlugs: string[] }): string[] {
	return recruitment.projectSlugs.length > 0 ? recruitment.projectSlugs : [recruitment.projectSlug];
}

/**
 * 課題の slug の一覧を確かめる (1 個以上、上限まで、重複なし)
 */
export function normalizeProjectSlugs(slugs: string[]): string[] {
	if (slugs.length === 0) throw new PairRecruitmentError('invalidProjects');
	if (slugs.length > PAIR_RECRUITMENT_MAX_PROJECTS) throw new PairRecruitmentError('tooManyProjects');
	if (new Set(slugs).size !== slugs.length) throw new PairRecruitmentError('invalidProjects');
	return slugs;
}

/**
 * 募集の表示名 (課題の名前を / でつなぐ。列の長さに収める)
 */
export function formatProjectNames(names: string[]): string {
	return names.join(' / ').slice(0, 256);
}

/**
 * やりたい課題を確かめる。指定が無ければ、募集の課題のうち自分が取り組めるものすべて (どれでもいい)。
 * 指定するときは 1 個以上で、募集の課題に限る
 */
export function normalizeWantedProjectSlugs(params: {
	wanted: string[] | null | undefined;
	recruitmentSlugs: string[];
	/** 自分の課題ごとの判定 */
	states: Record<string, IntraProjectAvailabilityState | null>;
}): string[] {
	const { wanted, recruitmentSlugs, states } = params;
	if (wanted == null) {
		const workable = recruitmentSlugs.filter(slug => canWorkOn(states[slug]));
		if (workable.length === 0) throw new PairRecruitmentError('projectNotAvailable');
		return workable;
	}
	if (wanted.length === 0 || new Set(wanted).size !== wanted.length || wanted.some(slug => !recruitmentSlugs.includes(slug))) {
		throw new PairRecruitmentError('invalidWantedProjects');
	}
	// 募集の並び順にそろえる
	return recruitmentSlugs.filter(slug => wanted.includes(slug));
}

/**
 * やりたい課題すべての判定から、参加希望を送るときに使う判定を 1 つ選ぶ。取り組めない課題があればその判定、なければ最初の判定
 */
export function combineWantedStates(states: (IntraProjectAvailabilityState | null)[]): IntraProjectAvailabilityState | null {
	if (states.length === 0) return null;
	return states.find(s => !canWorkOn(s)) ?? states[0];
}

/**
 * やりたい課題の判定から、承認するときに使う判定を 1 つ選ぶ。どれか 1 つでも取り組めればその判定
 */
export function bestWantedState(states: (IntraProjectAvailabilityState | null)[]): IntraProjectAvailabilityState | null {
	if (states.length === 0) return null;
	return states.find(s => canWorkOn(s)) ?? states[0];
}

/**
 * 編集で課題を変えたときのメンバーの扱いを決める。
 * 参加が決まったメンバーのやりたい課題がすべて外れるならエラー。参加希望中でやりたい課題がすべて外れる人は取り下げにする。
 * それ以外の人のやりたい課題は、残る課題だけにする
 */
export function planProjectChange(params: {
	newSlugs: string[];
	members: { userId: string; status: PairMemberStatus; wantedProjectSlugs: string[] }[];
}): { withdrawUserIds: string[]; wanted: Map<string, string[]> } {
	const { newSlugs, members } = params;
	const withdrawUserIds: string[] = [];
	const wanted = new Map<string, string[]>();
	for (const member of members) {
		if (member.status !== 'pending' && member.status !== 'accepted') continue;
		const remaining = member.wantedProjectSlugs.filter(slug => newSlugs.includes(slug));
		if (remaining.length === 0) {
			if (member.status === 'accepted') throw new PairRecruitmentError('memberWouldLoseProject');
			withdrawUserIds.push(member.userId);
			continue;
		}
		if (remaining.length !== member.wantedProjectSlugs.length) wanted.set(member.userId, remaining);
	}
	return { withdrawUserIds, wanted };
}

export function isPairProject(project: PairProjectGroupSize): boolean {
	return getTeamSizeRange(project) != null;
}

export function isValidTeamSize(project: PairProjectGroupSize, teamSize: number): boolean {
	const range = getTeamSizeRange(project);
	if (range == null) return false;
	return Number.isInteger(teamSize) && teamSize >= range.min && teamSize <= range.max;
}

/**
 * その課題の判定で、募集の作成と参加ができるか (取り組める課題か)
 */
export function canWorkOn(state: IntraProjectAvailabilityState | null | undefined): boolean {
	return state === 'available' || state === 'in_progress';
}

/** 判定の並び順。取り組める課題を上にする */
const STATE_ORDER: Record<IntraProjectAvailabilityState, number> = {
	available: 0,
	in_progress: 1,
	locked: 2,
	finished: 3,
};

/**
 * 課題の一覧を、取り組める課題が上に来るように並べる (同じ判定の中では名前順)
 */
export function sortProjectsByState<T extends { name: string; state: IntraProjectAvailabilityState }>(projects: T[]): T[] {
	return [...projects].sort((a, b) => {
		const d = STATE_ORDER[a.state] - STATE_ORDER[b.state];
		if (d !== 0) return d;
		return a.name.localeCompare(b.name, 'en');
	});
}

function toDateString(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/**
 * 始める時期の入力を確かめて、保存する startDate を返す。date 以外では startDate を null にする。
 * 日付は YYYY-MM-DD で、実在する日付であり、昨日 (UTC。時差の分の余裕) から 366 日後までに限る
 */
export function normalizeStartDate(timing: PairStartTiming, startDate: string | null | undefined, now: Date): string | null {
	if (timing !== 'date') return null;
	if (startDate == null || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new PairRecruitmentError('invalidStartDate');

	const parsed = new Date(`${startDate}T00:00:00.000Z`);
	if (Number.isNaN(parsed.getTime()) || toDateString(parsed) !== startDate) throw new PairRecruitmentError('invalidStartDate');

	const earliest = toDateString(new Date(now.getTime() - 1000 * 60 * 60 * 24));
	const latest = toDateString(new Date(now.getTime() + 1000 * 60 * 60 * 24 * PAIR_RECRUITMENT_START_DATE_MAX_DAYS));
	if (startDate < earliest || startDate > latest) throw new PairRecruitmentError('invalidStartDate');

	return startDate;
}

/**
 * ひとことの前後の空白を除く。空なら null
 */
export function normalizeComment(comment: string | null | undefined): string | null {
	if (comment == null) return null;
	const trimmed = comment.trim();
	if (trimmed.length === 0) return null;
	if (trimmed.length > PAIR_RECRUITMENT_COMMENT_MAX_LENGTH) throw new PairRecruitmentError('commentTooLong');
	return trimmed;
}

export type PairRecruitmentState = {
	status: PairRecruitmentStatus;
	closedReason: PairClosedReason | null;
	closedAt: Date | null;
	expiresAt: Date;
};

/**
 * 募集中か。status が open でも期限を過ぎていれば締め切ったものとして扱う (定期ジョブが閉じるまでの間)
 */
export function isRecruitmentOpen(recruitment: Pick<PairRecruitmentState, 'status' | 'expiresAt'>, now: Date): boolean {
	return recruitment.status === 'open' && recruitment.expiresAt.getTime() > now.getTime();
}

/**
 * 表示する状態。期限を過ぎた open の募集は、期限の日時に expired で締め切ったものとして返す
 */
export function getEffectiveState(recruitment: PairRecruitmentState, now: Date): Pick<PairRecruitmentState, 'status' | 'closedReason' | 'closedAt'> {
	if (recruitment.status === 'open' && !isRecruitmentOpen(recruitment, now)) {
		return { status: 'closed', closedReason: 'expired', closedAt: recruitment.expiresAt };
	}
	return { status: recruitment.status, closedReason: recruitment.closedReason, closedAt: recruitment.closedAt };
}

/**
 * 承認済みの人数 (作成者を含まない) で、人数がそろっているか
 */
export function isTeamFull(teamSize: number, acceptedCount: number): boolean {
	return acceptedCount + 1 >= teamSize;
}

/**
 * 参加希望を送れるか。送れなければ理由を返す
 */
export function judgeApply(params: {
	recruitment: Pick<PairRecruitmentState, 'status' | 'expiresAt'> & { userId: string; teamSize: number; acceptedCount: number };
	applicantId: string;
	/** その募集への既存の参加希望の状態 */
	existingStatus: PairMemberStatus | null;
	/** 参加希望を送る人のその課題の判定 (キャンパスが違う・課題が無いときは null) */
	state: IntraProjectAvailabilityState | null;
	now: Date;
}): PairRecruitmentErrorCode | null {
	const { recruitment, applicantId, existingStatus, state, now } = params;
	if (recruitment.userId === applicantId) return 'cannotApplyOwn';
	if (!isRecruitmentOpen(recruitment, now)) return 'recruitmentClosed';
	// 招待された人 (invited / declined) と取り下げた人は送れる
	if (existingStatus === 'pending' || existingStatus === 'accepted') return 'alreadyApplied';
	if (existingStatus === 'rejected') return 'rejectedBefore';
	if (isTeamFull(recruitment.teamSize, recruitment.acceptedCount)) return 'full';
	if (!canWorkOn(state)) return 'projectNotAvailable';
	return null;
}

/**
 * 招待できるか。できなければ理由を返す
 */
export function judgeInvite(params: {
	recruitment: Pick<PairRecruitmentState, 'status' | 'expiresAt'> & { userId: string; teamSize: number; acceptedCount: number };
	actorId: string;
	inviteeId: string;
	/** その募集への既存の参加希望・招待の状態 */
	existingStatus: PairMemberStatus | null;
	/** 招待される人が招待を受け取るか */
	acceptsInvitations: boolean;
	/** 招待される人の、募集の課題ごとの判定 (キャンパスが違えば空) */
	states: (IntraProjectAvailabilityState | null)[];
	now: Date;
}): PairRecruitmentErrorCode | null {
	const { recruitment, actorId, inviteeId, existingStatus, acceptsInvitations, states, now } = params;
	if (recruitment.userId !== actorId) return 'notOwner';
	if (!isRecruitmentOpen(recruitment, now)) return 'recruitmentClosed';
	if (isTeamFull(recruitment.teamSize, recruitment.acceptedCount)) return 'full';
	if (inviteeId === actorId) return 'cannotInvite';
	if (existingStatus != null && existingStatus !== 'withdrawn') return 'cannotInvite';
	if (!acceptsInvitations) return 'cannotInvite';
	if (!states.some(s => canWorkOn(s))) return 'cannotInvite';
	return null;
}

/**
 * 参加希望を承認できるか。できなければ理由を返す
 */
export function judgeAccept(params: {
	recruitment: Pick<PairRecruitmentState, 'status' | 'expiresAt'> & { userId: string; teamSize: number; acceptedCount: number };
	actorId: string;
	memberStatus: PairMemberStatus | null;
	/** 参加希望を送った人のその課題の判定 */
	applicantState: IntraProjectAvailabilityState | null;
	now: Date;
}): PairRecruitmentErrorCode | null {
	const { recruitment, actorId, memberStatus, applicantState, now } = params;
	if (recruitment.userId !== actorId) return 'notOwner';
	if (!isRecruitmentOpen(recruitment, now)) return 'recruitmentClosed';
	if (memberStatus !== 'pending') return 'noSuchApplication';
	if (isTeamFull(recruitment.teamSize, recruitment.acceptedCount)) return 'full';
	if (!canWorkOn(applicantState)) return 'applicantNotAvailable';
	return null;
}

/**
 * 募集のチャットに入れるか。作成者と、募集中は参加希望中・参加が決まった人、締め切った後は参加が決まった人だけ
 */
export function canJoinPairChat(params: {
	recruitment: Pick<PairRecruitmentState, 'status' | 'expiresAt'> & { userId: string };
	userId: string;
	memberStatus: PairMemberStatus | null;
	now: Date;
}): boolean {
	const { recruitment, userId, memberStatus, now } = params;
	if (recruitment.userId === userId) return true;
	if (memberStatus === 'accepted') return true;
	return memberStatus === 'pending' && isRecruitmentOpen(recruitment, now);
}

/**
 * 他人の参加希望 (pending など承認済み以外) を見てよいか。作成者と本人だけ
 */
export function canSeeMember(params: { viewerId: string | null; ownerId: string; memberUserId: string; memberStatus: PairMemberStatus }): boolean {
	const { viewerId, ownerId, memberUserId, memberStatus } = params;
	if (memberStatus === 'accepted') return true;
	if (viewerId == null) return false;
	if (viewerId === memberUserId) return true;
	// 作成者には取り下げた人を見せない
	return viewerId === ownerId && memberStatus !== 'withdrawn';
}

/**
 * 始める時期を日本語にする (例: 今すぐ / 来週から / 10月25日から)
 */
export function formatStartTiming(timing: PairStartTiming, startDate: string | null, now: Date): string {
	switch (timing) {
		case 'now': return '今すぐ';
		case 'nextWeek': return '来週から';
		case 'nextMonth': return '来月から';
		case 'date': {
			if (startDate == null) return '日付を指定';
			const [y, m, d] = startDate.split('-').map(v => parseInt(v, 10));
			const sameYear = y === now.getUTCFullYear();
			return sameYear ? `${m}月${d}日から` : `${y}年${m}月${d}日から`;
		}
	}
}

/**
 * タイムラインに告知するノートの本文
 */
export function buildAnnouncementText(params: {
	projectName: string;
	teamSize: number;
	startTiming: PairStartTiming;
	startDate: string | null;
	comment: string | null;
	url: string;
	now: Date;
}): string {
	const lines = [
		`【ペア募集】${params.projectName}`,
		`人数: ${params.teamSize} 人 (あと ${params.teamSize - 1} 人)`,
		`始める時期: ${formatStartTiming(params.startTiming, params.startDate, params.now)}`,
	];
	if (params.comment != null) {
		lines.push('', params.comment);
	}
	lines.push('', params.url);
	return lines.join('\n');
}

/**
 * 作成者の 42 intra の課題のページ (https://projects.intra.42.fr/<課題の slug>/<intra のログイン名>) の URL。
 * 作成者がその課題に登録したことが無い (課題の状態の記録に無い) ときは、ページが無いので null
 */
export function getOwnerIntraProjectUrl(projectSlug: string, intraLogin: string | null | undefined, projectStatuses: Record<string, unknown> | null | undefined): string | null {
	if (intraLogin == null || intraLogin === '') return null;
	if (projectStatuses == null || !Object.hasOwn(projectStatuses, projectSlug)) return null;
	return `https://projects.intra.42.fr/${encodeURIComponent(projectSlug)}/${encodeURIComponent(intraLogin)}`;
}
