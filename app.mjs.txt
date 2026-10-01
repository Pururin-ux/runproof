import { parseCSV, analyze, pythonVerifier, LIMITS } from './core.mjs';

const $ = id => document.getElementById(id);
let table = null, rawBytes = null, fileName = '', exportReport = null, verifier = null, loadRevision = 0;
const showError = message => {
  $('verdict').textContent = 'Cannot complete this check.';
  $('result-description').textContent = message;
  for (const id of ['records', 'total', 'difference']) $(id).textContent = '—';
  $('warnings').replaceChildren(); $('downloads').hidden = true;
  exportReport = verifier = null;
};
const invalidate = () => {
  exportReport = verifier = null; $('downloads').hidden = true;
  $('verdict').textContent = 'Ready to check this column.';
  $('result-description').textContent = 'Press Check this column after choosing your inputs.';
  for (const id of ['records', 'total', 'difference']) $(id).textContent = '—';
  $('warnings').replaceChildren();
};
function load(bytes, name) {
  table = null; rawBytes = null; $('run').disabled = true;
  $('amount-column').disabled = $('id-column').disabled = true;
  try {
    if (bytes.byteLength > LIMITS.bytes) throw new Error('This tool accepts files up to 2 MiB.');
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    table = parseCSV(decoded); rawBytes = bytes; fileName = name;
    $('amount-column').replaceChildren(...table.headers.map((name, i) => new Option(name, String(i))));
    $('id-column').replaceChildren(new Option('No ID check', ''), ...table.headers.map((name, i) => new Option(name, String(i))));
    const likely = table.headers.findIndex(s => /^(amount|total|value|price|sum)$/i.test(s));
    if (likely >= 0) $('amount-column').value = String(likely);
    $('file-name').textContent = `${name} · ${table.records.length} data records`;
    $('run').disabled = $('amount-column').disabled = $('id-column').disabled = false;
    invalidate();
  } catch (error) { $('file-name').textContent = name; showError(error.message); }
}
$('csv-file').addEventListener('change', async event => {
  const revision = ++loadRevision;
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > LIMITS.bytes) { load(new Uint8Array(LIMITS.bytes + 1), file.name); return; }
  try { const bytes = new Uint8Array(await file.arrayBuffer()); if (revision === loadRevision) load(bytes, file.name); }
  catch (error) { if (revision === loadRevision) showError(error.message); }
});
$('demo').addEventListener('click', () => {
  loadRevision++;
  $('csv-file').value = '';
  $('expected').value = '0.30';
  load(new TextEncoder().encode('entry,amount\r\nalpha,0.10\r\nbeta,0.20\r\ngamma,-0.05\r\n'), 'synthetic-example.csv');
  $('id-column').value = '0';
});
for (const id of ['amount-column', 'id-column', 'expected']) $(id).addEventListener('input', () => { if (table) invalidate(); });
$('run').addEventListener('click', async () => {
  if (!table || !rawBytes) return;
  $('run').disabled = true;
  try {
    const activeTable = table, activeBytes = rawBytes, activeName = fileName;
    const amountColumn = Number($('amount-column').value);
    const idColumn = $('id-column').value === '' ? null : Number($('id-column').value);
    const expected = $('expected').value;
    const result = analyze(activeTable, amountColumn, expected, idColumn);
    const digest = await crypto.subtle.digest('SHA-256', activeBytes);
    if (table !== activeTable || rawBytes !== activeBytes || $('amount-column').value !== String(amountColumn) || $('id-column').value !== (idColumn === null ? '' : String(idColumn)) || $('expected').value !== expected) return;
    const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    exportReport = { file_name: activeName, file_sha256: sha256, result };
    verifier = pythonVerifier({ sha256, headers: activeTable.headers, amountColumn, idColumn, expected });
    $('verifier-preview').textContent = verifier;
    const titles = { matches: 'The column total matches.', differs: 'The column total differs.', blocked: 'The total is blocked.', summary_only: 'Column total calculated.' };
    $('verdict').textContent = titles[result.verdict];
    $('result-description').textContent = result.verdict === 'blocked' ? 'Some amounts are empty or invalid. No partial total is presented as a complete result.' : result.verdict === 'summary_only' ? 'No expected total was supplied. This is a summary of the selected column only.' : `Selected column: ${result.column}. Expected total: ${result.expected}.`;
    $('records').textContent = String(result.records);
    $('total').textContent = result.total ?? 'Blocked';
    $('difference').textContent = result.difference ?? '—';
    const warnings = [];
    const refs = rows => rows.slice(0, 10).join(', ') + (rows.length > 10 ? '…' : '');
    if (result.missing_amount_records.length) warnings.push(`Empty amount records: ${refs(result.missing_amount_records)}.`);
    if (result.invalid_amount_records.length) warnings.push(`Invalid amount records: ${refs(result.invalid_amount_records)}.`);
    if (result.empty_id_records.length) warnings.push(`Empty ID records: ${refs(result.empty_id_records)}.`);
    if (result.duplicate_id_groups.length) warnings.push(`${result.duplicate_id_groups.length} repeated-ID group(s). These may be legitimate; review them before drawing conclusions.`);
    $('warnings').replaceChildren(...warnings.map(message => { const li = document.createElement('li'); li.textContent = message; return li; }));
    $('hash').textContent = `File SHA-256: ${sha256}`;
    $('downloads').hidden = false;
  } catch (error) { showError(error.message); }
  finally { $('run').disabled = !table; }
});
function download(contents, type, name) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('download-python').addEventListener('click', () => { if (verifier) download(verifier, 'text/x-python;charset=utf-8', 'verify.py'); });
$('download-report').addEventListener('click', () => { if (exportReport) download(JSON.stringify(exportReport, null, 2) + '\n', 'application/json', 'runproof-result.json'); });
$('brief').addEventListener('input', () => {
  const brief = $('brief').value.trim();
  const body = `## Calculation check inquiry\n\n${brief || 'Please describe one non-confidential claim and the expected result.'}\n\nI understand this is a public issue and that scope, USD25 pilot price (or a separate quote), deadline and payment network must be agreed before work/payment. This inquiry is not a funded order.`;
  $('github-inquiry').href = 'https://github.com/Pururin-ux/runproof/issues/new?' + new URLSearchParams({ title: 'Calculation check inquiry', body });
});
