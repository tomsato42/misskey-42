/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { CalendarEventRemindersProcessorService } from '@/queue/processors/CalendarEventRemindersProcessorService.js';
import type { CalendarNotificationService } from '@/core/calendar/CalendarNotificationService.js';
import type { QueueLoggerService } from '@/queue/QueueLoggerService.js';

describe('CalendarEventRemindersProcessorService', () => {
	let sendDueReminders: ReturnType<typeof vi.fn>;
	let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
	let processor: CalendarEventRemindersProcessorService;

	beforeEach(() => {
		sendDueReminders = vi.fn(async () => ({ events: 3, sent: 2, truncated: false }));
		logger = { info: vi.fn(), warn: vi.fn() };
		const queueLoggerService = { logger: { createSubLogger: () => logger } } as unknown as QueueLoggerService;
		processor = new CalendarEventRemindersProcessorService(
			{ sendDueReminders } as unknown as CalendarNotificationService,
			queueLoggerService,
		);
	});

	test('今の時刻でリマインドを送る', async () => {
		const before = Date.now();
		await processor.process();
		const after = Date.now();

		expect(sendDueReminders).toHaveBeenCalledOnce();
		const now = sendDueReminders.mock.calls[0][0] as Date;
		expect(now.getTime()).toBeGreaterThanOrEqual(before);
		expect(now.getTime()).toBeLessThanOrEqual(after);
		expect(logger.info).toHaveBeenCalledOnce();
		expect(logger.warn).not.toHaveBeenCalled();
	});

	test('送るものが無ければログを出さない', async () => {
		sendDueReminders.mockResolvedValueOnce({ events: 0, sent: 0, truncated: false });
		await processor.process();
		expect(logger.info).not.toHaveBeenCalled();
		expect(logger.warn).not.toHaveBeenCalled();
	});

	test('上限で打ち切ったら警告する', async () => {
		sendDueReminders.mockResolvedValueOnce({ events: 1000, sent: 1000, truncated: true });
		await processor.process();
		expect(logger.warn).toHaveBeenCalledOnce();
	});

	test('失敗したら例外をそのまま投げる (ジョブの失敗として記録する)', async () => {
		sendDueReminders.mockRejectedValueOnce(new Error('db down'));
		await expect(processor.process()).rejects.toThrow('db down');
	});
});
