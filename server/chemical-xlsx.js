// Dependency-free OOXML workbook for the MSDS department register.
// Every supplied value is written as a number or an inline string, never as a formula.
const encoder = new TextEncoder();
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const column = index => { let name=''; for(let n=index+1;n;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name; return name; };
const codePoints = value => Array.from(String(value ?? ''));
const truncate = (value,length) => codePoints(value).slice(0,length).join('');

function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(0xedb88320&-(crc&1));}
  return (crc^0xffffffff)>>>0;
}

function zip(files) {
  const chunks=[],directory=[];let offset=0,directorySize=0;
  for(const [path,source] of Object.entries(files)){
    const name=encoder.encode(path),bytes=encoder.encode(source),crc=crc32(bytes);
    const header=new Uint8Array(30+name.length),h=new DataView(header.buffer);
    h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint16(12,33,true);
    h.setUint32(14,crc,true);h.setUint32(18,bytes.length,true);h.setUint32(22,bytes.length,true);h.setUint16(26,name.length,true);header.set(name,30);
    const central=new Uint8Array(46+name.length),c=new DataView(central.buffer);
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,33,true);
    c.setUint32(16,crc,true);c.setUint32(20,bytes.length,true);c.setUint32(24,bytes.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);central.set(name,46);
    chunks.push(header,bytes);directory.push(central);offset+=header.length+bytes.length;directorySize+=central.length;
  }
  const end=new Uint8Array(22),e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,directory.length,true);e.setUint16(10,directory.length,true);e.setUint32(12,directorySize,true);e.setUint32(16,offset,true);
  const result=new Uint8Array(offset+directorySize+end.length);let position=0;
  for(const chunk of [...chunks,...directory,end]){result.set(chunk,position);position+=chunk.length;}
  return result;
}

function cleanedSheetBase(value) {
  let result=String(value ?? '').replace(/[\\/?*:[\]]/g,' ').replace(/[\u0000-\u001F]/g,' ').replace(/\s+/g,' ').trim();
  result=result.replace(/^'+|'+$/g,'').trim();
  return truncate(result || '부서',31);
}

export function departmentSheetNames(departments) {
  const used=new Set(['부서 목록']);
  return departments.map(department=>{
    const base=cleanedSheetBase(department.name);let candidate=base,index=2;
    while(used.has(candidate.toLocaleLowerCase('ko-KR'))){
      const suffix=` (${index++})`;candidate=truncate(base,31-codePoints(suffix).length)+suffix;
    }
    used.add(candidate.toLocaleLowerCase('ko-KR'));
    return candidate;
  });
}

const internalLocation = sheetName => `'${String(sheetName).replaceAll("'","''")}'!A1`;
const cell = (reference,value,style=4) => typeof value==='number'&&Number.isFinite(value)
  ? `<c r="${reference}" s="${style}"><v>${value}</v></c>`
  : `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
const row = (number,values,{height,style=4}={}) => `<row r="${number}"${height?` ht="${height}" customHeight="1"`:''}>${values.map((value,index)=>cell(`${column(index)}${number}`,value,style)).join('')}</row>`;
const hyperlink = (reference,sheetName,label) => `<hyperlink ref="${reference}" location="${xml(internalLocation(sheetName))}" display="${xml(label)}"/>`;

const styles = declaration+`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.########"/></numFmts>
<fonts count="4"><font><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font><font><u/><sz val="10"/><color rgb="FF0563C1"/><name val="맑은 고딕"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF176B5B"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF248876"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF4F1"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFB8C9C5"/></left><right style="thin"><color rgb="FFB8C9C5"/></right><top style="thin"><color rgb="FFB8C9C5"/></top><bottom style="thin"><color rgb="FFB8C9C5"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function worksheet({rows,columns,lastColumn,lastRow,hyperlinks=[],merges=[],freezeRow=4,filterRow=4,orientation='landscape'}) {
  const range=`A1:${lastColumn}${Math.max(lastRow,filterRow)}`;
  return declaration+`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="${range}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${freezeRow}" topLeftCell="A${freezeRow+1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columns.map((width,index)=>`<col min="${index+1}" max="${index+1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.join('')}</sheetData>${merges.length?`<mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`:''}${hyperlinks.length?`<hyperlinks>${hyperlinks.join('')}</hyperlinks>`:''}<autoFilter ref="A${filterRow}:${lastColumn}${Math.max(lastRow,filterRow)}"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="${orientation}" fitToWidth="1" fitToHeight="0" paperSize="9"/></worksheet>`;
}

const headers=['No.','제품명','제조사','공급사','제품 용도','사용장소','보관장소','현재 보유량','보유량 단위','평균 사용량','사용주기','사용량 단위','최신 MSDS 개정일','MSDS 제출번호','관리대상 유해물질','특별관리물질','작업환경측정 대상 유해인자 포함 여부','특수건강진단 대상 유해인자 포함 여부','검토 필요'];
const widths=[7,28,20,20,22,18,18,13,12,13,13,12,16,18,16,16,23,23,12];

export function chemicalWorkbook({companyName,outputDate,departments}) {
  if(!Array.isArray(departments))throw new Error('INVALID_DEPARTMENTS');
  const names=departmentSheetNames(departments),sheets=[];
  const listRows=[row(1,['HSSO MSDS 부서 목록','','','','',''],{height:30,style:1}),row(2,['회사명',companyName,'출력일',outputDate,'',''],{height:22,style:3}),row(4,['No.','부서명','사용 제품 수','MSDS 등록 수','MSDS 미등록 수','확인 필요 수'],{height:32,style:2})];
  const listLinks=[];
  departments.forEach((department,index)=>{
    const number=index+5;
    listRows.push(`<row r="${number}" ht="23" customHeight="1">${cell(`A${number}`,index+1,5)}${cell(`B${number}`,department.name,6)}${cell(`C${number}`,department.productCount,5)}${cell(`D${number}`,department.msdsCount,5)}${cell(`E${number}`,department.missingCount,5)}${cell(`F${number}`,department.reviewCount,5)}</row>`);
    listLinks.push(hyperlink(`B${number}`,names[index],department.name));
  });
  sheets.push({name:'부서 목록',xml:worksheet({rows:listRows,columns:[8,30,15,15,16,15],lastColumn:'F',lastRow:Math.max(4,departments.length+4),hyperlinks:listLinks,merges:['A1:F1'],orientation:'portrait'})});
  departments.forEach((department,index)=>{
    const dataRows=[row(1,['HSSO MSDS 관리대장',...Array(18).fill('')],{height:32,style:1}),
      `<row r="2" ht="24" customHeight="1">${cell('A2','회사명',3)}${cell('B2',companyName,8)}${cell('D2','부서명',3)}${cell('E2',department.name,8)}${cell('G2','출력일',3)}${cell('H2',outputDate,8)}${cell('S2','부서 목록',7)}</row>`,
      row(4,headers,{height:48,style:2})];
    for(const [rowIndex,item] of department.rows.entries()){
      const number=rowIndex+5,values=[rowIndex+1,item.productName,item.manufacturer,item.supplier,item.purpose,item.useLocation,item.storageLocation,item.stockQuantity,item.stockUnit,item.averageUsageQuantity,item.averageUsagePeriod,item.usageUnit,item.revisionDate,item.submissionNumber,item.managed,item.specialManaged,item.workEnvironment,item.specialHealth,item.reviewRequired];
      dataRows.push(`<row r="${number}" ht="42" customHeight="1">${values.map((value,columnIndex)=>cell(`${column(columnIndex)}${number}`,value,[0,7,9].includes(columnIndex)&&typeof value==='number'?5:columnIndex===0?5:4)).join('')}</row>`);
    }
    sheets.push({name:names[index],xml:worksheet({rows:dataRows,columns:widths,lastColumn:'S',lastRow:Math.max(4,department.rows.length+4),hyperlinks:[hyperlink('S2','부서 목록','부서 목록')],merges:['A1:S1']})});
  });
  if(sheets.length>65530)throw new Error('EXCEL_SHEET_LIMIT');
  const files={
    '[Content_Types].xml':declaration+`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,index)=>`<Override PartName="/xl/worksheets/sheet${index+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels':declaration+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':declaration+`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet,index)=>`<sheet name="${xml(sheet.name)}" sheetId="${index+1}" r:id="rId${index+1}"/>`).join('')}</sheets><definedNames>${sheets.map((sheet,index)=>`<definedName name="_xlnm.Print_Titles" localSheetId="${index}">${xml(`'${sheet.name.replaceAll("'","''")}'!$1:$4`)}</definedName>`).join('')}</definedNames></workbook>`,
    'xl/_rels/workbook.xml.rels':declaration+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,index)=>`<Relationship Id="rId${index+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml':styles,
  };
  sheets.forEach((sheet,index)=>{files[`xl/worksheets/sheet${index+1}.xml`]=sheet.xml;});
  return zip(files);
}
