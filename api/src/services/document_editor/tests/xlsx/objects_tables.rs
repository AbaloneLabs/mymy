use super::super::super::*;
use super::super::common::*;

#[test]
fn xlsx_sheet_objects_parse_charts_images_and_pivots() {
    let sheet_xml = r#"<worksheet><drawing r:id="rIdDrawing"/><tableParts count="1"><tablePart r:id="rIdTable"/></tableParts><pivotTableDefinitions><pivotTableDefinition r:id="rIdPivot"/></pivotTableDefinitions></worksheet>"#;
    let sheet_rels = r#"<Relationships><Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/><Relationship Id="rIdTable" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/><Relationship Id="rIdPivot" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable" Target="../pivotTables/pivotTable1.xml"/></Relationships>"#;
    let drawing_xml = r#"<xdr:wsDr><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:row>2</xdr:row></xdr:from><xdr:to><xdr:col>4</xdr:col><xdr:row>9</xdr:row></xdr:to><xdr:graphicFrame><a:graphic><a:graphicData><c:chart r:id="rIdChart"/></a:graphicData></a:graphic></xdr:graphicFrame></xdr:twoCellAnchor><xdr:oneCellAnchor><xdr:from><xdr:col>5</xdr:col><xdr:row>6</xdr:row></xdr:from><xdr:pic><xdr:blipFill><a:blip r:embed="rIdImage"/></xdr:blipFill></xdr:pic></xdr:oneCellAnchor></xdr:wsDr>"#;
    let drawing_rels = r#"<Relationships><Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>"#;
    let chart_xml = r#"<c:chartSpace><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Revenue</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:ser><c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>Series A</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>Q1</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>120</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:axPos val="b"/><c:title><c:tx><c:rich><a:p><a:r><a:t>Quarter</a:t></a:r></a:p></c:rich></c:tx></c:title><c:tickLblPos val="nextTo"/></c:catAx><c:valAx><c:axId val="2"/><c:axPos val="l"/><c:majorGridlines/><c:title><c:tx><c:rich><a:p><a:r><a:t>Amount</a:t></a:r></a:p></c:rich></c:tx></c:title></c:valAx></c:plotArea><c:legend><c:legendPos val="b"/></c:legend></c:chart></c:chartSpace>"#;
    let table_xml = r#"<table name="Table1" displayName="Sales" ref="A1:B3" totalsRowShown="1"><autoFilter ref="A1:B3"/><tableColumns count="2"><tableColumn id="1" name="Region"/><tableColumn id="2" name="Revenue" totalsRowFunction="sum"/></tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="1" showRowStripes="1" showColumnStripes="0"/></table>"#;
    let pivot_xml = r#"<pivotTableDefinition name="Pivot A" cacheId="3"><pivotFields count="3"><pivotField name="Region" axis="axisRow" showAll="0" defaultSubtotal="1"/><pivotField name="Quarter" axis="axisCol" showAll="1"/><pivotField name="Revenue" dataField="1" sumSubtotal="1"/></pivotFields><rowFields count="1"><field x="0"/></rowFields><colFields count="1"><field x="1"/></colFields><dataFields count="1"><dataField fld="2" name="Sum of Revenue" subtotal="sum"/></dataFields></pivotTableDefinition>"#;
    let bytes = test_ooxml_package(&[
        ("xl/drawings/drawing1.xml", drawing_xml),
        ("xl/drawings/_rels/drawing1.xml.rels", drawing_rels),
        ("xl/charts/chart1.xml", chart_xml),
        ("xl/media/image1.png", "png-bytes"),
        ("xl/tables/table1.xml", table_xml),
        ("xl/pivotTables/pivotTable1.xml", pivot_xml),
    ]);

    let objects = parse_xlsx_sheet_objects(
        &bytes,
        "xl/worksheets/sheet1.xml",
        sheet_xml,
        Some(sheet_rels),
    );

    assert_eq!(objects.charts[0]["path"], "xl/charts/chart1.xml");
    assert_eq!(objects.charts[0]["type"], "bar");
    assert_eq!(objects.charts[0]["title"], "Revenue");
    assert_eq!(objects.charts[0]["legendVisible"], true);
    assert_eq!(objects.charts[0]["legendPosition"], "b");
    assert_eq!(objects.charts[0]["categoryAxisTitle"], "Quarter");
    assert_eq!(objects.charts[0]["categoryAxisPosition"], "b");
    assert_eq!(objects.charts[0]["categoryAxisTickLabelPosition"], "nextTo");
    assert_eq!(objects.charts[0]["valueAxisTitle"], "Amount");
    assert_eq!(objects.charts[0]["valueAxisPosition"], "l");
    assert_eq!(objects.charts[0]["valueMajorGridlines"], true);
    assert_eq!(objects.charts[0]["categories"][0], "Q1");
    assert_eq!(objects.charts[0]["series"][0]["values"][0], "120");
    assert_eq!(objects.charts[0]["anchor"]["from"]["column"], 1);
    assert_eq!(objects.images[0]["mediaPath"], "xl/media/image1.png");
    assert_eq!(objects.images[0]["mimeType"], "image/png");
    assert!(objects.images[0]["dataUrl"]
        .as_str()
        .unwrap()
        .starts_with("data:image/png;base64,"));
    assert_eq!(objects.tables[0]["path"], "xl/tables/table1.xml");
    assert_eq!(objects.tables[0]["displayName"], "Sales");
    assert_eq!(objects.tables[0]["ref"], "A1:B3");
    assert_eq!(objects.tables[0]["autoFilterRef"], "A1:B3");
    assert_eq!(objects.tables[0]["totalsRowShown"], true);
    assert_eq!(objects.tables[0]["tableStyleName"], "TableStyleMedium2");
    assert_eq!(objects.tables[0]["showLastColumn"], true);
    assert_eq!(objects.tables[0]["showRowStripes"], true);
    assert_eq!(objects.tables[0]["columns"][1]["name"], "Revenue");
    assert_eq!(objects.tables[0]["columns"][1]["totalsRowFunction"], "sum");
    assert_eq!(objects.pivots[0]["path"], "xl/pivotTables/pivotTable1.xml");
    assert_eq!(objects.pivots[0]["name"], "Pivot A");
    assert_eq!(objects.pivots[0]["cacheId"], "3");
    assert_eq!(objects.pivots[0]["fields"][0]["name"], "Region");
    assert_eq!(objects.pivots[0]["fields"][0]["axis"], "axisRow");
    assert_eq!(objects.pivots[0]["fields"][0]["showAll"], false);
    assert_eq!(objects.pivots[0]["fields"][0]["defaultSubtotal"], true);
    assert_eq!(objects.pivots[0]["fields"][1]["axis"], "axisCol");
    assert_eq!(objects.pivots[0]["fields"][2]["dataField"], true);
    assert_eq!(objects.pivots[0]["fields"][2]["subtotal"], "sum");
    assert_eq!(objects.pivots[0]["dataFields"][0]["fieldIndex"], 2);
    assert_eq!(objects.pivots[0]["dataFields"][0]["name"], "Sum of Revenue");
    assert_eq!(objects.pivots[0]["dataFields"][0]["subtotal"], "sum");
}

#[test]
fn xlsx_table_update_writes_table_metadata() {
    let xml = r#"<table name="OldTable" displayName="Old" ref="A1:B3" totalsRowShown="0"><autoFilter ref="A1:B3"/><tableColumns count="2"><tableColumn id="1" name="Old A"/><tableColumn id="2" name="Old B"/></tableColumns><tableStyleInfo name="TableStyleLight1" showRowStripes="1"/></table>"#;
    let table = json!({
        "name": "Table1",
        "displayName": "Sales",
        "ref": "A1:C5",
        "autoFilterRef": "A1:C5",
        "totalsRowShown": true,
        "tableStyleName": "TableStyleMedium9",
        "showFirstColumn": true,
        "showLastColumn": false,
        "showRowStripes": true,
        "showColumnStripes": true,
        "columns": [
            { "id": "1", "name": "Region" },
            { "id": "2", "name": "Revenue", "totalsRowFunction": "sum" },
            { "id": "3", "name": "Margin", "totalsRowFunction": "average" }
        ]
    });

    let updated = update_xlsx_table_xml(xml, &table);

    assert!(updated
        .contains(r#"<table name="Table1" displayName="Sales" ref="A1:C5" totalsRowShown="1">"#));
    assert!(updated.contains(r#"<autoFilter ref="A1:C5"/>"#));
    assert!(updated.contains(r#"<tableColumns count="3">"#));
    assert!(updated.contains(r#"<tableColumn id="2" name="Revenue" totalsRowFunction="sum"/>"#));
    assert!(updated.contains(
        r#"<tableStyleInfo name="TableStyleMedium9" showFirstColumn="1" showLastColumn="0" showRowStripes="1" showColumnStripes="1"/>"#
    ));
    assert!(!updated.contains("OldTable"));
}

#[test]
fn xlsx_update_creates_new_table_part() {
    let original = test_ooxml_package(&[
        (
            "[Content_Types].xml",
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>"#,
        ),
        (
            "xl/workbook.xml",
            r#"<workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
        ),
        (
            "xl/_rels/workbook.xml.rels",
            r#"<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#,
        ),
        (
            "xl/worksheets/sheet1.xml",
            r#"<worksheet><sheetData/></worksheet>"#,
        ),
    ]);
    let model = json!({
        "sheets": [{
            "id": "xl/worksheets/sheet1.xml",
            "name": "Sheet1",
            "rows": [],
            "tables": [{
                "id": "table-local-1",
                "name": "Table1",
                "displayName": "Table1",
                "ref": "A1:B3",
                "autoFilterRef": "A1:B3",
                "totalsRowShown": true,
                "tableStyleName": "TableStyleMedium2",
                "showRowStripes": true,
                "columns": [
                    { "id": "1", "name": "Region" },
                    { "id": "2", "name": "Revenue", "totalsRowFunction": "sum" }
                ]
            }]
        }]
    });

    let updated = update_xlsx(&original, &model).unwrap();
    let worksheet = read_zip_text(&updated, "xl/worksheets/sheet1.xml").unwrap();
    let rels = read_zip_text(&updated, "xl/worksheets/_rels/sheet1.xml.rels").unwrap();
    let table = read_zip_text(&updated, "xl/tables/table1.xml").unwrap();
    let content_types = read_zip_text(&updated, "[Content_Types].xml").unwrap();

    assert!(worksheet.contains(
        r#"xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#
    ));
    assert!(worksheet.contains(r#"<tableParts count="1"><tablePart r:id="rId1"/></tableParts>"#));
    assert!(rels.contains(
        r#"Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table""#
    ));
    assert!(rels.contains(r#"Target="../tables/table1.xml""#));
    assert!(table.contains(r#"<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="Table1" displayName="Table1" ref="A1:B3" totalsRowShown="1">"#));
    assert!(table.contains(r#"<autoFilter ref="A1:B3"/>"#));
    assert!(table.contains(r#"<tableColumn id="2" name="Revenue" totalsRowFunction="sum"/>"#));
    assert!(content_types.contains(r#"PartName="/xl/tables/table1.xml""#));
}

#[test]
fn xlsx_update_rewrites_chart_title_metadata_and_cached_series_values() {
    let chart_xml = r#"<c:chartSpace><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Revenue</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:ser><c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>Series A</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>Q1</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>120</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/></c:catAx><c:valAx><c:axId val="2"/><c:axPos val="l"/></c:valAx></c:plotArea><c:legend><c:legendPos val="r"/></c:legend></c:chart></c:chartSpace>"#;
    let original = test_ooxml_package(&[
        (
            "xl/worksheets/sheet1.xml",
            r#"<worksheet><sheetData/></worksheet>"#,
        ),
        ("xl/charts/chart1.xml", chart_xml),
    ]);
    let model = json!({
        "sheets": [{
            "id": "xl/worksheets/sheet1.xml",
            "name": "Sheet1",
            "rows": [],
            "charts": [{
                "id": "rIdChart",
                "path": "xl/charts/chart1.xml",
                "type": "line",
                "title": "Updated revenue",
                "legendVisible": true,
                "legendPosition": "b",
                "categoryAxisTitle": "Quarter",
                "categoryAxisPosition": "t",
                "categoryAxisTickLabelPosition": "low",
                "valueAxisTitle": "Amount",
                "valueAxisPosition": "r",
                "valueMajorGridlines": true,
                "valueAxisNumberFormat": "$#,##0",
                "series": [{
                    "name": "Updated series",
                    "categories": ["Q2"],
                    "values": ["240"]
                }]
            }]
        }]
    });

    let updated = update_xlsx(&original, &model).unwrap();
    let chart = read_zip_text(&updated, "xl/charts/chart1.xml").unwrap();

    assert!(chart.contains(">Updated revenue<"));
    assert!(chart.contains("<c:lineChart>"));
    assert!(chart.contains(r#"<c:legendPos val="b"/>"#));
    assert!(chart.contains(">Quarter<"));
    assert!(chart.contains(r#"<c:axPos val="t"/>"#));
    assert!(chart.contains(r#"<c:tickLblPos val="low"/>"#));
    assert!(chart.contains(">Amount<"));
    assert!(chart.contains(r#"<c:axPos val="r"/>"#));
    assert!(chart.contains(r#"<c:majorGridlines/>"#));
    assert!(chart.contains(r#"formatCode="$#,##0""#));
    assert!(chart.contains(">Updated series<"));
    assert!(chart.contains(">Q2<"));
    assert!(chart.contains(">240<"));
    assert!(!chart.contains(">120<"));
}
