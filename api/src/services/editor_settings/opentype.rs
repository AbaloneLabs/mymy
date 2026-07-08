use std::collections::BTreeMap;

#[derive(Debug, Clone, Default)]
pub(super) struct ParsedFontMetadata {
    pub(super) family_name: Option<String>,
    pub(super) subfamily_name: Option<String>,
    pub(super) full_name: Option<String>,
    pub(super) postscript_name: Option<String>,
    pub(super) version: Option<String>,
    pub(super) license: Option<String>,
    pub(super) license_url: Option<String>,
    pub(super) weight_class: Option<u16>,
    pub(super) width_class: Option<u16>,
    pub(super) embedding: Option<String>,
    pub(super) supported_scripts: Vec<String>,
}

pub(super) fn parse_opentype_metadata(bytes: &[u8]) -> Option<ParsedFontMetadata> {
    let names = parse_ttf_name_table_records(opentype_table(bytes, b"name")?)?;
    let os2 = opentype_table(bytes, b"OS/2").and_then(parse_os2_metadata);
    Some(ParsedFontMetadata {
        family_name: names.get(&1).cloned(),
        subfamily_name: names.get(&2).cloned(),
        full_name: names.get(&4).cloned(),
        postscript_name: names.get(&6).cloned(),
        version: names.get(&5).cloned(),
        license: names.get(&13).cloned(),
        license_url: names.get(&14).cloned(),
        weight_class: os2.as_ref().and_then(|item| item.weight_class),
        width_class: os2.as_ref().and_then(|item| item.width_class),
        embedding: os2.as_ref().and_then(|item| item.embedding.clone()),
        supported_scripts: os2.map(|item| item.supported_scripts).unwrap_or_default(),
    })
}

#[derive(Debug, Clone, Default)]
struct ParsedOs2Metadata {
    weight_class: Option<u16>,
    width_class: Option<u16>,
    embedding: Option<String>,
    supported_scripts: Vec<String>,
}

fn opentype_table<'a>(bytes: &'a [u8], wanted_tag: &[u8; 4]) -> Option<&'a [u8]> {
    let num_tables = read_u16(bytes, 4)? as usize;
    let table_records_start = 12usize;
    for index in 0..num_tables {
        let start = table_records_start.checked_add(index.checked_mul(16)?)?;
        let tag = bytes.get(start..start + 4)?;
        if tag != wanted_tag {
            continue;
        }
        let offset = read_u32(bytes, start + 8)? as usize;
        let length = read_u32(bytes, start + 12)? as usize;
        return bytes.get(offset..offset.checked_add(length)?);
    }
    None
}

fn parse_ttf_name_table_records(table: &[u8]) -> Option<BTreeMap<u16, String>> {
    let count = read_u16(table, 2)? as usize;
    let storage_offset = read_u16(table, 4)? as usize;
    let mut candidates: BTreeMap<u16, Vec<(u8, String)>> = BTreeMap::new();
    for index in 0..count {
        let record = 6usize.checked_add(index.checked_mul(12)?)?;
        let platform_id = read_u16(table, record)?;
        let language_id = read_u16(table, record + 4)?;
        let name_id = read_u16(table, record + 6)?;
        if !wanted_name_id(name_id) {
            continue;
        }
        let length = read_u16(table, record + 8)? as usize;
        let offset = read_u16(table, record + 10)? as usize;
        let value_start = storage_offset.checked_add(offset)?;
        let raw = table.get(value_start..value_start.checked_add(length)?)?;
        let value = decode_font_name(platform_id, raw)?;
        if value.trim().is_empty() {
            continue;
        }
        candidates
            .entry(name_id)
            .or_default()
            .push((font_name_priority(platform_id, language_id), value));
    }
    Some(
        candidates
            .into_iter()
            .filter_map(|(name_id, mut values)| {
                values.sort_by_key(|(priority, _)| *priority);
                values.into_iter().map(|(_, value)| (name_id, value)).next()
            })
            .collect(),
    )
}

fn wanted_name_id(name_id: u16) -> bool {
    matches!(name_id, 1 | 2 | 4 | 5 | 6 | 13 | 14)
}

fn font_name_priority(platform_id: u16, language_id: u16) -> u8 {
    match (platform_id, language_id) {
        (3, 0x0409) => 0,
        (3, _) => 1,
        (0, _) => 2,
        _ => 3,
    }
}

fn parse_os2_metadata(table: &[u8]) -> Option<ParsedOs2Metadata> {
    let fs_type = read_u16(table, 8);
    let unicode_ranges = [
        read_u32(table, 42).unwrap_or_default(),
        read_u32(table, 46).unwrap_or_default(),
        read_u32(table, 50).unwrap_or_default(),
        read_u32(table, 54).unwrap_or_default(),
    ];
    Some(ParsedOs2Metadata {
        weight_class: read_u16(table, 4),
        width_class: read_u16(table, 6),
        embedding: fs_type.map(font_embedding_label),
        supported_scripts: supported_scripts_from_unicode_ranges(unicode_ranges),
    })
}

fn font_embedding_label(fs_type: u16) -> String {
    if fs_type & 0x0002 != 0 {
        "restricted".to_string()
    } else if fs_type & 0x0008 != 0 {
        "editable".to_string()
    } else if fs_type & 0x0004 != 0 {
        "preview-print".to_string()
    } else {
        "installable".to_string()
    }
}

fn supported_scripts_from_unicode_ranges(ranges: [u32; 4]) -> Vec<String> {
    const SCRIPT_BITS: &[(usize, &str)] = &[
        (0, "Latin"),
        (1, "Latin-1"),
        (2, "Latin Extended"),
        (9, "Cyrillic"),
        (10, "Armenian"),
        (11, "Hebrew"),
        (13, "Arabic"),
        (17, "Devanagari"),
        (18, "Bengali"),
        (19, "Gurmukhi"),
        (20, "Gujarati"),
        (21, "Odia"),
        (22, "Tamil"),
        (23, "Telugu"),
        (24, "Kannada"),
        (25, "Malayalam"),
        (28, "Thai"),
        (29, "Lao"),
        (30, "Georgian"),
        (31, "Hangul Jamo"),
        (48, "CJK"),
        (49, "Hangul"),
        (50, "Hiragana"),
        (51, "Katakana"),
        (59, "CJK Symbols"),
        (60, "Kana"),
        (85, "Mathematical Alphanumeric Symbols"),
    ];
    let mut scripts = Vec::new();
    for (bit, label) in SCRIPT_BITS {
        let range_index = bit / 32;
        let bit_index = bit % 32;
        if ranges
            .get(range_index)
            .map(|range| range & (1u32 << bit_index) != 0)
            .unwrap_or(false)
        {
            scripts.push((*label).to_string());
        }
    }
    scripts.sort();
    scripts.dedup();
    scripts
}

fn decode_font_name(platform_id: u16, raw: &[u8]) -> Option<String> {
    if platform_id == 0 || platform_id == 3 {
        if !raw.len().is_multiple_of(2) {
            return None;
        }
        let code_units = raw
            .chunks_exact(2)
            .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        String::from_utf16(&code_units).ok()
    } else {
        String::from_utf8(raw.to_vec()).ok()
    }
    .map(|value| value.trim_matches(char::from(0)).trim().to_string())
    .filter(|value| !value.is_empty())
}

fn read_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    let chunk = bytes.get(offset..offset.checked_add(2)?)?;
    Some(u16::from_be_bytes([chunk[0], chunk[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    let chunk = bytes.get(offset..offset.checked_add(4)?)?;
    Some(u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
}
