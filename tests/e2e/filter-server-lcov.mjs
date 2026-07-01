import { readFileSync, writeFileSync } from 'node:fs';

const [, , file, root] = process.argv;
const prefix = root.endsWith('/') ? root : root + '/';

let txt;
try {
	txt = readFileSync(file, 'utf8');
} catch {
	process.exit(0);
}

const out = [];
let rec = [];
let sf = null;
for (const line of txt.split('\n')) {
	if (line.startsWith('SF:')) {
		sf = line.slice(3);
		rec = [line];
	} else if (line === 'end_of_record') {
		rec.push(line);
		const rel = sf.startsWith(prefix) ? sf.slice(prefix.length) : sf;
		if (rel.startsWith('src/server/') && !rel.startsWith('src/server/db/')) {
			out.push(rec.map((l) => (l.startsWith('SF:') ? 'SF:' + rel : l)).join('\n'));
		}
		rec = [];
		sf = null;
	} else if (sf != null) {
		rec.push(line);
	}
}

writeFileSync(file, out.length ? out.join('\n') + '\n' : '');
console.log(`[coverage:server] kept ${out.length} src/server files`);
