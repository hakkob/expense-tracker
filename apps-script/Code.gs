// ============================================================
// Expense Tracker — Apps Script Web App
// Deploy as: Execute as Me | Access: Anyone
// ============================================================
// SETUP:
// 1. Open your Expense Tracker Google Sheet
// 2. Extensions → Apps Script → paste this file
// 3. Before deploying, add an ID column:
//      - Right-click column A → Insert 1 column left
//      - Type "id" in cell A2 (your headers are in row 2)
//      - (Existing data auto-gets IDs on first load)
//      - Also type "year" in cell J2 (last new column)
// 4. Deploy → New Deployment → Web App
//      Execute as: Me | Who has access: Anyone
// 5. Copy the Web App URL into index.html → SCRIPT_URL
// ============================================================

const SS_ID       = '1verBW5nG_5LxrGKimXFLGftxtdFQoJHm0hEdYUkG72Y';
const OWNER_EMAIL = 'felipe.jacob.g@gmail.com';

// Column indices (0-based) after adding the ID column:
// A=id  B=month  C=expense  D=category  E=pay_sched
// F=amount  G=paid  H=date_paid  I=notes  J=year
const NUM_COLS    = 10;
const DATA_START  = 3; // row 1=empty, row 2=headers, row 3=data

// ── ENTRY POINT ─────────────────────────────────────────────
function doPost(e) {
  try {
    const req   = JSON.parse(e.postData.contents);
    const email = verifyToken(req.token);
    if (!email) return jsonOut({ error: 'Unauthorized' });

    const ss = SpreadsheetApp.openById(SS_ID);

    switch (req.action) {
      case 'load':        return jsonOut(handleLoad(ss, email));
      case 'saveEntry':   return jsonOut(handleSaveEntry(ss, email, req.data));
      case 'deleteEntry': return jsonOut(handleDeleteEntry(ss, email, req.id));
      default:            return jsonOut({ error: 'Unknown action' });
    }
  } catch (err) {
    return jsonOut({ error: err.toString() });
  }
}

// ── AUTH HELPERS ─────────────────────────────────────────────
function jsonOut(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function verifyToken(token) {
  if (!token) return null;
  try {
    const r = UrlFetchApp.fetch(
      'https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + token,
      { muteHttpExceptions: true }
    );
    const d = JSON.parse(r.getContentText());
    return d.email || null;
  } catch (e) { return null; }
}

function isOwner(email) { return email === OWNER_EMAIL; }

// ── LOAD ─────────────────────────────────────────────────────
function handleLoad(ss, email) {
  if (!isOwner(email)) return { error: 'Access denied' };

  const sheet   = ss.getSheetByName('Expense');
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START) return { entries: [] };

  const numRows = lastRow - DATA_START + 1;
  const rows    = sheet.getRange(DATA_START, 1, numRows, NUM_COLS).getValues();
  const tz      = Session.getScriptTimeZone();

  // Track rows that need an auto-generated ID written back
  const toWrite = [];
  const entries = [];

  rows.forEach((row, i) => {
    if (!row[1] && !row[2]) return; // skip blank rows

    let id = String(row[0] || '').trim();
    if (!id) {
      id = Utilities.getUuid();
      toWrite.push({ rowNum: DATA_START + i, id });
    }

    const dateCell = row[7];
    let datePaid   = '';
    if (dateCell instanceof Date && !isNaN(dateCell)) {
      datePaid = Utilities.formatDate(dateCell, tz, 'yyyy-MM-dd');
    }

    let year = row[9];
    if (!year && dateCell instanceof Date && !isNaN(dateCell)) {
      year = dateCell.getFullYear();
    }

    entries.push({
      id,
      month       : row[1] || '',
      expense     : row[2] || '',
      category    : row[3] || '',
      paySchedule : row[4] || '',
      amount      : Number(row[5]) || 0,
      paid        : row[6] === true || String(row[6]).toUpperCase() === 'TRUE',
      datePaid,
      notes       : row[8] || '',
      year        : year || ''
    });
  });

  // Write back auto-generated IDs for migrated rows
  if (toWrite.length) {
    toWrite.forEach(({ rowNum, id }) => {
      sheet.getRange(rowNum, 1).setValue(id);
    });
  }

  return { entries, email };
}

// ── SAVE (add or update) ─────────────────────────────────────
function handleSaveEntry(ss, email, data) {
  if (!isOwner(email)) return { error: 'Forbidden' };

  const sheet = ss.getSheetByName('Expense');
  const isNew = !data.id;

  if (isNew) data.id = Utilities.getUuid();

  const row = toRow(data);

  if (!isNew) {
    const rowNum = findRow(sheet, data.id);
    if (rowNum > 0) {
      sheet.getRange(rowNum, 1, 1, NUM_COLS).setValues([row]);
      return { ok: true, id: data.id };
    }
  }

  // Append (new entry OR id not found)
  sheet.appendRow(row);
  return { ok: true, id: data.id };
}

// ── DELETE ───────────────────────────────────────────────────
function handleDeleteEntry(ss, email, id) {
  if (!isOwner(email)) return { error: 'Forbidden' };

  const sheet  = ss.getSheetByName('Expense');
  const rowNum = findRow(sheet, id);
  if (rowNum < 0) return { error: 'Not found' };

  sheet.getRange(rowNum, 1, 1, NUM_COLS).clearContent();
  return { ok: true };
}

// ── HELPERS ──────────────────────────────────────────────────
function toRow(e) {
  const datePaid = e.datePaid ? new Date(e.datePaid + 'T00:00:00') : '';
  return [
    e.id          || '',
    e.month       || '',
    e.expense     || '',
    e.category    || '',
    e.paySchedule || '',
    parseFloat(e.amount) || 0,
    e.paid === true || e.paid === 'true',
    datePaid,
    e.notes       || '',
    e.year        ? parseInt(e.year) : new Date().getFullYear()
  ];
}

function findRow(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START) return -1;
  const ids = sheet.getRange(DATA_START, 1, lastRow - DATA_START + 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return DATA_START + i;
  }
  return -1;
}
