/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// オブジェクトストレージ (R2) を設定する前に VPS に保存されたドライブのファイル (drive_file."storedInternal" が true のもの) を、
// オブジェクトストレージに移すスクリプト。deploy/migrate-files-to-r2.sh が本番のイメージのコンテナの中で実行する。
//
// コントロールパネルでオブジェクトストレージを有効にした後に実行すると、ファイルを 1 件ずつアップロードし、
// 最初からオブジェクトストレージにアップロードされたときと同じ形に drive_file の行を書き換える。
// キー・Content-Type・Content-Disposition は packages/backend/src/core/DriveService.ts の save() と upload() に合わせている。
// ファイルの URL をコピーして持っている列 (アバター・バナー・絵文字・ロールのアイコン・サーバーのアイコンなど) も、
// 同じトランザクションで新しい URL に書き換える。
//
// モード:
//   migrate                       移行の計画を表示する。DB・オブジェクトストレージ・files/ には何も書き込まない
//   migrate --apply [--limit N]   移行する。files/ のファイルは消さない (表示を確かめてから cleanup で消す)
//   cleanup                       どの drive_file の行からも参照されていない files/ のファイルを数える
//   cleanup --apply               それを消す
//
// pg・@aws-sdk/client-s3 などのパッケージは、コンテナの packages/backend/node_modules から読む。
// テストがパッケージなしで純粋な関数だけを読み込めるよう、パッケージは使う処理の中で import する。

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const CONFIG_PATH = '/misskey/.config/default.yml';
export const FILES_DIR = '/misskey/files';

// DriveService の upload() と同じ値
const CACHE_CONTROL = 'max-age=31536000, immutable';
// これより大きいファイルはメモリに読み込まず、ストリームで送る (VPS のメモリは 2GB で、Misskey などと共有している)
const BUFFER_LIMIT = 64 * 1024 * 1024;
// サムネイルの形式を調べるために読む、ファイルの先頭の長さ
const HEAD_BYTES = 32;
// cleanup では、この時間より後に書き込まれたファイルは消さない。
// Misskey はファイルを書いてから drive_file の行を作るので、その間に一覧を取ると、使われるファイルを消してしまうため
const CLEANUP_MIN_AGE_MS = 60 * 60 * 1000;
// CustomEmojiService の localEmojisCache (RedisSingleCache) が使う Redis のキー (keyPrefix の後ろ)
export const EMOJI_CACHE_KEY = 'singlecache:localEmojis';

// packages/backend/src/const.ts の FILE_TYPE_BROWSERSAFE と同じ
export const FILE_TYPE_BROWSERSAFE = [
	// Images
	'image/png',
	'image/gif',
	'image/jpeg',
	'image/webp',
	'image/avif',
	'image/apng',
	'image/bmp',
	'image/tiff',
	'image/x-icon',

	// OggS
	'audio/opus',
	'video/ogg',
	'audio/ogg',
	'application/ogg',

	// ISO/IEC base media file format
	'video/quicktime',
	'video/mp4',
	'audio/mp4',
	'video/x-m4v',
	'audio/x-m4a',
	'video/3gpp',
	'video/3gpp2',

	'video/mpeg',
	'audio/mpeg',

	'video/webm',
	'audio/webm',

	'audio/aac',

	'audio/flac',
	'audio/wav',
	'audio/x-flac',
	'audio/vnd.wave',
];

// サーバーの画像の URL を持つ meta の列。ログイン画面などに出るので、移行後に Worker の PUBLIC_KEYS の候補として表示する
export const META_IMAGE_COLUMNS = [
	'iconUrl',
	'app192IconUrl',
	'app512IconUrl',
	'bannerUrl',
	'backgroundImageUrl',
	'logoImageUrl',
	'mascotImageUrl',
	'serverErrorImageUrl',
	'notFoundImageUrl',
	'infoImageUrl',
];

// ドライブのファイルの URL をコピーして持っている列。[テーブル, 列]
export const URL_COLUMNS = [
	['user', 'avatarUrl'],
	['user', 'bannerUrl'],
	['emoji', 'originalUrl'],
	['emoji', 'publicUrl'],
	['role', 'iconUrl'],
	['avatar_decoration', 'url'],
	['ad', 'imageUrl'],
	['announcement', 'imageUrl'],
	...META_IMAGE_COLUMNS.map(column => ['meta', column]),
];

const META_STORAGE_COLUMNS = [
	'useObjectStorage',
	'objectStorageBucket',
	'objectStoragePrefix',
	'objectStorageBaseUrl',
	'objectStorageEndpoint',
	'objectStorageRegion',
	'objectStoragePort',
	'objectStorageAccessKey',
	'objectStorageSecretKey',
	'objectStorageUseSSL',
	'objectStorageUseProxy',
	'objectStorageSetPublicRead',
	'objectStorageS3ForcePathStyle',
];

const ROLE_LABELS = {
	original: 'オリジナル',
	webpublic: 'webpublic',
	thumbnail: 'サムネイル',
};

const USAGE = `使い方: migrate-files-to-r2.sh [migrate|cleanup] [--apply] [--limit N]

  migrate                       移行の計画を表示します (何も書き込みません)
  migrate --limit N             最初の N 件だけ計画を表示します
  migrate --apply               内部ストレージのファイルをすべてオブジェクトストレージに移します
  migrate --apply --limit N     最初の N 件だけ移します (試すとき)
  cleanup                       どこからも参照されていない files/ のファイルを数えます
  cleanup --apply               それを消します
  --help                        この説明を表示します

先にコントロールパネルでオブジェクトストレージを設定してください。
migrate --apply は files/ のファイルを消しません。表示を確かめてから cleanup --apply で消してください。`;

export class UsageError extends Error {}

/** 行が他の処理で変更・削除されていて、移行しなかった */
class RowChangedError extends Error {}

/** COMMIT がエラーになり、コミットされたかどうか分からない */
class CommitUnknownError extends Error {}

//#region 純粋な関数

/**
 * コマンドラインの引数を読む。
 * @param {string[]} argv
 */
export function parseArgs(argv) {
	const opts = { mode: 'migrate', apply: false, limit: null, help: false };
	let modeGiven = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--help' || arg === '-h') {
			opts.help = true;
		} else if (arg === '--apply') {
			opts.apply = true;
		} else if (arg === '--limit' || arg.startsWith('--limit=')) {
			const value = arg === '--limit' ? argv[++i] : arg.slice('--limit='.length);
			if (value == null || !/^[1-9][0-9]*$/.test(value)) {
				throw new UsageError('--limit には 1 以上の整数を指定してください');
			}
			opts.limit = Number(value);
		} else if (!modeGiven && (arg === 'migrate' || arg === 'cleanup')) {
			opts.mode = arg;
			modeGiven = true;
		} else {
			throw new UsageError(`分からない引数です: ${arg}`);
		}
	}

	if (opts.limit != null && opts.mode !== 'migrate') {
		throw new UsageError('--limit は migrate のときだけ使えます');
	}
	return opts;
}

/**
 * Redis のキーの接頭辞。packages/backend/src/config.ts の convertRedisOptions と同じく、prefix が無ければ url のホストを使う
 */
export function redisKeyPrefix(raw) {
	return `${raw.redis?.prefix ?? new URL(raw.url).host}:`;
}

/**
 * default.yml の内容から、このスクリプトで使う値を取り出す。
 * DB と Redis の接続の設定は packages/backend/src/postgres.ts と config.ts に合わせる
 */
export function resolveConfig(raw) {
	if (raw == null || typeof raw !== 'object') throw new Error('default.yml の内容が空か、形式が正しくありません');

	let url;
	try {
		url = new URL(raw.url);
	} catch {
		throw new Error(`default.yml の url (${raw.url}) は正しい URL ではありません`);
	}
	if (raw.db == null) throw new Error('default.yml に db がありません');
	if (raw.redis == null) throw new Error('default.yml に redis がありません');

	return {
		// Misskey の config.url と同じく origin にする (InternalStorageService はこれに /files/<キー> を付けて URL を作る)
		url: url.origin,
		proxy: raw.proxy ?? null,
		proxyBypassHosts: raw.proxyBypassHosts ?? [],
		db: {
			host: raw.db.host,
			port: raw.db.port,
			database: raw.db.db,
			user: raw.db.user,
			password: raw.db.pass,
			...(raw.db.extra ?? {}),
		},
		redis: {
			...raw.redis,
			password: raw.redis.pass,
			family: raw.redis.family ?? 0,
			keyPrefix: redisKeyPrefix(raw),
			db: raw.redis.db ?? 0,
		},
	};
}

/**
 * オリジナルのキーに付ける拡張子 (DriveService の save())。
 * ファイル名の拡張子を使い、無ければ一部の画像だけ Content-Type から決める。
 * ブラウザで直接表示させない種類のファイルには付けない
 */
export function originalExt(name, type) {
	let [ext] = (name.match(/\.([a-zA-Z0-9_-]+)$/) ?? ['']);

	if (ext === '') {
		if (type === 'image/jpeg') ext = '.jpg';
		if (type === 'image/png') ext = '.png';
		if (type === 'image/webp') ext = '.webp';
		if (type === 'image/avif') ext = '.avif';
		if (type === 'image/apng') ext = '.apng';
		if (type === 'image/vnd.mozilla.apng') ext = '.apng';
	}

	if (!FILE_TYPE_BROWSERSAFE.includes(type)) {
		ext = '';
	}
	return ext;
}

/** アップロードするときの Content-Type (DriveService の upload()) */
export function uploadContentType(type) {
	if (type === 'image/apng') type = 'image/png';
	if (!FILE_TYPE_BROWSERSAFE.includes(type)) type = 'application/octet-stream';
	return type;
}

const targetExtsToSkip = new Set(['.gz', '.tar', '.tgz', '.bz2', '.xz', '.zip', '.7z']);
const extRegExp = /\.[0-9a-zA-Z]+$/i;

/** packages/backend/src/misc/correct-filename.ts と同じ */
export function correctFilename(filename, ext) {
	const dotExt = ext ? ext[0] === '.' ? ext : `.${ext}` : '.unknown';

	const match = extRegExp.exec(filename);
	if (!match || !match[0]) {
		return `${filename}${dotExt}`;
	}

	const filenameExt = match[0].toLowerCase();
	if (
		ext === null ||
		filenameExt === dotExt ||
		dotExt === '.jpg' && filenameExt === '.jpeg' ||
		dotExt === '.tif' && filenameExt === '.tiff' ||
		dotExt === '.exe' && filenameExt === '.dll' ||
		targetExtsToSkip.has(dotExt)
	) {
		return filename;
	}

	return `${filename}${dotExt}`;
}

/** packages/backend/src/misc/content-disposition.ts の fallback と同じ */
export function contentDispositionFallback(filename) {
	return filename.replace(/[^\w.-]/g, '_');
}

/**
 * packages/backend/src/misc/content-disposition.ts と同じ。
 * create は content-disposition パッケージの create (テストでは差し替える)
 */
export function contentDisposition(create, type, filename) {
	return create(filename, { type, fallback: contentDispositionFallback(filename) });
}

const IMAGE_EXTS = {
	'image/webp': 'webp',
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/avif': 'avif',
	'image/gif': 'gif',
};

/**
 * サムネイルなどの画像の形式を、ファイルの先頭のバイトから調べる。
 * DB にサムネイルの形式は残っていない。今の Misskey は webp で作るので、分からなければ webp とする
 */
export function sniffImageType(head) {
	const ascii = (start, end) => head.length >= end ? head.subarray(start, end).toString('latin1') : '';

	if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
	if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
	if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
	if (ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return 'image/avif';
	if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
	return 'image/webp';
}

/**
 * webpublic・サムネイルの Content-Type と拡張子。
 * webpublic は DB の webpublicType を使い (DriveService が保存している)、無いか知らない形式なら先頭のバイトで調べる
 */
export function altFormat(declaredType, head) {
	const type = declaredType != null && Object.hasOwn(IMAGE_EXTS, declaredType) ? declaredType : sniffImageType(head);
	return { type, ext: IMAGE_EXTS[type] };
}

/** オブジェクトの URL の前の部分 (DriveService の save()) */
export function objectStorageBaseUrl(meta) {
	return meta.objectStorageBaseUrl
		?? `${meta.objectStorageUseSSL ? 'https' : 'http'}://${meta.objectStorageEndpoint}${meta.objectStoragePort ? `:${meta.objectStoragePort}` : ''}/${meta.objectStorageBucket}`;
}

/** オブジェクトのキーの接頭辞 (DriveService の save()) */
export function objectKeyPrefix(meta) {
	return meta.objectStoragePrefix ? `${meta.objectStoragePrefix}/` : '';
}

/**
 * このスクリプトで移行できる設定かを確かめる。問題があればその説明を、無ければ null を返す
 */
export function checkStorageMeta(meta, config) {
	if (!meta.useObjectStorage) {
		return 'コントロールパネルの「オブジェクトストレージを使用」がオフです。先にオブジェクトストレージを設定してください';
	}
	if (!meta.objectStorageBucket) {
		return 'オブジェクトストレージの Bucket が空です';
	}

	const baseUrl = objectStorageBaseUrl(meta);
	if (!/^https?:\/\/[^/]/.test(baseUrl)) {
		return `ファイルの URL が http(s):// で始まりません (${baseUrl})。Base URL か Endpoint を確かめてください`;
	}

	// S3Service は、default.yml に proxy があり「Proxyを利用する」がオンなら、proxyBypassHosts にあるホスト以外はプロキシを通す。
	// このスクリプトはプロキシを通せないので、そのまま進めると Misskey と違う経路で接続することになる
	if (config.proxy && meta.objectStorageUseProxy) {
		let endpointHost;
		try {
			endpointHost = meta.objectStorageEndpoint
				? new URL(`${meta.objectStorageUseSSL ? 'https' : 'http'}://${meta.objectStorageEndpoint}`).hostname
				: 'example.net';
		} catch {
			return `Endpoint (${meta.objectStorageEndpoint}) が正しくありません`;
		}
		if (!config.proxyBypassHosts.includes(endpointHost)) {
			return 'default.yml に proxy があり、「Proxyを利用する」がオンです。このスクリプトはプロキシ経由の接続に対応していないので、「Proxyを利用する」をオフにしてから実行してください';
		}
	}
	return null;
}

/** S3 クライアントの設定 (packages/backend/src/core/S3Service.ts の getS3Client と同じく、ポートは使わない) */
export function s3ClientOptions(meta) {
	const scheme = meta.objectStorageUseSSL ? 'https' : 'http';
	return {
		endpoint: meta.objectStorageEndpoint ? `${scheme}://${meta.objectStorageEndpoint}` : undefined,
		credentials: (meta.objectStorageAccessKey !== null && meta.objectStorageSecretKey !== null) ? {
			accessKeyId: meta.objectStorageAccessKey,
			secretAccessKey: meta.objectStorageSecretKey,
		} : undefined,
		// 空文字列も undefined にするため ?? は使わない
		region: meta.objectStorageRegion ? meta.objectStorageRegion : undefined,
		tls: meta.objectStorageUseSSL,
		forcePathStyle: meta.objectStorageEndpoint ? meta.objectStorageS3ForcePathStyle : false,
		requestChecksumCalculation: 'WHEN_REQUIRED',
		responseChecksumValidation: 'WHEN_REQUIRED',
	};
}

/** 内部ストレージのキーとして読んでよいか (packages/backend/src/server/file/FileServerFileResolver.ts と同じ条件) */
export function isValidInternalKey(key) {
	return typeof key === 'string' && /^[a-zA-Z0-9._-]+$/.test(key) && key !== '.' && key !== '..';
}

/**
 * 1 件の drive_file の移行の計画を作る。
 * @param row drive_file の行
 * @param ctx.local 内部ストレージのキー → { size, head } の Map (無いファイルは入れない。読めなかったものは { error })
 * @param ctx.uuid キーに使う UUID を作る関数 (テストでは決まった値を返すものに差し替える)
 */
export function buildFilePlan(row, { baseUrl, prefix, local, uuid = randomUUID, filesDir = FILES_DIR }) {
	const targets = [{ role: 'original', key: row.accessKey, url: row.url }];
	// 内部ストレージの行は thumbnailAccessKey・webpublicAccessKey が常に入っているので、
	// あるかどうかは URL で判断する (DriveService の deleteFile と同じ)
	if (row.webpublicUrl != null) targets.push({ role: 'webpublic', key: row.webpublicAccessKey, url: row.webpublicUrl });
	if (row.thumbnailUrl != null) targets.push({ role: 'thumbnail', key: row.thumbnailAccessKey, url: row.thumbnailUrl });

	const objects = [];
	const problems = [];

	for (const { role, key, url } of targets) {
		if (!isValidInternalKey(key)) {
			problems.push({ role, key, kind: 'invalid-key' });
			continue;
		}
		// 古い URL を新しい URL に置き換えるので、InternalStorageService が作る形 (.../files/<キー>) でない URL は扱わない
		if (typeof url !== 'string' || !url.endsWith(`/files/${key}`)) {
			problems.push({ role, key, kind: 'unexpected-url', detail: url });
			continue;
		}
		const info = local.get(key);
		if (info == null) {
			problems.push({ role, key, kind: 'missing' });
			continue;
		}
		if (info.error != null) {
			problems.push({ role, key, kind: 'unreadable', detail: info.error });
			continue;
		}

		let newKey;
		let contentType;
		let filename;
		if (role === 'original') {
			newKey = `${prefix}${uuid()}${originalExt(row.name, row.type)}`;
			contentType = uploadContentType(row.type);
			// オリジナルはファイル名の拡張子を直さない (upload() に ext として null を渡している)
			filename = row.name || null;
		} else {
			const format = altFormat(role === 'webpublic' ? row.webpublicType : null, info.head);
			newKey = `${prefix}${role}-${uuid()}.${format.ext}`;
			contentType = uploadContentType(format.type);
			const name = role === 'webpublic' ? row.name : `${row.name}.thumbnail`;
			filename = name ? correctFilename(name, format.ext) : null;
		}

		objects.push({
			role,
			oldKey: key,
			oldUrl: url,
			localPath: `${filesDir}/${key}`,
			size: info.size,
			newKey,
			newUrl: `${baseUrl}/${newKey}`,
			contentType,
			// null のときは Content-Disposition を付けない (upload() はファイル名が空なら付けない)
			contentDispositionFilename: filename,
		});
	}

	return { id: row.id, name: row.name, type: row.type, objects, problems };
}

/** 移行後の drive_file の値 (DriveService の save() のオブジェクトストレージの分岐と同じ形) */
export function buildDriveFileUpdate(plan) {
	const byRole = Object.fromEntries(plan.objects.map(object => [object.role, object]));
	return {
		url: byRole.original.newUrl,
		accessKey: byRole.original.newKey,
		webpublicUrl: byRole.webpublic?.newUrl ?? null,
		webpublicAccessKey: byRole.webpublic?.newKey ?? null,
		thumbnailUrl: byRole.thumbnail?.newUrl ?? null,
		thumbnailAccessKey: byRole.thumbnail?.newKey ?? null,
	};
}

/**
 * 古い URL と新しい URL の組。
 * アバターの URL は、メディアプロキシの URL のクエリに元の URL を埋め込んでいる
 * (DriveFileEntityService の getProxiedUrl。packages/backend/src/misc/prelude/url.ts の query() が encodeURIComponent する) ので、
 * エンコードしたものも置き換える
 */
export function buildUrlPairs(plan) {
	return plan.objects.map(object => ({
		key: object.oldKey,
		from: object.oldUrl,
		to: object.newUrl,
		fromEncoded: encodeURIComponent(object.oldUrl),
		toEncoded: encodeURIComponent(object.newUrl),
	}));
}

/** buildRewriteQuery の SQL と同じ置き換えを JavaScript で行う (PostgreSQL の replace はすべての出現を置き換える) */
export function replaceUrls(value, pairs) {
	let result = value;
	for (const pair of pairs) {
		result = result.replaceAll(pair.from, pair.to).replaceAll(pair.fromEncoded, pair.toEncoded);
	}
	return result;
}

export function quoteIdent(name) {
	return `"${name.replaceAll('"', '""')}"`;
}

/**
 * 1 つの列の古い URL を新しい URL に書き換える UPDATE 文。
 * どの列にもインデックスは無いので古いキーを含む行に絞り、実際に値が変わる行だけを数える
 */
export function buildRewriteQuery(table, column, pairs) {
	const col = quoteIdent(column);
	const values = [];
	const param = (value) => {
		values.push(value);
		return `$${values.length}::text`;
	};

	let expr = col;
	const conditions = [];
	for (const pair of pairs) {
		expr = `replace(replace(${expr}, ${param(pair.from)}, ${param(pair.to)}), ${param(pair.fromEncoded)}, ${param(pair.toEncoded)})`;
		conditions.push(`strpos(${col}, ${param(pair.key)}) > 0`);
	}

	return {
		text: `UPDATE ${quoteIdent(table)} SET ${col} = ${expr} WHERE (${conditions.join(' OR ')}) AND ${expr} <> ${col}`,
		values,
	};
}

/** meta の画像の URL のうち、オブジェクトストレージにあるもののキー (Worker の PUBLIC_KEYS に入れる値) */
export function publicKeysFromMeta(meta, baseUrl) {
	const prefix = `${baseUrl}/`;
	const keys = [];
	for (const column of META_IMAGE_COLUMNS) {
		const value = meta[column];
		if (typeof value !== 'string' || !value.startsWith(prefix)) continue;
		const key = value.slice(prefix.length).split(/[?#]/)[0];
		if (key !== '' && !keys.includes(key)) keys.push(key);
	}
	return keys;
}

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const INTERNAL_KEY_REGEXP = new RegExp(`^(?:(?:thumbnail|webpublic)-)?${UUID_PATTERN}$`);

/** 内部ストレージのキーの形か (DriveService の save() の randomUUID()・'thumbnail-' + randomUUID()・'webpublic-' + randomUUID()) */
export function isInternalKeyName(name) {
	return INTERNAL_KEY_REGEXP.test(name);
}

/**
 * cleanup で消すファイルを選ぶ。
 * @param entries files/ の中身 ({ name, isFile, size, mtimeMs })
 * @param referencedKeys "storedInternal" が true の drive_file の行が持つキーの Set
 */
export function selectCleanupCandidates(entries, referencedKeys, { now, minAgeMs = CLEANUP_MIN_AGE_MS }) {
	const result = { candidates: [], referenced: [], recent: [], unknown: [] };
	for (const entry of entries) {
		if (!entry.isFile || !isInternalKeyName(entry.name)) {
			result.unknown.push(entry);
		} else if (referencedKeys.has(entry.name)) {
			result.referenced.push(entry);
		} else if (now - entry.mtimeMs < minAgeMs) {
			result.recent.push(entry);
		} else {
			result.candidates.push(entry);
		}
	}
	return result;
}

export function formatBytes(bytes) {
	const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return unit === 0 ? `${bytes} B` : `${value.toFixed(1)} ${units[unit]}`;
}

//#endregion

//#region DB・ファイル・オブジェクトストレージ

async function loadConfig(path) {
	const { load } = await import('js-yaml');
	return resolveConfig(load(await fsp.readFile(path, 'utf8')));
}

async function fetchMeta(db) {
	const columns = [...META_STORAGE_COLUMNS, ...META_IMAGE_COLUMNS].map(quoteIdent).join(', ');
	// MetaService と同じく、行が複数あれば新しい ID のものを使う
	const res = await db.query(`SELECT "id", ${columns} FROM "meta" ORDER BY "id" DESC LIMIT 1`);
	if (res.rows.length === 0) throw new Error('meta の行がありません');
	return res.rows[0];
}

const INTERNAL_FILE_COLUMNS = [
	'id', 'name', 'type', 'size', 'url', 'thumbnailUrl', 'webpublicUrl',
	'accessKey', 'thumbnailAccessKey', 'webpublicAccessKey', 'webpublicType',
].map(quoteIdent).join(', ');

async function countInternalFiles(db) {
	const res = await db.query('SELECT count(*)::int AS "count" FROM "drive_file" WHERE "storedInternal" = true AND "isLink" = false');
	return res.rows[0].count;
}

async function fetchInternalFiles(db, limit) {
	const res = await db.query(
		`SELECT ${INTERNAL_FILE_COLUMNS} FROM "drive_file" WHERE "storedInternal" = true AND "isLink" = false ORDER BY "id"${limit != null ? ' LIMIT $1' : ''}`,
		limit != null ? [limit] : [],
	);
	return res.rows;
}

async function fetchInternalFile(db, id) {
	const res = await db.query(
		`SELECT ${INTERNAL_FILE_COLUMNS} FROM "drive_file" WHERE "id" = $1 AND "storedInternal" = true AND "isLink" = false`,
		[id],
	);
	return res.rows[0] ?? null;
}

async function inspectLocalFile(path) {
	let handle;
	try {
		const stat = await fsp.lstat(path);
		// シンボリックリンクなどは Misskey が作るものではないので、無いものとして扱う
		if (!stat.isFile()) return null;
		handle = await fsp.open(path, 'r');
		const head = Buffer.alloc(HEAD_BYTES);
		const { bytesRead } = await handle.read(head, 0, HEAD_BYTES, 0);
		return { size: stat.size, head: head.subarray(0, bytesRead) };
	} catch (err) {
		if (err.code === 'ENOENT') return null;
		return { error: err.message };
	} finally {
		await handle?.close();
	}
}

/** 行が持つキーのうち、正しい形のものについて files/ のファイルを調べる */
async function inspectLocalFiles(row, filesDir = FILES_DIR) {
	const keys = [row.accessKey];
	if (row.webpublicUrl != null) keys.push(row.webpublicAccessKey);
	if (row.thumbnailUrl != null) keys.push(row.thumbnailAccessKey);

	const local = new Map();
	for (const key of keys) {
		if (!isValidInternalKey(key)) continue;
		const info = await inspectLocalFile(`${filesDir}/${key}`);
		if (info != null) local.set(key, info);
	}
	return local;
}

async function createS3(meta) {
	const mod = await import('@aws-sdk/client-s3');
	return {
		client: new mod.S3Client(s3ClientOptions(meta)),
		ListObjectsV2Command: mod.ListObjectsV2Command,
		PutObjectCommand: mod.PutObjectCommand,
		HeadObjectCommand: mod.HeadObjectCommand,
		DeleteObjectCommand: mod.DeleteObjectCommand,
	};
}

async function checkStorage(s3, meta, prefix) {
	try {
		const res = await s3.client.send(new s3.ListObjectsV2Command({
			Bucket: meta.objectStorageBucket,
			Prefix: prefix || undefined,
			MaxKeys: 1,
		}));
		return { ok: true, found: (res.KeyCount ?? 0) > 0 };
	} catch (err) {
		return { ok: false, error: describeError(err) };
	}
}

async function uploadObject(s3, meta, create, object) {
	const body = object.size <= BUFFER_LIMIT
		? await fsp.readFile(object.localPath)
		: fs.createReadStream(object.localPath);
	if (Buffer.isBuffer(body) && body.length !== object.size) {
		throw new Error(`${object.localPath} の大きさが、調べたときから変わっています`);
	}

	const params = {
		Bucket: meta.objectStorageBucket,
		Key: object.newKey,
		Body: body,
		ContentLength: object.size,
		ContentType: object.contentType,
		CacheControl: CACHE_CONTROL,
	};
	if (object.contentDispositionFilename != null) {
		params.ContentDisposition = contentDisposition(create, 'inline', object.contentDispositionFilename);
	}
	if (meta.objectStorageSetPublicRead) params.ACL = 'public-read';

	await s3.client.send(new s3.PutObjectCommand(params));

	// 届いたことを、オブジェクトの大きさで確かめる
	const head = await s3.client.send(new s3.HeadObjectCommand({ Bucket: meta.objectStorageBucket, Key: object.newKey }));
	if (head.ContentLength !== object.size) {
		throw new Error(`アップロードした ${object.newKey} の大きさ (${head.ContentLength}) が元のファイル (${object.size}) と違います`);
	}
}

/** アップロードしたオブジェクトを消す。消せなかったキーを返す */
async function deleteObjects(s3, meta, keys) {
	const failed = [];
	for (const key of keys) {
		try {
			await s3.client.send(new s3.DeleteObjectCommand({ Bucket: meta.objectStorageBucket, Key: key }));
		} catch {
			failed.push(key);
		}
	}
	return failed;
}

/**
 * drive_file の行と、URL をコピーして持っている列を 1 つのトランザクションで書き換える。
 * 列ごとに書き換えた行の数を返す
 */
async function commitFile(db, row, plan) {
	const update = buildDriveFileUpdate(plan);
	const pairs = buildUrlPairs(plan);
	let committing = false;

	await db.query('BEGIN');
	try {
		// 調べた後に削除・移行された行は書き換えない
		const res = await db.query(
			`UPDATE "drive_file" SET "url" = $2, "thumbnailUrl" = $3, "webpublicUrl" = $4, "accessKey" = $5, "thumbnailAccessKey" = $6, "webpublicAccessKey" = $7, "storedInternal" = false
			WHERE "id" = $1 AND "storedInternal" = true AND "accessKey" = $8`,
			[row.id, update.url, update.thumbnailUrl, update.webpublicUrl, update.accessKey, update.thumbnailAccessKey, update.webpublicAccessKey, row.accessKey],
		);
		if (res.rowCount !== 1) throw new RowChangedError('drive_file の行が、調べた後に削除・変更されました');

		const counts = new Map();
		for (const [table, column] of URL_COLUMNS) {
			const query = buildRewriteQuery(table, column, pairs);
			const rewritten = await db.query(query.text, query.values);
			counts.set(`${table}.${column}`, rewritten.rowCount ?? 0);
		}

		committing = true;
		await db.query('COMMIT');
		return counts;
	} catch (err) {
		if (committing) {
			throw new CommitUnknownError(`COMMIT がエラーになり、コミットされたかどうか分かりません (${describeError(err)})`);
		}
		await db.query('ROLLBACK').catch(() => {});
		throw err;
	}
}

async function countOldUrls(db, origin) {
	const raw = `${origin}/files/`;
	const encoded = encodeURIComponent(raw);
	const counts = [];
	for (const [table, column] of URL_COLUMNS) {
		const col = quoteIdent(column);
		const res = await db.query(
			`SELECT count(*)::int AS "count" FROM ${quoteIdent(table)} WHERE strpos(${col}, $1::text) > 0 OR strpos(${col}, $2::text) > 0`,
			[raw, encoded],
		);
		counts.push({ column: `${table}.${column}`, count: res.rows[0].count });
	}
	return counts;
}

async function clearEmojiCache(config) {
	const { Redis } = await import('ioredis');
	const redis = new Redis({
		...config.redis,
		lazyConnect: true,
		connectTimeout: 10000,
		maxRetriesPerRequest: 1,
		enableOfflineQueue: false,
		retryStrategy: () => null,
	});
	// 接続のエラーは下の await で受け取るので、イベントでは何もしない
	redis.on('error', () => {});
	try {
		await redis.connect();
		await redis.del(EMOJI_CACHE_KEY);
		return null;
	} catch (err) {
		return err;
	} finally {
		redis.disconnect();
	}
}

function describeError(err) {
	if (err == null) return '不明なエラー';
	const name = err.name && err.name !== 'Error' ? `${err.name}: ` : '';
	// 接続できないときの AggregateError は message が空で、中身は errors に入っている
	const message = err.message || (Array.isArray(err.errors) ? err.errors.map(e => e?.message).join(', ') : String(err));
	return `${name}${message}`;
}

//#endregion

//#region 表示

function printStorage(meta, baseUrl) {
	console.log('オブジェクトストレージの設定:');
	console.log(`  Bucket: ${meta.objectStorageBucket}  Prefix: ${meta.objectStoragePrefix || '(なし)'}`);
	console.log(`  ファイルの URL: ${baseUrl}/<キー>`);
	console.log(`  Endpoint: ${meta.objectStorageEndpoint || '(なし)'}  Region: ${meta.objectStorageRegion || '(なし)'}  SSL: ${meta.objectStorageUseSSL ? 'オン' : 'オフ'}  s3ForcePathStyle: ${meta.objectStorageS3ForcePathStyle ? 'オン' : 'オフ'}`);
	console.log(`  public-read: ${meta.objectStorageSetPublicRead ? 'オン' : 'オフ'}  アクセスキー: ${meta.objectStorageAccessKey && meta.objectStorageSecretKey ? '設定済み' : '未設定'}`);
}

function describeProblem(problem) {
	const label = ROLE_LABELS[problem.role];
	switch (problem.kind) {
		case 'invalid-key': return `${label}のキー (${problem.key ?? 'なし'}) が内部ストレージのキーの形ではありません`;
		case 'unexpected-url': return `${label}の URL (${problem.detail}) が /files/<キー> の形ではありません`;
		case 'missing': return `${label}のファイル ${FILES_DIR}/${problem.key} がありません`;
		case 'unreadable': return `${label}のファイル ${FILES_DIR}/${problem.key} を読めません (${problem.detail})`;
		default: return `${label}: ${problem.kind}`;
	}
}

function printPlan(plan, index, total) {
	console.log(`[${index + 1}/${total}] ${plan.id} 「${plan.name}」 ${plan.type}`);
	for (const object of plan.objects) {
		console.log(`  ${ROLE_LABELS[object.role]}: ${object.oldKey} → ${object.newKey} (${formatBytes(object.size)}, ${object.contentType})`);
	}
	for (const problem of plan.problems) {
		console.log(`  問題: ${describeProblem(problem)}`);
	}
}

function sumBytes(plan) {
	return plan.objects.reduce((sum, object) => sum + object.size, 0);
}

function printOldUrls(counts, title) {
	const found = counts.filter(c => c.count > 0);
	if (found.length === 0) {
		console.log(`${title}: なし`);
		return;
	}
	console.log(`${title}:`);
	for (const c of found) console.log(`  ${c.column}: ${c.count} 行`);
}

//#endregion

//#region モード

async function runMigrate(opts, config, db) {
	const meta = await fetchMeta(db);
	const metaError = checkStorageMeta(meta, config);
	if (metaError != null) {
		console.error(`エラー: ${metaError}`);
		return 1;
	}
	const baseUrl = objectStorageBaseUrl(meta);
	const prefix = objectKeyPrefix(meta);
	printStorage(meta, baseUrl);

	const s3 = await createS3(meta);
	try {
		// 書き込まない操作で、オブジェクトストレージに接続できるかを確かめる
		const check = await checkStorage(s3, meta, prefix);
		if (check.ok) {
			console.log(`オブジェクトストレージに接続できました (${prefix ? `${prefix} の下に` : 'バケットに'}オブジェクトが${check.found ? 'あります' : 'まだありません'})`);
		} else {
			console.error(`エラー: オブジェクトストレージに接続できませんでした: ${check.error}`);
			if (opts.apply) return 1;
		}
		console.log('');

		const code = opts.apply
			? await applyMigrate(opts, config, db, s3, meta, baseUrl, prefix)
			: await dryRunMigrate(opts, config, db, baseUrl, prefix);
		return check.ok ? code : 1;
	} finally {
		s3.client.destroy();
	}
}

async function dryRunMigrate(opts, config, db, baseUrl, prefix) {
	const total = await countInternalFiles(db);
	const rows = await fetchInternalFiles(db, opts.limit);
	console.log(`内部ストレージのファイル: ${total} 件${rows.length < total ? ` (最初の ${rows.length} 件を表示します)` : ''}`);

	let files = 0;
	let objects = 0;
	let bytes = 0;
	const problemPlans = [];

	for (const [index, row] of rows.entries()) {
		const local = await inspectLocalFiles(row);
		const plan = buildFilePlan(row, { baseUrl, prefix, local });
		printPlan(plan, index, rows.length);
		if (plan.problems.length > 0) {
			problemPlans.push(plan);
		} else {
			files++;
			objects += plan.objects.length;
			bytes += sumBytes(plan);
		}
	}

	console.log('');
	console.log(`移行できるファイル: ${files} 件 (オブジェクト ${objects} 個, ${formatBytes(bytes)} = ${bytes} バイト)`);
	if (problemPlans.length > 0) {
		console.log(`問題があるファイル: ${problemPlans.length} 件 (--apply のときは飛ばします)`);
		for (const plan of problemPlans) {
			console.log(`  ${plan.id}: ${plan.problems.map(describeProblem).join(' / ')}`);
		}
	}
	printOldUrls(await countOldUrls(db, config.url), `古い URL (${config.url}/files/...) を含む行`);
	console.log('');
	console.log('何も書き込んでいません。表示した新しいキーは確認用で、--apply のときは作り直します。');
	console.log('移行するときは migrate --apply を実行してください。');
	return 0;
}

async function applyMigrate(opts, config, db, s3, meta, baseUrl, prefix) {
	const { create } = await import('content-disposition');

	// Ctrl-C で止めたときに、アップロードと DB の書き換えの間で止まらないよう、今のファイルが終わってから止める
	let stopRequested = false;
	const onSignal = () => {
		if (stopRequested) process.exit(130);
		stopRequested = true;
		console.error('今のファイルが終わったら止めます (もう一度押すとすぐに止めます)');
	};
	process.on('SIGINT', onSignal);
	process.on('SIGTERM', onSignal);

	let dbBroken = false;
	db.on('error', () => {
		dbBroken = true;
	});

	const rows = await fetchInternalFiles(db, opts.limit);
	console.log(`移行するファイル: ${rows.length} 件`);

	let migratedFiles = 0;
	let migratedObjects = 0;
	let migratedBytes = 0;
	let goneFiles = 0;
	const rewrittenCounts = new Map();
	const skipped = [];
	const failed = [];
	const orphanKeys = [];
	let stoppedEarly = false;

	for (const [index, listed] of rows.entries()) {
		if (stopRequested || dbBroken) {
			stoppedEarly = true;
			break;
		}
		const label = `[${index + 1}/${rows.length}] ${listed.id}`;

		// 一覧を取ってから時間がたっているので、行を読み直す
		let row;
		try {
			row = await fetchInternalFile(db, listed.id);
		} catch (err) {
			failed.push({ id: listed.id, message: `drive_file の行を読めませんでした (${describeError(err)})` });
			stoppedEarly = true;
			break;
		}
		if (row == null) {
			goneFiles++;
			console.log(`${label}: 削除されたか移行済みなので飛ばします`);
			continue;
		}

		const local = await inspectLocalFiles(row);
		const plan = buildFilePlan(row, { baseUrl, prefix, local });
		if (plan.problems.length > 0) {
			skipped.push(plan);
			console.log(`${label}: 飛ばします (${plan.problems.map(describeProblem).join(' / ')})`);
			continue;
		}

		const uploaded = [];
		try {
			for (const object of plan.objects) {
				// 途中で失敗しても消せるよう、送る前に記録する
				uploaded.push(object.newKey);
				await uploadObject(s3, meta, create, object);
			}
			const counts = await commitFile(db, row, plan);
			for (const [column, count] of counts) rewrittenCounts.set(column, (rewrittenCounts.get(column) ?? 0) + count);
			migratedFiles++;
			migratedObjects += plan.objects.length;
			migratedBytes += sumBytes(plan);
			const rewritten = [...counts].filter(([, count]) => count > 0).map(([column, count]) => `${column} ${count} 行`);
			console.log(`${label}: 移行しました (オブジェクト ${plan.objects.length} 個, ${formatBytes(sumBytes(plan))}${rewritten.length > 0 ? `, 書き換え: ${rewritten.join(', ')}` : ''})`);
		} catch (err) {
			if (err instanceof CommitUnknownError) {
				// コミットされていれば、アップロードしたオブジェクトは使われている。消さずに止める
				failed.push({ id: row.id, message: `${err.message}。drive_file の行の accessKey が ${plan.objects[0].newKey} になっているか確かめてください` });
				console.error(`${label}: ${err.message}`);
				stoppedEarly = true;
				break;
			}
			const notDeleted = await deleteObjects(s3, meta, uploaded);
			orphanKeys.push(...notDeleted);
			if (err instanceof RowChangedError) {
				goneFiles++;
				console.log(`${label}: ${err.message}。アップロードしたオブジェクトを消して飛ばします`);
			} else {
				failed.push({ id: row.id, message: describeError(err) });
				console.error(`${label}: 失敗しました (${describeError(err)})`);
			}
		}
	}

	console.log('');
	console.log(`移行したファイル: ${migratedFiles} 件 (オブジェクト ${migratedObjects} 個, ${formatBytes(migratedBytes)} = ${migratedBytes} バイト)`);
	const rewritten = [...rewrittenCounts].filter(([, count]) => count > 0);
	console.log(`書き換えた行: ${rewritten.length > 0 ? rewritten.map(([column, count]) => `${column} ${count} 行`).join(', ') : 'なし'}`);
	if (goneFiles > 0) console.log(`途中で削除されたため移行しなかったファイル: ${goneFiles} 件`);
	if (skipped.length > 0) {
		console.log(`飛ばしたファイル: ${skipped.length} 件`);
		for (const plan of skipped) console.log(`  ${plan.id}: ${plan.problems.map(describeProblem).join(' / ')}`);
	}
	if (failed.length > 0) {
		console.log(`失敗したファイル: ${failed.length} 件 (もう一度実行すると、移行していないものから続けます)`);
		for (const f of failed) console.log(`  ${f.id}: ${f.message}`);
	}
	if (orphanKeys.length > 0) {
		console.log(`消せなかったオブジェクト (どこからも参照されていないので、R2 の画面などで消してください): ${orphanKeys.join(', ')}`);
	}
	if (stoppedEarly) {
		console.log(dbBroken ? 'DB との接続が切れたので止めました。' : '途中で止めました。もう一度実行すると、移行していないものから続けます。');
	}

	if (migratedFiles > 0) {
		// 絵文字の URL は Redis にも 30 分キャッシュされている。消しておくと、次に使うときに DB から読み直される
		const err = await clearEmojiCache(config);
		if (err == null) {
			console.log(`Redis の絵文字のキャッシュ (${config.redis.keyPrefix}${EMOJI_CACHE_KEY}) を消しました`);
		} else {
			console.log(`Redis の絵文字のキャッシュを消せませんでした (${describeError(err)})。30 分で期限が切れるので、そのままでも直ります。すぐに消すときは redis-cli で DB ${config.redis.db} のキー ${config.redis.keyPrefix}${EMOJI_CACHE_KEY} を DEL してください`);
		}
	}

	if (!dbBroken) {
		printOldUrls(await countOldUrls(db, config.url), `まだ古い URL (${config.url}/files/...) を含む行`);
		const keys = publicKeysFromMeta(await fetchMeta(db), baseUrl);
		if (keys.length > 0) {
			console.log(`サーバーの画像 (アイコンなど) のキー。ログイン画面に出すには Worker の PUBLIC_KEYS に入れてください: ${keys.join(',')}`);
		}
	}

	console.log('');
	if (migratedFiles > 0) {
		console.log('Misskey はサーバーの設定・ユーザー・絵文字をメモリにキャッシュしているので、再起動してください:');
		console.log('  cd ~/42times && IMAGE_TAG=$(cat state/current-tag) docker compose restart web');
	}
	console.log('files/ のファイルは消していません。表示を確かめてから cleanup で消してください。');

	return failed.length > 0 || skipped.length > 0 || stoppedEarly ? 1 : 0;
}

async function listFilesDir(dir) {
	const entries = [];
	for (const dirent of await fsp.readdir(dir, { withFileTypes: true })) {
		if (!dirent.isFile()) {
			entries.push({ name: dirent.name, isFile: false, size: 0, mtimeMs: 0 });
			continue;
		}
		const stat = await fsp.lstat(`${dir}/${dirent.name}`);
		entries.push({ name: dirent.name, isFile: stat.isFile(), size: stat.size, mtimeMs: stat.mtimeMs });
	}
	return entries;
}

async function fetchReferencedKeys(db) {
	// 内部ストレージの行は、サムネイルなどが無くても thumbnailAccessKey・webpublicAccessKey を持つ。
	// どれかに一致すれば使われているものとして残す
	const res = await db.query('SELECT "accessKey", "thumbnailAccessKey", "webpublicAccessKey" FROM "drive_file" WHERE "storedInternal" = true');
	const keys = new Set();
	for (const row of res.rows) {
		for (const key of [row.accessKey, row.thumbnailAccessKey, row.webpublicAccessKey]) {
			if (key != null) keys.add(key);
		}
	}
	return keys;
}

async function runCleanup(opts, config, db) {
	const meta = await fetchMeta(db);
	if (!meta.useObjectStorage) {
		// オフのあいだは Misskey が新しいファイルを files/ に保存するので、消してよいかを判断できない
		console.error('エラー: コントロールパネルの「オブジェクトストレージを使用」がオフです。オンにして migrate --apply を実行した後に使ってください');
		return 1;
	}

	// 一覧を DB より先に取る。DB を読んだ後に書き込まれたファイルは一覧に入らないので、消すことはない
	const entries = await listFilesDir(FILES_DIR);
	const referenced = await fetchReferencedKeys(db);
	const remaining = await countInternalFiles(db);
	const result = selectCleanupCandidates(entries, referenced, { now: Date.now() });
	const total = (list) => list.reduce((sum, entry) => sum + entry.size, 0);

	console.log(`${FILES_DIR} の中身: ${entries.length} 個`);
	console.log(`まだ内部ストレージにある drive_file の行: ${remaining} 件`);
	console.log(`使われているので残すファイル: ${result.referenced.length} 個 (${formatBytes(total(result.referenced))})`);
	if (result.recent.length > 0) {
		console.log(`${CLEANUP_MIN_AGE_MS / 60000} 分以内に書き込まれたので残すファイル: ${result.recent.length} 個`);
	}
	if (result.unknown.length > 0) {
		console.log(`内部ストレージのキーの形でないので残すもの: ${result.unknown.length} 個`);
		for (const entry of result.unknown) console.log(`  ${entry.name}${entry.isFile ? '' : ' (通常のファイルではありません)'}`);
	}
	const candidateBytes = total(result.candidates);
	console.log(`消せるファイル: ${result.candidates.length} 個 (${formatBytes(candidateBytes)} = ${candidateBytes} バイト)`);

	if (!opts.apply) {
		console.log('');
		console.log('何も消していません。消すときは cleanup --apply を実行してください。');
		return 0;
	}

	let deleted = 0;
	let deletedBytes = 0;
	const failed = [];
	for (const entry of result.candidates) {
		try {
			await fsp.unlink(`${FILES_DIR}/${entry.name}`);
			deleted++;
			deletedBytes += entry.size;
		} catch (err) {
			failed.push(`${entry.name} (${describeError(err)})`);
		}
	}
	console.log('');
	console.log(`消したファイル: ${deleted} 個 (${formatBytes(deletedBytes)})`);
	if (failed.length > 0) {
		console.log(`消せなかったファイル: ${failed.length} 個`);
		for (const f of failed) console.log(`  ${f}`);
		return 1;
	}
	return 0;
}

export async function main(argv) {
	let opts;
	try {
		opts = parseArgs(argv);
	} catch (err) {
		if (!(err instanceof UsageError)) throw err;
		console.error(`エラー: ${err.message}`);
		console.error(USAGE);
		return 2;
	}
	if (opts.help) {
		console.log(USAGE);
		return 0;
	}

	const config = await loadConfig(CONFIG_PATH);
	const { default: pg } = await import('pg');
	const db = new pg.Client({
		...config.db,
		application_name: 'migrate-files-to-r2',
		connectionTimeoutMillis: 10000,
	});
	// 待っている間に接続が切れると 'error' が出る。受け取らないとプロセスが落ちるので、ここで表示だけする
	db.on('error', err => console.error(`DB との接続でエラーが起きました: ${describeError(err)}`));
	await db.connect();
	try {
		return opts.mode === 'cleanup'
			? await runCleanup(opts, config, db)
			: await runMigrate(opts, config, db);
	} finally {
		await db.end().catch(() => {});
	}
}

//#endregion

function isExecutedDirectly() {
	if (process.argv[1] == null) return false;
	try {
		return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
	} catch {
		return false;
	}
}

if (isExecutedDirectly()) {
	main(process.argv.slice(2)).then(
		code => process.exit(code),
		err => {
			console.error(`エラー: ${describeError(err)}`);
			process.exit(1);
		},
	);
}
