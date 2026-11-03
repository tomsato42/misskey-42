<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_spacer" style="--MI_SPACER-w: 900px;">
	<MkLoading v-if="available == null"/>

	<MkInfo v-else-if="!available">
		{{ i18n.ts._emojiTagging.notConfigured }}
		<MkA to="/admin/external-services" class="_link">{{ i18n.ts._emojiTagging.openSettings }}</MkA>
	</MkInfo>

	<div v-else class="_gaps">
		<MkFolder :defaultOpen="savedInstructions !== ''">
			<template #icon><i class="ti ti-message-2"></i></template>
			<template #label>{{ i18n.ts._emojiTagging.instructions }}</template>
			<div class="_gaps_s">
				<MkTextarea v-model="instructions">
					<template #caption>{{ instructions.trim().length }} / {{ MAX_INSTRUCTIONS_LENGTH }}</template>
				</MkTextarea>
				<div>
					<MkButton primary :disabled="instructions.trim() === savedInstructions || instructions.trim().length > MAX_INSTRUCTIONS_LENGTH" @click="saveInstructions">{{ i18n.ts.save }}</MkButton>
				</div>
			</div>
		</MkFolder>

		<div :class="$style.toolbar">
			<MkSelect v-model="target" :items="targetDef" :class="$style.toolbarSelect">
				<template #label>{{ i18n.ts._emojiTagging.target }}</template>
			</MkSelect>
			<MkSelect v-model="categoryFilter" :items="categoryFilterDef" :class="$style.toolbarSelect">
				<template #label>{{ i18n.ts.category }}</template>
			</MkSelect>
			<div :class="$style.toolbarButtons">
				<MkButton v-if="!running" primary :disabled="pendingRows.length === 0" @click="start">
					<i class="ti ti-sparkles"></i> {{ i18n.tsx._emojiTagging.start({ count: pendingRows.length }) }}
				</MkButton>
				<MkButton v-else danger @click="stop">{{ i18n.ts._emojiTagging.stop }}</MkButton>
			</div>
		</div>

		<div v-if="runTotal > 0" :class="$style.progress">
			<div :class="$style.progressBar" role="progressbar" :aria-valuenow="runDone" aria-valuemin="0" :aria-valuemax="runTotal" :aria-label="i18n.ts._emojiTagging.title"><div :class="$style.progressFill" :style="{ width: `${runDone / runTotal * 100}%` }"></div></div>
			<span>{{ i18n.tsx._emojiTagging.progress({ done: runDone, total: runTotal }) }}</span>
		</div>

		<div v-if="selectedRows.length > 0" :class="$style.bulkBar">
			<span>{{ i18n.tsx._emojiTagging.selectedCount({ count: selectedRows.length }) }}</span>
			<MkInput v-model="bulkHint" small :class="$style.bulkHint" @enter="resuggestSelected">
				<template #label>{{ i18n.ts._emojiTagging.hint }}</template>
			</MkInput>
			<MkButton small primary @click="resuggestSelected">{{ i18n.ts._emojiTagging.resuggestSelected }}</MkButton>
		</div>

		<MkLoading v-if="loading"/>
		<div v-else-if="visibleRows.length === 0" :class="$style.empty">{{ i18n.ts._emojiTagging.noTargets }}</div>

		<div
			v-else
			ref="listEl"
			:class="$style.list"
			tabindex="0"
			role="listbox"
			:aria-label="i18n.ts._emojiTagging.tabTitle"
			:aria-activedescendant="visibleRows[activeIndex] != null ? `emoji-tagging-row-${visibleRows[activeIndex].emoji.id}` : undefined"
			@keydown="onKeydown"
		>
			<div
				v-for="(row, i) in visibleRows"
				:id="`emoji-tagging-row-${row.emoji.id}`"
				:key="row.emoji.id"
				:ref="el => setRowEl(row.emoji.id, el)"
				role="option"
				:aria-selected="i === activeIndex"
				:aria-label="row.emoji.name"
				:class="[$style.row, { [$style.active]: i === activeIndex, [$style.applied]: row.status === 'applied' }]"
				@click="activeIndex = i"
			>
				<label :class="$style.check" @click.stop>
					<input v-model="row.selected" type="checkbox" :aria-label="row.emoji.name"/>
				</label>
				<img :src="row.emoji.url" :alt="row.emoji.name" :class="$style.img" loading="lazy" decoding="async"/>
				<div :class="$style.body">
					<div :class="$style.head">
						<span :class="$style.name">:{{ row.emoji.name }}:</span>
						<span v-if="row.history.length > 1" :class="$style.history">
							<button class="_button" :disabled="row.index === 0" :aria-label="i18n.ts._emojiTagging.previousSuggestion" @click.stop="moveHistory(row, -1)"><i class="ti ti-chevron-left"></i></button>
							{{ i18n.tsx._emojiTagging.history({ index: row.index + 1, count: row.history.length }) }}
							<button class="_button" :disabled="row.index === row.history.length - 1" :aria-label="i18n.ts._emojiTagging.nextSuggestion" @click.stop="moveHistory(row, 1)"><i class="ti ti-chevron-right"></i></button>
						</span>
						<span :class="$style.rowButtons">
							<MkButton small :disabled="row.status === 'loading' || row.status === 'applying'" @click.stop="resuggest(row)">{{ i18n.ts._emojiTagging.resuggest }}</MkButton>
							<MkButton small iconOnly :disabled="row.status === 'loading'" :aria-label="i18n.ts._emojiTagging.hint" :title="i18n.ts._emojiTagging.hint" @click.stop="openHint(row)"><i class="ti ti-message-2"></i></MkButton>
							<MkButton v-if="row.status !== 'applied'" small primary :disabled="current(row) == null || row.status === 'loading' || row.status === 'applying'" @click.stop="apply(row)">{{ i18n.ts._emojiTagging.apply }}</MkButton>
							<span v-else :class="$style.appliedLabel"><i class="ti ti-check"></i> {{ i18n.ts._emojiTagging.applied }}</span>
						</span>
					</div>

					<div v-if="row.emoji.aliases.length > 0" :class="$style.chips">
						<span :class="$style.chipsLabel">{{ i18n.ts._emojiTagging.currentTags }}</span>
						<span v-for="tag in row.emoji.aliases" :key="`c-${tag}`" :class="[$style.chip, $style.chipCurrent]">{{ tag }}</span>
					</div>
					<div v-if="current(row) != null || row.status === 'loading'" :class="$style.chips">
						<span :class="$style.chipsLabel">{{ i18n.ts._emojiTagging.suggestedTags }}</span>
						<template v-if="current(row) != null">
							<span v-for="tag in current(row)!.tags" :key="`s-${tag}`" :class="$style.chip">{{ tag }}</span>
							<span v-if="current(row)!.tags.length === 0" :class="$style.note">{{ i18n.ts._emojiTagging.noSuggestedTags }}</span>
						</template>
						<MkLoading v-if="row.status === 'loading'" :inline="true" :em="true"/>
					</div>

					<div v-if="current(row)?.category != null && current(row)!.category!.name !== row.emoji.category" :class="$style.category">
						<MkSwitch v-model="row.applyCategory" :disabled="row.status === 'applied'">
							<template #label>
								{{ i18n.tsx._emojiTagging.changeCategory({ name: current(row)!.category!.name }) }}
								<span v-if="current(row)!.category!.isNew" :class="$style.newBadge">{{ i18n.ts._emojiTagging.newCategory }}</span>
							</template>
						</MkSwitch>
						<span v-if="row.emoji.category" :class="$style.note">{{ i18n.ts.category }}: {{ row.emoji.category }}</span>
					</div>

					<div v-if="row.hintOpen" :class="$style.hintBox">
						<MkInput :ref="el => setHintEl(row.emoji.id, el)" v-model="row.hint" small :class="$style.hintInput" @enter="resuggest(row)">
							<template #label>{{ i18n.ts._emojiTagging.hint }}</template>
						</MkInput>
						<MkButton small primary :disabled="row.status === 'loading'" @click.stop="resuggest(row)">{{ i18n.ts._emojiTagging.resuggestThisRow }}</MkButton>
					</div>

					<div v-if="row.error != null" :class="$style.error"><i class="ti ti-alert-triangle"></i> {{ row.error }}</div>
				</div>
			</div>
		</div>

		<div v-if="visibleRows.length > 0" :class="$style.footer">
			<div :class="$style.keys">
				<span><kbd>J</kbd> <kbd>K</kbd> {{ i18n.ts._emojiTagging.keyMove }}</span>
				<span><kbd>R</kbd> {{ i18n.ts._emojiTagging.keyResuggest }}</span>
				<span><kbd>H</kbd> {{ i18n.ts._emojiTagging.keyHint }}</span>
				<span><kbd>←</kbd> <kbd>→</kbd> {{ i18n.ts._emojiTagging.keyHistory }}</span>
				<span><kbd>X</kbd> {{ i18n.ts._emojiTagging.keySelect }}</span>
				<span><kbd>Enter</kbd> {{ i18n.ts._emojiTagging.keyApply }}</span>
			</div>
			<MkButton primary :disabled="applicableRows.length === 0 || applyingAll" @click="applyAll">{{ i18n.tsx._emojiTagging.applyAll({ count: applicableRows.length }) }}</MkButton>
		</div>
	</div>
</div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue';
import * as Misskey from 'misskey-js';
import type { ComponentPublicInstance } from 'vue';
import type { EmojiTaggingTarget, EmojiTagSuggestion } from '@/utility/emoji-tagging.js';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkInfo from '@/components/MkInfo.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { useMkSelect } from '@/composables/use-mkselect.js';
import { mapWithConcurrency } from '@/pages/admin/custom-emojis-manager.impl.js';
import {
	EMOJI_TAGGING_CONCURRENCY,
	MAX_INSTRUCTIONS_LENGTH,
	emojiTaggingErrorMessage,
	isEmojiTaggingAvailable,
	matchesTaggingTarget,
	mergeTags,
	suggestEmojiTags,
} from '@/utility/emoji-tagging.js';

/** 再提案で「前に出した語」として送る最大数 (backend の MAX_EXCLUDED_TAGS と同じ) */
const MAX_EXCLUDED_TAGS = 100;
const NO_CATEGORY = '\u0000none';
const ALL_CATEGORIES = '\u0000all';

type Row = {
	emoji: Misskey.entities.EmojiDetailed;
	/** 出した提案。前の提案に戻れるよう、すべて残す */
	history: EmojiTagSuggestion[];
	/** 表示している提案の位置 */
	index: number;
	status: 'idle' | 'loading' | 'applying' | 'applied';
	error: string | null;
	/** 反映するときにカテゴリも変えるか */
	applyCategory: boolean;
	selected: boolean;
	hintOpen: boolean;
	hint: string;
};

const available = ref<boolean | null>(null);
const loading = ref(true);
const rows = ref<Row[]>([]);
const running = ref(false);
const stopRequested = ref(false);
const runDone = ref(0);
const runTotal = ref(0);
const applyingAll = ref(false);
const bulkHint = ref('');
/** すべての提案に添える指示 (meta に保存し、登録タブの自動提案にも効く) */
const instructions = ref('');
const savedInstructions = ref('');
const activeIndex = ref(0);
const listEl = shallowRef<HTMLElement | null>(null);
const rowEls = new Map<string, HTMLElement>();
const hintEls = new Map<string, { focus: () => void }>();

const {
	model: target,
	def: targetDef,
} = useMkSelect({
	items: [
		{ label: i18n.ts._emojiTagging.targetNoTags, value: 'noTags' },
		{ label: i18n.ts._emojiTagging.targetFewTags, value: 'fewTags' },
		{ label: i18n.ts._emojiTagging.targetSomeTags, value: 'someTags' },
		{ label: i18n.ts._emojiTagging.targetAll, value: 'all' },
	],
	initialValue: 'fewTags',
});

const categoryFilter = ref<string>(ALL_CATEGORIES);
const categoryFilterDef = computed(() => {
	const categories = [...new Set(rows.value.map(it => it.emoji.category).filter((it): it is string => it != null && it !== ''))].sort((a, b) => a.localeCompare(b, 'ja'));
	return [
		{ label: i18n.ts._emojiTagging.allCategories, value: ALL_CATEGORIES },
		{ label: i18n.ts._emojiTagging.noCategory, value: NO_CATEGORY },
		...categories.map(it => ({ label: it, value: it })),
	];
});

/** 対象とカテゴリで絞った行。反映済みの行も、そのまま見えるよう残す */
const visibleRows = computed(() => rows.value.filter(row => {
	if (row.status !== 'applied' && !matchesTaggingTarget(row.emoji, target.value as EmojiTaggingTarget)) return false;
	if (categoryFilter.value === ALL_CATEGORIES) return true;
	if (categoryFilter.value === NO_CATEGORY) return row.emoji.category == null || row.emoji.category === '';
	return row.emoji.category === categoryFilter.value;
}));
const pendingRows = computed(() => visibleRows.value.filter(row => row.history.length === 0 && row.status === 'idle'));
const selectedRows = computed(() => visibleRows.value.filter(row => row.selected));
const applicableRows = computed(() => visibleRows.value.filter(row => row.status === 'idle' && current(row) != null && hasChanges(row)));

function current(row: Row): EmojiTagSuggestion | null {
	return row.history[row.index] ?? null;
}

function hasChanges(row: Row): boolean {
	const suggestion = current(row);
	if (suggestion == null) return false;
	return suggestion.tags.some(tag => !row.emoji.aliases.includes(tag)) || (row.applyCategory && suggestion.category != null && suggestion.category.name !== row.emoji.category);
}

function setRowEl(id: string, el: Element | ComponentPublicInstance | null) {
	if (el instanceof HTMLElement) rowEls.set(id, el);
	else rowEls.delete(id);
}

function setHintEl(id: string, el: Element | ComponentPublicInstance | null) {
	if (el != null && !(el instanceof Element)) hintEls.set(id, el as unknown as { focus: () => void });
	else hintEls.delete(id);
}

async function loadEmojis() {
	const emojis: Misskey.entities.EmojiDetailed[] = [];
	let untilId: string | undefined;
	for (;;) {
		const page = await misskeyApi('admin/emoji/list', { limit: 100, untilId });
		emojis.push(...page);
		if (page.length < 100) break;
		untilId = page[page.length - 1].id;
	}
	emojis.sort((a, b) => a.name.localeCompare(b.name));
	rows.value = emojis.map(emoji => ({
		emoji,
		history: [],
		index: 0,
		status: 'idle',
		error: null,
		applyCategory: false,
		selected: false,
		hintOpen: false,
		hint: '',
	}));
}

/**
 * 1 つの行の提案をもらう。再提案ではそれまでに出した語を除かせ、ヒントがあれば添える
 */
async function suggestRow(row: Row, hint: string | null) {
	row.status = 'loading';
	row.error = null;
	try {
		const excludedTags = [...new Set(row.history.flatMap(it => it.tags))].slice(-MAX_EXCLUDED_TAGS);
		// 今のタグはサーバーが絵文字から取る (反映した分も入っている)
		const suggestion = await suggestEmojiTags({
			emojiId: row.emoji.id,
			excludedTags,
			hint: hint != null && hint.trim() !== '' ? hint.trim() : null,
		});
		row.history.push(suggestion);
		row.index = row.history.length - 1;
		// カテゴリが無い絵文字だけ、最初からカテゴリも変える
		row.applyCategory = row.emoji.category == null || row.emoji.category === '';
	} catch (err) {
		row.error = emojiTaggingErrorMessage(err);
	} finally {
		row.status = 'idle';
	}
}

async function start() {
	const targets = [...pendingRows.value];
	running.value = true;
	stopRequested.value = false;
	runDone.value = 0;
	runTotal.value = targets.length;
	try {
		await mapWithConcurrency(targets, EMOJI_TAGGING_CONCURRENCY, async row => {
			if (stopRequested.value) return;
			await suggestRow(row, null);
			runDone.value++;
		});
	} finally {
		running.value = false;
	}
}

function stop() {
	stopRequested.value = true;
}

async function resuggest(row: Row) {
	if (row.status === 'loading' || row.status === 'applying') return;
	if (row.status === 'applied') row.status = 'idle';
	await suggestRow(row, row.hintOpen ? row.hint : null);
}

async function resuggestSelected() {
	const targets = selectedRows.value.filter(row => row.status !== 'loading' && row.status !== 'applying');
	await mapWithConcurrency(targets, EMOJI_TAGGING_CONCURRENCY, async row => {
		if (row.status === 'applied') row.status = 'idle';
		await suggestRow(row, bulkHint.value);
		row.selected = false;
	});
}

async function openHint(row: Row) {
	row.hintOpen = true;
	await nextTick();
	hintEls.get(row.emoji.id)?.focus();
}

function moveHistory(row: Row, delta: number) {
	row.index = Math.min(Math.max(row.index + delta, 0), row.history.length - 1);
}

/**
 * 提案を反映する。タグは今のタグに足すだけで、今のタグは消さない
 */
async function apply(row: Row): Promise<boolean> {
	const suggestion = current(row);
	if (suggestion == null || row.status !== 'idle') return false;
	row.status = 'applying';
	row.error = null;
	try {
		const newTags = suggestion.tags.filter(tag => !row.emoji.aliases.includes(tag));
		if (newTags.length > 0) {
			await misskeyApi('admin/emoji/add-aliases-bulk', { ids: [row.emoji.id], aliases: newTags });
			row.emoji.aliases = mergeTags(row.emoji.aliases, newTags);
		}
		const category = suggestion.category;
		if (row.applyCategory && category != null && category.name !== row.emoji.category) {
			await misskeyApi('admin/emoji/set-category-bulk', { ids: [row.emoji.id], category: category.name });
			row.emoji.category = category.name;
		}
		row.status = 'applied';
		return true;
	} catch (err) {
		row.status = 'idle';
		row.error = typeof err === 'object' && err != null && 'message' in err ? String(err.message) : i18n.ts.somethingHappened;
		return false;
	}
}

async function applyAll() {
	applyingAll.value = true;
	try {
		const results = await mapWithConcurrency([...applicableRows.value], EMOJI_TAGGING_CONCURRENCY, apply);
		if (results.some(ok => !ok)) {
			os.alert({ type: 'error', text: i18n.ts.somethingHappened });
		}
	} finally {
		applyingAll.value = false;
	}
}

async function moveActive(delta: number) {
	if (visibleRows.value.length === 0) return;
	activeIndex.value = Math.min(Math.max(activeIndex.value + delta, 0), visibleRows.value.length - 1);
	await nextTick();
	const row = visibleRows.value[activeIndex.value];
	rowEls.get(row.emoji.id)?.scrollIntoView({ block: 'nearest' });
}

async function onKeydown(ev: KeyboardEvent) {
	// ヒントの欄に入力しているときやボタンを押すときは、行の操作にしない
	const el = ev.target as HTMLElement | null;
	if (el != null && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.closest('button, a, [role="button"]') != null || el.isContentEditable)) {
		if (ev.key === 'Escape') listEl.value?.focus();
		return;
	}
	if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

	const row = visibleRows.value[activeIndex.value] as Row | undefined;
	switch (ev.key) {
		case 'j':
		case 'ArrowDown':
			ev.preventDefault();
			await moveActive(1);
			break;
		case 'k':
		case 'ArrowUp':
			ev.preventDefault();
			await moveActive(-1);
			break;
		case 'r':
			if (row == null) return;
			ev.preventDefault();
			await resuggest(row);
			break;
		case 'h':
			if (row == null) return;
			ev.preventDefault();
			await openHint(row);
			break;
		case 'ArrowLeft':
			if (row == null) return;
			ev.preventDefault();
			moveHistory(row, -1);
			break;
		case 'ArrowRight':
			if (row == null) return;
			ev.preventDefault();
			moveHistory(row, 1);
			break;
		case 'x':
			if (row == null) return;
			ev.preventDefault();
			row.selected = !row.selected;
			break;
		case 'Enter':
			if (row == null) return;
			ev.preventDefault();
			if (await apply(row)) await moveActive(1);
			break;
	}
}

async function loadInstructions() {
	const meta = await misskeyApi('admin/meta');
	savedInstructions.value = meta.anthropicEmojiTaggingInstructions ?? '';
	instructions.value = savedInstructions.value;
}

async function saveInstructions() {
	const value = instructions.value.trim();
	await os.apiWithDialog('admin/update-meta', { anthropicEmojiTaggingInstructions: value });
	savedInstructions.value = value;
	instructions.value = value;
}

onMounted(async () => {
	available.value = await isEmojiTaggingAvailable();
	if (!available.value) return;
	try {
		await Promise.all([loadEmojis(), loadInstructions()]);
	} finally {
		loading.value = false;
	}
});
</script>

<style lang="scss" module>
.toolbar {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	gap: 12px;
}

.toolbarSelect {
	flex: 1 1 180px;
	min-width: 0;
	margin: 0;
}

.toolbarButtons {
	display: flex;
	gap: 8px;
}

.progress {
	display: flex;
	align-items: center;
	gap: 12px;
	font-size: 0.85em;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.75);
	font-variant-numeric: tabular-nums;
}

.progressBar {
	flex: 1;
	height: 6px;
	border-radius: 999px;
	background: var(--MI_THEME-buttonBg);
	overflow: hidden;
}

.progressFill {
	height: 100%;
	background: var(--MI_THEME-accent);
	transition: width 0.2s ease;
}

.bulkBar {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	padding: 8px 12px;
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-accentedBg);
	font-size: 0.9em;
}

.bulkHint {
	flex: 1 1 200px;
	min-width: 0;
}

.empty {
	padding: 32px;
	text-align: center;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.75);
}

.list {
	display: flex;
	flex-direction: column;
	gap: 8px;
	outline: none;
}

.row {
	display: grid;
	grid-template-columns: auto 48px 1fr;
	gap: 12px;
	padding: 12px;
	border: solid 1px var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-panel);

	&.active {
		border-color: var(--MI_THEME-accent);
	}

	&.applied {
		opacity: 0.7;
	}
}

.list:focus-visible .row.active {
	box-shadow: 0 0 0 2px var(--MI_THEME-focus);
}

.check {
	display: flex;
	align-items: flex-start;
	padding-top: 14px;
}

.img {
	width: 48px;
	height: 48px;
	object-fit: contain;
	border-radius: 8px;
	background: var(--MI_THEME-bg);
}

.body {
	display: flex;
	flex-direction: column;
	gap: 8px;
	min-width: 0;
}

.head {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}

.name {
	font-family: Fira code, Fira Mono, Consolas, Menlo, Courier, monospace;
	font-weight: bold;
	overflow-wrap: anywhere;
}

.history {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	font-size: 0.85em;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.75);
	font-variant-numeric: tabular-nums;

	button {
		padding: 2px 4px;

		&:disabled {
			opacity: 0.4;
		}
	}
}

.rowButtons {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin-left: auto;
}

.appliedLabel {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	font-size: 0.85em;
	color: var(--MI_THEME-success);
}

.chips {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px;
}

.chipsLabel {
	font-size: 0.8em;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.75);
}

.chip {
	padding: 2px 10px;
	border-radius: 999px;
	border: solid 1px transparent;
	background: var(--MI_THEME-accentedBg);
	font-size: 0.85em;
	white-space: nowrap;
}

.chipCurrent {
	background: transparent;
	border-color: var(--MI_THEME-divider);
}

.category {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 12px;
	font-size: 0.9em;
}

.newBadge {
	margin-left: 6px;
	padding: 0 6px;
	border-radius: 4px;
	background: var(--MI_THEME-infoWarnBg);
	color: var(--MI_THEME-infoWarnFg);
	font-size: 0.8em;
}

.hintBox {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	gap: 8px;
}

.hintInput {
	flex: 1 1 220px;
	min-width: 0;
}

.note {
	font-size: 0.85em;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.75);
}

.error {
	font-size: 0.85em;
	color: var(--MI_THEME-error);
}

.footer {
	position: sticky;
	bottom: 0;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 12px 0;
	background: var(--MI_THEME-bg);
}

.keys {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 14px;
	font-size: 0.8em;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.75);

	kbd {
		padding: 0 5px;
		border: solid 1px var(--MI_THEME-divider);
		border-bottom-width: 2px;
		border-radius: 4px;
		font-family: Fira code, Fira Mono, Consolas, Menlo, Courier, monospace;
		font-size: 0.95em;
	}
}
</style>
