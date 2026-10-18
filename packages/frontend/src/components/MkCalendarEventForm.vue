<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.container">
<div :class="$style.root">
	<MkInput v-model="title" :class="$style.full" :disabled="disabled" :autofocus="autofocus">
		<template #label>{{ i18n.ts._calendar.eventTitle }}</template>
		<template v-if="errors.title" #caption><span :class="$style.error" role="alert"><i class="ti ti-alert-triangle"></i> {{ getCalendarEventValidationMessage(errors.title) }}</span></template>
	</MkInput>

	<MkInput v-model="date" type="date" :disabled="disabled">
		<template #label>{{ i18n.ts._calendar.date }}</template>
		<template v-if="errors.date" #caption><span :class="$style.error" role="alert"><i class="ti ti-alert-triangle"></i> {{ getCalendarEventValidationMessage(errors.date) }}</span></template>
	</MkInput>
	<div :class="$style.allDay">
		<MkSwitch v-model="isAllDay" :disabled="disabled">{{ i18n.ts._calendar.allDay }}</MkSwitch>
	</div>

	<template v-if="!isAllDay">
		<MkInput v-model="startTime" type="time" :disabled="disabled">
			<template #label>{{ i18n.ts._calendar.startTime }}</template>
			<template v-if="errors.startTime" #caption><span :class="$style.error" role="alert"><i class="ti ti-alert-triangle"></i> {{ getCalendarEventValidationMessage(errors.startTime) }}</span></template>
		</MkInput>
		<MkInput v-model="endTime" type="time" :disabled="disabled">
			<template #label>{{ i18n.ts._calendar.endTime }}</template>
			<template #caption>
				<span v-if="errors.endTime" :class="$style.error" role="alert"><i class="ti ti-alert-triangle"></i> {{ getCalendarEventValidationMessage(errors.endTime) }}</span>
				<span v-else>{{ i18n.ts._calendar.endTimeDescription }}</span>
			</template>
		</MkInput>
	</template>

	<MkInput v-model="location" :disabled="disabled">
		<template #label>{{ i18n.ts.location }}</template>
		<template v-if="errors.location" #caption><span :class="$style.error" role="alert"><i class="ti ti-alert-triangle"></i> {{ getCalendarEventValidationMessage(errors.location) }}</span></template>
	</MkInput>
	<MkInput v-model="hashtag" :disabled="disabled" autocapitalize="off" :spellcheck="false">
		<template #label>{{ i18n.ts._calendar.hashtag }}</template>
		<template #prefix>#</template>
		<template #caption>
			<span v-if="errors.hashtag" :class="$style.error" role="alert"><i class="ti ti-alert-triangle"></i> {{ getCalendarEventValidationMessage(errors.hashtag) }}</span>
			<span v-else>{{ i18n.ts._calendar.hashtagDescription }}</span>
		</template>
	</MkInput>

	<MkTextarea v-if="withDescription" v-model="description" :class="$style.full" :disabled="disabled" mfmAutocomplete :mfmPreview="true">
		<template #label>{{ i18n.ts.description }}</template>
		<template v-if="errors.description" #caption><span :class="$style.error" role="alert"><i class="ti ti-alert-triangle"></i> {{ getCalendarEventValidationMessage(errors.description) }}</span></template>
	</MkTextarea>
</div>
</div>
</template>

<script lang="ts" setup>
// イベントの入力欄。値は v-model (CalendarEventFormValue) でやり取りし、送信や API の呼び出しは使う側が行う。
// カレンダーの作成・編集ダイアログ (MkCalendarEventEditDialog) と、投稿フォームの「イベントを告知」の欄で使う
import { computed } from 'vue';
import type { WritableComputedRef } from 'vue';
import type { CalendarEventFormErrors, CalendarEventFormValue } from '@/utility/calendar-event-form.js';
import MkInput from '@/components/MkInput.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import { i18n } from '@/i18n.js';
import { getCalendarEventValidationMessage } from '@/utility/calendar-event-messages.js';

const model = defineModel<CalendarEventFormValue>({ required: true });

withDefaults(defineProps<{
	/** 欄ごとの検証エラー。欄の下に文言を出す */
	errors?: CalendarEventFormErrors;
	/** 説明の欄を出すか。投稿フォームではノートの本文が説明になるので出さない */
	withDescription?: boolean;
	disabled?: boolean;
	autofocus?: boolean;
}>(), {
	errors: () => ({}),
	withDescription: true,
	disabled: false,
	autofocus: false,
});

// 親から受け取ったオブジェクトを直接書き換えず、項目を差し替えた新しいオブジェクトを返す
function field<K extends keyof CalendarEventFormValue>(key: K): WritableComputedRef<CalendarEventFormValue[K]> {
	return computed({
		get: () => model.value[key],
		set: (value) => {
			model.value = { ...model.value, [key]: value };
		},
	});
}

const title = field('title');
const date = field('date');
const startTime = field('startTime');
const endTime = field('endTime');
const isAllDay = field('isAllDay');
const location = field('location');
const hashtag = field('hashtag');
const description = field('description');
</script>

<style lang="scss" module>
.container {
	// 狭い場所 (スマホの投稿フォームなど) では 1 列にする
	container-type: inline-size;
}

.root {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 16px 12px;
	align-items: start;
}

.full {
	grid-column: 1 / -1;
}

.allDay {
	// 日付の欄の入力部分と高さをそろえる (ラベルの分だけ下げる)
	align-self: end;
	min-height: 36px;
	display: flex;
	align-items: center;
}

.error {
	color: var(--MI_THEME-error);
}

@container (max-width: 320px) {
	.root {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
