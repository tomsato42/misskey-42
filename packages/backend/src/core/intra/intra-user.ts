/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42 API (https://api.intra.42.fr/apidoc) のレスポンスを扱う純粋関数群。
// DI に依存しないので、ユニットテストから直接呼び出せる。

/**
 * 42 API の cursus_users の要素 (使う項目だけ)
 */
export type IntraCursusUser = {
	cursus_id: number;
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
};

export type IntraProfile = {
	intraId: number;
	login: string;
	/** ピシンの年月 (YYMM) */
	poolYearMonth: string | null;
	blackholedAt: Date | null;
	paceDeadlineAt: Date | null;
	/** 対象 cursus のレベルの整数部分。対象 cursus に在籍していなければ null */
	level: number | null;
	/** 主キャンパス */
	campus: IntraCampus | null;
};

/** Misskey のローカルユーザー名の最大長 (`^\w{1,20}$`) */
const USERNAME_MAX_LENGTH = 20;

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

	return {
		intraId: user.id,
		login: user.login,
		poolYearMonth: parsePoolYearMonth(user.pool_year, user.pool_month),
		blackholedAt: parseDate(cursusUser?.blackholed_at),
		// ペース期日が 42 API のどの項目に当たるかは未確認のため、現時点では常に null を返す。
		// 項目が判明したら、推測ではなく実際のレスポンスを確認してから実装すること
		paceDeadlineAt: null,
		level: cursusUser != null && Number.isFinite(cursusUser.level) ? Math.floor(cursusUser.level) : null,
		campus: findPrimaryCampus(user),
	};
}
