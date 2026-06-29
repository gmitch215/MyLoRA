export type DiffOp = { t: 'eq' | 'del' | 'ins'; v: string };
export type DiffRow = { type: 'eq' | 'change'; left: string | null; right: string | null };

// generic lcs diff over two token sequences
function lcsDiff<T>(
	a: T[],
	b: T[],
	eq: (x: T, y: T) => boolean
): { t: 'eq' | 'del' | 'ins'; v: T }[] {
	const n = a.length;
	const m = b.length;
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i]![j] = eq(a[i]!, b[j]!)
				? dp[i + 1]![j + 1]! + 1
				: Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
		}
	}

	const ops: { t: 'eq' | 'del' | 'ins'; v: T }[] = [];
	let i = 0;
	let j = 0;

	while (i < n && j < m) {
		if (eq(a[i]!, b[j]!)) {
			ops.push({ t: 'eq', v: a[i]! });
			i++;
			j++;
		} else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
			ops.push({ t: 'del', v: a[i]! });
			i++;
		} else {
			ops.push({ t: 'ins', v: b[j]! });
			j++;
		}
	}
	while (i < n) ops.push({ t: 'del', v: a[i++]! });
	while (j < m) ops.push({ t: 'ins', v: b[j++]! });

	return ops;
}

// word-level diff (whitespace tokens preserved)
export function diffWords(a: string, b: string): DiffOp[] {
	const ax = (a || '').split(/(\s+)/);
	const bx = (b || '').split(/(\s+)/);
	return lcsDiff(ax, bx, (x, y) => x === y) as DiffOp[];
}

// break text into sentence/line segments
export function splitSegments(text: string): string[] {
	return (text || '')
		.split(/\n+/)
		.flatMap((line) => line.split(/(?<=[.!?])\s+/))
		.map((s) => s.trim())
		.filter(Boolean);
}

function norm(s: string): string {
	return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function diffRows(a: string, b: string): DiffRow[] {
	const sa = splitSegments(a);
	const sb = splitSegments(b);
	const ops = lcsDiff(sa, sb, (x, y) => norm(x) === norm(y));
	const rows: DiffRow[] = [];
	let k = 0;
	while (k < ops.length) {
		if (ops[k]!.t === 'eq') {
			rows.push({ type: 'eq', left: ops[k]!.v, right: ops[k]!.v });
			k++;
			continue;
		}
		const dels: string[] = [];
		const ins: string[] = [];
		while (k < ops.length && ops[k]!.t !== 'eq') {
			if (ops[k]!.t === 'del') dels.push(ops[k]!.v);
			else ins.push(ops[k]!.v);
			k++;
		}
		const n = Math.max(dels.length, ins.length);
		for (let t = 0; t < n; t++) {
			rows.push({ type: 'change', left: dels[t] ?? null, right: ins[t] ?? null });
		}
	}
	return rows;
}
