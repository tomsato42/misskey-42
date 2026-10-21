/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// emojis.json に書いたカスタム絵文字を、管理 API (drive/files/create → admin/emoji/add) で登録する。
// 普段は add-emojis.sh から web のコンテナの中で実行する (手順は deploy/README.md の「カスタム絵文字の追加」)。
//   EMOJI_DIR=<emojis.json のあるディレクトリ> MISSKEY_TOKEN=<アクセストークン> node add-emojis.mjs [--update] [--dry-run]
// 同じ名前の絵文字があれば飛ばす。--update を付けると画像と設定を置き換える。
// emojis.json の形 (category・license・isSensitive・localOnly は全体の既定値を上に書け、絵文字ごとに上書きできる):
//   { "category": "ミーム", "license": "...", "emojis": [
//     { "name": "foo", "file": "foo.png", "aliases": ["ふー"] },
//     { "name": "bar", "url": "https://example.com/bar.png", "category": "ほか" },
//     { "copyFrom": "misskey.io", "remoteName": "send_money" },
//     { "copyFrom": "misskey.io", "remoteQuery": "全て詐欺" } ] }
// copyFrom はほかの Misskey サーバーの絵文字を画像・エイリアス・カテゴリ・ライセンスごと写す。remoteName (絵文字名) か
// remoteQuery (名前かエイリアスに含まれる文字列。1 つに絞れないときは候補を出して失敗する) で選ぶ。
// name を省くと元の名前を使う。ライセンスには「出典: <サーバー> :<名前>:」を足す。

import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

const args = process.argv.slice(2);
const update = args.includes('--update');
const dryRun = args.includes('--dry-run');
const dir = process.env.EMOJI_DIR ?? '.';
const base = (process.env.MISSKEY_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const token = process.env.MISSKEY_TOKEN;
const FOLDER_NAME = 'custom-emojis';
const MIME = { '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.apng': 'image/apng', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.avif': 'image/avif' };

if (!token) throw new Error('MISSKEY_TOKEN is not set');

async function api(endpoint, body) {
	const res = await fetch(`${base}/api/${endpoint}`, {
		method: 'POST',
		...(body instanceof FormData
			? { body }
			: { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ i: token, ...body }) }),
	});
	const text = await res.text();
	const json = text === '' ? null : JSON.parse(text);
	if (!res.ok) {
		const err = new Error(`${endpoint}: ${res.status} ${json?.error?.code ?? ''} ${json?.error?.message ?? text}`);
		err.code = json?.error?.code;
		throw err;
	}
	return json;
}

// emoji で 1 件ずつ引くと、無いときに INTERNAL_ERROR になるので、一覧から名前を集める
async function existingNames() {
	const { emojis } = await api('emojis', {});
	return new Set(emojis.map(e => e.name));
}

async function loadImage(emoji) {
	if (emoji.file != null) {
		const path = join(dir, emoji.file);
		return { data: await readFile(path), filename: basename(path), type: MIME[extname(path).toLowerCase()] };
	}
	if (emoji.url != null) {
		const res = await fetch(emoji.url);
		if (!res.ok) throw new Error(`${emoji.url}: ${res.status}`);
		const filename = basename(new URL(emoji.url).pathname) || emoji.name;
		return { data: Buffer.from(await res.arrayBuffer()), filename, type: res.headers.get('content-type') ?? MIME[extname(filename).toLowerCase()] };
	}
	throw new Error(`${emoji.name}: file か url を書いてください`);
}

const remoteLists = new Map();
async function remoteApi(host, endpoint, body) {
	const res = await fetch(`https://${host}/api/${endpoint}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`${host} ${endpoint}: ${res.status} ${await res.text()}`);
	return await res.json();
}

// copyFrom の絵文字を探し、画像の URL と元の設定を entry に足す (entry に書いた値が優先)
async function resolveRemote(entry) {
	const host = entry.copyFrom;
	if (!remoteLists.has(host)) remoteLists.set(host, (await remoteApi(host, 'emojis', {})).emojis);
	const list = remoteLists.get(host);
	let matches;
	if (entry.remoteName != null) {
		matches = list.filter(e => e.name === entry.remoteName);
	} else if (entry.remoteQuery != null) {
		const q = entry.remoteQuery;
		matches = list.filter(e => e.name.includes(q) || (e.aliases ?? []).some(a => a.includes(q)));
	} else {
		throw new Error(`${host}: remoteName か remoteQuery を書いてください`);
	}
	const label = entry.remoteName ?? entry.remoteQuery;
	if (matches.length !== 1) {
		const candidates = matches.slice(0, 20).map(e => `:${e.name}: [${(e.aliases ?? []).join(', ')}]`).join('\n  ');
		throw new Error(`${host} で「${label}」が ${matches.length} 件見つかりました${matches.length > 0 ? `\n  ${candidates}` : ''}`);
	}
	const remote = await remoteApi(host, 'emoji', { name: matches[0].name });
	const source = `出典: ${host} :${remote.name}:`;
	return {
		name: remote.name,
		url: remote.url,
		aliases: (remote.aliases ?? []).filter(a => a !== ''),
		category: remote.category ?? undefined,
		license: remote.license ? `${remote.license} / ${source}` : source,
		isSensitive: remote.isSensitive ?? undefined,
		...Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined)),
	};
}

let folderId;
async function getFolderId() {
	if (folderId !== undefined) return folderId;
	const found = await api('drive/folders/find', { name: FOLDER_NAME, parentId: null });
	folderId = found.length > 0 ? found[0].id : (await api('drive/folders/create', { name: FOLDER_NAME })).id;
	return folderId;
}

async function upload(emoji) {
	const image = await loadImage(emoji);
	const ext = extname(image.filename) || '.png';
	const form = new FormData();
	form.append('i', token);
	form.append('folderId', await getFolderId());
	form.append('name', `${emoji.name}${ext}`);
	form.append('file', new Blob([image.data], { type: image.type ?? 'application/octet-stream' }), `${emoji.name}${ext}`);
	return (await api('drive/files/create', form)).id;
}

const manifest = JSON.parse(await readFile(join(dir, 'emojis.json'), 'utf8'));
const list = Array.isArray(manifest) ? manifest : manifest.emojis;
const defaults = Array.isArray(manifest) ? {} : manifest;

const existing = await existingNames();
let failed = 0;
for (const entry of list) {
	let emoji = entry;
	try {
		if (entry.copyFrom != null) emoji = await resolveRemote(entry);
		emoji = {
			category: defaults.category ?? null,
			license: defaults.license ?? null,
			isSensitive: defaults.isSensitive ?? false,
			localOnly: defaults.localOnly ?? false,
			aliases: [],
			...Object.fromEntries(Object.entries(emoji).filter(([, v]) => v !== undefined)),
		};
		if (!/^[a-zA-Z0-9_]+$/.test(emoji.name ?? '')) throw new Error(`名前は英数字と _ だけにしてください: ${emoji.name}`);
		const already = existing.has(emoji.name);
		if (already && !update) {
			console.log(`skip    :${emoji.name}: (すでにあります。置き換えるときは --update)`);
			continue;
		}
		if (dryRun) {
			await loadImage(emoji);
			console.log(`${already ? 'update' : 'add   '}  :${emoji.name}: (dry-run) category=${emoji.category} aliases=${emoji.aliases.join(',')} license=${emoji.license}`);
			continue;
		}
		const fileId = await upload(emoji);
		const props = {
			name: emoji.name,
			fileId,
			category: emoji.category,
			aliases: emoji.aliases,
			license: emoji.license,
			isSensitive: emoji.isSensitive,
			localOnly: emoji.localOnly,
		};
		await api(already ? 'admin/emoji/update' : 'admin/emoji/add', props);
		existing.add(emoji.name);
		console.log(`${already ? 'update' : 'add   '}  :${emoji.name}:`);
	} catch (e) {
		failed++;
		console.error(`failed  :${emoji.name ?? emoji.remoteName ?? emoji.remoteQuery}: ${e.message}`);
	}
}
if (failed > 0) process.exit(1);
