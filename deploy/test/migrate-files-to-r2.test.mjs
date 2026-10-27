/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// deploy/migrate-files-to-r2.mjs の純粋な関数のテスト。DB・Redis・ネットワークは使わない。
// 実行: node --test deploy/test/migrate-files-to-r2.test.mjs
//
// backend と同じ動きをするはずの関数は、Node.js が TypeScript を読める (型を取り除いて実行できる) ときは
// packages/backend/src の実装と結果を比べる。読めないときはその比較だけ飛ばす。

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
	EMOJI_CACHE_KEY,
	FILE_TYPE_BROWSERSAFE,
	URL_COLUMNS,
	UsageError,
	altFormat,
	buildDriveFileUpdate,
	buildFilePlan,
	buildRewriteQuery,
	buildUrlPairs,
	checkStorageMeta,
	contentDisposition,
	contentDispositionFallback,
	correctFilename,
	formatBytes,
	isInternalKeyName,
	isValidInternalKey,
	objectKeyPrefix,
	objectStorageBaseUrl,
	originalExt,
	parseArgs,
	publicKeysFromMeta,
	redisKeyPrefix,
	replaceUrls,
	resolveConfig,
	s3ClientOptions,
	selectCleanupCandidates,
	sniffImageType,
	uploadContentType,
} from '../migrate-files-to-r2.mjs';

async function importBackend(relativePath) {
	const url = new URL(`../../packages/backend/src/${relativePath}`, import.meta.url);
	if (!existsSync(url)) return null;
	try {
		return await import(url.href);
	} catch {
		return null;
	}
}

const backendConst = await importBackend('const.ts');
const backendCorrectFilename = await importBackend('misc/correct-filename.ts');
const backendUrl = await importBackend('misc/prelude/url.ts');
const skipReason = 'packages/backend/src の TypeScript を読めないため';

const ORIGIN = 'https://42times.kinachan.com';
const BASE_URL = `${ORIGIN}/media`;

const KEY_ORIGINAL = '11111111-1111-4111-8111-111111111111';
const KEY_WEBPUBLIC = 'webpublic-22222222-2222-4222-8222-222222222222';
const KEY_THUMBNAIL = 'thumbnail-33333333-3333-4333-8333-333333333333';

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBP_HEAD = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const AVIF_HEAD = Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from('ftypavif'), Buffer.from([0, 0, 0, 0])]);
const GIF_HEAD = Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1');

/** 呼ぶたびに 1, 2, 3... を末尾に入れた UUID を返す */
function sequentialUuid() {
	let n = 0;
	return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
}

function internalRow(overrides = {}) {
	return {
		id: 'a1b2c3d4e5',
		name: '写真 1.PNG',
		type: 'image/png',
		size: 3000,
		url: `${ORIGIN}/files/${KEY_ORIGINAL}`,
		accessKey: KEY_ORIGINAL,
		webpublicUrl: `${ORIGIN}/files/${KEY_WEBPUBLIC}`,
		webpublicAccessKey: KEY_WEBPUBLIC,
		webpublicType: 'image/webp',
		thumbnailUrl: `${ORIGIN}/files/${KEY_THUMBNAIL}`,
		thumbnailAccessKey: KEY_THUMBNAIL,
		...overrides,
	};
}

function fullLocal() {
	return new Map([
		[KEY_ORIGINAL, { size: 3000, head: PNG_HEAD }],
		[KEY_WEBPUBLIC, { size: 2000, head: WEBP_HEAD }],
		[KEY_THUMBNAIL, { size: 500, head: WEBP_HEAD }],
	]);
}

function plan(row = internalRow(), local = fullLocal()) {
	return buildFilePlan(row, { baseUrl: BASE_URL, prefix: 'files/', local, uuid: sequentialUuid() });
}

describe('originalExt (DriveService の save() の拡張子)', () => {
	const cases = [
		['photo.JPG', 'image/jpeg', '.JPG'],
		['photo.jpeg', 'image/jpeg', '.jpeg'],
		['photo', 'image/jpeg', '.jpg'],
		['photo', 'image/png', '.png'],
		['photo', 'image/webp', '.webp'],
		['photo', 'image/avif', '.avif'],
		['photo', 'image/apng', '.apng'],
		// .apng は付くが、image/vnd.mozilla.apng はブラウザで直接表示させない種類なので消える
		['photo', 'image/vnd.mozilla.apng', ''],
		['photo', 'image/gif', ''],
		['clip.mp4', 'video/mp4', '.mp4'],
		['doc.pdf', 'application/pdf', ''],
		['icon.svg', 'image/svg+xml', ''],
		['archive.tar.gz', 'application/gzip', ''],
		['weird.name!', 'image/png', '.png'],
		['ファイル', 'image/png', '.png'],
		['a.my_ext-1', 'image/png', '.my_ext-1'],
	];
	for (const [name, type, expected] of cases) {
		test(`${name} (${type}) → "${expected}"`, () => {
			assert.equal(originalExt(name, type), expected);
		});
	}
});

describe('uploadContentType (DriveService の upload() の Content-Type)', () => {
	test('apng は png にする', () => assert.equal(uploadContentType('image/apng'), 'image/png'));
	test('ブラウザで直接表示させない種類は application/octet-stream にする', () => {
		assert.equal(uploadContentType('image/svg+xml'), 'application/octet-stream');
		assert.equal(uploadContentType('application/pdf'), 'application/octet-stream');
		assert.equal(uploadContentType('image/vnd.mozilla.apng'), 'application/octet-stream');
	});
	test('それ以外はそのまま', () => {
		assert.equal(uploadContentType('image/webp'), 'image/webp');
		assert.equal(uploadContentType('video/mp4'), 'video/mp4');
	});
	test('FILE_TYPE_BROWSERSAFE が backend と同じ', { skip: backendConst == null && skipReason }, () => {
		assert.deepEqual(FILE_TYPE_BROWSERSAFE, backendConst.FILE_TYPE_BROWSERSAFE);
	});
});

describe('correctFilename (packages/backend/src/misc/correct-filename.ts と同じ)', () => {
	// packages/backend/test/unit/misc/correct-filename.ts と同じ例
	const cases = [
		['test', null, 'test.unknown'],
		['test', 'jpg', 'test.jpg'],
		['test.jpg', 'webp', 'test.jpg.webp'],
		['test.jpg', '.webp', 'test.jpg.webp'],
		['test.jpeg', 'jpg', 'test.jpeg'],
		['test.JPEG', 'jpg', 'test.JPEG'],
		['test.jpg', 'jpg', 'test.jpg'],
		['test.JPG', 'jpg', 'test.JPG'],
		['test.tiff', 'tif', 'test.tiff'],
		['test.unitypackage', 'gz', 'test.unitypackage'],
		['test.txt', null, 'test.txt'],
		['test.hoge', null, 'test.hoge'],
		['ファイル 名前', 'jpg', 'ファイル 名前.jpg'],
		// サムネイルの Content-Disposition に使う形
		['写真 1.PNG.thumbnail', 'webp', '写真 1.PNG.thumbnail.webp'],
		['a.dll', 'exe', 'a.dll'],
	];
	for (const [filename, ext, expected] of cases) {
		test(`${filename} + ${ext} → ${expected}`, () => {
			assert.equal(correctFilename(filename, ext), expected);
		});
	}
	test('backend の実装と結果が同じ', { skip: backendCorrectFilename == null && skipReason }, () => {
		const names = ['test', 'test.jpg', 'test.JPEG', 'a.tar.gz', 'x.dll', 'ファイル 名前', '.thumbnail', 'a.b.c.webp', 'no-ext.'];
		const exts = [null, 'jpg', '.webp', 'webp', 'tif', 'gz', 'exe', 'png'];
		for (const name of names) {
			for (const ext of exts) {
				assert.equal(correctFilename(name, ext), backendCorrectFilename.correctFilename(name, ext), `${name} + ${ext}`);
			}
		}
	});
});

describe('contentDisposition', () => {
	test('fallback は英数字・_・.・- 以外を _ にする', () => {
		assert.equal(contentDispositionFallback('写真 1.png'), '___1.png');
		assert.equal(contentDispositionFallback('a-b_c.d.webp'), 'a-b_c.d.webp');
		assert.equal(contentDispositionFallback('a"b;c'), 'a_b_c');
	});
	test('content-disposition の create に type と fallback を渡す', () => {
		const calls = [];
		const create = (filename, options) => {
			calls.push([filename, options]);
			return 'header';
		};
		assert.equal(contentDisposition(create, 'inline', '写真.png'), 'header');
		assert.deepEqual(calls, [['写真.png', { type: 'inline', fallback: '__.png' }]]);
	});
});

describe('sniffImageType・altFormat', () => {
	test('先頭のバイトから形式を判断する', () => {
		assert.equal(sniffImageType(WEBP_HEAD), 'image/webp');
		assert.equal(sniffImageType(PNG_HEAD), 'image/png');
		assert.equal(sniffImageType(JPEG_HEAD), 'image/jpeg');
		assert.equal(sniffImageType(AVIF_HEAD), 'image/avif');
		assert.equal(sniffImageType(GIF_HEAD), 'image/gif');
	});
	test('分からなければ webp にする', () => {
		assert.equal(sniffImageType(Buffer.alloc(0)), 'image/webp');
		assert.equal(sniffImageType(Buffer.from('hello world, this is text')), 'image/webp');
		assert.equal(sniffImageType(Buffer.from('RIFF')), 'image/webp');
	});
	test('webpublicType があればそれを使う', () => {
		assert.deepEqual(altFormat('image/png', WEBP_HEAD), { type: 'image/png', ext: 'png' });
		assert.deepEqual(altFormat('image/webp', PNG_HEAD), { type: 'image/webp', ext: 'webp' });
		assert.deepEqual(altFormat('image/jpeg', null), { type: 'image/jpeg', ext: 'jpg' });
	});
	test('webpublicType が無いか知らない形式なら先頭のバイトで調べる', () => {
		assert.deepEqual(altFormat(null, PNG_HEAD), { type: 'image/png', ext: 'png' });
		assert.deepEqual(altFormat('image/bmp', Buffer.alloc(4)), { type: 'image/webp', ext: 'webp' });
		assert.deepEqual(altFormat(null, AVIF_HEAD), { type: 'image/avif', ext: 'avif' });
	});
});

describe('オブジェクトストレージの設定', () => {
	const r2 = {
		useObjectStorage: true,
		objectStorageBucket: '42times-files',
		objectStoragePrefix: 'files',
		objectStorageBaseUrl: BASE_URL,
		objectStorageEndpoint: '0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
		objectStorageRegion: 'auto',
		objectStoragePort: null,
		objectStorageAccessKey: 'AKID',
		objectStorageSecretKey: 'SECRET',
		objectStorageUseSSL: true,
		objectStorageUseProxy: true,
		objectStorageSetPublicRead: false,
		objectStorageS3ForcePathStyle: true,
	};
	const noProxy = { proxy: null, proxyBypassHosts: [] };

	test('Base URL があればそれを使う', () => {
		assert.equal(objectStorageBaseUrl(r2), BASE_URL);
	});
	test('Base URL が無ければ Endpoint と Bucket から作る', () => {
		assert.equal(objectStorageBaseUrl({ ...r2, objectStorageBaseUrl: null }), 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/42times-files');
	});
	test('ポートがあれば付け、SSL がオフなら http にする', () => {
		assert.equal(
			objectStorageBaseUrl({ ...r2, objectStorageBaseUrl: null, objectStorageEndpoint: 'minio.local', objectStoragePort: 9000, objectStorageUseSSL: false, objectStorageBucket: 'b' }),
			'http://minio.local:9000/b',
		);
	});
	test('キーの接頭辞', () => {
		assert.equal(objectKeyPrefix(r2), 'files/');
		assert.equal(objectKeyPrefix({ ...r2, objectStoragePrefix: null }), '');
		assert.equal(objectKeyPrefix({ ...r2, objectStoragePrefix: '' }), '');
	});
	test('S3 クライアントの設定 (ポートは使わない)', () => {
		const options = s3ClientOptions({ ...r2, objectStoragePort: 443 });
		assert.deepEqual(options, {
			endpoint: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
			credentials: { accessKeyId: 'AKID', secretAccessKey: 'SECRET' },
			region: 'auto',
			tls: true,
			forcePathStyle: true,
			requestChecksumCalculation: 'WHEN_REQUIRED',
			responseChecksumValidation: 'WHEN_REQUIRED',
		});
	});
	test('S3 クライアントの設定 (鍵が無い・Region が空・Endpoint が無い)', () => {
		const options = s3ClientOptions({ ...r2, objectStorageAccessKey: null, objectStorageRegion: '', objectStorageEndpoint: null });
		assert.equal(options.credentials, undefined);
		assert.equal(options.region, undefined);
		assert.equal(options.endpoint, undefined);
		assert.equal(options.forcePathStyle, false);
	});
	test('移行できる設定なら null', () => {
		// default.yml に proxy が無ければ、「Proxyを利用する」がオンでも直接つなぐので止めない
		assert.equal(checkStorageMeta(r2, noProxy), null);
	});
	test('オブジェクトストレージがオフ・Bucket が空なら止める', () => {
		assert.match(checkStorageMeta({ ...r2, useObjectStorage: false }, noProxy), /オフ/);
		assert.match(checkStorageMeta({ ...r2, objectStorageBucket: '' }, noProxy), /Bucket/);
		assert.match(checkStorageMeta({ ...r2, objectStorageBucket: null }, noProxy), /Bucket/);
	});
	test('URL が http(s) で始まらなければ止める', () => {
		assert.match(checkStorageMeta({ ...r2, objectStorageBaseUrl: '' }, noProxy), /http/);
	});
	test('proxy と「Proxyを利用する」が両方あれば止める', () => {
		const withProxy = { proxy: 'http://proxy.local:3128', proxyBypassHosts: [] };
		assert.match(checkStorageMeta(r2, withProxy), /Proxy/);
		assert.equal(checkStorageMeta({ ...r2, objectStorageUseProxy: false }, withProxy), null);
		assert.equal(checkStorageMeta(r2, { ...withProxy, proxyBypassHosts: [r2.objectStorageEndpoint] }), null);
	});
});

describe('buildFilePlan', () => {
	test('オリジナル・webpublic・サムネイルのキーと URL を DriveService と同じ形で作る', () => {
		const result = plan();
		assert.deepEqual(result.problems, []);
		assert.deepEqual(result.objects, [
			{
				role: 'original',
				oldKey: KEY_ORIGINAL,
				oldUrl: `${ORIGIN}/files/${KEY_ORIGINAL}`,
				localPath: `/misskey/files/${KEY_ORIGINAL}`,
				size: 3000,
				newKey: 'files/00000000-0000-4000-8000-000000000001.PNG',
				newUrl: `${BASE_URL}/files/00000000-0000-4000-8000-000000000001.PNG`,
				contentType: 'image/png',
				contentDispositionFilename: '写真 1.PNG',
			},
			{
				role: 'webpublic',
				oldKey: KEY_WEBPUBLIC,
				oldUrl: `${ORIGIN}/files/${KEY_WEBPUBLIC}`,
				localPath: `/misskey/files/${KEY_WEBPUBLIC}`,
				size: 2000,
				newKey: 'files/webpublic-00000000-0000-4000-8000-000000000002.webp',
				newUrl: `${BASE_URL}/files/webpublic-00000000-0000-4000-8000-000000000002.webp`,
				contentType: 'image/webp',
				contentDispositionFilename: '写真 1.PNG.webp',
			},
			{
				role: 'thumbnail',
				oldKey: KEY_THUMBNAIL,
				oldUrl: `${ORIGIN}/files/${KEY_THUMBNAIL}`,
				localPath: `/misskey/files/${KEY_THUMBNAIL}`,
				size: 500,
				newKey: 'files/thumbnail-00000000-0000-4000-8000-000000000003.webp',
				newUrl: `${BASE_URL}/files/thumbnail-00000000-0000-4000-8000-000000000003.webp`,
				contentType: 'image/webp',
				contentDispositionFilename: '写真 1.PNG.thumbnail.webp',
			},
		]);
	});

	test('サムネイル・webpublic の URL が無ければ、キーがあっても移さない', () => {
		const row = internalRow({ name: 'doc.pdf', type: 'application/pdf', webpublicUrl: null, webpublicType: null, thumbnailUrl: null });
		const result = plan(row, new Map([[KEY_ORIGINAL, { size: 10, head: Buffer.from('%PDF-1.7') }]]));
		assert.deepEqual(result.problems, []);
		assert.equal(result.objects.length, 1);
		assert.equal(result.objects[0].newKey, 'files/00000000-0000-4000-8000-000000000001');
		assert.equal(result.objects[0].contentType, 'application/octet-stream');
		assert.deepEqual(buildDriveFileUpdate(result), {
			url: `${BASE_URL}/files/00000000-0000-4000-8000-000000000001`,
			accessKey: 'files/00000000-0000-4000-8000-000000000001',
			webpublicUrl: null,
			webpublicAccessKey: null,
			thumbnailUrl: null,
			thumbnailAccessKey: null,
		});
	});

	test('サムネイルの形式は先頭のバイトで決める', () => {
		const local = fullLocal();
		local.set(KEY_THUMBNAIL, { size: 500, head: JPEG_HEAD });
		const thumbnail = plan(internalRow(), local).objects.find(o => o.role === 'thumbnail');
		assert.equal(thumbnail.newKey, 'files/thumbnail-00000000-0000-4000-8000-000000000003.jpg');
		assert.equal(thumbnail.contentType, 'image/jpeg');
		assert.equal(thumbnail.contentDispositionFilename, '写真 1.PNG.thumbnail.jpg');
	});

	test('Prefix が無ければキーの前に何も付けない', () => {
		const result = buildFilePlan(internalRow(), { baseUrl: 'https://cdn.example.com', prefix: '', local: fullLocal(), uuid: sequentialUuid() });
		assert.equal(result.objects[0].newKey, '00000000-0000-4000-8000-000000000001.PNG');
		assert.equal(result.objects[0].newUrl, 'https://cdn.example.com/00000000-0000-4000-8000-000000000001.PNG');
	});

	test('ファイル名が空なら Content-Disposition を付けない (サムネイルは .thumbnail が付くので付ける)', () => {
		const result = plan(internalRow({ name: '' }));
		assert.equal(result.objects[0].contentDispositionFilename, null);
		assert.equal(result.objects[1].contentDispositionFilename, null);
		assert.equal(result.objects[2].contentDispositionFilename, '.thumbnail.webp');
	});

	test('ローカルのファイルが無ければ問題として返す', () => {
		const local = fullLocal();
		local.delete(KEY_THUMBNAIL);
		const result = plan(internalRow(), local);
		assert.deepEqual(result.problems, [{ role: 'thumbnail', key: KEY_THUMBNAIL, kind: 'missing' }]);
	});

	test('読めなかったファイルは問題として返す', () => {
		const local = fullLocal();
		local.set(KEY_ORIGINAL, { error: 'EACCES' });
		assert.deepEqual(plan(internalRow(), local).problems, [{ role: 'original', key: KEY_ORIGINAL, kind: 'unreadable', detail: 'EACCES' }]);
	});

	test('キーの形が正しくなければ問題として返す', () => {
		for (const key of ['../etc/passwd', '.', '..', 'a/b', '', null]) {
			const result = plan(internalRow({ accessKey: key, url: `${ORIGIN}/files/${key}` }));
			assert.deepEqual(result.problems, [{ role: 'original', key, kind: 'invalid-key' }], String(key));
		}
	});

	test('URL が /files/<キー> で終わらなければ問題として返す', () => {
		const result = plan(internalRow({ url: 'https://example.com/other' }));
		assert.deepEqual(result.problems, [{ role: 'original', key: KEY_ORIGINAL, kind: 'unexpected-url', detail: 'https://example.com/other' }]);
	});

	test('移行後の drive_file の値', () => {
		assert.deepEqual(buildDriveFileUpdate(plan()), {
			url: `${BASE_URL}/files/00000000-0000-4000-8000-000000000001.PNG`,
			accessKey: 'files/00000000-0000-4000-8000-000000000001.PNG',
			webpublicUrl: `${BASE_URL}/files/webpublic-00000000-0000-4000-8000-000000000002.webp`,
			webpublicAccessKey: 'files/webpublic-00000000-0000-4000-8000-000000000002.webp',
			thumbnailUrl: `${BASE_URL}/files/thumbnail-00000000-0000-4000-8000-000000000003.webp`,
			thumbnailAccessKey: 'files/thumbnail-00000000-0000-4000-8000-000000000003.webp',
		});
	});

	test('isValidInternalKey', () => {
		assert.equal(isValidInternalKey(KEY_ORIGINAL), true);
		assert.equal(isValidInternalKey(KEY_THUMBNAIL), true);
		assert.equal(isValidInternalKey('files/abc'), false);
		assert.equal(isValidInternalKey('..'), false);
		assert.equal(isValidInternalKey(undefined), false);
	});
});

describe('URL の書き換え', () => {
	const pairs = buildUrlPairs(plan());
	const newWebpublicUrl = `${BASE_URL}/files/webpublic-00000000-0000-4000-8000-000000000002.webp`;

	test('そのままの URL を置き換える', () => {
		assert.equal(replaceUrls(`${ORIGIN}/files/${KEY_ORIGINAL}`, pairs), `${BASE_URL}/files/00000000-0000-4000-8000-000000000001.PNG`);
		assert.equal(replaceUrls(`${ORIGIN}/files/${KEY_THUMBNAIL}`, pairs), `${BASE_URL}/files/thumbnail-00000000-0000-4000-8000-000000000003.webp`);
	});

	test('アバターのメディアプロキシの URL に埋め込まれた URL を置き換える', () => {
		const avatarUrl = `${ORIGIN}/proxy/avatar.webp?url=https%3A%2F%2F42times.kinachan.com%2Ffiles%2F${KEY_WEBPUBLIC}&avatar=1`;
		assert.equal(
			replaceUrls(avatarUrl, pairs),
			`${ORIGIN}/proxy/avatar.webp?url=${encodeURIComponent(newWebpublicUrl)}&avatar=1`,
		);
		assert.equal(
			replaceUrls(avatarUrl, pairs),
			`${ORIGIN}/proxy/avatar.webp?url=https%3A%2F%2F42times.kinachan.com%2Fmedia%2Ffiles%2Fwebpublic-00000000-0000-4000-8000-000000000002.webp&avatar=1`,
		);
	});

	test('backend の query() で作ったアバターの URL と一致する', { skip: backendUrl == null && skipReason }, () => {
		const avatar = (url) => backendUrl.appendQuery(`${ORIGIN}/proxy/avatar.webp`, backendUrl.query({ url, avatar: '1' }));
		assert.equal(replaceUrls(avatar(`${ORIGIN}/files/${KEY_WEBPUBLIC}`), pairs), avatar(newWebpublicUrl));
	});

	test('関係のない URL は変えない', () => {
		const other = `${ORIGIN}/files/44444444-4444-4444-8444-444444444444`;
		assert.equal(replaceUrls(other, pairs), other);
		assert.equal(replaceUrls(`${BASE_URL}/files/x.png`, pairs), `${BASE_URL}/files/x.png`);
	});

	test('UPDATE 文は古い URL・エンコードした URL を置き換え、古いキーを含む行に絞る', () => {
		const single = buildUrlPairs({ objects: [plan().objects[0]] });
		const query = buildRewriteQuery('user', 'avatarUrl', single);
		assert.equal(
			query.text,
			'UPDATE "user" SET "avatarUrl" = replace(replace("avatarUrl", $1::text, $2::text), $3::text, $4::text)'
			+ ' WHERE (strpos("avatarUrl", $5::text) > 0)'
			+ ' AND replace(replace("avatarUrl", $1::text, $2::text), $3::text, $4::text) <> "avatarUrl"',
		);
		assert.deepEqual(query.values, [single[0].from, single[0].to, single[0].fromEncoded, single[0].toEncoded, KEY_ORIGINAL]);
	});

	test('UPDATE 文は 1 つのファイルのすべての組をまとめて置き換える', () => {
		const query = buildRewriteQuery('meta', 'iconUrl', pairs);
		assert.equal(query.values.length, 15);
		assert.match(query.text, /^UPDATE "meta" SET "iconUrl" = replace\(replace\(replace\(replace\(replace\(replace\("iconUrl", \$1::text, \$2::text\), \$3::text, \$4::text\), \$6::text, \$7::text\), \$8::text, \$9::text\), \$11::text, \$12::text\), \$13::text, \$14::text\)/);
		assert.match(query.text, /WHERE \(strpos\("iconUrl", \$5::text\) > 0 OR strpos\("iconUrl", \$10::text\) > 0 OR strpos\("iconUrl", \$15::text\) > 0\)/);
		assert.deepEqual([query.values[4], query.values[9], query.values[14]], [KEY_ORIGINAL, KEY_WEBPUBLIC, KEY_THUMBNAIL]);
	});

	test('書き換える列', () => {
		assert.deepEqual(URL_COLUMNS.slice(0, 8), [
			['user', 'avatarUrl'],
			['user', 'bannerUrl'],
			['emoji', 'originalUrl'],
			['emoji', 'publicUrl'],
			['role', 'iconUrl'],
			['avatar_decoration', 'url'],
			['ad', 'imageUrl'],
			['announcement', 'imageUrl'],
		]);
		assert.equal(URL_COLUMNS.filter(([table]) => table === 'meta').length, 10);
	});

	test('meta の画像のうちオブジェクトストレージにあるもののキー', () => {
		const meta = {
			iconUrl: `${BASE_URL}/files/a.png`,
			app192IconUrl: `${BASE_URL}/files/a.png`,
			bannerUrl: `${ORIGIN}/files/${KEY_ORIGINAL}`,
			logoImageUrl: `${BASE_URL}/files/b.webp?v=1`,
			infoImageUrl: null,
		};
		assert.deepEqual(publicKeysFromMeta(meta, BASE_URL), ['files/a.png', 'files/b.webp']);
	});
});

describe('cleanup で消すファイル', () => {
	const now = Date.UTC(2026, 9, 20);
	const old = now - 2 * 60 * 60 * 1000;
	const uuid = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
	// 16 進数の英字を含む UUID を大文字にしたもの。randomUUID() は小文字なので、この形のファイルは Misskey が作ったものではない
	const UPPER_UUID = 'abcdef01-2345-4678-89ab-cdef01234567'.toUpperCase();

	test('内部ストレージのキーの形', () => {
		assert.equal(isInternalKeyName(uuid(5)), true);
		assert.equal(isInternalKeyName(`thumbnail-${uuid(5)}`), true);
		assert.equal(isInternalKeyName(`webpublic-${uuid(5)}`), true);
		assert.equal(isInternalKeyName(UPPER_UUID), false);
		assert.equal(isInternalKeyName(`${uuid(5)}.png`), false);
		assert.equal(isInternalKeyName(`other-${uuid(5)}`), false);
		assert.equal(isInternalKeyName('README'), false);
	});

	test('参照されておらず、古いファイルだけを選ぶ', () => {
		const entries = [
			{ name: uuid(1), isFile: true, size: 100, mtimeMs: old },
			{ name: `thumbnail-${uuid(1)}`, isFile: true, size: 10, mtimeMs: old },
			{ name: `webpublic-${uuid(2)}`, isFile: true, size: 20, mtimeMs: old },
			{ name: uuid(3), isFile: true, size: 300, mtimeMs: old },
			{ name: `thumbnail-${uuid(3)}`, isFile: true, size: 30, mtimeMs: old },
			{ name: uuid(4), isFile: true, size: 400, mtimeMs: now - 60 * 1000 },
			{ name: '.gitkeep', isFile: true, size: 0, mtimeMs: old },
			{ name: UPPER_UUID, isFile: true, size: 1, mtimeMs: old },
			{ name: uuid(7), isFile: false, size: 0, mtimeMs: 0 },
		];
		const referenced = new Set([uuid(3), `thumbnail-${uuid(3)}`, `webpublic-${uuid(3)}`]);
		const result = selectCleanupCandidates(entries, referenced, { now, minAgeMs: 60 * 60 * 1000 });
		assert.deepEqual(result.candidates.map(e => e.name), [uuid(1), `thumbnail-${uuid(1)}`, `webpublic-${uuid(2)}`]);
		assert.deepEqual(result.referenced.map(e => e.name), [uuid(3), `thumbnail-${uuid(3)}`]);
		assert.deepEqual(result.recent.map(e => e.name), [uuid(4)]);
		assert.deepEqual(result.unknown.map(e => e.name), ['.gitkeep', UPPER_UUID, uuid(7)]);
	});
});

describe('default.yml', () => {
	const raw = {
		url: 'https://42times.kinachan.com/',
		db: { host: 'localhost', port: 5432, db: 'misskey42', user: 'misskey42', pass: 'dbpass' },
		redis: { host: 'localhost', port: 6379, db: 1, prefix: '42times', pass: 'redispass' },
	};

	test('Redis のキーの接頭辞は prefix、無ければ url のホスト', () => {
		assert.equal(redisKeyPrefix(raw), '42times:');
		assert.equal(redisKeyPrefix({ ...raw, redis: { host: 'localhost', port: 6379 } }), '42times.kinachan.com:');
		assert.equal(redisKeyPrefix({ url: 'https://example.com:8443/', redis: {} }), 'example.com:8443:');
		assert.equal(EMOJI_CACHE_KEY, 'singlecache:localEmojis');
	});

	test('接続の設定に変換する', () => {
		const config = resolveConfig(raw);
		assert.equal(config.url, 'https://42times.kinachan.com');
		assert.equal(config.proxy, null);
		assert.deepEqual(config.proxyBypassHosts, []);
		assert.deepEqual(config.db, { host: 'localhost', port: 5432, database: 'misskey42', user: 'misskey42', password: 'dbpass' });
		assert.equal(config.redis.password, 'redispass');
		assert.equal(config.redis.keyPrefix, '42times:');
		assert.equal(config.redis.db, 1);
		assert.equal(config.redis.family, 0);
	});

	test('db.extra を接続の設定に含め、redis.db の既定は 0', () => {
		const config = resolveConfig({ ...raw, db: { ...raw.db, extra: { ssl: true } }, redis: { host: 'localhost', port: 6379, pass: 'x' } });
		assert.equal(config.db.ssl, true);
		assert.equal(config.redis.db, 0);
		assert.equal(config.redis.keyPrefix, '42times.kinachan.com:');
	});

	test('url が正しくなければエラー', () => {
		assert.throws(() => resolveConfig({ ...raw, url: 'not a url' }), /url/);
		assert.throws(() => resolveConfig(null));
	});
});

describe('parseArgs', () => {
	test('既定は migrate の計画の表示', () => {
		assert.deepEqual(parseArgs([]), { mode: 'migrate', apply: false, limit: null, help: false });
	});
	test('モードと --apply・--limit', () => {
		assert.deepEqual(parseArgs(['migrate', '--apply', '--limit', '5']), { mode: 'migrate', apply: true, limit: 5, help: false });
		assert.deepEqual(parseArgs(['--limit=3']), { mode: 'migrate', apply: false, limit: 3, help: false });
		assert.deepEqual(parseArgs(['cleanup', '--apply']), { mode: 'cleanup', apply: true, limit: null, help: false });
		assert.equal(parseArgs(['--help']).help, true);
		assert.equal(parseArgs(['-h']).help, true);
	});
	test('分からない引数・正しくない --limit はエラー', () => {
		assert.throws(() => parseArgs(['--dry-run']), UsageError);
		assert.throws(() => parseArgs(['migrate', 'cleanup']), UsageError);
		assert.throws(() => parseArgs(['--limit']), UsageError);
		assert.throws(() => parseArgs(['--limit', '0']), UsageError);
		assert.throws(() => parseArgs(['--limit', '-1']), UsageError);
		assert.throws(() => parseArgs(['--limit=1.5']), UsageError);
	});
	test('--limit は migrate のときだけ', () => {
		assert.throws(() => parseArgs(['cleanup', '--limit', '1']), UsageError);
	});
});

test('formatBytes', () => {
	assert.equal(formatBytes(0), '0 B');
	assert.equal(formatBytes(1023), '1023 B');
	assert.equal(formatBytes(1536), '1.5 KiB');
	assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MiB');
});
