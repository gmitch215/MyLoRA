import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import TestConnectionResult from '~/components/training/TestConnectionResult.vue';

describe('training/TestConnectionResult', () => {
	it('renders the ok label and success tone', async () => {
		const w = await mountSuspended(TestConnectionResult, {
			props: { diagnosis: { ok: true, code: 'ok', message: 'all good' } }
		});
		expect(w.text()).toContain('Connection OK');
		expect(w.text()).toContain('all good');
		expect(w.html()).toContain('text-success');
	});

	it('maps each diagnosis code to its label', async () => {
		const cases: Record<string, string> = {
			dns: 'DNS Resolution Failed',
			refused: 'Connection Refused',
			timeout: 'Connection Timed Out',
			auth: 'Authentication Failed',
			host_key_changed: 'Host Key Changed',
			protocol: 'Protocol Error',
			unknown: 'Connection Failed'
		};
		for (const [code, label] of Object.entries(cases)) {
			const w = await mountSuspended(TestConnectionResult, {
				props: { diagnosis: { ok: false, code: code as any, message: 'x' } }
			});
			expect(w.text()).toContain(label);
		}
	});

	it('falls back to unknown for an unrecognized code', async () => {
		const w = await mountSuspended(TestConnectionResult, {
			props: { diagnosis: { ok: false, code: 'bogus' as any, message: 'x' } }
		});
		expect(w.text()).toContain('Connection Failed');
	});

	it('uses the warning tone for timeout', async () => {
		const w = await mountSuspended(TestConnectionResult, {
			props: { diagnosis: { ok: false, code: 'timeout', message: 'x' } }
		});
		expect(w.html()).toContain('text-warning');
	});

	it('renders gpu info and tooling badges', async () => {
		const w = await mountSuspended(TestConnectionResult, {
			props: {
				diagnosis: {
					ok: true,
					code: 'ok',
					message: 'x',
					gpuInfo: { name: 'RTX 4090', vramMb: 24576 },
					toolingReady: true
				}
			}
		});
		expect(w.text()).toContain('RTX 4090');
		// 24576 MB -> 24 GB
		expect(w.text()).toContain('24 GB');
		expect(w.text()).toContain('Tooling Ready');
	});

	it('shows tooling missing when not ready', async () => {
		const w = await mountSuspended(TestConnectionResult, {
			props: { diagnosis: { ok: false, code: 'unknown', message: 'x', toolingReady: false } }
		});
		expect(w.text()).toContain('Tooling Missing');
	});

	it('renders the system info block with ram/disk and ubuntu icon', async () => {
		const w = await mountSuspended(TestConnectionResult, {
			props: {
				diagnosis: {
					ok: true,
					code: 'ok',
					message: 'x',
					systemInfo: {
						os: 'Ubuntu 22.04',
						hostname: 'gpu-box',
						user: 'ubuntu',
						kernel: '6.5.0',
						cpuModel: 'AMD EPYC',
						cpuCores: 32,
						ramTotalMb: 65536,
						ramAvailMb: 32768,
						diskTotalGb: 500,
						diskAvailGb: 250,
						diskType: 'SSD',
						gpus: [
							{ name: 'GPU0', vramMb: 24576, vramUsedMb: 1024 },
							{ name: 'GPU1', vramMb: 24576 }
						]
					}
				}
			}
		});
		const text = w.text();
		expect(text).toContain('Ubuntu 22.04');
		expect(text).toContain('gpu-box');
		expect(text).toContain('32 Cores');
		// ram avail/total in GB
		expect(text).toContain('32/64 GB RAM');
		expect(text).toContain('250/500 GB SSD');
		// 2 gpus badge
		expect(text).toContain('2 GPUs');
	});

	it('renders ram total only when avail is absent (else branch)', async () => {
		const w = await mountSuspended(TestConnectionResult, {
			props: {
				diagnosis: {
					ok: true,
					code: 'ok',
					message: 'x',
					systemInfo: { os: 'Debian', ramTotalMb: 16384 }
				}
			}
		});
		expect(w.text()).toContain('16 GB RAM');
		// non-ubuntu os -> plain linux icon path (no ubuntu badge crash)
		expect(w.text()).toContain('Debian');
	});
});
