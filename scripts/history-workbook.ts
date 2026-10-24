import ExcelJS from 'exceljs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
export type Row = Record<string, string | number | boolean | null>;
export function workbookPath() {
    const i = process.argv.indexOf('--file');
    const candidates = [i >= 0 ? process.argv[i + 1] : undefined, process.env.IMPORT_XLSX, 'data/Axon_NCR_Review_Database_Import.xlsx', '/data/Axon_NCR_Review_Database_Import.xlsx', '../Axon_NCR_Review_Database_Import.xlsx'];
    const path = candidates.find(p => p && existsSync(p));
    if (!path)
        throw new Error('Import workbook missing. Pass --file <path>.');
    return resolve(path);
}
export function cell(v: ExcelJS.CellValue): Row[string] {
    if (v == null)
        return null;
    if (v instanceof Date)
        return v.toISOString().slice(0, 10);
    if (typeof v === 'object') {
        if ('formula' in v || 'sharedFormula' in v) {
            if ('result' in v && v.result != null)
                return cell(v.result as ExcelJS.CellValue);
            if ('formula' in v && /^(TRUE|FALSE)\(\)$/i.test(v.formula ?? ''))
                return /^TRUE/i.test(v.formula ?? '');
            throw new Error('Formula has no cached result; recalculate the workbook first.');
        }
        if ('text' in v)
            return v.text;
        if ('richText' in v)
            return v.richText.map(x => x.text).join('');
        throw new Error('Unsupported workbook cell');
    }
    return typeof v === 'string' ? v.trim() || null : v;
}
export async function readWorkbook() { return new ExcelJS.Workbook().xlsx.readFile(workbookPath()); }
export function sheet(w: ExcelJS.Workbook, name: string): Row[] {
    const s = w.getWorksheet(name);
    if (!s)
        throw new Error(`Missing sheet: ${name}`);
    const h = s.getRow(1);
    const rows: Row[] = [];
    s.eachRow((r, n) => { if (n === 1)
        return; const row: Row = {}; h.eachCell((v, i) => { row[String(v.value)] = cell(r.getCell(i).value); }); rows.push(row); });
    return rows;
}
export function reconciliation(w: ExcelJS.Workbook) {
    const s = w.getWorksheet('reconciliation');
    if (!s)
        throw new Error('Missing reconciliation sheet');
    const rows: Record<string, number | string>[] = [];
    s.eachRow(r => {
        const key = r.getCell(1).value;
        if (typeof key !== 'string' || !/^(parul|udit|anoop_soni|anoop_sharma|divya|diksha|chetna|manisha|amandeep)$/.test(key))
            return;
        const cols = ['meetings', 'hot', 'warm', 'cold', 'cp_meetings', 'bookings', 'booking_value'];
        const row: Record<string, number | string> = { associate_key: key };
        cols.forEach((k, i) => { const v = r.getCell(i + 3).value; if (typeof v !== 'number')
            throw new Error(`Invalid reconciliation ${key} ${k}`); row[k] = v; });
        row.unrated = Number(row.meetings) - Number(row.hot) - Number(row.warm) - Number(row.cold);
        rows.push(row);
    });
    if (rows.length !== 9)
        throw new Error('Expected 9 reconciliation associates');
    return rows;
}
