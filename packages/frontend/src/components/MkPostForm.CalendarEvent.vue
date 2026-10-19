<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<MkInfo v-if="unavailableReason === 'specified'" warn>{{ i18n.ts._calendar.unavailableForSpecified }}</MkInfo>
	<MkInfo v-else-if="unavailableReason === 'scheduled'" warn>{{ i18n.ts._calendar.unavailableForScheduled }}</MkInfo>

	<section v-if="form != null" :class="[$style.announce, { [$style.inactive]: unavailableReason != null }]" :aria-label="i18n.ts._calendar.announceEvent">
		<div :class="$style.announceTitle">
			<i class="ti ti-speakerphone" aria-hidden="true"></i>
			<span>{{ i18n.ts._calendar.announceEvent }}</span>
			<button v-tooltip="i18n.ts._calendar.stopAnnouncing" type="button" class="_button" :class="$style.close" :aria-label="i18n.ts._calendar.stopAnnouncing" :disabled="disabled" @click="emit('stopAnnouncing')"><i class="ti ti-x"></i></button>
		</div>
		<MkCalendarEventForm v-model="formModel" :errors="errors" :withDescription="false" :visibilityLabel="i18n.ts._calendar.eventVisibility" :disabled="disabled || unavailableReason != null" autofocus/>
		<MkInfo v-if="isNarrowerThanNote" warn>
			<span :class="$style.narrower">
				<span>{{ i18n.tsx._calendar.narrowerThanNote({ note: noteVisibilityLabel, event: getCalendarVisibilityLabel(form.visibility) }) }}</span>
				<button type="button" class="_button" :class="$style.matchNote" :disabled="disabled" @click="matchNoteVisibility">{{ i18n.ts._calendar.matchNoteVisibility }}</button>
			</span>
		</MkInfo>
	</section>

	<div v-else-if="linkedEvent != null" :class="[$style.linked, { [$style.inactive]: unavailableReason != null }]">
		<i class="ti ti-calendar-event" :class="$style.linkedIcon" aria-hidden="true"></i>
		<span :class="$style.linkedText">
			<I18n :src="i18n.ts._calendar.linkedToEvent" tag="span">
				<template #event>
					<b>{{ linkedEvent.title }}</b> ・ {{ formatCalendarSchedule(linkedEvent) }}
				</template>
			</I18n>
		</span>
		<button v-tooltip="i18n.ts._calendar.unlinkEvent" type="button" class="_button" :class="$style.close" :aria-label="i18n.ts._calendar.unlinkEvent" :disabled="disabled" @click="emit('unlink')"><i class="ti ti-x"></i></button>
	</div>
</div>
</template>

<script lang="ts" setup>
// 投稿フォームの「イベントを告知」の欄と、紐づけたイベントの表示。状態は MkPostForm が持つ
import { computed } from 'vue';
import * as Misskey from 'misskey-js';
import type { CalendarEventFormErrors, CalendarEventFormValue } from '@/utility/calendar-event-form.js';
import type { CalendarNoteFormUnavailableReason } from '@/utility/calendar-note.js';
import MkInfo from '@/components/MkInfo.vue';
import MkCalendarEventForm from '@/components/MkCalendarEventForm.vue';
import { i18n } from '@/i18n.js';
import { clearChangedCalendarEventFormErrors } from '@/utility/calendar-event-form.js';
import { formatCalendarSchedule, getCalendarVisibilityLabel, getNoteVisibilityLabel } from '@/utility/calendar-event-messages.js';
import { isCalendarVisibilityNarrowerThanNote, noteVisibilityToCalendarVisibility } from '@/utility/calendar-visibility.js';

/** 告知するイベントの入力。告知していないときは null */
const form = defineModel<CalendarEventFormValue | null>('form', { required: true });
const errors = defineModel<CalendarEventFormErrors>('errors', { required: true });

const props = defineProps<{
	/** 紐づけるイベント。告知しているときは使わない */
	linkedEvent: Misskey.entities.CalendarEventLite | null;
	/** イベントを扱えない理由 (ダイレクト・予約投稿)。あるときは欄を無効にして注意書きを出す */
	unavailableReason: CalendarNoteFormUnavailableReason | null;
	/** ノートの公開範囲 (イベントの公開範囲がノートより狭いときに注意を出す) */
	noteVisibility: typeof Misskey.noteVisibilities[number];
	disabled?: boolean;
}>();

const emit = defineEmits<{
	(ev: 'stopAnnouncing'): void;
	(ev: 'unlink'): void;
}>();

const noteVisibilityLabel = computed(() => getNoteVisibilityLabel(props.noteVisibility));

// ノートは見えるがイベントは見えない人がいるとき (その人にはイベントのカードが出ない)
const isNarrowerThanNote = computed(() => form.value != null && props.unavailableReason == null && isCalendarVisibilityNarrowerThanNote(form.value.visibility, props.noteVisibility));

function matchNoteVisibility() {
	if (form.value == null) return;
	form.value = { ...form.value, visibility: noteVisibilityToCalendarVisibility(props.noteVisibility) };
}

// 入力し直した欄のエラーは消す
const formModel = computed<CalendarEventFormValue>({
	get: () => form.value!,
	set: (next) => {
		if (form.value != null) errors.value = clearChangedCalendarEventFormErrors(errors.value, form.value, next);
		form.value = next;
	},
});
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin: 0 16px 12px 16px;
}

.announce {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 12px;
	border: solid 0.5px var(--MI_THEME-divider);
	border-radius: 8px;
}

.announceTitle {
	display: flex;
	align-items: center;
	gap: 6px;
	font-weight: bold;
	font-size: 0.9em;
}

.close {
	margin-left: auto;
	padding: 4px 6px;
	border-radius: 6px;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}
}

.linked {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 10px 12px;
	border-radius: 8px;
	background: var(--MI_THEME-folderHeaderBg);
	font-size: 0.9em;
}

.linkedIcon {
	flex: none;
}

.linkedText {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.inactive {
	opacity: 0.6;
}

.narrower {
	display: flex;
	align-items: flex-start;
	gap: 8px;
}

.matchNote {
	flex: none;
	font-weight: bold;

	&:hover {
		text-decoration: underline;
	}
}

@container (max-width: 500px) {
	.root {
		margin: 0 8px 8px 8px;
	}
}
</style>
