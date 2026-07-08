use super::super::super::*;
use super::super::common::*;

#[test]
fn ooxml_chart_series_reads_range_formulas() {
    let chart_xml = r#"<c:chartSpace><c:chart><c:plotArea><c:barChart><c:ser><c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:pt idx="0"><c:v>Actual</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:f>Sheet1!$A$2:$A$3</c:f><c:strCache><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>"#;
    let series = ooxml_chart_series(chart_xml);

    assert_eq!(series[0]["name"], "Actual");
    assert_eq!(series[0]["nameFormula"], "Sheet1!$B$1");
    assert_eq!(series[0]["categoriesFormula"], "Sheet1!$A$2:$A$3");
    assert_eq!(series[0]["valuesFormula"], "Sheet1!$B$2:$B$3");
}

#[test]
fn xlsx_update_rewrites_chart_range_formulas_and_inserts_series() {
    let chart_xml = r#"<c:chartSpace><c:chart><c:plotArea><c:barChart><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:pt idx="0"><c:v>Actual</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:f>Sheet1!$A$2:$A$3</c:f><c:strCache><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/></c:catAx><c:valAx><c:axId val="2"/></c:valAx></c:plotArea></c:chart></c:chartSpace>"#;
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
                "series": [
                    {
                        "name": "Updated actual",
                        "nameFormula": "Sheet1!$C$1",
                        "categories": ["Q1", "Q2", "Q3"],
                        "categoriesFormula": "Sheet1!$A$2:$A$4",
                        "values": ["11", "22", "33"],
                        "valuesFormula": "Sheet1!$C$2:$C$4"
                    },
                    {
                        "name": "Projected",
                        "nameFormula": "Sheet1!$D$1",
                        "categoriesFormula": "Sheet1!$A$2:$A$4",
                        "valuesFormula": "Sheet1!$D$2:$D$4"
                    }
                ]
            }]
        }]
    });

    let updated = update_xlsx(&original, &model).unwrap();
    let chart = read_zip_text(&updated, "xl/charts/chart1.xml").unwrap();

    assert!(chart.contains("<c:f>Sheet1!$C$1</c:f>"));
    assert!(chart.contains("<c:f>Sheet1!$A$2:$A$4</c:f>"));
    assert!(chart.contains("<c:f>Sheet1!$C$2:$C$4</c:f>"));
    assert!(chart.contains(">33<"));
    assert!(chart.contains(r#"<c:idx val="1"/><c:order val="1"/>"#));
    assert!(chart.contains("<c:f>Sheet1!$D$1</c:f>"));
    assert!(chart.contains("<c:f>Sheet1!$D$2:$D$4</c:f>"));
    assert!(chart.find(r#"<c:idx val="1""#).unwrap() < chart.find(r#"<c:axId val="1""#).unwrap());
}

#[test]
fn xlsx_update_rewrites_pivot_table_name() {
    let original = test_ooxml_package(&[
        (
            "xl/worksheets/sheet1.xml",
            r#"<worksheet><sheetData/></worksheet>"#,
        ),
        (
            "xl/pivotTables/pivotTable1.xml",
            r#"<pivotTableDefinition name="Old Pivot" cacheId="1"></pivotTableDefinition>"#,
        ),
    ]);
    let model = json!({
        "sheets": [{
            "id": "xl/worksheets/sheet1.xml",
            "name": "Sheet1",
            "rows": [],
            "pivots": [{
                "id": "rIdPivot",
                "path": "xl/pivotTables/pivotTable1.xml",
                "name": "Updated Pivot"
            }]
        }]
    });

    let updated = update_xlsx(&original, &model).unwrap();
    let pivot = read_zip_text(&updated, "xl/pivotTables/pivotTable1.xml").unwrap();

    assert!(pivot.contains(r#"name="Updated Pivot""#));
    assert!(pivot.contains(r#"cacheId="1""#));
    assert!(!pivot.contains("Old Pivot"));
}

#[test]
fn xlsx_update_rewrites_pivot_fields_and_data_fields() {
    let original = test_ooxml_package(&[
        (
            "xl/worksheets/sheet1.xml",
            r#"<worksheet><sheetData/></worksheet>"#,
        ),
        (
            "xl/pivotTables/pivotTable1.xml",
            r#"<pivotTableDefinition name="Old Pivot" cacheId="1"><pivotFields count="3"><pivotField name="Region" axis="axisRow" showAll="0" defaultSubtotal="1"/><pivotField name="Quarter" axis="axisCol"/><pivotField name="Revenue" dataField="1" sumSubtotal="1"/></pivotFields><rowFields count="1"><field x="0"/></rowFields><colFields count="1"><field x="1"/></colFields><dataFields count="1"><dataField fld="2" name="Sum of Revenue" subtotal="sum"/></dataFields></pivotTableDefinition>"#,
        ),
    ]);
    let model = json!({
        "sheets": [{
            "id": "xl/worksheets/sheet1.xml",
            "name": "Sheet1",
            "rows": [],
            "pivots": [{
                "id": "rIdPivot",
                "path": "xl/pivotTables/pivotTable1.xml",
                "name": "Updated Pivot",
                "fields": [
                    {
                        "index": 0,
                        "name": "Region",
                        "axis": "axisCol",
                        "dataField": false,
                        "showAll": true,
                        "defaultSubtotal": false,
                        "subtotal": "countA"
                    },
                    {
                        "index": 1,
                        "name": "Quarter",
                        "axis": "axisRow",
                        "dataField": false
                    },
                    {
                        "index": 2,
                        "name": "Revenue",
                        "axis": "axisValues",
                        "dataField": true,
                        "subtotal": "sum"
                    }
                ],
                "dataFields": [{
                    "fieldIndex": 2,
                    "name": "Average Revenue",
                    "subtotal": "average"
                }]
            }]
        }]
    });

    let updated = update_xlsx(&original, &model).unwrap();
    let pivot = read_zip_text(&updated, "xl/pivotTables/pivotTable1.xml").unwrap();

    assert!(pivot.contains(r#"name="Updated Pivot""#));
    assert!(pivot.contains(r#"name="Region" axis="axisCol""#));
    assert!(pivot.contains(r#"showAll="1""#));
    assert!(pivot.contains(r#"defaultSubtotal="0""#));
    assert!(pivot.contains(r#"countASubtotal="1""#));
    assert!(pivot.contains(r#"name="Quarter" axis="axisRow""#));
    assert!(pivot.contains(r#"name="Revenue""#));
    assert!(pivot.contains(r#"axis="axisValues""#));
    assert!(pivot.contains(r#"dataField="1""#));
    assert!(pivot.contains(r#"sumSubtotal="1""#));
    assert!(pivot.contains(r#"<rowFields count="1"><field x="1"/></rowFields>"#));
    assert!(pivot.contains(r#"<colFields count="1"><field x="0"/></colFields>"#));
    assert!(pivot.contains(
        r#"<dataFields count="1"><dataField fld="2" name="Average Revenue" subtotal="average"/></dataFields>"#
    ));
}
