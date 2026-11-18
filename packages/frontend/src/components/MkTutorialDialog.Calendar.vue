<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps">
	<div style="text-align: center; padding: 0 16px;">{{ i18n.ts._initialTutorial._calendar.description }}</div>
	<div class="_gaps_s">
		<!-- 練習用のカード (MkNoteCalendarEvent と同じ見た目)。API は呼ばない -->
		<div :class="$style.event">
			<div :class="$style.dateBox" role="img" :aria-label="formatCalendarDay(exampleDateString)">
				<span>{{ i18n.tsx.monthX({ month: exampleDate.month }) }}</span>
				<b>{{ exampleDate.day }}</b>
				<span>{{ getWeekdayShortLabel(exampleWeekday) }}</span>
			</div>
			<div :class="$style.info">
				<b :class="$style.title">{{ i18n.ts._initialTutorial._calendar._exampleEvent.title }}</b>
				<small :class="$style.meta">{{ metaText }}</small>
			</div>
			<!-- 押した後もフォーカスが残るよう、ボタンは差し替えずに中身だけ変える -->
			<MkButton :primary="subscribed" rounded small :aria-pressed="subscribed" @click="subscribed = !subscribed">
				<template v-if="subscribed"><i class="ti ti-bell-ringing"></i> {{ i18n.ts._calendar.subscribed }}</template>
				<template v-else><i class="ti ti-bell"></i> {{ i18n.ts._calendar.subscribe }}</template>
			</MkButton>
		</div>
		<div v-if="subscribed" :class="$style.hint"><b style="color: var(--MI_THEME-accent);"><i class="ti ti-check"></i> {{ i18n.ts._initialTutorial.wellDone }}</b> {{ i18n.ts._initialTutorial._calendar.subscribed }}</div>
		<div v-else :class="$style.hint">{{ i18n.ts._initialTutorial._calendar.trySubscribing }}</div>
	</div>
	<div class="_gaps_s">
		<div><i class="ti ti-calendar-plus"></i> <b>{{ i18n.ts._initialTutorial._calendar.create }}</b> … {{ i18n.ts._initialTutorial._calendar.createDescription }}</div>
		<div><i class="ti ti-bell"></i> <b>{{ i18n.ts._initialTutorial._calendar.subscribe }}</b> … {{ i18n.ts._initialTutorial._calendar.subscribeDescription }}</div>
		<div><i class="ti ti-link"></i> <b>{{ i18n.ts._initialTutorial._calendar.feed }}</b> … {{ i18n.ts._initialTutorial._calendar.feedDescription }}</div>
	</div>
	<div :class="$style.divider"></div>
	<div style="text-align: center; padding: 0 16px;"><i class="ti ti-calendar"></i> {{ i18n.ts._initialTutorial._calendar.whereToOpen }}</div>
</div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n.js';
import { addDays, dayOfWeek, parseCalendarDate, toJstDateString } from '@/utility/calendar.js';
import { formatCalendarDay, formatCalendarEventTime, getWeekdayShortLabel } from '@/utility/calendar-event-messages.js';

// 例のイベントは 1 週間後にする (過去の日付だと購読の説明と合わない)
const exampleDateString = addDays(toJstDateString(new Date()), 7);
const exampleDate = parseCalendarDate(exampleDateString) ?? { year: 0, month: 0, day: 0 };
const exampleWeekday = dayOfWeek(exampleDateString);

const subscribed = ref(false);

const metaText = computed(() => [
	formatCalendarEventTime({ isAllDay: false, startTime: '19:00', endTime: '21:00' }),
	i18n.ts._initialTutorial._calendar._exampleEvent.location,
	i18n.tsx._calendar.subscribersShort({ n: subscribed.value ? 13 : 12 }),
].join(' ・ '));
</script>

<style lang="scss" module>
.event {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 12px;
	border: solid 0.5px var(--MI_THEME-divider);
	border-radius: 8px;
	background: var(--MI_THEME-panel);
}

.dateBox {
	width: 44px;
	flex: none;
	text-align: center;
	border-radius: 8px;
	background: var(--MI_THEME-buttonBg);
	padding: 3px 0;
	font-size: 0.75em;
	line-height: 1.25;

	> b {
		display: block;
		font-size: 1.5em;
	}
}

.info {
	flex: 1;
	min-width: 0;
}

.title {
	display: block;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.meta {
	display: block;
	font-size: 0.85em;
	opacity: 0.7;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.hint {
	text-align: center;
	font-size: 0.9em;
}

.divider {
	height: 1px;
	background: var(--MI_THEME-divider);
}
</style>
