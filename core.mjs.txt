export const LIMITS = { bytes: 2 * 1024 * 1024, rows: 20000, columns: 64 };

export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const records = []; let row = [], field = '', quoted = false, closedQuote = false, recordStarted = false;
  const pushField = () => {
    row.push(field); field = ''; closedQuote = false;
    if (row.length > LIMITS.columns) throw new Error('CSV exceeds 64 columns.');
  };
  const pushRow = () => {
    pushField();
    if (recordStarted) records.push(row);
    row = []; recordStarted = false;
    if (records.length > LIMITS.rows + 1) throw new Error('CSV exceeds 20,000 data records.');
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else field += c;
    } else if (c === ',') { recordStarted = true; pushField(); }
    else if (c === '\r' || c === '\n') { pushRow(); if (c === '\r' && text[i + 1] === '\n') i++; }
    else if (closedQuote) throw new Error('Unexpected character after a quoted CSV field.');
    else if (c === '"') {
      if (field !== '') throw new Error('Quote inside an unquoted CSV field.');
      quoted = true; recordStarted = true;
    } else { field += c; recordStarted = true; }
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  if (row.length || field || closedQuote) pushRow();
  if (records.length < 2) throw new Error('CSV needs a header and at least one data record.');
  const headers = records.shift().map(s => s.trim());
  if (headers.some(s => !s) || new Set(headers).size !== headers.length) throw new Error('Column headers must be nonempty and unique.');
  for (let i = 0; i < records.length; i++) {
    if (records[i].length !== headers.length) throw new Error(`CSV record ${i + 2} has ${records[i].length} fields; expected ${headers.length}.`);
  }
  return { headers, records };
}

export function decimal(value) {
  const text = String(value).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw new Error('Use a plain decimal, without currency signs, commas or exponents.');
  const unsigned = text.replace(/^[+-]/, '');
  const [whole, fraction = ''] = unsigned.split('.');
  if (fraction.length > 18 || (whole + fraction).length > 64) throw new Error('Decimal exceeds 64 digits or 18 fractional digits.');
  return { units: BigInt((whole || '0') + fraction) * (text.startsWith('-') ? -1n : 1n), scale: fraction.length };
}

export function formatDecimal(units, scale) {
  const sign = units < 0n ? '-' : '';
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
  if (!scale) return sign + digits;
  const fraction = digits.slice(-scale).replace(/0+$/, '');
  return sign + digits.slice(0, -scale) + (fraction ? '.' + fraction : '');
}

export function analyze(table, amountColumn, expected = '', idColumn = null) {
  if (!Number.isInteger(amountColumn) || amountColumn < 0 || amountColumn >= table.headers.length) throw new Error('Choose a valid amount column.');
  if (idColumn !== null && (!Number.isInteger(idColumn) || idColumn < 0 || idColumn >= table.headers.length)) throw new Error('Choose a valid ID column.');
  const numbers = [], missing = [], invalid = [], emptyIds = [], idRows = new Map();
  table.records.forEach((row, i) => {
    const value = row[amountColumn].trim();
    if (!value) missing.push(i + 2);
    else { try { numbers.push(decimal(value)); } catch { invalid.push(i + 2); } }
    if (idColumn !== null) {
      const id = row[idColumn].trim();
      if (!id) emptyIds.push(i + 2);
      else { const rows = idRows.get(id) || []; rows.push(i + 2); idRows.set(id, rows); }
    }
  });
  const duplicates = [...idRows.values()].filter(rows => rows.length > 1);
  const expectedNumber = expected.trim() === '' ? null : decimal(expected);
  const scale = Math.max(0, expectedNumber?.scale || 0, ...numbers.map(n => n.scale));
  const totalUnits = numbers.reduce((total, n) => total + n.units * 10n ** BigInt(scale - n.scale), 0n);
  const blocked = missing.length > 0 || invalid.length > 0;
  const expectedUnits = expectedNumber ? expectedNumber.units * 10n ** BigInt(scale - expectedNumber.scale) : null;
  return {
    version: 1,
    column: table.headers[amountColumn],
    id_column: idColumn === null ? null : table.headers[idColumn],
    records: table.records.length,
    valid_amounts: numbers.length,
    missing_amount_records: missing,
    invalid_amount_records: invalid,
    empty_id_records: emptyIds,
    duplicate_id_groups: duplicates,
    total: blocked ? null : formatDecimal(totalUnits, scale),
    expected: expectedNumber ? formatDecimal(expectedNumber.units, expectedNumber.scale) : null,
    difference: blocked || expectedUnits === null ? null : formatDecimal(totalUnits - expectedUnits, scale),
    verdict: blocked ? 'blocked' : expectedUnits === null ? 'summary_only' : totalUnits === expectedUnits ? 'matches' : 'differs',
    scope: 'One CSV column only. Matching totals do not prove completeness, correctness of source records, or correctness of the wider analysis. Record numbers include the header; blank lines are ignored.',
  };
}

export function pythonVerifier(config) {
  const configBytes = new TextEncoder().encode(JSON.stringify(config));
  const encoded = btoa(Array.from(configBytes, b => String.fromCharCode(b)).join(''));
  return `#!/usr/bin/env python3
"""Independent CSV/Decimal recheck. Standard library only. Run: python verify.py your.csv"""
import base64, csv, hashlib, io, json, re, sys
from decimal import Decimal, localcontext

CONFIG = json.loads(base64.b64decode('${encoded}'))

def number(value):
    value = value.strip()
    if not re.fullmatch(r'[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)', value):
        raise ValueError('Not a plain decimal')
    digits = value.lstrip('+-').split('.')
    if len(''.join(digits)) > 64 or (len(digits) > 1 and len(digits[1]) > 18):
        raise ValueError('Decimal out of supported range')
    return Decimal(value)

def display(value):
    if not value: return '0'
    result = format(value, 'f')
    return result.rstrip('0').rstrip('.') if '.' in result else result

def verify(raw):
    digest = hashlib.sha256(raw).hexdigest()
    if digest != CONFIG['sha256']:
        raise ValueError('File SHA-256 differs from the browser-checked file; no comparison made')
    rows = [row for row in csv.reader(io.StringIO(raw.decode('utf-8-sig'), newline=''), strict=True) if row != []]
    headers, records = [s.strip() for s in rows[0]], rows[1:]
    if headers != CONFIG['headers'] or any(len(row) != len(headers) for row in records):
        raise ValueError('CSV layout differs from the browser check')
    col, id_col = CONFIG['amountColumn'], CONFIG['idColumn']
    numbers, missing, invalid, empty_ids, ids = [], [], [], [], {}
    for record, row in enumerate(records, start=2):
        value = row[col].strip()
        if not value: missing.append(record)
        else:
            try: numbers.append(number(value))
            except ValueError: invalid.append(record)
        if id_col is not None:
            identifier = row[id_col].strip()
            if not identifier: empty_ids.append(record)
            else: ids.setdefault(identifier, []).append(record)
    expected = number(CONFIG['expected']) if CONFIG['expected'].strip() else None
    blocked = bool(missing or invalid)
    with localcontext() as ctx:
        ctx.prec = 128
        total = sum(numbers, Decimal(0))
        report = {
            'version': 1, 'column': headers[col],
            'id_column': headers[id_col] if id_col is not None else None,
            'records': len(records), 'valid_amounts': len(numbers),
            'missing_amount_records': missing, 'invalid_amount_records': invalid,
            'empty_id_records': empty_ids,
            'duplicate_id_groups': [r for r in ids.values() if len(r) > 1],
            'total': None if blocked else display(total),
            'expected': display(expected) if expected is not None else None,
            'difference': None if blocked or expected is None else display(total - expected),
            'verdict': 'blocked' if blocked else 'summary_only' if expected is None else 'matches' if total == expected else 'differs',
            'scope': 'One CSV column only. Matching totals do not prove completeness, correctness of source records, or correctness of the wider analysis. Record numbers include the header; blank lines are ignored.',
        }
    return {'file_sha256': digest, 'result': report}

if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('Usage: python verify.py your.csv')
    try:
        with open(sys.argv[1], 'rb') as file: raw = file.read()
        print(json.dumps(verify(raw), indent=2, ensure_ascii=False))
    except (ValueError, UnicodeError, csv.Error, OSError) as error:
        sys.exit(str(error))
`;
}
