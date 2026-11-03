/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42times: このフォークで足した文の訳 (locales-42times) を確かめる
// - ja-JP.yml の文のうち Crowdin の訳 (locales/<lang>.yml) に無いものは、すべて locales-42times/<lang>.yml に訳があること
// - locales-42times の訳は ja-JP.yml にある文だけで、{name} などの引数が同じであること

import * as fs from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';

type LocaleRecord = { [key: string]: string | LocaleRecord };

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const localesDir = resolve(rootDir, 'locales');
const forkLocalesDir = resolve(rootDir, 'locales-42times');

function load(path: string): LocaleRecord {
	if (!fs.existsSync(path)) return {};
	return (loadYaml(fs.readFileSync(path, 'utf-8')) ?? {}) as LocaleRecord;
}

function flatten(record: LocaleRecord, prefix = '', out = new Map<string, unknown>()): Map<string, unknown> {
	for (const [key, value] of Object.entries(record)) {
		const path = prefix === '' ? key : `${prefix}.${key}`;
		if (typeof value === 'object' && value != null) flatten(value, path, out);
		else out.set(path, value);
	}
	return out;
}

function parameters(text: string): string {
	return [...new Set(text.match(/\{[^}]+\}/g) ?? [])].sort().join(' ');
}

const original = flatten(load(resolve(localesDir, 'ja-JP.yml')));
const errors: string[] = [];

const langs = fs.readdirSync(forkLocalesDir).filter(file => file.endsWith('.yml')).map(file => file.slice(0, -'.yml'.length));
for (const lang of langs) {
	const crowdin = flatten(load(resolve(localesDir, `${lang}.yml`)));
	const fork = flatten(load(resolve(forkLocalesDir, `${lang}.yml`)));

	for (const [key, value] of fork) {
		const source = original.get(key);
		if (source === undefined) {
			errors.push(`${lang}: ${key} は ja-JP.yml に無い (消すか、ja-JP.yml のキーに合わせる)`);
		} else if (typeof value !== 'string' || value.trim() === '') {
			errors.push(`${lang}: ${key} が空か文字列でない`);
		} else if (parameters(String(source)) !== parameters(value)) {
			errors.push(`${lang}: ${key} の引数が ja-JP.yml と違う (${parameters(String(source)) || 'なし'} / ${parameters(value) || 'なし'})`);
		}
	}

	for (const key of original.keys()) {
		const translated = crowdin.get(key);
		if (typeof translated === 'string' && translated !== '') continue;
		if (fork.has(key)) continue;
		errors.push(`${lang}: ${key} の訳が無い (locales-42times/${lang}.yml に足す)`);
	}
}

if (errors.length > 0) {
	for (const error of errors) console.error(error);
	console.error(`${errors.length} 件の問題がありました。`);
	process.exit(1);
}
console.log(`locales-42times: OK (${langs.join(', ')})`);
