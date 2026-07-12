import test from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { parseXlsxWorkbook } from "./spreadsheetFile";

function workbookBuffer(): ArrayBuffer {
  const archive = zipSync({
    "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Patients &amp; Leads" sheetId="1" r:id="rId1"/><sheet name="Arabic" sheetId="2" r:id="rId2"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`),
    "xl/sharedStrings.xml": strToU8(`<?xml version="1.0"?><sst><si><t>Patient Name</t></si><si><t>Phone Number</t></si><si><t>MRN</t></si><si><t>Omar Yasser Mohamed</t></si></sst>`),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="inlineStr"><is><t>01012345678</t></is></c><c r="C2"><v>0123</v></c><c r="D2" t="b"><v>1</v></c></row></sheetData></worksheet>`),
    "xl/worksheets/sheet2.xml": strToU8(`<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>الاسم</t></is></c><c r="B1" t="inlineStr"><is><t>رقم التليفون</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>سارة محمد علي</t></is></c><c r="B2" t="inlineStr"><is><t>01111111111</t></is></c></row></sheetData></worksheet>`),
  });
  return archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
}

test("XLSX parser reads compressed multi-sheet workbooks and preserves columns", () => {
  const workbook = parseXlsxWorkbook(workbookBuffer());
  assert.equal(workbook.sheets.length, 2);
  assert.equal(workbook.sheets[0].name, "Patients & Leads");
  assert.deepEqual(workbook.sheets[0].headers, ["Patient Name", "Phone Number", "MRN", "MRN (2)"]);
  assert.deepEqual(workbook.sheets[0].rows[0], ["Omar Yasser Mohamed", "01012345678", "0123", "TRUE"]);
  assert.deepEqual(workbook.sheets[1].headers, ["الاسم", "رقم التليفون"]);
  assert.equal(workbook.sheets[1].rows[0][0], "سارة محمد علي");
});

test("XLSX parser gives a clear error for invalid files", () => {
  assert.throws(() => parseXlsxWorkbook(new Uint8Array([1, 2, 3]).buffer), /could not be opened as an XLSX/i);
});
