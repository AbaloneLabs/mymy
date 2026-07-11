#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="$(mktemp -d)"
libreoffice_bin="${LIBREOFFICE_BIN:-$(command -v libreoffice || command -v soffice || true)}"

cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

if [[ -z "$libreoffice_bin" ]]; then
  echo "LibreOffice is required. Install it or set LIBREOFFICE_BIN." >&2
  exit 1
fi

run_libreoffice() {
  local profile="$1"
  shift
  rm -rf "$profile"
  "$libreoffice_bin" \
    "-env:UserInstallation=file://$profile" \
    --headless \
    --nologo \
    --nodefault \
    --nolockcheck \
    --nofirststartwizard \
    "$@"
}

mkdir -p "$work_dir/source" "$work_dir/input" "$work_dir/output" "$work_dir/exported"

cat >"$work_dir/source/writer.fodt" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  office:mimetype="application/vnd.oasis.opendocument.text" office:version="1.3">
  <office:automatic-styles>
    <style:style style:name="Bold" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
    <style:style style:name="Italic" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
  </office:automatic-styles>
  <office:body><office:text>
    <text:h text:outline-level="1">Composed 문서 fixture</text:h>
    <text:p>Plain text with <text:span text:style-name="Bold">bold</text:span>,
      <text:span text:style-name="Italic">italic</text:span>, and
      <text:a xlink:href="https://example.com/docs">a link</text:a>.</text:p>
  </office:text></office:body>
</office:document>
EOF

cat >"$work_dir/source/calc.fods" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"
  xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  office:mimetype="application/vnd.oasis.opendocument.spreadsheet" office:version="1.3">
  <office:styles>
    <number:percentage-style style:name="PercentFormat">
      <number:number number:decimal-places="2"/><number:text>%</number:text>
    </number:percentage-style>
    <style:style style:name="PercentCell" style:family="table-cell" style:data-style-name="PercentFormat"/>
  </office:styles>
  <office:body><office:spreadsheet>
    <table:content-validations>
      <table:content-validation table:name="WholeNumber"
        table:condition="cell-content-is-whole-number() and cell-content()&gt;=0"
        table:allow-empty-cell="true"/>
    </table:content-validations>
    <table:table table:name="Data">
      <table:table-row>
        <table:table-cell office:value-type="string"><text:p>Category</text:p></table:table-cell>
        <table:table-cell office:value-type="string"><text:p>Amount</text:p></table:table-cell>
        <table:table-cell office:value-type="string"><text:p>Rate</text:p></table:table-cell>
        <table:table-cell table:number-columns-spanned="2" office:value-type="string"><text:p>검증 범위</text:p></table:table-cell>
        <table:covered-table-cell/>
      </table:table-row>
      <table:table-row>
        <table:table-cell office:value-type="string"><text:p><text:a xlink:href="https://example.com/alpha">Alpha</text:a></text:p></table:table-cell>
        <table:table-cell table:content-validation-name="WholeNumber" office:value-type="float" office:value="17"><text:p>17</text:p></table:table-cell>
        <table:table-cell table:style-name="PercentCell" office:value-type="percentage" office:value="0.25"><text:p>25.00%</text:p></table:table-cell>
      </table:table-row>
      <table:table-row>
        <table:table-cell office:value-type="string"><text:p>Beta</text:p></table:table-cell>
        <table:table-cell table:content-validation-name="WholeNumber" office:value-type="float" office:value="23"><text:p>23</text:p></table:table-cell>
        <table:table-cell table:style-name="PercentCell" office:value-type="percentage" office:value="0.50"><text:p>50.00%</text:p></table:table-cell>
      </table:table-row>
      <table:table-row>
        <table:table-cell office:value-type="string"><text:p>합계</text:p></table:table-cell>
        <table:table-cell table:formula="of:=SUM([.B2:.B3])" office:value-type="float" office:value="40"><text:p>40</text:p></table:table-cell>
        <table:table-cell table:formula="of:=SUM([.C2:.C3])" table:style-name="PercentCell" office:value-type="percentage" office:value="0.75"><text:p>75.00%</text:p></table:table-cell>
      </table:table-row>
    </table:table>
  </office:spreadsheet></office:body>
</office:document>
EOF

cat >"$work_dir/source/impress.fodp" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
  xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"
  xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  office:mimetype="application/vnd.oasis.opendocument.presentation" office:version="1.3">
  <office:body><office:presentation>
    <draw:page draw:name="page1">
      <draw:frame presentation:class="title" svg:x="1in" svg:y="1in" svg:width="8in" svg:height="1in">
        <draw:text-box><text:p>Composed 프레젠테이션 fixture</text:p></draw:text-box>
      </draw:frame>
      <draw:custom-shape draw:name="Preserved ellipse" svg:x="2in" svg:y="3in" svg:width="2in" svg:height="1.25in">
        <draw:enhanced-geometry draw:type="ellipse"/>
      </draw:custom-shape>
    </draw:page>
  </office:presentation></office:body>
</office:document>
EOF

run_libreoffice "$work_dir/profile-writer" \
  --convert-to docx --outdir "$work_dir/input" "$work_dir/source/writer.fodt"
run_libreoffice "$work_dir/profile-calc" \
  --convert-to xlsx --outdir "$work_dir/input" "$work_dir/source/calc.fods"
run_libreoffice "$work_dir/profile-impress" \
  --convert-to pptx --outdir "$work_dir/input" "$work_dir/source/impress.fodp"

for file in writer.docx calc.xlsx impress.pptx; do
  test -s "$work_dir/input/$file"
done

MYMY_INTEROP_INPUT="$work_dir/input" \
MYMY_INTEROP_OUTPUT="$work_dir/output" \
DATABASE_URL="${DATABASE_URL:-postgres://mymy:mymy@localhost:33432/mymy}" \
  cargo test --manifest-path "$repo_root/api/Cargo.toml" \
    round_trip_external_office_fixtures -- --ignored --nocapture

stage_prefixes=("" "noop-" "ab-" "inverse-b-" "inverse-a-")
document_names=("writer.docx" "calc.xlsx" "impress.pptx")

for prefix in "${stage_prefixes[@]}"; do
  for name in "${document_names[@]}"; do
    file="${prefix}${name}"
    test -s "$work_dir/output/$file"
  done
done

for prefix in "${stage_prefixes[@]}"; do
  for name in "${document_names[@]}"; do
    file="${prefix}${name}"
    run_libreoffice "$work_dir/profile-export-${file%.*}" \
      --convert-to pdf --outdir "$work_dir/exported" "$work_dir/output/$file"
  done
done

for prefix in "${stage_prefixes[@]}"; do
  for name in writer.pdf calc.pdf impress.pdf; do
    file="${prefix}${name}"
    test -s "$work_dir/exported/$file"
  done
done

echo "Document editor interoperability lane passed for DOCX, XLSX, and PPTX."
