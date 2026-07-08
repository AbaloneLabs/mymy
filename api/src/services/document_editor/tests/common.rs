use std::io::{Cursor, Write};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use super::super::*;

pub(super) fn pptx_test_content_types(include_notes: bool) -> &'static str {
    if include_notes {
        r#"<Types><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/></Types>"#
    } else {
        r#"<Types><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>"#
    }
}

pub(super) fn pptx_test_presentation_xml() -> &'static str {
    r#"<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>"#
}

pub(super) fn pptx_test_presentation_rels() -> &'static str {
    r#"<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>"#
}

pub(super) fn pptx_test_slide_xml(text: &str) -> String {
    format!(
        r#"<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>"#,
        escape_xml(text)
    )
}

pub(super) fn pptx_test_notes_xml(text: &str) -> String {
    format!(
        r#"<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>{}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>"#,
        escape_xml(text)
    )
}

pub(super) fn pptx_test_slide_with_table_xml(title: &str, rows: &[&[&str]]) -> String {
    let column_count = rows.iter().map(|row| row.len()).max().unwrap_or(1).max(1);
    let table_grid = (0..column_count)
        .map(|index| format!(r#"<a:gridCol w="{}"/>"#, (index + 1) * 1200))
        .collect::<Vec<_>>()
        .join("");
    let table_rows = rows
        .iter()
        .enumerate()
        .map(|(row_index, row)| {
            let cells = row
                .iter()
                .map(|cell| {
                    format!(
                        r#"<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{}</a:t></a:r></a:p></a:txBody></a:tc>"#,
                        escape_xml(cell)
                    )
                })
                .collect::<Vec<_>>()
                .join("");
            format!(r#"<a:tr h="{}">{cells}</a:tr>"#, (row_index + 1) * 1000)
        })
        .collect::<Vec<_>>()
        .join("");
    format!(
        r#"<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{}</a:t></a:r></a:p></p:txBody></p:sp><p:graphicFrame><p:xfrm><a:off x="914400" y="914400"/><a:ext cx="3657600" cy="1828800"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{{11111111-1111-1111-1111-111111111111}}</a:tableStyleId></a:tblPr><a:tblGrid>{table_grid}</a:tblGrid>{table_rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>"#,
        escape_xml(title)
    )
}

pub(super) fn pptx_test_slide_with_image_xml(relationship_id: &str, alt_text: &str) -> String {
    format!(
        r#"<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:pic><p:nvPicPr><p:cNvPr id="7" name="Picture 7" descr="{}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="{}"/><a:srcRect l="3000" t="4000" r="5000" b="6000"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="914400" y="514350"/><a:ext cx="1828800" cy="1028700"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld></p:sld>"#,
        escape_xml(alt_text),
        escape_xml(relationship_id)
    )
}

pub(super) fn pptx_test_slide_with_chart_xml(relationship_id: &str) -> String {
    format!(
        r#"<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="8" name="Chart 8"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="914400" y="514350"/><a:ext cx="3657600" cy="1543050"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="{}"/></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>"#,
        escape_xml(relationship_id)
    )
}

pub(super) fn pptx_test_slide_with_media_xml(relationship_id: &str) -> String {
    format!(
        r#"<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:pic><p:nvPicPr><p:cNvPr id="6" name="Movie 1" descr="Demo video"/><p:cNvPicPr/><p:nvPr><a:videoFile r:link="{}"/></p:nvPr></p:nvPicPr><p:blipFill/><p:spPr><a:xfrm><a:off x="914400" y="514350"/><a:ext cx="1828800" cy="1028700"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld><p:timing><p:tnLst><p:par><p:cTn id="5"><p:childTnLst><p:video><p:cMediaNode vol="75000" mute="0" showWhenStopped="1"><p:cTn id="7" delay="250" dur="2000"><p:tgtEl><p:spTgt spid="6"/></p:tgtEl></p:cTn></p:cMediaNode></p:video></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing></p:sld>"#,
        escape_xml(relationship_id)
    )
}

pub(super) fn pptx_test_theme_xml() -> &'static str {
    r#"<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Mymy Theme"><a:themeElements><a:clrScheme name="Mymy Colors"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Mymy Fonts"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>"#
}

pub(super) fn pptx_test_chart_xml(title: &str, category: &str, value: &str) -> String {
    format!(
        r##"<c:chartSpace xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>{}</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>Series A</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>{}</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>{}</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:axId val="123456"/><c:axId val="123457"/></c:barChart><c:catAx><c:axId val="123456"/><c:scaling/><c:axPos val="b"/><c:numFmt formatCode="mmm yyyy" sourceLinked="0"/><c:title><c:tx><c:rich><a:p><a:r><a:t>Quarter</a:t></a:r></a:p></c:rich></c:tx></c:title><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="25400"><a:solidFill><a:srgbClr val="64748B"/></a:solidFill><a:prstDash val="dash"/></a:ln></c:spPr><c:txPr><a:bodyPr rot="1800000"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="0" i="1"><a:solidFill><a:srgbClr val="222222"/></a:solidFill></a:defRPr></a:pPr></a:p></c:txPr><c:crossAx val="123457"/></c:catAx><c:valAx><c:axId val="123457"/><c:scaling/><c:axPos val="l"/><c:numFmt formatCode="#,##0" sourceLinked="0"/><c:majorGridlines/><c:title><c:tx><c:rich><a:p><a:r><a:t>Amount</a:t></a:r></a:p></c:rich></c:tx></c:title><c:spPr><a:ln w="38100"><a:solidFill><a:srgbClr val="94A3B8"/></a:solidFill><a:prstDash val="dot"/></a:ln></c:spPr><c:txPr><a:bodyPr rot="-2700000"/><a:lstStyle/><a:p/></c:txPr><c:crossAx val="123456"/></c:valAx></c:plotArea><c:legend><c:legendPos val="r"/><c:layout/><c:overlay val="0"/></c:legend></c:chart></c:chartSpace>"##,
        escape_xml(title),
        escape_xml(category),
        escape_xml(value)
    )
}

pub(super) fn test_ooxml_package(entries: &[(&str, &str)]) -> Vec<u8> {
    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (path, content) in entries {
        writer.start_file(path, options).unwrap();
        writer.write_all(content.as_bytes()).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

pub(super) fn warning_codes(warnings: &[DocumentCompatibilityWarning]) -> Vec<&str> {
    warnings
        .iter()
        .map(|warning| warning.code.as_str())
        .collect()
}
