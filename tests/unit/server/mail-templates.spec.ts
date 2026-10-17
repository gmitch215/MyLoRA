import { describe, expect, it } from 'vitest';
import {
	escapeHtml,
	renderAdapterEmail,
	renderConfirmEmail,
	renderEmailConfirmEmail,
	renderJobEmail,
	renderTestEmail
} from '../../../src/server/utils/mail-templates';

describe('escapeHtml', () => {
	it('escapes the five html-significant characters', () => {
		expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
			'&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;'
		);
	});
});

describe('renderAdapterEmail', () => {
	const input = {
		siteName: 'My <Registry>',
		name: 'Evil <script>alert(1)</script>\nSubject: injected',
		baseModel: '@cf/mistral/mistral-7b-instruct-v0.2-lora',
		summary: 'A <b>bold</b> summary',
		adapterUrl: 'https://example.com/adapters/evil',
		unsubscribeUrl: 'https://example.com/unsubscribe?id=1&token=t'
	};

	it('escapes html and keeps header injection out of the subject', () => {
		const mail = renderAdapterEmail(input);
		expect(mail.html).not.toContain('<script>');
		expect(mail.html).toContain('&lt;script&gt;');
		expect(mail.subject).not.toMatch(/[\r\n]/);
		expect(mail.subject.startsWith('New adapter: ')).toBe(true);
	});

	it('puts both links in the text and html bodies', () => {
		const mail = renderAdapterEmail(input);
		for (const body of [mail.text, mail.html]) {
			expect(body).toContain('https://example.com/adapters/evil');
			expect(body).toContain('unsubscribe?id=1');
		}
	});

	it('only shows an image when one is given', () => {
		expect(renderAdapterEmail(input).html).not.toContain('<img');
		const withImage = renderAdapterEmail({ ...input, thumbnailUrl: 'https://example.com/a.png' });
		expect(withImage.html).toContain('<img src="https://example.com/a.png"');
	});
});

describe('renderJobEmail', () => {
	it.each([
		['completed', 'finished'],
		['failed', 'failed'],
		['abnormal', 'lost contact with its machine'],
		['aborted', 'was aborted']
	] as const)('describes a %s job', (status, outcome) => {
		const mail = renderJobEmail({
			siteName: 'MyLoRA',
			status,
			engine: 'peft',
			baseModel: 'gemma-2b',
			message: 'because <reasons>',
			jobUrl: 'https://example.com/dashboard/training'
		});
		expect(mail.subject).toBe(`Training job ${outcome}: gemma-2b`);
		expect(mail.text).toContain('/dashboard/training');
		expect(mail.html).toContain('because &lt;reasons&gt;');
	});
});

describe('renderEmailConfirmEmail', () => {
	it('carries the confirm link and tells a wrong recipient to ignore it', () => {
		const mail = renderEmailConfirmEmail({
			siteName: 'My <Registry>',
			confirmUrl: 'https://x.test/confirm-email?id=1.a&token=t'
		});
		expect(mail.subject).toBe('Confirm your email address for My <Registry>');
		expect(mail.text).toContain('https://x.test/confirm-email?id=1.a&token=t');
		expect(mail.text).toContain('ignore this email');
		expect(mail.html).toContain('My &lt;Registry&gt;');
	});
});

describe('renderConfirmEmail and renderTestEmail', () => {
	it('carries the confirm link in both bodies', () => {
		const mail = renderConfirmEmail({ siteName: 'MyLoRA', confirmUrl: 'https://x.test/c?id=1' });
		expect(mail.subject).toBe('Confirm your subscription to MyLoRA');
		expect(mail.text).toContain('https://x.test/c?id=1');
		expect(mail.html).toContain('https://x.test/c?id=1');
	});

	it('names the site in the test email', () => {
		expect(renderTestEmail('MyLoRA').subject).toBe('Test email from MyLoRA');
	});
});
