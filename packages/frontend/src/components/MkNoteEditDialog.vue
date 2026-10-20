<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="520"
	:height="560"
	:withOkButton="true"
	:okButtonDisabled="!canSave"
	@close="dialog?.close()"
	@ok="save"
	@closed="emit('closed')"
>
	<template #header>{{ i18n.ts.edit }}</template>

	<div class="_spacer" style="--MI_SPACER-min: 16px; --MI_SPACER-max: 20px;">
		<div class="_gaps_m">
			<MkInput v-model="cw" :mfmAutocomplete="true" :placeholder="i18n.ts.annotation">
				<template #label>{{ i18n.ts.annotation }}</template>
			</MkInput>
			<MkTextarea v-model="text" :mfmAutocomplete="true" :mfmPreview="true" tall>
				<template #label>{{ i18n.ts.text }}</template>
				<template #caption><span :class="{ [$style.over]: textLength > maxTextLength }">{{ maxTextLength - textLength }}</span></template>
			</MkTextarea>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
// 42times: 自分のノートの本文と CW を編集するダイアログ。保存できたら done で更新後のノートを返す。
// 開くときは utility/note-edit.ts の openNoteEditDialog を使う
import { computed, ref, useTemplateRef } from 'vue';
import type * as Misskey from 'misskey-js';
import MkInput from '@/components/MkInput.vue';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { instance } from '@/instance.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const props = defineProps<{
	note: Misskey.entities.Note;
}>();

const emit = defineEmits<{
	(ev: 'done', note: Misskey.entities.Note): void;
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

const text = ref(props.note.text ?? '');
const cw = ref(props.note.cw ?? '');
const saving = ref(false);

const maxTextLength = instance.maxNoteTextLength;
/** notes/update の CW の上限 */
const MAX_CW_LENGTH = 100;
const textLength = computed(() => text.value.length);

// 空欄は「無し」として送る (CW を消すときは欄を空にする)
const newText = computed(() => text.value.trim() === '' ? null : text.value);
const newCw = computed(() => cw.value.trim() === '' ? null : cw.value);

const canSave = computed(() =>
	!saving.value &&
	textLength.value <= maxTextLength &&
	(newCw.value == null || newCw.value.length <= MAX_CW_LENGTH) &&
	(newText.value !== props.note.text || newCw.value !== (props.note.cw ?? null)),
);

async function save() {
	if (!canSave.value) return;
	saving.value = true;
	try {
		const updated = await misskeyApi('notes/update', {
			noteId: props.note.id,
			text: newText.value,
			cw: newCw.value,
		});
		emit('done', updated);
		dialog.value?.close();
	} catch (err) {
		os.alert({
			type: 'error',
			text: (err as Misskey.api.APIError).code === 'EMPTY_NOTE' ? i18n.ts.noteEditEmpty : (err as Error).message,
		});
	} finally {
		saving.value = false;
	}
}
</script>

<style lang="scss" module>
.over {
	color: var(--MI_THEME-error);
}
</style>
