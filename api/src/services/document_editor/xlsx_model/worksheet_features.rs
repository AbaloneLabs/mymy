use super::*;

pub(in crate::services::document_editor) fn build_sheet_data_validations(
    validations: &[SheetDataValidation],
) -> String {
    if validations.is_empty() {
        return String::new();
    }
    let children = validations
        .iter()
        .map(build_sheet_data_validation)
        .collect::<String>();
    format!(
        r#"<dataValidations count="{}">{children}</dataValidations>"#,
        validations.len()
    )
}

pub(in crate::services::document_editor) fn build_sheet_data_validation(
    validation: &SheetDataValidation,
) -> String {
    let mut attrs = vec![format!(r#"sqref="{}""#, escape_xml(&validation.sqref))];
    if let Some(validation_type) = &validation.validation_type {
        attrs.push(format!(r#"type="{}""#, escape_xml(validation_type)));
    }
    if let Some(operator) = &validation.operator {
        attrs.push(format!(r#"operator="{}""#, escape_xml(operator)));
    }
    if validation.allow_blank {
        attrs.push(r#"allowBlank="1""#.to_string());
    }
    if validation.show_input_message {
        attrs.push(r#"showInputMessage="1""#.to_string());
    }
    if validation.show_error_message {
        attrs.push(r#"showErrorMessage="1""#.to_string());
    }
    if let Some(prompt_title) = &validation.prompt_title {
        attrs.push(format!(r#"promptTitle="{}""#, escape_xml(prompt_title)));
    }
    if let Some(prompt) = &validation.prompt {
        attrs.push(format!(r#"prompt="{}""#, escape_xml(prompt)));
    }
    if let Some(error_title) = &validation.error_title {
        attrs.push(format!(r#"errorTitle="{}""#, escape_xml(error_title)));
    }
    if let Some(error) = &validation.error {
        attrs.push(format!(r#"error="{}""#, escape_xml(error)));
    }
    let formula1 = validation
        .formula1
        .as_deref()
        .map(|formula| format!("<formula1>{}</formula1>", escape_xml(formula)))
        .unwrap_or_default();
    let formula2 = validation
        .formula2
        .as_deref()
        .map(|formula| format!("<formula2>{}</formula2>", escape_xml(formula)))
        .unwrap_or_default();
    if formula1.is_empty() && formula2.is_empty() {
        format!("<dataValidation {}/>", attrs.join(" "))
    } else {
        format!(
            "<dataValidation {}>{formula1}{formula2}</dataValidation>",
            attrs.join(" ")
        )
    }
}

pub(in crate::services::document_editor) fn update_sheet_data_validations(
    xml: &str,
    validations: &[SheetDataValidation],
) -> String {
    let validations_xml = build_sheet_data_validations(validations);
    if let Some(replaced) = replace_xml_element(xml, "dataValidations", &validations_xml) {
        return replaced;
    }
    if xml.contains("<dataValidations") {
        return replace_empty_xml_element(xml, "<dataValidations", &validations_xml);
    }
    if validations_xml.is_empty() {
        return xml.to_string();
    }
    if let Some(index) = xml.find("</mergeCells>") {
        let insert_at = index + "</mergeCells>".len();
        let mut output = String::new();
        output.push_str(&xml[..insert_at]);
        output.push_str(&validations_xml);
        output.push_str(&xml[insert_at..]);
        return output;
    }
    if let Some(index) = xml.find("</sheetData>") {
        let insert_at = index + "</sheetData>".len();
        let mut output = String::new();
        output.push_str(&xml[..insert_at]);
        output.push_str(&validations_xml);
        output.push_str(&xml[insert_at..]);
        return output;
    }
    append_before_or_end(xml, "</worksheet>", &validations_xml)
}

pub(in crate::services::document_editor) fn build_sheet_conditional_formattings(
    formatings: &[SheetConditionalFormatting],
) -> String {
    formatings
        .iter()
        .filter(|formatting| valid_xlsx_sqref(&formatting.sqref))
        .filter_map(|formatting| {
            let rules = formatting
                .rules
                .iter()
                .enumerate()
                .filter_map(|(index, rule)| build_sheet_conditional_rule(rule, index + 1))
                .collect::<String>();
            if rules.is_empty() {
                return None;
            }
            Some(format!(
                r#"<conditionalFormatting sqref="{}">{rules}</conditionalFormatting>"#,
                escape_xml(&formatting.sqref)
            ))
        })
        .collect::<String>()
}

pub(in crate::services::document_editor) fn build_sheet_conditional_rule(
    rule: &SheetConditionalRule,
    fallback_priority: usize,
) -> Option<String> {
    if let Some(source_xml) = rule.source_xml.as_deref() {
        return Some(source_xml.to_string());
    }
    let rule_type = rule.rule_type.as_deref()?;
    if !valid_xlsx_conditional_rule_type(rule_type) {
        return None;
    }
    let priority = rule.priority.unwrap_or(fallback_priority as u32);
    let mut attrs = vec![
        format!(r#"type="{}""#, escape_xml(rule_type)),
        format!(r#"priority="{priority}""#),
    ];
    if let Some(operator) = &rule.operator {
        attrs.push(format!(r#"operator="{}""#, escape_xml(operator)));
    }
    if let Some(dxf_id) = rule.dxf_id {
        attrs.push(format!(r#"dxfId="{dxf_id}""#));
    }
    if let Some(text) = &rule.text {
        attrs.push(format!(r#"text="{}""#, escape_xml(text)));
    }
    if let Some(time_period) = &rule.time_period {
        attrs.push(format!(r#"timePeriod="{}""#, escape_xml(time_period)));
    }
    let formulas = rule
        .formulas
        .iter()
        .map(|formula| format!("<formula>{}</formula>", escape_xml(formula)))
        .collect::<String>();
    if formulas.is_empty() {
        Some(format!("<cfRule {}/>", attrs.join(" ")))
    } else {
        Some(format!("<cfRule {}>{formulas}</cfRule>", attrs.join(" ")))
    }
}

pub(in crate::services::document_editor) fn update_sheet_conditional_formattings(
    xml: &str,
    formatings: &[SheetConditionalFormatting],
) -> String {
    let formattings_xml = build_sheet_conditional_formattings(formatings);
    let stripped = remove_xml_named_elements(xml, "conditionalFormatting");
    if formattings_xml.is_empty() {
        return stripped;
    }
    if let Some(index) = stripped.find("</mergeCells>") {
        let insert_at = index + "</mergeCells>".len();
        let mut output = String::new();
        output.push_str(&stripped[..insert_at]);
        output.push_str(&formattings_xml);
        output.push_str(&stripped[insert_at..]);
        return output;
    }
    if let Some(index) = stripped.find("<dataValidations") {
        let mut output = String::new();
        output.push_str(&stripped[..index]);
        output.push_str(&formattings_xml);
        output.push_str(&stripped[index..]);
        return output;
    }
    if let Some(index) = stripped.find("</sheetData>") {
        let insert_at = index + "</sheetData>".len();
        let mut output = String::new();
        output.push_str(&stripped[..insert_at]);
        output.push_str(&formattings_xml);
        output.push_str(&stripped[insert_at..]);
        return output;
    }
    append_before_or_end(&stripped, "</worksheet>", &formattings_xml)
}

pub(in crate::services::document_editor) fn build_sheet_protection(
    protection: Option<&SheetProtection>,
) -> String {
    let Some(protection) = protection.filter(|protection| protection.enabled) else {
        return String::new();
    };
    let mut attrs = vec![r#"sheet="1""#.to_string()];
    if let Some(password) = &protection.password {
        attrs.push(format!(r#"password="{}""#, escape_xml(password)));
    }
    for (enabled, xml_key) in [
        (protection.objects, "objects"),
        (protection.scenarios, "scenarios"),
        (protection.format_cells, "formatCells"),
        (protection.format_columns, "formatColumns"),
        (protection.format_rows, "formatRows"),
        (protection.insert_columns, "insertColumns"),
        (protection.insert_rows, "insertRows"),
        (protection.insert_hyperlinks, "insertHyperlinks"),
        (protection.delete_columns, "deleteColumns"),
        (protection.delete_rows, "deleteRows"),
        (protection.sort, "sort"),
        (protection.auto_filter, "autoFilter"),
        (protection.pivot_tables, "pivotTables"),
    ] {
        if enabled {
            attrs.push(format!(r#"{xml_key}="1""#));
        }
    }
    format!("<sheetProtection {}/>", attrs.join(" "))
}

pub(in crate::services::document_editor) fn update_sheet_protection(
    xml: &str,
    protection: Option<&SheetProtection>,
) -> String {
    let protection_xml = build_sheet_protection(protection);
    if let Some(replaced) = replace_xml_element(xml, "sheetProtection", &protection_xml) {
        return replaced;
    }
    if xml.contains("<sheetProtection") {
        return replace_empty_xml_element(xml, "<sheetProtection", &protection_xml);
    }
    if protection_xml.is_empty() {
        return xml.to_string();
    }
    if let Some(index) = xml.find("</sheetData>") {
        let insert_at = index + "</sheetData>".len();
        let mut output = String::new();
        output.push_str(&xml[..insert_at]);
        output.push_str(&protection_xml);
        output.push_str(&xml[insert_at..]);
        return output;
    }
    append_before_or_end(xml, "</worksheet>", &protection_xml)
}

pub(in crate::services::document_editor) fn build_sheet_page_margins(
    margins: Option<&SheetPageMargins>,
) -> String {
    let Some(margins) = margins else {
        return String::new();
    };
    let mut attrs = Vec::new();
    for (value, key) in [
        (margins.left, "left"),
        (margins.right, "right"),
        (margins.top, "top"),
        (margins.bottom, "bottom"),
        (margins.header, "header"),
        (margins.footer, "footer"),
    ] {
        if let Some(value) = value {
            attrs.push(format!(r#"{key}="{}""#, trim_float(value)));
        }
    }
    if attrs.is_empty() {
        String::new()
    } else {
        format!("<pageMargins {}/>", attrs.join(" "))
    }
}

pub(in crate::services::document_editor) fn update_sheet_page_margins(
    xml: &str,
    margins: Option<&SheetPageMargins>,
) -> String {
    let margins_xml = build_sheet_page_margins(margins);
    if let Some(replaced) = replace_xml_element(xml, "pageMargins", &margins_xml) {
        return replaced;
    }
    if xml.contains("<pageMargins") {
        return replace_empty_xml_element(xml, "<pageMargins", &margins_xml);
    }
    if margins_xml.is_empty() {
        return xml.to_string();
    }
    if let Some(index) = xml.find("<pageSetup") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&margins_xml);
        output.push_str(&xml[index..]);
        return output;
    }
    append_before_or_end(xml, "</worksheet>", &margins_xml)
}

pub(in crate::services::document_editor) fn build_sheet_page_setup(
    setup: Option<&SheetPageSetup>,
) -> String {
    let Some(setup) = setup else {
        return String::new();
    };
    let mut attrs = Vec::new();
    if let Some(orientation) = &setup.orientation {
        attrs.push(format!(r#"orientation="{}""#, escape_xml(orientation)));
    }
    for (value, key) in [
        (setup.paper_size, "paperSize"),
        (setup.scale, "scale"),
        (setup.fit_to_width, "fitToWidth"),
        (setup.fit_to_height, "fitToHeight"),
    ] {
        if let Some(value) = value {
            attrs.push(format!(r#"{key}="{value}""#));
        }
    }
    if attrs.is_empty() {
        String::new()
    } else {
        format!("<pageSetup {}/>", attrs.join(" "))
    }
}

pub(in crate::services::document_editor) fn update_sheet_page_setup(
    xml: &str,
    setup: Option<&SheetPageSetup>,
) -> String {
    let setup_xml = build_sheet_page_setup(setup);
    if let Some(replaced) = replace_xml_element(xml, "pageSetup", &setup_xml) {
        return replaced;
    }
    if xml.contains("<pageSetup") {
        return replace_empty_xml_element(xml, "<pageSetup", &setup_xml);
    }
    if setup_xml.is_empty() {
        return xml.to_string();
    }
    append_before_or_end(xml, "</worksheet>", &setup_xml)
}

pub(in crate::services::document_editor) fn build_sheet_hyperlinks(
    hyperlinks: &[SheetHyperlink],
) -> String {
    if hyperlinks.is_empty() {
        return String::new();
    }
    let links = hyperlinks
        .iter()
        .filter(|hyperlink| valid_xlsx_sqref(&hyperlink.reference))
        .filter_map(|hyperlink| {
            if hyperlink.relationship_id.is_none() && hyperlink.location.is_none() {
                return None;
            }
            let mut attrs = vec![format!(r#"ref="{}""#, escape_xml(&hyperlink.reference))];
            if let Some(relationship_id) = &hyperlink.relationship_id {
                attrs.push(format!(r#"r:id="{}""#, escape_xml(relationship_id)));
            }
            if let Some(location) = &hyperlink.location {
                attrs.push(format!(r#"location="{}""#, escape_xml(location)));
            }
            if let Some(display) = &hyperlink.display {
                attrs.push(format!(r#"display="{}""#, escape_xml(display)));
            }
            if let Some(tooltip) = &hyperlink.tooltip {
                attrs.push(format!(r#"tooltip="{}""#, escape_xml(tooltip)));
            }
            Some(format!("<hyperlink {}/>", attrs.join(" ")))
        })
        .collect::<String>();
    if links.is_empty() {
        String::new()
    } else {
        format!("<hyperlinks>{links}</hyperlinks>")
    }
}

pub(in crate::services::document_editor) fn update_sheet_hyperlinks(
    xml: &str,
    hyperlinks: &[SheetHyperlink],
) -> String {
    let hyperlinks_xml = build_sheet_hyperlinks(hyperlinks);
    if let Some(replaced) = replace_xml_element(xml, "hyperlinks", &hyperlinks_xml) {
        return replaced;
    }
    if xml.contains("<hyperlinks") {
        return replace_empty_xml_element(xml, "<hyperlinks", &hyperlinks_xml);
    }
    if hyperlinks_xml.is_empty() {
        return xml.to_string();
    }
    if let Some(index) = xml.find("</dataValidations>") {
        let insert_at = index + "</dataValidations>".len();
        let mut output = String::new();
        output.push_str(&xml[..insert_at]);
        output.push_str(&hyperlinks_xml);
        output.push_str(&xml[insert_at..]);
        return output;
    }
    if let Some(index) = xml.find("</conditionalFormatting>") {
        let insert_at = index + "</conditionalFormatting>".len();
        let mut output = String::new();
        output.push_str(&xml[..insert_at]);
        output.push_str(&hyperlinks_xml);
        output.push_str(&xml[insert_at..]);
        return output;
    }
    if let Some(index) = xml.find("</sheetData>") {
        let insert_at = index + "</sheetData>".len();
        let mut output = String::new();
        output.push_str(&xml[..insert_at]);
        output.push_str(&hyperlinks_xml);
        output.push_str(&xml[insert_at..]);
        return output;
    }
    append_before_or_end(xml, "</worksheet>", &hyperlinks_xml)
}

pub(in crate::services::document_editor) fn update_sheet_legacy_drawing(
    xml: &str,
    relationship_id: Option<&str>,
) -> String {
    let Some(relationship_id) = relationship_id else {
        return xml.to_string();
    };
    let legacy_xml = format!(r#"<legacyDrawing r:id="{}"/>"#, escape_xml(relationship_id));
    let updated = if let Some(replaced) = replace_xml_element(xml, "legacyDrawing", &legacy_xml) {
        replaced
    } else if xml.contains("<legacyDrawing") {
        replace_empty_xml_element(xml, "<legacyDrawing", &legacy_xml)
    } else if let Some(index) = xml.find("<pageMargins") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&legacy_xml);
        output.push_str(&xml[index..]);
        output
    } else if let Some(index) = xml.find("<pageSetup") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&legacy_xml);
        output.push_str(&xml[index..]);
        output
    } else {
        append_before_or_end(xml, "</worksheet>", &legacy_xml)
    };
    ensure_xlsx_relationship_namespace_for_r_id(&updated)
}

pub(in crate::services::document_editor) fn ensure_xlsx_relationship_namespace(
    xml: &str,
    hyperlinks: &[SheetHyperlink],
) -> String {
    if !hyperlinks
        .iter()
        .any(|hyperlink| hyperlink.relationship_id.is_some())
        || xml.contains("xmlns:r=")
    {
        return xml.to_string();
    }
    ensure_xlsx_relationship_namespace_for_r_id(xml)
}

pub(in crate::services::document_editor) fn ensure_xlsx_relationship_namespace_for_r_id(
    xml: &str,
) -> String {
    if xml.contains("xmlns:r=") {
        return xml.to_string();
    }
    let Some(start) = xml.find("<worksheet") else {
        return xml.to_string();
    };
    let after_start = &xml[start..];
    let Some(end) = after_start.find('>') else {
        return xml.to_string();
    };
    let original = &after_start[..=end];
    let updated = set_xml_attr(
        original,
        "xmlns:r",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    );
    let mut output = String::new();
    output.push_str(&xml[..start]);
    output.push_str(&updated);
    output.push_str(&after_start[end + 1..]);
    output
}

pub(in crate::services::document_editor) fn update_sheet_hyperlink_relationships(
    original_rels: Option<&str>,
    update: &mut SheetUpdate,
) -> Option<String> {
    let has_external_hyperlinks = update.hyperlinks.iter().any(|link| link.target.is_some());
    if original_rels.is_none() && !has_external_hyperlinks {
        return None;
    }
    let mut rels = original_rels
        .map(str::to_string)
        .unwrap_or_else(xlsx_empty_relationships);
    rels = remove_relationships_by_type(&rels, "/hyperlink");
    let mut next_id = next_rid(&rels);
    for hyperlink in &mut update.hyperlinks {
        let Some(target) = hyperlink.target.as_deref() else {
            hyperlink.relationship_id = None;
            continue;
        };
        let relationship_id = format!("rId{next_id}");
        next_id += 1;
        let relationship = format!(
            r#"<Relationship Id="{relationship_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="{}" TargetMode="External"/>"#,
            escape_xml(target)
        );
        rels = append_before_or_end(&rels, "</Relationships>", &relationship);
        hyperlink.relationship_id = Some(relationship_id);
    }
    Some(rels)
}
