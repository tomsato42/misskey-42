<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<button class="_textButton" :class="$style.toggle" :aria-expanded="opened" @click="opened = !opened">
		<i :class="opened ? 'ti ti-chevron-down' : 'ti ti-chevron-right'"></i>
		{{ i18n.ts.noteEditHistory }}<template v-if="histories != null"> ({{ histories.length }})</template>
	</button>
	<div v-if="opened" :class="$style.body">
		<MkError v-if="fetchError" @retry="fetchHistory()"/>
		<MkLoading v-else-if="histories == null" :em="true"/>
		<template v-else>
			<div v-for="(h, i) in histories" :key="h.id" :class="$style.version">
				<div :class="$style.head">
					<MkTime :time="h.createdAt" mode="detail"/>
					<span v-if="i === histories.length - 1" :class="$style.label">{{ i18n.ts.noteEditHistoryOriginal }}</span>
				</div>
				<p v-if="h.cw != null" :class="$style.cw">
					<Mfm v-if="h.cw != ''" :text="h.cw" :author="note.user" :nyaize="'respect'"/>
				</p>
				<Mfm v-if="h.text" :text="h.text" :author="note.user" :nyaize="'respect'"/>
			</div>
		</template>
	</div>
</div>
</template>

<script lang="ts" setup>
// 42times: ノートの詳細ページで、本文の下に編集する前の版を新しい順に出す (折りたたみ)。
// updatedAt が変わったら (その場で編集されたら) 取り直す
import { ref, shallowRef, watch } from 'vue';
import type * as Misskey from 'misskey-js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const props = defineProps<{
	note: Misskey.entities.Note;
	updatedAt: string;
}>();

const opened = ref(false);
const histories = shallowRef<Misskey.entities.NotesHistoryResponse | null>(null);
const fetchError = ref(false);

async function fetchHistory() {
	fetchError.value = false;
	histories.value = null;
	try {
		histories.value = await misskeyApi('notes/history', { noteId: props.note.id });
	} catch {
		fetchError.value = true;
	}
}

watch(() => props.updatedAt, fetchHistory, { immediate: true });
</script>

<style lang="scss" module>
.root {
	margin: -8px 0 16px;
	font-size: 0.9em;
}

.toggle {
	opacity: 0.7;
}

.body {
	margin-top: 8px;
	border-left: solid 2px var(--MI_THEME-divider);
	padding-left: 12px;
}

.version {
	padding: 6px 0;
	overflow-wrap: break-word;

	& + & {
		border-top: solid 0.5px var(--MI_THEME-divider);
	}
}

.head {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-bottom: 2px;
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
