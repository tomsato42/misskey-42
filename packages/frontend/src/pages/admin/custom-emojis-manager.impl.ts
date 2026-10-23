/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type RequestLogItem = {
	failed: boolean;
	url: string;
	name: string;
	error?: string;
};

export const gridSortOrderKeys = [
	'name',
	'category',
	'aliases',
	'type',
	'license',
	'host',
	'uri',
	'publicUrl',
	'isSensitive',
	'localOnly',
	'updatedAt',
] as const satisfies string[];

export type GridSortOrderKey = typeof gridSortOrderKeys[number];

export function emptyStrToUndefined(value: string | null) {
	return value ? value : undefined;
}

export function emptyStrToNull(value: string) {
	return value === '' ? null : value;
}

export function emptyStrToEmptyArray(value: string) {
	return value === '' ? [] : value.split(' ').map(it => it.trim());
}

export function roleIdsParser(text: string): { id: string, name: string }[] {
	// idとnameのペア配列をJSONで受け取る。それ以外の形式は許容しない
	try {
		const obj = JSON.parse(text);
		if (!Array.isArray(obj)) {
			return [];
		}
		if (!obj.every(it => typeof it === 'object' && 'id' in it && 'name' in it)) {
			return [];
		}

		return obj.map(it => ({ id: it.id, name: it.name }));
	} catch (ex) {
		console.warn(ex);
		return [];
	}
}

export type PastedEmoji = {
	url: string;
	name: string;
	category: string | null;
	aliases: string[];
	license: string | null;
	isSensitive: boolean;
	localOnly: boolean;
};

const EMOJI_NAME_PATTERN = /^[a-zA-Z0-9_]+$/;
const HTTP_URL_PATTERN = /^https?:\/\/\S+$/;

/**
 * 画像の URL のファイル名から絵文字の名前を作る (登録タブでファイルを選んだときと同じく、拡張子を消して - と空白を _ にする)
 */
export function emojiNameFromUrl(url: string): string {
	let fileName: string;
	try {
		fileName = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
	} catch {
		return '';
	}
	return fileName.replace(/(\.[a-zA-Z0-9]+)+$/, '').replaceAll('-', '_').replaceAll(' ', '_');
}

/**
 * 「カスタム絵文字(ベータ)」の登録済みの一覧でコピーした行 (タブ区切り) か、画像の URL (1 行に 1 つ) を読み取る。
 * 列は一覧と同じ url, name, category, aliases, license, sensitive, localOnly, role, type, updatedAt, publicUrl, originalUrl の順で、
 * url から始まっていれば途中の列までで良い。ロールの ID はサーバーごとに違うので引き継がない。
 * 1 列目が URL でない行・名前に使えない文字がある行・同じ名前の 2 つ目以降の行は飛ばす。
 */
export function parsePastedEmojis(text: string): PastedEmoji[] {
	const emojis: PastedEmoji[] = [];
	const names = new Set<string>();

	for (const line of text.replace(/\r/g, '').split('\n')) {
		const cells = line.split('\t').map(it => it.trim());
		const url = cells[0];
		if (!HTTP_URL_PATTERN.test(url)) continue;

		const originalUrl = cells[11];
		const name = cells[1] || emojiNameFromUrl(url);
		if (!EMOJI_NAME_PATTERN.test(name) || names.has(name)) continue;
		names.add(name);

		emojis.push({
			url: originalUrl && HTTP_URL_PATTERN.test(originalUrl) ? originalUrl : url,
			name,
			category: cells[2] || null,
			aliases: (cells[3] ?? '').split(' ').filter(it => it !== ''),
			license: cells[4] || null,
			isSensitive: cells[5] === 'true',
			localOnly: cells[6] === 'true',
		});
	}

	return emojis;
}

/**
 * items を concurrency 件ずつ並行して処理する。結果は items と同じ順に並ぶ
 */
export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	async function worker() {
		while (next < items.length) {
			const index = next++;
			results[index] = await fn(items[index]);
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
	return results;
}
