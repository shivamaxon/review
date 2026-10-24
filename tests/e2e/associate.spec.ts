import { test, expect } from '@playwright/test';
let ownLead = '', otherLead = '';
test.beforeEach(async ({ page, request, context }) => {
    await request.post('http://127.0.0.1:54329/__test/reset');
    const session = await (await request.get('http://127.0.0.1:54329/__test/session')).json();
    ownLead = session.ownLead;
    otherLead = session.otherLead;
    await context.addCookies([{ name: 'sb-127-auth-token', value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url'), domain: '127.0.0.1', path: '/', httpOnly: false, sameSite: 'Lax' }]);
    page.on('pageerror', error => console.error('Browser error:', error.message));
});
test('phone: new Hot in under 30s, existing follow-up in under 15s, duplicate caught', async ({ page }, testInfo) => {
    await page.goto('/log/customer');
    await expect(page.getByLabel('Customer name', { exact: true })).toBeVisible();
    const start = Date.now();
    await page.getByLabel('Customer name', { exact: true }).fill('Brand New Hot');
    await page.getByRole('button', { name: /^hot/i }).click();
    await page.getByRole('button', { name: '35', exact: true }).click();
    await page.getByRole('button', { name: 'Save update', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Saved. You’re all set.' })).toBeVisible();
    const hotMs = Date.now() - start;
    expect(hotMs).toBeLessThan(30000);
    await page.goto('/log/customer');
    await page.getByLabel('Customer name', { exact: true }).fill('Brand New Hot');
    await expect(page.getByRole('button', { name: /Brand New Hot.*Log follow-up/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save update', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: /Brand New Hot.*Log follow-up/ }).click();
    const followStart = Date.now();
    await page.getByRole('textbox', { name: 'Remark', exact: true }).fill('Followed up; site visit tomorrow.');
    await page.getByRole('button', { name: 'Save update', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Saved. You’re all set.' })).toBeVisible();
    const followMs = Date.now() - followStart;
    expect(followMs).toBeLessThan(15000);
    console.log(`Phone timings: new Hot ${hotMs}ms, follow-up ${followMs}ms`);
    await testInfo.attach('timing', { body: JSON.stringify({ hotMs, followMs }), contentType: 'application/json' });
    await page.goto('/home');
    await expect(page.getByRole('heading', { name: 'Your period scorecard' })).toBeVisible();
    const buttons = await page.locator('main button:visible, header button:visible, nav button:visible').evaluateAll(elements => elements.map(e => ({ text: e.textContent, height: e.getBoundingClientRect().height })));
    expect(buttons.filter(b => b.height < 48)).toEqual([]);
    await page.screenshot({ path: 'test-results/today-phone.png', fullPage: true });
});
test('ownership, Cold blocker, soft warnings and audited inline correction', async ({ page, request }) => {
    await page.goto('/leads/' + otherLead);
    await expect(page.getByRole('heading', { name: 'This record isn’t available' })).toBeVisible();
    await expect(page.getByText('Private Other Customer')).toHaveCount(0);
    await page.goto('/log/customer?lead=' + ownLead);
    await page.getByRole('button', { name: /^cold/i }).click();
    await page.getByRole('textbox', { name: 'Remark', exact: true }).fill('Customer mentioned booking token');
    await expect(page.getByText(/Check whether Cold is the right rating/)).toBeVisible();
    await page.getByRole('button', { name: 'Save update', exact: true }).click();
    await expect(page.locator('main [role="alert"]')).toContainText('Cold reason');
    await page.getByRole('combobox', { name: 'Cold reason', exact: true }).selectOption('Timing');
    await page.getByRole('button', { name: 'Save update', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Saved. You’re all set.' })).toBeVisible();
    await page.goto('/my-sheet?tab=interactions');
    const olderRow = page.getByRole('row').filter({has:page.getByRole('textbox',{name:'Remark for Existing Customer',exact:true})}).first();
    await olderRow.getByRole('textbox',{name:'Remark for Existing Customer',exact:true}).fill('Corrected older remark');
    await olderRow.getByRole('button',{name:'Save row',exact:true}).click();
    await expect(page.getByText('Saved. Your sheet is up to date.', { exact: true })).toBeVisible();
    const state = await (await request.get('http://127.0.0.1:54329/__test/state')).json();
    expect(state.audit.some((r: {
        table_name: string;
        action: string;
    }) => r.table_name === 'interactions' && r.action === 'UPDATE')).toBeTruthy();
});
test('offline remark survives reload, queues, reconnects exactly once; Undo works', async ({ page, context, request }) => {
    await page.goto('/log/customer');
    await page.getByLabel('Customer name', { exact: true }).fill('Offline Customer');
    await page.getByRole('button', { name: /^warm/i }).click();
    await page.getByRole('textbox', { name: 'Remark', exact: true }).fill('हिन्दी remark stays safe');
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Remark', exact: true })).toHaveValue('हिन्दी remark stays safe');
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Save update', exact: true }).click();
    await expect(page.getByText('1 pending sync · Retry')).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText('Saved. Your sheet is up to date.')).toBeVisible({ timeout: 20000 });
    let state = await (await request.get('http://127.0.0.1:54329/__test/state')).json();
    expect(state.leads.filter((l: {
        name: string;
    }) => l.name === 'Offline Customer')).toHaveLength(1);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByText('Undone.', { exact: true })).toBeVisible();
    state = await (await request.get('http://127.0.0.1:54329/__test/state')).json();
    expect(state.leads.filter((l: {
        name: string;
    }) => l.name === 'Offline Customer')).toHaveLength(0);
});
test('paste previews original headers, validates and imports only own rows', async ({ page }) => {
    await page.goto('/my-sheet');
    await page.getByRole('button', { name: 'Paste from Excel', exact: true }).click();
    await page.getByLabel('Paste Excel rows').fill('Customer Name\tPhone\tMtg Date\tMtg Type\tProject\tHWC\tPlot Name(s)\tRemarks\tNext Action\tNext Action Date\tReason/Nurturing Plan (if Cold)\nPaste Customer\t\t24/10/2026\tIn-person\tKudal\tWarm\t\tपेस्ट note\tCall\t25/10/2026\t');
    await expect(page.getByText('Ready', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Import 1 rows' }).click();
    await expect(page.getByRole('cell', { name: 'Saved', exact: true })).toBeVisible();
    await page.getByLabel('Paste Excel rows').fill('customer_name\tassociate_key\toccurred_on\trating_after\nNot mine\tother_associate\t2026-10-24\twarm');
    await expect(page.getByRole('button', { name: 'Import 1 rows' })).toBeDisabled();
    await expect(page.getByText(/This row belongs to another associate/)).toBeVisible();
});
test('CP typeahead, Active colour and booking conversion with conflict warning', async ({ page }) => {
    await page.goto('/log/cp');
    await page.getByRole('textbox', { name: 'Channel partner name', exact: true }).fill('Test CP');
    await page.getByRole('button', { name: /Test CP.*Log CP update/ }).click();
    await page.getByRole('button', { name: /^active/i }).click();
    await page.getByRole('textbox', { name: 'Remark', exact: true }).fill('Working actively on referrals');
    await page.getByRole('button', { name: 'Save update', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Saved. You’re all set.' })).toBeVisible();
    await page.getByRole('link', { name: 'Open CP timeline' }).click();
    await expect(page.getByText('Working actively on referrals', { exact: true })).toBeVisible();
    await expect(page.locator('.rating-active').first()).toBeVisible();
    await page.goto('/leads/' + ownLead);
    await page.getByRole('link', { name: 'Convert to booking' }).click();
    await expect(page.getByRole('textbox', { name: 'Customer name', exact: true })).toHaveValue('Existing Customer');
    await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('booking_done');
    await page.getByRole('combobox', { name: 'Plot', exact: true }).fill('35');
    await expect(page.getByText(/already Hot or reserved for another customer in your branch/)).toBeVisible();
    await expect(page.getByText('Private Other Customer')).toHaveCount(0);
    await page.getByRole('spinbutton', { name: 'Value (₹)', exact: true }).fill('100000');
    await page.getByRole('button', { name: 'Save booking', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Saved. You’re all set.' })).toBeVisible();
    await page.getByRole('link', { name: 'Open customer timeline' }).click();
    await expect(page.getByText('Booking done · ₹1,00,000')).toBeVisible();
});
test('installable offline shell reloads without caching signed-in pages', async ({ page, context, request }) => {
    await page.goto('/log/customer');
    await expect(page.getByRole('textbox', { name: 'Customer name', exact: true })).toBeVisible();
    await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBeTruthy();
    const urls = await page.evaluate(async () => { const cache = await caches.open('bro-public-v2'); return (await cache.keys()).map(r => new URL(r.url).pathname); });
    expect(urls).toContain('/offline');
    expect(urls.every(p => p === '/offline' || p.startsWith('/_next/static/') || p.startsWith('/icons/'))).toBeTruthy();
    await context.setOffline(true);
    await page.goto('/home');
    await expect(page.getByRole('heading', { name: 'AXON · Your offline workspace' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Customer name', exact: true }).fill('Shell Offline Customer');
    await page.getByRole('button', { name: /^warm/i }).click();
    await page.getByRole('textbox', { name: 'Remark', exact: true }).fill('Typed while fully offline');
    await page.getByRole('button', { name: 'Save update', exact: true }).click();
    await expect(page.getByText('1 pending sync · Retry')).toBeVisible();
    await context.setOffline(false);
    await expect.poll(async()=>{const state=await (await request.get('http://127.0.0.1:54329/__test/state')).json();return state.leads.filter((l:{name:string})=>l.name==='Shell Offline Customer').length;},{timeout:20000}).toBe(1);
});
test('Undo while offline cancels the queued request before reconnecting', async ({ page, context, request }) => {
    await page.goto('/log/customer');
    await page.getByRole('textbox', { name: 'Customer name', exact: true }).fill('Cancel Offline');
    await page.getByRole('button', { name: /^warm/i }).click();
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Save update', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByText('Undo queued. It will sync when connected.', { exact: true })).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText('Undone.', { exact: true })).toBeVisible({ timeout: 20000 });
    const state = await (await request.get('http://127.0.0.1:54329/__test/state')).json();
    expect(state.leads.filter((l: {
        name: string;
    }) => l.name === 'Cancel Offline')).toHaveLength(0);
});
test('Hindi voice entry preserves other fields while listening', async ({ page }) => {
    await page.addInitScript(() => {
        class Recognition {
            lang = '';
            continuous = false;
            interimResults = false;
            onresult: ((event: unknown) => void) | null = null;
            onend: (() => void) | null = null;
            onerror: ((e: unknown) => void) | null = null;
            start() { (window as unknown as {
                testRecognition: Recognition;
            }).testRecognition = this; }
            stop() { this.onend?.(); }
        }
        (window as unknown as {
            SpeechRecognition: typeof Recognition;
        }).SpeechRecognition = Recognition;
    });
    await page.goto('/log/customer');
    await page.getByRole('textbox', { name: 'Customer name', exact: true }).fill('Voice Customer');
    await page.getByRole('combobox', { name: 'Voice language' }).selectOption('hi-IN');
    await page.getByRole('button', { name: 'Speak', exact: true }).click();
    await page.getByRole('textbox', { name: 'Phone (optional)', exact: true }).fill('9876543211');
    await page.evaluate(() => { const r = (window as unknown as {
        testRecognition: {
            lang: string;
            onresult: (e: unknown) => void;
        };
    }).testRecognition; if (r.lang !== 'hi-IN')
        throw Error('Wrong voice language'); r.onresult({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, 0: { transcript: 'ग्राहक से बात हुई' } } } }); });
    await expect(page.getByRole('textbox', { name: 'Remark', exact: true })).toHaveValue('ग्राहक से बात हुई');
    await expect(page.getByRole('textbox', { name: 'Phone (optional)', exact: true })).toHaveValue('9876543211');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Remark', exact: true })).toHaveValue('ग्राहक से बात हुई');
});
