<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="520"
	:height="600"
	@close="dialog?.close()"
	@closed="emit('closed')"
>
	<template #header>{{ i18n.ts.noteEditHistory }}</template>

	<div class="_spacer" style="--MI_SPACER-min: 16px; --MI_SPACER-max: 20px;">
		<MkError v-if="fetchError" @retry="fetchHistory()"/>
		<MkLoading v-else-if="histories == null"/>
		<div v-else :class="$style.versions">
			<div v-for="v in versions" :key="v.key" :class="$style.version">
				<div :class="$style.head">
					<MkTime :time="v.createdAt" mode="detail"/>
					<span v-if="v.label" :class="$style.label">{{ v.label }}</span>
				</div>
				<p v-if="v.cw != null" :class="$style.cw">
					<Mfm v-if="v.cw != ''" :text="v.cw" :author="note.user" :nyaize="'respect'"/>
				</p>
				<Mfm v-if="v.text" :text="v.text" :author="note.user" :nyaize="'respect'"/>
			</div>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
// 42times: ノートの編集履歴を新しい順に出すダイアログ。いまの版を先頭に、編集する前の版を続ける。
// 開くときは utility/note-edit.ts の openNoteHistoryDialog を使う
import { computed, shallowRef, ref, useTemplateRef } from 'vue';
import type * as Misskey from 'misskey-js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const props = defineProps<{
	note: Misskey.entities.Note;
}>();

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

const histories = shallowRef<Misskey.entities.NotesHistoryResponse | null>(null);
const fetchError = ref(false);

const versions = computed(() => {
	if (histories.value == null) return [];
	const past = histories.value.map((h, i) => ({
		key: h.id,
		text: h.text,
		cw: h.cw,
		createdAt: h.createdAt,
		label: i === histories.value!.length - 1 ? i18n.ts.noteEditHistoryOriginal : null,
	}));
	return [{
		key: '_current_',
		text: props.note.text,
		cw: props.note.cw ?? null,
		createdAt: props.note.updatedAt ?? props.note.createdAt,
		label: i18n.ts.noteEditHistoryCurrent,
	}, ...past];
});

async function fetchHistory() {
	fetchError.value = false;
	histories.value = null;
	try {
		histories.value = await misskeyApi('notes/history', { noteId: props.note.id });
	} catch {
		fetchError.value = true;
	}
}

fetchHistory();
</script>

<style lang="scss" module>
.versions {
	display: flex;
	flex-direction: column;
	border-radius: 8px;
	overflow: clip;
	background: var(--MI_THEME-panel);
}

.version {
	padding: 12px 14px;
	overflow-wrap: break-word;

	& + & {
		border-top: solid 0.5px var(--MI_THEME-divider);
	}
}

.head {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-bottom: 4px;
	font-size: 0.85em;
	opacity: 0.7;
}

.label {
	padding: 0 6px;
	border: solid 1px var(--MI_THEME-divider);
	border-radius: 4px;
}

.cw {
	margin: 0 0 4px;
	font-weight: bold;
}
</style>
