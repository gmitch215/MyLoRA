import type { ChatMessage } from '~/stores/inference';

function roleLabel(role: ChatMessage['role']): string {
	if (role === 'user') return 'You';
	if (role === 'assistant') return 'Assistant';
	return 'System';
}

// render a conversation as a readable markdown transcript (skips empty placeholders)
export function chatToText(messages: ChatMessage[], opts: { title?: string } = {}): string {
	const lines: string[] = [];
	if (opts.title) lines.push(`# ${opts.title}`, '');
	for (const m of messages) {
		if (!m.content?.trim()) continue;
		lines.push(`## ${roleLabel(m.role)}`, '', m.content.trim(), '');
	}
	return `${lines.join('\n').trim()}\n`;
}

// join several labelled transcripts (used by the compare playground) into one document
export function chatsToText(
	sections: { title?: string; messages: ChatMessage[] }[],
	opts: { title?: string } = {}
): string {
	const parts = sections
		.filter((s) => s.messages.some((m) => m.content?.trim()))
		.map((s) => chatToText(s.messages, { title: s.title }));
	const header = opts.title ? `# ${opts.title}\n\n` : '';
	return `${header}${parts.join('\n---\n\n')}`.trim() + '\n';
}

// clipboard + file-download helpers for chat transcripts, with a transient copied flag
export function useChatExport() {
	const copied = ref(false);

	async function copy(text: string) {
		if (!import.meta.client || !text.trim()) return;
		await navigator.clipboard.writeText(text);
		copied.value = true;
		setTimeout(() => (copied.value = false), 1500);
	}

	function download(text: string, filename: string) {
		if (!import.meta.client || !text.trim()) return;
		const name = filename.endsWith('.md') ? filename : `${filename}.md`;
		const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = name;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}

	return { copied, copy, download };
}
