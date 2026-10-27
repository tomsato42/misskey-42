/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42 API (https://api.intra.42.fr/apidoc) のレスポンスを扱う純粋関数群。
// DI に依存しないので、ユニットテストから直接呼び出せる。

import type { IntraProjectUser } from './intra-project.js';

/**
 * 42 API の cursus_users の要素 (使う項目だけ)
 */
export type IntraCursusUser = {
	cursus_id: number;
	/** cursus の情報。kind はピシンなら "piscine"。古いテストのデータなどで無い場合がある */
	cursus?: {
		id: number;
		kind?: string | null;
	};
	level: number;
	blackholed_at: string | null;
	begin_at: string | null;
	end_at: string | null;
};

/**
 * 42 API の campus の要素 (使う項目だけ)
 */
export type IntraCampus = {
	id: number;
	name: string;
};

/**
 * 42 API の campus_users の要素 (使う項目だけ)
 */
export type IntraCampusUser = {
	campus_id: number;
	is_primary: boolean;
};

/**
 * 42 API の GET /v2/me, GET /v2/users/:id のレスポンス (使う項目だけ)
 */
export type IntraUser = {
	id: number;
	login: string;
	/** 例: "2023"。ピシンを受けていないユーザーは null */
	pool_year: string | null;
	/** 例: "july"。英語の月名と認識しているが未確認のため、数字の場合も受け付ける */
	pool_month: string | null;
	'staff?': boolean;
	created_at: string;
	cursus_users: IntraCursusUser[];
	campus: IntraCampus[];
	campus_users: IntraCampusUser[];
	/** ユーザーのすべての課題の状態 (ページングされない)。古いテストのデータなどで無い場合がある */
	projects_users?: IntraProjectUser[];
};

export type IntraProfile = {
	intraId: number;
	login: string;
	/** ピシンの年月 (YYMM)。実際の期間の大半が入る月 (findPiscineYearMonth) を優先し、無ければ intra の名称の年月 */
	poolYearMonth: string | null;
	/** intra の名称 (pool_year / pool_month) のピシンの年月 (YYMM)。ユーザー名と入学時期に使う */
	poolNameYearMonth: string | null;
	blackholedAt: Date | null;
	paceDeadlineAt: Date | null;
	/** 対象 cursus の cursus_user の begin_at。対象 cursus に在籍していないか、begin_at が無ければ null */
	cursusBeginAt: Date | null;
	/** 対象 cursus のレベルの整数部分。対象 cursus に在籍していなければ null */
	level: number | null;
	/** 主キャンパス */
	campus: IntraCampus | null;
};

/** Misskey のローカルユーザー名の最大長 (`^\w{1,20}$`) */
const USERNAME_MAX_LENGTH = 20;

/** 42 の C Piscine の cursus_id */
const C_PISCINE_CURSUS_ID = 9;

/** 日本時間の UTC からのずれ。日本に夏時間は無いので固定値でよい */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ピシンの開始からおおよその真ん中までの長さ (4 週間の半分) */
const PISCINE_MIDPOINT_MS = 14 * 24 * 60 * 60 * 1000;

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'] as const;

function parseMonth(month: string): number | null {
	const normalized = month.trim().toLowerCase();
	if (/^\d{1,2}$/.test(normalized)) {
		const n = parseInt(normalized, 10);
		return n >= 1 && n <= 12 ? n : null;
	}
	if (normalized.length < 3) return null;
	// "july" のような完全な月名のほか、"jul" のような 3 文字以上の略記も受け付ける
	const index = MONTH_NAMES.findIndex(name => name.startsWith(normalized));
	return index === -1 ? null : index + 1;
}

function toYearMonth(year: number, month: number): string {
	return `${String(year % 100).padStart(2, '0')}${String(month).padStart(2, '0')}`;
}

function parseDate(value: string | null | undefined): Date | null {
	if (value == null) return null;
	const date = new Date(value);
	return isNaN(date.getTime()) ? null : date;
}

/**
 * pool_year と pool_month からピシンの年月を YYMM 形式で返す。どちらかが解釈できなければ null
 */
export function parsePoolYearMonth(poolYear: string | null | undefined, poolMonth: string | null | undefined): string | null {
	if (poolYear == null || poolMonth == null) return null;

	const yearText = String(poolYear).trim();
	if (!/^\d{4}$/.test(yearText)) return null;

	const month = parseMonth(String(poolMonth));
	if (month == null) return null;

	return toYearMonth(parseInt(yearText, 10), month);
}

/**
 * ピシンの期間の大半が入る年月 (YYMM、日本時間)。
 * intra の名称 (pool_month) は実際の時期とずれることがあるので、ピシンの cursus_user の begin_at から
 * PISCINE_MIDPOINT_MS 後 (4 週間のピシンのおおよそ真ん中) の月を求める。8 月の終わりに始まる 9 月のピシンは 9 月、
 * 8 月の初めに始まったのに 9 月と名付けられたピシンは 8 月になる。
 * 名称の年月の前後 1 か月以内に当たるものだけを使い (Discovery Piscine などほかのピシンを拾わないため)、
 * 複数あれば名称の年月に近いもの、同じなら早く始まったものを選ぶ。名称の年月が無いか、当てはまるものが無ければ null
 */
export function findPiscineYearMonth(cursusUsers: IntraCursusUser[], poolNameYearMonth: string | null): string | null {
	if (poolNameYearMonth == null) return null;
	const nameIndex = toMonthIndex(poolNameYearMonth);

	let best: { yearMonth: string; distance: number; time: number } | null = null;
	for (const cu of cursusUsers) {
		if (cu.cursus_id !== C_PISCINE_CURSUS_ID && cu.cursus?.kind !== 'piscine') continue;
		const beginAt = parseDate(cu.begin_at);
		if (beginAt == null) continue;

		// UTC の値として読むと日本時間の年月になるよう、9 時間ずらす
		const jst = new Date(beginAt.getTime() + PISCINE_MIDPOINT_MS + JST_OFFSET_MS);
		const yearMonth = toYearMonth(jst.getUTCFullYear(), jst.getUTCMonth() + 1);
		const distance = Math.abs(toMonthIndex(yearMonth) - nameIndex);
		if (distance > 1) continue;

		const time = beginAt.getTime();
		if (best == null || distance < best.distance || (distance === best.distance && time < best.time)) {
			best = { yearMonth, distance, time };
		}
	}
	return best?.yearMonth ?? null;
}

/** YYMM を月の通し番号にする (前後の月との差を求めるため) */
function toMonthIndex(yearMonth: string): number {
	return parseInt(yearMonth.slice(0, 2), 10) * 12 + parseInt(yearMonth.slice(2), 10) - 1;
}

/**
 * Misskey のユーザー名 `{login}_{YYMM}` を組み立てる。
 * ピシンの年月が無い場合は intra アカウントの作成年月 (UTC) で代用する。
 * login の `\w` 以外の文字は `_` に置き換え、全体が 20 文字以内に収まるよう login 部分を切り詰める。
 */
export function buildIntraUsername(login: string, poolYearMonth: string | null, createdAt: string | Date): string {
	let suffix = poolYearMonth;
	if (suffix == null) {
		const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
		if (isNaN(created.getTime())) {
			throw new Error(`Invalid intra created_at: ${String(createdAt)}`);
		}
		suffix = toYearMonth(created.getUTCFullYear(), created.getUTCMonth() + 1);
	}

	const sanitizedLogin = login.replace(/\W/g, '_');
	const maxLoginLength = USERNAME_MAX_LENGTH - suffix.length - 1;
	return `${sanitizedLogin.slice(0, maxLoginLength)}_${suffix}`;
}

/**
 * 対象 cursus の cursus_user を返す。複数ある場合は begin_at が最も新しいもの
 */
function findCursusUser(user: IntraUser, cursusId: number): IntraCursusUser | null {
	const candidates = (user.cursus_users ?? []).filter(cu => cu.cursus_id === cursusId);
	if (candidates.length === 0) return null;
	return candidates.reduce((latest, cu) => {
		const latestBeginAt = parseDate(latest.begin_at)?.getTime() ?? -Infinity;
		const beginAt = parseDate(cu.begin_at)?.getTime() ?? -Infinity;
		return beginAt > latestBeginAt ? cu : latest;
	});
}

/**
 * 登録を許可するユーザーか。対象 cursus の cursus_user があるか、スタッフであれば許可する
 */
export function isEligible(user: IntraUser, cursusId: number): boolean {
	if (user['staff?'] === true) return true;
	return findCursusUser(user, cursusId) != null;
}

/**
 * 主キャンパスを返す。campus_users の is_primary を優先し、無ければ campus の先頭を使う
 */
function findPrimaryCampus(user: IntraUser): IntraCampus | null {
	const campuses = user.campus ?? [];
	const primary = (user.campus_users ?? []).find(cu => cu.is_primary);
	const campus = (primary ? campuses.find(c => c.id === primary.campus_id) : undefined) ?? campuses[0];
	return campus ? { id: campus.id, name: campus.name } : null;
}

/**
 * 42 API のユーザー情報から、Misskey 側で保存・利用する情報を取り出す
 */
export function extractIntraProfile(user: IntraUser, cursusId: number): IntraProfile {
	const cursusUser = findCursusUser(user, cursusId);
	const poolNameYearMonth = parsePoolYearMonth(user.pool_year, user.pool_month);

	return {
		intraId: user.id,
		login: user.login,
		poolYearMonth: findPiscineYearMonth(user.cursus_users ?? [], poolNameYearMonth) ?? poolNameYearMonth,
		poolNameYearMonth,
		blackholedAt: parseDate(cursusUser?.blackholed_at),
		// ペース期日が 42 API のどの項目に当たるかは未確認のため、現時点では常に null を返す。
		// 項目が判明したら、推測ではなく実際のレスポンスを確認してから実装すること
		paceDeadlineAt: null,
		cursusBeginAt: parseDate(cursusUser?.begin_at),
		level: cursusUser != null && Number.isFinite(cursusUser.level) ? Math.floor(cursusUser.level) : null,
		campus: findPrimaryCampus(user),
	};
}
