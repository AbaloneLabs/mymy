//! Mechanical validation for provider-visible tool contracts.
//!
//! Provider-side schema checks are advisory: models and transports can still
//! produce malformed arguments. The registry therefore validates the catalog
//! before exposure and validates every invocation again before safety checks or
//! handler execution. This module intentionally supports the JSON Schema
//! vocabulary used by mymy tools instead of silently pretending to implement
//! an unrestricted draft.

use std::collections::HashSet;

use serde_json::{Map, Value};

use super::ToolEntry;

const MAX_TOOL_NAME_BYTES: usize = 64;
const MAX_TOOL_DESCRIPTION_BYTES: usize = 4_096;
const MAX_TOOL_SCHEMA_BYTES: usize = 128 * 1_024;
const MAX_ENUM_ITEMS: usize = 256;
const MAX_SCHEMA_DEPTH: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("tool `{tool}` contract error at `{path}`: {reason}")]
pub struct ToolContractError {
    pub tool: String,
    pub path: String,
    pub reason: String,
}

impl ToolContractError {
    fn new(tool: &str, path: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            tool: tool.to_string(),
            path: path.into(),
            reason: reason.into(),
        }
    }
}

pub(super) fn validate_entry(entry: &ToolEntry) -> Result<(), ToolContractError> {
    validate_name(&entry.name)?;
    if entry.schema.tool_type != "function" {
        return Err(ToolContractError::new(
            &entry.name,
            "$.type",
            "only function tools are supported",
        ));
    }
    if entry.schema.function.name != entry.name {
        return Err(ToolContractError::new(
            &entry.name,
            "$.function.name",
            "schema name must match the registry key",
        ));
    }
    let description = entry
        .schema
        .function
        .description
        .as_deref()
        .unwrap_or_default();
    if description.trim().len() < 3 {
        return Err(ToolContractError::new(
            &entry.name,
            "$.function.description",
            "description must be non-empty and useful",
        ));
    }
    if description.len() > MAX_TOOL_DESCRIPTION_BYTES {
        return Err(ToolContractError::new(
            &entry.name,
            "$.function.description",
            format!("description exceeds {MAX_TOOL_DESCRIPTION_BYTES} bytes"),
        ));
    }
    if entry.capability.resource_kind.trim().is_empty() {
        return Err(ToolContractError::new(
            &entry.name,
            "$.capability.resourceKind",
            "resource kind must not be empty",
        ));
    }
    if entry.capability.effect == super::ToolEffect::Read
        && entry.capability.idempotency != super::ToolIdempotency::Idempotent
    {
        return Err(ToolContractError::new(
            &entry.name,
            "$.capability.idempotency",
            "read tools must be idempotent",
        ));
    }
    if entry.capability.effect != super::ToolEffect::Read
        && entry.capability.parallel_policy == super::ParallelPolicy::Safe
    {
        return Err(ToolContractError::new(
            &entry.name,
            "$.capability.parallelPolicy",
            "side-effecting tools cannot declare unrestricted parallel safety",
        ));
    }

    let root = &entry.schema.function.parameters;
    let schema_bytes = serde_json::to_vec(root).map_err(|error| {
        ToolContractError::new(
            &entry.name,
            "$.function.parameters",
            format!("schema serialization failed: {error}"),
        )
    })?;
    if schema_bytes.len() > MAX_TOOL_SCHEMA_BYTES {
        return Err(ToolContractError::new(
            &entry.name,
            "$.function.parameters",
            format!("schema exceeds {MAX_TOOL_SCHEMA_BYTES} bytes"),
        ));
    }
    validate_schema_node(&entry.name, root, "$", root, 0, &mut Vec::new())?;
    if schema_types(root).is_none_or(|types| !types.contains(&"object")) {
        return Err(ToolContractError::new(
            &entry.name,
            "$",
            "parameter root must declare type object",
        ));
    }
    if let Some(argument) = entry.capability.resource_argument.as_deref() {
        let exists = root
            .get("properties")
            .and_then(Value::as_object)
            .is_some_and(|properties| properties.contains_key(argument));
        if !exists {
            return Err(ToolContractError::new(
                &entry.name,
                "$.capability.resourceArgument",
                format!("resource argument `{argument}` is absent from root properties"),
            ));
        }
    }
    Ok(())
}

pub(super) fn validate_arguments(
    entry: &ToolEntry,
    arguments: &Value,
) -> Result<(), ToolContractError> {
    validate_instance(
        &entry.name,
        &entry.schema.function.parameters,
        arguments,
        "$",
        &entry.schema.function.parameters,
        0,
        &mut Vec::new(),
    )
}

fn validate_name(name: &str) -> Result<(), ToolContractError> {
    if name.is_empty() || name.len() > MAX_TOOL_NAME_BYTES {
        return Err(ToolContractError::new(
            name,
            "$.name",
            format!("name length must be between 1 and {MAX_TOOL_NAME_BYTES} bytes"),
        ));
    }
    if !name
        .bytes()
        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err(ToolContractError::new(
            name,
            "$.name",
            "name must contain only lowercase ASCII letters, digits, and underscores",
        ));
    }
    Ok(())
}

fn validate_schema_node(
    tool: &str,
    schema: &Value,
    path: &str,
    root: &Value,
    depth: usize,
    ref_stack: &mut Vec<String>,
) -> Result<(), ToolContractError> {
    if depth > MAX_SCHEMA_DEPTH {
        return Err(ToolContractError::new(
            tool,
            path,
            "schema nesting exceeds the supported depth",
        ));
    }
    let object = schema
        .as_object()
        .ok_or_else(|| ToolContractError::new(tool, path, "schema node must be a JSON object"))?;

    if let Some(reference) = object.get("$ref").and_then(Value::as_str) {
        let target = resolve_local_ref(tool, root, reference, path)?;
        if ref_stack.iter().any(|item| item == reference) {
            return Err(ToolContractError::new(
                tool,
                path,
                "recursive local references are not supported in tool inputs",
            ));
        }
        ref_stack.push(reference.to_string());
        let result = validate_schema_node(tool, target, path, root, depth + 1, ref_stack);
        ref_stack.pop();
        return result;
    }

    validate_type_declaration(tool, object, path)?;
    validate_enum_and_default(tool, object, path)?;
    validate_numeric_bounds(tool, object, path)?;
    if let Some(pattern) = object.get("pattern") {
        let pattern = pattern.as_str().ok_or_else(|| {
            ToolContractError::new(tool, format!("{path}.pattern"), "pattern must be a string")
        })?;
        regex::Regex::new(pattern).map_err(|error| {
            ToolContractError::new(
                tool,
                format!("{path}.pattern"),
                format!("invalid regular expression: {error}"),
            )
        })?;
    }

    if schema_types(schema).is_some_and(|types| types.contains(&"object")) {
        validate_object_schema(tool, object, path, root, depth, ref_stack)?;
    }
    if schema_types(schema).is_some_and(|types| types.contains(&"array")) {
        let items = object.get("items").ok_or_else(|| {
            ToolContractError::new(tool, format!("{path}.items"), "array schema requires items")
        })?;
        validate_schema_node(
            tool,
            items,
            &format!("{path}.items"),
            root,
            depth + 1,
            ref_stack,
        )?;
    }
    for keyword in ["oneOf", "anyOf", "allOf"] {
        if let Some(branches) = object.get(keyword) {
            let branches = branches.as_array().ok_or_else(|| {
                ToolContractError::new(
                    tool,
                    format!("{path}.{keyword}"),
                    "composition keyword must be an array",
                )
            })?;
            if branches.is_empty() {
                return Err(ToolContractError::new(
                    tool,
                    format!("{path}.{keyword}"),
                    "composition array must not be empty",
                ));
            }
            for (index, branch) in branches.iter().enumerate() {
                validate_schema_node(
                    tool,
                    branch,
                    &format!("{path}.{keyword}[{index}]"),
                    root,
                    depth + 1,
                    ref_stack,
                )?;
            }
        }
    }
    if let Some(definitions) = object.get("$defs") {
        let definitions = definitions.as_object().ok_or_else(|| {
            ToolContractError::new(tool, format!("{path}.$defs"), "$defs must be an object")
        })?;
        for (name, definition) in definitions {
            validate_schema_node(
                tool,
                definition,
                &format!("{path}.$defs.{name}"),
                root,
                depth + 1,
                ref_stack,
            )?;
        }
    }
    Ok(())
}

fn validate_type_declaration(
    tool: &str,
    object: &Map<String, Value>,
    path: &str,
) -> Result<(), ToolContractError> {
    let Some(value) = object.get("type") else {
        if object.contains_key("oneOf")
            || object.contains_key("anyOf")
            || object.contains_key("allOf")
            || object.contains_key("$ref")
            || object.contains_key("enum")
        {
            return Ok(());
        }
        return Err(ToolContractError::new(
            tool,
            format!("{path}.type"),
            "schema node requires type or a supported composition/ref",
        ));
    };
    let valid = |item: &str| {
        matches!(
            item,
            "object" | "array" | "string" | "integer" | "number" | "boolean" | "null"
        )
    };
    match value {
        Value::String(item) if valid(item) => Ok(()),
        Value::Array(items)
            if !items.is_empty() && items.iter().all(|item| item.as_str().is_some_and(valid)) =>
        {
            Ok(())
        }
        _ => Err(ToolContractError::new(
            tool,
            format!("{path}.type"),
            "unsupported type declaration",
        )),
    }
}

fn validate_object_schema(
    tool: &str,
    object: &Map<String, Value>,
    path: &str,
    root: &Value,
    depth: usize,
    ref_stack: &mut Vec<String>,
) -> Result<(), ToolContractError> {
    let properties = object
        .get("properties")
        .map(|value| {
            value.as_object().ok_or_else(|| {
                ToolContractError::new(
                    tool,
                    format!("{path}.properties"),
                    "properties must be an object",
                )
            })
        })
        .transpose()?
        .cloned()
        .unwrap_or_default();
    for (name, property) in &properties {
        if property
            .get("description")
            .and_then(Value::as_str)
            .is_none_or(|description| description.trim().len() < 3)
        {
            return Err(ToolContractError::new(
                tool,
                format!("{path}.properties.{name}.description"),
                "user-supplied property requires a useful description",
            ));
        }
        validate_schema_node(
            tool,
            property,
            &format!("{path}.properties.{name}"),
            root,
            depth + 1,
            ref_stack,
        )?;
    }

    let mut seen = HashSet::new();
    if let Some(required) = object.get("required") {
        let required = required.as_array().ok_or_else(|| {
            ToolContractError::new(
                tool,
                format!("{path}.required"),
                "required must be an array",
            )
        })?;
        for (index, item) in required.iter().enumerate() {
            let name = item.as_str().ok_or_else(|| {
                ToolContractError::new(
                    tool,
                    format!("{path}.required[{index}]"),
                    "required entries must be strings",
                )
            })?;
            if !properties.contains_key(name) {
                return Err(ToolContractError::new(
                    tool,
                    format!("{path}.required[{index}]"),
                    format!("required property `{name}` is not declared"),
                ));
            }
            if !seen.insert(name) {
                return Err(ToolContractError::new(
                    tool,
                    format!("{path}.required[{index}]"),
                    format!("required property `{name}` is duplicated"),
                ));
            }
        }
    }
    if let Some(additional) = object.get("additionalProperties") {
        if !additional.is_boolean() {
            validate_schema_node(
                tool,
                additional,
                &format!("{path}.additionalProperties"),
                root,
                depth + 1,
                ref_stack,
            )?;
        }
    } else {
        return Err(ToolContractError::new(
            tool,
            format!("{path}.additionalProperties"),
            "object schema must declare an intentional unknown-property policy",
        ));
    }
    Ok(())
}

fn validate_enum_and_default(
    tool: &str,
    object: &Map<String, Value>,
    path: &str,
) -> Result<(), ToolContractError> {
    if let Some(values) = object.get("enum") {
        let values = values.as_array().ok_or_else(|| {
            ToolContractError::new(tool, format!("{path}.enum"), "enum must be an array")
        })?;
        if values.is_empty() {
            return Err(ToolContractError::new(
                tool,
                format!("{path}.enum"),
                "enum must not be empty",
            ));
        }
        if values.len() > MAX_ENUM_ITEMS {
            return Err(ToolContractError::new(
                tool,
                format!("{path}.enum"),
                format!("enum exceeds {MAX_ENUM_ITEMS} items"),
            ));
        }
        let mut unique = HashSet::new();
        for (index, value) in values.iter().enumerate() {
            let encoded = serde_json::to_string(value).unwrap_or_default();
            if !unique.insert(encoded) {
                return Err(ToolContractError::new(
                    tool,
                    format!("{path}.enum[{index}]"),
                    "enum values must be unique",
                ));
            }
        }
        if let Some(default) = object.get("default") {
            if !values.contains(default) {
                return Err(ToolContractError::new(
                    tool,
                    format!("{path}.default"),
                    "default must belong to enum",
                ));
            }
        }
    }
    Ok(())
}

fn validate_numeric_bounds(
    tool: &str,
    object: &Map<String, Value>,
    path: &str,
) -> Result<(), ToolContractError> {
    for (minimum, maximum) in [
        ("minimum", "maximum"),
        ("minLength", "maxLength"),
        ("minItems", "maxItems"),
    ] {
        if let Some(value) = object.get(minimum) {
            if value.as_f64().is_none() {
                return Err(ToolContractError::new(
                    tool,
                    format!("{path}.{minimum}"),
                    "bound must be numeric",
                ));
            }
        }
        if let Some(value) = object.get(maximum) {
            if value.as_f64().is_none() {
                return Err(ToolContractError::new(
                    tool,
                    format!("{path}.{maximum}"),
                    "bound must be numeric",
                ));
            }
        }
        let lower = object.get(minimum).and_then(Value::as_f64);
        let upper = object.get(maximum).and_then(Value::as_f64);
        if let (Some(lower), Some(upper)) = (lower, upper) {
            if lower > upper {
                return Err(ToolContractError::new(
                    tool,
                    path,
                    format!("{minimum} must not exceed {maximum}"),
                ));
            }
        }
    }
    Ok(())
}

fn validate_instance(
    tool: &str,
    schema: &Value,
    value: &Value,
    path: &str,
    root: &Value,
    depth: usize,
    ref_stack: &mut Vec<String>,
) -> Result<(), ToolContractError> {
    if depth > MAX_SCHEMA_DEPTH {
        return Err(ToolContractError::new(
            tool,
            path,
            "argument nesting exceeds the supported depth",
        ));
    }
    let object = schema
        .as_object()
        .ok_or_else(|| ToolContractError::new(tool, path, "schema node must be a JSON object"))?;
    if let Some(reference) = object.get("$ref").and_then(Value::as_str) {
        let target = resolve_local_ref(tool, root, reference, path)?;
        if ref_stack.iter().any(|item| item == reference) {
            return Err(ToolContractError::new(
                tool,
                path,
                "recursive local references are not supported",
            ));
        }
        ref_stack.push(reference.to_string());
        let result = validate_instance(tool, target, value, path, root, depth + 1, ref_stack);
        ref_stack.pop();
        return result;
    }
    for keyword in ["allOf", "anyOf", "oneOf"] {
        if let Some(branches) = object.get(keyword).and_then(Value::as_array) {
            let matches = branches
                .iter()
                .filter(|branch| {
                    validate_instance(
                        tool,
                        branch,
                        value,
                        path,
                        root,
                        depth + 1,
                        &mut ref_stack.clone(),
                    )
                    .is_ok()
                })
                .count();
            let valid = match keyword {
                "allOf" => matches == branches.len(),
                "anyOf" => matches >= 1,
                "oneOf" => matches == 1,
                _ => unreachable!(),
            };
            if !valid {
                return Err(ToolContractError::new(
                    tool,
                    path,
                    format!("value does not satisfy {keyword}"),
                ));
            }
        }
    }
    if let Some(types) = schema_types(schema) {
        if !types
            .iter()
            .any(|expected| value_matches_type(value, expected))
        {
            return Err(ToolContractError::new(
                tool,
                path,
                format!("expected type {}", types.join(" or ")),
            ));
        }
    }
    if let Some(values) = object.get("enum").and_then(Value::as_array) {
        if !values.contains(value) {
            return Err(ToolContractError::new(
                tool,
                path,
                "value is not in the allowed enum",
            ));
        }
    }
    match value {
        Value::Object(instance) => {
            let properties = object
                .get("properties")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            if let Some(required) = object.get("required").and_then(Value::as_array) {
                for name in required.iter().filter_map(Value::as_str) {
                    if !instance.contains_key(name) {
                        return Err(ToolContractError::new(
                            tool,
                            format!("{path}.{name}"),
                            "required property is missing",
                        ));
                    }
                }
            }
            for (name, item) in instance {
                if let Some(property_schema) = properties.get(name) {
                    validate_instance(
                        tool,
                        property_schema,
                        item,
                        &format!("{path}.{name}"),
                        root,
                        depth + 1,
                        ref_stack,
                    )?;
                } else if object.get("additionalProperties") == Some(&Value::Bool(false)) {
                    return Err(ToolContractError::new(
                        tool,
                        format!("{path}.{name}"),
                        "unknown property is not allowed",
                    ));
                } else if let Some(additional) = object
                    .get("additionalProperties")
                    .filter(|item| item.is_object())
                {
                    validate_instance(
                        tool,
                        additional,
                        item,
                        &format!("{path}.{name}"),
                        root,
                        depth + 1,
                        ref_stack,
                    )?;
                }
            }
        }
        Value::Array(items) => {
            validate_usize_bound(tool, object, "minItems", items.len(), path, false)?;
            validate_usize_bound(tool, object, "maxItems", items.len(), path, true)?;
            if let Some(item_schema) = object.get("items") {
                for (index, item) in items.iter().enumerate() {
                    validate_instance(
                        tool,
                        item_schema,
                        item,
                        &format!("{path}[{index}]"),
                        root,
                        depth + 1,
                        ref_stack,
                    )?;
                }
            }
        }
        Value::String(text) => {
            let length = text.chars().count();
            validate_usize_bound(tool, object, "minLength", length, path, false)?;
            validate_usize_bound(tool, object, "maxLength", length, path, true)?;
            if let Some(pattern) = object.get("pattern").and_then(Value::as_str) {
                let regex = regex::Regex::new(pattern).map_err(|error| {
                    ToolContractError::new(
                        tool,
                        format!("{path}.pattern"),
                        format!("invalid pattern: {error}"),
                    )
                })?;
                if !regex.is_match(text) {
                    return Err(ToolContractError::new(
                        tool,
                        path,
                        "string does not match the required pattern",
                    ));
                }
            }
        }
        Value::Number(number) => {
            if let Some(actual) = number.as_f64() {
                if object
                    .get("minimum")
                    .and_then(Value::as_f64)
                    .is_some_and(|minimum| actual < minimum)
                {
                    return Err(ToolContractError::new(
                        tool,
                        path,
                        "number is below minimum",
                    ));
                }
                if object
                    .get("maximum")
                    .and_then(Value::as_f64)
                    .is_some_and(|maximum| actual > maximum)
                {
                    return Err(ToolContractError::new(tool, path, "number exceeds maximum"));
                }
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_usize_bound(
    tool: &str,
    object: &Map<String, Value>,
    keyword: &str,
    actual: usize,
    path: &str,
    maximum: bool,
) -> Result<(), ToolContractError> {
    let Some(limit) = object.get(keyword).and_then(Value::as_u64) else {
        return Ok(());
    };
    let violates = if maximum {
        actual as u64 > limit
    } else {
        (actual as u64) < limit
    };
    if violates {
        return Err(ToolContractError::new(
            tool,
            path,
            format!("value violates {keyword}={limit}"),
        ));
    }
    Ok(())
}

fn schema_types(schema: &Value) -> Option<Vec<&str>> {
    match schema.get("type")? {
        Value::String(value) => Some(vec![value.as_str()]),
        Value::Array(values) => Some(values.iter().filter_map(Value::as_str).collect()),
        _ => None,
    }
}

fn value_matches_type(value: &Value, expected: &str) -> bool {
    match expected {
        "object" => value.is_object(),
        "array" => value.is_array(),
        "string" => value.is_string(),
        "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
        "number" => value.is_number(),
        "boolean" => value.is_boolean(),
        "null" => value.is_null(),
        _ => false,
    }
}

fn resolve_local_ref<'a>(
    tool: &str,
    root: &'a Value,
    reference: &str,
    path: &str,
) -> Result<&'a Value, ToolContractError> {
    let Some(pointer) = reference.strip_prefix('#') else {
        return Err(ToolContractError::new(
            tool,
            path,
            "external schema references are forbidden",
        ));
    };
    root.pointer(pointer).ok_or_else(|| {
        ToolContractError::new(
            tool,
            path,
            format!("unresolved local reference `{reference}`"),
        )
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use async_trait::async_trait;

    use super::*;
    use crate::agent::tools::{tool_result, tool_schema, ToolCapability, ToolError, ToolHandler};

    struct Echo;

    #[async_trait]
    impl ToolHandler for Echo {
        async fn execute(&self, args: &Value) -> Result<String, ToolError> {
            Ok(tool_result(args))
        }
    }

    fn entry(parameters: Value) -> ToolEntry {
        ToolEntry {
            name: "echo".to_string(),
            toolset: "test".to_string(),
            schema: tool_schema("echo", "Echo validated arguments.", parameters),
            capability: ToolCapability::read("test"),
            handler: Arc::new(Echo),
        }
    }

    #[test]
    fn rejects_missing_nested_property_description() {
        let error = validate_entry(&entry(serde_json::json!({
            "type": "object",
            "properties": {
                "outer": {
                    "type": "object",
                    "description": "Outer input.",
                    "properties": { "inner": { "type": "string" } }
                }
            }
        })))
        .unwrap_err();
        assert_eq!(
            error.path,
            "$.properties.outer.properties.inner.description"
        );
    }

    #[test]
    fn runtime_rejects_unknown_and_invalid_nested_arguments() {
        let entry = entry(serde_json::json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "items": {
                    "type": "array",
                    "description": "Bounded item values.",
                    "maxItems": 2,
                    "items": {
                        "type": "integer",
                        "description": "One integer item.",
                        "minimum": 1
                    }
                }
            },
            "required": ["items"]
        }));
        validate_entry(&entry).unwrap();
        assert!(validate_arguments(&entry, &serde_json::json!({"items":[1, 2]})).is_ok());
        assert!(validate_arguments(&entry, &serde_json::json!({"items":[0]})).is_err());
        assert!(validate_arguments(
            &entry,
            &serde_json::json!({"items":[1], "unexpected": true})
        )
        .is_err());
    }
}
