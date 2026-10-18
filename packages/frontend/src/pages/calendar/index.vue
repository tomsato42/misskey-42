<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader v-model:tab="tab" :actions="headerActions" :tabs="headerTabs" :swipable="false">
	<div class="_spacer" style="--MI_SPACER-w: 1000px;">
		<div :class="$style.head">
			<MkButton small iconOnly :aria-label="i18n.ts._calendar.prevMonth" @click="goMonth(-1)"><i class="ti ti-chevron-left"></i></MkButton>
			<span :class="$style.month">{{ formatCalendarYearMonth(currentMonth) }}</span>
			<MkButton small iconOnly :aria-label="i18n.ts._calendar.nextMonth" @click="goMonth(1)"><i class="ti ti-chevron-right"></i></MkButton>
			<MkButton small rounded :disabled="currentMonth === todayMonth" @click="goToday">{{ i18n.ts.today }}</MkButton>
			<span :class="$style.grow"></span>
			<MkButton primary rounded :class="$style.create" @click="createEvent()"><i class="ti ti-plus"></i> {{ i18n.ts._calendar.createEvent }}</MkButton>
		</div>

		<MkError v-if="error" @retry="fetchEvents()"/>

		<div class="_panel" :class="[$style.panel, { [$style.fetching]: fetching }]">
			<div :class="$style.grid">
				<div
					v-for="dow in 7"
					:key="`dow-${dow}`"
					:class="[$style.dow, { [$style.sunday]: dow === 1 }]"
					aria-hidden="true"
				>
					{{ getWeekdayShortLabel(dow - 1) }}
				</div>
				<!-- セルを押すとその日のイベントの一覧を出す。キーボードでは日付のボタンで同じ操作ができる -->
				<div
					v-for="day in days"
					:key="day.date"
					:class="[$style.cell, { [$style.out]: !day.inMonth, [$style.today]: day.date === today }]"
					@click="openDayMenu(day.date, $event)"
				>
					<button
						class="_button"
						:class="$style.dayNumber"
						:aria-label="formatCalendarDay(day.date)"
						@click.stop="openDayMenu(day.date, $event)"
					>
						{{ day.day }}
					</button>
					<MkA
						v-for="event in visibleEvents(day.date)"
						:key="event.id"
						:to="`/calendar/events/${event.id}`"
						:class="[$style.chip, { [$style.subscribed]: event.isSubscribed, [$style.canceled]: event.isCanceled }]"
						:title="chipTitle(event)"
						@click.stop
					>
						<span :class="$style.chipTime">{{ event.isAllDay ? i18n.ts._calendar.allDay : event.startTime }}</span>
						<span>{{ event.title }}</span>
					</MkA>
					<button
						v-if="hiddenCount(day.date) > 0"
						class="_button"
						:class="$style.more"
						@click.stop="openDayMenu(day.date, $event)"
					>
						{{ i18n.tsx._calendar.moreEvents({ n: hiddenCount(day.date) }) }}
					</button>
				</div>
			</div>
		</div>

		<div :class="$style.legend">
			<span><i :class="[$style.legendMark, $style.subscribed]"></i>{{ i18n.ts._calendar.subscribed }}</span>
			<span><i :class="$style.legendMark"></i>{{ i18n.ts._calendar.notSubscribed }}</span>
			<span><i :class="[$style.legendMark, $style.canceled]"></i><s>{{ i18n.ts._calendar.canceled }}</s></span>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onActivated, ref } from 'vue';
import * as Misskey from 'misskey-js';
import type { MenuItem } from '@/types/menu.js';
import type { PageHeaderItem } from '@/types/page-header.js';
import MkButton from '@/components/MkButton.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { useRouter } from '@/router.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import {
	buildMonthGrid,
	calendarFilters,
	currentJstYearMonth,
	groupCalendarEventsByDate,
	parseYearMonth,
	shiftYearMonth,
	toJstDateString,
} from '@/utility/calendar.js';
import type { CalendarFilter } from '@/utility/calendar.js';
import { formatCalendarDay, formatCalendarEventTime, formatCalendarYearMonth, getWeekdayShortLabel } from '@/utility/calendar-event-messages.js';
import { openCalendarEventEditDialog } from '@/utility/calendar-event-dialog.js';

/** セルに出すイベントの数。これより多い日は「他 N 件」にまとめる */
const MAX_CHIPS_PER_DAY = 3;

// 表示する月とタブは URL のクエリで持つ (変えると router.replace でページを開き直す)
const props = defineProps<{
	month?: string;
	filter?: string;
}>();

const router = useRouter();

const today = toJstDateString(new Date());
const todayMonth = currentJstYearMonth();
const currentMonth = computed(() => parseYearMonth(props.month) != null ? props.month! : todayMonth);
const currentFilter = computed<CalendarFilter>(() => (calendarFilters as readonly string[]).includes(props.filter ?? '') ? props.filter as CalendarFilter : 'all');

function navigate(month: string, filter: CalendarFilter) {
	router.replace('/calendar', {
		query: filter === 'all' ? { month } : { month, filter },
	});
}

const tab = computed<string>({
	get: () => currentFilter.value,
	set: (value) => {
		if (value === currentFilter.value) return;
		navigate(currentMonth.value, value as CalendarFilter);
	},
});

function goMonth(delta: number) {
	navigate(shiftYearMonth(currentMonth.value, delta), currentFilter.value);
}

function goToday() {
	navigate(todayMonth, currentFilter.value);
}

const days = computed(() => buildMonthGrid(currentMonth.value));

const events = ref<Misskey.entities.CalendarEvent[]>([]);
const fetching = ref(true);
const error = ref(false);
let fetchCount = 0;

async function fetchEvents() {
	const id = ++fetchCount;
	fetching.value = true;
	error.value = false;
	try {
		const res = await misskeyApi('calendar/events/list', {
			month: currentMonth.value,
			filter: currentFilter.value,
		});
		if (id !== fetchCount) return;
		events.value = res;
	} catch {
		if (id !== fetchCount) return;
		error.value = true;
	} finally {
		if (id === fetchCount) fetching.value = false;
	}
}

fetchEvents();

// ページのキャッシュから戻ったとき (イベントページで購読したあとなど) は読み直す。最初の表示では setup で読んでいるので読まない
let activatedOnce = false;
onActivated(() => {
	if (activatedOnce) fetchEvents();
	activatedOnce = true;
});

const eventsByDate = computed(() => groupCalendarEventsByDate(events.value));

function eventsOf(date: string): Misskey.entities.CalendarEvent[] {
	return eventsByDate.value.get(date) ?? [];
}

function visibleEvents(date: string): Misskey.entities.CalendarEvent[] {
	return eventsOf(date).slice(0, MAX_CHIPS_PER_DAY);
}

function hiddenCount(date: string): number {
	return eventsOf(date).length - visibleEvents(date).length;
}

function chipTitle(event: Misskey.entities.CalendarEvent): string {
	const text = `${formatCalendarEventTime(event)} ${event.title}`;
	return event.isCanceled ? `${text} (${i18n.ts._calendar.canceled})` : text;
}

async function createEvent(date?: string) {
	const created = await openCalendarEventEditDialog({
		// 今月以外を表示しているときは、表示している月の 1 日を初期値にする
		initialDate: date ?? (currentMonth.value === todayMonth ? today : `${currentMonth.value}-01`),
	});
	if (created == null) return;
	router.push('/calendar/events/:eventId', { params: { eventId: created.id } });
}

function openDayMenu(date: string, ev: MouseEvent) {
	const list = eventsOf(date);
	const items: MenuItem[] = [{
		type: 'label',
		text: formatCalendarDay(date),
	}];
	for (const event of list) {
		const time = formatCalendarEventTime(event);
		items.push({
			type: 'link',
			to: `/calendar/events/${event.id}`,
			text: event.title,
			caption: event.isCanceled ? `${time} ・ ${i18n.ts._calendar.canceled}` : event.location != null ? `${time} ・ ${event.location}` : time,
			icon: event.isCanceled ? 'ti ti-calendar-off' : event.isSubscribed ? 'ti ti-bell-ringing' : 'ti ti-calendar-event',
		});
	}
	if (list.length > 0) items.push({ type: 'divider' });
	items.push({
		text: i18n.ts._calendar.createEventOnThisDay,
		icon: 'ti ti-plus',
		action: () => {
			createEvent(date);
		},
	});
	os.popupMenu(items, ev.currentTarget ?? ev.target);
}

const headerTabs = computed(() => [{
	key: 'all',
	title: i18n.ts._calendar.all,
	icon: 'ti ti-calendar',
}, {
	key: 'subscribed',
	title: i18n.ts._calendar.subscribed,
	icon: 'ti ti-bell-ringing',
}, {
	key: 'mine',
	title: i18n.ts._calendar.mine,
	icon: 'ti ti-user',
}]);

const headerActions = computed<PageHeaderItem[]>(() => [{
	icon: 'ti ti-rss',
	text: i18n.ts._calendar.feed,
	handler: () => {
		// カレンダー連携の設定画面 (/settings/calendar) はまだルートの定義が無いので、パスで移動する
		router.pushByPath('/settings/calendar');
	},
}, {
	icon: 'ti ti-plus',
	text: i18n.ts._calendar.createEvent,
	handler: () => {
		createEvent();
	},
}]);

definePage(() => ({
	title: i18n.ts._calendar.calendar,
	icon: 'ti ti-calendar',
}));
</script>

<style lang="scss" module>
.head {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	margin-bottom: 12px;
}

.month {
	font-size: 1.3em;
	font-weight: bold;
	margin: 0 4px;
}

.grow {
	flex: 1;
}

.panel {
	transition: opacity 0.2s ease;

	&.fetching {
		opacity: 0.6;
	}
}

.grid {
	display: grid;
	grid-template-columns: repeat(7, minmax(0, 1fr));
}

.dow {
	padding: 8px;
	font-size: 0.85em;
	opacity: 0.7;
	border-bottom: solid 0.5px var(--MI_THEME-divider);

	&.sunday {
		color: var(--MI_THEME-error);
		opacity: 0.9;
	}
}

.cell {
	min-height: 108px;
	padding: 6px;
	display: flex;
	flex-direction: column;
	gap: 3px;
	min-width: 0;
	border-bottom: solid 0.5px var(--MI_THEME-divider);
	border-right: solid 0.5px var(--MI_THEME-divider);
	cursor: pointer;

	&:nth-child(7n) {
		border-right: none;
	}

	&:nth-last-child(-n + 7) {
		border-bottom: none;
	}

	&:hover {
		background: var(--MI_THEME-panelHighlight);
	}

	&.out > * {
		opacity: 0.4;
	}
}

.dayNumber {
	flex: none;
	font-size: 0.85em;
	width: 24px;
	height: 24px;
	display: grid;
	place-items: center;
	border-radius: 999px;

	.today & {
		background: var(--MI_THEME-accent);
		color: var(--MI_THEME-fgOnAccent);
		font-weight: bold;
	}
}

.chip {
	display: block;
	font-size: 0.8em;
	line-height: 1.5;
	padding: 1px 6px;
	border-radius: 5px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	background: var(--MI_THEME-buttonBg);
	color: var(--MI_THEME-fg);

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
		text-decoration: none;
	}

	&.subscribed {
		background: var(--MI_THEME-accentedBg);
		color: var(--MI_THEME-accent);
		box-shadow: inset 0 0 0 1px var(--MI_THEME-accent);
	}

	&.canceled {
		text-decoration: line-through;
		opacity: 0.6;
	}
}

.chipTime {
	margin-right: 4px;
}

.more {
	font-size: 0.8em;
	text-align: left;
	padding: 1px 4px;
	opacity: 0.7;
	border-radius: 5px;

	&:hover {
		opacity: 1;
	}
}

.legend {
	display: flex;
	flex-wrap: wrap;
	gap: 16px;
	margin-top: 10px;
	font-size: 0.85em;
	opacity: 0.8;

	> span {
		display: flex;
		align-items: center;
		gap: 6px;
	}
}

.legendMark {
	display: inline-block;
	width: 14px;
	height: 10px;
	border-radius: 3px;
	background: var(--MI_THEME-buttonBg);

	&.subscribed {
		background: var(--MI_THEME-accentedBg);
		box-shadow: inset 0 0 0 1px var(--MI_THEME-accent);
	}

	&.canceled {
		opacity: 0.6;
	}
}

// スマホ幅ではイベントを細い印にして、セルを押したときの一覧で中身を見る
@container (max-width: 600px) {
	.create {
		display: none;
	}

	.cell {
		min-height: 56px;
		padding: 3px;
	}

	.chip {
		font-size: 0;
		height: 5px;
		padding: 0;
		border-radius: 999px;
		// 細い印は押しにくいので、押したらセルの一覧を出す
		pointer-events: none;
	}

	.more {
		font-size: 0.7em;
		padding: 0 2px;
	}
}
</style>
