use super::super::super::*;

#[test]
fn docx_table_rows_parse_and_save_basic_cells() {
    let table = r##"<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblBorders><w:top w:val="single" w:sz="6" w:space="0" w:color="1F2937"/></w:tblBorders></w:tblPr><w:tr><w:trPr><w:trHeight w:val="420" w:hRule="atLeast"/><w:tblHeader/></w:trPr><w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DBEAFE"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DBEAFE"/></w:tcPr><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:trPr><w:trHeight w:val="600" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="FFFFFF"/></w:tcPr><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"##;

    let rows = parse_docx_table_rows(table);
    assert_eq!(
        rows,
        vec![
            vec!["A1".to_string(), "B1".to_string()],
            vec!["A2".to_string(), "B2".to_string()],
        ]
    );
    assert_eq!(parse_docx_table_column_widths(table), vec![1800, 3000]);
    assert_eq!(parse_docx_table_row_heights(table), vec![420, 600]);
    assert_eq!(parse_docx_table_style(table), Some("TableGrid".to_string()));
    assert_eq!(
        parse_docx_table_border_color(table),
        Some("#1F2937".to_string())
    );
    assert_eq!(parse_docx_table_border_size(table), Some(6));
    assert_eq!(
        parse_docx_table_cell_background(table),
        Some("#FFFFFF".to_string())
    );
    assert!(parse_docx_table_header_row(table));
    assert_eq!(
        parse_docx_table_header_background(table),
        Some("#DBEAFE".to_string())
    );
    assert_eq!(parse_docx_table_cell_vertical_align(table), Some("center"));

    let xml = build_docx_table(&json!({
        "type": "table",
        "rows": [["C1", "D1"], ["C2", "D2\nD3"]],
        "tableColumnWidths": [1800, 3000],
        "tableRowHeights": [420, 600],
        "tableStyle": "TableGrid",
        "tableBorderColor": "#1F2937",
        "tableBorderSize": 6,
        "tableCellBackground": "#FFFFFF",
        "tableHeaderRow": true,
        "tableHeaderBackground": "#DBEAFE",
        "tableCellVerticalAlign": "center"
    }));
    assert!(xml.contains("<w:tbl>"));
    assert!(xml.contains(r#"<w:tblStyle w:val="TableGrid"/>"#));
    assert!(xml.contains(r#"<w:top w:val="single" w:sz="6" w:space="0" w:color="1F2937"/>"#));
    assert!(xml.contains(r#"<w:tcW w:w="1800" w:type="dxa"/>"#));
    assert!(xml.contains(r#"<w:tcW w:w="3000" w:type="dxa"/>"#));
    assert!(xml.contains(r#"<w:trHeight w:val="420" w:hRule="atLeast"/>"#));
    assert!(xml.contains(r#"<w:trHeight w:val="600" w:hRule="atLeast"/>"#));
    assert!(xml.contains("<w:tblHeader/>"));
    assert!(xml.contains(r#"<w:shd w:val="clear" w:color="auto" w:fill="DBEAFE"/>"#));
    assert!(xml.contains(r#"<w:shd w:val="clear" w:color="auto" w:fill="FFFFFF"/>"#));
    assert!(xml.contains(r#"<w:vAlign w:val="center"/>"#));
    assert!(xml.contains("<w:t xml:space=\"preserve\">C1</w:t>"));
    assert!(xml.contains("<w:t xml:space=\"preserve\">D2</w:t>"));
    assert!(xml.contains("<w:br/><w:t xml:space=\"preserve\">D3</w:t>"));
}

#[test]
fn docx_table_merged_cells_parse_and_save() {
    let table = r#"<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>C1</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>C2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"#;

    let merged_cells = parse_docx_table_merged_cells(table);
    assert_eq!(
        merged_cells,
        vec![json!({"row": 0, "column": 0, "rowSpan": 2, "colSpan": 2})]
    );

    let xml = build_docx_table(&json!({
        "type": "table",
        "rows": [["A1", "", "C1"], ["", "", "C2"]],
        "tableColumnWidths": [1200, 1300, 1400],
        "tableMergedCells": [{"row": 0, "column": 0, "rowSpan": 2, "colSpan": 2}]
    }));
    assert!(xml.contains(r#"<w:gridSpan w:val="2"/>"#));
    assert!(xml.contains(r#"<w:vMerge w:val="restart"/>"#));
    assert!(xml.contains("<w:vMerge/>"));
    assert!(xml.contains(r#"<w:tcW w:w="2500" w:type="dxa"/>"#));
}

#[test]
fn docx_replace_blocks_handles_paragraph_and_table_order() {
    let document = r#"<w:document><w:body><w:p><w:r><w:t>Old paragraph</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Old cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#;
    let blocks = vec![
        json!({ "type": "paragraph", "text": "New paragraph" }),
        json!({ "type": "table", "rows": [["New cell"]] }),
    ];

    let updated = replace_docx_blocks(document, &blocks);

    assert!(updated.contains("<w:t xml:space=\"preserve\">New paragraph</w:t>"));
    assert!(updated.contains("<w:t xml:space=\"preserve\">New cell</w:t>"));
}
