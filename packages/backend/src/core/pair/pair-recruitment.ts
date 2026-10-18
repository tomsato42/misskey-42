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

/** 始める日として指定できる、今日からの最大の日数 */
export const PAIR_RECRUITMENT_START_DATE_MAX_DAYS = 366;

export const pairStartTimings = ['now', 'nextWeek', 'nextMonth', 'date'] as const;
export type PairStartTiming = typeof pairStartTimings[number];

export const pairRecruitmentStatuses = ['open', 'closed'] as const;
export type PairRecruitmentStatus = typeof pairRecruitmentStatuses[number];

/** full: 人数がそろった、manual: 作成者が締め切った、expired: 期限が過ぎた */
export const pairClosedReasons = ['full', 'manual', 'expired'] as const;
export type PairClosedReason = typeof pairClosedReasons[number];

/** pending: 参加希望、accepted: 承認された、rejected: 見送られた、withdrawn: 本人が取り下げた */
export const pairMemberStatuses = ['pending', 'accepted', 'rejected', 'withdrawn'] as const;
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
	if (existingStatus === 'pending' || existingStatus === 'accepted') return 'alreadyApplied';
	if (existingStatus === 'rejected') return 'rejectedBefore';
	if (isTeamFull(recruitment.teamSize, recruitment.acceptedCount)) return 'full';
	if (!canWorkOn(state)) return 'projectNotAvailable';
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
